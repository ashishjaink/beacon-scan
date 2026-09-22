# Design — beacon-mvp

This file is the contract between parallel lanes. Lane 0 commits `src/types.ts` exactly as §2 before any other lane starts. Changing a type = changing this file first.

## 1. Repo layout
```
beacon-scan/
  package.json  tsconfig.json  vitest.config.ts  .gitignore  LICENSE (MIT)
  beacon.config.json              # weights + regexes + limits (§5)
  src/
    index.ts                      # §10 public library API (the SDK seam)
    cli.ts                        # commander wiring only; calls src/index.ts
    types.ts                      # §2, zod schemas + inferred types
    errors.ts                     # BeaconError
    collector/
      http.ts                     # throttled fetch, cache, robots, backoff
      shopify.ts                  # pagination + normalise → StoreSnapshot
      pdp-markers.ts              # sample sold-out PDPs → PdpMarkers
      index.ts                    # collect(url, opts) | collectOffline(fixturesDir)
    engine/
      restock.ts                  # RestockRow[]
      scorecard.ts                # Finding[] for the five stages
      size-curve.ts               # size option detection + core-size logic
      diff.ts                     # P1: snapshot A vs B → AvailabilityDelta
      index.ts                    # analyse(snapshot, markers, config) → Findings
    report/
      csv.ts  html.ts  terminal.ts  index.ts
  tests/
    fixtures/<store-host>/...     # recorded by Lane 0
    collector.test.ts engine.test.ts report.test.ts e2e.test.ts
  docs/                           # PRD.md theses.md part2-*.md part3-*.md ai-workflow/
  openspec/
  WO-BEACON-01.md
  out/ .cache/                    # gitignored, except out/EXAMPLE/ (one committed real run)
```

## 2. Types (`src/types.ts`) — verbatim contract
```ts
import { z } from "zod";

export const Variant = z.object({
  id: z.number(), title: z.string(),
  option1: z.string().nullable(), option2: z.string().nullable(), option3: z.string().nullable(),
  price: z.number(),                       // parsed from string
  compareAtPrice: z.number().nullable(),
  available: z.boolean(),
  hasOwnImage: z.boolean(),                // featured_image != null
});
export const Product = z.object({
  id: z.number(), handle: z.string(), title: z.string(), url: z.string(),
  vendor: z.string().optional(), productType: z.string().optional(),
  tags: z.array(z.string()),
  options: z.array(z.object({ name: z.string(), position: z.number(), values: z.array(z.string()) })),
  variants: z.array(Variant),
  imageCount: z.number(),
  descriptionChars: z.number(),            // stripped body_html length
  updatedAt: z.string(), publishedAt: z.string().nullable(),
  collections: z.array(z.object({ handle: z.string(), position: z.number(), size: z.number() })),
});
export const Collection = z.object({
  handle: z.string(), title: z.string(), productsCount: z.number(),
  isMerch: z.boolean(),                    // handle/title matches config.merchCollectionRegex
});
export const StoreSnapshot = z.object({
  schemaVersion: z.literal(1),
  store: z.object({ host: z.string(), name: z.string().optional(), currency: z.string().optional() }),
  fetchedAt: z.string(),                   // ISO
  products: z.array(Product),
  collections: z.array(Collection),
  policies: z.object({ shipping: z.boolean(), refund: z.boolean(), linkedFromHome: z.boolean() }),
  stats: z.object({ requests: z.number(), cacheHits: z.number(), durationMs: z.number() }),
});
export const PdpMarkers = z.object({
  sampled: z.array(z.object({ handle: z.string(), url: z.string(), hasBisCapture: z.boolean(), hasSwym: z.boolean(), markers: z.array(z.string()) })),
});

export const RestockRow = z.object({
  handle: z.string(), title: z.string(), url: z.string(),
  soldOutVariants: z.number(), totalVariants: z.number(), leakage: z.number(),
  soldOutVariantTitles: z.array(z.string()),
  demandProxy: z.number(),
  components: z.object({ inMerch: z.number(), position: z.number(), breadth: z.number(), recency: z.number(), discounted: z.number(), velocity: z.number() }),
  priceFactor: z.number(), medianPrice: z.number(),
  restockPriority: z.number(),             // 0..1
  rank: z.number(),
  reason: z.string(),                      // one human sentence built from components
});
export const Finding = z.object({
  stage: z.enum(["discovery", "pdp", "variant", "intent-capture", "trust"]),
  check: z.string(),                       // machine id e.g. "orphan-products"
  title: z.string(),
  severity: z.enum(["high", "medium", "low", "none"]),
  count: z.number(), denominator: z.number().nullable(),
  examples: z.array(z.object({ title: z.string(), url: z.string(), note: z.string().optional() })).max(5),
  recommendation: z.string(),
  evidence: z.string(),                    // which fields/endpoints
});
export const Findings = z.object({
  schemaVersion: z.literal(1),
  store: StoreSnapshot.shape.store, generatedAt: z.string(), snapshotFetchedAt: z.string(),
  headline: z.object({ productsScanned: z.number(), variantsSoldOut: z.number(), variantsTotal: z.number(), productsLeakingOnMerch: z.number(), soldOutPdpsWithoutCapture: z.number().nullable() }),
  restock: z.array(RestockRow),            // sorted by rank, all products with leakage>0
  scorecard: z.array(Finding),             // ≥1 per stage (severity "none" allowed)
  methodology: z.object({ weights: z.record(z.number()), limits: z.array(z.string()) }),
  delta: z.any().optional(),               // P1 AvailabilityDelta
});
export type Variant = z.infer<typeof Variant>; /* …same for every schema… */
```

## 3. CLI contract
```
beacon scan <storeUrl> [--max-products 800] [--pdp-sample 20] [--out out] [--no-cache] [--offline --fixtures <dir>]
   → writes out/<host>/<ts>/{snapshot.json,pdp-markers.json,findings.json,restock_priority.csv,report.html}
   → prints terminal summary; exit 0. Exit 1 with hint on NOT_SHOPIFY | ENDPOINT_DISABLED | RATE_LIMITED | ROBOTS_DISALLOWED.
beacon report <runDir>          → regenerates csv/html/terminal from findings.json
beacon diff <runDirA> <runDirB> → (P1) prints flips; writes delta.json into runDirB and re-renders its report with velocity
```
Progress to stderr, one line per phase: `collect products 3/4 pages`, `collections 27`, `pdp sample 12/20`, `analyse`, `report`.

## 4. Engine rules (deterministic, testable)
- Sold out: `variant.available === false`. Product leakage = soldOut/total.
- Merch collection: `config.merchCollectionRegex` on handle OR title (default `/best|top|trending|featured|popular|new|most-loved|favou?rites?/i`). Excludes `all`, `frontpage`.
- `position` component: for each merch collection containing the product, `1 - position/size`; take max. 0 if none.
- `recency`: days since `updatedAt`; 1 if ≤14, linear to 0 at 90, 0 after.
- `discounted`: 1 if any variant `compareAtPrice > price`.
- `velocity`: 0 unless delta present; 1 if any variant flipped available→sold-out between runs.
- `priceFactor = log1p(medianPrice)/log1p(catalogP90)` clamped 0..1.
- `restockPriority = demandProxy * leakage * (0.5 + 0.5*priceFactor)`; rank desc; ties by leakage then medianPrice.
- `reason` template: "{soldOut}/{total} variants sold out ({titles ≤3}); in {merchName} at position {p}; updated {d}d ago{; discounted}".
- Size option detection: option name matches `/size|sz|waist/i` OR values ⊂ known set (XXS…5XL, numeric 20–60, UK/US/EU numeric). Core sizes = middle 50% of ordered values (order as given by the store).
- Scorecard severities: thresholds in config (`orphanPct`, `soldOutTopN`, `lowImagePct`, `shortDescPct`, `coreSizeOutPct`, `noCapturePct`). Each check emits exactly one Finding, `severity:"none"` when below low threshold; `count`/`denominator` always filled.
- Intent-capture finding: denominator = PDPs sampled; if 0 sampled (no sold-out products) → severity none, note it.
- Trust finding: high if either policy missing; medium if present but not linked from home; none otherwise.

## 5. `beacon.config.json`
```json
{ "weights": { "inMerch": 0.35, "position": 0.25, "breadth": 0.15, "recency": 0.15, "discounted": 0.10, "velocity": 0.20 },
  "merchCollectionRegex": "best|top|trending|featured|popular|new|most-loved|favou?rites?",
  "thresholds": { "orphanPct": [5, 15], "soldOutTopN": 8, "soldOutInTopCount": [1, 3], "lowImagePct": [10, 25], "shortDescPct": [10, 25], "coreSizeOutPct": [10, 25], "noCapturePct": [20, 50] },
  "http": { "rps": 2, "concurrency": 2, "maxRetries": 4, "timeoutMs": 15000, "userAgent": "beacon-scan/0.1 (+https://github.com/<owner>/beacon-scan)" },
  "limits": { "maxProducts": 800, "pdpSample": 20 } }
```
`[low, high]` thresholds are percentages of the check's denominator. Severity: value 0 → `none`; 0 < value < low → `low`; low ≤ value < high → `medium`; value ≥ high → `high`. `soldOutInTopCount` is an absolute count with the same shape.

## 6. HTML report (single file, ≤150 KB, no external requests)
Sections in order: (1) header — store, fetched at, "public data only" badge; (2) three headline tiles — variants sold out / total, products leaking on merch collections, sold-out PDPs without capture (or "not sampled"); (3) Restock Priority table top 15 with expandable component bars (CSS only) and the `reason`; (4) Journey scorecard — five rows, severity chip, count, ≤3 example links, recommendation; (5) Methodology & limits — weights, thresholds, assumptions A1–A5, "index not currency"; (6) footer — run stats, version. Print stylesheet. Dark/light via `prefers-color-scheme`.

## 7. Terminal summary
Three headline lines, then a `cli-table3` of the top 10 restock rows (rank, title ≤40 chars, sold-out/total, priority, top reason) and a one-line per-stage scorecard with severity.

## 8. Fixtures mode
`collectOffline(dir)` reads the same files `http.ts` would have cached (`products.page1.json`…, `collections.json`, `collection.<handle>.json`, `robots.txt`, `home.html`, `pdp.<handle>.html`, `policies.shipping.status`, `policies.refund.status`) so the collector code path is identical minus the network.

## 9. Diff (P1)
`AvailabilityDelta = { fromFetchedAt, toFetchedAt, soldThrough: {handle, variantTitle}[], restocked: {...}[], newProducts: string[], removedProducts: string[] }`. Second run's engine takes the delta and sets `components.velocity`.

## 10. Library surface (`src/index.ts`) — the SDK seam
```ts
export type ScanOptions = { maxProducts?: number; pdpSample?: number; cacheDir?: string; noCache?: boolean;
                            offlineFixturesDir?: string; config?: Partial<BeaconConfig>; now?: () => Date;
                            onProgress?: (phase: string, detail?: string) => void };
export type ScanResult  = { snapshot: StoreSnapshot; markers: PdpMarkers; findings: Findings };
export async function scanStore(storeUrl: string, opts?: ScanOptions): Promise<ScanResult>;
export function analyseSnapshot(snapshot: StoreSnapshot, markers: PdpMarkers, config?: Partial<BeaconConfig>, delta?: AvailabilityDelta): Findings;
export function diffSnapshots(a: StoreSnapshot, b: StoreSnapshot): AvailabilityDelta;
export function renderReport(findings: Findings): { html: string; csv: string; terminal: string };
export * from "./types.js";
```
Rules: no `process.exit`, no console output, no file writes inside `src/index.ts` and below (the CLI does I/O). `package.json`: `"name": "beacon-scan"`, `"type": "module"`, `"bin": {"beacon": "dist/cli.js"}`, `"exports": {".": "./dist/index.js"}`, `"types": "dist/index.d.ts"`. No API keys, auth or tenancy anywhere (PRD N7); the README shows a 5-line programmatic example and states that keys/tenancy are a Part 2 design item.
