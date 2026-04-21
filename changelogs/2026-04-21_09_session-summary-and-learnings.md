# Session summary — Tier-1..6 build, MCP parity, E2E suite, testing plan

**Date:** 2026-04-21
**Type:** Documentation

## Summary

Wraps up the quality-pass + Tier-1..6 build session. Total: 9 commits,
4 subagents ran in parallel, ~7,000 lines of new code + docs, 21 tests
green, 73 MCP tools total, 30+ new CLI commands.

## Commits this session

| SHA | What shipped |
|---|---|
| `4958c54` | Tier-1..6 backlog (soft-delete, relevance UI, multilingual embed, feedback loop, global competitors, compare view, CSV ingest, saved views, custom prompts, CI, tests) |
| `356690c` | MCP parity (28 new @mcp.tool() + UPDATES_DETAIL.md) |
| `b00268f` | E2E integration suite + TESTING_AND_IMPROVEMENTS.md + saved_views fix |

## Docs produced

| Doc | Purpose |
|---|---|
| `docs/BUILD_PLAN_ALL_TIERS.md` | Lane assignments per tier item (4 agents + FG) |
| `docs/UPDATES_DETAIL.md` | What / Why / Where / How for every shipped feature. MCP matrix, CLI reference, env-var table |
| `docs/TESTING_AND_IMPROVEMENTS.md` | Known gaps ranked, 15-min smoke test, per-feature acceptance criteria, 2-week sprint plan, usefulness metrics, failure-mode playbook |
| `docs/ops/lfs-maintenance.md` | Quarterly LFS prune runbook |

## Subagent-coordinated work

5 parallel lanes with zero file overlap:
- **AG-B** — multilingual embedder + strict-mode quality gate
- **AG-C** — global competitor dedup + 👎 finding feedback
- **AG-D** — topic comparison view + CSV bulk ingest
- **AG-E** — custom extractor prompts + saved views
- **AG-F** — GitHub Actions CI + LFS docs
- **FG** — soft-delete backbone, relevance UI surfaces, tests

Append-only discipline (`// ── AG-X ──` headers in shared files) meant
zero merge conflicts across `commands.rs`, `main.rs`, `api.js`,
`style.css`, and `cli/main.py`.

## New modules landed

Python:
- `research/trash.py`
- `research/quality_gate.py`
- `research/feedback.py`
- `research/prompt_store.py`
- `research/saved_views.py`
- `research/topic_resolver.py` (from earlier, contract-refined this session)
- `retrieval/embedder.py`
- `research/ingest.py` (extended with `ingest_csv`)

Frontend:
- `screens/compare.js`
- `screens/global_competitors.js`
- `lib/deleteConfirm.js`

Tests:
- `tests/test_tier_quality_pass.py` (12 unit contracts)
- `tests/test_integration_tier_e2e.py` (9 E2E smoke tests)

## 28 new MCP tools

Every Tier-1..6 capability now callable from Claude Code / Cursor /
Claude Desktop / Windsurf / Cline. Total surface: **45 → 73 tools**.

## Patterns worth reusing (skills candidates)

- **5-lane parallel build with append-only headers** — zero-conflict
  subagent orchestration on shared files.
- **Explicit-PK sqlite-utils insert** (`next_id = max(id) + 1`) —
  sqlite-utils' `last_pk` is inconsistent on up-front `id: int` schemas.
- **Soft-delete + undo toast** with 10s window before destructive
  action becomes permanent; recovery list in Settings.
- **Three-layer relevance gate** (collect / LLM-output / retroactive)
  with env-tuned thresholds + sample-dropped preview on dry-run.
- **MCP + CLI + UI triangle** — every feature must be callable from all
  three surfaces; lag on one surface = incomplete feature.

## Files Created

- `changelogs/2026-04-21_09_session-summary-and-learnings.md`

## Files Modified

- None
