# MCP + CLI parity for Tier-1..6 features + UPDATES_DETAIL.md

**Date:** 2026-04-21
**Type:** Feature + Documentation

## Summary

After the Tier-1..6 build (commit `4958c54`) shipped every feature across
the desktop UI + CLI, this pass brings the MCP surface to parity and
writes a comprehensive usage doc.

**MCP:** 28 new `@mcp.tool()` entries in `src/reddit_research/mcp/server.py`.
Total MCP surface: 45 → 73 tools. Every Tier-1..6 capability is now
callable from Claude Code / Cursor / Claude Desktop / Windsurf / Cline.

**CLI:** Verified every new command from the Tier build is registered and
returns proper JSON. `reddit-cli research --help` now lists 30+ commands.

**Docs:** New `docs/UPDATES_DETAIL.md` — one-page reference covering
every feature with What / Why / Where / How sections. Includes the
complete MCP tool matrix, complete CLI reference, env-var table, and
explicit deferrals with revisit triggers.

## Why MCP parity matters

PMs and CEOs use Cursor / Claude Code / Claude Desktop daily. The Tier-1..6
features should be callable from an LLM agent, not just from the desktop
UI. A PM asking their Cursor agent "run a sweep on mindwave-pro and show
me the top 3 signals with suggested actions" should Just Work without
opening Gap Map.app. That's now possible.

## 28 new MCP tools

### Topic lifecycle (6)
- `gapmap_topic_soft_delete`
- `gapmap_topic_restore`
- `gapmap_topic_trash_list`
- `gapmap_topic_trash_purge`
- `gapmap_find_existing_topic`
- `gapmap_merge_duplicate_topics`

### Corpus quality (2)
- `gapmap_clean_corpus`
- `gapmap_collect_quality_check`

### Intelligence (10)
- `gapmap_feedback_record`
- `gapmap_feedback_list`
- `gapmap_global_competitors`
- `gapmap_saved_view_create`
- `gapmap_saved_view_list`
- `gapmap_prompt_list`
- `gapmap_prompt_get`
- `gapmap_prompt_set`
- `gapmap_graph_build_relations`
- `reddit_research_link`
- `reddit_research_links`

### Product Mode (8)
- `gapmap_product_create`
- `gapmap_product_list`
- `gapmap_product_sweep`
- `gapmap_product_signals`
- `gapmap_product_signal_action`
- `gapmap_product_dashboard`
- `gapmap_product_digest`
- `gapmap_product_convert_topic`

Plus `gapmap_ingest_csv` and `gapmap_graph_build_relations` (categorized
above) — actual count 28.

## CLI verification

- `reddit-cli research --help` lists every new command with one-line
  summary.
- `reddit-cli research topic-trash-list --json` returns
  `{"ok": true, "trash": []}`.
- `reddit-cli research prompt-list --json` returns structured override
  metadata.
- All commands tested for JSON-parse correctness from the Tauri sidecar.

## docs/UPDATES_DETAIL.md structure

11 top-level sections + 2 appendices:

1. Retention safety — soft-delete, type-to-confirm
2. Corpus quality — 3-layer relevance gate, strict quality, multilingual
   embed, topic resolver contract
3. Research intelligence — 👎 feedback, global competitors, saved views,
   custom prompts, topic comparison
4. Knowledge-graph depth — dense cross-finding edges, research linker
5. Workflow productivity — dashboard context menu, recollect, CSV bulk
   ingest, find-existing pre-check
6. Product Mode (MCP surface)
7. Developer experience & CI
8. **Complete MCP tool matrix** (28 new tools with signatures)
9. **Complete CLI reference** (every new command grouped by purpose)
10. **Env-var table** — every tunable knob
11. Explicit deferrals with revisit triggers
12. Appendix A — three-surface architecture diagram
13. Appendix B — regression-test contract

## Files Modified

- `src/reddit_research/mcp/server.py` — +28 MCP tools

## Files Created

- `docs/UPDATES_DETAIL.md`
- `changelogs/2026-04-21_08_mcp-cli-parity-and-detail-doc.md`
