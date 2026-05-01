# Discovery framework v2 — full UI for every missing surface

**Date:** 2026-05-01
**Type:** Feature

## Summary

Wired every still-missing surface from the resumeforge product-discovery
guide into Gap Map. Eight new operational tools — one per phase that had
either backend-only support or no support at all — landing as new screens,
new product-dashboard panels, or new database-backed CRUD pipelines.

| Framework / instrument | Source | New surface |
| --- | --- | --- |
| Empathy Map | Gray (2010) / Stanford d.school | New `#/empathy` screen + `#/empathy/<topic>` tree |
| Customer Discovery Interviews (Mom Test) | Fitzpatrick (2013) / Steve Blank | New `#/interviews` + `#/interviews/<topic>` |
| Sean Ellis PMF Survey | Ellis (2010) | New `#/pmf` + `#/pmf/<topic>` |
| Van Westendorp PSM | Van Westendorp (1976, ESOMAR) | New `#/pricing` (VW tab) |
| Net Promoter Score | Reichheld (HBR, 2003) | New `#/pricing` (NPS tab) |
| MaxDiff | Louviere et al. | New `#/pricing` (MaxDiff tab) |
| Three-Point PERT | US Navy (1958), McConnell (2006) | New `#/estimate/<product>` |
| Cost model + LTV/CAC tier proposal | Blank/Dorf 2012, Skok | Same screen as PERT |
| TAM / SAM / SOM | Blank & Dorf (2012) | New panel on `#/product/<id>` |
| Porter's Five Forces | Porter (HBR, 1979) | New panel on `#/product/<id>` |
| 2×2 Positioning Map | Ries & Trout (1981) | New panel on `#/product/<id>` |
| PRD generator | Cagan / Engprax 2024 | New `#/prd/<product>` aggregating everything |

## Changes

- **Schema migration (idempotent)** — `_ensure_lifecycle_schema` extended
  with: 5 new tables (`interviews`, `pmf_responses`, `survey_responses`,
  `pert_tasks`) and 3 new product columns (`porter_forces_json`,
  `positioning_map_json`, `cost_model_json`). All migrations are additive
  and tolerant of pre-existing schemas.
- **Empathy Map screen** — finally surfaces the `empathy_maps` table that
  was already populated by `research/empathy.py`. Build / refresh button
  re-mines the corpus + LLM-fills the four quadrants; offline fallback
  works without an LLM key. Says-vs-Does gap insight surfaced in its own
  yellow callout card.
- **Customer Discovery Interviews** — `research/interviews.py` (CRUD +
  `summarize`), `prompts/empathy.yaml` already covers per-corpus
  empathy. New `interviews` table captures who/persona/channel/duration/
  summary/full-text/JTBD-quote/current-solution/willingness-to-pay/
  Mom-Test-rigour/follow-up. Mom Test prompts surfaced in the form so PMs
  ask "what's the hardest part of X?" rather than "would you use this?"
  Summary panel computes solution-theme and WTP themes across interviews.
- **Sean Ellis PMF Survey** — `research/pmf.py` adds responses, computes
  the 40% threshold, and segments by persona (per Vohra/Superhuman 2019).
  Score panel shows the bar chart + verdict + persona breakdown. The
  4-bucket disappointment counts use the canonical `dont_use` exclusion
  from the denominator.
- **Pricing surveys** — `research/pricing.py` implements:
  - **Van Westendorp**: 4 price questions per response, computes OPP /
    IPP / PMC / PME via curve-intersection at fine grid.
  - **NPS**: standard %promoters − %detractors; banding shown.
  - **MaxDiff**: best/worst counting with normalized BW score
    `(best − worst) / appearances` for stable ranking.
- **Three-Point PERT estimation + cost model** —
  `research/pert.py` stores tasks, computes
  `E = (O + 4M + P) / 6` and `SD = (P − O) / 6` per task; rollup applies
  McConnell's 1.5–2× overhead multiplier and 15–20% contingency, with
  per-role and per-tier breakdowns. Cost-model panel captures blended
  rate, infra/mo, maintenance %, LTV/CAC ratio (warns if < 3×), and
  arbitrary-many tier proposals.
- **TAM / SAM / SOM panel** — `research.product.tam_sam_som_get/set`
  attaches market sizing to the product dashboard. Three colored
  cards (TAM blue, SAM green, SOM amber) with method picker (top-down
  / bottom-up / value-theory), source citation, notes.
- **Porter's Five Forces panel** — `research.product.porter_get/set`
  per-force score 1..5 with notes. Five-card grid on the product
  dashboard; clicking a score pill saves immediately.
- **2×2 Positioning Map** — `research.product.positioning_get/set`
  + inline SVG plot on the product dashboard. Live-update as
  X/Y sliders move; can mark one row as `is_self`.
- **PRD generator** — `research/prd.py` aggregates EVERY discovery
  artefact attached to a product into a single markdown document:
  outcome, JTBD/opportunities + Kano + MoSCoW + RICE, experiments,
  Four Risks, Empathy Maps, TAM/SAM/SOM, Porter, positioning map,
  Value Curve, PMF score, NPS, Van Westendorp, MaxDiff,
  customer interviews, PERT rollup, cost model, MoSCoW Won't list.
  PRD viewer (`#/prd/<id>`) renders preview + raw textarea, copy
  to clipboard, download `.md` file.
- **CLI commands** (all `--json` mode):
  `tam-sam-som-get/set`, `porter-get/set`, `positioning-get/set`,
  `cost-model-get/set`, `interview-create/update/delete/get/list/summary`,
  `pmf-add/list/score/delete`, `vw-add/aggregate`, `nps-add/score`,
  `maxdiff-add/ranking`, `survey-list/delete`,
  `pert-add/update/delete/list/rollup`, `prd-export`. 28 new commands.
- **Tauri commands** — 28 new `#[tauri::command]` wrappers in
  `commands.rs` with parallel registration in `main.rs`. `cargo check`
  compiles cleanly.
- **api.js wrappers** — 28 new entries with parallel cache
  invalidation map.
- **Sidebar navigation** — 4 new entries (Empathy maps, Interviews,
  PMF survey, Pricing surveys).
- **Product dashboard toolbar** — quick-jump buttons on every product
  page to Empathy / Interviews / PMF / Pricing / PERT&Cost / PRD.
- **Playbook updates** — Phase 01 lists Empathy + Interviews,
  Phase 02 adds PMF + Pricing, Phase 03 adds PERT + Cost +
  PRD. Frameworks-referenced grew 14 → 24 entries.
- **Tabs.js icons** — 6 new icons mapped (`users`, `mic`,
  `bar-chart-3`, `dollar-sign`, `calculator`, `file-text`).
- **CSS** — ~430 new lines covering all 8 new screens / panels.

## Files Created

- `src/reddit_research/research/interviews.py`
- `src/reddit_research/research/pmf.py`
- `src/reddit_research/research/pricing.py`
- `src/reddit_research/research/pert.py`
- `src/reddit_research/research/prd.py`
- `app-tauri/src/screens/empathy.js`
- `app-tauri/src/screens/interviews.js`
- `app-tauri/src/screens/pmf.js`
- `app-tauri/src/screens/pricing.js`
- `app-tauri/src/screens/estimate.js`
- `app-tauri/src/screens/prd.js`
- `changelogs/2026-05-01_05_full-discovery-framework-ui-empathy-interviews-pmf-pricing-pert-prd.md`

## Files Modified

- `src/reddit_research/core/db.py` — extended `_ensure_lifecycle_schema`
  with the 4 new tables and 3 new product columns.
- `src/reddit_research/research/product.py` — added
  `tam_sam_som_get/set`, `porter_get/set` + `PORTER_FORCES`,
  `positioning_get/set`, `cost_model_get/set`. Updated `__all__`.
- `src/reddit_research/cli/main.py` — 28 new `research` Typer
  subcommands.
- `app-tauri/src-tauri/src/commands.rs` — 28 new Tauri commands.
- `app-tauri/src-tauri/src/main.rs` — registered the 28 new
  command handlers.
- `app-tauri/src/api.js` — 28 new wrappers with cache invalidation.
- `app-tauri/src/main.js` — registered 6 new screen renderers and
  10 new route patterns (picker + topic / product variants).
- `app-tauri/src/lib/tabs.js` — 6 new icon mappings.
- `app-tauri/index.html` — 4 new sidebar nav entries.
- `app-tauri/src/screens/product.js` — Three new product-dashboard
  panels (TAM/SAM/SOM, Porter, Positioning) plus the discovery
  toolbar that quick-links to every new screen.
- `app-tauri/src/screens/playbook.js` — refreshed Phase 01/02/03
  app links and the framework reference panel (14 → 24 frameworks).
- `app-tauri/src/style.css` — ~430 lines of new styling for all
  new surfaces.

## Verification

- `uv run python -c "from reddit_research.research import product, interviews, pmf, pricing, pert, prd"` — all imports clean.
- `uv run python -m reddit_research.cli.main research --help` —
  every new CLI command listed.
- End-to-end PMF round-trip: 3 responses added → score returns
  correct counts (33.3%, threshold not met).
- End-to-end PERT round-trip: 2 tasks added → rollup returns correct
  E (8.5 days from 5/8/14 → (5 + 32 + 14)/6 = 8.5) and SD (1.5 from
  (14 − 5)/6 = 1.5).
- End-to-end PRD: TAM/SAM/SOM, Porter, positioning all populated and
  rendered into the markdown output (1072 chars).
- `cargo check` passes on the Tauri side.
- `node --check` passes on every touched JS file.
- All schema migrations confirmed additive on a pre-existing dev DB.
