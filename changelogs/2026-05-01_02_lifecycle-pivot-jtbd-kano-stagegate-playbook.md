# Lifecycle Pivot — JTBD discipline + Kano categorization + Stage-Gate verdicts + Playbook screen

**Date:** 2026-05-01
**Type:** Feature

## Summary

Pulled four lifecycle-discipline ideas from the resumeforge product-dev
lifecycle reference into Gap Map: a strict JTBD statement format on the
why-extractor, Kano-Model categorization on every intervention, a
Stage-Gate verdict (Go / Kill / Hold / Recycle) on every Product, and a
new Playbook screen that maps the 10-phase product-development lifecycle
onto our existing screens. All changes are additive and backward-compatible
— existing topics, products, and graphs work unchanged; the new metadata
appears the next time the relevant pipeline is re-run.

## Changes

- **Schema migration (idempotent):** added `_ensure_lifecycle_schema()`
  to `core/db.py` that adds `gate_status`, `gate_decided_at`,
  `gate_notes` columns to `products` via `add_column()`. Pre-existing
  product rows survive untouched. Kano category lives in
  `graph_nodes.metadata_json` (no schema change needed).
- **JTBD discipline:** `prompts/why.yaml` now requires a `jtbd_statement`
  field in canonical Christensen format
  ("When [situation], I want [motivation], so I can [outcome]").
  `solutions.py::_format_why()` surfaces the statement to downstream
  prompts. `screens/solutions.js` renders it on each painpoint card.
- **Kano categorization:**
  - New `prompts/kano.yaml` extractor.
  - New module `research/kano.py` with `categorize_topic()` and
    `categorize_interventions_for_painpoint()`. One LLM call per
    painpoint that has interventions; results overwrite previous
    Kano fields (idempotent re-run).
  - Wired into `solutions_pipeline()` so every solutions run
    auto-categorizes. Failures non-fatal.
  - New CLI command `research kano-categorize`.
  - New Tauri command `run_kano_categorize` + `api.runKanoCategorize`.
  - Solutions screen now shows colored Kano badges and a Kano filter
    chip-bar (All / Must-Be / Performance / Attractive / Indifferent)
    plus a "Re-run Kano" button.
- **Stage-Gate verdicts:**
  - New `gate_set()` / `gate_get()` in `research/product.py`. Verdict
    is one of `''` (clear), `go`, `kill`, `hold`, `recycle`. Stored on
    the product row so every dashboard load sees it for free.
  - New CLI commands `research product-gate-set` / `product-gate-get`.
  - New Tauri commands `product_gate_set` / `product_gate_get` +
    `api.productGateSet` / `productGateGet`.
  - Product dashboard now shows a Stage-Gate verdict bar above the
    signals section, with one-click verdict updates and an optional
    notes prompt.
  - Product list tiles show the current verdict as a colored pill.
- **Playbook screen:**
  - New screen `screens/playbook.js` at route `#/playbook`.
  - Renders 10 lifecycle phases (Lead Qualification → Post-Launch &
    Growth) sourced from the resumeforge reference. Each phase lists
    its frameworks, deliverables, in-app links to the existing screen
    that produces that artifact, and a checklist.
  - Reference panel of the 8 academic frameworks the phases pull from.
  - Sidebar nav entry under "Workspace".
  - Tab strip icon + title registered in `lib/tabs.js`.
- **Verification:**
  - Python imports and CLI commands pass (`uv run reddit-cli research --help`).
  - Schema migration round-trip tested on a fresh tmp DB; gate set/clear
    round-trips work end-to-end.
  - `cargo check` clean.
  - `node --check` clean on all touched JS files.
  - Pre-existing test failure (`avatarInitials: single token`) and
    pre-existing build error (`CollectReconCard.js`) confirmed
    unrelated via `git stash` regression check.

## Files Created

- `prompts/kano.yaml`
- `src/reddit_research/research/kano.py`
- `app-tauri/src/screens/playbook.js`
- `changelogs/2026-05-01_02_lifecycle-pivot-jtbd-kano-stagegate-playbook.md`

## Files Modified

- `src/reddit_research/core/db.py` — added `_ensure_lifecycle_schema()` + call from `init_schema()`.
- `prompts/why.yaml` — added `jtbd_statement` to JSON schema and instructions.
- `src/reddit_research/research/solutions.py` — passes `jtbd_statement` into LLM context; auto-runs Kano categorization at the end of the solutions pipeline.
- `src/reddit_research/research/product.py` — added `gate_set()` / `gate_get()` / `VALID_GATE_STATUSES`.
- `src/reddit_research/cli/main.py` — added `kano-categorize`, `product-gate-set`, `product-gate-get` Typer commands.
- `app-tauri/src-tauri/src/commands.rs` — added `product_gate_set`, `product_gate_get`, `run_kano_categorize` Tauri commands.
- `app-tauri/src-tauri/src/main.rs` — registered the three new Tauri handlers.
- `app-tauri/src/api.js` — added `productGateSet`, `productGateGet`, `runKanoCategorize`.
- `app-tauri/src/main.js` — imported and registered `renderPlaybook` on `#/playbook`.
- `app-tauri/src/lib/tabs.js` — added `book-open` icon for `/playbook`.
- `app-tauri/index.html` — sidebar entry for Playbook under Workspace.
- `app-tauri/src/screens/solutions.js` — Kano badges on intervention cards, Kano filter chip-bar, "Re-run Kano" button, JTBD statement on painpoint card.
- `app-tauri/src/screens/product.js` — Stage-Gate verdict bar with `wireGateBar()`, gate pill on product list tiles.
- `app-tauri/src/style.css` — Kano badge palette + filter chips, JTBD statement card, Stage-Gate button row, Playbook layout.
