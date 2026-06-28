# WAL self-heal no longer deletes the live WAL (data-loss fix)

**Date:** 2026-05-31
**Type:** Fix (release-critical, data safety)

## Summary

`core/db.py::_wal_self_heal` could **destroy committed data**. On the
"checkpoint failed" path it unconditionally deleted `openreply.db-wal` /
`openreply.db-shm`. A SQLite WAL holds committed-but-not-yet-checkpointed
pages; deleting it while **another process has the database open**
discards every transaction living only in the WAL. With more than one
attached process (e.g. a Tauri sidecar AND an MCP server, or a stray
standalone script), this silently wipes real rows.

Hit in practice on 2026-05-31: a standalone process opened the DB (which
runs `_wal_self_heal` on first `get_db()`) while two `openreply mcp serve`
processes held it open. The heal deleted the shared WAL and ~56k
`topic_posts` rows that lived in it vanished. (Recovered in full by
rebuilding `topic_posts` from the surviving `extraction_queue` table.)

## Changes

- `_wal_self_heal` now **only** attempts a `wal_checkpoint(PASSIVE)` and
  **never deletes** the `-wal` / `-shm` / `-journal` side files. PASSIVE
  never blocks or interferes with other connections. A genuinely corrupt
  WAL is far rarer than a multi-process attach, and the old "cure"
  (deleting committed data) was worse than the disease. If a checkpoint
  can't proceed, the files are left intact and a real error surfaces on
  first use instead of being papered over with data loss.
- `tests/test_topic_merge.py` fixture hardened: switched from the
  unreliable `OPENREPLY_DATA_DIR` env-var isolation to the repo's canonical
  pattern — `monkeypatch.setattr(config._resolve_data_dir, …)` (see
  `test_smoke.py::db`). Under pytest the env-var approach let the real
  production DB leak through, so the merge tests had been running against
  (and mutating) live data. Added a hard `PRAGMA database_list` guard
  that aborts before any write if isolation didn't take.

## Files Modified

- `src/openreply/core/db.py` — `_wal_self_heal` no longer unlinks side files
- `tests/test_topic_merge.py` — canonical isolated-DB fixture + guard

## Verification

- `pytest tests/test_topic_merge.py` → 5 passed, stable across repeated runs
- DB-touching subset (smoke, solutions_persist, paper_relations, mcp_lock,
  topic_merge) → 24 passed
- Confirmed tests no longer touch the real DB: production `topic_posts`
  stayed 56,172 rows / 50 topics across repeated test runs
- Real DB integrity: `PRAGMA quick_check` → ok
