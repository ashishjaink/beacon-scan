# Exporting `Beacon-Submission-Ashish.pdf`

No new dependency goes into `package.json` for this — it's a one-off document export, not part of the scanned product. Use whichever of the two options below is already on your machine.

The PDF needs to stand on its own if a reviewer never opens the repo: page 1 must show the headline finding (with the example report screenshot) and the repo + Loom links, followed by all three essays. That means source order matters — `README.md` first (it already carries the headline, the screenshot, and the links table near the top), then the three essays.

## Option A — pandoc (preferred)

Install once if you don't have it:

```bash
brew install pandoc          # macOS
# or: apt-get install pandoc  # Linux
```

A PDF engine is also required — pandoc doesn't ship one. Use `weasyprint` (verified working 2026-09-23; the once-recommended `wkhtmltopdf` Homebrew cask has since been removed upstream — don't chase it):

```bash
brew install weasyprint
```

Then, from the repo root, after `out/EXAMPLE/` and `docs/img/report.png` exist (post-Lane I / Ashish's real run):

```bash
pandoc README.md docs/part2-architecture.md docs/part2-defensibility.md docs/part3-discovery.md \
  --pdf-engine=weasyprint \
  --resource-path=.:docs:docs/img \
  --metadata title="Beacon Friction Scanner — Ashish Jain Kothari" \
  -o Beacon-Submission-Ashish.pdf
```

If you'd rather use a LaTeX engine (`--pdf-engine=xelatex` after `brew install --cask mactex-no-gui` or similar), swap the engine flag — the rest of the command is unchanged. `--resource-path` is what lets the `docs/img/report.png` reference in `README.md` resolve correctly when the source files sit in different directories. Expect a few harmless `WARNING: Ignored ... unknown property` lines from weasyprint on modern CSS it doesn't support (e.g. `text-rendering: optimizeLegibility`) — cosmetic only, the PDF still renders correctly.

Before exporting, either remove the `<!-- DRAFT: Ashish to edit voice -->` comment from the top of each essay (it renders as nothing in the PDF either way — HTML comments are stripped by pandoc — but removing it once the voice pass is done is the actual sign-off) or leave it if the PDF is still a draft round.

## Option B — VS Code, no terminal tools

1. Install the **"Markdown PDF"** extension (yzane.markdown-pdf) from the VS Code marketplace.
2. Open `README.md`, run **Markdown PDF: Export (pdf)** from the command palette, confirm the `docs/img/report.png` image renders (VS Code resolves relative paths from the file's own location, so this should work unmodified).
3. Repeat for each essay: `docs/part2-architecture.md`, `docs/part2-defensibility.md`, `docs/part3-discovery.md` — each exports as its own PDF.
4. Merge the four PDFs into one (`README.pdf` first, then the three essays in order) with any PDF tool you have — macOS Preview does this via **File → Print → the "Combine PDFs" step is actually easier via `Automator`'s "Combine PDF Pages" quick action, or `pdfunite` if you have poppler installed** (`brew install poppler && pdfunite README.pdf part2-architecture.pdf part2-defensibility.pdf part3-discovery.pdf Beacon-Submission-Ashish.pdf`).

Option A produces the single merged file directly and is less fiddly; Option B is here for a machine without pandoc/a PDF engine installed and no interest in installing one.

## Either way

Confirm before submitting:
- [ ] Page 1 shows the one-sentence description, the three headline numbers, and the repo + Loom links (all present near the top of `README.md`).
- [ ] The example report screenshot is visible, not a broken image icon.
- [ ] All three essays are present, in Part 2 (architecture) → Part 2 (defensibility) → Part 3 (discovery) order.
- [ ] `Beacon-Submission-Ashish.pdf` opens cleanly and isn't added to `package.json` as a dependency of anything.
