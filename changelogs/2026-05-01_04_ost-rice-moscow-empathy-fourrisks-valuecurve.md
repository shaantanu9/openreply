# Discovery framework expansion — OST + RICE + MoSCoW + Empathy Map + Four Risks + Value Curve

**Date:** 2026-05-01
**Type:** Feature

## Summary

Mapped six more frameworks from the resumeforge `product-discovery-complete-guide.md`
reference onto OpenReply's existing painpoint / intervention / paper graph.
All six leverage data the Solutions pipeline already produces — no new
collection, no schema rewrites, fully additive and idempotent. The
Opportunity Solution Tree (Torres, 2016) is the new centrepiece: it ties
the Outcome (set on a Product), Opportunities (painpoints), Solutions
(interventions), and Experiments (a new user-tracked table) into one tree
that every other screen feeds.

| Framework             | Source                          | Surface                                              |
| --------------------- | ------------------------------- | ---------------------------------------------------- |
| Opportunity Solution Tree | Teresa Torres (2016)        | New `#/ost` screen + `#/ost/<topic>` tree            |
| RICE prioritization   | Sean McBride / Intercom (2016)  | Solutions screen badge + OST sort + auto-score CLI   |
| MoSCoW prioritization | Dai Clegg (Oracle, 1994)        | Solutions screen badge + filter + LLM tagger         |
| Empathy Map           | Dave Gray (2010)                | New `empathy_maps` table + `empathy-build` CLI       |
| Cagan's Four Risks    | Marty Cagan (Inspired, 2017)    | Product dashboard panel above Stage-Gate verdict     |
| Blue Ocean Value Curve| Kim & Mauborgne (INSEAD, 2005)  | Product dashboard SVG chart + 4-actions framework    |

## Changes

- **Schema migration (idempotent):** `_ensure_lifecycle_schema` extended
  with: `products.four_risks_json`, `products.value_curve_json`,
  `products.tam_sam_som_json`, `products.outcome`; new tables
  `ost_experiments` (renamed from `experiments` to avoid shadowing
  gap_discovery's pre-existing experiments table) and `empathy_maps`.
  Verified migration applies cleanly on a pre-existing dev DB.
- **OST module (`research/ost.py`):**
  - `build_tree(topic, product_id)` reads outcome → painpoints →
    interventions → experiments in one SQL pass + per-node enrichment.
    Solutions are pre-sorted by RICE score, then Kano severity, then MoSCoW
    bucket so the highest-leverage solution is always first.
  - `set_outcome(product_id, outcome)` persists the OST root.
  - Experiment CRUD: `create_experiment`, `list_experiments`,
    `update_experiment`, `delete_experiment`. Methods enumerated:
    `fake_door` / `landing_page` / `wizard_of_oz` / `concierge` /
    `survey` / `custom` (Ries, 2011 + Blank/Dorf, 2012).
  - Defensive against pre-`evidence_count` schemas.
- **RICE module (`research/rice.py`):**
  - `score_topic` deterministically computes Reach (mention count from
    `graph_nodes.evidence_count`), Impact (1/2/3 keyword-mapped from
    severity + emotion text), Confidence (50% / 80% / 100% from paper-tier
    presence), Effort (user-supplied default 3). Persists to
    `metadata_json.rice` with `auto:true` flag — manual overrides
    via `set_rice` flip the flag and skip overwrite on next auto run.
- **MoSCoW module (`research/moscow.py` + `prompts/moscow.yaml`):**
  - One LLM call per painpoint, identical contract to the existing Kano
    extractor. Persists `metadata_json.moscow` (must / should / could /
    wont) + confidence + reasoning. Idempotent re-run.
- **Empathy module (`research/empathy.py` + `prompts/empathy.yaml`):**
  - `build_empathy_map(topic, persona)` mines corpus excerpts (top-scored
    posts + complaint/workaround graph nodes), then asks the LLM to fill
    the Says / Thinks / Does / Feels grid + write a Says-vs-Does gap
    note. Falls back to a deterministic offline seed (regex quote /
    workaround / emotion mining) when no LLM provider is configured.
- **Four Risks (extends `research/product.py`):**
  - `four_risks_get` / `four_risks_set` for value / usability /
    feasibility / viability — each with status (pass / fail / unknown) +
    notes + decision timestamp. Stored as JSON on `products.four_risks_json`.
- **Value Curve (extends `research/product.py`):**
  - `value_curve_get` / `value_curve_set` for the Blue Ocean strategy
    canvas: factor list, self scores, competitor scores, four-actions
    notes (eliminate / reduce / raise / create). Validation pads /
    truncates score arrays to factor length and clamps to 0..10.
- **CLI commands** (all `--json` mode, sidecar-friendly):
  `ost-build`, `ost-set-outcome`, `ost-experiment-create`,
  `ost-experiments-list`, `ost-experiment-update`,
  `ost-experiment-delete`, `rice-score`, `rice-set`,
  `moscow-categorize`, `empathy-build`, `empathy-get`, `empathy-list`,
  `four-risks-get`, `four-risks-set`, `value-curve-get`,
  `value-curve-set`. (OST experiment commands prefixed with `ost-` to
  avoid shadowing gap_discovery's `experiments-list`.)
- **Tauri commands + main.rs registration:** `ost_build`,
  `ost_set_outcome`, `ost_experiment_create`, `ost_experiments_list`,
  `ost_experiment_update`, `ost_experiment_delete`, `run_rice_score`,
  `rice_set`, `run_moscow_categorize`, `run_empathy_build`,
  `empathy_get`, `empathy_list`, `four_risks_get`, `four_risks_set`,
  `value_curve_get`, `value_curve_set`. Confirmed `cargo check` passes.
- **api.js:** Each Tauri command exposed via cached/non-cached helper.
  Dependent caches invalidate after any write
  (`ost_build`, `ost_experiments_list`, `four_risks_get`,
  `value_curve_get`, `empathy_get`, `empathy_list`).
- **OST screen (`screens/ost.js` + route `#/ost`):**
  - Picker page (cross-topic) → topic-scoped tree.
  - Outcome panel with inline edit (writes to `products.outcome` when a
    product is linked, else local-only with a warning banner).
  - Cards render Opportunity → Solutions (sorted by RICE) → Experiments
    with full RICE / Kano / MoSCoW chip row on every solution.
  - Toolbar buttons re-run RICE / MoSCoW / Kano in place.
  - Inline experiment-creation modal with hypothesis / method / success
    criteria / sample size; status cycle button (`Cycle` →
    planned → running → validated → invalidated → inconclusive).
  - Sidebar nav entry under Workspace.
- **Solutions screen update (`screens/solutions.js`):**
  - New MoSCoW + RICE badges next to existing Kano badge on every
    intervention.
  - New MoSCoW chip filter row that AND-intersects with the existing
    Kano filter (so users can isolate "Must-Be that's also Must" etc.).
  - New Re-run RICE / Re-run MoSCoW toolbar buttons.
- **Product screen update (`screens/product.js`):**
  - Four Risks panel rendered above the Stage-Gate verdict bar (so
    users clear value / usability / feasibility / viability BEFORE
    the verdict).
  - Blue Ocean Value Curve panel rendered below the Lens section,
    with an inline SVG strategy canvas that updates live as sliders
    move, factor add/remove, and an editable four-actions grid
    (Eliminate / Reduce / Raise / Create). Save flushes the whole
    payload to `products.value_curve_json`.
- **Playbook screen update (`screens/playbook.js`):**
  - Phase 01 (Discovery) now lists OST + Empathy Map deliverables.
  - Phase 02 (Validation) now lists Kano + MoSCoW + RICE + Four-Risks
    deliverables and links to the new screens.
  - Frameworks-referenced panel grew from 8 → 14 entries (+OST, +Empathy
    Map, +MoSCoW, +RICE, +Cagan Four Risks, +Blue Ocean Value Curve).
- **Stylesheet (`style.css`):** ~360 new lines adding `.ost-*`,
  `.moscow-*`, `.rice-*`, `.four-risks-*`, `.risk-*`,
  `.value-curve-*`, `.va-action`, `.vc-row`, `.empathy-*`,
  `.btn-mini`, and the OST experiment-creation modal.

## Files Created

- `src/reddit_research/research/ost.py`
- `src/reddit_research/research/rice.py`
- `src/reddit_research/research/moscow.py`
- `src/reddit_research/research/empathy.py`
- `prompts/moscow.yaml`
- `prompts/empathy.yaml`
- `app-tauri/src/screens/ost.js`
- `changelogs/2026-05-01_04_ost-rice-moscow-empathy-fourrisks-valuecurve.md`

## Files Modified

- `src/reddit_research/core/db.py` — extended `_ensure_lifecycle_schema`
  with the new product columns + `ost_experiments` + `empathy_maps`
  tables.
- `src/reddit_research/research/product.py` — added `four_risks_get/set`
  and `value_curve_get/set` plus the constants `RISK_KEYS`,
  `VALID_RISK_STATUSES`.
- `src/reddit_research/cli/main.py` — 16 new `research` subcommands.
- `app-tauri/src-tauri/src/commands.rs` — 16 new Tauri commands.
- `app-tauri/src-tauri/src/main.rs` — registered the new commands in
  `tauri::generate_handler!`.
- `app-tauri/src/api.js` — added 16 wrappers + cache-invalidation map
  entries.
- `app-tauri/src/main.js` — registered `#/ost` and `#/ost/<topic>`
  routes.
- `app-tauri/src/lib/tabs.js` — added `git-fork` icon for OST tabs.
- `app-tauri/index.html` — sidebar nav entry for OST.
- `app-tauri/src/screens/solutions.js` — MoSCoW + RICE badges, MoSCoW
  filter chip row, Re-run RICE / MoSCoW buttons.
- `app-tauri/src/screens/product.js` — Four Risks + Value Curve panels.
- `app-tauri/src/screens/playbook.js` — links to new screens, expanded
  framework reference panel.
- `app-tauri/src/style.css` — full styling for the new surfaces.

## Verification

- `uv run python -m reddit_research.cli.main research --help` lists
  every new command.
- `uv run python -m reddit_research.cli.main research ost-build --topic
  nonexistent-test --json` returns a well-formed empty tree.
- `uv run python -m reddit_research.cli.main research rice-score
  --topic nonexistent-test --json` returns a well-formed empty summary.
- `uv run python -m reddit_research.cli.main research four-risks-get
  --id nonexistent-pid --json` returns the expected `not found` error.
- Schema verification: `ost_experiments`, `empathy_maps`,
  `products.four_risks_json`, `products.value_curve_json`,
  `products.outcome` all present after `init_schema`.
- `cargo check` (Tauri side) compiles cleanly with the new commands.
