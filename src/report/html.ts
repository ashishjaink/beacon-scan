import type { Finding, Findings, RestockRow } from "../types.js";

const STAGE_ORDER: Finding["stage"][] = ["discovery", "pdp", "variant", "intent-capture", "trust"];
const STAGE_LABEL: Record<Finding["stage"], string> = {
  discovery: "Discovery",
  pdp: "PDP",
  variant: "Variant selection",
  "intent-capture": "Intent capture",
  trust: "Trust / checkout",
};
const SEVERITY_LABEL: Record<Finding["severity"], string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "None",
};
const COMPONENT_LABEL: Record<keyof RestockRow["components"], string> = {
  inMerch: "In merchandised collection",
  position: "Collection position",
  breadth: "Collection breadth",
  recency: "Recency",
  discounted: "Discounted (penalty)",
  velocity: "Sell-through velocity",
};

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtIndex(n: number, decimals = 3): string {
  return Number.isFinite(n) ? n.toFixed(decimals) : (0).toFixed(decimals);
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n * 100)));
}

function componentBars(row: RestockRow): string {
  const keys = Object.keys(COMPONENT_LABEL) as (keyof RestockRow["components"])[];
  return keys
    .map((key) => {
      const value = row.components[key];
      const pct = clampPct(value);
      return `
        <div class="bar-row">
          <span class="bar-label">${escapeHtml(COMPONENT_LABEL[key])}</span>
          <span class="bar-track" role="img" aria-label="${escapeHtml(COMPONENT_LABEL[key])}: ${fmtIndex(value, 2)}">
            <span class="bar-fill" style="width:${pct}%"></span>
          </span>
          <span class="bar-value">${fmtIndex(value, 2)}</span>
        </div>`;
    })
    .join("");
}

function restockRowHtml(row: RestockRow): string {
  return `
    <details class="restock-row">
      <summary>
        <span class="rank">#${row.rank}</span>
        <span class="title"><a href="${escapeHtml(row.url)}" target="_blank" rel="noopener">${escapeHtml(row.title)}</a></span>
        <span class="soldout">${row.soldOutVariants}/${row.totalVariants} variants sold out</span>
        <span class="priority-badge" title="Restock Priority index (0–1) — not a currency figure">idx ${fmtIndex(row.restockPriority)}</span>
      </summary>
      <div class="details-body">
        <p class="reason">${escapeHtml(row.reason)}</p>
        <div class="components">${componentBars(row)}</div>
        <p class="meta">
          Median variant price: ${row.medianPrice} ·
          Price factor index: ${fmtIndex(row.priceFactor)} ·
          Leakage index: ${fmtIndex(row.leakage, 2)} ·
          Demand-proxy index: ${fmtIndex(row.demandProxy)}
        </p>
        ${
          row.soldOutVariantTitles.length > 0
            ? `<p class="meta">Sold-out variants: ${escapeHtml(row.soldOutVariantTitles.join(", "))}</p>`
            : ""
        }
      </div>
    </details>`;
}

function restockSection(findings: Findings): string {
  const top15 = findings.restock.slice(0, 15);
  const body =
    top15.length === 0
      ? `<p class="empty-state">No products currently show demand leakage — every catalogued product is either fully in stock or was not scanned. Nothing to restock-prioritise this run.</p>`
      : `<div class="restock-list">${top15.map(restockRowHtml).join("")}</div>`;
  return `
    <section id="restock" aria-labelledby="restock-heading">
      <h2 id="restock-heading">Restock Priority — top ${top15.length} of ${findings.restock.length}</h2>
      <p class="section-note">
        "Restock Priority" is an unitless intent-at-risk index (0–1) built from public storefront signals —
        never a revenue or currency figure. Click a row for its component breakdown.
      </p>
      ${body}
    </section>`;
}

function exampleLinks(examples: Finding["examples"]): string {
  if (examples.length === 0) return `<p class="no-examples">No example URLs recorded for this check.</p>`;
  const items = examples
    .slice(0, 3)
    .map(
      (ex) =>
        `<li><a href="${escapeHtml(ex.url)}" target="_blank" rel="noopener">${escapeHtml(ex.title)}</a>${
          ex.note ? ` <span class="example-note">— ${escapeHtml(ex.note)}</span>` : ""
        }</li>`,
    )
    .join("");
  return `<ul class="examples">${items}</ul>`;
}

function findingHtml(f: Finding): string {
  const countStr = f.denominator === null ? String(f.count) : `${f.count} / ${f.denominator}`;
  return `
    <div class="finding finding-${f.severity}">
      <div class="finding-head">
        <span class="chip chip-${f.severity}">${SEVERITY_LABEL[f.severity]}</span>
        <span class="finding-title">${escapeHtml(f.title)}</span>
        <span class="finding-count">${escapeHtml(countStr)}</span>
      </div>
      <p class="recommendation">${escapeHtml(f.recommendation)}</p>
      ${exampleLinks(f.examples)}
      <p class="evidence">Evidence: ${escapeHtml(f.evidence)}</p>
    </div>`;
}

function scorecardSection(findings: Findings): string {
  const byStage = new Map<Finding["stage"], Finding[]>();
  for (const f of findings.scorecard) {
    const list = byStage.get(f.stage) ?? [];
    list.push(f);
    byStage.set(f.stage, list);
  }

  const stageBlocks = STAGE_ORDER.map((stage) => {
    const list = byStage.get(stage) ?? [];
    const body =
      list.length === 0
        ? `<p class="empty-state">No check recorded for this stage in this run.</p>`
        : list.map(findingHtml).join("");
    return `
      <div class="stage-block">
        <h3>${escapeHtml(STAGE_LABEL[stage])}</h3>
        ${body}
      </div>`;
  }).join("");

  return `
    <section id="scorecard" aria-labelledby="scorecard-heading">
      <h2 id="scorecard-heading">Journey friction scorecard</h2>
      <p class="section-note">
        Five shopper-journey stages, each checked against public evidence. A "None" severity chip means the
        check ran and found no issue, not that the stage was skipped.
      </p>
      ${stageBlocks}
    </section>`;
}

function methodologySection(findings: Findings): string {
  const weights = Object.entries(findings.methodology.weights)
    .map(([k, v]) => `<li><code>${escapeHtml(k)}</code>: ${fmtIndex(v, 2)}</li>`)
    .join("");
  const limits = findings.methodology.limits.map((l) => `<li>${escapeHtml(l)}</li>`).join("");
  return `
    <section id="methodology" aria-labelledby="methodology-heading">
      <h2 id="methodology-heading">Methodology &amp; limits</h2>
      <p class="section-note">
        Every priority, leakage, and demand-proxy number in this report is an <strong>index</strong> of
        intent at risk, derived from public storefront data — never a currency figure, and never a confirmed
        sales number.
      </p>
      <h3>Restock Priority weights</h3>
      <ul class="weights">${weights || "<li>No weights recorded.</li>"}</ul>
      <h3>Known limits &amp; assumptions</h3>
      <ul class="limits">${limits || "<li>No limits recorded.</li>"}</ul>
    </section>`;
}

function headlineTiles(findings: Findings): string {
  const h = findings.headline;
  const captureTile =
    h.soldOutPdpsWithoutCapture === null
      ? `<div class="tile"><div class="tile-value">not sampled</div><div class="tile-label">Sold-out PDPs without back-in-stock capture</div></div>`
      : `<div class="tile"><div class="tile-value">${h.soldOutPdpsWithoutCapture}</div><div class="tile-label">Sold-out PDPs without back-in-stock capture</div></div>`;
  return `
    <div class="tiles">
      <div class="tile">
        <div class="tile-value">${h.variantsSoldOut}<span class="tile-unit">/${h.variantsTotal}</span></div>
        <div class="tile-label">Variants sold out (of scanned total)</div>
      </div>
      <div class="tile">
        <div class="tile-value">${h.productsLeakingOnMerch}</div>
        <div class="tile-label">Products leaking demand on merchandised collections</div>
      </div>
      ${captureTile}
    </div>`;
}

const STYLE = `
    :root {
      --bg: #f7f7f5; --surface: #ffffff; --text: #1a1a1a; --muted: #5b5b5b; --border: #dedede;
      --accent: #1f6feb; --bar-track: #e7e7e3; --bar-fill: #1f6feb;
      --chip-high-bg: #fde2e1; --chip-high-fg: #8a1c1c;
      --chip-medium-bg: #fdecc8; --chip-medium-fg: #8a5a00;
      --chip-low-bg: #e3f0ff; --chip-low-fg: #1a4d8f;
      --chip-none-bg: #e3f7e6; --chip-none-fg: #1e6b30;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #14161a; --surface: #1c1f24; --text: #e9e9e7; --muted: #a1a1a1; --border: #33373d;
        --accent: #5b9dff; --bar-track: #2a2e34; --bar-fill: #5b9dff;
        --chip-high-bg: #4a1f1f; --chip-high-fg: #ffb4b0;
        --chip-medium-bg: #4a3a10; --chip-medium-fg: #ffd98a;
        --chip-low-bg: #163353; --chip-low-fg: #9cc6ff;
        --chip-none-bg: #17381f; --chip-none-fg: #93e0a4;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0 0 3rem; background: var(--bg); color: var(--text);
      font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    }
    .wrap { max-width: 960px; margin: 0 auto; padding: 0 1.25rem; }
    header.report-header {
      background: var(--surface); border-bottom: 1px solid var(--border); padding: 1.5rem 0; margin-bottom: 1.5rem;
    }
    header.report-header h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
    .badge {
      display: inline-block; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.02em;
      text-transform: uppercase; background: var(--chip-none-bg); color: var(--chip-none-fg);
      border-radius: 999px; padding: 0.15rem 0.65rem; margin-left: 0.5rem; vertical-align: middle;
    }
    .header-meta { color: var(--muted); font-size: 0.9rem; }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .tile { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.25rem; }
    .tile-value { font-size: 1.9rem; font-weight: 700; }
    .tile-unit { font-size: 1.1rem; font-weight: 500; color: var(--muted); }
    .tile-label { color: var(--muted); font-size: 0.85rem; margin-top: 0.25rem; }
    section { margin-bottom: 2.5rem; }
    h2 { font-size: 1.2rem; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; }
    h3 { font-size: 1rem; margin-top: 1.5rem; }
    .section-note { color: var(--muted); font-size: 0.88rem; }
    .empty-state { color: var(--muted); font-style: italic; }
    details.restock-row {
      background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
      margin-bottom: 0.6rem; padding: 0.6rem 0.9rem; break-inside: avoid; page-break-inside: avoid;
    }
    details.restock-row summary {
      cursor: pointer; display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; list-style: none;
    }
    details.restock-row summary::-webkit-details-marker { display: none; }
    details.restock-row summary::before { content: "▸"; color: var(--muted); }
    details.restock-row[open] summary::before { content: "▾"; }
    .rank { font-variant-numeric: tabular-nums; color: var(--muted); min-width: 2.2em; }
    .title a { color: var(--text); text-decoration: none; font-weight: 600; }
    .title a:hover { text-decoration: underline; }
    .soldout { color: var(--muted); font-size: 0.85rem; }
    .priority-badge {
      margin-left: auto; font-variant-numeric: tabular-nums; background: var(--chip-low-bg); color: var(--chip-low-fg);
      border-radius: 6px; padding: 0.15rem 0.5rem; font-size: 0.85rem;
    }
    .details-body { margin-top: 0.75rem; padding-top: 0.6rem; border-top: 1px dashed var(--border); }
    .reason { margin: 0 0 0.6rem; }
    .bar-row { display: grid; grid-template-columns: 190px 1fr 3.2em; align-items: center; gap: 0.5rem; margin: 0.25rem 0; }
    .bar-label { font-size: 0.8rem; color: var(--muted); }
    .bar-track { display: inline-block; height: 8px; background: var(--bar-track); border-radius: 999px; overflow: hidden; }
    .bar-fill { display: block; height: 100%; background: var(--bar-fill); border-radius: 999px; }
    .bar-value { font-size: 0.8rem; font-variant-numeric: tabular-nums; text-align: right; }
    .meta { color: var(--muted); font-size: 0.82rem; margin: 0.3rem 0; }
    .stage-block { margin-bottom: 1.25rem; }
    .finding {
      background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
      padding: 0.6rem 0.9rem; margin-bottom: 0.5rem; break-inside: avoid; page-break-inside: avoid;
    }
    .finding-head { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
    .chip { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; border-radius: 999px; padding: 0.15rem 0.55rem; }
    .chip-high { background: var(--chip-high-bg); color: var(--chip-high-fg); }
    .chip-medium { background: var(--chip-medium-bg); color: var(--chip-medium-fg); }
    .chip-low { background: var(--chip-low-bg); color: var(--chip-low-fg); }
    .chip-none { background: var(--chip-none-bg); color: var(--chip-none-fg); }
    .finding-title { font-weight: 600; }
    .finding-count { margin-left: auto; color: var(--muted); font-size: 0.85rem; font-variant-numeric: tabular-nums; }
    .recommendation { margin: 0.4rem 0; }
    ul.examples { margin: 0.3rem 0; padding-left: 1.2rem; font-size: 0.88rem; }
    .example-note { color: var(--muted); }
    .no-examples { color: var(--muted); font-size: 0.85rem; font-style: italic; }
    .evidence { color: var(--muted); font-size: 0.78rem; margin: 0.3rem 0 0; }
    ul.weights, ul.limits { padding-left: 1.2rem; }
    ul.weights li { font-variant-numeric: tabular-nums; }
    footer.report-footer {
      color: var(--muted); font-size: 0.8rem; border-top: 1px solid var(--border); padding-top: 1rem; margin-top: 2rem;
    }
    .print-header { display: none; }
    @media print {
      body { background: #fff; color: #000; }
      .tile, details.restock-row, .finding { border: 1px solid #999; }
      details.restock-row { break-inside: avoid; }
      details.restock-row:not([open]) summary { cursor: default; }
      a { color: #000; text-decoration: underline; }
      .print-header {
        display: block; position: fixed; top: 0; left: 0; right: 0; font-size: 10px; color: #444;
        padding: 4px 0; text-align: center;
      }
      @page { margin: 2cm 1.5cm 1.5cm; size: A4; }
    }
`;

/**
 * Renders the self-contained report.html: one template-literal module, inline CSS only,
 * no external requests except the product/collection <a href> links back to the live store.
 * Every priority/leakage/demand number is explicitly labelled as an index, never currency.
 */
export function renderHtml(findings: Findings): string {
  const storeLabel = findings.store.name ? `${findings.store.name} (${findings.store.host})` : findings.store.host;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Beacon Friction Scan — ${escapeHtml(findings.store.host)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="print-header">Beacon Friction Scan — ${escapeHtml(findings.store.host)} — generated ${escapeHtml(findings.generatedAt)}</div>
<header class="report-header">
  <div class="wrap">
    <h1>Beacon Friction Scan<span class="badge">public data only</span></h1>
    <div class="header-meta">
      Store: <strong>${escapeHtml(storeLabel)}</strong> ·
      Snapshot fetched ${escapeHtml(findings.snapshotFetchedAt)} ·
      Report generated ${escapeHtml(findings.generatedAt)}
    </div>
  </div>
</header>
<div class="wrap">
  ${headlineTiles(findings)}
  ${restockSection(findings)}
  ${scorecardSection(findings)}
  ${methodologySection(findings)}
  <footer class="report-footer">
    Beacon Friction Scanner MVP (Swym take-home) · schema v${findings.schemaVersion} ·
    generated ${escapeHtml(findings.generatedAt)} from a snapshot fetched ${escapeHtml(findings.snapshotFetchedAt)} ·
    all figures are indices derived from public storefront data, not currency or confirmed revenue.
  </footer>
</div>
</body>
</html>
`;
}
