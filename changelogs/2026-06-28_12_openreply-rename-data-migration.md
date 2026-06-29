# OpenReply Rename — Data + BYOK Env Migration

**Date:** 2026-06-28
**Type:** Fix | Infrastructure

## Summary

The app was renamed `gapmap` → `openreply` (bundle id `com.shantanu.gapmap`
→ `com.shantanu.openreply`, Python package `src/gapmap` → `src/openreply`,
sidecar `gapmap-cli` → `openreply-cli`). The rename changed the two
filesystem locations the app resolves at runtime, orphaning all existing
data: on first launch under the new bundle id the app created a **fresh empty
data dir** and a **fresh empty BYOK env file**, so the live UI showed a goal-
less TestNotes agent with no playbook, no ideas, and no opportunities, and any
LLM call (Evolve / Suggest ideas) would fail-soft for lack of the NVIDIA key.

Migrated both locations forward so the live app shows the real
self-evolving-agent data and the LLM write-path works.

## Changes

- **App DB migrated.** Copied the rich
  `~/Library/Application Support/com.shantanu.gapmap/gapmap/gapmap.db`
  (TestNotes goal "drive TestNotes signups", playbook v1, 3 ideas, 66
  opportunities) to
  `~/Library/Application Support/com.shantanu.openreply/openreply/openreply.db`.
  Source WAL checkpointed (`PRAGMA wal_checkpoint(TRUNCATE)`) before the copy
  so the `.db` was self-contained. The fresh auto-created openreply db/palace
  were backed up (`*.fresh-bak-21migrate`), not deleted.
- **Palace migrated.** Copied the ChromaDB palace
  (`persona_memories_1`, `persona_memories_2`, `posts` collections) into the
  openreply data dir so semantic retrieval for evolve/ideas keeps working.
- **BYOK env migrated.** Copied `~/.config/reddit-myind/.env`
  (`LLM_PROVIDER`, `LLM_MODEL`, `NVIDIA_API_KEY`, `OLLAMA_BASE_URL`) to
  `~/.config/openreply/.env` with `0600` perms — the path
  `byok_env_path()` (commands.rs) and `_USER_CONFIG_DIR` (config.py) both
  resolve to.
- **Build unblock.** A stray background `cargo check` had grabbed the
  build-directory file lock and deadlocked the Tauri `cargo run` link step;
  killing it let the dev build finish.

## Verification

- Live dev sidecar (`python -m openreply.cli.main`) against the migrated data
  dir:
  - `reply playbook` → v1, angles `["Empathize with students' struggles",
    "Highlight benefits of TestNotes", "Use social proof and testimonials"]`.
  - `reply ideas` → 3 ideas with `source_mix` + `goal_fit` (0.9 / 0.8 / 0.8).
  - `reply evolve` (NVIDIA) → `ok:true, version:2` from 16 memories + 7
    beliefs — the LLM write-path the "Evolve now" button uses.
- App relaunched (`com.shantanu.openreply`, pid live), clean 7.25 s rebuild,
  vite on :1420. Live DB confirms: TestNotes + goal, playbook versions `1,2`,
  3 ideas, 66 opportunities, BYOK env present.

## Files Created

- `changelogs/2026-06-28_12_openreply-rename-data-migration.md`

## Files Modified

- None (data/config-dir migration only; no source changes). Migrated:
  `~/Library/Application Support/com.shantanu.openreply/openreply/{openreply.db, palace/}`
  and `~/.config/openreply/.env`.
