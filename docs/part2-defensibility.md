# Part 2B — Standalone product or a Shopify feature?

Verdict: as a reporting layer it's a feature Shopify eventually absorbs; as an intent-to-action-to-measured-outcome loop it can stand on its own.

## Reasoning

Shopify already has orders, sessions, carts, checkouts, Sidekick, and distribution to every merchant on the platform. Any "what sold well" or "what's trending in my store" answer is theirs to give, and sooner or later they will — that's not a hard problem once you already hold the transaction data and the merchant base. What Shopify doesn't have is pre-purchase intent at the variant level, before the cart: wishlist adds, save-for-later, back-in-stock subscriptions. Swym's own widgets capture that, on the storefront, across roughly 45,000 stores. Shopify could have built the equivalent. They haven't, in over ten years. The installed base is the moat here. The idea isn't.

## Defensible layers, in order of strength

1. **Cross-merchant benchmarks derived from intent.** Category demand curves, size-curve norms, "your back-in-stock conversion is 4% against 11% for comparable stores." Shopify has little reason to publish cross-merchant intelligence about its own merchants to each other. Merchants want exactly this, and nobody else can give it to them from this angle.
2. **The closed loop.** Beacon says "restock X," Swym sends the back-in-stock alerts when X comes back, the system measures the lift. Every answer makes the next one slightly better. A dashboard doesn't do this. A loop with a number attached to it does.
3. **Multi-platform reach.** BigCommerce, Magento, Salesforce Commerce Cloud. Smaller today. Real for the long tail of enterprise merchants who were never on Shopify to begin with.

## Distribution as the moat, not just the data

An API and SDK let Beacon sit as the intelligence source inside tools merchants already use — Klaviyo flows, Shopify Flow, headless storefronts, shopping agents. That's harder for a platform to absorb than a dashboard tab, because each integration carries its own switching cost the moment something else depends on it being there.

## Where it dies

If Beacon is only charts drawn over Swym's own data, Shopify's analytics plus Sidekick turn it into a checkbox feature inside the platform, and there's no reason for a merchant to pay separately for a checkbox. There's a second, quieter way it dies: the intent data itself is thin per store for most of the 45,000. A single small store doesn't throw off enough wishlist or back-in-stock signal to be interesting on its own. Which is exactly why the benchmark layer — comparing across stores, not staring at one — has to be the thing that carries the product for small merchants, not the single-store view I built a toy version of for this exercise.

## Honest counter-argument

Shopify could restrict app data access, or ship a native wishlist and back-in-stock feature that closes the gap Swym's widgets currently fill. That's a platform-level risk, not a flaw in the product idea, and no amount of engineering on Beacon's side changes it. I don't think the mitigation is defensive at all — it's to be the system merchants actually act from, with a lift number they'd notice if it disappeared. A dashboard is a feature you can turn off without anyone downstream caring. A loop with a measured outcome attached to it is a habit, and habits are what's actually hard to replace with a checkbox.

<!-- word count: 559 -->
