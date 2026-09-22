import fs from "node:fs/promises";
import path from "node:path";
import { BeaconError } from "../errors.js";
import type { BeaconConfig, Collection, Product, StoreSnapshot } from "../types.js";
import { defaultConfig, mergeConfig } from "./config.js";
import { createHttp, type HttpClient } from "./http.js";
import { isPathAllowed, parseRobots } from "./robots.js";
import {
  applyCollectionMembership,
  detectPolicyLinks,
  detectShopify,
  fetchAllCollections,
  fetchAllProducts,
  fetchCollectionMembership,
  normaliseCollection,
  normaliseProduct,
  policyLimitNotes,
  type RawCollection,
  type RawProduct,
} from "./shopify.js";

export type CollectOptions = {
  maxProducts?: number;
  cacheDir?: string;
  noCache?: boolean;
  config?: Partial<BeaconConfig>;
  onProgress?: (phase: string, detail?: string) => void;
  /** Not currently threaded through by src/index.ts's scanStore() (its ScanOptions.now
   * only reaches analyseSnapshot) — accepted here anyway so collect() is deterministically
   * testable on its own; see docs/decisions-during-build.md Lane A entry. */
  now?: () => Date;
};

/** A StoreSnapshot as returned by this module, plus the free-text limit notes the
 * collector itself discovers (robots-blocked paths, pagination truncation, the fixture-
 * recording bound in offline mode). `StoreSnapshot` has no field for these — see the
 * Lane A decisions-during-build.md entry for why and how the engine is expected to pick
 * them up. `StoreSnapshot.parse(...)` strips this extra key without error, so the object
 * is still a valid StoreSnapshot in every sense the frozen schema cares about. */
export type CollectedSnapshot = StoreSnapshot & { collectorLimits: string[] };

function extractHost(input: string): string {
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`);
    return url.host;
  } catch {
    throw new BeaconError(
      "INVALID_INPUT",
      `"${input}" is not a valid store URL or host.`,
      "Pass a URL like https://example.com or a bare host like example.com.",
    );
  }
}

async function collectPoliciesOnline(
  http: HttpClient,
  host: string,
): Promise<{ shipping: boolean | null; refund: boolean | null; limits: string[] }> {
  const shippingUrl = `https://${host}/policies/shipping-policy`;
  const refundUrl = `https://${host}/policies/refund-policy`;
  const shippingAllowed = await http.allowed(shippingUrl);
  const refundAllowed = await http.allowed(refundUrl);
  const shipping = shippingAllowed ? (await http.get(shippingUrl)).status === 200 : null;
  const refund = refundAllowed ? (await http.get(refundUrl)).status === 200 : null;
  return { shipping, refund, limits: policyLimitNotes(shippingAllowed, refundAllowed) };
}

/** Fetches and normalises a live Shopify storefront into a StoreSnapshot. Lane A. */
export async function collect(url: string, opts: CollectOptions = {}): Promise<StoreSnapshot> {
  const start = Date.now();
  const host = extractHost(url);
  const config = mergeConfig(opts.config);
  const http = createHttp(config, {
    cacheDir: opts.cacheDir,
    noCache: opts.noCache,
    onProgress: opts.onProgress,
  });
  const limits: string[] = [];

  opts.onProgress?.("robots", `${host}/robots.txt`);
  const productsUrl = `https://${host}/products.json`;
  if (!(await http.allowed(productsUrl))) {
    throw new BeaconError(
      "ROBOTS_DISALLOWED",
      `robots.txt disallows /products.json for * on ${host}`,
      "This store's robots.txt blocks the storefront JSON API the collector needs; pick a different host.",
    );
  }

  opts.onProgress?.("detect", `${host} is a Shopify storefront?`);
  await detectShopify(http, host);

  const maxProducts = opts.maxProducts ?? config.limits.maxProducts;
  opts.onProgress?.("collect", "products");
  const { raw: rawProducts, truncated } = await fetchAllProducts(http, host, maxProducts, opts.onProgress);
  if (truncated) {
    limits.push(`product catalogue truncated at ${maxProducts} products (more may exist on the store)`);
  }
  let products: Product[] = rawProducts.map((p) => normaliseProduct(p, host));

  opts.onProgress?.("collect", "collections");
  const collectionsRaw = await fetchAllCollections(http, host, opts.onProgress);
  const collections: Collection[] = collectionsRaw.map((c) => normaliseCollection(c, config.merchCollectionRegex));

  const membership = await fetchCollectionMembership(http, host, collectionsRaw, opts.onProgress);
  for (const [handle, entry] of membership.byCollection) {
    products = applyCollectionMembership(products, handle, entry.order, entry.size);
  }
  limits.push(...membership.limits);

  opts.onProgress?.("collect", "homepage");
  const home = await http.get(`https://${host}/`);
  const linkedFromHome = detectPolicyLinks(home.body);

  opts.onProgress?.("collect", "policies");
  const policies = await collectPoliciesOnline(http, host);
  limits.push(...policies.limits);

  const durationMs = Date.now() - start;
  const fetchedAt = (opts.now?.() ?? new Date()).toISOString();

  const snapshot: CollectedSnapshot = {
    schemaVersion: 1,
    store: { host },
    fetchedAt,
    products,
    collections,
    policies: { shipping: policies.shipping, refund: policies.refund, linkedFromHome },
    stats: { requests: http.stats.requests, cacheHits: http.stats.cacheHits, durationMs },
    collectorLimits: limits,
  };
  return snapshot;
}

async function readFixture(dir: string, name: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(dir, name), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

export type CollectOfflineOptions = {
  onProgress?: (phase: string, detail?: string) => void;
  now?: () => Date;
  config?: Partial<BeaconConfig>;
};

/**
 * Builds a StoreSnapshot from recorded fixtures, no network. Lane A. Reuses the exact
 * same normalisation functions as `collect()` (`normaliseProduct`, `normaliseCollection`,
 * `applyCollectionMembership`, `detectPolicyLinks`, `policyLimitNotes`) and the same
 * `robots.ts` parser/matcher against the recorded `robots.txt`, so this path reaches the
 * same "not checked" conclusion for `/policies/*` on this store as a live run would (D-02),
 * and so a store whose fixtures show no robots restriction round-trips identically to the
 * online path. Second parameter is additive/optional — `src/index.ts` calls
 * `collectOffline(dir)` with just the one argument.
 */
export async function collectOffline(dir: string, opts: CollectOfflineOptions = {}): Promise<StoreSnapshot> {
  const start = Date.now();
  const config = mergeConfig(opts.config);
  const host = path.basename(path.resolve(dir));
  const limits: string[] = [];
  let fileReads = 0;

  async function read(name: string): Promise<string | null> {
    const content = await readFixture(dir, name);
    if (content != null) fileReads++;
    return content;
  }

  const robotsText = await read("robots.txt");
  const rules = robotsText ? parseRobots(robotsText, "*") : [];
  const allowed = (p: string) => isPathAllowed(rules, p);

  // Products: page1.json, page2.json, ... while a page file exists and isn't empty.
  const rawProducts: RawProduct[] = [];
  let page = 1;
  let truncated = false;
  const maxProducts = config.limits.maxProducts;
  for (;;) {
    const content = await read(`products.page${page}.json`);
    if (content == null) break;
    const parsed = JSON.parse(content) as { products?: RawProduct[] };
    const batch = Array.isArray(parsed.products) ? parsed.products : [];
    opts.onProgress?.("collect", `products page ${page} (${batch.length})`);
    if (batch.length === 0) break;
    for (const p of batch) {
      if (rawProducts.length >= maxProducts) {
        truncated = true;
        break;
      }
      rawProducts.push(p);
    }
    if (truncated) break;
    page++;
  }
  if (truncated) {
    limits.push(`product catalogue truncated at ${maxProducts} products (more may exist in fixtures)`);
  }
  let products: Product[] = rawProducts.map((p) => normaliseProduct(p, host));

  // Collections: one complete collections.json (per tests/fixtures/README.md), plus a
  // bounded subset of collection.<handle>.json listings (D-03).
  const collectionsContent = await read("collections.json");
  const collectionsRaw: RawCollection[] = collectionsContent
    ? ((JSON.parse(collectionsContent) as { collections?: RawCollection[] }).collections ?? [])
    : [];
  const collections: Collection[] = collectionsRaw.map((c) => normaliseCollection(c, config.merchCollectionRegex));
  opts.onProgress?.("collect", `collections ${collections.length}`);

  let recorded = 0;
  let missing = 0;
  for (const c of collectionsRaw) {
    if (!allowed(`/collections/${c.handle}/products.json`)) {
      missing++;
      continue;
    }
    const content = await read(`collection.${c.handle}.json`);
    if (content == null) {
      missing++;
      continue;
    }
    recorded++;
    const listing = JSON.parse(content) as { products?: { handle: string }[] };
    const handles = Array.isArray(listing.products) ? listing.products.map((p) => p.handle) : [];
    products = applyCollectionMembership(products, c.handle, handles, c.products_count ?? handles.length);
  }
  if (missing > 0) {
    // D-03: one aggregated note, not one per missing collection.
    limits.push(
      `collection membership recorded for ${recorded}/${collectionsRaw.length} collections in fixtures; ` +
        "rest treated as empty (fixture-recording bound, not a live-scan limitation)",
    );
  }

  const homeHtml = await read("home.html");
  const linkedFromHome = homeHtml ? detectPolicyLinks(homeHtml) : false;

  const shippingAllowed = allowed("/policies/shipping-policy");
  const refundAllowed = allowed("/policies/refund-policy");
  let shipping: boolean | null = null;
  let refund: boolean | null = null;
  if (shippingAllowed) {
    const statusText = await read("policies.shipping.status");
    shipping = statusText != null ? parseInt(statusText.trim(), 10) === 200 : null;
    if (statusText == null) limits.push("policies.shipping.status fixture missing; treated as not checked");
  }
  if (refundAllowed) {
    const statusText = await read("policies.refund.status");
    refund = statusText != null ? parseInt(statusText.trim(), 10) === 200 : null;
    if (statusText == null) limits.push("policies.refund.status fixture missing; treated as not checked");
  }
  limits.push(...policyLimitNotes(shippingAllowed, refundAllowed));

  const durationMs = Date.now() - start;
  const fetchedAt = (opts.now?.() ?? new Date()).toISOString();

  const snapshot: CollectedSnapshot = {
    schemaVersion: 1,
    store: { host },
    fetchedAt,
    products,
    collections,
    policies: { shipping, refund, linkedFromHome },
    stats: { requests: fileReads, cacheHits: 0, durationMs },
    collectorLimits: limits,
  };
  return snapshot;
}
