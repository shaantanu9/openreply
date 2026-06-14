# FSD Fleet — Debate Replay / Audit Timeline (Phase 3a)

**Date:** 2026-06-14
**Type:** Feature

## Summary

Phase 3 of the FSD Fleet roadmap, first slice: a **replay / audit timeline** for
the debate. The debate panel on the Topic Map gains a **↺ Replay** toggle that
shows the per-round, per-persona transcript of the latest debate — who voted
CONFIRM/DISPUTE/ABSTAIN on which finding and why — plus the run header
(provider, rounds, LLM-call count) and provenance gate counts (checks + lineage
rows). This is the WhyBuddy "audit timeline" observability, grounded in the
transcript the debate already produces.

Also fixes a **cross-process persistence bug**: `finish_debate_run` and
`set_node_debate_cache` used raw `db.execute("UPDATE …")`, which (unlike
sqlite-utils' auto-committing `.insert()`) does not commit — so the run status,
audit payload, and the node debate-badge cache were silently lost between the
sidecar process that ran the debate and the one that read it back. Added
explicit `db.conn.commit()`. This also hardens the Phase 1 map-node badges,
which are written and read in separate sidecar calls.

## Changes

- **DB:** `debate_runs` += `transcript_json` + `counts_json` (lazy migration);
  `finish_debate_run` persists the audit transcript + tier counts; new
  `debate_audit_for_topic()` reader returns the run header, per-round transcript,
  counts, and checks/lineage gate counts. **Bug fix:** explicit `conn.commit()`
  in `finish_debate_run`, `set_node_debate_cache`, `clear_debate_verdicts`.
- **Orchestrator:** `run_topic_debate` enriches each transcript turn with the
  finding it targets, records an `llm_calls` proxy, and persists it on run close;
  `get_debate_audit()` exposed.
- **CLI / bridge:** `research debate-audit` subcommand, Rust `debate_audit`
  command (registered), `api.debateAudit`.
- **UI:** `debatePanel.js` ↺ Replay toggle → `_renderAudit()` renders the
  grouped-by-round timeline with vote chips; replay CSS in `style.css`.

## Verification

- Python `tests/test_debate_run.py` (5 tests, incl. new audit-payload test).
- **Cross-process** test: seed → `research debate` (process B) → fresh process
  reads `status=done`, counts persisted, node cache stamped. (Confirms the
  commit fix.)
- `cargo check` 0 errors · `npm run build` clean · `npm test` 52/52.

## Not in this slice (Phase 3 remainder)

Real token-cost governance (budget alerts / model downgrade), streaming agent
reasoning, and the clarify→fleet→debate→synthesize orchestration are designed in
`docs/specs/FLEET_AGENTS_TOPIC_MAP.md` but not built. The `cost_tokens` column
currently records an LLM-call proxy, not real token usage.

## Files Modified

- `src/gapmap/core/db.py` — debate_runs audit columns, audit reader, commit fix.
- `src/gapmap/research/debate_run.py` — transcript enrichment, `get_debate_audit`.
- `src/gapmap/cli/main.py` — `research debate-audit`.
- `app-tauri/src-tauri/src/commands.rs` · `main.rs` — `debate_audit` command.
- `app-tauri/src/api.js` — `debateAudit`.
- `app-tauri/src/screens/debatePanel.js` — Replay toggle + timeline renderer.
- `app-tauri/src/style.css` — replay timeline styles.
- `tests/test_debate_run.py` — audit-payload test.
