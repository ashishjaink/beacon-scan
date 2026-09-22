import { z } from "zod";

export const Variant = z.object({
  id: z.number(),
  title: z.string(),
  option1: z.string().nullable(),
  option2: z.string().nullable(),
  option3: z.string().nullable(),
  price: z.number(), // parsed from string
  compareAtPrice: z.number().nullable(),
  available: z.boolean(),
  hasOwnImage: z.boolean(), // featured_image != null
});

export const Product = z.object({
  id: z.number(),
  handle: z.string(),
  title: z.string(),
  url: z.string(),
  vendor: z.string().optional(),
  productType: z.string().optional(),
  tags: z.array(z.string()),
  options: z.array(
    z.object({ name: z.string(), position: z.number(), values: z.array(z.string()) }),
  ),
  variants: z.array(Variant),
  imageCount: z.number(),
  descriptionChars: z.number(), // stripped body_html length
  updatedAt: z.string(),
  publishedAt: z.string().nullable(),
  collections: z.array(
    z.object({ handle: z.string(), position: z.number(), size: z.number() }),
  ),
});

export const Collection = z.object({
  handle: z.string(),
  title: z.string(),
  productsCount: z.number(),
  isMerch: z.boolean(), // handle/title matches config.merchCollectionRegex
});

export const StoreSnapshot = z.object({
  schemaVersion: z.literal(1),
  store: z.object({ host: z.string(), name: z.string().optional(), currency: z.string().optional() }),
  fetchedAt: z.string(), // ISO
  products: z.array(Product),
  collections: z.array(Collection),
  policies: z.object({
    // null = not checked (e.g. robots.txt disallows /policies/* for this store) — distinct
    // from a confirmed-missing page. See docs/decisions-during-build.md.
    shipping: z.boolean().nullable(),
    refund: z.boolean().nullable(),
    linkedFromHome: z.boolean(),
  }),
  stats: z.object({ requests: z.number(), cacheHits: z.number(), durationMs: z.number() }),
});

export const PdpMarkers = z.object({
  sampled: z.array(
    z.object({
      handle: z.string(),
      url: z.string(),
      hasBisCapture: z.boolean(),
      hasSwym: z.boolean(),
      markers: z.array(z.string()),
    }),
  ),
});

export const RestockRow = z.object({
  handle: z.string(),
  title: z.string(),
  url: z.string(),
  soldOutVariants: z.number(),
  totalVariants: z.number(),
  leakage: z.number(),
  soldOutVariantTitles: z.array(z.string()),
  demandProxy: z.number(),
  components: z.object({
    inMerch: z.number(),
    position: z.number(),
    breadth: z.number(),
    recency: z.number(),
    discounted: z.number(),
    velocity: z.number(),
  }),
  priceFactor: z.number(),
  medianPrice: z.number(),
  restockPriority: z.number(), // 0..1
  rank: z.number(),
  reason: z.string(), // one human sentence built from components
});

export const Finding = z.object({
  stage: z.enum(["discovery", "pdp", "variant", "intent-capture", "trust"]),
  check: z.string(), // machine id e.g. "orphan-products"
  title: z.string(),
  severity: z.enum(["high", "medium", "low", "none"]),
  count: z.number(),
  denominator: z.number().nullable(),
  examples: z
    .array(z.object({ title: z.string(), url: z.string(), note: z.string().optional() }))
    .max(5),
  recommendation: z.string(),
  evidence: z.string(), // which fields/endpoints
});

export const AvailabilityDelta = z.object({
  fromFetchedAt: z.string(),
  toFetchedAt: z.string(),
  soldThrough: z.array(z.object({ handle: z.string(), variantTitle: z.string() })),
  restocked: z.array(z.object({ handle: z.string(), variantTitle: z.string() })),
  newProducts: z.array(z.string()),
  removedProducts: z.array(z.string()),
});

export const Findings = z.object({
  schemaVersion: z.literal(1),
  store: StoreSnapshot.shape.store,
  generatedAt: z.string(),
  snapshotFetchedAt: z.string(),
  headline: z.object({
    productsScanned: z.number(),
    variantsSoldOut: z.number(),
    variantsTotal: z.number(),
    productsLeakingOnMerch: z.number(),
    soldOutPdpsWithoutCapture: z.number().nullable(),
  }),
  restock: z.array(RestockRow), // sorted by rank, all products with leakage>0
  scorecard: z.array(Finding), // ≥1 per stage (severity "none" allowed)
  methodology: z.object({ weights: z.record(z.number()), limits: z.array(z.string()) }),
  delta: z.any().optional(), // P1 AvailabilityDelta — see AvailabilityDelta schema below
});

export type Variant = z.infer<typeof Variant>;
export type Product = z.infer<typeof Product>;
export type Collection = z.infer<typeof Collection>;
export type StoreSnapshot = z.infer<typeof StoreSnapshot>;
export type PdpMarkers = z.infer<typeof PdpMarkers>;
export type RestockRow = z.infer<typeof RestockRow>;
export type Finding = z.infer<typeof Finding>;
export type AvailabilityDelta = z.infer<typeof AvailabilityDelta>;
export type Findings = z.infer<typeof Findings>;

export const BeaconConfig = z.object({
  weights: z.object({
    inMerch: z.number(),
    position: z.number(),
    breadth: z.number(),
    recency: z.number(),
    discounted: z.number(),
    velocity: z.number(),
  }),
  merchCollectionRegex: z.string(),
  thresholds: z.object({
    orphanPct: z.tuple([z.number(), z.number()]),
    soldOutTopN: z.number(),
    soldOutInTopCount: z.tuple([z.number(), z.number()]),
    lowImagePct: z.tuple([z.number(), z.number()]),
    shortDescPct: z.tuple([z.number(), z.number()]),
    coreSizeOutPct: z.tuple([z.number(), z.number()]),
    noCapturePct: z.tuple([z.number(), z.number()]),
  }),
  http: z.object({
    rps: z.number(),
    concurrency: z.number(),
    maxRetries: z.number(),
    timeoutMs: z.number(),
    userAgent: z.string(),
  }),
  limits: z.object({
    maxProducts: z.number(),
    pdpSample: z.number(),
  }),
});
export type BeaconConfig = z.infer<typeof BeaconConfig>;
