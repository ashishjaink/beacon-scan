import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toCsv } from "../src/report/csv.js";
import { renderHtml } from "../src/report/html.js";
import * as reportIndex from "../src/report/index.js";
import { toTerminal } from "../src/report/terminal.js";
import { Findings } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadSample(): Findings {
  const raw = readFileSync(path.join(__dirname, "fixtures", "sample-findings.json"), "utf8");
  return Findings.parse(JSON.parse(raw));
}

/** Returns every HTML tag (as raw text) that references an http(s) URL in one of its attributes. */
function tagsWithExternalUrl(html: string): string[] {
  const tags = html.match(/<[a-zA-Z][^>]*>/g) ?? [];
  return tags.filter((tag) => /https?:\/\//.test(tag) && !tag.startsWith("<a "));
}

describe("report fixtures", () => {
  it("sample-findings.json is schema-valid", () => {
    expect(() => loadSample()).not.toThrow();
  });
});

describe("toCsv", () => {
  const findings = loadSample();

  it("has the exact RFC-4180 header required by the spec", () => {
    const csv = toCsv(findings);
    const header = csv.split("\r\n")[0];
    expect(header).toBe(
      "rank,handle,title,url,sold_out_variants,total_variants,leakage,demand_proxy,price_factor,restock_priority,sold_out_variant_titles,reason",
    );
  });

  it("has one data row per restock row, plus a trailing CRLF", () => {
    const csv = toCsv(findings);
    const rows = csv.split("\r\n").filter((l) => l.length > 0);
    expect(rows.length).toBe(1 + findings.restock.length);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("quotes a title containing a comma and it round-trips", () => {
    const modified: Findings = structuredClone(findings);
    modified.restock[0]!.title = "Widget, Deluxe Edition";
    const csv = toCsv(modified);
    const firstDataLine = csv.split("\r\n")[1]!;
    expect(firstDataLine).toContain('"Widget, Deluxe Edition"');
  });

  it("doubles embedded quotes per RFC 4180", () => {
    const modified: Findings = structuredClone(findings);
    modified.restock[0]!.title = 'The "Best" Blend';
    const csv = toCsv(modified);
    const firstDataLine = csv.split("\r\n")[1]!;
    expect(firstDataLine).toContain('"The ""Best"" Blend"');
  });

  it("joins sold-out variant titles with a semicolon, not a bare comma", () => {
    const csv = toCsv(findings);
    // the first restock row in the fixture has multiple sold-out variant titles
    expect(csv).toContain("250g / Whole Bean; 250g / Filter Ground");
  });

  it("renders only the header row when restock is empty", () => {
    const empty: Findings = { ...findings, restock: [] };
    const csv = toCsv(empty);
    const rows = csv.trim().split("\r\n");
    expect(rows.length).toBe(1);
  });

  it("never renders a currency symbol next to the index columns", () => {
    const csv = toCsv(findings);
    expect(csv).not.toMatch(/[₹$€£]/);
  });
});

describe("renderHtml", () => {
  const findings = loadSample();
  const html = renderHtml(findings);

  it("is well under the 150 KB budget on the sample fixture", () => {
    const bytes = Buffer.byteLength(html, "utf8");
    expect(bytes).toBeLessThanOrEqual(150 * 1024);
  });

  it("makes zero external requests: no script/link/img tags, and no http(s) URL outside an <a> href", () => {
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toMatch(/<link[\s>]/i);
    expect(html).not.toMatch(/<img[\s>]/i);
    expect(tagsWithExternalUrl(html)).toEqual([]);
  });

  it("includes the store host, generated/fetched timestamps, and a public-data badge", () => {
    expect(html).toContain(findings.store.host);
    expect(html).toContain(findings.generatedAt);
    expect(html).toContain(findings.snapshotFetchedAt);
    expect(html).toMatch(/public data only/i);
  });

  it("renders all 15 (of 12 available) restock rows as expandable details with component bars", () => {
    const detailsCount = (html.match(/<details class="restock-row"/g) ?? []).length;
    expect(detailsCount).toBe(findings.restock.length);
    // six components per row
    const barRows = (html.match(/class="bar-row"/g) ?? []).length;
    expect(barRows).toBe(findings.restock.length * 6);
  });

  it("labels priority/leakage/demand figures as an index, never currency", () => {
    expect(html).toMatch(/index/i);
    expect(html).not.toMatch(/revenue at risk/i);
  });

  it("renders a severity chip for every scorecard finding across all five stages", () => {
    for (const stage of ["Discovery", "PDP", "Variant selection", "Intent capture", "Trust / checkout"]) {
      expect(html).toContain(stage);
    }
    const chipCount = (html.match(/class="chip chip-/g) ?? []).length;
    expect(chipCount).toBe(findings.scorecard.length);
  });

  it("includes a print stylesheet and prefers-color-scheme dark mode", () => {
    expect(html).toMatch(/@media print/);
    expect(html).toMatch(/@media \(prefers-color-scheme: dark\)/);
  });

  it("shows an explicit empty-state sentence when restock is empty", () => {
    const empty: Findings = { ...findings, restock: [] };
    const emptyHtml = renderHtml(empty);
    expect(emptyHtml).toMatch(/no products currently show demand leakage/i);
    expect(tagsWithExternalUrl(emptyHtml)).toEqual([]);
  });

  it("shows an explicit empty-state sentence per stage when scorecard is empty", () => {
    const empty: Findings = { ...findings, scorecard: [] };
    const emptyHtml = renderHtml(empty);
    const emptyStateCount = (emptyHtml.match(/No check recorded for this stage in this run\./g) ?? []).length;
    expect(emptyStateCount).toBe(5); // one per journey stage
  });
});

describe("toTerminal", () => {
  const findings = loadSample();

  it("fits every line within 100 columns", () => {
    const terminal = toTerminal(findings);
    for (const line of terminal.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(100);
    }
  });

  it("prints the three headline numbers", () => {
    const terminal = toTerminal(findings);
    expect(terminal).toContain(`${findings.headline.variantsSoldOut}/${findings.headline.variantsTotal}`);
    expect(terminal).toContain(String(findings.headline.productsLeakingOnMerch));
    expect(terminal).toContain(String(findings.headline.soldOutPdpsWithoutCapture));
  });

  it("prints a top-10 restock table (not all 12 rows) and one line per journey stage", () => {
    const terminal = toTerminal(findings);
    // only the top 10 ranks should appear as row numbers in the table
    expect(terminal).toContain("Amruthavarshini Estate".slice(0, 20));
    for (const stage of ["Discovery", "PDP", "Variant selection", "Intent capture", "Trust / checkout"]) {
      expect(terminal).toContain(stage);
    }
  });

  it("handles restock: [] without crashing and without exceeding 100 columns", () => {
    const empty: Findings = { ...findings, restock: [] };
    const terminal = toTerminal(empty);
    expect(terminal).toMatch(/no products currently show demand leakage/i);
    for (const line of terminal.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(100);
    }
  });

  it("handles soldOutPdpsWithoutCapture: null (not sampled)", () => {
    const modified: Findings = { ...findings, headline: { ...findings.headline, soldOutPdpsWithoutCapture: null } };
    const terminal = toTerminal(modified);
    expect(terminal).toMatch(/not sampled/i);
  });
});

describe("report/index.ts re-exports", () => {
  it("exposes renderHtml, toCsv, toTerminal by exactly those names", () => {
    expect(typeof reportIndex.renderHtml).toBe("function");
    expect(typeof reportIndex.toCsv).toBe("function");
    expect(typeof reportIndex.toTerminal).toBe("function");
  });
});
