# Project Context

## Purpose
`beacon-scan` — a CLI that reads a Shopify store's public storefront JSON and produces one actionable merchant insight (Restock Priority / Demand Leakage) plus a thin shopper-journey friction scorecard. Built as a bounded MVP for the Swym "Beacon Product Builder" take-home. See `docs/PRD.md` (locked v1).

## Tech Stack
- Node 20+, TypeScript 5, ESM. Run with `npx tsx src/cli.ts`; `npm run build` emits `dist/` via `tsc`.
- Deps (keep to these): `commander` (CLI), `zod` (schemas), `undici` (fetch with timeouts; Node's global fetch is acceptable), `p-limit` (concurrency), `cli-table3` (terminal table), `vitest` (tests). No template engine — HTML report is built with template literals from one file.
- No database. Runs write to `out/<host>/<timestamp>/`. HTTP cache is a directory of JSON files under `.cache/<host>/`.

## Project Conventions

### Code Style
- Strict TS (`"strict": true`, `noUncheckedIndexedAccess`). No `any` except at the fetch boundary, validated by zod immediately.
- Pure functions in `engine/`; I/O only in `collector/` and `report/`. `cli.ts` wires them.
- File names kebab-case; exported types PascalCase; one module per capability (see design.md).
- Errors: throw `BeaconError(code, message, hint)`; CLI prints `hint` and exits 1.

### Architecture Patterns
collector (fetch → normalise → `StoreSnapshot`) → engine (`StoreSnapshot` → `Findings`) → report (`Findings` → csv/html/terminal). Every stage reads/writes JSON files so each can be run and tested alone.

### Testing Strategy
- vitest. Engine tests run on committed fixtures (`tests/fixtures/<store>/products.page1.json`, `collections.json`, `collection.<handle>.json`, `pdp.<handle>.html` × ≤3). Fixtures recorded once by the spike; tests never hit the network.
- One end-to-end test: `scan --offline --fixtures tests/fixtures/<store>` produces `findings.json` matching a snapshot (vitest `toMatchSnapshot`).

### Git Workflow
- Ashish owns all commits and pushes. Agents leave the tree clean and list changed files in their report. Branch: `main`. Conventional commits.

## Domain Context
- Shopify public storefront JSON: `GET /products.json?limit=250&page=N` (stops when `products` is empty); `GET /collections.json?limit=250&page=N`; `GET /collections/<handle>/products.json?limit=250&page=N` (order = collection sort order). Variant fields: `id, title, option1..3, price (string), compare_at_price (string|null), available (bool), featured_image`. Product fields: `id, handle, title, body_html, tags[], images[], options[{name, position, values[]}], variants[], updated_at, published_at`.
- Some stores return 429 on bursts; some disable these endpoints (404/403) — a hard stop with a clear message.
- Swym's widgets: Wishlist Plus, Back-in-Stock alerts. Marker strings in PDP HTML: `swym`, `swym-button`, `swym-notify`, plus generic `back in stock`, `notify me`, `restock`, `klaviyo-bis`.

## Important Constraints
- Public endpoints only. Fetch `/robots.txt` first; skip any path disallowed for `*`. ≤2 requests/second, concurrency 2, `User-Agent: beacon-scan/0.1 (+github repo url)`. Honour `Retry-After`; exponential backoff 1s→16s, max 4 retries; then fail the run with `RATE_LIMITED`.
- No runtime LLM calls. No personal data. Report says "index", never currency, for any risk/priority number.
- MVP non-goals in PRD §1 are hard limits.

## External Dependencies
- The chosen store's storefront (read-only, public). Nothing else.
