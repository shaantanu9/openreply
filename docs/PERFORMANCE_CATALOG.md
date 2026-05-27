# Gap Map — performance + functions catalog

> **Purpose:** single source of truth for every user-facing function in
> the app, its current expected latency, its known bottlenecks, and the
> automated test that should exist for it. Use this to (1) decide where
> to optimize next, (2) catch regressions, (3) onboard new agents.

**Generated:** 2026-05-27 · **App version:** v0.1.0 · **HEAD:** `b6ef7e1`

---

## 1 · Function inventory by surface

### Surface A — CLI (`gapmap …` from terminal)

Run from a terminal. The Tauri app uses the same CLI under the hood for
many operations, but spawns it as a sidecar daemon (JSON-line protocol,
warm interpreter) rather than one-shot.

| Group | Command | What it does | Read/Write |
|---|---|---|---|
| `info` | `gapmap info --json` | Returns mode, data dir, table counts, key state | R |
| `query` | `gapmap query SQL --json` | Direct SQL against `gapmap.db` | R/W |
| `topics` | (under `research`) | List, create, delete, rename topics | R/W |
| `research collect` | Pull posts from Reddit/HN/arXiv/GitHub/AppStore | W (heavy) | |
| `research graph build` | `build_structural(topic)` — see §3.A | W (heavy) | |
| `research graph enrich` | LLM extracts painpoints/features/workarounds | W (LLM-bound) | |
| `research graph relate` | Dense relations via embeddings + co-evidence | W | |
| `research search-all` | Hybrid keyword+semantic search across corpus | R | |
| `research search-findings` | Search graph findings (painpoint/workaround) | R | |
| `research saturation` | Information-saturation curve over time | R | |
| `research coverage-gaps` | Spots of low-density in the corpus | R | |
| `research top-opportunities` | Cross-topic leaderboard | R | |
| `research diff` | Topic delta vs. last snapshot | R | |
| `research solutions` | Problem→Why→Science→Solution (LLM) | W (LLM) | |
| `research empathy-build` | Says/Thinks/Does/Feels map (LLM) | W (LLM) | |
| `research kano-categorize` | Tag interventions M/S/C/W (LLM) | W (LLM) | |
| `research palace-stats` | ChromaDB doc count + per-topic breakdown | R |  |
| `research palace-model-status` | ONNX MiniLM presence + bytes | R |  |
| `research reindex-palace` | Re-embed all posts into palace | W (heavy) | |
| `mcp serve` | Stdio MCP server (147 tools) | R/W | |
| `mcp install <client>` | Write `mcpServers` entry to client config | W | |
| `mcp status <client>` | Per-client connection check | R | |
| `fetch posts/comments/...` | Low-level Reddit fetcher (rate-limited) | W | |
| `persona <subcmd>` | Persona create / chat / memories / share | R/W | |
| `analyze <subcmd>` | Run a single extractor or scorer | R/W | |
| `export <subcmd>` | DOCX / PDF / PPTX / brief generation | W | |
| `whisper / ytdlp` | Local audio transcription pipeline | W | |

### Surface B — Tauri app (the desktop GUI)

The user-facing app. Most actions are 1-to-1 with a CLI command (above)
but go through the Rust sidecar daemon for warmth + transaction sharing.

| Tab/screen | Key functions | Backend call |
|---|---|---|
| **Dashboard / Home** | Topic grid, momentum, recent activity | `list_topics`, `recent_activity`, `overview_stats` |
| **Topic page** | Per-topic tabs (Map, Insights, Audience, …) | various per-tab |
| **Map (graph viz)** | Render the gap graph | `build_graph` → `enrich_graph` → `export_graph_json` |
| **Insights** | LLM-synthesized painpoints + workarounds | `synthesize_insights` |
| **Audience** | Persona clustering with citation quotes | `audience_personas_build` |
| **Search** (left sidebar) | Cross-topic semantic + keyword | `research search-all --aggressive` |
| **Chat** | Question-answer over the corpus | `start_chat` stream |
| **Sources / Posts** | Listing with filters | `run_query` SQL |
| **Papers** | arXiv-discovered papers per topic | `papers_for_topic` |
| **Personas** | Single-purpose research agents | `persona list/create/chat/...` |
| **Ingest** | CSV / PDF / VTT files | `ingest_file` / `ingest_video` |
| **Settings** | BYOK keys, MCP wiring, CLI symlink | `byok_status`, `mcp_status`, `cli_symlink_status` + others |
| **BYOK modal** | LLM provider key entry + test | `byok_set`, `list_provider_models`, `research test-llm` |
| **Reports** | DOCX / PDF / PPTX export | `export_brief`, `export_deck` |

### Surface C — MCP server (`mcp serve --transport stdio`)

147 tools exposed to Claude Code / Cursor / Claude Desktop / Cline /
Windsurf. Full naming convention: `gapmap_<verb>` or `gapmap_<noun>_<verb>`.

| Category | Sample tools | What they expose |
|---|---|---|
| Search | `gapmap_search`, `gapmap_semantic_search`, `gapmap_search_all` | Hybrid + dense retrieval |
| Topic ops | `gapmap_list_topics`, `gapmap_topic_stats`, `gapmap_find_existing_topic` | Read/list topics |
| Collect | `gapmap_start_collect`, `gapmap_active_collects` | Long-running collect jobs |
| Graph | `gapmap_build_graph`, `gapmap_enrich_graph`, `gapmap_relate_graph` | Build phases |
| Palace | `gapmap_palace_status`, `gapmap_palace_warmup`, `gapmap_palace_reindex` | Embedding store ops |
| Query | `gapmap_query_db` | Raw SQL — primary integration point |
| Personas | `gapmap_persona_list`, `gapmap_persona_chat` | Persona system |
| Papers | `gapmap_papers_for_topic`, `gapmap_paper_outline` | Research papers |
| Feedback | `gapmap_feedback_list`, `gapmap_feedback_record` | Beta feedback |
| Findings | `gapmap_get_findings` (when added), `gapmap_solutions_data_bundle` | Structured extracts |

---

## 2 · Latency budgets — what should each op take?

Cold = first run after app launch / Gatekeeper verification.
Warm = sidecar daemon already alive, all caches primed.

| Operation | Cold (acceptable) | Warm (target) | Hard fail if > |
|---|---|---|---|
| **App boot to dashboard** | 3 s | 1 s | 8 s |
| Tab switch (cached screen) | — | < 50 ms | 500 ms |
| Tab switch (uncached, simple SQL) | 500 ms | 100 ms | 3 s |
| **Settings open** | 2-3 s (first card load) | < 50 ms (SWR cached) | 10 s |
| `info`, `query 'SELECT 1'` | 0.7 s | 0.2 s | 3 s |
| `list_topics` | 1 s | 50 ms | 3 s |
| `palace_status` | 1 s | 30 ms (SQL fastpath) | 3 s |
| **Search (keyword only)** | 1 s | 200 ms | 5 s |
| **Search (semantic, palace warm)** | 2 s | 500 ms | 8 s |
| **Search (semantic, palace cold)** | 8 s (chromadb import) | n/a | 30 s |
| **MCP `initialize` handshake** | 6 s (FastMCP import) | 3 s | 60 s |
| **MCP `tools/list`** | 50 ms | 20 ms | 500 ms |
| **MCP `tools/call` (simple SQL)** | 500 ms | 100 ms | 5 s |
| `build_structural` (200 posts) | 1 s | 600 ms | 5 s |
| `build_structural` (3K posts) | 5 s | 4 s | 30 s |
| `build_structural` (7K posts) | 30 s | 25 s | 90 s |
| **Collect (200 posts, all sources)** | 60 s | n/a | 5 min |
| **Enrich (200 posts, Ollama llama3.2)** | 2-6 min | n/a | 15 min |
| **Enrich (200 posts, Claude Haiku)** | 30 s | n/a | 3 min |
| **Chat first token** | 3 s | 1 s | 30 s |
| **Whisper transcribe (5 min YT)** | 60 s | n/a | 10 min |

---

## 3 · Current bottlenecks (known, sorted by impact)

### 3.A · `build_structural` (graph build)
**Cost:** ~3-4 ms per post (after the transaction-wrap fix in `b6ef7e1`),
linear with post count. For 7,800 posts → ~27 s.

**Where the time goes:**
1. `_upsert_node` per author / sub / source / era / post — N writes
2. `_upsert_edge` per containment + authored + era — ~2N writes
3. Comment loop, reply edges — variable but cheap
4. Final dense-relations density pass (optional, best-effort)

**Next wins to investigate:**
- Batch upserts with `executemany` (10K-row groups) — could cut another 50%
- Skip the `SELECT ts FROM graph_nodes` per-node ts-preservation when the node doesn't exist yet (most cases on first build)
- Move `_upsert_edge` to a single big `INSERT OR REPLACE` with rowset
- For repeat builds, only diff against existing nodes (currently always re-upserts)

### 3.B · LLM enrich pipeline
**Cost:** 4 sequential extractors × per-extractor LLM call (~30 s cloud,
~30-90 s local Ollama). Total: 2-6 min on local, 30-120 s on cloud.

**Where the time goes:**
- Sequential by design (not parallel) — each call is independent though
- Token count: ~5K tokens per extractor on a 200-post topic
- Ollama: model load on first call (~30 s for llama3.2:3b on CPU)

**Next wins:**
- The `--parallel` mode option already exists in `enrich:source-picker` (cloud-only safe)
- Pre-warm Ollama by issuing a 1-token request on app boot
- Skip extractors that have run recently and have no new posts to process

### 3.C · Palace (ChromaDB / memplace)
**Cost:** ChromaDB import alone is ~1-2 s. First semantic query is +500 ms
to warm the collection. Subsequent queries are 30-100 ms.

**Where the time goes (audit done 2026-05-26):**
- `chromadb.PersistentClient` import + init
- ONNX MiniLM model load (~80 MB unzipped, ~200 ms decode)
- Per-query: embed query text + cosine scan + (if rerank=True) BM25 blend

**Indexing state:** chromadb uses an internal SQLite + HNSW index — we
already read the fast-path SQLite directly for counts (~5 ms vs 50-200 ms
via chroma_api).

**Next wins (see `docs/ALGORITHM_ROADMAP.md`):**
- Tier-1B: HippoRAG / Personalized PageRank over existing graph — no new model
- Tier-1A: bge-reranker-v2-m3 cross-encoder rerank (~300 MB model)
- Tier-1C: Anthropic Contextual Retrieval — LLM-prefix each chunk before embed
- BGE-M3 embedder upgrade (Tier-2)

### 3.D · LLM provider configuration / testing
**User-reported problem:** "when we enter the LLM key the test should
work but it is not working".

**Where to investigate:**
- BYOK flow: `byok_set` → writes to `~/Library/Application Support/.../gapmap/.env`
- Test button calls: `research test-llm --provider X` (CLI) → currently?
- The 8-file checklist in `tauri-python-sidecar-app` SKILL Phase 10.5

**Sub-issues to confirm:**
- Does `research test-llm` actually exist? (need to check)
- Is the BYOK `.env` file read at sidecar spawn time?
- Are all 8 providers (anthropic / openai / openrouter / groq / deepseek / mistral / google / nvidia) wired through all 8 layers?

### 3.E · YouTube ingestion + search
**User-reported problem:** "yt video and search in yt should work
properly and data should shown and scrape properly".

**What we have:**
- `ingest_video` command — yt-dlp + Whisper transcription pipeline
- `whisper_catalogue` — model list
- `ytdlp_version` — version check

**What to verify:**
- Does YT URL → transcript → ingestion work end-to-end?
- Is YT search (across YT, not corpus) actually exposed? Need to check
- Are search hits indexed into the corpus for downstream extraction?

### 3.F · DB indexes — current state
**Already indexed (good coverage):**
- All `topic_*` tables on `topic`
- `posts` on `author`, `created_utc`, `source_type`, `sub`
- `graph_nodes` on `(topic, kind)` and `evidence_post_id`
- `graph_edges` on `topic`
- `comments`, `paper_*`, `persona_*`, `mcp_*` — all covered

**Potential additions to investigate:**
- `topic_posts` — currently only `post_id` and `topic` separately, no composite `(topic, post_id)` — could speed up the join in `build_structural`'s SELECT
- Full-text search index on `posts.title + selftext` — currently keyword search does a LIKE scan
- `graph_edges` composite `(topic, kind, src)` for relation traversal

---

## 4 · Performance test plan (what we should automate)

Goal: every commit can run a perf smoke that gates against the latency
budgets in §2.

### 4.1 · Test harness sketch

```
scripts/perf-test.py
├── fixture_topic_small  — fresh 200-post topic
├── fixture_topic_medium — 1K-post topic
├── fixture_topic_large  — 5K-post topic
│
├── benchmark_cli()
│   • info, query, list-topics, palace-stats, palace-model-status
│   • each: cold + warm, measure wall time, assert < budget
│
├── benchmark_sidecar_daemon()
│   • Spawn one daemon, fire 10 sequential calls, measure median + p99
│   • assert median < warm budget, p99 < 2x warm budget
│
├── benchmark_mcp()
│   • Spawn `mcp serve`, complete initialize + tools/list
│   • Issue 5 tool calls of varying complexity
│   • assert initialize < 60s, list < 500ms, calls < per-op budget
│
├── benchmark_graph_build()
│   • build_structural on each fixture topic
│   • assert post-rate ≥ 100 posts/sec on warm Mac
│
├── benchmark_search()
│   • Keyword and semantic search at k=10
│   • Palace cold and palace warm
│   • assert under budgets in §2
│
├── benchmark_enrich()
│   • Mock LLM (returns canned JSON) to measure pipeline overhead
│   • Real Ollama (if reachable) to measure end-to-end
│
└── benchmark_app_ui()
    • Tauri Playwright/WebdriverIO harness
    • Boot → dashboard, switch tabs, open Settings → time each
```

### 4.2 · CI integration

- Run on every push to `multi-source` and `main`
- Compare against `docs/PERFORMANCE_BASELINE.json` (committed)
- Fail if any metric regresses > 20%
- Auto-update baseline on green builds to `main`

### 4.3 · Local dev usage

```bash
# Run all benches against the live local DB
python scripts/perf-test.py

# Quick targeted run
python scripts/perf-test.py --bench graph_build,search

# Update baseline (after intentional perf change)
python scripts/perf-test.py --update-baseline
```

### 4.4 · What to measure for EACH user-facing function

For every function in §1 we want these metrics:

| Metric | Description |
|---|---|
| **Latency (warm)** | Median wall time over 5 runs after warmup |
| **Latency (cold)** | First run after fresh interpreter spawn |
| **p99 latency** | Worst case over 100 runs |
| **Throughput** | Ops/sec for stream-like ops (collect, enrich) |
| **Memory peak** | RSS delta during the op |
| **DB writes** | Count of INSERT/UPDATE rows |
| **Disk reads** | Bytes read from the DB file |
| **Sidecar spawns** | Should be 1 for any single GUI action |
| **LLM tokens used** | Input + output for LLM-bound ops |

### 4.5 · Reporting

After each test run, output:
- `docs/perf-runs/<timestamp>.md` — full table
- `docs/perf-runs/latest.md` — symlink to most recent
- `docs/PERFORMANCE_BASELINE.json` — current accepted baseline

---

## 5 · Open performance issues to investigate

Sorted by user-perceived impact:

| # | Issue | User report | Investigation |
|---|---|---|---|
| 1 | LLM "Test" button does nothing | "when we enter the llm key the test should work but it is not working" | Find what the Test button calls; verify `research test-llm` exists; check 8-file checklist |
| 2 | YT video ingestion + search broken | "yt video and search in yt should work properly and data should shown and scrape properly" | Trace `ingest_video` end-to-end; check if YT search exists at all |
| 3 | Build still slow on large topics | "Building structural graph… still taking way longer" | Already +25% from `b6ef7e1`; next is executemany batches |
| 4 | Palace cold-start tax | n/a (latent) | Pre-warm on app boot; preload chromadb in sidecar daemon |
| 5 | Index gaps on `topic_posts(topic, post_id)` | n/a (latent) | Add composite index; benchmark before/after |
| 6 | Full-text search on `posts.title + selftext` | n/a (latent) | Add FTS5 virtual table; switch keyword search to it |
| 7 | Search results limit (currently k=50) | n/a (latent) | Test if k=20 gives same perceived quality at lower cost |
| 8 | Enrich parallel mode locked to cloud | "open source ... should work properly" | Verify the `__parallel` option in source-picker actually parallelizes Ollama; if not, document why (Ollama serializes) |

---

## 6 · How this file gets used

1. **Before optimizing anything** — read §3 to see if it's already known
2. **After fixing a perf bug** — update §3 with the new "next win" and re-measure budgets in §2
3. **Adding a new user-facing function** — add a row to §1 and a budget to §2
4. **Investigating a user complaint** — add to §5; mark resolved + cite commit when fixed
5. **Quarterly review** — re-baseline §2 against current real-world data

---

## 7 · Companion documents

- `docs/ALGORITHM_ROADMAP.md` — Tier-1/2/3 retrieval upgrades (additive, doesn't remove anything)
- `docs/SYSTEM_VERIFICATION_2026-05-26.md` — last full smoke-test results
- `docs/BETA.md` — distribution & install guide
- `docs/manual-todo/` — manual ops checklists (DevID signing, Resend SMTP, etc.)
- `~/.claude/skills/tauri-python-sidecar-app/SKILL.md` — battle-tested patterns (Phase 1-20.5)
