# Tasks — beacon-mvp

Lanes map to `WO-BEACON-01.md`. Lane 0 is sequential; A–D run in parallel; I (integration) follows. Ashish-only items marked **[Ashish]**.

## 0. Spike & scaffold (Lane 0)
- [ ] 0.1 Verify shortlist stores against PRD §6 criteria (products.json, collections.json, counts, sold-out %, merch collection, `swym` in a PDP). Write `docs/spike-store-selection.md` with a table and the pick + one fallback.
- [ ] 0.2 **[Ashish]** approve pick (reply "go <host>").
- [ ] 0.3 Scaffold repo per `design.md §1` (package.json scripts: `dev`, `build`, `test`, `scan`, `lint`), `tsconfig`, vitest, `.gitignore` (`out/*`, `!out/EXAMPLE`, `.cache/`, `node_modules/`, `dist/`), MIT LICENSE.
- [ ] 0.4 Commit `src/types.ts` verbatim from `design.md §2`; `src/errors.ts`; `beacon.config.json` from `design.md §5`; `src/index.ts` with the exact signatures of `design.md §10` delegating to stub modules that throw `NOT_IMPLEMENTED`; `package.json` with `bin`, `exports`, `types` per §10.
- [ ] 0.5 Record fixtures for the chosen store into `tests/fixtures/<host>/` per `design.md §8` (throttled; ≤3 PDP HTMLs; strip nothing — public data). Add `tests/fixtures/README.md` with the recording date and command.
- [ ] 0.6 Write `tests/fixtures/sample-findings.json` — a hand-made `Findings` with 12 restock rows and all 8 scorecard findings (mixed severities, one `none`) for Lane C to build against.
- [ ] 0.7 Append Lane 0 prompt to `docs/ai-workflow/prompts-log.md`.

## A. Collector (Lane A)
- [ ] A.1 `collector/http.ts`: throttle (rps, concurrency), timeout, UA, robots parse + allow check, retry/backoff honouring Retry-After, disk cache with 6h TTL, `stats`.
- [ ] A.2 `collector/shopify.ts`: detection, pagination, normalisation → `StoreSnapshot`; collection membership with positions; policies + homepage link check.
- [ ] A.3 `collector/pdp-markers.ts`: sample selection (highest leakage first), marker detection.
- [ ] A.4 `collector/index.ts`: `collect(url, opts)` and `collectOffline(dir)` sharing the same normalisation path.
- [ ] A.5 `tests/collector.test.ts`: normalisation cases (null compare_at, string prices, html strip), robots disallow, 429 backoff (mock fetch), offline mode equals fixture snapshot.
- [ ] A.6 Prompt appended to prompts-log.

## B. Engine (Lane B)
- [ ] B.1 `engine/size-curve.ts`: size option detection, ordered values, core-size set.
- [ ] B.2 `engine/restock.ts`: components, demandProxy, priceFactor, priority, rank, reason.
- [ ] B.3 `engine/scorecard.ts`: the 8 findings with thresholds → severity, examples ≤5, recommendations (fixed strings in one map), evidence strings.
- [ ] B.4 `engine/index.ts`: `analyse(snapshot, markers, config, delta?)` → `Findings`, headline, methodology.
- [ ] B.5 `engine/diff.ts` (P1): `diff(a, b)` → `AvailabilityDelta`.
- [ ] B.6 `tests/engine.test.ts`: every Scenario in `specs/friction-engine/spec.md` as a test; determinism snapshot on fixtures.
- [ ] B.7 Prompt appended to prompts-log.

## C. Report + CLI (Lane C)
- [ ] C.1 `report/csv.ts` (RFC 4180), `report/terminal.ts` (cli-table3, 100 cols), `report/html.ts` (single file, sections per `design.md §6`, CSS-only component bars, print stylesheet, dark/light).
- [ ] C.2 `src/cli.ts`: commander wiring for `scan | report | diff` calling only `src/index.ts` (`scanStore`, `analyseSnapshot`, `diffSnapshots`, `renderReport`); stderr progress via `onProgress`; run dir naming; all file writes here; error → exit code + hint.
- [ ] C.3 `tests/report.test.ts`: CSV quoting, HTML has no `http(s)://` in `src=`/`href=` except product links, size ≤150 KB on `sample-findings.json`, empty-state rendering on a findings file with `restock: []`.
- [ ] C.4 Build against `tests/fixtures/sample-findings.json` only; do not import engine internals.
- [ ] C.5 Prompt appended to prompts-log.

## D. Docs (Lane D)
- [ ] D.1 Draft `docs/part2-architecture.md`, `docs/part2-defensibility.md`, `docs/part3-discovery.md` from `docs/theses.md` (voice rules, ≤900 words, DRAFT comment at top).
- [ ] D.2 `README.md` skeleton per `specs/submission-docs` with `{{PLACEHOLDER}}` for real numbers/links.
- [ ] D.3 `docs/ai-workflow/README.md`, copy of WO, `prompts-log.md` (create if absent), `transcripts/.gitkeep`.
- [ ] D.4 `docs/loom-shot-list.md`, `scripts/export-pdf.md`.
- [ ] D.5 Forbidden-phrase grep passes; word counts recorded at the bottom of each essay in an HTML comment.
- [ ] D.6 Prompt appended to prompts-log.

## I. Integration (Lane I, after A–C)
- [ ] I.1 Replace stubs; wire `src/index.ts` to real modules; `npm test` green; `tests/e2e.test.ts` offline scan matches snapshot.
- [ ] I.1a Library seam check: `tests/library.test.ts` imports `scanStore` from `src/index.ts`, runs it with `offlineFixturesDir`, and asserts no stdout/stderr output and no files written (spy on `fs`); `npm run build` then `node -e "import('./dist/index.js').then(m=>console.log(Object.keys(m)))"` lists the §10 exports. README gets the 5-line programmatic example.
- [ ] I.2 `npx tsx src/cli.ts scan --offline --fixtures tests/fixtures/<host> https://<host>` produces all artefacts; open `report.html` and screenshot it to `docs/img/report.png` via `npx --yes playwright screenshot --viewport-size=1280,900 --full-page file://$PWD/out/<run>/report.html docs/img/report.png` (one-off download; do not add Playwright to package.json; if it fails, log it and let Ashish screenshot manually).
- [ ] I.3 **[Ashish]** run the real scan from the Mac: `npm run scan -- https://<host>`; paste stderr/stdout back if it fails.
- [ ] I.4 Fix real-world breakage (themes, redirects, pagination edge cases). Re-record fixtures only if the schema was wrong.
- [ ] I.5 Copy the real run to `out/EXAMPLE/`; fill README placeholders with the real headline numbers; spot-check top-3 restock rows against the live store and note the check in README.
- [ ] I.6 **[Ashish]** ≥12h later: second scan; `beacon diff` if B.5 landed; re-render `out/EXAMPLE`.
- [ ] I.7 **[Ashish]** edit essays (remove DRAFT comments), record Loom, export PDF, export transcripts into `docs/ai-workflow/transcripts/`, commit, push, submit.
