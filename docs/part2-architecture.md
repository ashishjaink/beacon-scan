# Part 2A — From a merchant's question to an answer

I don't let a language model touch a number, an identifier, or a query. It maps free text to one of a closed set of typed questions, a deterministic engine runs the actual computation against pre-aggregated tables, and the model only narrates rows it's handed back afterward. Everything below just makes that sentence hold up under pressure.

## Four layers, model only at the edges

**1. Question → typed query.** An LLM with structured output maps free text to a closed catalogue of answerable questions — `restock_priority`, `wishlist_to_purchase_leakage`, `price_drop_candidates`, `launch_demand` — each with slots: metric, filters (collection, tag, price band), a time window (30 days by default), `top_k`, ranking basis. Off-catalogue questions get "I can't answer that yet; closest I can do is X." No free SQL, ever, out of the model.

**2. Deterministic query engine over per-store intent tables.** Wishlist adds, saves, back-in-stock subscriptions, alert sends, alert-to-purchase conversions, availability, price history — pre-aggregated daily per product and variant. The typed query compiles to parameterised SQL, and `store_id` is bound by the engine itself, not passed in by the prompt.

**3. Answer composer.** Rows, evidence (which signals, which window), a recommended action Swym can actually execute (send a back-in-stock alert, a wishlist reminder), a confidence score. The model writes the sentence around the rows. It does not produce the rows — I keep saying this because it's the one rule everything else exists to protect.

**4. Clarify or assume.** "Restock first" is ambiguous — by subscriber count, by wishlist velocity, by revenue-weighted intent? Pick a default (back-in-stock subscribers plus half the 7-day wishlist velocity, weighted by price), say so in one line, and give the merchant a toggle if they disagree. Guessing silently is worse than guessing out loud.

**Worked example.** For restock priority, rank variants by `bis_subscribers_30d + 0.5 * wishlist_adds_7d`, weight by price, exclude discontinued tags, return the top 10 with a line like "14 shoppers waiting, 6 added to wishlist this week, last sold out on March 3." Every number in that sentence is a column in the row the model was handed. It's the same discipline this repo's own `renderReport()` follows — `Findings` in, HTML/CSV/terminal out, nothing else, no model involved yet — and the rule already holds.

## Failure modes and safeguards

| Failure mode | Safeguard |
|---|---|
| Hallucinated or drifting numbers | Numbers come only from the engine payload; every number in the narration must appear in a row, checked before the answer ships. |
| Ambiguous semantics ("best," "first," "recently") | Closed catalogue with a stated default; readings differing by >30% in result set trigger a clarifying question first. |
| Sparse data — most of 50,000 stores are small | Minimum-sample guard: below ~50 intent events, the answer is "not enough signal yet," not noise dressed as a ranking. |
| Stale or late pipelines | Every answer carries a freshness stamp; time-sensitive questions refuse data older than 24 hours. |
| Cross-tenant leakage | `store_id` bound inside the query engine, never accepted from the model or the prompt; fuzzed with adversarial prompts in a standing test suite. |
| Prompt injection via product titles or tags | Product text is data the model reads, never an instruction it follows — stripped from the prompt, only allow-listed fields reach it. |
| Catalogue drift — variants deleted or renamed | Rows resolve against the current catalogue at answer time; the answer says so: "3 items no longer exist." |
| Cost and latency at 50,000 stores | Canonical-question cache per store per day, precomputed top-N tables, a small model for routing, the larger one only for narration. |
| A merchant acts on a wrong answer | Every answer carries evidence, a confidence score, an expandable "why this rank," and feedback that feeds an eval set. |

## Delivery surface: API + SDK, dashboard as a client

The four layers sit behind one intelligence API — `POST /v1/ask`, `GET /v1/insights/restock` — not behind a dashboard. Consumers: Swym's merchant dashboard, the natural-language chat, Swym's own storefront widgets acting on an answer, headless storefronts, third-party or agent consumers. A thin JS SDK (`@swym/beacon`) wraps the common cases. Keys are per store, scoped to read-only or action-triggering, rate-planned, rotatable. `store_id` is derived from the key on the server, never accepted as a caller-supplied parameter — that's exactly the cross-tenant leak two rows up in that table. This MVP's repo mirrors the seam on purpose, at essentially no cost: `scanStore()` is the library call, the CLI is one client of it, a hosted API would be another.

## Before launching to 50,000 stores

A golden question-and-answer eval set per store archetype: fashion with sizes, beauty with replenishment cycles, single-SKU brands. Shadow mode — generate answers, don't show them, compare against what an analyst would say. Cohort rollout, 1% then 10% then everyone, with a kill switch at every step. Per-answer logging with a hash of the payload it came from, so any answer is replayable months later. Cost and abuse budgets per store, so one heavy user doesn't spend the shared budget for everyone else. And an "I don't know" rate tracked as its own health metric — too low is as much a warning sign as too high; it usually means a refusal guard isn't firing when it should.

<!-- word count: 897 -->
