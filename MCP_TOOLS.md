# OpenReply — MCP Tools Reference

> 120 FastMCP tools exposed by `openreply mcp serve`. All tools are read/fetch/query/persist only — no LLM calls inside the server (Claude Code is the LLM).
> Install: `uv run openreply mcp install` (writes to `~/.claude.json`).

---

## Quick recipes

**1. Collect a topic corpus (10 min)**
```
openreply_discover_subs(topic="presentation skills")
openreply_jobs_submit("openreply_collect", {"topic": "presentation skills", "aggressive": true})
# poll until done, then:
openreply_get_corpus(topic="presentation skills")
openreply_topic_stats(topic="presentation skills")
```

**2. Pull competitor / review signal**
```
openreply_fetch_appstore(topic="habit tracking apps")
openreply_fetch_playstore(topic="habit tracking apps")
openreply_fetch_trustpilot(query="Habitica")
openreply_fetch_alternativeto(product="Habitica")
```

**3. Build and explore the knowledge graph**
```
openreply_graph_build(topic="remote work tools")
openreply_graph_build_relations(topic="remote work tools")
openreply_graph_top_nodes(topic="remote work tools")
openreply_graph_communities(topic="remote work tools")
```

**4. Semantic search over a corpus**
```
openreply_palace_warmup()            # one-time model download
openreply_palace_reindex()           # via openreply_jobs_submit for big corpora
openreply_semantic_search(query="onboarding friction", topic="remote work tools")
openreply_related_posts(post_id="<id>")
```

**5. Export a brief**
```
openreply_export_docx(topic="remote work tools", out_path="/tmp/brief.docx")
openreply_export_pptx(topic="remote work tools", out_path="/tmp/deck.pptx")
openreply_export_pdf_from_markdown(markdown_path="/tmp/brief.md", out_path="/tmp/brief.pdf")
```

---

## 1. Core Reddit

### `openreply_fetch_posts`
Fetch posts from a subreddit and persist to SQLite. Key args: `sub` (str), `sort` (hot|new|top|rising|controversial), `limit` (int, default 50), `time_filter` (hour|day|week|month|year|all). Returns: list of post dicts.

### `openreply_fetch_comments`
Fetch the full comment tree for a Reddit post ID. Key args: `post_id` (str), `depth` (int|None). Returns: list of comment dicts.

### `openreply_fetch_user`
Fetch a user's recent posts and/or comments. Key args: `name` (str), `kind` (posts|comments|both), `limit` (int). Returns: dict with posts and comments lists.

### `openreply_search`
Search Reddit. Scope to a sub with `sub=`, otherwise searches all. Key args: `query` (str), `sub` (str|None), `sort`, `time_filter`, `limit`. Returns: list of post dicts.

### `openreply_fetch_reddit_free`
Reddit search via the free cookie/proxy path (RSS fallback). Full score/comments where available, no API key. Key args: `query`, `sub`, `limit`. Returns: list of post dicts.

### `openreply_fetch_historical`
Fetch historical posts/comments from before May 2025 via pullpush archive. Key args: `sub` (str), `kind` (submission|comment), `days` (int, 1–3650), `limit` (int). Returns: list of post/comment dicts.

### `openreply_sub_stats`
Summary stats for a sub (avg score, avg comments, top authors) from stored data. Key args: `sub` (str). Returns: dict with stats.

---

## 2. Corpus & topic collection

### `openreply_discover_subs`
Find the most relevant subreddits for any topic or app domain. First step before collect. Key args: `topic` (str), `limit` (int, default 10). Returns: list of sub dicts with relevance scores.

### `openreply_collect`
Build a topic-scoped corpus: discover + top fetch + parameterized search + optional historical. Takes several minutes. Key args: `topic`, `subs` (override list), `limit_per_sub`, `aggressive` (bool — maxes all limits). Returns: `{topic, subs, posts_fetched, by_source, errors}`. **Use via `openreply_jobs_submit` for large collects.**

### `openreply_get_corpus`
Retrieve the collected corpus for a topic, ranked by engagement. Key args: `topic` (str), `limit` (int), `min_score` (int). Returns: list of post dicts.

### `openreply_corpus_temporal_split`
Split corpus into pre-May-2025 and post-May-2025 buckets for temporal analysis. Key args: `topic`, `limit_per_bucket`, `min_score`. Returns: `{pre, post, pre_count, post_count}`.

### `openreply_topic_stats`
Summary stats for a collected topic — size, sub coverage, date range. Key args: `topic` (str). Returns: `{topic, stats, top_subs}`.

### `openreply_collect_quality_check`
Report how many currently-tagged posts would fail the relevance gate before applying a cleanup. Key args: `topic`, `threshold`. Returns: `{scored, would_drop, would_keep}`.

### `openreply_clean_corpus`
Relevance-gate cleanup — drop low-cosine topic_posts rows. Key args: `topic`, `threshold`, `apply` (bool, default dry-run), `min_keep`. Returns: `{scored, kept, dropped}`.

### `openreply_find_existing_topic`
Pre-check before collect — does a semantically identical topic already exist? Key args: `user_input`. Returns: `{match}` or `{match: null}`.

### `openreply_merge_duplicate_topics`
Merge LLM-canonicalization-caused duplicate topic rows. Key args: `topic`. Returns: merge summary.

### `openreply_import_gummysearch`
Import a GummySearch export (JSON or CSV of saved subreddits/audiences) into a topic. Key args: `path`, `topic`. Returns: import counts.

### `openreply_ingest_csv`
Bulk-import posts from a CSV with canonical headers into a topic. Key args: `path`, `topic`, `source_type`. Returns: `{ok, inserted, tagged, skipped}`.

---

## 3. Source adapters (fetch_* / read_*)

Each adapter fetches from one external source and persists rows into the corpus. Most take `query`/`topic` + `limit`; key-gated ones note their env var (or connect via the Reach Connections UI / `openreply creds`).

### Community & social
- `openreply_fetch_hn` — Hacker News via Algolia. `tags`: story|comment|ask_hn|show_hn.
- `openreply_fetch_devto` — DEV.to articles.
- `openreply_fetch_lemmy` — Lemmy federated communities. `instance`.
- `openreply_fetch_mastodon` — Mastodon public tag timeline. `instance`.
- `openreply_fetch_bluesky` — Bluesky (AT Protocol) public posts. Keyless.
- `openreply_fetch_discourse` — Search a Discourse forum. `instance` = forum domain.
- `openreply_fetch_producthunt` — Product Hunt recent launches.
- `openreply_fetch_digg` — Digg posts. Needs the `digg-pp-cli` binary on PATH.
- `openreply_fetch_v2ex` — V2EX (Chinese dev/tech community) hot topics. Keyless.
- `openreply_fetch_steam` — Steam reviews / community signal. Keyless.

### Reviews & competitors
- `openreply_fetch_appstore` — Discover top iOS apps + pull reviews. `country`, `apps`, `pages_per_app`.
- `openreply_fetch_playstore` — Discover top Play Store apps + pull reviews. `apps`, `reviews_per_app`.
- `openreply_fetch_trustpilot` — Trustpilot reviews for a brand. `pages`, `limit`.
- `openreply_fetch_alternativeto` — AlternativeTo competitor products. `product`, `limit`.

### Code & packages
- `openreply_fetch_github_repos` — Search GitHub repositories (OSS competitor scan).
- `openreply_fetch_github_issues` — GitHub issues ranked by 👍 reactions. `state`.
- `openreply_fetch_stackoverflow` — Stack Overflow questions. `tag`.
- `openreply_fetch_package_stats` — Download stats for a package. `ecosystem`: npm|pypi.

### News, web & search
- `openreply_fetch_rss` — Any RSS/Atom feed. `feed_url`, `category`, `publication`.
- `openreply_fetch_gnews` — Google News via RSS. `country`.
- `openreply_fetch_gdelt` — GDELT global news/events, date-range-capable. Keyless.
- `openreply_fetch_duckduckgo` — DuckDuckGo web search. Keyless (best-effort).
- `openreply_fetch_tavily` — Tavily LLM-grade web search. Needs `TAVILY_API_KEY`.
- `openreply_fetch_exa` — Exa neural web search. Needs `EXA_API_KEY` or connected key.
- `openreply_fetch_wikipedia` — Wikipedia summary + pageview time series. `pageview_days`.
- `openreply_read_web` — Read any URL → clean markdown via Jina Reader (one row). Keyless.
- `openreply_read_linkedin` — Read a public LinkedIn URL (profile/company/post) via Jina.
- `openreply_read_xiaoyuzhou` — Read a Xiaoyuzhou (小宇宙) podcast episode URL → title + show notes.

### Video & key-gated social
- `openreply_fetch_youtube` — Video metadata + top comments. Needs `YOUTUBE_API_KEY`. `videos`, `comments_per_video`.
- `openreply_fetch_tiktok` — TikTok videos/captions. Needs `SCRAPECREATORS_API_KEY`.
- `openreply_fetch_instagram` — Instagram posts/captions. Needs `SCRAPECREATORS_API_KEY`.
- `openreply_fetch_threads` — Threads posts. Needs `SCRAPECREATORS_API_KEY`.
- `openreply_fetch_pinterest` — Pinterest pins. Needs `SCRAPECREATORS_API_KEY`.
- `openreply_fetch_x` — X / Twitter posts. Needs `AUTH_TOKEN`+`CT0` cookies | `XAI_API_KEY` | `XQUIK_API_KEY`.
- `openreply_fetch_truthsocial` — Truth Social posts. Needs `TRUTHSOCIAL_TOKEN`.
- `openreply_fetch_bilibili` — Bilibili search. Keyless (optional `BILIBILI_PROXY`).
- `openreply_fetch_xueqiu` — Xueqiu (雪球) status search. Cookie-warm, keyless.
- `openreply_fetch_xiaohongshu` — Xiaohongshu (小红书 / RED) note search. Needs a connected cookie (Reach Connections).

### Academic
- `openreply_fetch_arxiv` — arXiv preprints. Keyless.
- `openreply_fetch_pubmed` — PubMed health/medical research.
- `openreply_fetch_openalex` — OpenAlex (200M+ works). `year_from`.
- `openreply_fetch_semantic_scholar` — Semantic Scholar (220M papers, citation graph). `year_from`, `open_access_only`.
- `openreply_fetch_scholar` — Semantic Scholar free search (no key).
- `openreply_fetch_crossref` — Crossref DOI metadata. `year_from`, `filter_type`.
- `openreply_fetch_by_doi` — One-shot Crossref lookup by DOI.
- `openreply_fetch_dblp` — DBLP computer-science bibliography. Keyless.
- `openreply_fetch_europepmc` — Europe PMC biomedical literature. Keyless.
- `openreply_oa_lookup` — Unpaywall: find a legal free OA PDF for a DOI.

### Economic / data
- `openreply_fetch_worldbank` — World Bank macro indicators (GDP, CPI…). Keyless.
- `openreply_fetch_fred` — FRED US macro series. Needs `FRED_API_KEY`.
- `openreply_fetch_bis` — BIS central-bank policy rates. Keyless.
- `openreply_fetch_yfinance` — Yahoo Finance quotes. Keyless.
- `openreply_fetch_openmeteo` — Open-Meteo weather (current + 1940+ archive). Keyless.
- `openreply_fetch_acled` — ACLED conflict/protest events. Needs `ACLED_EMAIL`+`ACLED_PASSWORD`.
- `openreply_fetch_polymarket` — Polymarket prediction-market questions + odds. Keyless.
- `openreply_fetch_trends` — Google Trends interest-over-time + rising queries.

---

## 4. Graph

### `openreply_graph_build`
Build the structural knowledge graph for a topic from collected data. No LLM. Idempotent. Key args: `topic`. Returns: `{nodes, edges, duration_ms}`.

### `openreply_graph_upsert_semantic`
Persist LLM-extracted signals as graph nodes + edges. Key args: `topic`, plus signal lists. Returns: upsert counts.

### `openreply_graph_build_relations`
Post-pass that emits relates_to/potentially_solves/could_address/co_evidenced edges using MiniLM ONNX. No LLM cost. Key args: `topic`. Returns: `{edges_added}`.

### `openreply_graph_stats`
Node/edge counts per kind for a topic's graph. Key args: `topic`. Returns: stats dict.

### `openreply_graph_top_nodes`
Rank nodes by total degree (hubs). Pass `kind` to filter. Key args: `topic`, `kind`, `limit`. Returns: list of node dicts.

### `openreply_graph_neighbors`
Return neighbors of a node, filtered by edge kind and direction. Key args: `topic`, `node_id`, `edge_kinds`, `direction`, `limit`. Returns: list of neighbor dicts.

### `openreply_graph_export_json`
Export full topic graph as D3 force-graph JSON. Key args: `topic`. Returns: `{nodes, links, meta}`.

### `openreply_graph_pagerank`
Rank nodes by PageRank — surfaces hidden structural hubs. Key args: `topic`, `top_n`, `kind`. Returns: ranked node list.

### `openreply_graph_bridges`
Betweenness centrality — structural bridges connecting otherwise-separate clusters. Key args: `topic`, `top_n`. Returns: ranked node list.

### `openreply_graph_communities`
Louvain community detection. Key args: `topic`, `max_communities`. Returns: list of community dicts.

### `openreply_graph_structural_summary`
High-level metrics: nodes, edges, density, components. Key args: `topic`. Returns: summary dict.

### `openreply_graph_invariants`
Run structural invariant checks on a topic's graph (consistency / sanity). Key args: `topic`. Returns: `{ok, checks}`.

---

## 5. Palace (semantic index)

### `openreply_palace_status`
Is the local semantic index (ChromaDB + ONNX MiniLM-L6-v2) ready? No args. Returns: `{installed, ready, count}`.

### `openreply_palace_warmup`
Download + cache the ONNX embedding model (~80 MB, one-time). No args. Returns: final progress event.

### `openreply_palace_reindex`
Re-embed every post row into Palace. Idempotent (~2K posts/min). No args. Returns: stats. **Use via `openreply_jobs_submit`.**

### `openreply_palace_repair`
Heal a corrupt Palace (HNSW segment writer / "failed to apply logs" errors). Key args: `also_reindex` (bool). Returns: `{ok, healed, backup_path}`.

### `openreply_semantic_search`
Hybrid semantic + BM25 search over the post corpus. Key args: `query`, `topic`, `source_type`, `k`, `rerank`. Returns: `{ok, results: [{id, score, text, metadata}]}`.

### `openreply_related_posts`
Posts semantically nearest to a given post_id. Key args: `post_id`, `k`, `topic`. Returns: `{ok, results}`.

### `openreply_search_all`
Cross-table search across posts, graph nodes, analyses, papers and more. Key args: `query`, `topic`, `aggressive` (adds semantic search). Returns: `{buckets, counts}`.

---

## 6. Reach Connections (credentials)

### `openreply_creds_list`
Status of every cookie/key-gated source for the Reach Connections UI. No args. Returns: per-source connection status.

### `openreply_creds_verify`
Re-test a connected source's credential by issuing a live fetch. Key args: `source`. Returns: `{ok, source, working}`.

---

## 7. Feedback

### `openreply_feedback_record`
Flag a finding as wrong / off-topic / spam / ok. Fed back into the next extraction prompt. Key args: `topic`, `finding_title`, `finding_kind`, `verdict`, `note`. Returns: `{ok}`.

### `openreply_feedback_list`
Read back recorded feedback for one topic or globally. Key args: `topic` (str|None). Returns: list of feedback dicts.

---

## 8. Topic management (trash & recovery)

### `openreply_topic_soft_delete`
Soft-delete a topic. Hidden from list_topics; recoverable. Key args: `topic`. Returns: `{ok}`.

### `openreply_topic_restore`
Restore a soft-deleted topic (clears `topic_prefs.deleted_at`). Key args: `topic`. Returns: `{ok}`.

### `openreply_topic_trash_list`
List soft-deleted topics with age + post count + expires_in_days. No args. Returns: list of trash entries.

### `openreply_topic_trash_purge`
Hard-delete soft-deleted topics older than N days (default 7). Key args: `days`. Returns: `{purged}`.

---

## 9. Jobs (async)

### `openreply_jobs_submit`
Queue any registered tool for async execution. Returns in ~50ms. Key args: `tool_name` (str), `args` (dict). Returns: `{ok, job_id, state}`.

### `openreply_jobs_get`
Inspect a single job. Key args: `job_id`. Returns: `{state, progress_pct, progress_msg, result}`. States: queued|running|done|failed|cancelled|interrupted.

### `openreply_jobs_list`
List recent jobs newest-first. Key args: `state`, `tool_name`, `limit`. Returns: `{count, jobs}`.

### `openreply_jobs_cancel`
Request cancellation of a queued or running job. Key args: `job_id`. Returns: `{ok, was_running}`.

---

## 10. Links

### `openreply_link`
Link each finding to top-K semantically similar academic papers. Key args: `topic`, `k`. Returns: link counts.

### `openreply_links`
Get linked papers. `finding=None` → per-finding count summary; otherwise links for that finding. Key args: `topic`, `finding` (str|None). Returns: links or summary.

---

## 11. Export

### `openreply_export_docx`
Export a stakeholder-ready DOCX brief for `topic`. Key args: `topic`, `out_path`, `extra_topics`, `max_painpoints`. Returns: `{ok, path}`. Requires `python-docx`.

### `openreply_export_pptx`
Export a 12-15 slide PPTX deck for `topic`. Key args: `topic`, `out_path`. Returns: `{ok, path, slide_count}`. Requires `python-pptx`.

### `openreply_export_pdf_from_markdown`
Convert a markdown brief to a brand-styled PDF. Key args: `markdown_path`, `out_path`. Returns: `{ok, path}`.

### `openreply_export_docx_from_markdown`
Convert an existing markdown brief to DOCX with full fidelity. Key args: `markdown_path`, `out_path`. Returns: `{ok, path}`.

---

## 12. Prompts & saved views

### `openreply_prompt_list` / `openreply_prompt_get` / `openreply_prompt_set`
Manage extractor prompt overrides. `prompt_list` lists every key + whether it has an override; `prompt_get` returns the effective text; `prompt_set` sets an override (empty string clears).

### `openreply_saved_view_create` / `openreply_saved_view_list`
Create and list saved filter views. Key args: `scope` (`global` | `topic:<slug>`), `name`, `filter_json`, `pinned`.

---

## 13. Admin / util

### `openreply_diagnostics`
Single-call health probe across every subsystem the other tools rely on (DB, Palace, LLM, corpus). Returns: `{ok, db, palace, llm, corpus, suggestions}`. Call this first when any tool fails.

### `openreply_query_db`
Run a read-only SQL SELECT against the local SQLite store. Key args: `sql` (str). Returns: list of row dicts. Only SELECT/WITH/read-only PRAGMAs allowed. Use `openreply_describe_schema` to check column names first.

### `openreply_describe_schema`
Return live SQLite schema — every table, or one table. Key args: `table` (str|None). Returns: `{tables: {name: [columns]}}` or `{table, columns}`.

### `openreply_flow_status`
Per-project flow progress (gather → read → synthesize → write). Key args: `project`/`topic`. Returns: stage progress dict.
