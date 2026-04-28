# Homepage — Honest-Data Pass + Interactive 2D Evidence Graph

**Date:** 2026-04-28
**Type:** Fix + UI Enhancement

## Summary

Two course corrections from user feedback:

1. **The page was returning HTTP 500.** The empty-section screenshots the user shared were not "low-density layout" — they were the Next.js error page after I removed `PROBLEM_STATS` from the constants module without updating its consumer (`ProblemSection.tsx`). Fixed.
2. **All invented metrics removed.** Product is pre-launch. Anything that implied measured customer outcomes (`23h/wk`, `$58k/yr`, `87% reduction`, `Trusted by Anthropic / Notion / Linear`, three named testimonial quotes) is gone. Replaced with honest reframing: capability stats only, "Built on and integrates with" instead of "Trusted by", and pre-launch posture statements instead of fake testimonials.
3. **Built the interactive 2D evidence graph** the user requested for the Demo section. SVG-based, click-to-explore, no animation libs, no re-render loops.

## Changes

### Fixes

- `ProblemSection.tsx` — rewrote to consume `PROBLEM_SYMPTOMS` (the new, honest, observation-based copy) instead of the removed `PROBLEM_STATS`. Resolves the 500.
- `use-reveal-on-scroll.ts` — failsafe timer dropped from 900ms to 200ms. The IntersectionObserver still fires for in-viewport elements, but a hot-reload or out-of-viewport scroll-skip can no longer leave a section blank for almost a second.

### Honest-data pass (no measured customer outcomes presented as fact)

- **`METRICS`** — replaced `10× faster · 40k posts · 87% reduction · 13 sources` with capability-only stats: `16+ source connectors built · 1,890 posts in the public lending demo · 100% local-first · BYOK across providers`.
- **`PROBLEM_SYMPTOMS`** — four observation-based "you've seen this" symptoms, no dollar amounts.
- **`TRUST_LOGOS`** — relabelled to `Built on and integrates with` (Anthropic, OpenAI, Ollama, Reddit, HN, App Store, arXiv, ChromaDB — all real integration points in the shipping codebase). No more "Trusted by".
- **`URGENCY_BANNER`** — `Pre-launch · join the early-access list` instead of "Free during launch — paid Pro Q3 lifetime founder pricing".
- **`TESTIMONIALS`** — three "pre-launch posture" statements (on honesty, on data, on evidence) replacing the three fictional named quotes.
- **`BEFORE_AFTER_STAT`** — `before` column now `—` everywhere; `after` column carries the demo-grounded numbers (16 sources, 1,890 dedup, 100% citations) only.

### New: interactive 2D evidence graph (DemoSection)

Replaces the previous "faux browser frame" mock with a real interactive graph rendered as inline SVG.

- **11 nodes**: 5 source nodes (Reddit, App Store, Play Store, GNews, OpenAlex) on the top row + 6 painpoint nodes (Lead-form spam, Opaque broker rates, Don't qualify, Servicer hand-off, Insurance dark pattern, Contractor attribution gap) below.
- **14 edges** wired with the actual sub→painpoint relationships from the lending corpus.
- **Click any node** → highlight outgoing edges in accent orange, dim everything else, surface a side panel with kind / freq metadata / clickable neighbours.
- **Reset button** clears selection.
- **Performance**: pure `useState<string|null>` + 2 `useMemo` lookups (node index, adjacency). No animation libs, no requestAnimationFrame, no setInterval. Cannot hang.
- **Accessibility**: each node is keyboard-focusable (`role="button"`, Enter/Space activate). The whole SVG carries `role="img"` + label.
- **Honest framing**: the panel reads "Pre-launch · interactive demo only · no live data fetch". Numbers in the metadata strings ("freq 8 · opportunity 16/20", "150 posts · r/Mortgages") come from the real lending demo corpus, not invented.

## Verified

- `curl http://localhost:3000/` → HTTP 200, 240 KB, all 18 section anchors present.
- All 11 SVG node `data-node-id` markers present in the SSR HTML.
- ESLint: clean across 4 changed files.

## Files Created

- `changelogs/2026-04-28_08_homepage-honest-data-interactive-graph.md` — this changelog

## Files Modified

- `src/lib/constants.ts` — METRICS / PROBLEM_SYMPTOMS / TRUST_LOGOS / URGENCY_BANNER / TESTIMONIALS / BEFORE_AFTER_STAT rewritten; added `GRAPH_NODES` (11 nodes) + `GRAPH_EDGES` (14 edges) + `GraphNodeKind` type
- `src/components/marketing/ProblemSection.tsx` — rewritten to use PROBLEM_SYMPTOMS (fixes 500)
- `src/components/marketing/DemoSection.tsx` — replaced faux-browser mock with the interactive 2D evidence graph
- `src/hooks/use-reveal-on-scroll.ts` — failsafe timer 900ms → 200ms
