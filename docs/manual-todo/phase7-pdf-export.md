# Phase 7 — PDF export (deferred)

**Status:** deferred after shipping markdown / hypotheses / Slack clipboard exports.
**Last revisited:** 2026-04-20

## What's shipped

- [x] Markdown brief (Minto-structured) → clipboard
- [x] Hypothesis cards → clipboard
- [x] Slack 5-line summary → clipboard

All three wired on Insights toolbar Export dropdown. `api.exportBrief(topic, format)` calls the Python `research export-brief` command; result is copied with a toast.

## What's deferred

- [ ] One-page PDF opportunity brief (Minto + quadrant + citations footer)
- [ ] Hypothesis-card PDF stack (one card per page, printable)
- [ ] Figma-ready SVG of the quadrant
- [ ] BibTeX export

## Why deferred

1. **Bundle-size cost:** `weasyprint` adds 30+ MB + Cairo/Pango/GDK shared libs
   to the PyInstaller sidecar. Current binary is 219 MB (Git LFS-tracked).
   Crossing 250 MB would require an LFS Data Pack ($5/mo) and push macOS
   Gatekeeper verification time noticeably on first launch.
2. **Fallback complexity:** `reportlab` is lighter but can't render HTML/CSS
   natively — we'd have to rebuild every Minto layout primitive in its PDF DSL.
3. **User demand unknown:** The markdown export is paste-into-Notion-ready and
   handles 90% of the "shareable brief" use case. PDF is a "nice for cold
   outreach" feature, not a blocker for the research-SaaS retention loop.
4. **macOS alternative:** On macOS, users can cmd+P the Markdown preview in
   any tool (Obsidian, Typora, Marked 2) and Save as PDF — zero engineering.

## When to revisit

Revisit once **any** of the following happen:

- ≥3 users ask for PDF export explicitly (not just "export")
- We're sending briefs to investors / PR and need consulting-grade layout
- We add a web-app surface (which changes bundle-size calculus entirely)

## Implementation sketch when we do ship it

See `docs/ROADMAP.md` Phase 7.5 — Minto PDF layout with quadrant embed. Prefer
`playwright` headless-chromium render of a dedicated `/pdf-preview/:topic` route
over weasyprint: it reuses the in-app styling 1:1 and needs no new Python deps
(playwright is already a transitive dep via `browser_use` for ingest).

Outline:
1. Add a route `#/pdf-preview/:topic` that renders the existing `renderFull`
   output with a print stylesheet (no toolbar, no sidebar, no regenerate button).
2. Rust command `export_pdf(topic) -> path` that:
   - Spawns the app in headless mode (or uses `page.pdf()` from playwright)
   - Renders the preview route
   - Saves to `~/Library/Application Support/openreply/exports/<topic>-<date>.pdf`
   - Returns the path
3. Frontend Export dropdown gets a 4th item: "📄 PDF brief" → calls `export_pdf`
   → shows "Saved to <path>" + "Open in Finder" button.

Effort: 1-1.5 days with playwright, ~3 days with weasyprint. Skip weasyprint.
