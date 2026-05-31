# Audit backlog: preflight pyproject check, SQL hardening, CSP script-src tightened

**Date:** 2026-05-31
**Type:** Fix (release hygiene + security hardening)

## Summary

Conflict-free slice of the production-audit backlog, done in an isolated git
worktree (`fix/audit-backlog`) so it didn't collide with concurrent work on
`commands.rs`/`main.rs`. Three findings, all on files the other branch doesn't
touch.

## Changes

### 1. preflight validates pyproject.toml version (P0 release gate)
`scripts/preflight-release.sh` checked tauri.conf.json / package.json /
Cargo.toml against the tag but NOT `pyproject.toml` — which is exactly how it
drifted to 0.1.0 while everything else was 0.1.7. Added a `[project]`-scoped
TOML version extractor + compare; preflight now fails on pyproject drift.

### 2. SQL hardening (P2 defensive)
- `research/saturation.py` — the `kind IN (...)` list was built by f-string
  quoting `_CLUSTER_KINDS` into the SQL. Switched to bound named placeholders
  (`:k0…:kN`) added to the existing params dict. Behaviour identical (values
  are static), but no string-built SQL fragment remains.
- `graph/query.py` — `f" LIMIT {limit}"` now `f" LIMIT {int(limit)}"` (SQLite
  can't bind LIMIT via `?`; coercing to int guarantees no injection).

### 3. CSP: drop `unsafe-inline` from script-src (P1 security)
`tauri.conf.json` `script-src` was `'self' 'unsafe-inline' https://d3js.org
https://cdnjs.cloudflare.com`. Verified there are **no inline `<script>` bodies**
in `index.html`/`splash.html` (all scripts are external `type=module` / src),
and no `eval`/`new Function`/dynamic script injection in `main.js` — so
`'unsafe-inline'` was removed from script-src. A compromised dependency can no
longer execute an injected inline script.

**Deliberately NOT changed** (would break the app): `style-src 'unsafe-inline'`
(JS-rendered HTML uses pervasive inline `style="…"` + the splash `<style>`), and
the assetProtocol `scope` (couldn't exhaustively confirm every runtime asset://
path — conservative).

## Files Modified
- `scripts/preflight-release.sh`
- `src/gapmap/research/saturation.py`
- `src/gapmap/graph/query.py`
- `app-tauri/src-tauri/tauri.conf.json`

## Verification
- `bash -n preflight-release.sh` OK; `py_compile` clean; `tauri.conf.json` valid JSON.
- CSP change verified safe (zero inline scripts in loaded HTML).

## Still blocked (concurrent session owns these files)
`open_url` scheme allowlist, Task-Manager cancel wiring, and the perf
native-rusqlite/SWR sweep all live in `commands.rs`/`main.rs`, which the
`feat/merge-topics` session is actively editing — deferred until that lane is
clear. x86_64 sidecar rebuild is CI-only.
