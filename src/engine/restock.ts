/**
 * Restock Priority / Demand Leakage (task B.2). Pure, no I/O, no Date.now —
 * `now` is always passed in. Formulas per design.md §4 / PRD §3.1 exactly.
 */
import type { AvailabilityDelta, BeaconConfig, Collection, Product, RestockRow } from "../types.js";
import { clamp, median } from "./stats.js";

const RECENCY_FULL_DAYS = 14;
const RECENCY_ZERO_DAYS = 90;
const MAX_BREADTH_COLLECTIONS = 5;
const NON_MERCH_HANDLES = new Set(["all", "frontpage"]);

/** Days elapsed between `updatedAt` and `now`, floored to whole days, never negative. */
function daysSince(updatedAt: string, now: Date): number {
  const ms = now.getTime() - new Date(updatedAt).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** 1 within RECENCY_FULL_DAYS, linearly down to 0 at RECENCY_ZERO_DAYS, 0 after. */
function recencyComponent(updatedAt: string, now: Date): number {
  const days = daysSince(updatedAt, now);
  if (days <= RECENCY_FULL_DAYS) return 1;
  if (days >= RECENCY_ZERO_DAYS) return 0;
  return 1 - (days - RECENCY_FULL_DAYS) / (RECENCY_ZERO_DAYS - RECENCY_FULL_DAYS);
}

function discountedComponent(product: Product): number {
  const anyDiscounted = product.variants.some(
    (v) => v.compareAtPrice !== null && v.compareAtPrice > v.price,
  );
  return anyDiscounted ? 1 : 0;
}

function velocityComponent(product: Product, delta?: AvailabilityDelta): number {
  if (!delta) return 0;
  return delta.soldThrough.some((s) => s.handle === product.handle) ? 1 : 0;
}

/** Product's "real" collection memberships — excludes the catch-all all/frontpage buckets. */
function realCollections(product: Product): Product["collections"] {
  return product.collections.filter((c) => !NON_MERCH_HANDLES.has(c.handle));
}

type BestMerch = { title: string; position: number; score: number } | undefined;

/** Best (highest position-score) merchandised-collection membership, if any. */
function bestMerchMembership(
  product: Product,
  collectionsByHandle: Map<string, Collection>,
): BestMerch {
  let best: BestMerch;
  for (const membership of product.collections) {
    const collection = collectionsByHandle.get(membership.handle);
    if (!collection || !collection.isMerch || membership.size <= 0) continue;
    const score = 1 - membership.position / membership.size;
    if (!best || score > best.score) {
      best = { title: collection.title, position: membership.position, score };
    }
  }
  return best;
}

function buildReason(args: {
  soldOutVariants: number;
  totalVariants: number;
  soldOutVariantTitles: string[];
  bestMerch: BestMerch;
  days: number;
  discounted: boolean;
}): string {
  const { soldOutVariants, totalVariants, soldOutVariantTitles, bestMerch, days, discounted } = args;
  const titles = soldOutVariantTitles.slice(0, 3).join(", ");
  const soldOutPart = `${soldOutVariants}/${totalVariants} variants sold out (${titles})`;
  const merchPart = bestMerch
    ? `in ${bestMerch.title} at position ${bestMerch.position}`
    : "not in a merchandised collection";
  const recencyPart = `updated ${days}d ago`;
  const discountedPart = discounted ? "; discounted" : "";
  return `${soldOutPart}; ${merchPart}; ${recencyPart}${discountedPart}`;
}

/**
 * Computes one RestockRow for a product, or null when the product has no
 * sold-out variants (leakage 0 — those never appear in the restock table).
 */
export function computeRestockRow(
  product: Product,
  collectionsByHandle: Map<string, Collection>,
  config: BeaconConfig,
  catalogP90Price: number,
  now: Date,
  delta?: AvailabilityDelta,
): RestockRow | null {
  const totalVariants = product.variants.length;
  const soldOutVariants = product.variants.filter((v) => !v.available).length;
  if (totalVariants === 0 || soldOutVariants === 0) return null;

  const leakage = soldOutVariants / totalVariants;
  const soldOutVariantTitles = product.variants.filter((v) => !v.available).map((v) => v.title);

  const bestMerch = bestMerchMembership(product, collectionsByHandle);
  const inMerch = bestMerch ? 1 : 0;
  const position = bestMerch ? bestMerch.score : 0;
  const breadth = Math.min(realCollections(product).length, MAX_BREADTH_COLLECTIONS) / MAX_BREADTH_COLLECTIONS;
  const recency = recencyComponent(product.updatedAt, now);
  const discounted = discountedComponent(product);
  const velocity = velocityComponent(product, delta);

  const { weights } = config;
  const demandProxy =
    weights.inMerch * inMerch +
    weights.position * position +
    weights.breadth * breadth +
    weights.recency * recency -
    weights.discounted * discounted +
    weights.velocity * velocity;

  const medianPrice = median(product.variants.map((v) => v.price));
  const priceFactor =
    catalogP90Price > 0 && medianPrice >= 0
      ? clamp(Math.log1p(medianPrice) / Math.log1p(catalogP90Price), 0, 1)
      : 0;

  const restockPriority = demandProxy * leakage * (0.5 + 0.5 * priceFactor);

  const reason = buildReason({
    soldOutVariants,
    totalVariants,
    soldOutVariantTitles,
    bestMerch,
    days: daysSince(product.updatedAt, now),
    discounted: discounted === 1,
  });

  return {
    handle: product.handle,
    title: product.title,
    url: product.url,
    soldOutVariants,
    totalVariants,
    leakage,
    soldOutVariantTitles,
    demandProxy,
    components: { inMerch, position, breadth, recency, discounted, velocity },
    priceFactor,
    medianPrice,
    restockPriority,
    rank: 0, // assigned by the caller after sorting the full set
    reason,
  };
}

/** Sorts restock rows by restockPriority desc, ties by leakage desc then medianPrice desc, and assigns rank. */
export function rankRestockRows(rows: RestockRow[]): RestockRow[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.restockPriority - a.restockPriority || b.leakage - a.leakage || b.medianPrice - a.medianPrice,
  );
  sorted.forEach((row, i) => {
    row.rank = i + 1;
  });
  return sorted;
}
