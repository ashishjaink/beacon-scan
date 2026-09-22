/**
 * Size-curve logic (task B.1): detect which product option is the "size" axis,
 * order its values sensibly (ordered known-size list, numeric fallback, else the
 * store's own order), and derive the "core" (middle 50%) sizes.
 *
 * Pure, no I/O. design.md §4: "Size option detection: option name matches
 * /size|sz|waist/i OR values ⊂ known set (XXS…5XL, numeric 20–60, UK/US/EU
 * numeric). Core sizes = middle 50% of ordered values."
 */
import type { Product, Variant } from "../types.js";

export type ProductOption = { name: string; position: number; values: string[] };

export const SIZE_OPTION_NAME_RE = /size|sz|waist/i;

/** Ordered known apparel size list, smallest to largest. */
const CANONICAL_SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];

/** Common alternate spellings that map onto the canonical tokens above. */
const SIZE_ALIASES: Record<string, string> = {
  XXL: "2XL",
  XXXL: "3XL",
  XXXXL: "4XL",
  XXXXXL: "5XL",
  "2X": "2XL",
  "3X": "3XL",
  "4X": "4XL",
  "5X": "5XL",
  "EXTRA SMALL": "XS",
  SMALL: "S",
  MEDIUM: "M",
  LARGE: "L",
  "EXTRA LARGE": "XL",
};

function normalizeToken(v: string): string {
  return v.trim().toUpperCase();
}

/** Index into CANONICAL_SIZE_ORDER, or -1 if not a known worded size. */
function canonicalSizeIndex(v: string): number {
  const token = normalizeToken(v);
  const mapped = SIZE_ALIASES[token] ?? token;
  return CANONICAL_SIZE_ORDER.indexOf(mapped);
}

export function isKnownSizeToken(v: string): boolean {
  return canonicalSizeIndex(v) !== -1;
}

/** Extracts the first numeric run from a value like "UK 6", "EU 40", "32". */
export function parseNumericToken(v: string): number | null {
  const match = v.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isNaN(n) ? null : n;
}

/**
 * True if this product option is the "size" axis: name matches the size regex,
 * or every value is a known worded size, or every value resolves numerically
 * (waist/UK/US/EU style). An option with no values is never a size option.
 */
export function isSizeOption(option: ProductOption): boolean {
  if (SIZE_OPTION_NAME_RE.test(option.name)) return true;
  if (option.values.length === 0) return false;
  if (option.values.every(isKnownSizeToken)) return true;
  return option.values.every((v) => parseNumericToken(v) !== null);
}

/** Finds the first option on a product that looks like a size axis, if any. */
export function findSizeOption(
  product: Pick<Product, "options">,
): ProductOption | undefined {
  return product.options.find(isSizeOption);
}

/**
 * Orders a size option's values: by the known-size list when every value is a
 * recognised worded size, numerically when every value parses as a number,
 * otherwise falls back to the order the store itself provided.
 */
export function orderSizeValues(values: string[]): string[] {
  if (values.length > 0 && values.every(isKnownSizeToken)) {
    return [...values].sort((a, b) => canonicalSizeIndex(a) - canonicalSizeIndex(b));
  }
  const numeric = values.map(parseNumericToken);
  if (values.length > 0 && numeric.every((n) => n !== null)) {
    return [...values].sort(
      (a, b) => (parseNumericToken(a) as number) - (parseNumericToken(b) as number),
    );
  }
  return [...values];
}

/**
 * Middle 50% of an ordered value list: trims round(n*0.25) items off each end.
 * For [XS,S,M,L,XL,XXL] (n=6) this trims 2 off each side, leaving [M,L] —
 * matching the spec's "Core sizes out" scenario exactly.
 */
export function coreSizes(orderedValues: string[]): string[] {
  const n = orderedValues.length;
  const trim = Math.round(n * 0.25);
  return orderedValues.slice(trim, n - trim);
}

function sizeValueOf(variant: Variant, position: number): string | null {
  if (position === 1) return variant.option1;
  if (position === 2) return variant.option2;
  if (position === 3) return variant.option3;
  return null;
}

/** Groups a product's variants by their value on the given size option. */
export function variantsBySizeValue(
  product: Pick<Product, "variants">,
  sizeOption: Pick<ProductOption, "position">,
): Map<string, Variant[]> {
  const map = new Map<string, Variant[]>();
  for (const variant of product.variants) {
    const value = sizeValueOf(variant, sizeOption.position);
    if (value === null) continue;
    const existing = map.get(value);
    if (existing) {
      existing.push(variant);
    } else {
      map.set(value, [variant]);
    }
  }
  return map;
}

/** A size value counts as sold out when every variant carrying it is unavailable. */
export function isSizeSoldOut(variantsForSize: Variant[]): boolean {
  return variantsForSize.length > 0 && variantsForSize.every((v) => !v.available);
}
