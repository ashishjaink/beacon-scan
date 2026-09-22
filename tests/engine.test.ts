import { describe, expect, it } from "vitest";
import { analyse } from "../src/engine/index.js";
import { diff } from "../src/engine/diff.js";
import { collectOffline } from "../src/collector/index.js";
import {
  Collection,
  PdpMarkers,
  Product,
  StoreSnapshot,
  Variant,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Test fixtures / builders — minimal, schema-shaped objects, not tied to any
// one store. Defaults are deliberately "no issue" so each test only needs to
// override the fields that make its scenario true.
// ---------------------------------------------------------------------------

let variantIdCounter = 1;
function makeVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: variantIdCounter++,
    title: "Default Title",
    option1: "Default Title",
    option2: null,
    option3: null,
    price: 500,
    compareAtPrice: null,
    available: true,
    hasOwnImage: true,
    ...overrides,
  };
}

let productIdCounter = 1;
function makeProduct(overrides: Partial<Product> = {}): Product {
  const handle = overrides.handle ?? `product-${productIdCounter}`;
  const id = productIdCounter++;
  return {
    id,
    handle,
    title: overrides.title ?? "Test Product",
    url: `https://example-store.test/products/${handle}`,
    tags: [],
    options: [],
    variants: [makeVariant()],
    imageCount: 3,
    descriptionChars: 300,
    updatedAt: "2026-09-19T00:00:00.000Z",
    publishedAt: "2026-01-01T00:00:00.000Z",
    collections: [],
    ...overrides,
  };
}

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    handle: "collection",
    title: "Collection",
    productsCount: 10,
    isMerch: false,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<StoreSnapshot> = {}): StoreSnapshot {
  return {
    schemaVersion: 1,
    store: { host: "example-store.test", name: "Example Store", currency: "USD" },
    fetchedAt: "2026-09-22T10:00:00.000Z",
    products: [],
    collections: [],
    policies: { shipping: true, refund: true, linkedFromHome: true },
    stats: { requests: 0, cacheHits: 0, durationMs: 0 },
    ...overrides,
  };
}

function makeMarkers(overrides: Partial<PdpMarkers> = {}): PdpMarkers {
  return { sampled: [], ...overrides };
}

const NOW = () => new Date("2026-09-22T00:00:00.000Z");

// ---------------------------------------------------------------------------
// Requirement: Restock priority ranking
// ---------------------------------------------------------------------------

describe("Restock priority ranking", () => {
  it("Merchandised product half sold out: exact component values, above a weaker equal-price product", () => {
    const productA = makeProduct({
      handle: "product-a",
      variants: [
        makeVariant({ available: false, title: "S" }),
        makeVariant({ available: false, title: "M" }),
        makeVariant({ available: false, title: "L" }),
        makeVariant({ available: false, title: "XL" }),
        makeVariant({ available: true, title: "XXL" }),
        makeVariant({ available: true, title: "XXXL" }),
        makeVariant({ available: true, title: "4XL" }),
        makeVariant({ available: true, title: "5XL" }),
      ], // 4 of 8 sold out -> leakage 0.5, all price 500 -> medianPrice 500
      updatedAt: "2026-09-19T00:00:00.000Z", // 3 days before NOW()
      collections: [
        { handle: "best-sellers", position: 2, size: 40 },
        { handle: "new-arrivals", position: 5, size: 20 },
        { handle: "subscriptions", position: 1, size: 10 },
      ], // 3 collections -> breadth 3/5 = 0.6
    });

    // Weaker product at equal price: leakage <= 0.5, demandProxy well under 0.8275
    // (not merchandised, single collection, stale).
    const productB = makeProduct({
      handle: "product-b",
      variants: [
        makeVariant({ available: false }),
        makeVariant({ available: false }),
        makeVariant({ available: true }),
        makeVariant({ available: true }),
      ], // leakage 0.5, medianPrice 500 (same price as A)
      updatedAt: "2026-07-24T00:00:00.000Z", // 60 days before NOW()
      collections: [{ handle: "misc", position: 9, size: 50 }], // breadth 1/5 = 0.2, not merch
    });

    const snapshot = makeSnapshot({
      products: [productA, productB],
      collections: [makeCollection({ handle: "best-sellers", title: "Bestsellers", isMerch: true })],
    });

    const findings = analyse(snapshot, makeMarkers(), undefined, undefined, NOW);

    const rowA = findings.restock.find((r) => r.handle === "product-a")!;
    const rowB = findings.restock.find((r) => r.handle === "product-b")!;
    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();

    expect(rowA.leakage).toBeCloseTo(0.5, 10);
    expect(rowA.components.inMerch).toBe(1);
    expect(rowA.components.position).toBeCloseTo(0.95, 10); // 1 - 2/40
    expect(rowA.components.breadth).toBeCloseTo(0.6, 10); // 3/5
    expect(rowA.components.recency).toBe(1); // 3 days <= 14
    expect(rowA.components.discounted).toBe(0);
    expect(rowA.components.velocity).toBe(0);
    expect(rowA.demandProxy).toBeCloseTo(0.35 + 0.2375 + 0.09 + 0.15, 10); // 0.8275

    // B has leakage <= 0.5 and demandProxy well below 0.8275 at equal price -> A ranks above B.
    expect(rowB.leakage).toBeLessThanOrEqual(0.5);
    expect(rowB.demandProxy).toBeLessThan(0.8275);
    expect(rowB.medianPrice).toBe(rowA.medianPrice);
    expect(rowA.restockPriority).toBeGreaterThan(rowB.restockPriority);
    expect(rowA.rank).toBeLessThan(rowB.rank);

    // Bonus: headline should count product A (in a merch collection, leaking) but not B.
    expect(findings.headline.productsLeakingOnMerch).toBe(1);
  });

  it("No stock-outs anywhere: restock is empty and headline.variantsSoldOut is 0", () => {
    const snapshot = makeSnapshot({
      products: [
        makeProduct({ handle: "a", variants: [makeVariant({ available: true }), makeVariant({ available: true })] }),
        makeProduct({ handle: "b", variants: [makeVariant({ available: true })] }),
      ],
    });

    const findings = analyse(snapshot, makeMarkers(), undefined, undefined, NOW);

    expect(findings.restock).toEqual([]);
    expect(findings.headline.variantsSoldOut).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Requirement: Headline numbers
// ---------------------------------------------------------------------------

describe("Headline numbers", () => {
  it("Nothing sampled: headline.soldOutPdpsWithoutCapture is null", () => {
    const snapshot = makeSnapshot({
      products: [makeProduct({ handle: "a", variants: [makeVariant({ available: false })] })],
    });

    const findings = analyse(snapshot, makeMarkers({ sampled: [] }), undefined, undefined, NOW);

    expect(findings.headline.soldOutPdpsWithoutCapture).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Requirement: Journey scorecard
// ---------------------------------------------------------------------------

describe("Journey scorecard", () => {
  it("Orphans: 30 of 300 products in no collection other than all/frontpage -> count 30, denominator 300, severity medium", () => {
    const products: Product[] = [];
    for (let i = 0; i < 300; i++) {
      const isOrphan = i < 30;
      products.push(
        makeProduct({
          handle: `p${i}`,
          collections: isOrphan
            ? [{ handle: "all", position: i + 1, size: 300 }]
            : [{ handle: "everything", position: i + 1, size: 270 }],
        }),
      );
    }
    const snapshot = makeSnapshot({ products });

    const findings = analyse(snapshot, makeMarkers(), undefined, undefined, NOW);
    const finding = findings.scorecard.find((f) => f.check === "orphan-products")!;

    expect(finding.count).toBe(30);
    expect(finding.denominator).toBe(300);
    expect(finding.severity).toBe("medium"); // 10% is within default [5,15)
    expect(finding.examples.length).toBeLessThanOrEqual(5);
  });

  it("Core sizes out: [XS,S,M,L,XL,XXL] with M and L sold out -> note 'core sizes M, L sold out'", () => {
    const sizeProduct = makeProduct({
      handle: "hoodie-sizes",
      options: [{ name: "Size", position: 1, values: ["XS", "S", "M", "L", "XL", "XXL"] }],
      variants: [
        makeVariant({ option1: "XS", available: true }),
        makeVariant({ option1: "S", available: true }),
        makeVariant({ option1: "M", available: false }),
        makeVariant({ option1: "L", available: false }),
        makeVariant({ option1: "XL", available: true }),
        makeVariant({ option1: "XXL", available: true }),
      ],
    });
    const snapshot = makeSnapshot({ products: [sizeProduct] });

    const findings = analyse(snapshot, makeMarkers(), undefined, undefined, NOW);
    const finding = findings.scorecard.find((f) => f.check === "core-sizes-sold-out")!;

    expect(finding.count).toBe(1);
    expect(finding.denominator).toBe(1);
    const example = finding.examples.find((e) => e.url.includes("hoodie-sizes"))!;
    expect(example).toBeDefined();
    expect(example.note).toBe("core sizes M, L sold out");
  });

  it("Colour-option product with missing variant images: 2 of 5 variants lacking hasOwnImage counts toward the check", () => {
    const colourProduct = makeProduct({
      handle: "tee-colours",
      options: [{ name: "Color", position: 1, values: ["Black", "White", "Red", "Blue", "Green"] }],
      variants: [
        makeVariant({ option1: "Black", hasOwnImage: true }),
        makeVariant({ option1: "White", hasOwnImage: true }),
        makeVariant({ option1: "Red", hasOwnImage: false }),
        makeVariant({ option1: "Blue", hasOwnImage: false }),
        makeVariant({ option1: "Green", hasOwnImage: true }),
      ],
    });
    const snapshot = makeSnapshot({ products: [colourProduct] });

    const findings = analyse(snapshot, makeMarkers(), undefined, undefined, NOW);
    const finding = findings.scorecard.find((f) => f.check === "colour-variants-without-image")!;

    expect(finding.denominator).toBe(1); // one colour-option product in this snapshot
    expect(finding.count).toBe(1);
  });

  it("Capture present via Swym: 12 sampled, 3 lacking capture -> count 3, denominator 12, severity medium, mentions back-in-stock capture", () => {
    const sampled = Array.from({ length: 12 }, (_, i) => ({
      handle: `sold-out-${i}`,
      url: `https://example-store.test/products/sold-out-${i}`,
      hasBisCapture: i >= 3, // first 3 lack capture
      hasSwym: false,
      markers: i >= 3 ? ["notify me"] : [],
    }));
    const snapshot = makeSnapshot({
      products: [makeProduct({ handle: "sold-out-0", variants: [makeVariant({ available: false })] })],
    });

    const findings = analyse(snapshot, makeMarkers({ sampled }), undefined, undefined, NOW);
    const finding = findings.scorecard.find((f) => f.check === "sold-out-without-capture")!;

    expect(finding.count).toBe(3);
    expect(finding.denominator).toBe(12);
    expect(finding.severity).toBe("medium"); // 25% within default [20,50)
    expect(finding.recommendation.toLowerCase()).toContain("back-in-stock");
  });

  it("Trust policies (D-02): both null (robots.txt disallowed) -> severity low, evidence names robots.txt, recommendation mentions bots/agents", () => {
    const snapshot = makeSnapshot({
      policies: { shipping: null, refund: null, linkedFromHome: true },
    });

    const findings = analyse(snapshot, makeMarkers(), undefined, undefined, NOW);
    const finding = findings.scorecard.find((f) => f.check === "policies")!;

    expect(finding.severity).toBe("low");
    expect(finding.evidence.toLowerCase()).toContain("robots.txt");
    expect(finding.recommendation.toLowerCase()).toContain("agent");
  });

  it("Trust policies: a confirmed-missing policy (false) is severity high", () => {
    const snapshot = makeSnapshot({
      policies: { shipping: false, refund: true, linkedFromHome: true },
    });

    const findings = analyse(snapshot, makeMarkers(), undefined, undefined, NOW);
    const finding = findings.scorecard.find((f) => f.check === "policies")!;

    expect(finding.severity).toBe("high");
  });

  it("Trust policies: both true and linked from home is severity none", () => {
    const snapshot = makeSnapshot({
      policies: { shipping: true, refund: true, linkedFromHome: true },
    });

    const findings = analyse(snapshot, makeMarkers(), undefined, undefined, NOW);
    const finding = findings.scorecard.find((f) => f.check === "policies")!;

    expect(finding.severity).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Requirement: Methodology block
// ---------------------------------------------------------------------------

describe("Methodology block", () => {
  it("Truncated catalogue: methodology.limits contains a line starting with 'catalogue truncated at'", () => {
    const products = Array.from({ length: 5 }, (_, i) => makeProduct({ handle: `p${i}` }));
    const snapshot = makeSnapshot({ products });

    const findings = analyse(
      snapshot,
      makeMarkers(),
      { limits: { maxProducts: 5, pdpSample: 20 } },
      undefined,
      NOW,
    );

    expect(findings.methodology.limits.some((l) => l.startsWith("catalogue truncated at"))).toBe(true);
  });

  it("copies the effective weights into methodology.weights and lists assumptions A1-A5", () => {
    const snapshot = makeSnapshot({ products: [makeProduct()] });
    const findings = analyse(snapshot, makeMarkers(), undefined, undefined, NOW);

    expect(findings.methodology.weights.inMerch).toBeCloseTo(0.35, 10);
    expect(findings.methodology.limits.some((l) => l.startsWith("A1:"))).toBe(true);
    expect(findings.methodology.limits.some((l) => l.startsWith("A5:"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Requirement: Availability delta (P1)
// ---------------------------------------------------------------------------

describe("Availability delta (P1)", () => {
  it("Variant sells through: hoodie M/Black flips available -> sold out, and velocity becomes 1 in the next analyse()", () => {
    const variantId = 999;
    const hoodieA = makeProduct({
      handle: "hoodie",
      variants: [makeVariant({ id: variantId, title: "M / Black", available: true })],
    });
    const hoodieB = makeProduct({
      handle: "hoodie",
      variants: [makeVariant({ id: variantId, title: "M / Black", available: false })],
    });

    const snapshotA = makeSnapshot({ fetchedAt: "2026-09-20T00:00:00.000Z", products: [hoodieA] });
    const snapshotB = makeSnapshot({ fetchedAt: "2026-09-21T00:00:00.000Z", products: [hoodieB] });

    const delta = diff(snapshotA, snapshotB);
    expect(delta.soldThrough).toContainEqual({ handle: "hoodie", variantTitle: "M / Black" });
    expect(delta.restocked).toEqual([]);
    expect(delta.fromFetchedAt).toBe("2026-09-20T00:00:00.000Z");
    expect(delta.toFetchedAt).toBe("2026-09-21T00:00:00.000Z");

    const findings = analyse(snapshotB, makeMarkers(), undefined, delta, NOW);
    const hoodieRow = findings.restock.find((r) => r.handle === "hoodie")!;
    expect(hoodieRow.components.velocity).toBe(1);
  });

  it("new and removed products are reported by handle", () => {
    const a = makeSnapshot({ products: [makeProduct({ handle: "keeps" }), makeProduct({ handle: "removed" })] });
    const b = makeSnapshot({ products: [makeProduct({ handle: "keeps" }), makeProduct({ handle: "new" })] });

    const delta = diff(a, b);
    expect(delta.newProducts).toEqual(["new"]);
    expect(delta.removedProducts).toEqual(["removed"]);
  });
});

// ---------------------------------------------------------------------------
// Requirement: Determinism
// ---------------------------------------------------------------------------

describe("Determinism", () => {
  // Lane I: Lane A's collectOffline() has landed — using the real collector path
  // (fixtures -> normalisation -> StoreSnapshot) instead of Lane B's original
  // local-normaliser placeholder, so this test now exercises the same code path
  // `scanStore({ offlineFixturesDir })` does.
  const FIXTURES_DIR = new URL("./fixtures/bluetokaicoffee.com", import.meta.url).pathname;

  it("is schema-valid and produces byte-identical findings (excluding generatedAt) on repeated runs", async () => {
    const snapshot = await collectOffline(FIXTURES_DIR);
    expect(() => StoreSnapshot.parse(snapshot)).not.toThrow();
    expect(snapshot.products.length).toBe(190); // real recorded fixture, sanity check

    const markers = makeMarkers();

    const first = analyse(snapshot, markers) as any;
    const second = analyse(snapshot, markers) as any;

    delete first.generatedAt;
    delete second.generatedAt;

    expect(first).toEqual(second);
  });
});
