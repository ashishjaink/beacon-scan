# Change: beacon-mvp

## Why
The Swym take-home requires a working, executable tool that delivers an actionable insight about one online store from public data, plus written answers on architecture, defensibility and discovery. Nothing exists yet. We want a bounded MVP (PRD §1) that proves judgment about intent data without being a product Swym could adopt as-is.

## What Changes
- **ADD** `store-collector`: fetch + normalise a Shopify store's public catalogue into `StoreSnapshot`, with robots.txt respect, throttling, backoff, disk cache, and an offline fixtures mode.
- **ADD** `friction-engine`: pure functions computing Restock Priority rows and the five-stage journey scorecard from a `StoreSnapshot` (+ a small PDP-marker input), producing `Findings`.
- **ADD** `report`: `Findings` → `restock_priority.csv`, self-contained `report.html`, terminal summary.
- **ADD** `cli`: `beacon scan <url>`, `beacon report <run-dir>`, `beacon diff <run-a> <run-b>` (P1).
- **ADD** `submission-docs`: README, `docs/part2-architecture.md`, `docs/part2-defensibility.md`, `docs/part3-discovery.md`, `docs/ai-workflow/` (WO, prompts log, transcript exports), Loom shot list, PDF export script.

## Impact
- New repo `beacon-scan` (TypeScript). No existing code affected.
- External: read-only public HTTP to one Shopify store.

## Out of scope (hard)
PRD non-goals N1–N7: no service, scheduler, multi-store, UI, runtime LLM, Swym integration, ML, headless browser, API keys/auth/tenancy (library-first seam only).
