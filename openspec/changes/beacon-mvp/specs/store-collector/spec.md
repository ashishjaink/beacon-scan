# store-collector

## ADDED Requirements

### Requirement: Shopify detection
The collector SHALL determine whether a URL is a Shopify storefront by fetching `/products.json?limit=1` and validating the response shape, and SHALL fail with `NOT_SHOPIFY` or `ENDPOINT_DISABLED` otherwise.

#### Scenario: Non-Shopify site
- **WHEN** `scan https://example.com` is run and `/products.json` is not JSON with a `products` array
- **THEN** the CLI exits 1 with code `NOT_SHOPIFY` and a hint naming the two shortlist fallbacks from `docs/PRD.md §6`

#### Scenario: Endpoints disabled
- **WHEN** `/products.json` returns 403 or 404 on a host whose homepage HTML contains `cdn.shopify.com`
- **THEN** the CLI exits 1 with code `ENDPOINT_DISABLED`

### Requirement: Robots and rate limits
The collector SHALL fetch `/robots.txt` first, SHALL skip any path disallowed for user-agent `*`, SHALL send at most `http.rps` requests per second with `http.concurrency` in flight, SHALL retry 429/5xx with exponential backoff honouring `Retry-After` up to `http.maxRetries`, and SHALL fail with `RATE_LIMITED` after that.

#### Scenario: Burst of 429s
- **WHEN** the store answers 429 with `Retry-After: 2` on the third page
- **THEN** the collector waits ≥2s before retrying, logs one line to stderr, and continues

#### Scenario: Disallowed path
- **WHEN** robots.txt disallows `/collections/*/products.json` for `*`
- **THEN** the collector skips per-collection fetches, sets every product's `collections` to `[]`, and adds `"collection positions unavailable (robots.txt)"` to `Findings.methodology.limits`

### Requirement: Full catalogue pagination
The collector SHALL page `/products.json` and `/collections.json` with `limit=250` until an empty page or `limits.maxProducts` is reached, and SHALL record the truncation in `stats` and `methodology.limits`.

#### Scenario: Store with 612 products
- **WHEN** scanning with default limits
- **THEN** `snapshot.products.length === 612` and `stats.requests` counts 3 product pages plus collection pages

### Requirement: Normalisation
The collector SHALL map raw Shopify JSON to `StoreSnapshot` per `design.md §2`, parsing prices to numbers, stripping HTML from `body_html` for `descriptionChars`, computing `hasOwnImage`, and attaching each product's `{handle, position, size}` for every collection it appears in.

#### Scenario: Variant with null compare_at_price
- **WHEN** a variant has `"compare_at_price": null` and `"price": "1299.00"`
- **THEN** the normalised variant has `compareAtPrice: null` and `price: 1299`

### Requirement: Disk cache
The collector SHALL cache every successful GET under `.cache/<host>/` keyed by path, SHALL reuse entries younger than 6h unless `--no-cache`, and SHALL count reuse in `stats.cacheHits`.

#### Scenario: Second run within 6h
- **WHEN** `scan` is run twice in a row
- **THEN** the second run makes 0 network requests for cached paths and `stats.cacheHits > 0`

### Requirement: PDP marker sampling
The collector SHALL sample up to `limits.pdpSample` products that have ≥1 sold-out variant, preferring products with the highest leakage, SHALL GET each PDP HTML once, and SHALL emit `PdpMarkers` with `hasBisCapture` true when any configured marker string is found (case-insensitive) and `hasSwym` when `swym` is found.

#### Scenario: Store using Swym
- **WHEN** a sampled PDP's HTML contains `swym-button`
- **THEN** its entry has `hasSwym: true`, `hasBisCapture: true`, `markers: ["swym-button"]`

### Requirement: Policies and homepage
The collector SHALL request `/policies/shipping-policy` and `/policies/refund-policy` (HEAD or GET, following redirects) and the homepage, and SHALL set `policies.{shipping,refund,linkedFromHome}`.

#### Scenario: Refund policy missing
- **WHEN** `/policies/refund-policy` returns 404
- **THEN** `policies.refund === false`

### Requirement: Offline fixtures mode
`collectOffline(dir)` SHALL produce a `StoreSnapshot` and `PdpMarkers` from the files listed in `design.md §8` without network, and SHALL be the input for all engine and e2e tests.

#### Scenario: Missing fixture file
- **WHEN** `collection.<handle>.json` is absent for a listed collection
- **THEN** the collector treats it as an empty collection and records the gap in `methodology.limits`
