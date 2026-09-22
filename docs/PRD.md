# PRD — Beacon Friction Scanner (Swym take-home, MVP)

Status: LOCKED v1 (2026-09-22). Changes after this go through `openspec/changes/`.
Owner: Ashish Jain Kothari. Executor: Claude Code via `WO-BEACON-01.md`.

## 0. One-paragraph brief

Swym runs on ~45K Shopify stores and captures pre-purchase intent (wishlist, save-for-later, back-in-stock subscriptions). "Beacon" is their (unreleased) merchant-intelligence layer on top of that data. The take-home asks for (1) a working tool that extracts a clear, actionable insight about one store's shopper-journey friction from public data, (2) an architecture + failure-mode answer for NL merchant queries at 50K-store scale and a defensibility opinion, (3) a discovery/prioritisation framework and the AI transcript. We are building a **deliberately bounded MVP**: one CLI, one store, one run, one headline insight (Restock Priority / Demand Leakage) plus a thin journey scorecard. The depth goes into the essays, not the code.

## 1. Goals / non-goals

Goals
- G1. A reviewer clones the repo and gets a real report on a real store in under 5 minutes (`npm i && npx beacon scan <url>`).
- G2. The headline insight is one a merchant can act on today: "these N products/variants are leaking intent to stock-outs; restock in this order; turn on back-in-stock capture on these PDPs."
- G3. Every number in the report traces to public evidence (URL + field) and states its limits.
- G4. Parts 2 and 3 read as Ashish's own thinking, plain, concrete, non-flattering.
- G5. The AI workflow is transparent: prompts, WO, transcripts committed.

Non-goals (MVP boundary — the reason Swym cannot use this as-is)
- N1. No hosted service, scheduler, multi-store, auth, database server, or UI beyond a static HTML report.
- N2. No runtime LLM. The NL-query layer is designed in `docs/part2-architecture.md`, not implemented.
- N3. No Swym data integration; no assumptions about Swym internals.
- N4. Scoring is a transparent v0 heuristic with weights in one config file; no calibration, no ML.
- N5. Only two friction families are scored in depth (Demand Leakage, Variant/PDP hygiene); the other journey stages get 1–2 cheap presence checks each.
- N6. No PDP screenshotting, no headless browser, no review-platform scraping.
- N7. No API keys, auth, tenancy, or hosted API. The code is **library-first** (`import { scanStore } from "beacon-scan"`) with the CLI as a thin wrapper, so the shape of an eventual SDK is visible; keys/tenancy/rate plans are designed in `docs/part2-architecture.md`, not built. Public-data scanning has nothing to authenticate, and a working key system would make this adoptable as-is.

## 2. Users and the moment of use

Primary: a DTC merchant or ecommerce manager on Shopify (10–2,000 SKUs) at Monday-morning planning. Question in their head: "what am I losing this week and what do I fix first?" Secondary: the Swym reviewer, who wants to see judgment about intent data, not scraping cleverness.

## 3. The insight (Part 1)

### 3.1 Headline: Restock Priority (Demand Leakage)
For every product: which variants are sold out, how strong the public demand proxies are, and a ranked list of what to restock first. Framed as **intent at risk**, an index, never a currency figure (public data has no volumes).

Inputs (all public Shopify storefront JSON): `/products.json` (paginated, ≤250/page), `/collections.json`, `/collections/<handle>/products.json` (gives collection sort position), per-variant `available`, `price`, `compare_at_price`, `option1..3`, images, `tags`, `updated_at`, `published_at`.

Score v0 (per product; weights in `beacon.config.json`):
```
leakage        = sold_out_variants / total_variants                       # 0..1
demand_proxy   = w1*in_merch_collection   (bestseller|featured|new|trending|top — by handle/title regex)
               + w2*position_score       (1 - rank/len in each merch collection, max over collections)
               + w3*breadth              (min(collections_count,5)/5)
               + w4*recency              (1 if updated_at within 14d else decays to 0 at 90d)
               - w5*discounted           (any variant compare_at_price > price)
price_factor   = log1p(median_variant_price) / log1p(catalog_p90_price)  # 0..~1
restock_priority = demand_proxy * leakage * (0.5 + 0.5*price_factor)
```
Defaults: w1 .35, w2 .25, w3 .15, w4 .15, w5 .10. The report shows the components, not just the score.

Optional (P1, only if two runs ≥12h apart exist): `beacon diff` marks variants that flipped available→sold-out (sell-through) and sold-out→available (restocked); flipped-to-sold-out adds +0.2 to demand_proxy in the second run's report.

### 3.2 Journey scorecard (thin, presence checks)
| Stage | Check (public evidence) | Why it's friction |
|---|---|---|
| Discovery | products in 0 collections (orphans); sold-out products in top-8 positions of any collection | shoppers hit dead ends from the collection grid |
| PDP | products with <2 images; description <200 chars; colour-option products with variants lacking `featured_image` | low-confidence PDP → no add-to-cart |
| Variant selection | size-curve holes: for products with a size option, % sizes sold out, and whether "core" sizes (middle 50% of the ordered size list) are out | the size they want is the one that's missing |
| Intent capture | sample ≤20 sold-out PDPs (HTML GET, throttled): detect back-in-stock capture (`swym`, `back in stock`, `notify me`, `restock`, `klaviyo-bis`, `bis`) | sold out with no capture = intent lost forever |
| Trust / checkout | `/policies/shipping-policy`, `/policies/refund-policy` return 200 and are linked from the homepage HTML | trust signals missing before checkout |

Each finding: `stage, severity (high/med/low), count, examples[≤5 with URLs], recommendation`.

### 3.3 Outputs (per run) `out/<store-host>/<ISO-timestamp>/`
- `snapshot.json` — normalised catalogue (schema in design.md)
- `findings.json` — scorecard + restock table
- `restock_priority.csv`
- `report.html` — self-contained, no external assets, prints fine
- terminal summary (3 headline numbers + top 10 restock rows)

## 4. Parts 2 & 3 (essays) — theses to write from
Detailed outlines live in `docs/theses.md` (this repo). Agents draft from those; Ashish edits voice. Tone: plain, first person, no flattery to Swym, concrete mechanisms over adjectives, ≤900 words each.

## 5. Decisions log (made by Claude, approved by Ashish 2026-09-22)
| # | Decision | Why | Alternative rejected |
|---|---|---|---|
| D1 | TypeScript / Node 20, `npx tsx`, vitest | matches Ashish's profile and Shopify-app ecosystem; reviewers read it natively | Python (faster wrangling, off-profile) |
| D2 | Headline insight = Restock Priority / Demand Leakage | maps 1:1 to Swym's Back-in-Stock product and to Part 2's sample query | generic "SEO/CRO audit" (not intent-related) |
| D3 | Store chosen by spike agent from a shortlist against criteria (§6) | avoids guessing endpoint health; Ashish approves the pick | hard-coding a store now |
| D4 | Single-snapshot MVP; `diff` is P1 | 2–3 day budget | 48h snapshot loop |
| D5 | No runtime LLM | deterministic, cheaper to review, and keeps the MVP from being a usable product; design lives in the essay | `beacon ask` NL command |
| D6 | Public JSON + robots.txt respect, ≤2 req/s, backoff on 429 honouring Retry-After, disk cache | sandbox test showed Shopify 429s on bursts; also the ethical line | headless browser |
| D7 | Runs from Ashish's Mac, not a cloud IP | cloud IPs get rate-limited | CI run |
| D8 | Submission hub = public GitHub repo README; plus Loom (≤3 min) and a PDF mirror of the write-up | reviewer may not open the repo | repo only |
| D9 | Scores are indices, never currency | public data has no volumes; honesty > impressiveness | "revenue at risk ₹" |
| D10 | Essays drafted by agent from Ashish-approved theses, edited by Ashish | speed without losing his voice | Ashish writes from scratch |
| D11 | AI transcript = committed `docs/ai-workflow/` (WO, prompts log, exported Claude Code + Cowork transcripts) | exercise requires prompts + workflow | link to a chat only |
| D12 | Extras answer "Loom + PDF + repo only" read as Loom + PDF; repo stays the hub | selections were contradictory | — |
| D13 | Library-first packaging (`src/index.ts` public API, `exports` + `bin` in package.json); no API keys in MVP | Ashish's product view: Beacon eventually ships as an SDK/API with keys for merchants, headless stores and shopping agents; showing the library seam costs ~1 hour, building keys would be theatre on public data and breaks N7 | full SDK with key auth |

## 5a. Product direction note (Ashish's view, carried into the essays)
Beacon's durable form is an intelligence **API + JS SDK** (merchant API keys, per-store tenancy, rate plans) that a dashboard, Swym's own widgets, headless storefronts, and third-party/agent consumers (MCP-style) all call — the dashboard and NL chat are clients of it, not the product. This MVP shows the seam (library API + CLI client) and leaves keys, tenancy and hosting to the Part 2 design.

## 6. Store selection criteria (for the spike)
Must: Shopify storefront; `/products.json` and `/collections.json` return 200; 80–800 products; ≥30% products with multi-option variants (size/colour); ≥5% variants currently sold out; at least one merch collection (bestsellers/featured/new).
Prefer: Indian DTC brand (Bangalore context; INR pricing), Swym widget present on PDP (`swym` in HTML) — lets the report say "you already have Swym; here's where it's not switched on".
Shortlist to try (verify, don't assume): beminimalist.co, plumgoodness.com, mcaffeine.com, bombayshavingcompany.com, sleepyowl.co, bluetokaicoffee.com, boat-lifestyle.com, thesouledstore.com (verify Shopify), snitch.co.in (verify), bewakoof.com (likely not Shopify — skip if so). Fallback global: gymshark.com, allbirds.com.

## 7. Assumptions (state them in the README too)
- A1. Public storefront JSON reflects live availability (Shopify serves it from the same catalogue; can lag minutes).
- A2. Collection order approximates merchandising intent; "bestseller"-style handles approximate demand.
- A3. A sold-out variant on a merchandised product is intent lost; we cannot see how much.
- A4. Detection of back-in-stock capture by HTML markers is approximate (themes vary).
- A5. The reviewer runs on macOS/Linux with Node ≥20.

## 8. Risks
| Risk | Mitigation |
|---|---|
| Store blocks or throttles | cache, backoff, run from Mac, second store on shortlist |
| Store has few stock-outs on run day | criteria require ≥5%; spike checks the day before; fallback store |
| Heuristic looks arbitrary | show components per row; `methodology` section in report; weights in one file |
| Essays sound like AI | theses first, Ashish edits, forbidden-phrase list in WO |
| Scope creep | non-goals N1–N6 are hard; anything else → `openspec/changes/` |

## 9. Success criteria (reviewer's eyes)
- Runs first time; report opens; top-10 restock list is believable when spot-checked on the live store.
- Every stage of the journey has at least one evidenced finding or an explicit "no issue found".
- README explains in ≤1 screen what it does, what it can't, and why.
- Essays have at least three concrete failure modes with matching safeguards and a defensibility verdict with a reason someone could disagree with.

## 10. Timeline (2–3 days)
- Day 1 AM: Claude Code executes WO lanes 0 → A/B/C/D (parallel) → integration. Ashish: approve store pick.
- Day 1 PM: first real scan from Mac; fix what breaks; snapshot 1.
- Day 2: snapshot 2 (≥12h later) → `diff` if built; finalise report + README; edit essays.
- Day 3: Loom, PDF export, transcript export, push, submit.
