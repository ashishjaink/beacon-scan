# Theses for Parts 2 & 3 (Ashish's positions — agent drafts from these, Ashish edits)

Voice rules: first person, plain, concrete. No "excited", "passionate", "leverage", "delve", "robust", "seamless", "game-changing", "unlock". No praise of Swym. Every claim has a mechanism or an example. ≤900 words per essay. Tables allowed, bullets sparingly.

---

## Q4. From a merchant's question to an answer ("Which products should I restock first?")

### Architecture (four layers, LLM only at the edges)
1. **Question → typed query.** LLM with structured output maps free text to a closed catalogue of answerable questions (`restock_priority`, `wishlist_to_purchase_leakage`, `price_drop_candidates`, `launch_demand`, …) with slots: metric, filters (collection, tag, price band), window (default 30d), top_k, ranking basis. Out-of-catalogue → "I can't answer that yet; closest I can do is X." Never free SQL from the model.
2. **Deterministic query engine over per-store intent tables.** Pre-aggregated daily by product/variant: wishlist adds, saves, back-in-stock subscribers, alert sends, alert→purchase conversions, current availability, price history. Query compiles to parameterised SQL scoped by `store_id` at the engine, not the prompt.
3. **Answer composer.** Returns rows + evidence (which signals, which window) + a recommended action that Swym can execute (send BIS alert, wishlist reminder) + confidence. The LLM narrates from the rows only; the numbers are in the payload, not generated.
4. **Clarify or assume.** "Restock first" is ambiguous (by subscriber count? by wishlist velocity? by revenue-weighted intent?). Default = BIS subscribers × wishlist velocity, weighted by price, and the answer states the assumption in one line with a toggle.

Worked example for the restock question: rank variants by `bis_subscribers_30d + 0.5*wishlist_adds_7d`, weight by price, exclude discontinued tags, show top 10 with "N shoppers waiting, M added to wishlist this week, last sold out on <date>".

### Failure modes → safeguards (pick ≥6 for the essay)
| Failure mode | Safeguard |
|---|---|
| Hallucinated or drifting numbers | numbers only from engine payload; narration validated against payload (every number in prose must appear in rows) |
| Ambiguous semantics ("best", "first", "recently") | closed catalogue + stated default + clarification when two readings diverge by >30% in result set |
| Sparse data (most of 50K stores are small) | minimum-sample guards; answer "not enough signal yet (need ~50 intent events)"; no ranking below threshold |
| Stale/late pipelines | freshness stamp on every answer; refuse if data >24h old for time-sensitive questions |
| Cross-tenant leakage | store_id bound in engine; query compiler never takes identifiers from the model; tests that fuzz prompts |
| Prompt injection via product titles/tags | product text treated as data, never instructions; strip from prompts; allow-list fields |
| Catalogue drift (variants deleted/renamed) | resolve to current catalogue at answer time; flag "3 items no longer exist" |
| Cost and latency at scale | canonical question cache per store/day; precomputed top-N tables; small model for routing, large only for narration |
| Merchant acts on a wrong answer | evidence + confidence on every answer; "why this rank" expandable; feedback button feeding an eval set |
| Seasonality/currency/locale | windows relative to store's own baseline; currency from store settings, never inferred |

### Delivery surface: API + SDK, dashboard as a client
The four layers sit behind one intelligence API (`POST /v1/ask`, `GET /v1/insights/restock`, …). Consumers: Swym's merchant dashboard, the NL chat, Swym's own storefront widgets (to act on an answer), headless storefronts, and third-party or agent consumers. A thin JS SDK (`@swym/beacon`) wraps it. Keys are per store, scoped (read insights / trigger actions), rate-planned, rotatable, and the `store_id` is derived from the key server-side — never accepted from the caller. The MVP repo mirrors this seam: `scanStore()` is the library, the CLI is one client.

### Before launching to 50,000 stores
Golden Q→A eval set per store archetype (fashion/sizes, beauty/replenishment, single-SKU); shadow mode (answers generated, not shown, compared to analyst answers); cohort rollout 1% → 10% → all with a kill switch; per-answer logging with payload hashes; abuse and cost budgets per store; an "I don't know" rate tracked as a health metric (too low is as bad as too high).

---

## Q5. Standalone product or a Shopify feature?

Verdict: **as a reporting layer it is a feature Shopify will absorb; as an intent → action → measured-outcome loop it can stand alone.** Reasoning:

- What Shopify has: orders, sessions, carts, checkouts, Sidekick, and distribution to every merchant. Any "what sold well / what's trending in my store" answer is theirs to give, and they will.
- What Shopify does not have: pre-purchase intent at variant level before the cart (wishlist, save-for-later, BIS subscriptions) — that is captured by Swym's widgets on the storefront, across ~45K stores. Shopify could build the widgets, but hasn't in 10+ years and the installed base is the moat, not the idea.
- Defensible layers, in order of strength: (1) cross-merchant benchmarks derived from intent (category demand curves, size-curve norms, "your BIS conversion is 4% vs 11% for similar stores") — Shopify won't publish cross-merchant intelligence, merchants want it; (2) the closed loop — Beacon says "restock X", Swym sends the BIS alerts when X returns, and measures the lift; every answer improves the next; (3) multi-platform (BigCommerce, Magento, Salesforce) — smaller today, real for the long tail of enterprise.
- Distribution as a moat, not just data: an API/SDK lets Beacon be the intelligence source inside tools merchants already use (Klaviyo flows, Shopify Flow, headless fronts, shopping agents) — harder to absorb than a dashboard tab, because the integrations accrete.
- Where it dies: if Beacon is only charts over Swym's own data, Shopify's analytics + Sidekick make it a checkbox. Also if the intent data is thin per store (it is, for most of the 45K), the product needs the benchmark layer to be useful to small merchants at all.
- Honest counter-argument: Shopify could restrict app data access or bundle a native wishlist; the risk is platform, not product. Mitigation is being the system merchants *act* from, with lift they can see.

---

## Q6. Discovery and prioritisation framework for Beacon

1. **Find pain at moments, not in surveys.** Stock-outs, launches, sale weeks, end-of-season. Talk to 8–10 merchants inside 48h of one of those moments; ask what they did, in what tool, and what they wished they had known a week earlier.
2. **Mine what already exists.** Support tickets, feature requests, which Swym reports/exports get pulled and when, which dashboards go untouched. Behaviour beats stated preference.
3. **Score candidate problems** on frequency × severity (money or time lost) × Swym's unfair advantage (does intent data uniquely answer it?) × actionability (does the answer end in a Swym action with measurable lift?). Anything Shopify's own analytics answers as well scores zero on advantage.
4. **Prioritise by learning-per-week.** Smallest thing that puts an answer in front of a design-partner merchant and measures whether they act. One question, one archetype, 10 merchants, two weeks.
5. **Ship with kill criteria.** Adoption (weekly return rate), action rate (answers that led to a Swym action), lift (BIS conversion, wishlist→purchase). If action rate <20% after two cycles, retire the question.
6. **Example for Beacon's first three questions:** restock priority (BIS + wishlist), price-drop candidates (wishlisted, not converting, competitive price signals), launch demand (coming-soon subscribers by variant). All three end in a Swym send.

---

## Q7. AI workflow reflection (short; write last, from the actual log)
What was delegated (spec writing, scaffolding, parallel lanes, drafting), what was kept human (decisions D1–D12, store approval, voice, judgment calls in the essays), what went wrong and was corrected, and where the transcript lives.
