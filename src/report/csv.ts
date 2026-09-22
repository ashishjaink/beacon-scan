import type { Findings } from "../types.js";

const HEADER = [
  "rank",
  "handle",
  "title",
  "url",
  "sold_out_variants",
  "total_variants",
  "leakage",
  "demand_proxy",
  "price_factor",
  "restock_priority",
  "sold_out_variant_titles",
  "reason",
] as const;

/** RFC 4180 field quoting: quote when the field contains a comma, quote, or line break. */
function csvField(raw: string): string {
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/** Rounds an index value to 4 decimal places and strips floating-point noise/trailing zeros. */
function numField(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 10000) / 10000;
  return String(rounded);
}

/**
 * Renders restock_priority.csv: one row per RestockRow, RFC 4180 quoted.
 * All leakage/demand/priority figures are unitless indices, never currency.
 */
export function toCsv(findings: Findings): string {
  const lines: string[] = [HEADER.join(",")];

  for (const row of findings.restock) {
    const fields = [
      String(row.rank),
      row.handle,
      row.title,
      row.url,
      String(row.soldOutVariants),
      String(row.totalVariants),
      numField(row.leakage),
      numField(row.demandProxy),
      numField(row.priceFactor),
      numField(row.restockPriority),
      row.soldOutVariantTitles.join("; "),
      row.reason,
    ].map(csvField);
    lines.push(fields.join(","));
  }

  // RFC 4180 uses CRLF line endings, including a trailing CRLF after the last record.
  return lines.join("\r\n") + "\r\n";
}
