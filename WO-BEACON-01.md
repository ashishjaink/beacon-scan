# WO-BEACON-01 — Build the Beacon Friction Scanner MVP (Swym take-home)

Issued: 2026-09-22 (rev 2: library-first packaging) · Owner: Ashish Jain Kothari · Executor: Claude Code (orchestrator + subagents, Opus/Sonnet class) · Budget: Day 1 of a 3-day window
Working directory: this repo root. All inputs are already present here:
`docs/PRD.md` (locked v1), `docs/theses.md`, `openspec/project.md`, `openspec/changes/beacon-mvp/{proposal,design,tasks}.md`, `openspec/changes/beacon-mvp/specs/{store-collector,friction-engine,report-and-cli,submission-docs}/spec.md`. Read all of them before doing anything.

## 0. Mission
Produce a runnable, library-first TypeScript package `beacon-scan` — `import { scanStore } from "beacon-scan"` plus a thin `beacon scan <shopify-store-url>` CLI — that outputs a Restock Priority / Demand Leakage insight and a five-stage journey scorecard from public data, with tests, a committed example run, README, three essay drafts, and a transparent AI-workflow log, inside the MVP boundary. The library seam exists to show where Beacon's eventual API/SDK would sit; keys, tenancy and hosting are essay material (PRD §5a, N7), not code. Do not exceed the boundary; do not ask Ashish to re-specify anything covered by the inputs. Where the inputs are silent, choose the simplest option, write the choice into `docs/decisions-during-build.md`, and continue.

## 1. Hard rules (orchestrator and every subagent)
1. Scope = PRD §1 goals; non-goals N1–N7 are prohibitions. If a task would need a scheduler, server, UI framework, LLM call, ML, headless browser at runtime, API keys, auth or tenancy, stop that task and log it.
2. Contracts in `design.md §2–§5 and §10` are frozen. A lane that needs a change writes the proposed diff to `docs/decisions-during-build.md` and works around it locally; the orchestrator resolves at integration.
3. Network etiquette is non-negotiable: robots.txt, ≤2 rps, concurrency 2, backoff honouring `Retry-After`, the UA string from `openspec/project.md`. Recording fixtures counts. Only Lane 0 touches the store; Lanes A–D and I work offline from fixtures.
4. No new dependencies beyond `openspec/project.md` Tech Stack without a logged reason.
5. Every lane's first action: append its own full prompt to `docs/ai-workflow/prompts-log.md` under `## <ISO timestamp> — Lane <X>`. Every lane's last action: append a ≤10-line report (files touched, tests added, open issues) under the same heading.
6. No git commits or pushes. Leave the tree clean and list changed paths in the lane report.
7. Voice for any prose the reviewer will read: plain, first person where Ashish speaks, no flattery, no forbidden words from `docs/theses.md`.
8. Numbers in reports are indices, never currency. Every finding carries evidence (endpoint/field) and a recommendation.
9. Nothing in `src/index.ts`'s import graph prints, writes files, or exits; only `src/cli.ts` does I/O.

## 2. Orchestration
```
Lane 0 (sequential) ──► Ashish: "go <host>" ──► Lanes A ∥ B ∥ C ∥ D (parallel subagents) ──► G2 ──► Lane I (single agent) ──► G3 ──► Ashish runs real scan
```
- Run Lane 0 yourself (or as one subagent). After G1, post the store pick and wait for Ashish's `go <host>`. If no answer arrives within the session, proceed with the pick and flag it at the top of the final report.
- Launch A, B, C, D concurrently in one message with the Agent tool, each with its §3 prompt verbatim plus the input file list from the header. Each works only in its "Owns" paths; `package.json`, `src/types.ts`, `src/index.ts`, `beacon.config.json` are read-only for A–D.
- **G1** (after Lane 0): `docs/spike-store-selection.md` has a pick + fallback; fixtures recorded; `src/types.ts` matches design.md §2; `src/index.ts` matches §10; `npm test` runs (0 tests fine); `npx tsc --noEmit` clean.
- **G2** (before Lane I): each of A–D posted its report; each lane's own tests pass in isolation.
- **G3** (Lane I done): `npm test` green; `npm run build` clean; offline e2e artefacts produced; library seam test passes; `docs/img/report.png` exists (or the failure is logged); README placeholders filled from the offline run marked `[offline fixture numbers — replace after real scan]`; tree clean; final report posted (§5).

## 3. Lane prompts (paste verbatim into each subagent)

### Lane 0 — Spike & scaffold
Owns: `docs/spike-store-selection.md`, repo scaffold, `src/types.ts`, `src/index.ts`, `src/errors.ts`, `beacon.config.json`, all stubs, `tests/fixtures/**`, `docs/ai-workflow/prompts-log.md` (create).
> You are Lane 0 of WO-BEACON-01. Read the inputs listed in the WO header. Execute `openspec/changes/beacon-mvp/tasks.md` §0 items 0.1, 0.3–0.7 in order. For 0.1: for each shortlist host in `docs/PRD.md §6`, fetch (≤2 rps, UA per project.md) `/robots.txt`, `/products.json?limit=250&page=1`, `/collections.json?limit=250`, and one PDP of a sold-out product if any; compute product count (page through, cap 800), % variants sold out, % products with ≥2 options, presence of a merch collection (regex in design.md §5), and whether `swym` appears in the PDP HTML. Tabulate; pick the host that meets all "Must" criteria and the most "Prefer" criteria; name one fallback. Then scaffold exactly per design.md §1 with the Tech Stack in project.md — do not commit. `src/types.ts` is the design.md §2 block completed with `z.infer` type exports for every schema. `src/index.ts` exposes exactly the design.md §10 signatures and delegates to stub modules (`collect`, `collectOffline`, `samplePdpMarkers`, `analyse`, `diff`, `writeCsv`, `renderHtml`, `printTerminal`) that throw `new BeaconError("NOT_IMPLEMENTED", …)`. `package.json` has `name`, `type: module`, `bin`, `exports`, `types` per §10 and scripts `dev`, `build`, `test`, `scan`, `lint`. Record fixtures for the chosen store per design.md §8 into `tests/fixtures/<host>/` and write `tests/fixtures/README.md` with date and commands. Hand-write `tests/fixtures/sample-findings.json` per task 0.6 — realistic, real product titles from the store are fine. Finish with `npm test` and `npx tsc --noEmit`, then post your report per WO §1.5.

### Lane A — Collector
Owns: `src/collector/**`, `tests/collector.test.ts`.
> You are Lane A of WO-BEACON-01. Read the WO header inputs, then implement `openspec/changes/beacon-mvp/specs/store-collector/spec.md` in full by completing tasks A.1–A.6. Code against `src/types.ts` (do not modify it). `http.ts` exposes `createHttp(config, {cacheDir, noCache})` returning `{get(path): Promise<{status, body, fromCache}>, stats}`; implement throttling with a token bucket, robots.txt parsing for `*` (handle `Disallow:` prefixes and `*` wildcards), retry with backoff honouring `Retry-After`. `collectOffline(dir)` must reuse the same normalisation functions as the online path. Nothing in this lane prints or writes outside the cache dir; progress goes through an `onProgress` callback. Write vitest tests for every Scenario in the spec using a mocked fetch; the offline-mode test must load `tests/fixtures/<host>` and validate with `StoreSnapshot.parse`. Do not touch the network — fixtures are already recorded. Run `npm test -- collector` and `npx tsc --noEmit` before reporting.

### Lane B — Engine
Owns: `src/engine/**`, `tests/engine.test.ts`.
> You are Lane B of WO-BEACON-01. Read the WO header inputs, then implement `openspec/changes/beacon-mvp/specs/friction-engine/spec.md` by completing tasks B.1–B.7. Everything in `src/engine` is pure: no I/O, no `Date.now` (take `now` as a parameter). Follow design.md §4 formulas exactly; put recommendation strings in one exported map keyed by `check`. Build the size-curve logic with an ordered known-size list and numeric fallback. Write one test per Scenario in the spec (the numeric scenario must assert the exact component values), plus a determinism snapshot test on the fixtures — if Lane A's `collectOffline` is still a stub in your tree, build the snapshot inside the test with a tiny local normaliser and mark it `// TODO(I): switch to collectOffline`. Run `npm test -- engine` and `npx tsc --noEmit` before reporting.

### Lane C — Report + CLI
Owns: `src/report/**`, `src/cli.ts`, `tests/report.test.ts`.
> You are Lane C of WO-BEACON-01. Read the WO header inputs, then implement `openspec/changes/beacon-mvp/specs/report-and-cli/spec.md` by completing tasks C.1–C.5. Build only against `tests/fixtures/sample-findings.json` and the `Findings` type; `src/report/*` are pure functions returning strings (`renderHtml(findings): string`, `toCsv(findings): string`, `toTerminal(findings): string`). `src/cli.ts` imports only from `src/index.ts` (`scanStore`, `analyseSnapshot`, `diffSnapshots`, `renderReport`) and owns all file writes, stderr progress (via `onProgress`), run-dir naming, and exit codes with hints. The HTML report is one template-literal module with inline CSS, sections per design.md §6, CSS-only bars for the six components, severity chips, print stylesheet, `prefers-color-scheme`, no external URLs except product/collection links in `<a href>`; ≤150 KB on the sample. Terminal summary per design.md §7 with cli-table3, ≤100 columns. CSV per spec. Until stubs are replaced, `scan` must reach the `NOT_IMPLEMENTED` error cleanly with exit 1. Run `npm test -- report` and `npx tsc --noEmit` before reporting.

### Lane D — Docs
Owns: `README.md`, `docs/part2-architecture.md`, `docs/part2-defensibility.md`, `docs/part3-discovery.md`, `docs/ai-workflow/README.md`, `docs/ai-workflow/WO-BEACON-01.md` (copy), `docs/loom-shot-list.md`, `scripts/export-pdf.md`.
> You are Lane D of WO-BEACON-01. Read the WO header inputs, especially `docs/theses.md`, `docs/PRD.md §5a` and `openspec/changes/beacon-mvp/specs/submission-docs/spec.md`. Complete tasks D.1–D.6. The essays are drafts in Ashish's voice from his theses: first person, plain, concrete, ≤900 words each, one-sentence answer first, tables where the thesis has a table, `<!-- DRAFT: Ashish to edit voice -->` on line 1, word count in an HTML comment on the last line. `part2-architecture.md` must include the "Delivery surface: API + SDK" section (keys per store, scoped, `store_id` derived server-side) and the failure-mode table with ≥6 rows. Zero forbidden words (grep before finishing). README per the spec with `{{PLACEHOLDER}}` tokens for real numbers, store host, Loom and PDF links; include the 5-line programmatic example (`scanStore`) and an "MVP boundary" section quoting PRD non-goals N1–N7. `docs/ai-workflow/README.md` describes the split: Ashish (decisions D1–D13, store approval, real runs, voice edits, commits), Cowork planning session (PRD, OpenSpec, WO), Claude Code lanes 0/A/B/C/D/I. Loom shot list ≤3 minutes with timestamps. `scripts/export-pdf.md` with a pandoc command and a VS Code fallback. Report per WO §1.5.

### Lane I — Integration
Owns: everything; runs alone after A–D.
> You are Lane I of WO-BEACON-01. Read the WO, the four lane reports in `docs/ai-workflow/prompts-log.md`, and `docs/decisions-during-build.md` if present. Complete tasks I.1, I.1a, I.2, I.4 (offline only), I.5 (with offline numbers, clearly marked). Resolve contract conflicts in favour of design.md unless design.md is impossible, in which case update design.md and log why. Replace Lane B's `TODO(I)` with `collectOffline`. Wire `src/index.ts` to the real modules; write `tests/e2e.test.ts` and `tests/library.test.ts` (no stdout/stderr, no files written when calling `scanStore` with `offlineFixturesDir`). Run the offline scan; screenshot `report.html` to `docs/img/report.png` with `npx --yes playwright screenshot --viewport-size=1280,900 --full-page file://$PWD/out/<run>/report.html docs/img/report.png` (one-off; never add Playwright to package.json; if it fails, log and move on); verify no external requests by grepping the HTML for `https?://` outside product/collection `<a href>`. Full checklist: `npm test`, `npx tsc --noEmit`, `npm run build`, `node dist/cli.js scan --offline --fixtures tests/fixtures/<host> https://<host>`, `node -e "import('./dist/index.js').then(m=>console.log(Object.keys(m)))"`. Post the final report per WO §5 and stop. Do not run the online scan — Ashish does that.

## 4. Division of labour
| Claude Code | Ashish |
|---|---|
| everything in §3; zero network except Lane 0 fixtures; no commits | approve store pick (`go <host>`); real scans from the Mac (Day 1 PM, Day 2 AM, `npm run scan -- https://<host>`); paste failures back; edit essay voice (remove DRAFT comments); Loom per `docs/loom-shot-list.md`; PDF per `scripts/export-pdf.md`; export Cowork + Claude Code transcripts into `docs/ai-workflow/transcripts/`; all git commits/pushes; submit |

## 5. Final report format (Lane I posts; orchestrator relays)
1. Store picked + fallback, with the 3 headline numbers from the offline run.
2. Checklist results (test count, tsc, build, e2e, library seam, screenshot path, dist exports).
3. Deviations from design.md/PRD, each with reason (from `docs/decisions-during-build.md`).
4. Exact commands for Ashish's next three steps (real scan; second scan + `diff`; essay edit locations).
5. Open risks (max 5 lines).

## 6. Definition of done for this WO
`npm test` green · `npm run build` clean · `dist/index.js` exports `scanStore, analyseSnapshot, diffSnapshots, renderReport` · offline scan produces all five artefacts · library seam test passes · `docs/img/report.png` exists or its failure is logged · README has structure, programmatic example and placeholders · three essay drafts pass the forbidden-word grep · `docs/ai-workflow/prompts-log.md` has entries for lanes 0, A, B, C, D, I · tree clean, nothing committed · final report posted.

## 7. Kickoff prompt for Ashish (paste into Claude Code at the repo root)
> Execute `WO-BEACON-01.md` as the orchestrator. Read the header inputs first. Run Lane 0, post the store pick, and wait for my "go <host>". Then launch Lanes A, B, C, D as four parallel subagents with the §3 prompts verbatim, check G2, then run Lane I as a single subagent. Do not ask me to re-specify anything covered by the PRD, design, specs or tasks; log choices in `docs/decisions-during-build.md`. No commits. Post the §5 final report when done.
