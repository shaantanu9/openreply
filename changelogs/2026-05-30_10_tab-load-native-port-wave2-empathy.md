# Tab-load latency — Wave 2 (start): native rusqlite port of the empathy reads

**Date:** 2026-05-30
**Type:** Fix (performance)

## Summary

Wave 1 made tab REVISITS instant via SWR persistence. Wave 2 attacks
FIRST-load latency by porting read-only SELECT-shaped commands from the Python
sidecar to native rusqlite (Phase 17/27), following the existing
`papers_list_native` / `hypothesis_list_native` template. Measured cost of a
single get-command: **~2.0s** via a one-shot Python spawn (30-70s cold on a
fresh DMG under Gatekeeper) vs **~10ms** via in-process rusqlite with a cached
connection.

This wave ports the first cluster — `empathy_get` + `empathy_list` — IN PLACE
(same command names), so there's zero registration-triangle churn and the
Wave-1 SWR persistence on `api.empathyGet/empathyList` keeps working unchanged.

These reads now never touch the Python sidecar, so the prod requirement is a
**Tauri app rebuild (cargo), NOT a Python sidecar rebuild.**

## Changes

- `commands.rs`: `empathy_get` — replace `run_cli(["research","empathy-get",…])`
  with `query_db("SELECT * FROM empathy_maps WHERE id = :id")` + the exact
  Python transform (JSON-decode says/thinks/does/feels, default `[]`;
  `built_offline` synthesized `false` since the column doesn't exist).
- `commands.rs`: `empathy_list` — replace the sidecar call with
  `query_db("SELECT id, topic, persona, gap_notes, updated_at FROM empathy_maps
  WHERE topic = :topic ORDER BY updated_at DESC")` in the `{"maps": [...]}`
  envelope.
- `commands.rs`: add `slugify_persona()` — exact mirror of Python `_slugify`
  (`pid = f"{topic}::{_slugify(persona)}"`).

## Files Modified

- `app-tauri/src-tauri/src/commands.rs`

## Verification

- `cargo check` → clean (only the pre-existing JWT debug-fallback warning).
- **Output parity:** the native SQL+transform output is byte-identical to the
  Python `empathy-get --json` golden output for a live row (topic / persona /
  says / thinks / does / feels / gap_notes / updated_at all match).
- **slugify parity:** verified against Python across edge cases — `primary`,
  `Power User`→`power-user`, `Café Owner!`→`caf-owner`, ``→`persona`,
  `早期 user`→`user`.
- Bug caught + fixed during the port: a stranded `#[tauri::command]` attribute
  left above the new helper (would have broken the build) — removed.

## Remaining Wave 2 surface (same verified template, per-command)

`four_risks_get`, `value_curve_get`, `tam_sam_som_get`, `porter_get`,
`positioning_get`, `cost_model_get` (single JSON-blob column from `products`,
some with default scaffolding — verify each), `interview_list/get/summary`,
`pmf_list/score`, `survey_list`, `pert_list`, `list_experiments`,
`ost_experiments_list`, `paper_analyses_get`. Each ported in place + verified
against its Python golden output before moving on.
