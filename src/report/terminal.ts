import Table from "cli-table3";
import type { Finding, Findings } from "../types.js";

const MAX_COLUMNS = 100;

const STAGE_ORDER: Finding["stage"][] = ["discovery", "pdp", "variant", "intent-capture", "trust"];
const STAGE_LABEL: Record<Finding["stage"], string> = {
  discovery: "Discovery",
  pdp: "PDP",
  variant: "Variant selection",
  "intent-capture": "Intent capture",
  trust: "Trust / checkout",
};
const SEVERITY_RANK: Record<Finding["severity"], number> = { high: 3, medium: 2, low: 1, none: 0 };
const SEVERITY_LABEL: Record<Finding["severity"], string> = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
  none: "NONE",
};

function fmtIndex(n: number, decimals = 3): string {
  return Number.isFinite(n) ? n.toFixed(decimals) : "0".padEnd(decimals + 2, "0");
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  if (max <= 1) return str.slice(0, max);
  return str.slice(0, max - 1) + "…";
}

/** Picks, per stage, the finding with the highest severity (ties broken by first occurrence). */
function worstPerStage(findings: Finding[]): Map<Finding["stage"], { worst: Finding; count: number }> {
  const map = new Map<Finding["stage"], { worst: Finding; count: number }>();
  for (const f of findings) {
    const existing = map.get(f.stage);
    if (!existing) {
      map.set(f.stage, { worst: f, count: 1 });
    } else {
      existing.count += 1;
      if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[existing.worst.severity]) {
        existing.worst = f;
      }
    }
  }
  return map;
}

/**
 * Renders the ≤100-column terminal summary: three headline lines, a top-10 restock table,
 * and one line per journey-scorecard stage with its severity. All priority/leakage figures
 * are explicitly labelled as indices, never currency.
 */
export function toTerminal(findings: Findings): string {
  const lines: string[] = [];
  const { headline, store } = findings;

  lines.push(`Beacon Friction Scan — ${store.host} (public data only, generated ${findings.generatedAt})`);
  lines.push("");

  // Three headline numbers (PRD §3.3).
  lines.push(
    `${headline.variantsSoldOut}/${headline.variantsTotal} variants sold out across ${headline.productsScanned} products scanned`,
  );
  lines.push(`${headline.productsLeakingOnMerch} products leaking demand on merchandised collections`);
  lines.push(
    headline.soldOutPdpsWithoutCapture === null
      ? "Intent-capture check: not sampled (no sold-out PDPs to sample)"
      : `${headline.soldOutPdpsWithoutCapture} sold-out PDPs sampled with no back-in-stock capture`,
  );
  lines.push("");

  // Top-10 restock table. Restock Priority is a demand-leakage index (0..1), never currency.
  lines.push("Restock Priority — top 10 (index, not currency)");
  const top10 = findings.restock.slice(0, 10);
  if (top10.length === 0) {
    lines.push("  No products currently show demand leakage — nothing sold out on a tracked product.");
  } else {
    const table = new Table({
      head: ["#", "Title", "Sold/Tot", "Idx", "Top reason"],
      colWidths: [4, 34, 10, 8, 34],
      wordWrap: false,
      style: { head: [], border: [] },
    });
    for (const row of top10) {
      table.push([
        String(row.rank),
        row.title,
        `${row.soldOutVariants}/${row.totalVariants}`,
        fmtIndex(row.restockPriority),
        row.reason,
      ]);
    }
    lines.push(table.toString());
  }
  lines.push("");

  // One line per journey-scorecard stage.
  lines.push("Journey scorecard (severity per stage):");
  const byStage = worstPerStage(findings.scorecard);
  for (const stage of STAGE_ORDER) {
    const label = STAGE_LABEL[stage].padEnd(18);
    const entry = byStage.get(stage);
    if (!entry) {
      lines.push(truncate(`  ${label}[N/A]   no check recorded for this stage`, MAX_COLUMNS));
      continue;
    }
    const { worst, count } = entry;
    const sevTag = `[${SEVERITY_LABEL[worst.severity]}]`.padEnd(7);
    const countStr = worst.denominator === null ? `${worst.count}` : `${worst.count}/${worst.denominator}`;
    const suffix = count > 1 ? ` (worst of ${count} checks)` : "";
    const line = `  ${label}${sevTag}${worst.title} (${countStr})${suffix}`;
    lines.push(truncate(line, MAX_COLUMNS));
  }

  return lines.join("\n") + "\n";
}
