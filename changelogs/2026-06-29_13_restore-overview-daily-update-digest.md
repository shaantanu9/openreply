# Restore Overview "Daily Update" digest (what's-new briefing + feed)

**Date:** 2026-06-29
**Type:** Fix

## Summary

The Overview page's **Daily Update** section — a goal-framed LLM briefing on top
plus a ranked feed of the freshest news/knowledge from the agent's sources below
— had been wiped during a branch merge sequence. Investigation showed the digest
*engine* (`reply/digest.py`) survived, but every wiring layer around it (the
`reply_digest` schema table, the `reply digest` CLI command, the `agent_digest`
Rust command + its registration, the `agentDigest` api.js wrapper, and the
"Daily Update" UI card in `renderOverview`) was uncommitted working-tree code
that the merge discarded — it existed in no commit, branch, stash, or dangling
git object. Reconstructed all five missing layers from the surviving engine and
the design spec (`docs/superpowers/specs/2026-06-29-overview-daily-digest-design.md`).

## Changes

- **Schema** (`reply/schema.py`): re-added the idempotent `reply_digest` table
  (`id, agent_id, day, briefing_json, feed_json, sources_json, created_at`) +
  `(agent_id, day)` index, matching `init_reply_schema`'s create-if-absent pattern.
- **CLI** (`cli/reply_cmds.py`): re-added `openreply reply digest [--rebuild]
  [--no-collect] [--n 12] [--provider] [--json]` → `digest.build_digest(...)`.
- **Rust command** (`commands.rs`): re-added `agent_digest(app, rebuild)` →
  `run_cli(["reply","digest", "--rebuild"?, "--json"])`, mirroring `agent_ideas`.
- **Registration** (`main.rs`): re-added `commands::agent_digest` to the
  `generate_handler!` list.
- **API wrapper** (`or/api.js`): re-added `agentDigest(rebuild)` and marked
  `agent_digest` a LONG command (6-min timeout — it does collect + LLM).
- **UI** (`or/dynamic.js` `renderOverview`): re-added the full-width "Daily
  Update" card after the strategy strip / before the KPI grid. SWR instant-paint
  from `localStorage` (`or.digest.<agentId>`), async `agentDigest(false)` build,
  briefing summary + up to 4 themed sections with source-badge links, a top-6
  fresh-from-sources feed (source badge + relative age), links opened via
  `api.openUrl`, and a **Refresh now** button wired to `agentDigest(true)`.
  Fail-soft: no-LLM shows feed only with an "add a provider" note.

## Files Modified

- `src/openreply/reply/schema.py` — `reply_digest` table + index
- `src/openreply/cli/reply_cmds.py` — `reply digest` command
- `app-tauri/src-tauri/src/commands.rs` — `agent_digest` command
- `app-tauri/src-tauri/src/main.rs` — register `agent_digest`
- `app-tauri/src/or/api.js` — `agentDigest` wrapper + LONG_COMMANDS entry
- `app-tauri/src/or/dynamic.js` — Daily Update card + loaders in `renderOverview`

## Verification

- `tests/test_digest.py` — 3 passed (fail-soft no-LLM, same-day cache, rebuild).
- Live CLI (`reply digest --no-collect`) against the app data dir returned a real
  goal-framed briefing ("increasing the demand for AI-powered apps like
  TestNotes") + feed, `cached:true`.
- `node --check` clean on `dynamic.js` + `api.js`.
- `cargo check` clean (0 errors; only pre-existing dead-code warnings).
