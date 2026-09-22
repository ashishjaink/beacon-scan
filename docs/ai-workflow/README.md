# AI workflow

This folder is the transparent record the exercise asks for: what was asked of an AI agent, when, and how the work was split between Ashish and Claude. It's meant to be read alongside `docs/decisions-during-build.md`, which is where the model logged judgment calls it made along the way instead of guessing silently.

## Contents

- **`README.md`** — this file: the workflow split, and the reflection below.
- **`WO-BEACON-01.md`** — a verbatim copy of the work order issued at the repo root, the single document that defines scope, hard rules, and every lane's prompt.
- **`prompts-log.md`** — every prompt given to an agent, in order, appended by that agent itself as its first action and closed out with a short report as its last. Nothing is reconstructed after the fact; each lane wrote its own entry while it worked.
- **`transcripts/`** — full session exports (Claude Code and the earlier Cowork planning session), added by Ashish once the build finishes. Empty until then.

## How the work was split

| Who / what | Did |
|---|---|
| **Ashish** | Wrote the take-home brief into a PRD, made every numbered decision in `docs/PRD.md §5` (D1–D13) and any later ones logged in `docs/decisions-during-build.md`, approved the store pick, ran the real scans from his own Mac (cloud IPs get rate-limited — D7), edited the essay voice, and owns every commit and the submission itself. |
| **Cowork planning session** | Where the PRD, the OpenSpec change (`openspec/changes/beacon-mvp/`), and the work order (`WO-BEACON-01.md`) got written and locked, before any code existed. |
| **Claude Code — Lane 0** | Verified the store shortlist against PRD §6's criteria, scaffolded the repo, froze the type contracts, recorded fixtures, wrote the hand-made sample findings Lane C builds against. |
| **Claude Code — Lanes A/B/C/D (parallel)** | Collector, scoring engine, report + CLI, and this documentation set, each working only in its own file paths against the frozen contracts, offline from fixtures. |
| **Claude Code — Lane I** | Integration: wires the real modules together, runs the offline end-to-end checks, produces the first report artefact, and reports what's left for Ashish. |

The instinct behind the split: anything that's a judgment call about the product, the store, or the voice stays with Ashish. Anything that's mechanical once the contracts are frozen — implementing a spec, running formulas, writing HTML from a template — goes to a lane working in isolation against those contracts, so four lanes can run at once without stepping on each other.

## Reflection

*(Written from `prompts-log.md` and `docs/decisions-during-build.md` as they stand while Lane D is working — Lane I does a final pass on this section once every lane has reported.)*

What got delegated: writing the OpenSpec change and the work order itself, scaffolding the repo, running four lanes in parallel against disjoint file sets, and drafting all three essays from Ashish's own theses (`docs/theses.md`). The theses — the actual opinions, the architecture, the defensibility verdict — are Ashish's; the drafting into essay prose with the voice rules applied is delegated, then edited back by Ashish before submission.

What stayed human: every decision that isn't mechanical. The store pick needed Ashish's sign-off even though Lane 0 proceeded on its own contingency clause rather than block the build; the theses themselves; the final essay voice; and anything the work order marks non-negotiable — no runtime LLM, no API keys, scores as indices never currency. A model choosing a store or a scoring weight without a human checking it is exactly the failure mode Part 2's architecture essay argues against, so the same discipline applied to building this repo, not just to the product idea inside it.

What went wrong and got corrected, in the open rather than silently: Lane 0's D-01 found that the PRD's literal "≥30% multi-option variants" store-selection criterion isn't met by any real candidate store, including both fallbacks — it reinterpreted the criterion against what the criterion is actually for (a signal for the size-curve check) and logged the full reasoning and raw numbers rather than quietly picking a store that looked compliant on paper. D-02 found that `bluetokaicoffee.com`'s `robots.txt` blocks `/policies/*` for every bot, which meant the original type contract couldn't tell "policy confirmed missing" apart from "not allowed to check" — collapsing that to a plain `false` would have been a factually wrong claim in the report, so the schema was fixed before any lane started building against it. Both are small in code-diff terms but real in the kind of build-time error they're an instance of: an AI agent should log an interesting or ambiguous call transparently and keep moving, not guess and hide the guess.

Where the transcript lives: `prompts-log.md` in this folder has the full prompt for every lane, appended by that lane as its own first action, so the record isn't reconstructed after the fact. `docs/decisions-during-build.md` has every deviation, each attributed and timestamped. `transcripts/` gets the raw session exports once Ashish adds them.
