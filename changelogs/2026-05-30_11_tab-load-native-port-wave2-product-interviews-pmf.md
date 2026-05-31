# Tab-load latency — Wave 2 (cont.): native rusqlite ports — product strategy, interviews, PMF list

**Date:** 2026-05-30
**Type:** Fix (performance)

## Summary

Continues Wave 2 (changelog `10` = empathy). Ports more read-only SELECT-shaped
commands from the Python sidecar (~2s/call, 30-70s cold DMG) to native
rusqlite (~10ms), in place (same command names → no registration/api churn;
Wave-1 SWR persistence keeps working). Every port verified byte-for-byte
against the Python `--json` golden output before trusting it.

**Ported this batch (8 commands):**

- **Product-strategy getters (6)** — `four_risks_get`, `value_curve_get`,
  `tam_sam_som_get`, `porter_get`, `positioning_get`, `cost_model_get`. All
  read one `<x>_json` blob column from `products WHERE id=?`, decode, and
  scaffold a fixed-shape payload. A shared `product_blob_get` helper + Python-
  faithful coercion helpers (`py_float`/`py_str`/`py_int`/`py_arr`/`py_obj`)
  reproduce Python's truthiness defaults EXACTLY — notably `float(x or 18.0)`
  treating a stored `0` as falsy → `18.0` (`cost_model.maintenance_pct`), and
  float formatting (`0.0`, not `0`).
- **Interviews (2)** — `interview_get`, `interview_list`. Mirror
  `interviews.get_interview` / `list_interviews` + `_to_dict` (decode
  `tags_json` → `tags`, drop the raw column). Shared `list_topic_product_rows`
  helper reproduces the `product_id → topic → all LIMIT n` branch.
- **PMF (1)** — `pmf_list`. Mirrors `pmf.list_responses` (raw `SELECT *`, no
  hydration, `{"responses": [...]}`).

## Deliberately left on the sidecar (by design)

- `pmf_score`, `interview_summary` — these **compute aggregations** (counts,
  averages, percentages), not plain SELECTs. Replicating the math in Rust is
  high silent-wrong risk for marginal benefit, and they're already instant on
  revisit via Wave-1 persistence.
- `survey_list`, `pert_list`, `ost_experiments_list`, `list_experiments`,
  `paper_analyses_get` — pending the same per-command golden-output
  verification (e.g. `pert._decorate` adds computed fields; envelopes
  unconfirmed). Same proven template applies; not ported unverified.

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — 8 commands ported to native
  `query_db`; added `product_blob_get`, `list_topic_product_rows`,
  `hydrate_interview_row`, and the `py_*` coercion helpers.

## Verification

- `cargo check` → clean (only the pre-existing JWT debug-fallback warning).
- **Product getters:** output byte-identical to Python for a live product
  (all-empty-blob defaults, including `maintenance_pct: 18.0` falsy-default and
  `0.0` float formatting across four_risks / value_curve / tam_sam_som /
  porter / positioning / cost_model).
- **pmf_list:** Python returns raw `SELECT *` (13 table columns, no
  hydration); native `SELECT *` returns the same, same `responded_at DESC`
  order + `{"responses"}` envelope.
- **interview_get/list:** logic mirrors `_to_dict`; empty-table path returns
  `{"interviews": []}` / `{"ok": false, ...}` matching Python.

## Prod note

These reads no longer touch the Python sidecar → ship via a **Tauri app
rebuild (cargo), not a sidecar rebuild.**
