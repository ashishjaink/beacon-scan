# report-and-cli

## ADDED Requirements

### Requirement: CLI surface
The CLI SHALL expose `scan`, `report`, and `diff` exactly per `design.md §3`, SHALL print phase progress to stderr, SHALL write all artefacts to `out/<host>/<ISO-timestamp>/`, and SHALL exit non-zero with `code` and `hint` on any `BeaconError`.

#### Scenario: Happy path
- **WHEN** `npx tsx src/cli.ts scan https://<store>` completes
- **THEN** the run directory contains `snapshot.json`, `pdp-markers.json`, `findings.json`, `restock_priority.csv`, `report.html`, and stdout ends with the terminal summary and the path to `report.html`

#### Scenario: Offline
- **WHEN** `scan --offline --fixtures tests/fixtures/<store> https://<store>` is run with no network
- **THEN** it completes with identical artefacts to an online run on the same data

### Requirement: CSV
`restock_priority.csv` SHALL contain one row per `RestockRow` with columns `rank,handle,title,url,sold_out_variants,total_variants,leakage,demand_proxy,price_factor,restock_priority,sold_out_variant_titles,reason`, RFC 4180 quoted.

#### Scenario: Title with comma
- **WHEN** a product title contains `,`
- **THEN** the field is quoted and the file opens correctly in Numbers/Excel

### Requirement: HTML report
`report.html` SHALL be a single self-contained file per `design.md §6`, SHALL make zero external requests, SHALL render every section even when data is empty (with an explicit empty-state sentence), SHALL label every priority/risk number as an index, and SHALL be ≤150 KB.

#### Scenario: Open in browser offline
- **WHEN** the file is opened with networking disabled
- **THEN** all styling and content render and the browser devtools network panel shows only the file itself

#### Scenario: Print
- **WHEN** printed to PDF at A4
- **THEN** the restock table and scorecard are not cut mid-row and page headers show the store host

### Requirement: Terminal summary
The terminal summary SHALL print three headline lines, a top-10 restock table, and one line per scorecard stage with its severity, and SHALL fit in 100 columns.

#### Scenario: Narrow terminal
- **WHEN** `COLUMNS=100`
- **THEN** no row wraps; titles are truncated with `…`

### Requirement: Library-first packaging
`src/index.ts` SHALL export exactly the surface in `design.md §10`; nothing under `src/index.ts`'s import graph SHALL write files, print, or call `process.exit`; `package.json` SHALL expose `bin` (`beacon`) and `exports`/`types` for programmatic use. No API keys, auth, or tenancy SHALL exist in the MVP (PRD N7).

#### Scenario: Programmatic use
- **WHEN** a script runs `const r = await scanStore(url, { offlineFixturesDir })`
- **THEN** it resolves to `{ snapshot, markers, findings }` with no console output and no files created

#### Scenario: Build output
- **WHEN** `npm run build` completes
- **THEN** `dist/index.js` exports `scanStore, analyseSnapshot, diffSnapshots, renderReport` and `dist/cli.js` is executable via the `beacon` bin

### Requirement: Example run committed
The repo SHALL include `out/EXAMPLE/` — one real run on the chosen store (all five artefacts) — so a reviewer can open `report.html` without running anything.

#### Scenario: Fresh clone
- **WHEN** a reviewer opens `out/EXAMPLE/report.html` from a fresh clone
- **THEN** it renders the real store's findings with the run timestamp
