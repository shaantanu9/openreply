# CLI → Desktop coverage audit + plan

**Date:** 2026-04-19
**Status:** Audit complete. Awaiting prioritization decision before implementation specs are written.
**Companion:** `2026-04-19-research-loop-design.md` (the in-flight Solutions feature)

## Why this exists

Today the desktop app exposes ~70% of the CLI's capabilities. The other ~30% are real, working CLI commands that no UI can reach — power users have to drop to a terminal. This doc:

1. Lists **everything we built** in the research-loop MVP (so you have a ledger to refer to)
2. Audits **every CLI command** against its desktop status (wired / not wired)
3. Recommends **which gaps to close**, in priority order
4. Is a roadmap input — not an implementation plan. Each promoted item needs its own spec via brainstorming → writing-plans.

---

## Part 1 — What we built in this session (research-loop MVP)

The work landed across 9 commits on the `research-loop-mvp` branch (off `multi-source` HEAD). Here's the ledger:

### Python pipeline (4 stages)

| File | Purpose | Tests | Commit |
|---|---|---|---|
| `prompts/why.yaml` | Plutchik emotion + JTBD extraction prompt | — (smoke-load) | `ea42d7a` |
| `src/reddit_research/research/why.py` | `extract_why_for_painpoint`, `extract_why_for_topic`, `_evidence_posts_for` | 4 unit tests | `94560be`, `2cf5a37` |
| `src/reddit_research/research/science.py` | `fetch_science_for_painpoint` — wraps PubMed/Scholar/OpenAlex, dedupes by title, tier-tags | 3 unit tests | `2d1cf96` |
| `prompts/solutions.yaml` | Intervention synthesis prompt grounded in papers | — (smoke-load) | `5b7478f` |
| `src/reddit_research/research/solutions.py` | `synthesize_solutions_for_painpoint` + `solutions_pipeline` orchestrator | 3 + 1 integration tests | `65057e6`, `ad76061` |
| `src/reddit_research/research/persist_solutions.py` | Graph upserts: `persist_why_for_painpoint`, `persist_papers_for_painpoint`, `persist_solutions_for_painpoint` | 4 unit tests | `ab1d9fa` |
| `src/reddit_research/research/__init__.py` | Re-exports all new public functions | — | `e247c8a` |

**Total tests added:** 15 new (5 baseline still pass = 20 total green)

### CLI surface (new)

| Command | Flags | Purpose |
|---|---|---|
| `reddit-cli research solutions` | `--topic`, `--provider`, `--papers`, `--json` | Run the full Problem → Why → Science → Solution pipeline for a topic. Idempotent (re-run upserts). |

### New graph node + edge kinds (no schema migration — `kind` is free-text)

| Node kind | What it represents | Created by |
|---|---|---|
| `evidence_paper` | A scientific paper linked to a painpoint | `persist_papers_for_painpoint` |
| `mechanism` | "Why this intervention works" — 1 sentence with theory basis | `persist_solutions_for_painpoint` |
| `intervention` | An actionable imperative grounded in ≥1 paper | `persist_solutions_for_painpoint` |

| Edge kind | Direction | Meaning |
|---|---|---|
| `has_evidence` | painpoint → evidence_paper | Paper retrieved for this painpoint |
| `explained_by` | painpoint → mechanism | Why people feel this way |
| `addressed_by` | mechanism → intervention | Concrete actions that work |
| `supported_by` | intervention → evidence_paper | Citations backing this intervention |

### Still pending in the research-loop MVP plan (paused for this audit)

| Task # | What | Status |
|---|---|---|
| 10 | Tauri `run_solutions_pipeline` command + JS bridge | Pending |
| 11 | `app-tauri/src/screens/solutions.js` — Solutions tab content | Pending |
| 12 | Mount Solutions tab in `topic.js` + CSS | Pending |

These three are still planned — the audit below recommends keeping them as the next concrete work, then layering broader gap-closure on top.

---

## Part 2 — Full CLI audit

Every command in `src/reddit_research/cli/main.py`, cross-referenced against `app-tauri/src-tauri/src/commands.rs` (Tauri layer) and `app-tauri/src/api.js` (JS bridge).

### Top-level commands (`reddit-cli <cmd>`)

| CLI command | Purpose | Tauri cmd | JS bridge | UI screen | Coverage |
|---|---|---|---|---|---|
| `info` | DB location + table counts | `cli_info` | `cliInfo()` | Settings (badge) | ✅ wired |
| `search` | Reddit/PRAW raw search | — | — | — | ❌ **CLI only** |
| `stream` | Live-stream new posts from a sub | — | — | — | ❌ **CLI only** |
| `query` | Run arbitrary SQL | `run_query` | `runQuery()` | Database tab | ✅ wired (different shape) |
| `export` | Export rows (csv/json/tsv/parquet) | `export_html`, `export_report_pro` | both | Reports tab | ✅ partial (HTML/report only — no CSV/JSON/TSV/Parquet from UI) |

### Research subgroup (`reddit-cli research <cmd>`)

| CLI command | Purpose | Tauri cmd | JS bridge | UI screen | Coverage |
|---|---|---|---|---|---|
| `discover` | Find subreddits for a topic | `discover_subs` | `discoverSubs()` | Welcome (Step 4 picker) + Collect modal | ✅ wired |
| `collect` | Fetch posts/comments with PRAW | `start_collect` + `cancel_collect` + `collect_status` | all 3 | Collect screen | ✅ wired |
| `gaps` | Extract painpoints/features/complaints/diy (LLM) | — (only via `enrich`) | — | — | ⚠️ **partial** — no UI to run *just* gaps without graph build |
| `temporal-gaps` | Classify gaps as chronic/emerging/fading | — | — | — | ❌ **CLI only** |
| `corpus` | Show raw collected posts for a topic | — | — | — | ❌ **CLI only** (Database tab is a generic SQL view, not corpus-shaped) |
| `findings` | List extracted findings (gaps) | `get_findings` | `getFindings()` | Topic → Evidence tab | ✅ wired |
| `report` | Basic markdown report | — | — | — | ❌ **CLI only** (only `report-pro` has a UI button) |
| `report-pro` | Pro HTML report | `export_report_pro` | `exportReportPro()` | Reports tab | ✅ wired |
| `chat` | Chat with the corpus (RAG / agent) | `start_chat` + `cancel_chat` + `chat_status` | all 3 | Topic → Chat tab | ✅ wired |
| `test-llm` | LLM connection test | `test_llm` | `testLlm()` | BYOK / Settings | ✅ wired |
| `list-models` | List available models for a provider | `list_ollama_models` | `listOllamaModels()` | BYOK | ⚠️ **partial** — Ollama only, no UI for OpenAI/Anthropic model lists |
| `solutions` (NEW) | Problem→Why→Science→Solution pipeline | (Task 10 pending) | (pending) | (Task 11/12 pending — Solutions tab) | 🟡 **planned** |

### Graph subgroup (`reddit-cli research graph <cmd>`)

| CLI command | Purpose | Tauri cmd | JS bridge | UI screen | Coverage |
|---|---|---|---|---|---|
| `build` | Build graph from collected posts | `build_graph` | `buildGraph()` | Collect screen + Topic → Map | ✅ wired |
| `enrich` | LLM-enrich graph (painpoints/features/etc) | `enrich_graph` | `enrichGraph()` | Collect screen + Topic | ✅ wired |
| `stats` | Graph stats (node/edge counts by kind) | — | — | — | ❌ **CLI only** |
| `neighbors` | Graph neighbor query (debug) | — | — | — | ❌ **CLI only** (Database tab can do this via SQL) |
| `export` | Export graph as JSON | — | — | — | ❌ **CLI only** |

---

## Part 3 — Coverage summary

| Status | Count | List |
|---|---|---|
| ✅ Fully wired | 12 | info, query (run_query), discover, collect, findings, report-pro, chat, test-llm, build, enrich, plus Tauri-only: ingest, byok, ollama mgmt |
| ⚠️ Partially wired | 3 | export (HTML/report-pro only), gaps (only via enrich), list-models (Ollama only) |
| 🟡 Planned this session | 1 | solutions (Tasks 10-12 pending) |
| ❌ CLI-only (no UI) | 8 | search, stream, temporal-gaps, corpus, report (basic), graph stats, graph neighbors, graph export |

---

## Part 4 — Recommended next work, ranked

Each ranked by **value × ease**. "Ease" assumes the Tauri-command + JS-bridge + UI-tab pattern that already exists for ~12 commands.

### Tier 1 — High value, low effort (do these next)

1. **🟡 Finish the Solutions tab** (Tasks 10-12 from the in-flight plan)
   - Already specced and partially planned. Closes the loop on the work we just shipped.
   - **Effort:** ~1 day. **Value:** unblocks the entire MVP feature.

2. **❌ `temporal-gaps` → "Trends" sub-tab on the topic screen**
   - Surfaces chronic/emerging/fading classification — the kind of analysis that justifies the "should I build this?" decision.
   - **UI shape:** New tab on `topic.js` between Map and Evidence. Three columns (Chronic / Emerging / Fading) with painpoint cards in each.
   - **Effort:** ~0.5 day (1 Tauri command, 1 tab module).

3. **❌ `graph stats` → header strip on the Map tab**
   - Show node/edge counts by kind ("12 painpoints, 8 products, 24 evidence_papers, 31 edges") above the existing Map visualization.
   - **Effort:** ~2 hours (1 Tauri command, inline render).

4. **⚠️ `gaps` (without graph build) → "Quick extract" button on the Topic screen**
   - Today users must run `enrich_graph` (which builds the graph) to get any LLM extraction. A faster preview path = "extract gaps from corpus, show them, decide if worth building the full graph."
   - **Effort:** ~0.5 day. **Value:** big — speeds up the inner loop on new topics.

### Tier 2 — High value, more effort

5. **❌ `stream` → "Watch this sub" panel**
   - Live-stream new posts from a sub the user cares about. Needs websocket-style event plumbing (already exists for collect:progress).
   - **UI shape:** New section on Home, or a "Watch" tab on the topic screen.
   - **Effort:** ~1-2 days (event streaming, persistent connection management).

6. **❌ `corpus` → "Raw posts" tab on the topic screen**
   - Today users see findings (extracted) but can't easily browse the raw corpus. The Database tab is generic SQL, not corpus-shaped.
   - **UI shape:** Paginated list of posts with filters (sub, score, date), one-click "open in Reddit."
   - **Effort:** ~1 day.

7. **❌ `graph export` → "Export graph as JSON" in the Reports/Actions tab**
   - For users who want to take the graph elsewhere (gephi, custom viz, AI agent input).
   - **Effort:** ~2 hours.

### Tier 3 — Power users / lower priority

8. **❌ `search` → "Search Reddit" panel**
   - Ad-hoc PRAW search, separate from the curated topic flow. Could live in Welcome or its own utility tab.
   - **Effort:** ~0.5 day.

9. **❌ `report` (basic) → Reports tab format toggle**
   - Add a "Basic markdown" option alongside "Pro HTML" in the Reports tab.
   - **Effort:** ~2 hours.

10. **❌ `graph neighbors` → "Explore" panel**
    - Click any node in the Map → see its neighbors in a side panel. Already partially implementable via SQL in Database tab, but a dedicated UI would be nicer.
    - **Effort:** ~0.5 day.

### Tier 4 — Nice-to-have polish

11. **⚠️ `list-models` → Multi-provider model picker** — extend BYOK from Ollama-only to also list Anthropic/OpenAI models. ~0.5 day.

12. **⚠️ `export` (CSV/JSON/TSV/Parquet) → Format dropdown on Reports tab** — today only HTML and pro-HTML are exposed. ~0.5 day.

---

## Part 5 — Proposed plan of attack

### Phase A (immediate, this week)
- ✅ Finish the in-flight research-loop MVP (Tasks 10-12 — Solutions tab)
- ➕ Add **temporal-gaps Trends tab** (Tier 1 #2)
- ➕ Add **graph stats header** on Map tab (Tier 1 #3)

### Phase B (next sprint)
- ➕ "Quick extract" gaps button (Tier 1 #4)
- ➕ "Raw posts" corpus tab (Tier 2 #6)
- ➕ Graph export button (Tier 2 #7)

### Phase C (when needed)
- Stream/watch panel
- Search panel
- Polish (model picker, multi-format export, basic-report toggle, neighbors UI)

Each Phase A/B item gets its own brainstorming → writing-plans → subagent-driven-development cycle. None of them require breaking changes to the backbone we just shipped.

---

## Part 6 — Open questions before promoting to specs

1. **Should the Solutions tab default to "show me the highest-confidence interventions only" or "show everything"?** (UX framing — user can answer when we get to Task 11.)
2. **Temporal gaps Trends tab — three columns or stacked accordion?** Three columns wins on desktop but breaks on narrow windows.
3. **Quick extract — overwrite or append?** If a user has already run enrich, what happens when they click Quick Extract? Probably "show what's there + offer rerun."
4. **Stream — opt-in per-sub or always-on for the active topic?** Battery + bandwidth cost matters.

These questions are best answered live as we approach each implementation, not now.
