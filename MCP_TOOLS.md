# Gap Map — MCP Tools Reference

> 90+ FastMCP tools exposed by `gapmap mcp serve`. All tools are read/fetch/query only — no LLM calls inside the server (Claude Code is the LLM).
> Install: `uv run gapmap mcp install` (writes to `~/.claude.json`).

---

## Quick recipes

**1. Gap-finding for a topic (10 min)**
```
gapmap_discover_subs(topic="presentation skills")
gapmap_jobs_submit("gapmap_research_collect", {"topic": "presentation skills", "aggressive": true})
# poll until done, then:
gapmap_find_gaps(topic="presentation skills")
gapmap_synthesize_insights(topic="presentation skills")
```

**2. Literature review on a topic**
```
gapmap_paper_research_pipeline(topic="spaced repetition", query="spaced repetition learning", max_fulltext=5)
gapmap_papers_for_topic(topic="spaced repetition")
gapmap_paper_chunk_search(query="what limitations did papers identify", sections=["limitations"])
```

**3. Finding competitor pain points**
```
gapmap_fetch_appstore(topic="habit tracking apps")
gapmap_fetch_playstore(topic="habit tracking apps")
gapmap_fetch_trustpilot(query="Habitica")
gapmap_fetch_alternativeto(product="Habitica")
gapmap_find_gaps(topic="habit tracking apps")
```

**4. Monitoring a topic weekly**
```
gapmap_product_create(name="MyApp", topic="presentation skills")
gapmap_product_sweep(product_id="<id>")
gapmap_product_signals(product_id="<id>", since_days=7)
gapmap_product_digest(product_id="<id>")
```

**5. Exporting a research brief**
```
gapmap_synthesize_insights(topic="remote work tools")
gapmap_export_docx(topic="remote work tools", out_path="/tmp/brief.docx")
gapmap_export_pptx(topic="remote work tools", out_path="/tmp/deck.pptx")
gapmap_papers_export(topic="remote work tools", fmt="bibtex")
```

---

## 1. Core Reddit

### `gapmap_fetch_posts`
Fetch posts from a subreddit and persist to SQLite. Key args: `sub` (str), `sort` (hot|new|top|rising|controversial), `limit` (int, default 50), `time_filter` (hour|day|week|month|year|all). Returns: list of post dicts.

### `gapmap_fetch_comments`
Fetch the full comment tree for a Reddit post ID. Key args: `post_id` (str), `depth` (int|None). Returns: list of comment dicts.

### `gapmap_fetch_user`
Fetch a user's recent posts and/or comments. Key args: `name` (str), `kind` (posts|comments|both), `limit` (int). Returns: dict with posts and comments lists.

### `gapmap_search`
Search Reddit. Scope to a sub with `sub=`, otherwise searches all. Key args: `query` (str), `sub` (str|None), `sort`, `time_filter`, `limit`. Returns: list of post dicts.

### `gapmap_query_db`
Run a read-only SQL SELECT against the local SQLite store. Key args: `sql` (str). Returns: list of row dicts. Only SELECT/WITH/read-only PRAGMAs allowed. Use `gapmap_describe_schema` to check column names first.

### `gapmap_describe_schema`
Return live SQLite schema — every table, or one table. Key args: `table` (str|None). Returns: `{tables: {name: [columns]}}` or `{table, columns}`.

### `gapmap_sub_stats`
Summary stats for a sub (avg score, avg comments, top authors) from stored data. Key args: `sub` (str). Returns: dict with stats.

---

## 2. Historical

### `gapmap_fetch_historical`
Fetch historical posts/comments from before May 2025 via pullpush archive. Key args: `sub` (str), `kind` (submission|comment), `days` (int, 1–3650), `limit` (int). Returns: list of post/comment dicts.

---

## 3. Research Pipeline

### `gapmap_discover_subs`
Find the most relevant subreddits for any topic. First step before collect. Key args: `topic` (str), `limit` (int, default 10). Returns: list of sub dicts with relevance scores.

### `gapmap_research_collect`
Build a topic-scoped corpus: discover + top fetch + parameterized search + optional historical. Takes several minutes. Key args: `topic`, `subs` (override list), `limit_per_sub`, `aggressive` (bool — maxes all limits). Returns: `{topic, subs, posts_fetched, by_source, errors}`. **Use via `gapmap_jobs_submit` for large collects.**

### `gapmap_get_corpus`
Retrieve the collected corpus for a topic, ranked by engagement. Key args: `topic` (str), `limit` (int), `min_score` (int). Returns: list of post dicts.

### `gapmap_corpus_temporal_split`
Split corpus into pre-May-2025 and post-May-2025 buckets for temporal gap analysis. Key args: `topic`, `limit_per_bucket`, `min_score`. Returns: `{pre, post, pre_count, post_count}`.

### `gapmap_topic_stats`
Summary stats for a collected topic — size, sub coverage, date range. Key args: `topic` (str). Returns: `{topic, stats, top_subs}`.

### `gapmap_synthesize_insights`
Run the insight synthesis pipeline (Minto Pyramid + Ulwick scoring). LLM-backed. Key args: `topic`, `min_score`, `provider`, `deliberate` (bool). Returns: `{ok, topic, findings, competitors, executive_summary, ...}`. Use via `gapmap_jobs_submit` if it times out.

### `gapmap_find_gaps`
Extract painpoints / feature wishes / product complaints / DIY workarounds. LLM-backed. Key args: `topic`, `corpus_limit`, `min_score`, `provider`. Returns: `{painpoints, feature_wishes, product_complaints, diy_workarounds, corpus_size}`.

### `gapmap_mcp_analyses_list`
List recent LLM-driven intelligence entries. Key args: `topic` (str|None), `kind` (summary|synthesis|gaps|insights|paper_analysis|...), `limit`. Returns: list of analysis dicts.

---

## 4. Paper Research

### `gapmap_research_papers`
Multi-source paper search across 6 sources in parallel (arXiv, PubMed, OpenAlex, Semantic Scholar, Crossref, Scholar). Key args: `query`, `topic` (tag), `limit_per_source`, `sources` (list|None), `year_from`, `persist`. Returns: `{ok, total, by_source, sample, persisted}`.

### `gapmap_paper_research_pipeline`
Full pipeline: search → fulltext → analyze → store. One call does everything. Key args: `topic`, `query`, `limit_per_source`, `max_fulltext`, `year_from`, `provider`. Returns: `{ok, search_total, by_source, fulltext_ok, analyzed, analyses}`. 120s timeout — use `gapmap_jobs_submit` for large runs.

### `gapmap_papers_for_topic`
Return all analyzed papers for a topic, ranked by citation count. Fast read. Key args: `topic`, `limit`. Returns: `{ok, count, papers}`.

### `gapmap_paper_fulltext`
Fetch + cache full PDF text for a paper (OA PDF download + pypdf). Key args: `post_id`, `force`, `max_chars`. Returns: `{ok, status, text, char_count, source, cached}`.

### `gapmap_paper_fulltext_status`
Aggregate fulltext status counts by topic. Key args: `topic` (str|None). Returns: counts by status.

### `gapmap_paper_sections`
Parse cached full text into named sections (Abstract/Introduction/Methods/Results/Limitations/…). Key args: `post_id`, `force`. Returns: `{ok, sections: [{name, ord, char_count}]}`.

### `gapmap_paper_section_get`
Return verbatim text of one named section. Key args: `post_id`, `section` (abstract|methods|results|limitations|…). Returns: `{ok, text, char_count}`.

### `gapmap_paper_chunk`
Chunk paper full text into 1500-char section-aware windows, embed into Palace. Key args: `post_id`, `force`. Returns: `{ok, n_chunks, n_new, embedded}`.

### `gapmap_paper_chunk_topic`
Bulk-chunk every cached paper for a topic. Key args: `topic`, `force`, `limit`. Returns: summary dict.

### `gapmap_paper_chunk_search`
Hybrid semantic+BM25 search over paper chunks. Key args: `query`, `k`, `topic`, `sections` (filter to e.g. ['limitations']). Returns: `{ok, results: [{chunk_id, post_id, section, text, score}]}`.

### `gapmap_paper_search_papers`
Chunk retrieval rolled up to paper level — "which papers discuss X". Key args: `query`, `k`, `topic`, `sections`, `max_chunks_per_paper`. Returns: `{ok, results: [{post_id, title, best_score, chunks}]}`.

### `gapmap_analyze_paper`
LLM analysis of one paper: summary, claims, methods, evidence tier, applicability. Key args: `topic`, `post_id`, `force`. Returns: `{ok, summary, relevance, takeaway, tier, ...}`.

### `gapmap_analyze_papers_bulk`
Analyze every academic paper tagged to a topic without existing analysis. Key args: `topic`, `limit`, `force`. Returns: `{ok, analyzed, skipped, errored, total}`. **Use via `gapmap_jobs_submit`.**

### `gapmap_paper_analyses`
Return cached LLM analyses for all papers on a topic. Fast read. Key args: `topic`, `limit`. Returns: list of analysis dicts with paper metadata.

### `gapmap_papers_export`
Export papers as BibTeX / RIS / APA / Markdown. Key args: `topic`, `fmt` (bibtex|ris|apa|markdown), `limit`. Returns: `{ok, fmt, count, text}`.

### `gapmap_paper_citations`
Papers that cite `paper_id` via Semantic Scholar. Accepts S2 id, DOI, or arXiv id. Key args: `paper_id`, `limit`. Returns: list of paper rows.

### `gapmap_paper_references`
Reference list of `paper_id` — papers this one cites. Key args: `paper_id`, `limit`. Returns: list of paper rows.

### `gapmap_paper_extract_refs`
Extract references from local PDF cache into structured rows. Key args: `post_id`, `force`. Returns: `{ok, n_refs, by_status, extractor}`.

### `gapmap_paper_local_refs`
List references extracted from the local PDF — no network. Key args: `post_id`. Returns: `{ok, count, refs}`.

### `gapmap_paper_cited_by`
Papers in our corpus that cite this paper. Key args: `post_id`. Returns: `{ok, count, refs}`.

### `gapmap_paper_chunks_stats`
Palace stats for the paper_chunks collection. No args. Returns: `{total_chunks, unique_papers, by_section}`.

### `gapmap_fetch_arxiv`
arXiv preprints — free, keyless. Key args: `query`, `limit`. Returns: list of paper rows.

### `gapmap_fetch_pubmed`
PubMed health/medical research. Key args: `query`, `limit`. Returns: list of paper rows.

### `gapmap_fetch_openalex`
OpenAlex — 200M+ works, open scholarly data. Key args: `query`, `limit`, `year_from`. Returns: list of paper rows.

### `gapmap_fetch_semantic_scholar`
Semantic Scholar — 220M papers, citation graph, TLDR summaries. Key args: `query`, `limit`, `year_from`, `open_access_only`. Returns: list of paper rows.

### `gapmap_fetch_crossref`
Crossref — authoritative DOI metadata. Key args: `query`, `limit`, `year_from`, `filter_type`. Returns: list of paper rows.

### `gapmap_fetch_scholar`
Semantic Scholar free search (no key). Key args: `query`, `limit`, `year_from`. Returns: list of paper rows.

### `gapmap_fetch_by_doi`
One-shot Crossref lookup by DOI. Key args: `doi`. Returns: single paper row or null.

### `gapmap_oa_lookup`
Unpaywall — find a legal free OA PDF for any DOI (~40% hit rate). Key args: `doi`. Returns: `{is_oa, best_oa_url, oa_status, ...}`.

### `gapmap_paper_outline_generate`
Generate a structured research-paper outline from topic insights. Key args: `topic`, `provider`. Returns: outline dict.

### `gapmap_paper_draft_generate`
Generate a markdown research paper draft (IMRaD style by default). Key args: `topic`, `provider`, `style`. Returns: `{ok, markdown}`.

### `gapmap_paper_export_with_citations`
Export paper draft with citation appendix. Key args: `topic`, `provider`, `format`, `style`. Returns: `{ok, markdown}`.

---

## 5. Multi-Source

### `gapmap_fetch_hn`
Hacker News via Algolia API. Key args: `query`, `tags` (story|comment|ask_hn|show_hn), `limit`. Returns: list of post dicts.

### `gapmap_fetch_appstore`
Discover top iOS apps + pull reviews. Key args: `topic`, `country`, `apps`, `pages_per_app`. Returns: `{apps, reviews_count}`.

### `gapmap_fetch_playstore`
Discover top Play Store apps + pull reviews. Key args: `topic`, `apps`, `reviews_per_app`. Returns: `{apps, reviews_count}`.

### `gapmap_fetch_stackoverflow`
Stack Overflow — dev-tool pain signal. Key args: `query`, `tag`, `limit`. Returns: list of question dicts.

### `gapmap_fetch_trends`
Google Trends interest-over-time + rising queries. Key args: `topic`, `keywords`, `timeframe`, `geo`. Returns: trends dict.

### `gapmap_fetch_devto`
DEV.to articles. Key args: `query`, `tag`, `limit`. Returns: list of article dicts.

### `gapmap_fetch_github_repos`
Search GitHub repositories — OSS competitor scan. Key args: `query`, `limit`. Returns: list of repo dicts.

### `gapmap_fetch_github_issues`
GitHub issues ranked by 👍 reactions. Key args: `query`, `limit`, `state`. Returns: list of issue dicts.

### `gapmap_fetch_gnews`
Google News via RSS. Key args: `query`, `limit`, `country`. Returns: list of article dicts.

### `gapmap_fetch_producthunt`
Product Hunt recent launches. Key args: `query`, `limit`. Returns: list of product dicts.

### `gapmap_fetch_discourse`
Search a Discourse forum. Key args: `query`, `instance` (e.g. forum.obsidian.md), `limit`. Returns: list of post dicts.

### `gapmap_fetch_lemmy`
Lemmy federated communities. Key args: `query`, `instance`, `limit`. Returns: list of post dicts.

### `gapmap_fetch_mastodon`
Mastodon public tag timeline. Key args: `query`, `instance`, `limit`. Returns: list of post dicts.

### `gapmap_fetch_bluesky`
Bluesky public posts. Key args: `query`, `limit`. Returns: list of post dicts.

### `gapmap_fetch_rss`
Fetch any RSS/Atom feed. Key args: `feed_url`, `category`, `publication`, `limit`, `query`. Returns: list of entry dicts.

### `gapmap_fetch_youtube`
YouTube video metadata + top comments. Requires `YOUTUBE_API_KEY`. Key args: `query`, `videos`, `comments_per_video`. Returns: list of video + comment dicts.

### `gapmap_fetch_trustpilot`
Trustpilot reviews for a brand. Key args: `query`, `pages`, `limit`. Returns: list of review dicts.

### `gapmap_fetch_alternativeto`
AlternativeTo competitor products. Key args: `product`, `limit`. Returns: list of product dicts.

### `gapmap_fetch_wikipedia`
Wikipedia summary + pageview time series. Key args: `topic`, `pageview_days`. Returns: `{summary, pageviews}`.

### `gapmap_fetch_package_stats`
Download stats for npm or PyPI packages. Key args: `package`, `ecosystem` (npm|pypi), `range_`. Returns: stats dict.

---

## 6. Graph

### `gapmap_graph_build`
Build the structural knowledge graph for a topic from collected data. No LLM. Idempotent. Key args: `topic`. Returns: `{nodes, edges, duration_ms}`.

### `gapmap_graph_upsert_semantic`
Persist LLM-extracted gap signals as graph nodes + edges. Key args: `topic`, `painpoints`, `feature_wishes`, `product_complaints`, `diy_workarounds`. Returns: upsert counts.

### `gapmap_graph_build_relations`
Post-pass that emits relates_to/potentially_solves/could_address/co_evidenced edges using MiniLM ONNX. No LLM cost. Key args: `topic`. Returns: `{edges_added}`.

### `gapmap_graph_stats`
Node/edge counts per kind for a topic's graph. Key args: `topic`. Returns: stats dict.

### `gapmap_graph_top_nodes`
Rank nodes by total degree. Key args: `topic`, `kind` (filter), `limit`. Returns: list of node dicts.

### `gapmap_graph_neighbors`
Return neighbors of a node, filtered by edge kind and direction. Key args: `topic`, `node_id`, `edge_kinds`, `direction`, `limit`. Returns: list of neighbor dicts.

### `gapmap_graph_export_json`
Export full topic graph as D3 force-graph JSON. Key args: `topic`. Returns: `{nodes, links, meta}`.

### `gapmap_graph_pagerank`
Rank nodes by PageRank — surfaces hidden structural hubs. Key args: `topic`, `top_n`, `kind`. Returns: ranked node list.

### `reddit_graph_betweenness` / `gapmap_graph_bridges`
Betweenness centrality — structural bridges. Key args: `topic`, `top_n`. Returns: ranked node list.

### `gapmap_graph_communities`
Louvain community detection. Key args: `topic`, `max_communities`. Returns: list of community dicts.

### `gapmap_graph_structural_summary`
High-level metrics: nodes, edges, density, components. Key args: `topic`. Returns: summary dict.

---

## 7. Analysis & Intelligence

### `gapmap_deliberate`
5-persona deliberation engine over findings (Synthesizer, Skeptic, Quantifier, Risk Officer, Devil's Advocate). Key args: `topic`, `items` (list|None), `rounds`, `provider`. Returns: `{tiers: {confirmed, probable, minority, discarded}}`.

### `gapmap_audience_personas`
Cluster topic authors into ICP personas with LLM augmentation. Key args: `topic`, `llm`, `provider`, `min_posts_per_author`. Returns: persona clusters with sayings/wants/hates.

### `gapmap_audience_personas_get`
Read cached audience personas. Key args: `topic`. Returns: `{personas, count}`.

### `gapmap_launch_brief`
Full go-to-market Launch Brief: channels, RICE MVP features, pricing, positioning. Key args: `topic`, `llm`, `provider`. Returns: full brief dict.

### `gapmap_launch_brief_get`
Read cached Launch Brief. Key args: `topic`. Returns: brief dict.

### `gapmap_research_link`
Link each finding to top-K semantically similar academic papers. Key args: `topic`, `k`. Returns: link counts.

### `gapmap_research_links`
Get linked papers per finding. Key args: `topic`, `finding` (str|None). Returns: links or summary.

### `gapmap_search_all`
Cross-table search (posts, graph nodes, analyses, papers, hypotheses). Key args: `query`, `topic`, `aggressive` (adds semantic search). Returns: `{buckets, counts}`.

### `gapmap_global_competitors`
Unify competitor mentions across all topics by embedding similarity. Key args: `min_topics`, `threshold`. Returns: `{competitors: [{canonical_name, aliases, topics, mentions}]}`.

### `gapmap_feedback_record`
Flag a finding as wrong/off-topic. Fed back into next synthesis prompt. Key args: `topic`, `finding_title`, `finding_kind`, `verdict`, `note`. Returns: `{ok}`.

### `gapmap_feedback_list`
Read feedback records. Key args: `topic` (str|None). Returns: list of feedback dicts.

---

## 8. Jobs (async)

### `gapmap_jobs_submit`
Queue any registered tool for async execution. Returns in ~50ms. Key args: `tool_name` (str), `args` (dict). Returns: `{ok, job_id, state}`.

### `gapmap_jobs_get`
Inspect a single job. Key args: `job_id`. Returns: `{state, progress_pct, progress_msg, result}`. States: queued|running|done|failed|cancelled|interrupted.

### `gapmap_jobs_list`
List recent jobs newest-first. Key args: `state`, `tool_name`, `limit`. Returns: `{count, jobs}`.

### `gapmap_jobs_cancel`
Request cancellation of a queued or running job. Key args: `job_id`. Returns: `{ok, was_running}`.

---

## 9. Admin / Util

### `gapmap_diagnostics`
Single-call health probe: DB, Palace, LLM, corpus. Returns: `{ok, db, palace, llm, corpus, suggestions}`. Call this first when any tool fails.

### `gapmap_semantic_search`
Hybrid semantic+BM25 search over post corpus (Palace). Key args: `query`, `topic`, `source_type`, `k`, `rerank`. Returns: `{ok, results: [{id, score, text, metadata}]}`.

### `gapmap_related_posts`
Posts semantically nearest to a given post_id. Key args: `post_id`, `k`, `topic`. Returns: `{ok, results}`.

### `gapmap_palace_status`
Is the local semantic index (ChromaDB + ONNX MiniLM) ready? No args. Returns: `{installed, ready, count}`.

### `gapmap_palace_warmup`
Download + cache the ONNX embedding model (~80 MB, one-time). No args. Returns: final progress event.

### `gapmap_palace_reindex`
Re-embed every post row into Palace. Idempotent. No args. Returns: stats. **Use via `gapmap_jobs_submit`.**

### `gapmap_palace_repair`
Heal a corrupt Palace (HNSW segment writer errors). Key args: `also_reindex` (bool). Returns: `{ok, healed, backup_path}`.

### `gapmap_export_docx`
Export a stakeholder-ready DOCX research brief. Key args: `topic`, `out_path`, `extra_topics`, `max_painpoints`. Returns: `{ok, path, painpoint_count}`. Requires `python-docx`.

### `gapmap_export_pptx`
Export a 12-15 slide PPTX pitch deck. Key args: `topic`, `out_path`, `max_painpoints`. Returns: `{ok, path, slide_count}`. Requires `python-pptx`.

### `gapmap_ingest_csv`
Bulk-import posts from a CSV file into a topic. Key args: `path`, `topic`, `source_type`. Returns: `{ok, inserted, tagged, skipped}`.

### `gapmap_clean_corpus`
Relevance-gate cleanup — drop low-cosine topic_posts rows. Key args: `topic`, `threshold`, `apply` (bool, default dry-run), `min_keep`. Returns: `{scored, kept, dropped}`.

### `gapmap_find_existing_topic`
Pre-check before collect — does a semantically identical topic exist? Key args: `user_input`. Returns: `{match}` or `{match: null}`.

### `gapmap_prompt_list` / `gapmap_prompt_get` / `gapmap_prompt_set`
Manage extractor prompt overrides. Key args vary. Allows per-topic prompt tuning.

### `gapmap_saved_view_create` / `gapmap_saved_view_list`
Create and list saved filter views. Key args: `scope`, `name`, `filter_json`, `pinned`.

### `gapmap_product_create` / `gapmap_product_list` / `gapmap_product_sweep` / `gapmap_product_signals` / `gapmap_product_dashboard` / `gapmap_product_digest`
Product Mode: register app + competitors, run daily sweeps, read signals and digest.

### `gapmap_topic_soft_delete` / `gapmap_topic_restore` / `gapmap_topic_trash_list` / `gapmap_topic_trash_purge`
Soft-delete and recover topics. Recoverable for 7 days.
