# Insights: Consensus (deliberation tiers) section

**Date:** 2026-06-06
**Type:** Feature

## Summary

Added a collapsible "Consensus" section to the Insights tab. On open (or via a
"Run consensus check" button) it calls `api.deliberate(topic, { noLlm: true })`
for a fast heuristic pass (no LLM key needed) and renders each consensus tier
(confirmed / probable / contested / emerging / minority / single_source /
discarded) as a group: a colored tier chip + count, then each finding with a
0–100% consensus bar, score (e.g. "score 0.82"), vote/audience-endorsement
counts, and the persona rationales (all escaped). A "Deeper check (LLM)" button
re-runs with `noLlm:false`. All async writes are guarded by the existing
sub-tab liveness gate (`contentEl.dataset.tab === 'insights'`), and icons are
refreshed via `window.refreshIcons?.()` after each innerHTML write.

## Changes

- New render helpers: `renderConsensusResult`, `renderConsensusTierGroup`,
  `renderConsensusItem`, `_consensusTierMeta`, `_consensusRationaleHtml`
- New flow: `runConsensusCheck` (loading state + tolerant error/retry) and
  `wireConsensusSection` (lazy auto-run on first expand of the `<details>`)
- Section markup inserted into `renderFull` inside `.insights-main`, just
  before `#competitor-matrix-slot`
- Wired in `wireCards` alongside the matrix/chat wiring
- Tier colors inline (green/amber/blue/muted) — no new CSS file
- Tolerant to the documented `rationale` string OR the actual `rationales`
  object shape from deliberate.py, and to unknown tier keys

## Files Modified

- `app-tauri/src/screens/insights.js` — added the Consensus section, its
  render/run/wire functions, and the `<details>` mount; preserved all existing
  synthesize/monitor/chat behavior. `node --check` passes.
