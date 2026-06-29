# Overview Daily Update (Daily Digest)

**Date:** 2026-06-29
**Type:** Feature

## Summary

Added a **Daily Update** section to the Overview page that surfaces what's new
in the world about the agent's growth topics — a goal-framed, LLM-synthesized
**briefing** on top + a ranked **feed** of the freshest news/knowledge from all
the agent's sources below. It doubles as a daily learning surface for the user
(not just the agent). The digest scope is `agent.niche` + `agent.keywords[]`,
framed by the agent's goal/objective so the "why it matters" is goal-aware. It
auto-builds on the first Overview open each day (light news fetch + synthesis,
~10–20s), caches one row per agent per day, instant-paints the last build from
localStorage meanwhile, and a **Refresh now** button forces a rebuild.

Built on the existing collect + corpus + rank + LLM stack — no parallel fetcher.

## Changes

- **Digest engine** (`reply/digest.py`): `build_digest()` reuses
  `research.collect` for a light news-only top-up (`NEWS_SOURCES`, skip Reddit +
  extraction), `library.list_corpus` to read the freshest corpus items, and
  `reply.rank` (`freshness` × `engagement` × `platform_weight`) to rank the
  feed; one LLM call (`get_provider` + `loads_json`, same fail-soft pattern as
  `playbook.py`/`ideas.py`) synthesizes a 2–4 theme briefing with goal-aware
  "why it matters" + resolved source links. `current_digest()` reads the cached
  row. Fail-soft: no LLM → `briefing:null`, feed still rendered; collect failure
  → continue from existing corpus; never raises. Never caches an empty feed.
- **Schema** (`reply/schema.py`): new `reply_digest` table (`id, agent_id, day,
  briefing_json, feed_json, sources_json, created_at`) + `(agent_id, day)`
  index. One row per agent per day (id = `sha1(agent|day)[:16]`).
- **CLI** (`cli/reply_cmds.py`): `openreply reply digest [--rebuild]
  [--no-collect] [--n N]` — returns today's cached digest, building it if
  missing.
- **Command triangle**: `agent_digest(rebuild)` in `commands.rs`, registered in
  `main.rs` generate_handler, wrapper `agentDigest(rebuild)` in `or/api.js`.
- **UI** (`or/dynamic.js` `renderOverview`): a full-width "Daily Update" card
  inserted after the strategy strip / before the KPI grid. Instant-paints the
  cached digest from `localStorage` (`or.digest.<agentId>`), then calls
  `agentDigest(false)` async (server caches; only the first open each day is
  slow), renders briefing summary + up to 4 themed sections with source-badge
  links + a top-6 fresh-from-sources feed, and wires the **Refresh now** button
  to `agentDigest(true)`.

## Files Created

- `src/openreply/reply/digest.py`
- `tests/test_digest.py`
- `docs/superpowers/specs/2026-06-29-overview-daily-digest-design.md`
- `changelogs/2026-06-29_03_overview-daily-update-digest.md`

## Files Modified

- `src/openreply/reply/schema.py` — `reply_digest` table + index
- `src/openreply/cli/reply_cmds.py` — `reply digest` command
- `app-tauri/src-tauri/src/commands.rs` — `agent_digest` command
- `app-tauri/src-tauri/src/main.rs` — register `agent_digest`
- `app-tauri/src/or/api.js` — `agentDigest` wrapper
- `app-tauri/src/or/dynamic.js` — Daily Update card + loaders in `renderOverview`

## Verification

- `tests/test_digest.py` — 3 passed (fail-soft no-LLM, same-day cache,
  rebuild-upserts-one-row-per-day).
- Live CLI against the app data dir (NVIDIA): `reply digest --no-collect`
  produced a real goal-framed briefing ("increasing demand for AI-powered apps
  like TestNotes") with 11 feed items; the second call returned `cached:true`
  with the same day.
- `cargo check` clean (exit 0); `node --check` clean on `dynamic.js` + `api.js`.
