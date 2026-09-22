# friction-engine

## ADDED Requirements

### Requirement: Restock priority ranking
`analyse(snapshot, markers, config, delta?)` SHALL emit one `RestockRow` per product with `leakage > 0`, computed exactly per `design.md §4`, sorted by `restockPriority` desc with ties broken by `leakage` then `medianPrice`, with `rank` starting at 1 and `reason` filled from the template.

#### Scenario: Merchandised product half sold out
- **WHEN** a product has 4 of 8 variants sold out, sits at position 2 of a 40-item "best-sellers" collection, appears in 3 collections, was updated 3 days ago, and is not discounted
- **THEN** `leakage = 0.5`, `components = {inMerch:1, position:0.95, breadth:0.6, recency:1, discounted:0, velocity:0}`, `demandProxy = 0.35+0.2375+0.09+0.15 = 0.8275`, and the row ranks above any product with `leakage ≤ 0.5` and `demandProxy < 0.8275` at equal price

#### Scenario: No stock-outs anywhere
- **WHEN** every variant in the snapshot is available
- **THEN** `restock` is `[]`, `headline.variantsSoldOut === 0`, and the report renders "No demand leakage detected on this run" instead of the table

### Requirement: Headline numbers
The engine SHALL fill `headline` with products scanned, sold-out/total variants, products with leakage>0 that are in ≥1 merch collection, and sold-out sampled PDPs lacking capture (`null` when nothing sampled).

#### Scenario: Nothing sampled
- **WHEN** `markers.sampled` is empty
- **THEN** `headline.soldOutPdpsWithoutCapture === null`

### Requirement: Journey scorecard
The engine SHALL emit exactly these Findings, one each, in this order, with `severity` from config thresholds per `design.md §5`: `discovery/orphan-products`, `discovery/sold-out-in-top-positions`, `pdp/low-image-count`, `pdp/short-description`, `pdp/colour-variants-without-image`, `variant/core-sizes-sold-out`, `intent-capture/sold-out-without-capture`, `trust/policies`.

#### Scenario: Orphans
- **WHEN** 30 of 300 products appear in no collection other than `all`/`frontpage`
- **THEN** `discovery/orphan-products` has `count 30, denominator 300, severity "medium"` (10% is within [5,15)) and 5 example URLs

#### Scenario: Core sizes out
- **WHEN** a product's size values are `[XS,S,M,L,XL,XXL]` and `M` and `L` are sold out
- **THEN** the product counts toward `variant/core-sizes-sold-out` with the note "core sizes M, L sold out"

#### Scenario: Colour-option product with missing variant images
- **WHEN** a product has an option named `Color` and 2 of 5 variants have `hasOwnImage:false`
- **THEN** the product counts toward `pdp/colour-variants-without-image`

#### Scenario: Capture present via Swym
- **WHEN** 12 PDPs are sampled and 3 lack any capture marker
- **THEN** `intent-capture/sold-out-without-capture` has `count 3, denominator 12, severity "medium"` (25% within [20,50)) and the recommendation names back-in-stock capture on those PDPs

### Requirement: Methodology block
The engine SHALL copy the effective weights and thresholds into `methodology.weights` and SHALL list every limit hit during collection plus the fixed assumptions A1–A5 in `methodology.limits`.

#### Scenario: Truncated catalogue
- **WHEN** `maxProducts` truncated the scan
- **THEN** `methodology.limits` contains a line starting with "catalogue truncated at"

### Requirement: Availability delta (P1)
`diff(snapshotA, snapshotB)` SHALL return `AvailabilityDelta` per `design.md §9`, and when passed to `analyse` SHALL set `components.velocity = 1` for products with any `soldThrough` variant.

#### Scenario: Variant sells through
- **WHEN** variant `M / Black` of `hoodie` is available in A and sold out in B
- **THEN** `delta.soldThrough` contains `{handle:"hoodie", variantTitle:"M / Black"}` and `hoodie`'s row has `components.velocity === 1`

### Requirement: Determinism
Given identical inputs, the engine SHALL produce byte-identical `findings.json` except `generatedAt`.

#### Scenario: Snapshot test
- **WHEN** `analyse` runs on the committed fixtures twice
- **THEN** the outputs are deep-equal after deleting `generatedAt`
