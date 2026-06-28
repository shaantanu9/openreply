# Spec — Porting miroclaw_jyotish's Prediction & Persona Cores into OpenReply

> **Date:** 2026-06-07 · **Status:** Draft for review (no code written yet)
> **Source repo:** `~/Documents/miro_jyotish/miroclaw_jyotish` (its `docs/guides/PORTING_GUIDE.md` is the upstream porting contract)
> **Target:** `reddit-myind` (OpenReply) — Tauri 2 + Python (PyInstaller) sidecar
> **Forecast target chosen:** *painpoint / gap salience growth*
> **Scope chosen:** P1 (prediction engine) + P2 (OASIS persona sim) + P3 (strategy ensemble)

---

## 0. Executive summary & honest framing

miroclaw exposes three portable units. Re-checked against OpenReply's existing code, the value is **very uneven** — this spec keeps all three in scope (as requested) but sequences them by real marginal value:

| Unit | Marginal value to OpenReply | Verdict |
|---|---|---|
| **P1 — prediction engine** | **High — net-new.** OpenReply has no forecasting/scoring/self-evolution. This turns "describe the present" into "forecast which gaps grow, with measured accuracy." | **Build (priority).** |
| **P3 — strategy ensemble** | **Low — mostly redundant.** `research/deliberate.py` is the *same autoresearch lineage* (5-persona consensus + audience votes). | **Extend deliberate.py, do not duplicate.** |
| **P2 — OASIS persona sim** | **Medium but heavy.** Net-new "population reacts" depth, but CAMEL-AI + Neo4j + subprocess is a real sidecar/packaging risk. | **Build last, behind a feature flag, optional dep — never bundled into the default DMG.** |

**Architectural note:** miroclaw is *downstream* of OpenReply (it consumes `openreply search` / `audience_personas` / `find_gaps`). So nothing is imported "from that repo as a dependency." We **re-implement the domain-agnostic cores** (the porting guide is written for exactly this) against OpenReply's own corpus + LLM seam.

**Zero new heavy deps for P1/P3.** P2 alone adds optional deps, isolated behind a contract.

---

## 1. The shared seam (already satisfied)

The porting guide's one hard requirement is an LLM client exposing `chat` / `chat_json`. OpenReply already has the equivalent:

- `research/strategy_common.py::run_llm_json(...)` — provider resolution + tolerant JSON parse, returns `None` when no key (degrade, never raise).
- `core/client.py` + `complete()` — the chat primitive.

**Action:** add a thin `forecast/llm_seam.py` adapter exposing `chat(messages, ...)` / `chat_json(messages, ...)` that delegates to the above. ~20 lines. This is the single seam all three units code to.

---

## 2. P1 — Gap-Salience Prediction Engine (priority)

### 2.1 What it predicts
For a topic, forecast over a future window (e.g. next 30/90 days) **per painpoint/gap**:
- **Numerical:** predicted mention-volume and/or growth % vs actual.
- **Directional:** salience up / down / flat.
- **Event (binary):** "will a product launch / competitor ship addressing this gap?" (Y/N).

Then **self-score** against ground truth once the window elapses, and **self-evolve** the signal-weighting config to maximize measured accuracy.

### 2.2 Module layout (new package)
```
src/openreply/research/forecast/
  __init__.py
  llm_seam.py            # chat / chat_json adapter over strategy_common + client
  scorer.py              # ← PORT ~VERBATIM from miroclaw evolution/scorer.py (crown jewel)
  mutator.py             # ← PORT; SimulationConfig dataclass + LLM mutation proposer
  ground_truth.py        # NEW (domain): re-collect topic later, compute actual salience deltas
  historical_collector.py# NEW (domain): leak-free pre-window corpus slice + seed-doc builder
  predictor.py           # simulate_quick (1 LLM call) [+ simulate_full → P2 later]
  engine.py              # walk-forward orchestrator (analog of prediction_engine.py)
  loop_runner.py         # ← PORT; create/start/stop/status/list lifecycle (file-backed)
  ledger.py              # accuracy_ledger.jsonl append + read
```
**Dropped from miroclaw:** `jyotish.py` (irrelevant), Neo4j requirement (quick mode needs none).

### 2.3 The three domain seams to write (everything else ports unchanged)

**(a) `historical_collector.collect_for_window(topic, as_of_date, config) -> dict`**
- Reuse the existing temporal-split machinery (`openreply_corpus_temporal_split`, already wired in `mcp/server.py`) to return **only posts dated before `as_of_date`** — no look-ahead.
- `build_seed_document()` → markdown brief the LLM reads: top painpoints, mention counts, sentiment, source mix, recent deltas. Reuse evidence bundling from `strategy_common.topic_context`.
- **Cache** the slice to disk keyed by `(topic, as_of_date, config_hash)`.

**(b) `ground_truth.fetch_window_truth(topic, window) -> dict`**
- For an **elapsed** window: re-derive actual per-painpoint mention-volume / sentiment / growth from corpus posts now dated *inside* the window; check `monitor.py` / `product_signals` for launches addressing the gap.
- For a **not-yet-elapsed** window: return `{"incomplete": True}` → **`scorable=False`** (LOAD-BEARING; without it the optimizer corrupts on future forecasts).
- **Cache** keyed by `(topic, window)`.
- *Data dependency:* needs ≥2 collection passes over a topic separated in time. Bootstrap by replaying existing historical corpus (split an old topic at date T, predict T→T+90, score against T+90 reality already in the corpus). This means we can validate accuracy **today** on back-data, not only wait 90 days.

**(c) `scorer.py` vocab swap (keep all math)**
- Keep verbatim: numerical band-scoring (`err=|pred-act|/|act|`, full/zero bands), directional (exact 1.0 / hedge 0.3 / wrong 0.0, two-pass extraction), event binary, composite renormalization over present dims, `scorable=False` when none present.
- Swap only: metric names (`sensex_close` → `mention_volume`, `gdp_growth_pct` → `salience_growth_pct`), the `DIRECTIONS:` vocab, and the event vocabulary.

### 2.4 Config & evolution (`mutator.py` + `engine.py`)
- `ForecastConfig` dataclass fields = **signal weights** OpenReply already computes: e.g. `mention_velocity_w`, `sentiment_slope_w`, `cross_source_breadth_w`, `competitor_activity_w`, `recency_halflife_days`, `engagement_w`, plus `use_quick_sim`.
- `_PARAM_RANGES` per field for the LLM mutation proposer.
- `engine.py` walk-forward windows (analog of miroclaw's 1986-2005 / 2006-2025 / live):
  - **TRAIN:** oldest N% of corpus history → learn best config (quick sim).
  - **VALIDATE:** next M% → honest accuracy vs known outcomes.
  - **PREDICT:** newest cutoff → forecast forward (`scorable=False`).
- Keep/discard: `composite > best ? keep : discard`; persist `best_config.json`, `evolution_state.json`, append to `ledger.py`.

### 2.5 Persistence (no DB — matches miroclaw quick mode)
Write plain files under the app data dir (reuse `core/config.py` upload/data folder):
```
<data>/forecasts/<run_id>/  run_state.json, evolution_state.json, best_config.json,
                            prediction.md, analysis_{train,validate,live}.md
<data>/forecasts/_cache/    historical_window/*, ground_truth/*
<data>/forecasts/accuracy_ledger.jsonl
```

### 2.6 Surface
- **MCP tools** (`mcp/tools/forecast_tools.py`, sub-server pattern like `persona_tools.py`):
  `openreply_forecast_create`, `_start` (phase: train/validate/live/all), `_status`, `_best`, `_prediction`, `_ledger`, `_list`, `_delete`.
- **CLI:** `cli/forecast_cmds.py` mirroring the MCP surface.
- **Research Mode panel:** a "Forecast" card in the existing Gather→Read→Synthesize→**Write** flow showing predicted gap growth + the honest accuracy ceiling.

### 2.7 P1 acceptance checks
- [ ] A finished/back-tested window produces a numeric composite score.
- [ ] A future window returns `scorable=False` (not 0).
- [ ] Ledger grows one row per scored iteration.
- [ ] `/best` config changes across iterations (evolution works).
- [ ] No new pip deps; runs with provider unset → clean "configure an LLM key" empty state.
- [ ] Honest-ceiling discipline: report measured composite, never a fabricated high %.

### 2.8 Estimated effort
Scorer port + tests (1–2d) → quick-mode predictor + seams (2–3d) → evolution loop (2d) → surface/MCP/UI (1–2d). **~1–1.5 weeks.**

---

## 3. P3 — Strategy Ensemble (extend, don't duplicate)

OpenReply already has `research/deliberate.py` (Synthesizer/Skeptic/Quantifier/Risk-Officer/Devil's-Advocate + audience-cluster votes → Confirmed/Probable/Minority/Discarded). miroclaw's P3 adds two ideas worth grafting on **without** a new module:

1. **Per-persona prior `weight` + `confidence_range`**, and a **weighted conclusion = argmax Σ(weight × confidence)** per option.
2. **Pairwise-agreement graph** (edge when two personas agree on ≥K questions) to surface camps/dissenters explicitly.

**Action:** extend `deliberate.py` output with (a) weighted-consensus scoring and (b) an agreement-edge list. Optionally feed the **P1 forecast** in as one additional "Forecaster" lens so the panel debates predicted growth, not just present findings. **No new files; ~half a day.** Do **not** port miroclaw `strategies/*` (financial trader lenses are off-domain).

---

## 4. P2 — OASIS Persona Simulation (last, isolated, optional dep)

Net-new capability ("simulate how a population of real users reacts to a gap/idea"), but the heaviest. Treat it as an **optional, flag-gated subsystem that is never in the default sidecar bundle.**

### 4.1 Hard isolation invariant (from the porting guide — preserve exactly)
The app/sidecar process **must never import OASIS/CAMEL-AI.** The boundary is a **file contract**:
- IN: `simulation_config.json` (+ `reddit_profiles.json`)
- OUT: `actions.jsonl`, `{platform}_simulation.db` (SQLite), file-IPC dirs (`ipc_commands/` ↔ `ipc_responses/`, `env_status.json`).
This lets us swap OASIS for any agent framework by reimplementing only `scripts/run_*` against the contract.

### 4.2 Module layout
```
src/openreply/research/sim/
  entity_source.py          # corpus authors / audience clusters → EntityNode (flat JSON; storage=None, NO Neo4j)
  profile_generator.py      # ← PORT oasis_profile_generator.py; KEEP English-mandate; storage=None path
  sim_config_generator.py   # personas → time/event/agent config
  sim_runner.py             # spawn + monitor subprocess (start_new_session=True, tail-read, ceiling)
  sim_ipc.py                # file-based interview IPC
  report_agent.py           # ← PORT ReACT report; graph_tools shim over flat facts (no Neo4j)
scripts/
  run_reddit_simulation.py  # the ONLY place OASIS is imported
```
Reuse **`audience.py` clusters** as the entity source — OpenReply's personas are *real corpus authors*, a strictly better seed than synthetic entities.

### 4.3 Packaging / sidecar rules (critical — per project CLAUDE.md & tauri skills)
- OASIS deps (`camel-oasis==0.2.5`, `camel-ai==0.2.78`, optional `neo4j>=5.15`) go in an **optional extra** (`[project.optional-dependencies] sim = [...]`), **excluded from the PyInstaller spec** used for the shipped DMG.
- Feature flag `app_mode`/`enable_sim` (you already have the `app_mode` plumbing from Research Mode Phase 0). When off, the Sim UI is hidden and no OASIS import is attempted.
- If shipped at all, it's a separate "power user" build or a dev-venv-only feature — **default DMG stays OASIS-free** to avoid the decompression / spawn-failure class documented in `tauri-fresh-install-triage`.

### 4.4 P2 acceptance checks
- [ ] App/sidecar process imports cleanly with `sim` extra **absent** (no OASIS import error).
- [ ] With extra present: prepare → profiles → start → `actions.jsonl` grows → interview returns an in-character answer.
- [ ] Default DMG contains no OASIS/Neo4j; `enable_sim=false` hides UI.

### 4.5 Estimated effort
~1–1.5 weeks (subprocess + IPC + report agent + packaging isolation). **Lowest ROI; schedule after P1 ships and only if population-reaction depth is actually wanted.**

---

## 5. Dependency surface

| Unit | New deps | Bundled in default DMG? |
|---|---|---|
| P1 | **none** (reuses existing LLM seam) | yes |
| P3 | **none** | yes |
| P2 | `camel-oasis`, `camel-ai`, opt `neo4j` — **optional extra only** | **no** |

---

## 6. Anti-patterns to avoid (from porting guide + this project's scars)
- **Don't drop `scorable=False`.** Future windows must not score 0 (corrupts keep/discard). (P1)
- **Don't skip caching** in `ground_truth`/`historical_collector` — re-collection is expensive and SQLite write-contention is already a known pain (see changelog `collect-database-locked-retry`). (P1)
- **Don't claim accuracy you didn't verify.** Publish the measured ceiling; miroclaw's own Jyotish result is *inconclusive* — port the method, not a claim. (P1)
- **Don't import OASIS into the sidecar process.** File contract only; never in the default bundle. (P2)
- **Don't duplicate `deliberate.py`.** Extend it. (P3)
- **Keep the English/target-language mandate** in persona prompts (multilingual corpus leaks otherwise). (P2)

---

## 7. Sequenced delivery plan

1. **P1 Phase A** — `llm_seam.py` + port `scorer.py` + unit tests. *(highest value, no deps)*
2. **P1 Phase B** — `historical_collector` + `ground_truth` (back-test on existing corpus via temporal split) + `predictor.simulate_quick` + `engine` + `loop_runner` + `ledger`.
3. **P1 Phase C** — `mutator` + evolution loop; MCP `forecast_tools.py`; CLI; Research-Mode Forecast panel.
4. **P3** — extend `deliberate.py` (weighted consensus + agreement graph; optional Forecaster lens).
5. **P2** — `sim/*` + `scripts/run_reddit_simulation.py` behind `sim` extra + `enable_sim` flag; packaging isolation; **default DMG unchanged.**

Each phase is independently shippable. Recommend **branch `feature/gap-forecast`**, `codegraph sync` after each phase, changelog per phase, and update `FEATURES.md` as units land.

---

## 8. Open questions before Phase A
- Forecast horizon(s) to support (30d / 90d / quarter)?
- Minimum corpus history required before a topic is "forecastable" (guard like miroclaw's per-source min-year)?
- Where exactly in the Research-Mode stage bar the Forecast panel sits (Synthesize vs a new stage)?
