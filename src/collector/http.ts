import fs from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { BeaconError } from "../errors.js";
import type { BeaconConfig } from "../types.js";
import { isPathAllowed, parseRobots, type RobotsRule } from "./robots.js";

export type HttpResponse = { status: number; body: string; fromCache: boolean };
export type HttpStats = { requests: number; cacheHits: number };
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type CreateHttpOptions = {
  cacheDir?: string;
  noCache?: boolean;
  onProgress?: (phase: string, detail?: string) => void;
  /** Injectable for tests — defaults to the global fetch. Never used against the live
   * network in this lane's own tests. */
  fetchImpl?: FetchLike;
  /** Injectable clock for deterministic cache-TTL tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Cache TTL in ms. Defaults to 6h per the store-collector spec. */
  cacheTtlMs?: number;
};

export type HttpClient = {
  get(url: string): Promise<HttpResponse>;
  /** Resolves once robots.txt for the URL's host has been loaded (fetching it on first
   * use, cached per host). True if the path may be fetched for user-agent `*`. */
  allowed(url: string): Promise<boolean>;
  stats: HttpStats;
};

type CacheEntry = { status: number; body: string; fetchedAt: string };

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function cacheKeyForUrl(url: URL): string {
  const raw = (url.pathname + url.search) || "/";
  const sanitized = raw.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : "_root_";
}

async function readCacheEntry(
  dir: string,
  key: string,
  ttlMs: number,
  now: () => number,
): Promise<CacheEntry | null> {
  try {
    const raw = await fs.readFile(path.join(dir, `${key}.json`), "utf8");
    const entry = JSON.parse(raw) as CacheEntry;
    const age = now() - Date.parse(entry.fetchedAt);
    if (Number.isFinite(age) && age >= 0 && age < ttlMs) return entry;
    return null;
  } catch {
    return null;
  }
}

async function writeCacheEntry(dir: string, key: string, entry: CacheEntry): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${key}.json`), JSON.stringify(entry), "utf8");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(16000, 1000 * 2 ** attempt);
}

/** Parses a `Retry-After` header value (seconds, or an HTTP-date) into milliseconds. */
function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000;
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

/** Token bucket: `capacity` tokens, refilling at `ratePerSecond` tokens/sec. Callers
 * `await take()` before doing the throttled work; bursts up to `capacity` are allowed,
 * sustained throughput is capped at `ratePerSecond`. */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;

  constructor(ratePerSecond: number, capacity: number, now: () => number) {
    this.capacity = Math.max(1, capacity);
    this.tokens = this.capacity;
    this.refillPerMs = Math.max(ratePerSecond, 0.001) / 1000;
    this.now = now;
    this.lastRefill = now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = t - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = t;
  }

  async take(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const needed = 1 - this.tokens;
      const waitMs = Math.max(1, Math.ceil(needed / this.refillPerMs));
      await delay(waitMs);
    }
  }
}

/**
 * Builds a throttled, cached, robots-aware HTTP client for one scan. `get()` fetches
 * `robots.txt` for the URL's host on first use (memoised per host), refuses any path
 * disallowed for `*` (throws `BeaconError("ROBOTS_DISALLOWED", ...)` — callers that want
 * a soft skip instead should check `allowed()` first), retries 429/5xx with exponential
 * backoff honouring `Retry-After`, and reads/writes a 6h disk cache under
 * `<cacheDir>/<host>/`.
 */
export function createHttp(config: BeaconConfig, opts: CreateHttpOptions = {}): HttpClient {
  const httpConfig = config.http;
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = opts.now ?? Date.now;
  const cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cacheDir = opts.cacheDir ?? ".cache";
  const bucket = new TokenBucket(httpConfig.rps, Math.max(1, httpConfig.concurrency), now);
  const limiter = pLimit(Math.max(1, httpConfig.concurrency));
  const stats: HttpStats = { requests: 0, cacheHits: 0 };
  const robotsPromises = new Map<string, Promise<RobotsRule[]>>();
  // Real-world fix (Lane I, post-integration): the token bucket only throttles how fast
  // *new* requests are issued — it does nothing to stop a concurrent sibling from firing a
  // fresh request while another slot is mid-backoff from a 429. Against the real store this
  // let concurrency=2 keep hammering the server throughout a 429 storm instead of the whole
  // client slowing down together, and the run failed RATE_LIMITED after ~206 good requests.
  // `cooldownUntil` is a shared gate every request (not just the one that got the 429) waits
  // on, so a 429 anywhere pauses the whole client, matching "network etiquette is
  // non-negotiable" in spirit without changing the per-request backoff curve or the frozen
  // rps/concurrency/maxRetries values in beacon.config.json. See decisions-during-build.md.
  let cooldownUntil = 0;

  async function rawFetchWithRetry(url: string): Promise<{ status: number; body: string }> {
    let attempt = 0;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), httpConfig.timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          signal: controller.signal,
          headers: { "user-agent": httpConfig.userAgent, accept: "*/*" },
        });
      } catch (err) {
        clearTimeout(timer);
        if (attempt >= httpConfig.maxRetries) {
          throw new BeaconError(
            "RATE_LIMITED",
            `Request to ${url} failed after ${attempt} retries: ${(err as Error).message}`,
            "The store may be blocking or throttling requests; try again later, from a different network, or with --no-cache off to reuse the last good snapshot.",
          );
        }
        const waitMs = backoffMs(attempt);
        opts.onProgress?.(
          "retry",
          `${url} network error, retrying in ${waitMs}ms (attempt ${attempt + 1}/${httpConfig.maxRetries})`,
        );
        await delay(waitMs);
        attempt++;
        continue;
      }
      clearTimeout(timer);
      const body = await response.text();
      if (response.status === 429 || response.status >= 500) {
        if (attempt >= httpConfig.maxRetries) {
          throw new BeaconError(
            "RATE_LIMITED",
            `Request to ${url} kept failing with ${response.status} after ${httpConfig.maxRetries} retries.`,
            "The store is rate-limiting or erroring; retry later or lower --max-products.",
          );
        }
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        const waitMs = retryAfterMs ?? backoffMs(attempt);
        opts.onProgress?.(
          "retry",
          `${response.status} on ${url}, waiting ${waitMs}ms (attempt ${attempt + 1}/${httpConfig.maxRetries})`,
        );
        // Pause every request in flight or queued — not just this one — for at least as
        // long as this backoff, so a 429 anywhere slows the whole client down together.
        cooldownUntil = Math.max(cooldownUntil, now() + waitMs);
        await delay(waitMs);
        attempt++;
        continue;
      }
      return { status: response.status, body };
    }
  }

  async function executeThrottled(url: string): Promise<{ status: number; body: string }> {
    return limiter(async () => {
      for (;;) {
        const wait = cooldownUntil - now();
        if (wait <= 0) break;
        await delay(wait);
      }
      await bucket.take();
      stats.requests++;
      return rawFetchWithRetry(url);
    });
  }

  async function fetchRawCached(url: string): Promise<HttpResponse> {
    const parsed = new URL(url);
    const key = cacheKeyForUrl(parsed);
    const dir = path.join(cacheDir, parsed.host);
    if (!opts.noCache) {
      const cached = await readCacheEntry(dir, key, cacheTtlMs, now);
      if (cached) {
        stats.cacheHits++;
        return { status: cached.status, body: cached.body, fromCache: true };
      }
    }
    const { status, body } = await executeThrottled(url);
    await writeCacheEntry(dir, key, { status, body, fetchedAt: new Date(now()).toISOString() });
    return { status, body, fromCache: false };
  }

  function robotsFor(host: string): Promise<RobotsRule[]> {
    let existing = robotsPromises.get(host);
    if (!existing) {
      existing = (async () => {
        try {
          const res = await fetchRawCached(`https://${host}/robots.txt`);
          if (res.status >= 200 && res.status < 300) return parseRobots(res.body, "*");
          return []; // missing/erroring robots.txt: no rules, everything allowed
        } catch {
          return [];
        }
      })();
      robotsPromises.set(host, existing);
    }
    return existing;
  }

  async function allowed(url: string): Promise<boolean> {
    const parsed = new URL(url);
    if (parsed.pathname === "/robots.txt") return true;
    const rules = await robotsFor(parsed.host);
    return isPathAllowed(rules, parsed.pathname + parsed.search);
  }

  async function get(url: string): Promise<HttpResponse> {
    const parsed = new URL(url);
    if (parsed.pathname !== "/robots.txt") {
      const ok = await allowed(url);
      if (!ok) {
        throw new BeaconError(
          "ROBOTS_DISALLOWED",
          `robots.txt disallows ${parsed.pathname}${parsed.search} for * on ${parsed.host}`,
          `Check ${parsed.origin}/robots.txt — this path must be skipped, not fetched.`,
        );
      }
    }
    return fetchRawCached(url);
  }

  return { get, allowed, stats };
}
