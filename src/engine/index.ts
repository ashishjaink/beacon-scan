/**
 * `analyse(snapshot, markers, config, delta?, now?)` -> Findings (task B.4).
 * Pure: no I/O, no Date.now() — `now` is always a parameter, defaulted to
 * `() => new Date()` only so callers don't have to pass it in production use;
 * every computation below threads `now()` through explicitly.
 */
import type { AvailabilityDelta, BeaconConfig, Findings, PdpMarkers, RestockRow, StoreSnapshot } from "../types.js";
import { mergeConfig } from "./default-config.js";
import { computeRestockRow, rankRestockRows } from "./restock.js";
import { buildScorecard } from "./scorecard.js";
import { percentile } from "./stats.js";

const ASSUMPTIONS = [
  "A1: public storefront JSON reflects live availability; can lag minutes behind actual stock",
  "A2: collection order approximates merchandising intent; bestseller-style handles approximate demand",
  "A3: a sold-out variant on a merchandised product is intent lost; we cannot see how much",
  "A4: detection of back-in-stock capture by HTML markers is approximate (themes vary)",
  "A5: assumes the reviewer runs on macOS/Linux with Node >=20",
];

export function analyse(
  snapshot: StoreSnapshot,
  markers: PdpMarkers,
  config?: Partial<BeaconConfig>,
  delta?: AvailabilityDelta,
  now: () => Date = () => new Date(),
): Findings {
  const cfg = mergeConfig(config);
  const nowDate = now();

  const catalogP90Price = percentile(
    snapshot.products.flatMap((p) => p.variants.map((v) => v.price)),
    0.9,
  );
  const collectionsByHandle = new Map(snapshot.collections.map((c) => [c.handle, c]));

  const restockRows: RestockRow[] = [];
  for (const product of snapshot.products) {
    const row = computeRestockRow(product, collectionsByHandle, cfg, catalogP90Price, nowDate, delta);
    if (row) restockRows.push(row);
  }
  const restock = rankRestockRows(restockRows);

  const scorecard = buildScorecard(snapshot, markers, cfg);

  const variantsTotal = snapshot.products.reduce((sum, p) => sum + p.variants.length, 0);
  const variantsSoldOut = snapshot.products.reduce(
    (sum, p) => sum + p.variants.filter((v) => !v.available).length,
    0,
  );
  const productsLeakingOnMerch = restock.filter((r) => r.components.inMerch === 1).length;
  const soldOutPdpsWithoutCapture =
    markers.sampled.length === 0 ? null : markers.sampled.filter((m) => !m.hasBisCapture).length;

  // Real collect()/collectOffline() output carries its own discovered limit notes
  // (robots-blocked paths, pagination truncation, the fixture-recording bound, policies
  // not checked) on a non-schema `collectorLimits` passthrough property — see Lane A's
  // decisions-during-build.md D-06. Prefer those verbatim when present (they're more
  // specific than anything the engine can re-derive); fall back to generic derived notes
  // for snapshots built by hand (tests, or any future caller that skips the collector).
  const collectorLimits = (snapshot as StoreSnapshot & { collectorLimits?: string[] }).collectorLimits;
  const limits: string[] = [
    "scores are indices, not currency: public storefront data carries no order-volume or revenue signal",
  ];
  if (collectorLimits && collectorLimits.length > 0) {
    limits.push(...collectorLimits);
  } else {
    if (snapshot.products.length >= cfg.limits.maxProducts) {
      limits.push(`catalogue truncated at ${cfg.limits.maxProducts} products (maxProducts limit reached)`);
    }
    if (snapshot.policies.shipping === null || snapshot.policies.refund === null) {
      limits.push(
        "trust/policies check could not verify one or both policy pages: robots.txt disallows /policies/* for bots on this store",
      );
    }
  }
  limits.push(...ASSUMPTIONS);

  return {
    schemaVersion: 1,
    store: snapshot.store,
    generatedAt: nowDate.toISOString(),
    snapshotFetchedAt: snapshot.fetchedAt,
    headline: {
      productsScanned: snapshot.products.length,
      variantsSoldOut,
      variantsTotal,
      productsLeakingOnMerch,
      soldOutPdpsWithoutCapture,
    },
    restock,
    scorecard,
    methodology: {
      weights: { ...cfg.weights },
      limits,
    },
  };
}
