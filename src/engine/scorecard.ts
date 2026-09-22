/**
 * Journey scorecard (task B.3): the eight Findings, in the fixed order the spec
 * requires. Pure, no I/O. Severities come from `config.thresholds` per
 * design.md §5: `[low, high]` percentage thresholds, value 0 -> "none",
 * 0 < value < low -> "low", low <= value < high -> "medium", value >= high -> "high".
 * `soldOutTopN` / `soldOutInTopCount` are absolute counts, same shape.
 */
import type { BeaconConfig, Collection, Finding, PdpMarkers, Product, StoreSnapshot } from "../types.js";
import { RECOMMENDATIONS, noIssueRecommendation } from "./recommendations.js";
import {
  coreSizes,
  findSizeOption,
  isSizeSoldOut,
  orderSizeValues,
  variantsBySizeValue,
} from "./size-curve.js";

type Severity = Finding["severity"];

const NON_MERCH_HANDLES = new Set(["all", "frontpage"]);
const COLOUR_OPTION_RE = /colou?r/i;
const MAX_EXAMPLES = 5;

function severityFromValue(value: number, [low, high]: readonly [number, number]): Severity {
  if (value <= 0) return "none";
  if (value < low) return "low";
  if (value < high) return "medium";
  return "high";
}

function severityFromPct(count: number, denominator: number, thresholds: readonly [number, number]): Severity {
  if (denominator <= 0) return "none";
  return severityFromValue((count / denominator) * 100, thresholds);
}

function realCollections(product: Product): Product["collections"] {
  return product.collections.filter((c) => !NON_MERCH_HANDLES.has(c.handle));
}

function recommendationFor(check: string, severity: Severity, title: string): string {
  if (severity === "none") return noIssueRecommendation(title);
  return RECOMMENDATIONS[check] ?? noIssueRecommendation(title);
}

// ---------------------------------------------------------------------------
// discovery/orphan-products
// ---------------------------------------------------------------------------
function orphanProductsFinding(snapshot: StoreSnapshot, config: BeaconConfig): Finding {
  const denominator = snapshot.products.length;
  const orphans = snapshot.products.filter((p) => realCollections(p).length === 0);
  const count = orphans.length;
  const severity = severityFromPct(count, denominator, config.thresholds.orphanPct);
  const title = "Products with no collection placement";
  return {
    stage: "discovery",
    check: "orphan-products",
    title,
    severity,
    count,
    denominator,
    examples: orphans.slice(0, MAX_EXAMPLES).map((p) => ({
      title: p.title,
      url: p.url,
      note: "not found in any recorded collection",
    })),
    recommendation: recommendationFor("discovery/orphan-products", severity, title),
    evidence:
      "products.json cross-referenced against collections/<handle>/products.json for every recorded collection, excluding `all`/`frontpage`",
  };
}

// ---------------------------------------------------------------------------
// discovery/sold-out-in-top-positions
// ---------------------------------------------------------------------------
function soldOutInTopPositionsFinding(
  snapshot: StoreSnapshot,
  collectionsByHandle: Map<string, Collection>,
  config: BeaconConfig,
): Finding {
  const topN = config.thresholds.soldOutTopN;
  const flagged: { product: Product; position: number; collectionTitle: string }[] = [];
  for (const product of snapshot.products) {
    const total = product.variants.length;
    const soldOut = product.variants.filter((v) => !v.available).length;
    const fullySoldOut = total > 0 && soldOut === total;
    if (!fullySoldOut) continue;
    for (const membership of product.collections) {
      const collection = collectionsByHandle.get(membership.handle);
      if (collection?.isMerch && membership.position <= topN) {
        flagged.push({ product, position: membership.position, collectionTitle: collection.title });
        break;
      }
    }
  }
  const count = flagged.length;
  const severity = severityFromValue(count, config.thresholds.soldOutInTopCount);
  const title = "Sold-out products in top collection positions";
  return {
    stage: "discovery",
    check: "sold-out-in-top-positions",
    title,
    severity,
    count,
    denominator: null,
    examples: flagged.slice(0, MAX_EXAMPLES).map((f) => ({
      title: f.product.title,
      url: f.product.url,
      note: `position ${f.position} in ${f.collectionTitle}, fully sold out`,
    })),
    recommendation: recommendationFor("discovery/sold-out-in-top-positions", severity, title),
    evidence: `collection.<handle>.json position index for fully sold-out products, top ${topN} positions of any merchandised collection`,
  };
}

// ---------------------------------------------------------------------------
// pdp/low-image-count
// ---------------------------------------------------------------------------
function lowImageCountFinding(snapshot: StoreSnapshot, config: BeaconConfig): Finding {
  const denominator = snapshot.products.length;
  const low = snapshot.products.filter((p) => p.imageCount < 2);
  const count = low.length;
  const severity = severityFromPct(count, denominator, config.thresholds.lowImagePct);
  const title = "Product pages with fewer than 2 images";
  return {
    stage: "pdp",
    check: "low-image-count",
    title,
    severity,
    count,
    denominator,
    examples: low.slice(0, MAX_EXAMPLES).map((p) => ({
      title: p.title,
      url: p.url,
      note: `${p.imageCount} image${p.imageCount === 1 ? "" : "s"}`,
    })),
    recommendation: recommendationFor("pdp/low-image-count", severity, title),
    evidence: "products.json `images[]` length per product",
  };
}

// ---------------------------------------------------------------------------
// pdp/short-description
// ---------------------------------------------------------------------------
function shortDescriptionFinding(snapshot: StoreSnapshot, config: BeaconConfig): Finding {
  const denominator = snapshot.products.length;
  const short = snapshot.products.filter((p) => p.descriptionChars < 200);
  const count = short.length;
  const severity = severityFromPct(count, denominator, config.thresholds.shortDescPct);
  const title = "Product pages with a short description";
  return {
    stage: "pdp",
    check: "short-description",
    title,
    severity,
    count,
    denominator,
    examples: short.slice(0, MAX_EXAMPLES).map((p) => ({
      title: p.title,
      url: p.url,
      note: `${p.descriptionChars} characters`,
    })),
    recommendation: recommendationFor("pdp/short-description", severity, title),
    evidence: "products.json `body_html` stripped to text, length in characters",
  };
}

// ---------------------------------------------------------------------------
// pdp/colour-variants-without-image
// ---------------------------------------------------------------------------
function colourVariantsWithoutImageFinding(snapshot: StoreSnapshot, config: BeaconConfig): Finding {
  const colourProducts = snapshot.products.filter((p) => p.options.some((o) => COLOUR_OPTION_RE.test(o.name)));
  const denominator = colourProducts.length;
  const flagged = colourProducts.filter((p) => p.variants.some((v) => !v.hasOwnImage));
  const count = flagged.length;
  // Reuses lowImagePct: design.md §5's threshold config has no dedicated key for
  // this check, and it's the same "missing image" family as pdp/low-image-count.
  // Logged as D-06 in docs/decisions-during-build.md.
  const severity = severityFromPct(count, denominator, config.thresholds.lowImagePct);
  const title = "Colour variants missing their own image";
  return {
    stage: "pdp",
    check: "colour-variants-without-image",
    title,
    severity,
    count,
    denominator,
    examples: flagged.slice(0, MAX_EXAMPLES).map((p) => {
      const missing = p.variants.filter((v) => !v.hasOwnImage).length;
      return {
        title: p.title,
        url: p.url,
        note: `${missing} of ${p.variants.length} variants missing their own image`,
      };
    }),
    recommendation:
      denominator === 0
        ? "No action — this catalogue has no colour-option products to check."
        : recommendationFor("pdp/colour-variants-without-image", severity, title),
    evidence: "products.json option named Colour/Color; variant `featured_image` presence (`hasOwnImage`)",
  };
}

// ---------------------------------------------------------------------------
// variant/core-sizes-sold-out
// ---------------------------------------------------------------------------
function coreSizesSoldOutFinding(snapshot: StoreSnapshot, config: BeaconConfig): Finding {
  const candidates: { product: Product; soldOutCore: string[] }[] = [];
  let denominator = 0;
  for (const product of snapshot.products) {
    const sizeOption = findSizeOption(product);
    if (!sizeOption) continue;
    denominator += 1;
    const ordered = orderSizeValues(sizeOption.values);
    const core = coreSizes(ordered);
    const bySize = variantsBySizeValue(product, sizeOption);
    const soldOutCore = core.filter((size) => isSizeSoldOut(bySize.get(size) ?? []));
    if (soldOutCore.length > 0) candidates.push({ product, soldOutCore });
  }
  const count = candidates.length;
  const severity = severityFromPct(count, denominator, config.thresholds.coreSizeOutPct);
  const title = "Core pack sizes sold out";
  return {
    stage: "variant",
    check: "core-sizes-sold-out",
    title,
    severity,
    count,
    denominator,
    examples: candidates.slice(0, MAX_EXAMPLES).map((c) => ({
      title: c.product.title,
      url: c.product.url,
      note: `core sizes ${c.soldOutCore.join(", ")} sold out`,
    })),
    recommendation: recommendationFor("variant/core-sizes-sold-out", severity, title),
    evidence: "products.json size option values, ordered; middle 50% checked for sold-out",
  };
}

// ---------------------------------------------------------------------------
// intent-capture/sold-out-without-capture
// ---------------------------------------------------------------------------
function soldOutWithoutCaptureFinding(markers: PdpMarkers, config: BeaconConfig): Finding {
  const denominator = markers.sampled.length;
  const title = "Sold-out PDPs with no back-in-stock capture";
  if (denominator === 0) {
    return {
      stage: "intent-capture",
      check: "sold-out-without-capture",
      title,
      severity: "none",
      count: 0,
      denominator: 0,
      examples: [],
      recommendation: "No sold-out PDPs were sampled on this run, so intent-capture coverage could not be checked.",
      evidence: "no sold-out products to sample (markers.sampled is empty)",
    };
  }
  const lacking = markers.sampled.filter((m) => !m.hasBisCapture);
  const count = lacking.length;
  const severity = severityFromPct(count, denominator, config.thresholds.noCapturePct);
  return {
    stage: "intent-capture",
    check: "sold-out-without-capture",
    title,
    severity,
    count,
    denominator,
    examples: lacking.slice(0, MAX_EXAMPLES).map((m) => ({
      title: m.handle,
      url: m.url,
    })),
    recommendation: recommendationFor("intent-capture/sold-out-without-capture", severity, title),
    evidence:
      "PDP HTML sampled for highest-leakage sold-out products; searched for swym/back in stock/notify me/restock/klaviyo-bis/bis markers",
  };
}

// ---------------------------------------------------------------------------
// trust/policies
// ---------------------------------------------------------------------------
function policiesFinding(snapshot: StoreSnapshot): Finding {
  const { shipping, refund, linkedFromHome } = snapshot.policies;
  const entries: { name: string; value: boolean | null }[] = [
    { name: "shipping", value: shipping },
    { name: "refund", value: refund },
  ];

  let hasConfirmedFalse = false;
  let hasUnlinkedTrue = false;
  let hasUnchecked = false;
  let okCount = 0;
  const problems: string[] = [];

  for (const entry of entries) {
    if (entry.value === false) {
      hasConfirmedFalse = true;
      problems.push(`${entry.name} policy page fetched and did not return 200`);
    } else if (entry.value === null) {
      hasUnchecked = true;
      problems.push(`${entry.name} policy not checked (robots.txt disallows)`);
    } else if (entry.value === true && !linkedFromHome) {
      hasUnlinkedTrue = true;
      problems.push(`${entry.name} policy page present but not linked from the homepage`);
    } else {
      okCount += 1;
    }
  }

  let severity: Severity;
  if (hasConfirmedFalse) severity = "high";
  else if (hasUnlinkedTrue) severity = "medium";
  else if (hasUnchecked) severity = "low";
  else severity = "none";

  const denominator = entries.length;
  const count = denominator - okCount;
  const title = "Shipping / refund policy verification";

  let recommendation: string;
  if (severity === "high") recommendation = RECOMMENDATIONS["trust/policies/high"] ?? "";
  else if (severity === "medium") recommendation = RECOMMENDATIONS["trust/policies/medium"] ?? "";
  else if (severity === "low") recommendation = RECOMMENDATIONS["trust/policies/low"] ?? "";
  else recommendation = noIssueRecommendation(title);

  const evidence = hasUnchecked
    ? `robots.txt disallows /policies/* (and /*/policies/*) for User-agent: *, so the shipping/refund policy pages were not fetched (${problems.join("; ")}); linkedFromHome=${linkedFromHome}`
    : `policies.shipping=${String(shipping)}, policies.refund=${String(refund)}, linkedFromHome=${linkedFromHome}${problems.length ? ` (${problems.join("; ")})` : ""}`;

  return {
    stage: "trust",
    check: "policies",
    title,
    severity,
    count,
    denominator,
    examples: [],
    recommendation,
    evidence,
  };
}

/** Builds all eight scorecard Findings, in the fixed order the spec requires. */
export function buildScorecard(
  snapshot: StoreSnapshot,
  markers: PdpMarkers,
  config: BeaconConfig,
): Finding[] {
  const collectionsByHandle = new Map(snapshot.collections.map((c) => [c.handle, c]));
  return [
    orphanProductsFinding(snapshot, config),
    soldOutInTopPositionsFinding(snapshot, collectionsByHandle, config),
    lowImageCountFinding(snapshot, config),
    shortDescriptionFinding(snapshot, config),
    colourVariantsWithoutImageFinding(snapshot, config),
    coreSizesSoldOutFinding(snapshot, config),
    soldOutWithoutCaptureFinding(markers, config),
    policiesFinding(snapshot),
  ];
}
