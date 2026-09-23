# Part 3 — Discovery and prioritisation framework for Beacon

One-sentence answer: find the pain at the moment it happens instead of asking about it afterward, score candidate questions on frequency times severity times Swym's actual data advantage, and kill anything that doesn't lead to a Swym action within two cycles.

## The six steps

1. **Find pain at moments, not in surveys.** Stock-outs, launches, sale weeks, end of season. Talk to 8–10 merchants inside 48 hours of one of those moments and ask what they actually did, in what tool, and what they wish they'd known a week earlier. A survey answered three weeks later describes a memory, not the decision that got made.

2. **Mine what already exists before running new research.** Support tickets, feature requests, which Swym reports or exports actually get pulled and when, which dashboards nobody's opened in months. What merchants do with the tools they already have beats what they say they'd want in a new one — people are bad at predicting their own future behaviour and pretty accurate about their past frustration.

3. **Score candidate problems on four axes:** frequency, severity (money or time lost), Swym's actual data advantage (does intent data answer this uniquely, or would any analytics tool do just as well), and actionability (does the answer end in something Swym can execute, with a measurable result). Anything Shopify's own analytics answers just as well scores zero on advantage, no matter how it scores everywhere else. That fourth axis is the whole point — it's the filter that stops this from turning into a general-purpose BI tool with Swym's logo on it.

4. **Prioritise by learning-per-week, not by feature size.** The smallest version that puts a real answer in front of one design-partner merchant and measures whether they act on it. One question, one store archetype, ten merchants, two weeks. Not a quarter-long build for a question nobody's confirmed matters yet — I'd rather be wrong in week two than right in month four.

5. **Ship with kill criteria set before the launch, not after.** Adoption — do merchants come back to it weekly. Action rate — did the answer lead to an actual Swym send. Lift — did back-in-stock conversion or wishlist-to-purchase actually move. If action rate is under 20% after two cycles, the question gets retired. Not iterated on for another quarter out of sunk cost.

6. **Worked example: Beacon's first three questions.** Restock priority (back-in-stock subscribers plus wishlist velocity — the same shape of question this repo's `beacon-scan` answers with public data alone, minus the subscriber signal Swym actually has and I don't). Price-drop candidates (wishlisted, not converting, with a competitive price signal). Launch demand (coming-soon subscribers by variant, before the product even exists in inventory). None of these three are an accident of picking three examples — each one ends in a Swym send, a back-in-stock alert or a price-drop notification or a launch alert, so the lift is measurable by definition and not by a follow-up survey nobody fills out. A discovery framework that can't point at three questions like this at the end of it hasn't converged on anything a merchant would actually use — it's just produced a longer backlog.

<!-- word count: 537 -->
