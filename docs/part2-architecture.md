<!-- DRAFT: Ashish to edit voice -->
# Part 2A — From a merchant's question to an answer

I don't let a language model touch a number or write a query. It maps free text to one of a closed set of typed questions, a deterministic engine runs the computation against pre-aggregated tables, and the model only narrates rows it's handed back afterward.

## Four layers, model only at the edges

**1. Question → typed query.** An LLM with structured output maps free text to a closed catalogue of answerable questions — `restock_priority`, `wishlist_to_purchase_leakage`, `price_drop_candidates`, `launch_demand` — each with slots: metric, filters (collection, tag, price band), a time window (30 days default), `top_k`, ranking basis. Off-catalogue questions get "I can't answer that yet; closest I can do is X." The model never generates free SQL.

**2. Deterministic query engine over per-store intent tables.** Wishlist adds, saves, back-in-stock subscriptions, alert sends, alert-to-purchase conversions, availability, and price history are pre-aggregated daily per product and variant. The typed query compiles to parameterised SQL. `store_id` is bound by the engine itself, not passed in by the prompt — the model never sees or supplies a tenant identifier.

**3. Answer composer.** The response is rows, plus evidence (which signals, which window), a recommended action Swym can execute (send a back-in-stock alert, a wishlist reminder), and a confidence score. The model writes the sentence around the rows; it does not produce the rows.

**4. Clarify or assume.** "Restock first" is ambiguous — by subscriber count, wishlist velocity, or revenue-weighted intent? Default is back-in-stock subscribers plus half the 7-day wishlist velocity, weighted by price, and the answer states that assumption in one line with a toggle to change it.

**Worked example.** For restock priority, the engine ranks variants by `bis_subscribers_30d + 0.5 * wishlist_adds_7d`, weights by price, excludes discontinued tags, and returns the top 10 with a line like "14 shoppers waiting, 6 added to wishlist this week, last sold out on March 3." Every number in that sentence is a column in the row the model was given — nothing is generated.

## Failure modes and safeguards

| Failure mode | Safeguard |
|---|---|
| Hallucinated or drifting numbers | Numbers come only from the engine payload; every number in the narration must appear in a row, checked before the answer ships. |
| Ambiguous semantics ("best," "first," "recently") | Closed catalogue with a stated default; readings differing by >30% in result set trigger a clarifying question first. |
| Sparse data — most of 50,000 stores are small | Minimum-sample guard: below ~50 intent events, the answer is "not enough signal yet," not noise dressed as a ranking. |
| Stale or late pipelines | Every answer carries a freshness stamp; time-sensitive questions refuse data older than 24 hours. |
| Cross-tenant leakage | `store_id` bound inside the query engine, never accepted from the model or prompt; fuzz-tested with adversarial prompts in a standing test suite. |
| Prompt injection via product titles or tags | Product text is data the model reads, never an instruction it follows; stripped from the prompt, only allow-listed fields reach it. |
| Catalogue drift — variants deleted or renamed | Rows resolve against the current catalogue at answer time; the answer flags it: "3 items no longer exist." |
| Cost and latency at 50,000 stores | Canonical-question cache per store per day, precomputed top-N tables, a small model for routing, the larger only for narration. |
| A merchant acts on a wrong answer | Every answer carries evidence, a confidence score, an expandable "why this rank," and feedback that feeds an eval set. |

Any six of these hold the shape — the constant is that nothing generative touches a number, an identifier, or a query.

## Delivery surface: API + SDK, dashboard as a client

The four layers sit behind one intelligence API — `POST /v1/ask`, `GET /v1/insights/restock` — not behind a dashboard. Consumers are Swym's merchant dashboard, the natural-language chat, Swym's storefront widgets acting on an answer, headless storefronts, and third-party or agent consumers. A thin JS SDK (`@swym/beacon`) wraps the API for the common cases. Keys are per store, scoped to what they're allowed to do (read insights, or also trigger actions), rate-planned, and rotatable. `store_id` is derived from the key on the server — never accepted as a parameter from the caller, since a caller-supplied tenant ID is exactly the cross-tenant leak in the table above. This MVP's repo mirrors that seam on purpose: `scanStore()` is the library call, the CLI one client of it, a hosted API would be another.

## Before launching to 50,000 stores

A golden question-and-answer eval set per store archetype (fashion with sizes, beauty with replenishment cycles, single-SKU brands). A shadow mode that generates answers without showing them and compares them against what an analyst would say. A cohort rollout — 1%, then 10%, then everyone — with a kill switch at each step. Per-answer logging with a hash of the payload it was generated from, so any answer can be replayed later. Cost and abuse budgets per store, so one heavy user doesn't burn the shared budget. And an "I don't know" rate tracked as its own health metric — too low is as much a warning sign as too high, since it usually means a refusal guard isn't firing when it should.

<!-- word count: 890 -->
