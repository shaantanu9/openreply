# miroclaw_jyotish → OpenReply — Full Analysis, Reuse Decision, Value Proposition & Data-Source Assessment

> **Date:** 2026-06-07 · **Status:** Analysis / decision record (no production code changed)
> **Source repo analyzed:** `~/Documents/miro_jyotish/miroclaw_jyotish` (esp. `docs/guides/PORTING_GUIDE.md`, `docs/architecture/PREDICTION_SYSTEM.md`, `docs/architecture/DATA_SOURCES.md`, `docs/guides/STRATEGIES_GUIDE.md`, `docs/product/PRODUCT_DEFINITION.md`)
> **Target repo:** `reddit-myind` (OpenReply) — Tauri 2 + Python (PyInstaller) sidecar
> **Companion:** `docs/specs/MIROCLAW_PREDICTION_INTEGRATION.md` (the build-focused subset of this document)

This document is the **single, exhaustive record** of the analysis. It answers four questions in full:
1. What is miroclaw, what's reusable, and at what level would porting it bring things into OpenReply?
2. Why can we **not** simply consume miroclaw as a package/dependency?
3. What is the **end-user value proposition** — usages, applications, features?
4. Can miroclaw's **12 finance data sources** help OpenReply's research & analysis?

---

## PART A — What miroclaw_jyotish actually is

miroclaw_jyotish is a **complete, deployed financial-forecasting product** ("an affordable AI Bloomberg for India"). It is **not** a library. Its surface includes:

- A **Flask backend** + its own **frontend** (market strip, agents tab, prediction UI).
- **Docker / docker-compose** deployment, `start.sh`, 4 LLM execution modes (Ollama / API / Codex / OpenClaw).
- **Neo4j** knowledge graph + **OASIS / CAMEL-AI** multi-agent social simulation (subprocess).
- **12 financial/macro data sources** (yfinance, FRED, BIS, World Bank, Open-Meteo, GDELT, ACLED, …).
- A **Jyotish (Vedic astrology) overlay** computing sidereal planetary positions via pyswisseph.
- A **walk-forward prediction engine** with honest 3-dimension scoring and a self-evolving config loop.
- **23 user-facing features** (per its `FEATURES.md`).

### A critical relationship fact
miroclaw is **downstream of OpenReply.** Its own `PRODUCT_DEFINITION.md` states its audience/personas are derived from "a **OpenReply corpus**" via `openreply search`, `openreply audience_personas`, `openreply find_gaps`. miroclaw is therefore a **consumer** of this very repo — not something this repo would import. The data flow is `OpenReply → miroclaw`, not the reverse.

### Shared ancestry
OpenReply's `research/deliberate.py` header says *"adapted from autoresearch:predict"* — the **same lineage** as miroclaw's strategy ensemble. The multi-persona-consensus idea was already ported into OpenReply once.

---

## PART B — The three portable units (per miroclaw's own PORTING_GUIDE)

miroclaw's authors documented exactly three independently liftable cores. **All three require you to satisfy a tiny LLM interface (`chat` / `chat_json`) — which OpenReply already has** (`research/strategy_common.run_llm_json` + `core/client.complete`).

### P1 — Prediction engine *(the valuable, net-new core)*
A **walk-forward forecasting loop** with a self-improving optimizer:

- **Walk-forward phases:** TRAIN (learn best config on old history) → VALIDATE (score vs known outcomes) → PREDICT (forecast the unknown). Non-overlapping windows.
- **Honest 3-dimension scorer** (`scorer.py` — the "crown jewel"):
  - *Numerical* (40%): `err=|pred−act|/|act|`; ≤band→1.0, ≥band→0.0, linear between.
  - *Directional* (30%): exact→1.0, hedge ("stable")→0.3, wrong→0.0; two-pass extraction.
  - *Event* (30%): binary.
  - *Composite*: **renormalize weights over present dimensions**; `scorable=False` when none — the **load-bearing** rule that prevents future/unfinished periods from being scored 0 and corrupting the optimizer.
- **Config evolution** (`mutator.py` + engine): LLM proposes one parameter mutation → keep if composite improves, else discard (Karpathy-style). Self-tunes which signals/weights maximize measured accuracy.
- **Leak-free time-travel** (`historical_collector.py`): only data dated *before* the target period is collected; per-source min-year guards; caching.
- **Ground truth** (`ground_truth.py`): real outcomes for finished periods; `{"incomplete": True}` for future.
- Persistence is plain files (no DB needed in "quick mode").

### P2 — Persona simulation *(net-new, but heavy)*
A **multi-agent social simulation**: entities → first-person English personas → OASIS/CAMEL-AI agents that post/comment/like in character across rounds → a ReACT **report agent** with a "god view" that can **interview** the running agents. Strict isolation invariant: **the app process never imports OASIS** — the boundary is a **file contract** (`simulation_config.json` in; `actions.jsonl` + SQLite + file-IPC out). Hard deps: CAMEL-AI, OASIS, (optionally) Neo4j.

### P3 — Strategy ensemble *(easiest, but OpenReply already has it)*
N persona "lenses" forecast in parallel → **consensus** (vote tally) + **pairwise-agreement graph** (edge when two agree on ≥K questions) → **weighted conclusion** = argmax Σ(weight × confidence). LLM-only, ~300 lines.

---

## PART C — Persona systems compared (miroclaw vs OpenReply)

The word "persona" means **two different things** in the two repos. This is the core of the user's "learn about the persona" question.

| | miroclaw "persona" | OpenReply "persona" |
|---|---|---|
| **Kind** | Simulation agents (P2) + qualitative trader lenses (P3) | (a) **Audience personas** — clusters of *real* corpus authors; (b) **Learning agents** — single-lens memory agents |
| **Source of identity** | Generated from graph entities (RBI, Sensex, Modi, TCS…) | Real Reddit/HN/etc. authors in the collected corpus |
| **What they do** | Post/comment/interact in an OASIS sim; or give an "in-character" market view | Distill lessons from posts into a memory graph; answer from their own memories; synthesize conclusions; learn from YouTube/video; share lessons across lenses |
| **Grounding** | Synthetic narrative + (optional) graph facts | **Citation-backed** — every claim must cite ≥1 `post_id` |
| **OpenReply files** | — | `research/audience.py`, `persona/{store,ingest,chat,graph,conclude,teach,share}.py` |

**Conclusion:** OpenReply's persona systems are **corpus-native and citation-grounded** — arguably richer for research than miroclaw's synthetic-entity personas. The only thing miroclaw adds is the **interacting social simulation** (P2), i.e. "watch a population *react over time*," which OpenReply does not have.

---

## PART D — How prediction works in miroclaw (the "how we are predicting" question)

1. **Build a simulated India for a point in time.** Populate persona agents from real entities; seed with only the data + astrological climate available *before* the target quarter.
2. **Let agents interact** (full mode, OASIS) **or ask one structured LLM call** (quick mode) → emergent outcome = the prediction.
3. **Fetch ground truth** for the quarter (if finished) from the 12 sources.
4. **Score** the prediction across the 3 honest dimensions.
5. **Evolve** the config to maximize accuracy across sampled historical quarters; keep/discard.
6. **Walk forward:** learn on 1986–2005, validate on 2006–2025, then forecast the future (`scorable=False`).

**Honest result (their own numbers):** composite ≈0.63; numerical ≈0.83 (levels predicted well); **directional ≈0.25 (the weak point)**; event ≈0.50. The Jyotish contribution is *inconclusive / seed-dependent* — they explicitly say "port the method, not a claim."

---

## PART E — What OpenReply ALREADY has (the overlap matrix)

| miroclaw unit | In OpenReply today? | Where / note |
|---|---|---|
| **P3 ensemble** (multi-lens consensus) | ✅ **Yes, equivalent** | `research/deliberate.py` — 5 personas + audience-cluster votes → Confirmed/Probable/Minority/Discarded tiers |
| **Corpus-grounded personas** | ✅ **Yes, two systems** | `research/audience.py` + `persona/*` |
| **LLM seam** (`chat`/`chat_json`) | ✅ **Yes** | `research/strategy_common.run_llm_json`, `core/client.py` |
| **Historical/time-travel fetch** | ✅ **Partial** | `openreply_fetch_historical`, `openreply_corpus_temporal_split` |
| **P1 prediction engine** (scorer + walk-forward + evolution) | ❌ **No** | Net-new |
| **P2 OASIS social simulation** | ❌ **No** | Net-new |

---

## PART F — Will porting add *all* of miroclaw into OpenReply? (NO)

The plan ports the **transferable machinery only** — re-pointed at OpenReply's domain. The reusable cores are ~20–30% of miroclaw's codebase; the remaining ~70% is finance-specific and would be useless or harmful inside a gap-discovery tool.

| miroclaw piece | Into OpenReply? | Why |
|---|---|---|
| Scoring math, walk-forward loop, config evolution (P1 internals) | ✅ Ported (~verbatim) | Domain-agnostic |
| Ensemble/consensus pattern (P3) | 🟡 Extend `deliberate.py` only | Already present (same lineage) |
| OASIS social sim (P2) | 🟡 Optional, isolated, **not** in default DMG | Net-new but heavy |
| **Jyotish astrology overlay** | ❌ Dropped | Irrelevant to gaps |
| **Financial domain** (Sensex/GDP/INR/gold/oil/monsoon) | ❌ Replaced by gap-salience | Wrong target |
| **12 finance data sources** | ❌ Mostly out (see Part J) | Quantitative-macro, not voice-of-customer |
| **Live market strip / trader lenses / OHLC backtesting** | ❌ Out | Finance product surface |
| **Flask app / frontend / Docker / 4 LLM modes** | ❌ Out | OpenReply has its own shell + provider system |

**Level of integration:** *engine internals*, not *product*. We bring the **forecasting & honest-scoring machinery**, not "miroclaw the app."

---

## PART G — Why we can't just use it as a package/dependency

This directly answers "why can't we use that as a package rather than writing whole new code."

1. **It's a Flask *application*, not a pip-installable library.** No published wheel, no semver'd public API, no importable module contract. Its real interface is **HTTP endpoints** bound to its own `Config` + `UPLOAD_FOLDER` conventions.
2. **The valuable modules are hard-coded to Indian finance.** `ground_truth.py` fetches macro outcomes; `historical_collector` runs 8 fixed India queries; `scorer` regexes match `sensex_close`/`gdp_growth_pct`; seed docs are about RBI/Modi/TCS. **miroclaw's own porting guide mandates rewriting `ground_truth` + `historical_collector` + scorer vocab for any new domain** — so these literally cannot be used as-is; they'd predict the wrong thing.
3. **The dependency surface is toxic to the sidecar.** OpenReply ships as a Tauri + PyInstaller DMG. Importing miroclaw drags OASIS, CAMEL-AI, Neo4j, yfinance, pyswisseph, Flask + pinned versions (`camel-ai==0.2.78`, …) into the frozen binary — bloating size and risking the exact UPX/decompression spawn-failures documented in the `tauri-fresh-install-triage` skill. Massive risk for code we'd use ~20% of.
4. **Running it as a separate service doesn't work for a desktop app.** Shipping a DMG that requires the end-user to run a Flask + Neo4j + OASIS server is not viable — and even then it forecasts *Indian markets*, not gaps.
5. **Two repos, different owners/lineage, no release cadence.** A submodule means inheriting their finance-domain churn we don't want.

**The honest bottom line on "new code":** the genuinely reusable files (`scorer.py`, `mutator.py`, `loop_runner.py`) we **copy near-verbatim** — that *is* the "don't rewrite from scratch" win. The "new code" is mostly the **3 domain seams** (`ground_truth`, `historical_collector`, scorer vocab), which **you must write regardless of reuse method** because the porting guide itself requires it. So it is *not* "rewrite everything"; it's "copy ~3 generic files + write ~3 unavoidable domain seams."

---

## PART H — What we copy verbatim vs. rewrite (the concrete reuse map)

| miroclaw file | Action in OpenReply | Effort |
|---|---|---|
| `evolution/scorer.py` | **Copy ~verbatim**, swap metric names/regex only (keep all math + `scorable=False`) | Low |
| `evolution/mutator.py` | **Copy**, redefine `SimulationConfig` fields + `_PARAM_RANGES` | Low |
| `evolution/loop_runner.py` | **Copy**, wire to OpenReply data dir | Low |
| `evolution/prediction_engine.py` | **Adapt** (set OpenReply's walk-forward windows) | Med |
| `evolution/historical_collector.py` | **Rewrite** (reuse `corpus_temporal_split`; leak-free corpus slice) | Med |
| `evolution/ground_truth.py` | **Rewrite** (re-collect topic later; measure salience deltas) | Med |
| `utils/llm_client.py` | **Skip** — use existing `strategy_common`/`client` via a 20-line adapter | Trivial |
| `evolution/jyotish.py` | **Drop** | — |

---

## PART I — Value proposition: usages, applications, end-user features

Today OpenReply **describes the present** ("here are the painpoints/gaps that exist now"). P1 makes it **forecast and self-measure**.

### End-user features gained
| Capability | What the user can now do | Who benefits |
|---|---|---|
| **Gap-growth forecasting** | "Which of these gaps will *grow into demand* in 30/90 days?" → build the rising, skip the fading | Founders / PMs choosing what to build |
| **Honest, measured accuracy** | A real, verified accuracy ceiling per topic instead of vibes — differentiates from AI tools that overclaim | Anyone trusting the output |
| **Self-improving engine** | The evolution loop learns *which signals* predict real demand; calls improve with use | Power users over time |
| **Prioritized, defensible roadmap** | Rank gaps by *predicted growth × confidence* → evidence-backed "build this next" | PMs / founders / investors |
| **(P3 extension) auditable consensus** | Weighted multi-persona vote + camps/dissent per call → "should we bet on this?" panel | Decision-makers |
| **(P2 optional) pre-build reaction sim** | "Simulate how real corpus users react to this idea before building" → cheap validation | Teams de-risking bets |

### Applications (who uses it, for what)
- **Founder** picking a wedge → predicted-growth ranking instead of gut feel.
- **PM** sequencing a roadmap → forecast × confidence prioritization.
- **Investor / scout** screening which painpoints are heating up → early signal with a track record.
- **Researcher** tracking emerging problem areas → measurable trend forecasting.

### One-line value proposition
> *OpenReply stops being a "what's broken now" snapshot and becomes a "what's about to matter" forecaster — with a measured accuracy score so users can actually trust the prioritization.*

---

## PART J — Can miroclaw's 12 finance data sources help OpenReply? (direct answer)

**miroclaw's 12 sources:** yfinance · World Bank · Open-Meteo · GDELT · Google Trends · DuckDuckGo · Google News · India RSS · Tavily · FRED · BIS · ACLED.
**Their purpose:** supply **quantitative, numeric, time-series ground truth** for forecasting India's macro/markets (Sensex levels, GDP %, RBI repo rate, rainfall, conflict counts…). They answer *"what is the measurable STATE of India."*

**OpenReply's ~30 sources** (Reddit, HN, App Store, Play Store, Product Hunt, GitHub issues, Stack Overflow, Trustpilot, arXiv/PubMed/OpenAlex/Scholar, YouTube, RSS, Trends, Discourse, dev.to, Mastodon, Bluesky, Steam, package stats, Wikipedia…) answer a *different* question: *"what are real users SAYING (pain/wishes) and what products EXIST."* This is **qualitative voice-of-customer + competitive landscape**, not numeric macro state.

So the two source sets are **different *kinds* of data for different jobs.** Bulk-importing the 12 would mostly add noise. Source-by-source verdict:

| # | miroclaw source | OpenReply status | Verdict for OpenReply |
|---|---|---|---|
| 5 | **Google Trends** | ✅ Already have (`fetch_trends`) | **Redundant** |
| 7 | **Google News** | ✅ Already have (`fetch_gnews`) | **Redundant** |
| 8 | **India RSS** | ✅ Already have (`fetch_rss` + `rss_catalog`, generic) | **Redundant** (OpenReply's is more general) |
| 4 | **GDELT** | ❌ Not present | **Worth adding (MEDIUM)** — structured global news/event coverage with **historical backfill**, which OpenReply's news lacks. Useful for event-driven topics + as a ground-truth signal for the forecast engine. |
| 6/9 | **DuckDuckGo / Tavily** | ❌ Not present (OpenReply has *no* general web search) | **Worth considering (LOW–MED)** — a generic web-search fallback for context/seed-docs and forecast grounding. DDG keyless; Tavily needs a free key. |
| 2/10/11 | **World Bank / FRED / BIS** | ❌ Not present | **Niche (LOW)** — only useful to enrich the **market-sizing / TAM** feature (`openreply_market_sizing`) with real macro/economic context. Not for painpoint/gap discovery. Optional, key-gated. |
| 1 | **yfinance** | ❌ | **Irrelevant** unless analyzing a markets/fintech topic specifically. Stock prices ≠ product demand. |
| 3 | **Open-Meteo** | ❌ | **Irrelevant** (weather). |
| 12 | **ACLED** | ❌ | **Irrelevant** (conflict events). |

### The genuinely useful takeaways from miroclaw's data layer
1. **GDELT** — the single most defensible *additive* source for OpenReply (historical, structured, event-aware news). Add as a normal `fetch_gdelt` adapter following the existing `sources/` pattern.
2. **A general web-search layer (DuckDuckGo/Tavily)** — fills a real hole: OpenReply currently has no broad web search, only specific platforms. Most valuable as a **seed/ground-truth context source** for the P1 forecast engine.
3. **The *architecture* lesson, not the sources:** miroclaw's `router.py` (keyword → source selection) + per-source **historical-capability flags** + **per-source min-year guards** + leak-free date-range queries are exactly the pattern the P1 engine needs for leak-free `historical_collector`. **That design pattern is more valuable to copy than any individual finance source.**
4. **World Bank/FRED/BIS** — keep on the shelf for a future **market-sizing enrichment**, not for core gap research.

### Bottom line on sources
- **3 of 12** are duplicates OpenReply already has.
- **3 (yfinance, Open-Meteo, ACLED)** are irrelevant to product/market gap research.
- **3 (World Bank, FRED, BIS)** are niche — only for market-sizing/TAM, optional.
- **3 (GDELT, DuckDuckGo, Tavily)** are the **real candidates** — and they matter *most* in service of the P1 forecast engine, not as standalone discovery sources.

So: **the 12 finance sources do NOT broadly help OpenReply's gap research** (different data philosophy), **except GDELT + a web-search layer**, which are worth adding — primarily to strengthen the forecasting engine's seed-docs and ground truth.

---

## PART K — Data philosophy difference (why most sources don't transfer)

| | miroclaw sources | OpenReply sources |
|---|---|---|
| **Question answered** | "What is the numeric STATE of India?" | "What do users SAY / what products EXIST?" |
| **Data type** | Quantitative time-series (prices, rates, rainfall, event counts) | Qualitative text (posts, reviews, issues, papers) + product/competitor signals |
| **Job** | Ground truth for numeric forecasting | Voice-of-customer pain/wish discovery + competitive landscape |
| **Transferability** | Low — only where OpenReply needs numeric context (forecast ground truth, market sizing) | — |

This is the root reason "use the 12 sources" mostly doesn't apply: they were built to *measure outcomes for scoring*, which is exactly what the **P1 ground-truth seam** needs — but OpenReply's ground truth for *gap salience* is **its own corpus over time**, not financial tickers.

---

## PART L — Recommendation & sequenced plan

1. **Build P1** (the only net-new, high-value, zero-new-heavy-dep core), re-domained to **painpoint/gap salience growth**:
   - Phase A: LLM-seam adapter + port `scorer.py` + unit tests.
   - Phase B: `historical_collector` (via `corpus_temporal_split`) + `ground_truth` (re-collect & compare; back-testable on existing corpus *today*) + `simulate_quick` + `engine` + `loop_runner` + `ledger`.
   - Phase C: `mutator` + evolution loop; `mcp/tools/forecast_tools.py`; CLI; Research-Mode "Forecast" panel.
2. **Extend `deliberate.py`** with miroclaw's two P3 ideas (weighted consensus + agreement-graph; optional "Forecaster" lens). No new module.
3. **Add GDELT** (`sources/gdelt.py` + `fetch_gdelt`) and consider a **DuckDuckGo/Tavily web-search adapter** — primarily to enrich P1 seed-docs/ground truth. Following the existing `sources/` + `collect_adapter` pattern.
4. **Optionally, later:** World Bank/FRED/BIS as a **market-sizing** enrichment (key-gated).
5. **P2 (OASIS)** last — optional dependency extra, `enable_sim` flag, **never in the default DMG**, strict file-contract isolation.

**Effort:** P1 ≈ 1–1.5 weeks (no new heavy deps); P3 extension ≈ 0.5 day; GDELT/web-search ≈ 1–2 days; P2 ≈ 1–1.5 weeks (only if population-reaction depth is wanted).

---

## PART M — Open questions before build
- Forecast horizon(s): 30d / 90d / quarter?
- Minimum corpus history before a topic is "forecastable" (per-source min-year analog)?
- Where the Forecast panel sits in the Research-Mode stage bar (Synthesize vs a new stage)?
- Is market-sizing enrichment (World Bank/FRED/BIS) wanted at all, or out of scope?

---

## Appendix 1 — miroclaw's 12 sources (full)
yfinance (15 NSE/BSE tickers, OHLCV, hist 1993–) · World Bank (9 India macro, annual) · Open-Meteo (12 cities, weather, 1940+) · GDELT (global news, India filter) · Google Trends (geo=IN, 2004+) · DuckDuckGo (web/news) · Google News (en-IN RSS) · India RSS (8 papers) · Tavily (web, key) · FRED (10 US macro, key) · BIS (RBI rate / INR REER / credit-GDP, monthly) · ACLED (conflict/protest events, key).

## Appendix 2 — OpenReply's sources (current)
Reddit (posts/comments/users/search/historical/stream) · App Store · Play Store · Product Hunt · Hacker News · GitHub issues/repos · Stack Overflow · Trustpilot · arXiv · PubMed · OpenAlex · Semantic Scholar · Google Scholar · Crossref · Unpaywall · Europe PMC · DBLP · YouTube (+ transcribe) · RSS (+ catalog) · Google Trends · Google News · Discourse · dev.to · Lemmy · Mastodon · Bluesky · Steam · npm/PyPI package stats · Wikipedia · AlternativeTo · local file import.

## Appendix 3 — Key source documents (in miroclaw repo)
- `docs/guides/PORTING_GUIDE.md` — the reuse contract (P1/P2/P3, the LLM seam, copy-lists, anti-patterns).
- `docs/architecture/PREDICTION_SYSTEM.md` — end-to-end prediction flow + honest scoring.
- `docs/architecture/DATA_SOURCES.md` — the 12 sources in full (Part J/Appendix 1 derive from this).
- `docs/guides/STRATEGIES_GUIDE.md` — qualitative + mechanical strategy personas (P3).
- `docs/product/PRODUCT_DEFINITION.md` — audience personas + the OpenReply dependency.
