import { BeaconError } from "../errors.js";
import type { Collection, Product, Variant } from "../types.js";
import type { HttpClient } from "./http.js";

/**
 * Raw Shopify storefront JSON shapes (subset of fields we actually read). Deliberately
 * loose/`unknown`-tolerant beyond this — these are the fetch/JSON.parse boundary per
 * project.md's "no `any` except at the fetch boundary" convention; everything past
 * `normaliseProduct`/`normaliseCollection`/`normaliseVariant` is strictly typed.
 */
export interface RawVariant {
  id: number;
  title: string;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  price: string | number;
  compare_at_price?: string | number | null;
  available?: boolean;
  featured_image?: unknown;
}

export interface RawOption {
  name: string;
  position?: number;
  values?: string[];
}

export interface RawProduct {
  id: number;
  handle: string;
  title: string;
  body_html?: string | null;
  vendor?: string | null;
  product_type?: string | null;
  tags?: string[] | string;
  options?: RawOption[];
  variants?: RawVariant[];
  images?: unknown[];
  updated_at: string;
  published_at?: string | null;
}

export interface RawCollection {
  handle: string;
  title: string;
  products_count?: number;
}

/** Strips HTML tags and decodes the handful of entities Shopify's `body_html` commonly
 * contains, then collapses whitespace. Good enough for a description-length signal; not
 * a full HTML parser. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  const noTags = html.replace(/<[^>]*>/g, " ");
  const decoded = noTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'");
  return decoded.replace(/\s+/g, " ").trim();
}

function parsePrice(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

export function normaliseVariant(raw: RawVariant): Variant {
  return {
    id: raw.id,
    title: raw.title,
    option1: raw.option1 ?? null,
    option2: raw.option2 ?? null,
    option3: raw.option3 ?? null,
    price: parsePrice(raw.price),
    compareAtPrice: raw.compare_at_price == null ? null : parsePrice(raw.compare_at_price),
    available: raw.available === true,
    hasOwnImage: raw.featured_image != null,
  };
}

function normaliseTags(tags: RawProduct["tags"]): string[] {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

/** Maps one raw `/products.json` entry to a `Product` with `collections: []` — collection
 * membership is a cross-cutting concern (one product can be in many collections) and is
 * filled in afterwards by `applyCollectionMembership`. Shared verbatim by `collect()` and
 * `collectOffline()` so both paths normalise identically. */
export function normaliseProduct(raw: RawProduct, host: string): Product {
  return {
    id: raw.id,
    handle: raw.handle,
    title: raw.title,
    url: `https://${host}/products/${raw.handle}`,
    vendor: raw.vendor || undefined,
    productType: raw.product_type || undefined,
    tags: normaliseTags(raw.tags),
    options: Array.isArray(raw.options)
      ? raw.options.map((o, i) => ({
          name: o.name,
          position: o.position ?? i + 1,
          values: Array.isArray(o.values) ? o.values : [],
        }))
      : [],
    variants: Array.isArray(raw.variants) ? raw.variants.map(normaliseVariant) : [],
    imageCount: Array.isArray(raw.images) ? raw.images.length : 0,
    descriptionChars: stripHtml(raw.body_html).length,
    updatedAt: raw.updated_at,
    publishedAt: raw.published_at ?? null,
    collections: [],
  };
}

/** design.md §4: merch-collection regex on handle OR title; `all`/`frontpage` never
 * count even if they happen to match the regex. */
export function computeIsMerch(handle: string, title: string, regexSource: string): boolean {
  if (handle === "all" || handle === "frontpage") return false;
  const re = new RegExp(regexSource, "i");
  return re.test(handle) || re.test(title);
}

export function normaliseCollection(raw: RawCollection, merchCollectionRegex: string): Collection {
  return {
    handle: raw.handle,
    title: raw.title,
    productsCount: raw.products_count ?? 0,
    isMerch: computeIsMerch(raw.handle, raw.title, merchCollectionRegex),
  };
}

/** Adds a `{handle, position, size}` collection-membership entry to every product whose
 * handle appears in `productHandlesInOrder` (1-based position = array order, which is the
 * collection's sort order per Shopify's `/collections/<handle>/products.json`). Pure —
 * returns a new array, used identically by the online and offline collection passes. */
export function applyCollectionMembership(
  products: Product[],
  collectionHandle: string,
  productHandlesInOrder: string[],
  size: number,
): Product[] {
  if (productHandlesInOrder.length === 0) return products;
  const positionByHandle = new Map<string, number>();
  productHandlesInOrder.forEach((handle, i) => positionByHandle.set(handle, i + 1));
  return products.map((p) => {
    const position = positionByHandle.get(p.handle);
    if (position === undefined) return p;
    return { ...p, collections: [...p.collections, { handle: collectionHandle, position, size }] };
  });
}

const NOT_SHOPIFY_HINT =
  "This does not look like a Shopify storefront. Try one of the PRD §6 fallbacks instead: gymshark.com or allbirds.com.";

/** Requirement "Shopify detection": GET `/products.json?limit=1` and validate the shape;
 * on 403/404, fall back to checking the homepage for `cdn.shopify.com` to distinguish
 * "not Shopify" from "is Shopify, but this endpoint is disabled". Throws, never returns
 * a value — a clean pass is silent. */
export async function detectShopify(http: HttpClient, host: string): Promise<void> {
  const productsUrl = `https://${host}/products.json?limit=1`;
  let status: number;
  let body: string;
  try {
    const res = await http.get(productsUrl);
    status = res.status;
    body = res.body;
  } catch (err) {
    if (err instanceof BeaconError) throw err;
    throw new BeaconError(
      "NOT_SHOPIFY",
      `Could not reach ${productsUrl}: ${(err as Error).message}`,
      NOT_SHOPIFY_HINT,
    );
  }

  if (status === 403 || status === 404) {
    let homeHtml = "";
    try {
      const home = await http.get(`https://${host}/`);
      homeHtml = home.body;
    } catch {
      // fall through with homeHtml === "" — treated as "can't confirm Shopify"
    }
    if (/cdn\.shopify\.com/i.test(homeHtml)) {
      throw new BeaconError(
        "ENDPOINT_DISABLED",
        `${productsUrl} returned ${status} though the store runs on Shopify (cdn.shopify.com found on the homepage).`,
        "The storefront JSON API appears disabled for this store; try a different host from the PRD §6 shortlist.",
      );
    }
    throw new BeaconError("NOT_SHOPIFY", `${productsUrl} returned ${status}.`, NOT_SHOPIFY_HINT);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  const hasProductsArray =
    !!parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).products);
  if (!hasProductsArray) {
    throw new BeaconError(
      "NOT_SHOPIFY",
      `${productsUrl} did not return a JSON object with a products array.`,
      NOT_SHOPIFY_HINT,
    );
  }
}

const PAGE_LIMIT = 250;

/** Pages `/products.json?limit=250&page=N`. Stops on an empty page OR a short page
 * (fewer than `limit` items — the standard "this was the last page" signal, and the only
 * reading consistent with the store-collector spec's own "612 products → 3 product page
 * requests" example: 250+250+112 stops right after the 112-item page, no confirmatory
 * 4th empty-page fetch). Truncates at `maxProducts` and reports it via `truncated`. */
export async function fetchAllProducts(
  http: HttpClient,
  host: string,
  maxProducts: number,
  onProgress?: (phase: string, detail?: string) => void,
): Promise<{ raw: RawProduct[]; truncated: boolean; pagesFetched: number }> {
  const raw: RawProduct[] = [];
  let page = 1;
  let truncated = false;
  for (;;) {
    const res = await http.get(`https://${host}/products.json?limit=${PAGE_LIMIT}&page=${page}`);
    const parsed = JSON.parse(res.body) as { products?: RawProduct[] };
    const batch = Array.isArray(parsed.products) ? parsed.products : [];
    onProgress?.("collect", `products page ${page} (${batch.length})`);
    if (batch.length === 0) break;
    for (const p of batch) {
      if (raw.length >= maxProducts) {
        truncated = true;
        break;
      }
      raw.push(p);
    }
    if (truncated || batch.length < PAGE_LIMIT) break;
    page++;
  }
  return { raw, truncated, pagesFetched: page };
}

/** Pages `/collections.json?limit=250&page=N` with the same short-page stop rule as
 * products. */
export async function fetchAllCollections(
  http: HttpClient,
  host: string,
  onProgress?: (phase: string, detail?: string) => void,
): Promise<RawCollection[]> {
  const collections: RawCollection[] = [];
  let page = 1;
  for (;;) {
    const res = await http.get(`https://${host}/collections.json?limit=${PAGE_LIMIT}&page=${page}`);
    const parsed = JSON.parse(res.body) as { collections?: RawCollection[] };
    const batch = Array.isArray(parsed.collections) ? parsed.collections : [];
    onProgress?.("collect", `collections page ${page} (${batch.length})`);
    if (batch.length === 0) break;
    collections.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
    page++;
  }
  return collections;
}

/**
 * Requirement "Robots and rate limits" — Scenario "Disallowed path": fetches every
 * collection's `/collections/<handle>/products.json` (paginated), skipping any whose path
 * robots.txt disallows for `*`. If every collection is skipped for that reason, every
 * product ends up with `collections: []` (nothing ever gets applied), matching the
 * scenario exactly; the aggregated limit note reflects however many were actually
 * skipped, not the whole set when only some were.
 */
export async function fetchCollectionMembership(
  http: HttpClient,
  host: string,
  collectionsRaw: RawCollection[],
  onProgress?: (phase: string, detail?: string) => void,
): Promise<{ byCollection: Map<string, { order: string[]; size: number }>; limits: string[] }> {
  const byCollection = new Map<string, { order: string[]; size: number }>();
  let robotsSkipped = 0;
  let i = 0;
  for (const c of collectionsRaw) {
    i++;
    const basePath = `https://${host}/collections/${c.handle}/products.json`;
    const ok = await http.allowed(`${basePath}?limit=${PAGE_LIMIT}&page=1`);
    if (!ok) {
      robotsSkipped++;
      continue;
    }
    const handles: string[] = [];
    let page = 1;
    for (;;) {
      const res = await http.get(`${basePath}?limit=${PAGE_LIMIT}&page=${page}`);
      const parsed = JSON.parse(res.body) as { products?: { handle: string }[] };
      const batch = Array.isArray(parsed.products) ? parsed.products : [];
      for (const p of batch) handles.push(p.handle);
      if (batch.length < PAGE_LIMIT) break;
      page++;
    }
    byCollection.set(c.handle, { order: handles, size: c.products_count ?? handles.length });
    onProgress?.("collect", `collection ${i}/${collectionsRaw.length} ${c.handle}`);
  }
  const limits: string[] = [];
  if (robotsSkipped > 0) {
    if (robotsSkipped === collectionsRaw.length) {
      limits.push("collection positions unavailable (robots.txt)");
    } else {
      limits.push(
        `collection positions unavailable for ${robotsSkipped}/${collectionsRaw.length} collections (robots.txt)`,
      );
    }
  }
  return { byCollection, limits };
}

/** Single boolean per design.md §2 — true if the homepage links/mentions either policy
 * page. (The schema has one `linkedFromHome` flag, not one per policy.) */
export function detectPolicyLinks(homeHtml: string): boolean {
  return /shipping-policy/i.test(homeHtml) || /refund-policy/i.test(homeHtml);
}

/** Shared by `collect()` and `collectOffline()`: turns the allowed/blocked state of the
 * two policy paths into the `methodology.limits`-style note(s) D-02 requires. */
export function policyLimitNotes(shippingAllowed: boolean, refundAllowed: boolean): string[] {
  if (shippingAllowed && refundAllowed) return [];
  if (!shippingAllowed && !refundAllowed) {
    return ["shipping and refund policies not checked (robots.txt disallows /policies/ for *)"];
  }
  const notes: string[] = [];
  if (!shippingAllowed) notes.push("shipping policy not checked (robots.txt disallows this path for *)");
  if (!refundAllowed) notes.push("refund policy not checked (robots.txt disallows this path for *)");
  return notes;
}
