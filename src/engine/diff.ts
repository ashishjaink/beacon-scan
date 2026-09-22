/**
 * `diff(a, b)` -> AvailabilityDelta (task B.5, P1). Pure comparison of two
 * snapshots: which variants sold through or restocked, which products are new
 * or gone, matched by product handle + variant id. No I/O, no Date.now.
 */
import type { AvailabilityDelta, StoreSnapshot } from "../types.js";

export function diff(a: StoreSnapshot, b: StoreSnapshot): AvailabilityDelta {
  const aByHandle = new Map(a.products.map((p) => [p.handle, p]));
  const bByHandle = new Map(b.products.map((p) => [p.handle, p]));

  const soldThrough: { handle: string; variantTitle: string }[] = [];
  const restocked: { handle: string; variantTitle: string }[] = [];

  for (const bProduct of b.products) {
    const aProduct = aByHandle.get(bProduct.handle);
    if (!aProduct) continue;
    const aVariantsById = new Map(aProduct.variants.map((v) => [v.id, v]));
    for (const bVariant of bProduct.variants) {
      const aVariant = aVariantsById.get(bVariant.id);
      if (!aVariant) continue;
      if (aVariant.available && !bVariant.available) {
        soldThrough.push({ handle: bProduct.handle, variantTitle: bVariant.title });
      } else if (!aVariant.available && bVariant.available) {
        restocked.push({ handle: bProduct.handle, variantTitle: bVariant.title });
      }
    }
  }

  const newProducts = b.products.filter((p) => !aByHandle.has(p.handle)).map((p) => p.handle);
  const removedProducts = a.products.filter((p) => !bByHandle.has(p.handle)).map((p) => p.handle);

  return {
    fromFetchedAt: a.fetchedAt,
    toFetchedAt: b.fetchedAt,
    soldThrough,
    restocked,
    newProducts,
    removedProducts,
  };
}
