/**
 * Recommendation copy for every scorecard check, in one place (task B.3). Keyed
 * by `"<stage>/<check>"` to match `Finding.check`'s machine id convention. The
 * `trust/policies` check is the one exception with more than one possible cause
 * (confirmed-missing vs not-linked vs not-checked because robots.txt disallows
 * it — see docs/decisions-during-build.md D-02), so it gets three sub-keys
 * instead of a single string; scorecard.ts picks the right one by severity.
 *
 * Every entry is an index/count recommendation — never a currency figure
 * (WO hard rule #7).
 */

export const RECOMMENDATIONS: Record<string, string> = {
  "discovery/orphan-products":
    "Add these products to at least one collection shoppers actually browse — a product outside every collection can only be found via search or a direct link.",

  "discovery/sold-out-in-top-positions":
    "Reorder the collection grid so a fully sold-out product isn't the first thing a shopper sees, or restock it before the next campaign send.",

  "pdp/low-image-count":
    "Add a second product image — single-image PDPs read as unfinished and convert worse than pages with multiple angles.",

  "pdp/short-description":
    "Expand the description past a couple of sentences — a description under 200 characters gives a shopper nothing to justify the price or answer basic questions.",

  "pdp/colour-variants-without-image":
    "Add a dedicated image for every colour variant — a shopper choosing colour from a swatch with no matching photo is guessing, not deciding.",

  "variant/core-sizes-sold-out":
    "Prioritise restocking the middle sizes first — the smallest and largest sizes selling through last is normal; the middle going out isn't.",

  "intent-capture/sold-out-without-capture":
    "Turn on a back-in-stock signup on these PDPs — a sold-out page with no capture mechanism loses that shopper's intent for good.",

  "trust/policies/high":
    "One of your shipping/refund policy pages did not return a working page when checked directly — fix or republish it. A missing policy page is a trust gap right before checkout.",

  "trust/policies/medium":
    "Link your shipping/refund policy pages from the homepage (footer is fine) — a policy page that exists but isn't discoverable from the homepage still reads as unverified trust.",

  "trust/policies/low":
    "This store's robots.txt disallows /policies/*, so a compliant scanner — and any AI shopping agent or price-comparison tool that honours robots.txt — can't verify your shipping/refund terms programmatically. Consider allowing those two specific paths if you want that trust signal visible to automated buyers.",
};

/** Generic "nothing to fix" copy for a check that came back severity "none". */
export function noIssueRecommendation(title: string): string {
  return `No action needed — ${title.charAt(0).toLowerCase()}${title.slice(1)} found no issues on this run.`;
}
