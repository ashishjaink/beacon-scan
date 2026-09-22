# Spike: store selection

Run 2026-09-22, throttled to ~1.8 req/s (under the 2 rps cap), UA `beacon-scan/0.1 (+https://github.com/ashishkothari/beacon-scan)`, robots.txt checked before every host's first non-robots request.

## Result

**Pick: `bluetokaicoffee.com`. Fallback: `gymshark.com`.**

Full reasoning and the deviation from the literal Must-criterion reading are logged in [`decisions-during-build.md` §D-01](decisions-during-build.md#d-01-store-pick-bluetokaicoffeecom-fallback-gymsharkcom). This posts the pick and proceeds per WO §2's own contingency ("if no answer arrives within the session, proceed with the pick and flag it") rather than blocking the whole build on a reply — happy to re-run this spike against a different host if you'd rather use one.

## Data

| Host | Shopify? | robots.txt | products.json | collections.json | Product count (capped 800) | Variants sold out | % w/ real size option | Merch collection? | `swym` on sampled PDP |
|---|---|---|---|---|---|---|---|---|---|
| beminimalist.co | yes | 200 | 200 | 200 | 79 | 7.5% | n/a (0% ≥2-axis) | yes (`best-sellers`, `new-launches`) | no |
| plumgoodness.com | yes | 200 | 200 | 200 | 414 | 3.0% | n/a | yes (`best-sellers`, `plum-best-offers`) | no |
| mcaffeine.com | yes | 200 | 200 | 200 | 185 | 3.8% | n/a | yes (`bestsellers`) | no |
| bombayshavingcompany.com | yes | 200 | 200 | 200 | 214 | 17.5% | 1.4% | yes (`best-for-you`) | no |
| sleepyowl.co | yes | 200 | 200 | 200 | 74 | 30.1% | 8.1% | yes (`best-sellers`) | no |
| **bluetokaicoffee.com** | **yes** | **200 (disallows `/policies/*`)** | **200** | **200** | **190** | **21.2%** | **67.9%** | **yes** (`coffee-beans`, `best-sellers-nav`, `bestsellers`) | no (generic BIS markers present) |
| boat-lifestyle.com | yes | 200 | 200 | 200 | 800 (capped) | 65.2% | 1% | yes | no |
| thesouledstore.com | **no / unverified** | 200 | 200 but not JSON `products` shape | — | — | — | — | — | — |
| snitch.co.in | **no (blocked)** | 200, disallows `/products.json` | — (skipped, robots) | — | — | — | — | — | — |
| gymshark.com (fallback) | yes | 200 | 200 | 200 | 800 (capped) | 55.1% | 99.9% | yes | no |
| allbirds.com (fallback) | yes | 200 | 200 | 200 | 294 | 79.5% | 99.7% | yes | no |

"% w/ real size option" = products with an option named like size/sz/waist or whose values mostly resolve to a known/ordinal size set — the signal that actually drives the variant-selection (size-curve) scorecard check, as opposed to the PRD's literal "≥2 option axes" reading, which no candidate meets (see decision log).

## PRD §6 criteria check for the pick (`bluetokaicoffee.com`)

| Criterion | Type | Result |
|---|---|---|
| Shopify storefront | Must | Pass |
| `/products.json`, `/collections.json` return 200 | Must | Pass |
| 80–800 products | Must | Pass (190) |
| ≥30% multi-option products | Must | Not met literally (28.9% by raw ≥2-axis count); met on the operative size-depth signal (67.9%) — see decision log D-01 |
| ≥5% variants sold out | Must | Pass (21.2%) |
| ≥1 merch collection | Must | Pass (`coffee-beans`, `best-sellers-nav`, `best-selling-collection`, `bestsellers`, `new-to-coffee`) |
| Indian DTC (Bangalore context, INR) | Prefer | Pass (Indian coffee DTC brand, INR pricing) |
| Swym widget on PDP | Prefer | Not met — no `swym` marker found; generic back-in-stock markers present instead, which the report frames as "you have a capture mechanism but it isn't Swym" |

## Known limitation surfaced by the spike

`bluetokaicoffee.com`'s `robots.txt` disallows `/policies/*` for all bots — a store-specific rule (not the Shopify default; verified by checking 5 other candidates, none of which have it). The collector will not fetch `/policies/shipping-policy` or `/policies/refund-policy` on this store, per robots compliance (WO Hard Rule #3). This surfaced a gap in the frozen type contract (`policies.{shipping,refund}` couldn't represent "not checked" vs. "confirmed missing") — fixed in `src/types.ts` before any lane started; see decision log D-02. The report will state this plainly rather than fabricate a "policy missing" claim.
