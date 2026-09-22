# Fixtures

Recorded **2026-09-22** from the live storefront of the chosen store, `bluetokaicoffee.com` (see [`../../docs/spike-store-selection.md`](../../docs/spike-store-selection.md)). Real public data, throttled to ~1.8 req/s (under the 2 rps cap in `beacon.config.json`), `User-Agent: beacon-scan/0.1 (+https://github.com/ashishkothari/beacon-scan)`, `robots.txt` fetched and checked before every other request. Nothing in these files is fabricated or stripped — they are unmodified response bodies, pretty-printed where JSON.

## How they were recorded

Ad hoc Node script (throttled `fetch` + `fs.writeFile`), not part of the shipped CLI (the real collector in `src/collector/` implements the same logic against the live network; `collectOffline()` replays these files). Equivalent sequence, in order:

```bash
curl -sS -A "$UA" https://bluetokaicoffee.com/robots.txt
curl -sS -A "$UA" https://bluetokaicoffee.com/
curl -sS -A "$UA" "https://bluetokaicoffee.com/products.json?limit=250&page=1"
curl -sS -A "$UA" "https://bluetokaicoffee.com/products.json?limit=250&page=2"   # confirms the empty page that stops pagination
curl -sS -A "$UA" "https://bluetokaicoffee.com/collections.json?limit=250"
curl -sS -A "$UA" "https://bluetokaicoffee.com/collections/<handle>/products.json?limit=250"   # per recorded collection, see below
curl -sS -A "$UA" "https://bluetokaicoffee.com/products/<handle>"   # the 3 highest-leakage sold-out PDPs
```
(`$UA` = the `http.userAgent` string in `beacon.config.json`.)

## What's included, and what's deliberately not

- `robots.txt`, `home.html` — real, complete.
- `products.page1.json` — real, complete: all 190 products (the store has fewer than the 250-per-page limit, so one page holds everything). `products.page2.json` is the real (empty) second page, kept so pagination-stop logic has a real fixture to exercise.
- `collections.json` — real, complete: all 225 collections the store returns. **Not** all 225 have a matching `collection.<handle>.json` (see below) — treat that as an intentional fixture-recording bound, not a live-scan limitation (a real `collect()` run against the live store attempts every collection, subject to `maxProducts`/robots/time).
- `collection.<handle>.json` — recorded for the 5 merch collections (`coffee-beans`, `best-sellers-nav`, `best-selling-collection`, `bestsellers`, `new-to-coffee`) plus a handful of smaller, distinct niche collections (`gm-easy-pour-top`, `new-collection`, `subscription-coffees-new`, `test-best-selling-for-new-website`, plus two genuinely-empty ones, `new-arrivals-nav` and `new-coffee-subscription`/`events`, kept as real examples of an empty-but-real collection). **Deliberately dropped** three near-duplicate full-catalogue collections (`all`, `all-products-1`, `facebook-flexify` — each byte-identical to `products.page1.json`'s 190 products, just under a different handle) and several large generic/marketing buckets (`deals`, `india-brews`, `coffee-and-coffee-products`, `abandoned-cart-products`, `test-coffee-collection-for-sold-out`) that added ~7 MB with no distinguishing per-product signal beyond "is in some big bucket." `orphan-products` detection already treats `all`/`frontpage` as not counting as real collection membership per `design.md §4`, so this drop costs no scoring fidelity for that check; it does mean per-product `breadth` and any position data specific to those dropped buckets is undercounted versus a live scan — an accepted, logged fixture bound (see `docs/decisions-during-build.md` D-03).
- `pdp.<handle>.html` × 3 — the 3 sold-out products with the highest leakage (`soldOutVariants/totalVariants`) in the recorded catalogue, matching the "prefer highest leakage first" sampling rule in `design.md §8`/the store-collector spec.
- **No `policies.shipping.status` / `policies.refund.status` files.** This store's `robots.txt` disallows `/policies/*` and `/*/policies/*` for `*` — the collector must not fetch those paths (WO Hard Rule #3), online or offline. `collectOffline()` should reach the same "not checked" conclusion as a live run by parsing the recorded `robots.txt` fixture (same normalisation/robots-parsing code path as online, per the store-collector spec's offline-mode requirement) rather than by the absence of a status file. See `docs/decisions-during-build.md` D-02 for the schema change this required (`policies.{shipping,refund}` is nullable: `null` = not checked).

## `sample-findings.json`

Hand-written (task 0.6), not derived from these fixtures — it's Lane C's build target for the report/CLI layer, independent of the real store's numbers, and intentionally exercises every severity level including `"none"`.
