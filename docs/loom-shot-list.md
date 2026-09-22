# Loom shot list (≤3 minutes)

Record after the real scan (I.3–I.5) is done and `out/EXAMPLE/` exists — this list assumes the report on screen is the real one, not a fixture. Screen only, no need to show face. Keep narration to what's on screen; don't read the README out loud.

| Time | Shot | Say |
|---|---|---|
| 0:00–0:20 | Terminal, repo cloned fresh (`git clone …`, `cd beacon-takehome`) | "This is Beacon — it scans a Shopify store's public data and tells you which sold-out products are leaking the most demand, and what to restock first." |
| 0:20–0:45 | Run `npm i && npx beacon scan https://bluetokaicoffee.com` | "One install, one command, against a real store — Blue Tokai Coffee, an Indian DTC coffee brand. No account, no API key, nothing to configure." |
| 0:45–1:20 | Terminal output scrolls: progress lines, then the 3-number summary and top-10 restock table | "Under a minute, and it respects the store's own rate limits and robots.txt on the way. Here's the terminal summary — three headline numbers and the top of the restock list." |
| 1:20–2:00 | Switch to `report.html` open in the browser: headline numbers, restock table with component bars | "This is the full report — same run, opened as HTML. Every row shows the components behind the score, not just the number, so it's checkable, not a black box." |
| 2:00–2:25 | Scroll to the journey scorecard section | "Below the restock list is a five-stage scorecard — discovery, PDP quality, variant selection, intent capture, trust signals — each finding with evidence and a recommendation." |
| 2:25–2:50 | Switch to the live store in a browser tab, spot-check one restock row (e.g. open the #1 product page, show it's genuinely sold out and in the collection the report says) | "And here's the live store — the top restock pick really is sold out, really is on the bestsellers page. The numbers trace back to something real, not a demo fixture." |
| 2:50–3:00 | Back to the repo, `README.md` scrolled to the links section | "Everything else — the architecture and defensibility essays, the discovery framework, and the AI workflow log — is linked from the README." |

Total: ~3:00. If running long, cut the scorecard scroll (1:20–2:00 result can absorb a one-line mention instead) before cutting the live spot-check — the spot-check is what makes the report credible, per `docs/PRD.md §9`.
