# Gap Map — Architecture

> Last updated: 2026-05-16. Source of truth for how the three surfaces relate, how data flows, and where everything lives.

---

## The three surfaces

```
┌─────────────────────────────────────────────────────────────────┐
│  Gap Map.app  (Tauri 2 + vanilla JS)                            │
│  ┌──────────────┐   IPC / asset://   ┌───────────────────────┐  │
│  │  Frontend    │ ◄────────────────► │  Python Sidecar       │  │
│  │  (JS/HTML)   │                    │  (PyInstaller bundle) │  │
│  └──────────────┘                    └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
                        SQLite (reddit.db)
                                │
          ┌─────────────────────┴───────────────────┐
          │                                         │
┌──────────────────┐                    ┌───────────────────────┐
│  MCP Server      │                    │  CLI  (reddit-cli)    │
│  (FastMCP)       │                    │  (Typer, humans +     │
│  stdio / HTTP    │                    │   scripts)            │
│  90+ tools       │                    │                       │
└──────────────────┘                    └───────────────────────┘
```

All three surfaces share the same `core/` + `fetch/` + `research/` modules. The sidecar **is** the same Python package (`reddit_research`) invoked as a subprocess by Rust — no code duplication.

**Desktop app:** Tauri 2 shell in `app-tauri/`. Rust handles the IPC bridge (`src-tauri/src/commands.rs`). The frontend calls Rust commands; Rust spawns the Python sidecar or the dev `.venv`. The sidecar runs as a long-lived subprocess started at app launch.

**MCP server:** FastMCP (`src/reddit_research/mcp/server.py`). 90+ tools. Clients: Claude Code (stdio), Claude Desktop (stdio), Cursor (HTTP daemon on `127.0.0.1:8765`). Long-running tools must use the async job queue — see `docs/MCP_INFRA.md`.

**CLI:** Typer app, entry point `reddit-cli`. Every command supports `--json` for machine-readable output. Auth, fetch, analyze, research pipeline, and MCP management all live here.

---

## Data flow

```
External Sources           Python Fetch Layer          SQLite (reddit.db)
─────────────────          ──────────────────          ──────────────────
Reddit (PRAW)  ──────────► fetch/posts.py    ──────────► posts table
HN / Algolia   ──────────► sources/hackernews.py         topic_posts table
arXiv          ──────────► sources/arxiv.py              comments table
PubMed         ──────────► sources/pubmed.py    ◄──────► graph_nodes/edges
Semantic Scholar ────────► sources/semantic_scholar.py   paper_analyses
OpenAlex       ──────────► sources/openalex.py           paper_full_texts
Crossref       ──────────► sources/crossref.py           paper_sections
App/Play Store ──────────► sources/appstore.py           paper_chunks
GitHub Issues  ──────────► sources/github_issues.py      mcp_analyses
Google Trends  ──────────► sources/trends.py
Google News    ──────────► sources/gnews.py
Dev.to         ──────────► sources/devto.py
Stack Overflow ──────────► sources/stackoverflow.py
YouTube        ──────────► sources/youtube.py       Graph enrichment
Trustpilot     ──────────► sources/trustpilot.py  ──────────────────
Wikipedia      ──────────► sources/wikipedia.py    graph/
RSS feeds      ──────────► sources/rss.py          ├─ upsert_semantic()
Bluesky        ──────────► sources/bluesky.py      ├─ build_structural()
Lemmy/Mastodon ──────────► sources/lemmy.py        └─ relations.py
Discourse      ──────────► sources/discourse.py        (MiniLM ONNX)
AlternativeTo  ──────────► sources/alternativeto.py
ProductHunt    ──────────► sources/producthunt.py
NPM/PyPI stats ──────────► sources/npmstats.py

                                         │
                                         ▼
                              LLM Synthesis (analyze/)
                              ──────────────────────
                              research/insights.py
                              research/gaps.py
                              research/deliberate.py
                              research/audience.py
                              research/launch.py
                                         │
                                         ▼
                              topic_insights / mcp_analyses
                              ─────────────────────────────
                              Surfaces: Desktop Insights tab,
                              MCP reddit_synthesize_insights,
                              CLI research report
```

---

## The research pipeline

```
1. DISCOVER    reddit_discover_subs(topic)
               → LLM-canonicalized topic + keyword fan-out
               → ranked subreddits

2. COLLECT     reddit_research_collect(topic, aggressive=True)
               → Reddit: top-of-month + top-of-year per sub
                         parameterized searches (pain/features/complaints/diy)
               → External: 6-worker parallel fan-out across all non-Reddit sources
               → Historical: pullpush.io for pre-May-2025 data
               → All persisted to posts + topic_posts

3. CORPUS      reddit_get_corpus(topic)  →  ranked by engagement

4. GAPS        reddit_find_gaps(topic)   →  painpoints, feature_wishes,
                                            product_complaints, diy_workarounds
               reddit_synthesize_insights(topic)  →  Minto-structured report

5. GRAPH       reddit_graph_build(topic)           →  structural edges
               reddit_graph_upsert_semantic(...)   →  LLM-extracted nodes
               reddit_graph_build_relations(topic) →  semantic cross-edges

6. EXPORT      Desktop: Report tab (markdown), Map tab (D3 force-graph)
               MCP:    reddit_export_docx / reddit_export_pptx
               CLI:    reddit-cli research report
```

---

## The paper pipeline

```
1. SEARCH (parallel, 6 sources)
   reddit_research_papers(query, topic)
   arXiv · PubMed · OpenAlex · Semantic Scholar · Crossref · Scholar

2. FULLTEXT
   reddit_paper_fulltext(post_id)   → download OA PDF → pypdf → cache

3. SECTIONS
   reddit_paper_sections(post_id)   → named section parse
   reddit_paper_section_get(...)    → verbatim section text

4. CHUNKS + EMBED
   reddit_paper_chunk(post_id)      → section-aware 1500-char windows
   reddit_paper_chunk_topic(topic)  → bulk chunk all papers for a topic

5. ANALYZE
   reddit_analyze_paper(topic, post_id)  → LLM: summary/claims/methods/tier
   reddit_analyze_papers_bulk(topic)     → bulk run

6. SEARCH / LINK
   reddit_paper_chunk_search(query)      → hybrid vector+BM25 passage search
   reddit_paper_search_papers(query)     → rolled up to paper level
   reddit_research_link(topic)           → link findings to papers

One-shot:
   reddit_paper_research_pipeline(topic) → steps 1-5 in a single call
```

---

## SQLite schema (grouped by domain)

**Posts and social content**
`posts` · `comments` · `users` · `subreddits` · `fetches` · `streams` · `stream_hits`

**Research pipeline**
`topic_posts` · `topic_insights` · `topic_runs` · `topic_prefs` · `topic_canonicalizations` · `topic_aliases` · `topic_favorites` · `mcp_analyses` · `finding_feedback`

**Papers**
`paper_full_texts` · `paper_sections` · `paper_chunks` · `paper_references` · `paper_analyses` · `ingested_documents` · `document_elements`

**Graph**
`graph_nodes` · `graph_edges`

**Async jobs**
`mcp_jobs`

**Product Mode**
`products` · `product_competitors` · `product_signals` · `product_sweeps`

**Misc**
`saved_views` · `prompt_overrides` · `trend_series` · `hypothesis_tests` · `extraction_queue` · `extraction_daily_usage` · `perf_traces` · `audience_personas` · `launch_briefs`

Data dir: `~/Library/Application Support/com.shantanu.gapmap/reddit-myind/` (macOS). One SQLite file: `reddit.db`. WAL mode; thread-local connections via `core/db.py`.

---

## LLM provider chain

```python
# src/reddit_research/analyze/providers/base.py
resolve_provider(hint=None)
  1. hint arg  (explicit override from caller)
  2. DEFAULT_LLM_PROVIDER env var
  3. BYOK modal choices (persisted to ~/.config/reddit-myind/.env)
  4. First key found: ANTHROPIC → OPENAI → OPENROUTER → GROQ →
                       DEEPSEEK → MISTRAL → GEMINI → OLLAMA (local)
```

8 concrete providers: Anthropic, OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Google Gemini, Ollama. Each implements the `LLMProvider` ABC with `complete(prompt, system?, max_tokens?)`. Auto-resolution means no provider is hardcoded in any tool — switching is always one env var away.

---

## Key files map

```
src/reddit_research/
├── core/
│   ├── config.py       — env/toml resolution, data-dir, secret validation
│   ├── db.py           — SQLite schema, WAL, thread-local connections, upserts
│   ├── client.py       — PRAW Reddit singleton, lazy-init, rate-limit
│   └── exporters.py    — JSON / CSV / Parquet writers
├── fetch/
│   ├── posts.py        — fetch_posts: subreddit top/hot/new
│   ├── comments.py     — fetch_comments: full CommentForest
│   ├── users.py        — fetch_user: posts + comments
│   ├── search.py       — search_reddit: global + sub-scoped
│   ├── historical.py   — fetch_historical: pullpush.io archive
│   └── stream.py       — keyword monitor → stream_hits
├── sources/            — 20+ source modules (one file per source)
├── research/
│   ├── collect.py      — research_collect: orchestrate + parallel fan-out
│   ├── discover.py     — discover_subs: LLM canonicalize + sub ranking
│   ├── insights.py     — synthesize_insights: Minto + Ulwick + deliberation
│   ├── gaps.py         — find_gaps: LLM extraction of 4 gap types
│   ├── paper_fulltext.py  — OA PDF download + pypdf parse + cache
│   ├── paper_sections.py  — section parser (Abstract/Methods/Limitations/…)
│   ├── paper_chunks.py    — section-aware chunker + embed
│   ├── paper_analyze.py   — per-paper LLM analysis
│   ├── paper_pipeline.py  — outline/draft/experiment-plan generation
│   ├── audience.py        — ICP persona clustering from real authors
│   ├── launch.py          — go-to-market Launch Brief
│   ├── deliberate.py      — 5-persona deliberation engine
│   └── product*.py        — Product Mode: sweep, signals, dashboard
├── graph/
│   ├── __init__.py     — build_structural, upsert_semantic, neighbors, stats
│   ├── analyze.py      — PageRank, betweenness, Louvain communities
│   └── relations.py    — semantic cross-edges (MiniLM ONNX)
├── retrieval/
│   └── palace.py       — ChromaDB + ONNX MiniLM hybrid search (posts + papers)
├── analyze/
│   ├── providers/      — base ABC + 8 concrete LLM providers
│   ├── themes.py       — cluster posts into themes
│   ├── summarize.py    — thread summarizer
│   └── painpoints.py   — pain-point extractor
├── mcp/
│   ├── server.py       — FastMCP tool registry, 90+ tools, timeout/logging shim
│   ├── jobs.py         — async job queue (4-thread pool, SQLite-persisted)
│   ├── install.py      — mcp install/uninstall/status
│   └── logger.py       — structured event log
└── cli/
    └── main.py         — Typer app, all commands
```
