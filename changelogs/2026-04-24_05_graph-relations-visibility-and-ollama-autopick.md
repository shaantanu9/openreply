# Graph relation visibility + smarter Ollama model auto-pick

**Date:** 2026-04-24
**Type:** UI Enhancement / Fix

## Summary

Two targeted improvements driven by a "sources + relations + local model don't feel managed" report. After audit (via `dense-graph-relations` skill + codegraph explores across sources / graph / retrieval), the dense-relations pipeline was already fully applied — problem was **visibility**: the Map-tab stats strip only counted `source_evidence` edges, so users couldn't tell whether the 4 dense semantic relation kinds (`relates_to`, `potentially_solves`, `could_address`, `co_evidenced`) were being produced. Separately, Ollama auto-pick was arbitrary ("first entry in `/api/tags`") and fell back to a hardcoded `llama3.1` that failed at generation time if not pulled.

## Changes

- **Map-tab stats strip** surfaces the 4 dense-relation kinds. The query now covers `source_evidence | relates_to | potentially_solves | could_address | co_evidenced`. A pill labeled `🔗 N relations` (tooltip shows per-kind counts) appears when relations exist; a dashed `0 relations` pill appears when they don't, with a help tooltip pointing to the `Rebuild` button and the chromadb install check. This makes it obvious when the cross-source semantic layer is present, stale, or silently skipped.
- **Ollama auto-pick** now ranks local models by preferred-family priority (`llama3.3` > `llama3.2` > `llama3.1` > `qwen2.5` > `gemma3` > `mistral` > `phi3` > unknown) with parameter size as tiebreaker. A user with `llama3.1:70b` + `llama3.2:3b` installed will get `70b` for extraction (far better JSON reliability on long prompts) instead of whichever tag Ollama lists first.
- **Hardcoded `llama3.1` fallback removed.** If no local models are pulled, the provider raises a clear error (`ollama pull llama3.2` or `ollama pull llama3.1:70b`). The `FallbackProvider` chain catches it and moves to the next configured provider; the UI surfaces the message if no fallback is configured. Previously the user hit a confusing "unable to load model llama3.1" at first extraction.

## Files Created

- `changelogs/2026-04-24_05_graph-relations-visibility-and-ollama-autopick.md` (this file)

## Files Modified

- `app-tauri/src/screens/topic.js` — widened graph-edge stats query (line ~1081), added `denseRelTotal` calc + `🔗 N relations` chip with per-kind tooltip, plus dashed `0 relations` chip when empty.
- `app-tauri/src/style.css` — added `.graph-stat-chip.graph-stat-relations` and `.graph-stat-relations-empty` styling so the new chips read as first-class graph info.
- `src/reddit_research/analyze/providers/ollama.py` — added `_PREFERRED_FAMILY_PREFIXES`, `_param_size_score`, `_family_rank`; rewrote `_autopick_ollama_model` to collect all eligible candidates and return the best by `(family_rank ASC, param_size DESC)`; replaced hardcoded `llama3.1` fallback with a clear `RuntimeError` pointing at `ollama pull`.

## Verification

1. Python syntax check: `python3 -c "import ast; ast.parse(open('src/reddit_research/analyze/providers/ollama.py').read())"` → OK.
2. Manual: in the desktop app, open any topic with findings, click **Map** tab. If ChromaDB is installed + findings exist, expect the `🔗 N relations` pill with tooltip listing `relates_to / potentially_solves / could_address / co_evidenced` counts. If chromadb missing, expect the dashed `0 relations` pill with remediation tooltip.
3. Ollama auto-pick: if you have `llama3.1:70b` + `llama3.2:3b` pulled, set `LLM_PROVIDER=ollama` (unset `LLM_MODEL`), run `research graph enrich --topic X`; `OllamaProvider._model` resolves to `llama3.1:70b`. If no models are pulled, the provider raises a clear "pull one first" error instead of silently trying `llama3.1`.

## Not in scope

- Adding a per-source health badge to the Collect screen (YouTube/ProductHunt/bluesky silently skip without env keys). Flagged in the audit; worth a follow-up but beyond the visibility + local-model-picking fix.
- Automatic palace warm-up when the Python CLI spawns (every sidecar subprocess pays the ONNX cold-start cost). The MCP server already warms on boot; moving graph ops to the MCP server instead of CLI subprocesses would fix this but is a larger architectural change.
- Pre-flight validation that the picked Ollama model is actually loadable (adds per-call latency). Current behaviour surfaces Ollama's error text on first generation, which is acceptable.

## Addendum — source-coverage chip on the Map tab

Added a `📡 N sources` chip to the same stats strip. It queries `topic_posts ⨝ posts` grouped by `source_type`, shows the distinct-source count, and tooltips the per-source post breakdown (Reddit: 340, HN: 280, arXiv: 45, …). This gives the user instant confirmation that the graph is drawing on **all configured sources**, not just Reddit. A source that should be contributing but isn't appearing in the tooltip → the user knows the upstream adapter skipped (missing API key, CF block, auth change).

Verified reports/conclusions already use multi-source evidence:
- `research/text_report.py:_source_breakdown` emits per-source stats in the report header.
- `research/chat.py` sorts findings by `source_diversity DESC` so multi-source-corroborated painpoints surface first.
- `research/export_brief.py` stamps each finding's `source_breakdown` onto the brief.
- `research/insights.py` derives `triangulation_strength` from `source_breakdown`.
- `graph/export.py` stamps `source_diversity` on every finding node — the openreply-map HTML shows it in the node-detail panel.

No changes needed server-side; the triangulation was already there. The only gap was user visibility, which the two Map-tab chips (`🔗 relations`, `📡 sources`) now close.

### Files modified (addendum)

- `app-tauri/src/screens/topic.js` — added 4th query to the Map-tab `Promise.all` (per-source post breakdown) and rendered the `📡 N sources` chip with tooltip.
- `app-tauri/src/style.css` — added `.graph-stat-sources` styling (blue tint to distinguish from orange relations chip).
