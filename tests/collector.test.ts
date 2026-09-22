import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collect, collectOffline, type CollectedSnapshot } from "../src/collector/index.js";
import { createHttp, type FetchLike } from "../src/collector/http.js";
import { defaultConfig } from "../src/collector/config.js";
import { detectPdpMarkers, samplePdpMarkers, selectPdpSampleCandidates } from "../src/collector/pdp-markers.js";
import { isPathAllowed, parseRobots } from "../src/collector/robots.js";
import {
  applyCollectionMembership,
  computeIsMerch,
  normaliseProduct,
  normaliseVariant,
  stripHtml,
} from "../src/collector/shopify.js";
import { BeaconError } from "../src/errors.js";
import { PdpMarkers, StoreSnapshot, type Product } from "../src/types.js";

const FIXTURES_DIR = path.join(__dirname, "fixtures", "bluetokaicoffee.com");

// ---------------------------------------------------------------------------
// Mocked-fetch test harness. `collect()`/`createHttp()` never touch the real
// network in this file — every test either injects a `fetchImpl` mock or uses
// `collectOffline()` against the recorded fixtures.
// ---------------------------------------------------------------------------

type MockRoute = (url: string) => { status: number; body: string; headers?: Record<string, string> } | undefined;

function makeMockFetch(routes: MockRoute[]): { fetchImpl: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url: string) => {
    calls.push(url);
    for (const route of routes) {
      const match = route(url);
      if (match) {
        return new Response(match.body, { status: match.status, headers: match.headers });
      }
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, calls };
}

function jsonRoute(pathPrefix: string, body: unknown, status = 200): MockRoute {
  return (url) => {
    const { pathname } = new URL(url);
    if (pathname === pathPrefix || url.includes(pathPrefix)) {
      return { status, body: JSON.stringify(body) };
    }
    return undefined;
  };
}

function textRoute(pathPrefix: string, body: string, status = 200): MockRoute {
  return (url) => {
    if (url.includes(pathPrefix)) return { status, body };
    return undefined;
  };
}

const EMPTY_ROBOTS = "User-agent: *\n"; // no Disallow lines: everything allowed
const HOMEPAGE_NO_POLICY_LINKS = "<html><body>hello shop</body></html>";

function rawProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    handle: "test-product",
    title: "Test Product",
    body_html: "<p>Hello <b>world</b></p>",
    vendor: "Acme",
    product_type: "Widget",
    tags: ["a", "b"],
    options: [{ name: "Title", position: 1, values: ["Default Title"] }],
    variants: [
      {
        id: 11,
        title: "Default Title",
        option1: "Default Title",
        option2: null,
        option3: null,
        price: "700.00",
        compare_at_price: null,
        available: true,
        featured_image: null,
      },
    ],
    images: [{ id: 1 }],
    updated_at: "2026-09-01T00:00:00+05:30",
    published_at: "2026-01-01T00:00:00+05:30",
    ...overrides,
  };
}

let tmpDirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "beacon-collector-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  tmpDirs = [];
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Requirement: Shopify detection
// ---------------------------------------------------------------------------

describe("Shopify detection", () => {
  it("Non-Shopify site: /products.json is not JSON with a products array -> NOT_SHOPIFY, hint names both PRD §6 fallbacks", async () => {
    const cacheDir = await makeTmpDir();
    const { fetchImpl } = makeMockFetch([
      textRoute("/robots.txt", EMPTY_ROBOTS),
      (url) => (url.includes("/products.json") ? { status: 200, body: "<html>not json</html>" } : undefined),
    ]);
    await expect(collectViaHttpMock("https://example.com", fetchImpl, cacheDir)).rejects.toMatchObject({
      code: "NOT_SHOPIFY",
    });
    try {
      await collectViaHttpMock("https://example.com", fetchImpl, cacheDir);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BeaconError);
      expect((err as BeaconError).hint).toMatch(/gymshark\.com/);
      expect((err as BeaconError).hint).toMatch(/allbirds\.com/);
    }
  });

  it("Endpoint disabled: /products.json 403s but homepage has cdn.shopify.com -> ENDPOINT_DISABLED", async () => {
    const cacheDir = await makeTmpDir();
    const { fetchImpl } = makeMockFetch([
      textRoute("/robots.txt", EMPTY_ROBOTS),
      (url) => {
        const u = new URL(url);
        if (u.pathname === "/products.json") return { status: 403, body: "forbidden" };
        if (u.pathname === "/") return { status: 200, body: "<html><script src='https://cdn.shopify.com/x.js'></script></html>" };
        return undefined;
      },
    ]);
    await expect(collectViaHttpMock("https://blocked-store.com", fetchImpl, cacheDir)).rejects.toMatchObject({
      code: "ENDPOINT_DISABLED",
    });
  });
});

/** Runs `collect()` with a mocked fetch injected through a temporary env hook — since
 * `collect()` builds its own `createHttp()` internally, we go through `opts.config` plus
 * monkeypatching global fetch for the duration of the call (restored after), which is the
 * simplest way to inject a mock without widening collect()'s own option type. */
async function collectViaHttpMock(
  url: string,
  fetchImpl: FetchLike,
  cacheDir: string,
  configOverride: Record<string, unknown> = {},
) {
  const realFetch = globalThis.fetch;
  // @ts-expect-error -- test-only global monkeypatch, restored in finally
  globalThis.fetch = fetchImpl;
  try {
    return await collect(url, { cacheDir, config: configOverride as never, noCache: true });
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---------------------------------------------------------------------------
// Requirement: Robots and rate limits
// ---------------------------------------------------------------------------

describe("Robots and rate limits", () => {
  it("Burst of 429s: waits >=Retry-After before retrying, reports one progress line, and continues", async () => {
    // Real (short) timing rather than faked timers: http.ts's backoff delay isn't clock-
    // injectable (only the cache-TTL clock is, deliberately, to keep the retry path's
    // real setTimeout semantics honest under test). A small Retry-After keeps this test
    // fast while exercising the exact same parseRetryAfterMs -> delay -> retry code path
    // the spec's "Retry-After: 2" example describes.
    const retryAfterSeconds = 0.2;
    let productsCalls = 0;
    const fetchImpl: FetchLike = async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/robots.txt") return new Response(EMPTY_ROBOTS, { status: 200 });
      if (u.pathname === "/products.json") {
        if (u.searchParams.get("page") === null) {
          // detectShopify's ?limit=1 probe — not a pagination call.
          return new Response(JSON.stringify({ products: [rawProduct()] }), { status: 200 });
        }
        productsCalls++;
        if (productsCalls === 1) {
          return new Response("rate limited", {
            status: 429,
            headers: { "retry-after": String(retryAfterSeconds) },
          });
        }
        return new Response(JSON.stringify({ products: [] }), { status: 200 });
      }
      if (u.pathname === "/collections.json") return new Response(JSON.stringify({ collections: [] }), { status: 200 });
      if (u.pathname === "/") return new Response(HOMEPAGE_NO_POLICY_LINKS, { status: 200 });
      return new Response("not found", { status: 404 });
    };

    const onProgress = vi.fn();
    const cacheDir = await makeTmpDir();
    const realFetch = globalThis.fetch;
    // @ts-expect-error test-only monkeypatch
    globalThis.fetch = fetchImpl;
    const before = Date.now();
    const result = await collect("https://retry-store.com", {
      cacheDir,
      noCache: true,
      onProgress,
      config: { http: { rps: 1000, concurrency: 5, maxRetries: 4, timeoutMs: 5000, userAgent: "test" } } as never,
    });
    const elapsedMs = Date.now() - before;
    globalThis.fetch = realFetch;

    expect(productsCalls).toBe(2);
    expect(result.products).toEqual([]);
    expect(elapsedMs).toBeGreaterThanOrEqual(retryAfterSeconds * 1000 - 20); // small scheduling slack
    expect(onProgress).toHaveBeenCalledWith("retry", expect.stringMatching(/429.*waiting 200ms/));
  }, 10000);

  it("Disallowed path (/collections/*/products.json for *): skips per-collection fetches, every product.collections === [], one aggregated limit note", async () => {
    const robotsTxt = "User-agent: *\nDisallow: /collections/*/products.json\n";
    const fetchImpl: FetchLike = async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/robots.txt") return new Response(robotsTxt, { status: 200 });
      if (u.pathname === "/products.json") {
        return new Response(JSON.stringify({ products: [rawProduct({ handle: "p1" })] }), { status: 200 });
      }
      if (u.pathname === "/collections.json") {
        return new Response(
          JSON.stringify({ collections: [{ handle: "bestsellers", title: "Best Sellers", products_count: 1 }] }),
          { status: 200 },
        );
      }
      if (u.pathname === "/") return new Response(HOMEPAGE_NO_POLICY_LINKS, { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const cacheDir = await makeTmpDir();
    const snapshot = (await collectViaHttpMock("https://disallow-store.com", fetchImpl, cacheDir)) as CollectedSnapshot;

    expect(snapshot.products).toHaveLength(1);
    expect(snapshot.products[0]?.collections).toEqual([]);
    expect(snapshot.collectorLimits).toContain("collection positions unavailable (robots.txt)");
  });
});

// ---------------------------------------------------------------------------
// Requirement: Full catalogue pagination
// ---------------------------------------------------------------------------

describe("Full catalogue pagination", () => {
  it("Store with 612 products: pages 250+250+112, stops on the short page, snapshot.products.length === 612", async () => {
    const pageSizes = [250, 250, 112];
    let productCalls = 0;
    const fetchImpl: FetchLike = async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/robots.txt") return new Response(EMPTY_ROBOTS, { status: 200 });
      if (u.pathname === "/products.json") {
        const pageParam = u.searchParams.get("page");
        if (pageParam === null) {
          // detectShopify's ?limit=1 probe — not a pagination call.
          return new Response(JSON.stringify({ products: [rawProduct()] }), { status: 200 });
        }
        const page = Number(pageParam);
        productCalls++;
        const size = pageSizes[page - 1] ?? 0;
        const batch = Array.from({ length: size }, (_, i) =>
          rawProduct({ id: page * 1000 + i, handle: `p-${page}-${i}` }),
        );
        return new Response(JSON.stringify({ products: batch }), { status: 200 });
      }
      if (u.pathname === "/collections.json") return new Response(JSON.stringify({ collections: [] }), { status: 200 });
      if (u.pathname === "/") return new Response(HOMEPAGE_NO_POLICY_LINKS, { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const cacheDir = await makeTmpDir();
    const snapshot = await collectViaHttpMock("https://big-store.com", fetchImpl, cacheDir);

    expect(snapshot.products).toHaveLength(612);
    expect(productCalls).toBe(3);
    expect(snapshot.stats.requests).toBeGreaterThanOrEqual(3);
  });

  it("truncates at maxProducts and records it in collectorLimits", async () => {
    const fetchImpl: FetchLike = async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/robots.txt") return new Response(EMPTY_ROBOTS, { status: 200 });
      if (u.pathname === "/products.json") {
        const page = Number(u.searchParams.get("page"));
        const batch = Array.from({ length: 250 }, (_, i) => rawProduct({ id: page * 1000 + i, handle: `p-${page}-${i}` }));
        return new Response(JSON.stringify({ products: batch }), { status: 200 });
      }
      if (u.pathname === "/collections.json") return new Response(JSON.stringify({ collections: [] }), { status: 200 });
      if (u.pathname === "/") return new Response(HOMEPAGE_NO_POLICY_LINKS, { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const cacheDir = await makeTmpDir();
    const snapshot = (await collectViaHttpMock("https://huge-store.com", fetchImpl, cacheDir, {
      limits: { maxProducts: 300, pdpSample: 20 },
    } as never)) as CollectedSnapshot;
    expect(snapshot.products).toHaveLength(300);
    expect(snapshot.collectorLimits.some((l) => l.includes("truncated at 300"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Requirement: Normalisation
// ---------------------------------------------------------------------------

describe("Normalisation", () => {
  it("variant with null compare_at_price and string price normalises to compareAtPrice: null, price: 1299", () => {
    const v = normaliseVariant({
      id: 1,
      title: "200g",
      price: "1299.00",
      compare_at_price: null,
      available: true,
      featured_image: null,
    });
    expect(v.compareAtPrice).toBeNull();
    expect(v.price).toBe(1299);
  });

  it("variant with a compare_at_price string parses to a number", () => {
    const v = normaliseVariant({ id: 2, title: "x", price: "500.00", compare_at_price: "650.00", available: false });
    expect(v.compareAtPrice).toBe(650);
    expect(v.available).toBe(false);
  });

  it("hasOwnImage reflects featured_image != null", () => {
    const withImage = normaliseVariant({ id: 3, title: "x", price: "1", featured_image: { id: 9 } });
    const withoutImage = normaliseVariant({ id: 4, title: "y", price: "1", featured_image: null });
    expect(withImage.hasOwnImage).toBe(true);
    expect(withoutImage.hasOwnImage).toBe(false);
  });

  it("strips HTML from body_html for descriptionChars", () => {
    expect(stripHtml("<p>Hello <b>world</b>&nbsp;&amp; friends</p>")).toBe("Hello world & friends");
    expect(stripHtml(null)).toBe("");
  });

  it("normaliseProduct builds a Product matching the frozen Product schema shape", () => {
    const product = normaliseProduct(rawProduct() as never, "example.com");
    expect(product.url).toBe("https://example.com/products/test-product");
    expect(product.descriptionChars).toBe("Hello world".length);
    expect(product.imageCount).toBe(1);
    expect(product.collections).toEqual([]);
    expect(product.variants).toHaveLength(1);
  });

  it("computeIsMerch matches handle or title against the regex, excluding all/frontpage", () => {
    const regex = defaultConfig.merchCollectionRegex;
    expect(computeIsMerch("bestsellers", "Best Sellers", regex)).toBe(true);
    expect(computeIsMerch("new-to-coffee", "New To Coffee", regex)).toBe(true);
    expect(computeIsMerch("all", "Best of All", regex)).toBe(false);
    expect(computeIsMerch("frontpage", "frontpage", regex)).toBe(false);
    expect(computeIsMerch("brewing-accessories", "Accessories", regex)).toBe(false);
  });

  it("applyCollectionMembership assigns 1-based position and the given size, leaves non-members untouched", () => {
    const products: Product[] = [
      normaliseProduct(rawProduct({ handle: "a" }) as never, "h"),
      normaliseProduct(rawProduct({ handle: "b" }) as never, "h"),
      normaliseProduct(rawProduct({ handle: "c" }) as never, "h"),
    ];
    const updated = applyCollectionMembership(products, "bestsellers", ["b", "a"], 2);
    expect(updated.find((p) => p.handle === "a")?.collections).toEqual([{ handle: "bestsellers", position: 2, size: 2 }]);
    expect(updated.find((p) => p.handle === "b")?.collections).toEqual([{ handle: "bestsellers", position: 1, size: 2 }]);
    expect(updated.find((p) => p.handle === "c")?.collections).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Requirement: Disk cache
// ---------------------------------------------------------------------------

describe("Disk cache", () => {
  // Every `get()` also triggers a robots.txt fetch on first use per host (memoised only
  // in-process, but itself disk-cached like any other GET) — so a single `get()` call
  // costs 2 real network requests the first time (robots.txt + the target), and 0 once
  // both are cached. Tests below count deltas rather than hardcoding absolute totals.

  it("second run within 6h makes 0 network requests for cached paths and stats.cacheHits > 0", async () => {
    const cacheDir = await makeTmpDir();
    let callCount = 0;
    const fetchImpl: FetchLike = async () => {
      callCount++;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const http1 = createHttp(defaultConfig, { cacheDir, fetchImpl });
    const res1 = await http1.get("https://cache-test.com/products.json?limit=1");
    expect(res1.fromCache).toBe(false);
    const callsAfterFirst = callCount;
    expect(callsAfterFirst).toBeGreaterThan(0); // robots.txt + target, both real fetches

    const http2 = createHttp(defaultConfig, { cacheDir, fetchImpl });
    const res2 = await http2.get("https://cache-test.com/products.json?limit=1");
    expect(res2.fromCache).toBe(true);
    expect(res2.body).toBe(res1.body);
    expect(callCount).toBe(callsAfterFirst); // no new network call: robots.txt and target both cache hits
    expect(http2.stats.cacheHits).toBeGreaterThan(0);
  });

  it("--no-cache bypasses reuse and always hits the network", async () => {
    const cacheDir = await makeTmpDir();
    let callCount = 0;
    const fetchImpl: FetchLike = async () => {
      callCount++;
      return new Response("body", { status: 200 });
    };
    const http1 = createHttp(defaultConfig, { cacheDir, fetchImpl });
    await http1.get("https://nocache-test.com/x");
    const callsAfterFirst = callCount;
    const http2 = createHttp(defaultConfig, { cacheDir, fetchImpl, noCache: true });
    await http2.get("https://nocache-test.com/x");
    expect(callCount).toBe(callsAfterFirst * 2); // noCache re-fetches everything the first run cached
  });

  it("expired cache entries (older than the TTL) are not reused", async () => {
    const cacheDir = await makeTmpDir();
    let callCount = 0;
    const fetchImpl: FetchLike = async () => {
      callCount++;
      return new Response("body", { status: 200 });
    };
    let now = 1_000_000;
    const http1 = createHttp(defaultConfig, { cacheDir, fetchImpl, now: () => now, cacheTtlMs: 1000 });
    await http1.get("https://ttl-test.com/x");
    const callsAfterFirst = callCount;
    now += 2000; // past the TTL
    const http2 = createHttp(defaultConfig, { cacheDir, fetchImpl, now: () => now, cacheTtlMs: 1000 });
    await http2.get("https://ttl-test.com/x");
    expect(callCount).toBe(callsAfterFirst * 2); // both robots.txt and target had expired, both re-fetched
  });
});

// ---------------------------------------------------------------------------
// Requirement: PDP marker sampling
// ---------------------------------------------------------------------------

describe("PDP marker sampling", () => {
  it("detects Swym: hasSwym true, hasBisCapture true, markers exactly ['swym-button']", () => {
    const html = "<div class='swym-button' data-product-id='1'>Notify</div>";
    const result = detectPdpMarkers(html);
    expect(result).toEqual({ hasBisCapture: true, hasSwym: true, markers: ["swym-button"] });
  });

  it("detects generic back-in-stock capture without Swym branding", () => {
    const html = "<button>Back in stock soon — Notify Me</button>";
    const result = detectPdpMarkers(html);
    expect(result.hasSwym).toBe(false);
    expect(result.hasBisCapture).toBe(true);
    expect(result.markers).toEqual(expect.arrayContaining(["back in stock", "notify me"]));
  });

  it("no markers present: hasBisCapture false, hasSwym false, markers empty", () => {
    const result = detectPdpMarkers("<p>Nothing to see here.</p>");
    expect(result).toEqual({ hasBisCapture: false, hasSwym: false, markers: [] });
  });

  it("selectPdpSampleCandidates orders by leakage desc, only products with >=1 sold-out variant", () => {
    const make = (handle: string, sold: number, total: number): Product => ({
      ...normaliseProduct(rawProduct({ handle }) as never, "h"),
      variants: Array.from({ length: total }, (_, i) => ({
        id: i,
        title: `v${i}`,
        option1: null,
        option2: null,
        option3: null,
        price: 100,
        compareAtPrice: null,
        available: i >= sold,
        hasOwnImage: false,
      })),
    });
    const products = [make("half-out", 1, 2), make("all-in-stock", 0, 3), make("fully-out", 3, 3), make("quarter-out", 1, 4)];
    const selected = selectPdpSampleCandidates(products, 10);
    expect(selected.map((p) => p.handle)).toEqual(["fully-out", "half-out", "quarter-out"]);
  });

  it("samplePdpMarkers (online, mocked fetch) GETs each candidate PDP once and reports markers", async () => {
    const soldOutProduct: Product = {
      ...normaliseProduct(rawProduct({ handle: "sold-out-1" }) as never, "shop.test"),
      variants: [
        { id: 1, title: "v1", option1: null, option2: null, option3: null, price: 10, compareAtPrice: null, available: false, hasOwnImage: false },
      ],
    };
    const snapshot: StoreSnapshot = {
      schemaVersion: 1,
      store: { host: "shop.test" },
      fetchedAt: new Date().toISOString(),
      products: [soldOutProduct],
      collections: [],
      policies: { shipping: null, refund: null, linkedFromHome: false },
      stats: { requests: 0, cacheHits: 0, durationMs: 0 },
    };
    let pdpCalls = 0;
    const fetchImpl: FetchLike = async (url: string) => {
      if (url.includes("/robots.txt")) return new Response(EMPTY_ROBOTS, { status: 200 });
      if (url.includes("/products/sold-out-1")) {
        pdpCalls++;
        return new Response("<div class='swym-notify'></div>", { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };
    const cacheDir = await makeTmpDir();
    const realFetch = globalThis.fetch;
    // @ts-expect-error test monkeypatch
    globalThis.fetch = fetchImpl;
    const markers = await samplePdpMarkers(snapshot, { cacheDir, noCache: true });
    globalThis.fetch = realFetch;

    expect(pdpCalls).toBe(1);
    expect(markers.sampled).toHaveLength(1);
    expect(markers.sampled[0]).toMatchObject({ handle: "sold-out-1", hasSwym: true, hasBisCapture: true });
    expect(PdpMarkers.parse(markers)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Requirement: Policies and homepage
// ---------------------------------------------------------------------------

describe("Policies and homepage", () => {
  it("refund policy missing (404) -> policies.refund === false; shipping present -> true", async () => {
    const fetchImpl: FetchLike = async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/robots.txt") return new Response(EMPTY_ROBOTS, { status: 200 });
      if (u.pathname === "/products.json") return new Response(JSON.stringify({ products: [] }), { status: 200 });
      if (u.pathname === "/collections.json") return new Response(JSON.stringify({ collections: [] }), { status: 200 });
      if (u.pathname === "/policies/shipping-policy") return new Response("shipping info", { status: 200 });
      if (u.pathname === "/policies/refund-policy") return new Response("not found", { status: 404 });
      if (u.pathname === "/") return new Response("<a href='/policies/shipping-policy'>Shipping</a>", { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const cacheDir = await makeTmpDir();
    const snapshot = await collectViaHttpMock("https://policy-store.com", fetchImpl, cacheDir);
    expect(snapshot.policies.refund).toBe(false);
    expect(snapshot.policies.shipping).toBe(true);
    expect(snapshot.policies.linkedFromHome).toBe(true);
  });

  it("robots.txt disallows /policies/* -> both null, not fetched, limit note recorded", async () => {
    const robotsTxt = "User-agent: *\nDisallow: /policies/\n";
    let policyFetchAttempted = false;
    const fetchImpl: FetchLike = async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/robots.txt") return new Response(robotsTxt, { status: 200 });
      if (u.pathname === "/products.json") return new Response(JSON.stringify({ products: [] }), { status: 200 });
      if (u.pathname === "/collections.json") return new Response(JSON.stringify({ collections: [] }), { status: 200 });
      if (u.pathname.startsWith("/policies/")) {
        policyFetchAttempted = true;
        return new Response("should never be fetched", { status: 200 });
      }
      if (u.pathname === "/") return new Response(HOMEPAGE_NO_POLICY_LINKS, { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const cacheDir = await makeTmpDir();
    const snapshot = (await collectViaHttpMock("https://disallow-policies.com", fetchImpl, cacheDir)) as CollectedSnapshot;
    expect(snapshot.policies.shipping).toBeNull();
    expect(snapshot.policies.refund).toBeNull();
    expect(policyFetchAttempted).toBe(false);
    expect(
      snapshot.collectorLimits.some((l) => l.includes("robots.txt disallows /policies/")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Requirement: Offline fixtures mode (real fixtures, no network)
// ---------------------------------------------------------------------------

describe("Offline fixtures mode", () => {
  it("collectOffline(tests/fixtures/bluetokaicoffee.com) produces a StoreSnapshot that validates against StoreSnapshot.parse", async () => {
    const snapshot = (await collectOffline(FIXTURES_DIR)) as CollectedSnapshot;
    const parsed = StoreSnapshot.parse(snapshot); // throws on any schema mismatch
    expect(parsed.products.length).toBe(190);
    expect(parsed.store.host).toBe("bluetokaicoffee.com");
  });

  it("policies.shipping/refund are null (robots.txt disallows /policies/ on this store) — reaches the same 'not checked' conclusion as a live run, via the same robots parser", async () => {
    const snapshot = await collectOffline(FIXTURES_DIR);
    expect(snapshot.policies.shipping).toBeNull();
    expect(snapshot.policies.refund).toBeNull();
  });

  it("linkedFromHome is false: the recorded homepage links neither policy page", async () => {
    const snapshot = await collectOffline(FIXTURES_DIR);
    expect(snapshot.policies.linkedFromHome).toBe(false);
  });

  it("Missing fixture file: a collection listed in collections.json without a collection.<handle>.json is treated as empty, no product gets that handle", async () => {
    const snapshot = await collectOffline(FIXTURES_DIR);
    // "5-gst" is a real collection in collections.json (184 products) with no recorded
    // collection.5-gst.json fixture (see tests/fixtures/README.md) — every product must
    // come back with no membership entry for it.
    const anyIn5Gst = snapshot.products.some((p) => p.collections.some((c) => c.handle === "5-gst"));
    expect(anyIn5Gst).toBe(false);
  });

  it("Missing fixture file: ONE aggregated methodology-style limit note, not one per missing collection (D-03)", async () => {
    const snapshot = (await collectOffline(FIXTURES_DIR)) as CollectedSnapshot;
    const aggregated = snapshot.collectorLimits.filter((l) => l.includes("collection membership recorded for"));
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]).toMatch(/collection membership recorded for 12\/225 collections in fixtures/);
  });

  it("collection membership IS populated for handles that do have a recorded fixture (e.g. bestsellers)", async () => {
    const snapshot = await collectOffline(FIXTURES_DIR);
    const inBestsellers = snapshot.products.filter((p) => p.collections.some((c) => c.handle === "bestsellers"));
    expect(inBestsellers.length).toBeGreaterThan(0);
    const entry = inBestsellers[0]?.collections.find((c) => c.handle === "bestsellers");
    expect(entry?.position).toBeGreaterThanOrEqual(1);
    expect(entry?.size).toBeGreaterThan(0);
  });

  it("collectOffline reuses the same normalisation as collect(): a fixture variant with null compare_at_price still round-trips to compareAtPrice: null", async () => {
    const snapshot = await collectOffline(FIXTURES_DIR);
    const anyNullCompare = snapshot.products.flatMap((p) => p.variants).some((v) => v.compareAtPrice === null);
    expect(anyNullCompare).toBe(true);
  });

  it("samplePdpMarkers offline: reads pdp.<handle>.html fixtures for the sampled candidates and validates against PdpMarkers", async () => {
    const snapshot = await collectOffline(FIXTURES_DIR);
    const markers = await samplePdpMarkers(snapshot, { offlineFixturesDir: FIXTURES_DIR, pdpSample: 20 });
    PdpMarkers.parse(markers); // throws on mismatch
    // Only 3 PDP fixtures were recorded (highest-leakage sold-out products) — candidates
    // beyond that are silently skipped, so sampled.length reflects what's on disk.
    expect(markers.sampled.length).toBeLessThanOrEqual(3);
    expect(markers.sampled.length).toBeGreaterThan(0);
    for (const s of markers.sampled) {
      expect(s.hasBisCapture).toBe(true); // every recorded PDP fixture has "Back in stock" text
      expect(s.hasSwym).toBe(false); // this store's PDPs carry no swym branding
    }
  });

  it("collectOffline(dir) keeps the exact single-argument call shape src/index.ts uses", async () => {
    // src/index.ts calls collectOffline(opts.offlineFixturesDir) with no second argument.
    await expect(collectOffline(FIXTURES_DIR)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// robots.ts unit coverage (parsing/matching against the real fixture, directly)
// ---------------------------------------------------------------------------

describe("robots.txt parsing", () => {
  it("parses the real bluetokaicoffee.com robots.txt and disallows /policies/* for *", async () => {
    const text = await fs.readFile(path.join(FIXTURES_DIR, "robots.txt"), "utf8");
    const rules = parseRobots(text, "*");
    expect(isPathAllowed(rules, "/policies/shipping-policy")).toBe(false);
    expect(isPathAllowed(rules, "/policies/refund-policy")).toBe(false);
    expect(isPathAllowed(rules, "/products.json?limit=250&page=1")).toBe(true);
    expect(isPathAllowed(rules, "/collections/bestsellers/products.json")).toBe(true);
    expect(isPathAllowed(rules, "/search?q=coffee")).toBe(false);
  });

  it("supports * wildcards mid-pattern", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /collections/*sort_by*\n", "*");
    expect(isPathAllowed(rules, "/collections/coffee?sort_by=price")).toBe(false);
    expect(isPathAllowed(rules, "/collections/coffee")).toBe(true);
  });

  it("an Allow rule can override a broader Disallow (longest match wins)", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /collections/\nAllow: /collections/bestsellers\n", "*");
    expect(isPathAllowed(rules, "/collections/bestsellers")).toBe(true);
    expect(isPathAllowed(rules, "/collections/other")).toBe(false);
  });

  it("no robots.txt at all (fetch fails) -> everything allowed", async () => {
    const cacheDir = await makeTmpDir();
    const fetchImpl: FetchLike = async () => new Response("not found", { status: 404 });
    const http = createHttp(defaultConfig, { cacheDir, fetchImpl, noCache: true });
    expect(await http.allowed("https://no-robots.test/anything")).toBe(true);
  });
});
