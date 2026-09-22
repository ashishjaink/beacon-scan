import fs from "node:fs/promises";
import path from "node:path";
import type { PdpMarkers, Product, StoreSnapshot } from "../types.js";
import { defaultConfig } from "./config.js";
import { createHttp } from "./http.js";

export type SamplePdpMarkersOptions = {
  pdpSample?: number;
  offlineFixturesDir?: string;
  cacheDir?: string;
  noCache?: boolean;
  onProgress?: (phase: string, detail?: string) => void;
};

/**
 * Domain Context: Swym's own markers plus the generic back-in-stock capture vocabulary.
 * Checked longest/most-specific first so an occurrence of `swym-button` is reported as
 * exactly that — not also as a separate bare `swym` hit — matching the spec's "Store
 * using Swym" scenario (`markers: ["swym-button"]`, not `["swym-button", "swym"]`).
 */
const MARKER_CHECKS: Array<{ id: string; test: (html: string) => boolean }> = [
  { id: "swym-notify", test: (h) => /swym-notify/i.test(h) },
  { id: "swym-button", test: (h) => /swym-button/i.test(h) },
  // Bare "swym" only counts when it's not part of a more specific swym-* token already
  // matched above (negative lookahead for a trailing hyphen).
  { id: "swym", test: (h) => /swym(?!-)/i.test(h) },
  { id: "klaviyo-bis", test: (h) => /klaviyo-bis/i.test(h) },
  { id: "back in stock", test: (h) => /back in stock/i.test(h) },
  { id: "notify me", test: (h) => /notify me/i.test(h) },
  { id: "restock", test: (h) => /restock/i.test(h) },
  // "bis" alone is ambiguous (substrings of unrelated words) — require word boundaries
  // and exclude the "-bis" inside "klaviyo-bis" (already counted above).
  { id: "bis", test: (h) => /(?<!-)\bbis\b(?!-)/i.test(h) },
];

export function detectPdpMarkers(html: string): {
  hasBisCapture: boolean;
  hasSwym: boolean;
  markers: string[];
} {
  const markers = MARKER_CHECKS.filter((m) => m.test(html)).map((m) => m.id);
  return {
    hasBisCapture: markers.length > 0,
    hasSwym: markers.some((m) => m.startsWith("swym")),
    markers,
  };
}

/** Requirement "PDP marker sampling": products with ≥1 sold-out variant, highest
 * leakage (soldOut/total) first; ties broken by absolute sold-out count then handle for
 * determinism. */
export function selectPdpSampleCandidates(products: Product[], limit: number): Product[] {
  const withLeakage = products
    .map((p) => {
      const soldOut = p.variants.filter((v) => !v.available).length;
      const total = p.variants.length;
      return { product: p, soldOut, total, leakage: total > 0 ? soldOut / total : 0 };
    })
    .filter((x) => x.soldOut > 0);
  withLeakage.sort(
    (a, b) => b.leakage - a.leakage || b.soldOut - a.soldOut || a.product.handle.localeCompare(b.product.handle),
  );
  return withLeakage.slice(0, Math.max(0, limit)).map((x) => x.product);
}

/** Samples sold-out PDPs (highest leakage first) and detects back-in-stock capture
 * markers. Lane A. Online mode GETs each PDP once through the throttled/cached/robots-
 * aware http client; `offlineFixturesDir` mode reads `pdp.<handle>.html` from the
 * fixtures directory instead — the same `detectPdpMarkers` logic either way. A candidate
 * with no matching PDP fixture is simply skipped (the fixture set is a deliberately
 * bounded subset per tests/fixtures/README.md; `sampled.length` already reflects that,
 * no separate limit note is needed since `Findings.headline`/scorecard read the
 * denominator from `sampled.length`, not from the requested sample size). */
export async function samplePdpMarkers(
  snapshot: StoreSnapshot,
  opts: SamplePdpMarkersOptions = {},
): Promise<PdpMarkers> {
  const limit = opts.pdpSample ?? defaultConfig.limits.pdpSample;
  const candidates = selectPdpSampleCandidates(snapshot.products, limit);
  const sampled: PdpMarkers["sampled"] = [];

  if (opts.offlineFixturesDir) {
    for (const product of candidates) {
      const file = path.join(opts.offlineFixturesDir, `pdp.${product.handle}.html`);
      let html: string;
      try {
        html = await fs.readFile(file, "utf8");
      } catch {
        opts.onProgress?.("pdp sample", `${product.handle}: no fixture, skipped`);
        continue;
      }
      const markers = detectPdpMarkers(html);
      sampled.push({ handle: product.handle, url: product.url, ...markers });
      opts.onProgress?.("pdp sample", `${sampled.length}/${Math.min(limit, candidates.length)}`);
    }
    return { sampled };
  }

  const http = createHttp(defaultConfig, {
    cacheDir: opts.cacheDir,
    noCache: opts.noCache,
    onProgress: opts.onProgress,
  });
  for (const product of candidates) {
    // Real-world fix (Lane I): a single robots.txt-disallowed PDP (e.g. this store blocks
    // /products/all-products specifically) must not abort the whole sample — http.get()
    // throws ROBOTS_DISALLOWED as a hard error by design (it's a strict violation to fetch
    // a disallowed path at all), so check allowed() first and skip, same as the offline
    // path already does for a missing fixture file.
    if (!(await http.allowed(product.url))) {
      opts.onProgress?.("pdp sample", `${product.handle}: robots.txt disallows this PDP, skipped`);
      continue;
    }
    const res = await http.get(product.url);
    const markers = detectPdpMarkers(res.body);
    sampled.push({ handle: product.handle, url: product.url, ...markers });
    opts.onProgress?.("pdp sample", `${sampled.length}/${candidates.length}`);
  }
  return { sampled };
}
