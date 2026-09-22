<!-- DRAFT: Ashish to edit voice -->
# Part 2B — Standalone product or a Shopify feature?

Verdict: as a reporting layer, it's a feature Shopify will eventually absorb; as an intent-to-action-to-measured-outcome loop, it can stand on its own.

## Reasoning

Shopify already has orders, sessions, carts, checkouts, Sidekick, and distribution to every merchant on the platform. Any "what sold well" or "what's trending in my store" answer is theirs to give, and at some point they will give it — that's not a hard problem once you already hold the transaction data and the merchant base. What Shopify doesn't have is pre-purchase intent at the variant level, before the cart: wishlist adds, save-for-later, back-in-stock subscriptions. That's captured by Swym's own widgets on the storefront, across roughly 45,000 stores. Shopify could build the equivalent widgets. They haven't in over ten years. The installed base is the moat here, not the idea behind it.

## Defensible layers, in order of strength

1. **Cross-merchant benchmarks derived from intent.** Category demand curves, size-curve norms, "your back-in-stock conversion is 4% against 11% for comparable stores." Shopify has little reason to publish cross-merchant intelligence about its own merchants to each other, and merchants want exactly this.
2. **The closed loop.** Beacon says "restock X," Swym sends the back-in-stock alerts when X comes back, and the system measures the lift. Every answer makes the next one better. A reporting dashboard doesn't do this; an action-and-measurement loop does.
3. **Multi-platform reach.** BigCommerce, Magento, Salesforce Commerce Cloud. Smaller today, but real for the long tail of enterprise merchants who aren't on Shopify at all.

## Distribution as the moat, not just the data

An API and SDK let Beacon sit as the intelligence source inside tools merchants already use — Klaviyo flows, Shopify Flow, headless storefronts, shopping agents. That's harder for a platform to absorb than a dashboard tab, because each integration carries its own switching cost once it's live and other systems depend on it.

## Where it dies

If Beacon is only charts drawn over Swym's own data, Shopify's analytics plus Sidekick turn it into a checkbox feature inside the platform, and there's no reason for a merchant to pay separately for it. The intent data itself is also thin per store for most of the 45,000 — a single small store doesn't generate enough wishlist or back-in-stock signal to be interesting on its own, which is exactly why the benchmark layer, comparing across stores, has to carry the product for small merchants rather than the single-store view.

## Honest counter-argument

Shopify could restrict app data access, or ship a native wishlist and back-in-stock feature that closes the gap Swym's widgets currently fill. That risk is platform-level, not a flaw in this specific product idea, and no amount of engineering here changes it. The mitigation isn't defensive — it's to be the system merchants actually act from, with a lift number they can see and would notice missing. A dashboard is a feature. A loop with a measured outcome attached to it is harder to replace with a checkbox.

<!-- word count: 506 -->
