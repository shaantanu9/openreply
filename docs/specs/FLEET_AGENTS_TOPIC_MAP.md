# FSD Fleet on the Topic Map — Agent Memory, Debate & Trust Badges

**Date:** 2026-06-14
**Status:** Approved design — implementing Phase 0 + Phase 1
**Owner:** shaantanu98
**Source inspiration:** `docs/whybuddy-learnings/00-overview-and-architecture.md` §2.2 (Multi-Agent Collaboration / FSD Fleet)

---

## 1. Goal

Bring WhyBuddy's "Multi-Agent Collaboration (FSD Fleet)" experience into the Topic
Map. Agents that **have memory** read a topic's evidence, **debate** the findings,
and stamp every result with **provenance / trust badges** — all triggerable and
visible from the Map tab.

### Key reframe — most of the backend already exists

| FSD Fleet concept | Already in repo | Location |
|---|---|---|
| 3-level agent memory | Persona system (memories → edges → conclusions → share → rejections) | `src/gapmap/persona/`, 5 DB tables |
| Debate / Critic / Synthesizer | `deliberate()` — 5-persona structured debate → Confirmed/Probable/Minority/Discarded | `src/gapmap/research/deliberate.py`, MCP `gapmap_deliberate` |
| Provenance / Checks ledger / Lineage | `checks_ledger` + `lineage` + `record_check()` / `record_lineage()` | `src/gapmap/core/db.py` |
| Clarification gate | Clarified-brief columns on `topic_prefs` | recent commits |

The work is **~80% UI-surfacing + thin orchestration**, not a from-scratch build.

---

## 2. Phased decomposition

| Phase | Title | New backend? | Ships |
|---|---|---|---|
| **0** | Fleet plumbing | No | JS↔Rust↔sidecar bridge for debate / persona / lineage |
| **1** | Debate on the Map + Trust badges | Minimal (1 migration + 1 orchestrator) | "Debate this topic" button, side panel, badges on nodes + finding cards |
| 2 | Agent Memory overlay ("Agents" tab) | No | Per-agent memories/conclusions, cross-agent agreements/rejections |
| 3 | Full Fleet flow + audit/replay + cost | Yes | clarify→fleet→debate→synthesize, replay timeline, cost panel |

This spec details **Phase 0 + Phase 1** (one user-facing increment). Phases 2–3
get their own spec → plan → build cycles.

---

## 3. Phase 0 — Fleet plumbing

Stack path: **frontend JS (`topic.js`) → Rust command → Python sidecar CLI**.
Follow the existing `api.chat_map` / `run_cli` pattern and the command-registration
triangle (`commands.rs` ↔ `main.rs::generate_handler` ↔ `api.js invoke`).

| New `api.js` fn | Sidecar CLI subcommand | Backend (exists unless noted) |
|---|---|---|
| `api.deliberate(topic, {rounds, provider})` | `research debate` | `research/deliberate.py` via new `run_topic_debate` |
| `api.debateVerdicts(topic)` | `research debate-verdicts` | new reader over `debate_verdicts` (Phase 1) |
| `api.personaIngestTopic(topic)` | `persona ingest-topic` | `persona/ingest.py` |
| `api.personaMemories(personaId, topic)` | `persona memories` | `persona/store.py` |
| `api.lineageForTopic(topic)` | `research lineage` | `core/db.py` reader |

Rules:
- Each subcommand prints a single JSON object to stdout; Rust does tolerant parse.
- `PYTHONUNBUFFERED=1` already set on sidecar spawn.
- No user-visible change in Phase 0; Phase 1 consumes `deliberate` + `debateVerdicts`.

---

## 4. Phase 1 — Debate on the Map + Trust badges

### 4.1 Data model (one lazy-create migration in `core/db.py`)

**`debate_verdicts`** (canonical source of truth)
```
id              INTEGER PK
topic           TEXT
target_kind     TEXT      -- 'finding' | 'node'
target_id       TEXT      -- finding id or graph_nodes.id
tier            TEXT      -- 'confirmed' | 'probable' | 'minority' | 'discarded'
consensus_score REAL      -- 0..1
dissent_json    TEXT      -- [{persona, stance, note}] for dissenters
evidence_post_ids_json TEXT -- ["t3_abc", ...] from lineage / item evidence
transcript_ref  TEXT      -- debate_runs.run_id
findings_hash   TEXT      -- staleness key
run_id          TEXT
provider        TEXT
model           TEXT
created_at      INTEGER   -- epoch ms
```
Index: `(topic, target_id)`, `(topic, run_id)`.

**`debate_runs`** (lightweight audit; Phase 3 expands)
```
id INTEGER PK, topic TEXT, run_id TEXT, rounds INTEGER,
personas_used_json TEXT, status TEXT, cost_tokens INTEGER,
provider TEXT, model TEXT, started_at INTEGER, finished_at INTEGER
```

**`graph_nodes`** += nullable render-cache columns: `debate_tier TEXT`,
`consensus_score REAL`, `debated_at INTEGER`. (Added with `ALTER TABLE` guarded by
a column-exists check, matching the clarified-brief lazy-migration pattern.)

### 4.2 Orchestration — `run_topic_debate(topic, rounds=1, provider=None)`

New function in `src/gapmap/research/debate_run.py` (keeps `deliberate.py` pure):

1. Load cached findings from `topic_insights.report_json`. If none →
   `{ ok: False, reason: "needs_synthesis" }` (no hard error).
2. Compute `findings_hash` = stable hash of finding ids + titles.
3. Open a `debate_runs` row (`status='running'`).
4. Call existing `deliberate(items, topic, rounds, use_llm=provider_available)`.
   If LLM unavailable, `deliberate`'s heuristic path runs → provenance `llm_fallback`.
5. For each tiered item: resolve its finding id and matching `graph_nodes.id`
   (title/text match against existing nodes), then:
   - insert `debate_verdicts` row (tier, score, dissent, evidence ids, hash),
   - update `graph_nodes` cache columns for the matched node,
   - `record_lineage(topic, artifact_id=verdict_id, artifact_kind='debate_verdict', produced_by='deliberate', from_post_ids=evidence, decision=tier, provider, model)`,
   - `record_check(topic, run_id, gate='debate_consensus', operation='deliberate', invariant='tier∈{confirmed,probable,minority,discarded}', passed=True, ...)`.
6. Close `debate_runs` (`status='done'`, `finished_at`, `cost_tokens`).
7. Return summary: counts per tier, run_id, findings_hash, personas_used,
   audience_grounded, provenance.

**Staleness:** verdict stores `findings_hash`; reader compares against current
findings hash → `stale: true` when they differ. UI shows a "stale · re-debate" chip.

### 4.3 Reader — `debate_verdicts_for_topic(topic)`

Returns `{ verdicts: [...], runs_latest: {...}, stale: bool, findings_hash }`.
Joins `evidence_post_ids` count for the badge. Used by `api.debateVerdicts`.

### 4.4 Frontend (`app-tauri/src/screens/topic.js`, Map tab)

- **Toolbar:** add `⚖️ Debate` button + stale chip beside Rebuild/Auto-update
  (reuse the staleness chip pattern at ~`topic.js:2594-2605`). Button calls
  `api.deliberate(topic, {rounds:1})` with the loader-progress pattern, then
  refreshes badges + opens the panel.
- **Debate side panel:** 5 agents listed; tiers as collapsible groups
  (Confirmed/Probable/Minority/Discarded); per-round transcript; dissent rows
  highlighted. Empty/needs_synthesis state prompts "Synthesize findings first".
- **Trust badge** (component `renderTrustBadge(verdict)`), shown on finding cards
  (`renderFindingCard`) and map nodes:
  - tier + score, color-coded (`Confirmed · 0.86`)
  - evidence count (`7 posts`) from `evidence_post_ids`
  - provenance icon (`llm` / `llm_fallback` / `debated`)
  - ⚑ dissent flag when Skeptic/Devil's-Advocate dissented
- **Map-node badges:** map renders inside the exported HTML iframe, so
  `api.exportHtml` (sidecar export path) reads the new `graph_nodes` cache columns
  and paints a compact badge per node. Finding-card badges render directly from
  `api.debateVerdicts(topic)` in JS.

### 4.5 Error handling & flags

- Feature flag `FLEET_DEBATE_ENABLED` (default on) to disable the button/panel.
- No findings → prompt to synthesize (no error).
- LLM absent → heuristic debate, badges labeled `llm_fallback`.
- Debate failure never breaks Map render; the button surfaces an error chip.

### 4.6 Testing

- **Python:** `run_topic_debate` writes verdicts + node cache + lineage + checks;
  staleness hash flips on changed findings; verdict↔node mapping; LLM-fallback
  path; reader returns `stale` correctly. Reuse existing `deliberate` tests.
- **JS:** `renderTrustBadge` variants; stale chip toggle; panel render with mocked
  `debateVerdicts`; needs_synthesis empty state.
- **Smoke:** each new CLI subcommand emits valid JSON.

### 4.7 Out of scope (Phase 1)

Agents memory tab (P2); audit/replay timeline, cost governance panel, streaming
agent reasoning (P3); badges on report/evidence tabs beyond finding cards.

---

## 5. Build sequence

1. DB migration + readers/helpers (`core/db.py`).
2. `run_topic_debate` orchestrator (`research/debate_run.py`) + Python tests.
3. CLI subcommands (`research debate`, `research debate-verdicts`, `research lineage`).
4. Rust command bridge + `api.js` functions.
5. Map toolbar button + debate panel + `renderTrustBadge` + finding-card badges.
6. `exportHtml` node-badge rendering from cache columns.
7. Tests (JS + CLI smoke), `graphify update .`, changelog.

Each numbered step is a focused commit (conventional prefix, explicit paths).
