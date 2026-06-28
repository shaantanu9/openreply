# Topic tabs reordered to follow the research journey (Chat moves to 3rd position)

**Date:** 2026-05-28
**Type:** UX Enhancement

## Summary

Reordered the 17 topic-detail tabs so the left-to-right sequence
matches the natural research journey on a topic — Orient → Engage →
Synthesize → Trust → Ideate → Contextualize → Power-tools → Act —
and moved **Chat** to the 3rd position (right after Home and Map)
because modern LLM-app users expect a conversational hook early and
because Chat is the highest-pull interaction on the screen.

The intent: a user pulled into tab N feels the pull toward tab N+1
(Zeigarnik effect + goal-gradient principle), so every tab gets
visited in the course of one topic session instead of clustering
clicks on the few obviously-named ones.

## New order (with rationale)

| # | Tab | Phase / role |
|---|---|---|
| 1 | Home | Orient — overview, opportunity ladder, default landing |
| 2 | Map | Engage (visual hook — see the graph) |
| 3 | **Chat** | Engage (LLM hook — "ask anything") |
| 4 | Report | Synthesize — the AI's written market report |
| 5 | Sentiment | Synthesize — emotional pulse per source |
| 6 | Trends | Synthesize — time-windowed signals |
| 7 | Sources | Trust — provenance breakdown |
| 8 | Posts | Trust — raw rows |
| 9 | Evidence | Trust — cited quotes / counter-evidence |
| 10 | Solutions | Ideate — adjacent solutions / workarounds |
| 11 | Bets | Ideate — prioritized opportunities |
| 12 | Concepts | Context — conceptual frames |
| 13 | Research | Context — the academic paper corpus |
| 14 | Papers | Context — per-paper analyses |
| 15 | AI Analyses | Power tools — LLM run history |
| 16 | Search | Power tools — full-text re-search |
| 17 | Actions | Act — export / workflow triggers |

## Previous order (for the record)

Home · Map · Report · Trends · Sentiment · Sources · Posts · Research
· Solutions · Concepts · Papers · Bets · Evidence · Chat · Search ·
Actions · AI Analyses

Chat sat at position 14 — far below the fold of a typical viewport
width. Evidence and Bets were split across the strip from their
natural pairs (Posts/Sources, Solutions). Research / Papers /
Concepts were inter-mixed with the synthesis tabs rather than
grouped under a single "academic context" phase.

## Behavioural principles applied

- **Zeigarnik effect** — adjacent tabs telegraph "you haven't done
  this yet", driving step-through.
- **Goal-gradient** — Solutions and Bets sit in the middle, giving
  the sense of progress toward the action goal (Actions tab).
- **Peak-end rule** — Chat is an engaging peak placed early; Actions
  is a satisfying terminal action.
- **Cognitive load** — visual (Map) → conversational (Chat) →
  structured (Report) before any raw-data tab; the user's mental
  model builds incrementally instead of being dropped into Posts.
- **Discovery via reading order** — every tab is reachable in
  left-to-right scan; no tab is positionally orphaned at the far
  right just because it was added last.

## Verification

- `switchTab` is name-keyed (`switchTab('chat')`, etc.) — DOM
  order has no functional coupling. Confirmed by grep:
  `loaders` map at `topic.js:5049` is keyed by name; no
  `nextSibling` / index-based keyboard nav.
- `defaultTab = 'home'` (`topic.js:5055`) still resolves correctly
  because Home remains in the strip.
- `node --check src/screens/topic.js` clean.
- `npm test` → 40/40 pass.

## Rationale comment in source

The full phase breakdown is inlined as a comment above the tabs
`<div>` in `topic.js` so future devs see the intent before
reordering. Hard rule preserved in the comment: don't shuffle
without a user-research reason.

## Files Modified

- `app-tauri/src/screens/topic.js` — tabs strip reordered + intent
  comment added above the `<div class="tabs">`.
