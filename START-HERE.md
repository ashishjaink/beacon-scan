# Start here

1. These files sit at the repo root (`git init` there if not done). Open Claude Code in that folder (Opus or Sonnet — not Fable) and paste this kickoff prompt (also at the bottom of the WO, §7):

> Execute `WO-BEACON-01.md` as the orchestrator. Read the header inputs first. Run Lane 0 yourself, post the store pick, and wait for my "go <host>". Then launch Lanes A, B, C, D as four parallel subagents with the §3 prompts verbatim, gate G2, then run Lane I as a single subagent. Do not ask me to re-specify anything covered by the PRD, design, specs or tasks; log choices in `docs/decisions-during-build.md`. No commits. Post the §5 final report when done.

2. When Lane 0 posts the pick, reply `go <host>` (or `go <fallback>`).
3. After the final report: `npm run scan -- https://<host>` from your Mac. Paste failures back into Claude Code.
4. Day 2: second scan ≥12h later; `npx tsx src/cli.ts diff out/<host>/<run1> out/<host>/<run2>` if Lane B shipped diff.
5. Day 3: edit the three essays (remove the DRAFT comments), Loom per `docs/loom-shot-list.md`, PDF per `scripts/export-pdf.md`, export transcripts into `docs/ai-workflow/transcripts/` (this Cowork session + Claude Code sessions), commit, push, submit.

Files in this folder: `docs/PRD.md` (locked), `docs/theses.md` (your positions for Parts 2–3, edit freely before kickoff), `openspec/` (contracts the agents build against), `WO-BEACON-01.md` (the order).
