# submission-docs

## ADDED Requirements

### Requirement: README as submission hub
`README.md` SHALL, in this order and within ~1 screen before the fold: what the tool answers (one sentence), the headline finding from `out/EXAMPLE` with three numbers, `npm i && npx beacon scan <url>` quick start, links to the example report / Part 2 / Part 3 / AI workflow / Loom / PDF, and an "MVP boundary" section that lists PRD non-goals N1–N7 verbatim as "what this deliberately does not do".

#### Scenario: Reviewer with 3 minutes
- **WHEN** a reviewer reads only the README's first screen
- **THEN** they know the insight, the store, how to run it, and where each part of the exercise lives

### Requirement: Essays
`docs/part2-architecture.md`, `docs/part2-defensibility.md`, `docs/part3-discovery.md` SHALL be drafted from `docs/theses.md` following its voice rules, each ≤900 words, each starting with a one-sentence answer, and SHALL carry an HTML comment `<!-- DRAFT: Ashish to edit voice -->` at the top until Ashish removes it.

#### Scenario: Forbidden phrases
- **WHEN** the drafts are grepped for the forbidden words listed in `docs/theses.md`
- **THEN** there are zero matches

#### Scenario: Failure modes
- **WHEN** `docs/part2-architecture.md` is read
- **THEN** it contains a table with ≥6 failure modes each paired with a safeguard, plus a "before 50,000 stores" section

### Requirement: AI workflow folder
`docs/ai-workflow/` SHALL contain `README.md` (how the work was split between Ashish, Cowork planning and Claude Code lanes), `WO-BEACON-01.md` (copy), `prompts-log.md` (every prompt given to an agent, appended in order with timestamp and lane), and `transcripts/` (exports added by Ashish).

#### Scenario: Prompt appended per lane
- **WHEN** any lane starts
- **THEN** its agent's first action is appending its own prompt to `docs/ai-workflow/prompts-log.md` under a `## <timestamp> — Lane <X>` heading

### Requirement: Loom shot list and PDF
`docs/loom-shot-list.md` SHALL give a ≤3-minute sequence (clone → run → report → one spot-check on the live store → where the essays are). `scripts/export-pdf.md` SHALL describe producing `Beacon-Submission-Ashish.pdf` from README + the three essays (pandoc or VS Code markdown-pdf; no new deps in package.json).

#### Scenario: Reviewer skips the repo
- **WHEN** the PDF alone is opened
- **THEN** it contains the headline finding with the example report screenshot, all three essays, and the repo + Loom links on page 1
