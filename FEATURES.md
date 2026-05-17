# Gap Map (reddit-myind) — Features & Flows

> **Updated:** 2026-05-17 by Claude · **Build state:** pre-launch · branch `multi-source` @ `5f0650e` · desktop sidecar binary stale (Apr 21 — needs rebuild)
> Source of truth for every user-facing feature, its flow, code location, completeness, and known gaps. Update after every feature change. Re-run `codegraph sync` before editing to keep file:line citations fresh.

Gap Map is a **Tauri 2 desktop app + FastMCP server + Python CLI** for multi-source product/market research. The same Python core (`src/reddit_research/`) powers all three surfaces: the MCP server exposes 147 tools to Claude Code, the Typer CLI exposes the equivalent command tree, and the Tauri desktop app drives the CLI as a sidecar.

## Legend
- ✅ **Complete** — works end-to-end, no known half-done parts
- 🟡 **Partial** — works but has half-done gaps documented in "Known gaps"
- 🚧 **In progress** — actively being built, not shippable
- ❌ **Missing** — table-stakes or planned but not started
- 🔒 **Gated** — exists but locked behind a flag / optional extra

## Quick status summary

| Category | Total | ✅ | 🟡 | 🚧 | ❌ |
|---|---|---|---|---|---|
| 1. Data fetching — source adapters | 33 | 33 | 0 | 0 | 0 |
| 2. Discovery & collection | 6 | 6 | 0 | 0 | 0 |
| 3. Corpus management | 11 | 11 | 0 | 0 | 0 |
| 4. Synthesis & gap finding | 7 | 7 | 0 | 0 | 0 |
| 5. Knowledge graph | 11 | 11 | 0 | 0 | 0 |
| 6. Semantic search & memory palace | 7 | 7 | 0 | 0 | 0 |
| 7. Persona agents | 9 | 9 | 0 | 0 | 0 |
| 8. Paper research pipeline | 22 | 22 | 0 | 0 | 0 |
| 9. Product tracking | 9 | 9 | 0 | 0 | 0 |
| 10. Audience & competitors | 3 | 3 | 0 | 0 | 0 |
| 11. Export & documentation | 8 | 8 | 0 | 0 | 0 |
| 12. MCP server & jobs queue | 6 | 6 | 0 | 0 | 0 |
| 13. CLI | 1 | 1 | 0 | 0 | 0 |
| 14. Advanced analysis modules | 18 | 4 | 14 | 0 | 0 |
| 15. Tauri desktop app | 24 | 13 | 11 | 0 | 0 |
| 16. Customization & feedback | 7 | 7 | 0 | 0 | 0 |
| **Total** | **182** | **157** | **25** | **0** | **0** |

The MCP surface (categories 1–13, 16) is feature-complete. The 🟡 entries are concentrated in (14) advanced analysis modules that have a working Python core but are CLI/Tauri-only with no MCP tool, and (15) Tauri screens whose data pipeline works but whose visualisation is unfinished.

---

## 1. Data fetching — source adapters ✅

**Status:** ✅ · 33 source adapters, all complete
**Entry points:** `reddit_fetch_*` MCP tools · `reddit-cli fetch *` · Tauri *Collect* screen source selector
**User flow:** caller supplies a keyword/query (+ optional source-specific params) → adapter calls the upstream API → results normalise to the canonical `posts` schema → rows persist to SQLite tagged with a `source_type`.
**Data:** every adapter writes to the `posts` table with a distinct `source_type`; Reddit comment fetches also write `comments`.
**Implementation:** each adapter is one module under `src/reddit_research/sources/`; the MCP tool wrapper lives in `src/reddit_research/mcp/server.py`. All adapters share `sources/_http.py:44` (`polite_get` — rate-limited, retrying HTTP).

### 1.1 Social & community
| Feature | MCP tool `server.py` | Adapter | `source_type` |
|---|---|---|---|
| Reddit posts | `reddit_fetch_posts:170` | `sources/reddit.py` | `reddit` |
| Reddit comments | `reddit_fetch_comments:188` | `sources/reddit.py` | (writes `comments`) |
| Reddit user profile | `reddit_fetch_user:194` | `sources/reddit.py` | `reddit` |
| Reddit historical archive | `reddit_fetch_historical:590` | `sources/reddit.py` (pullpush) | `reddit` |
| Hacker News | `reddit_fetch_hn:732` | `sources/hackernews.py:48` | `hn` |
| Bluesky | `reddit_fetch_bluesky:1602` | `sources/bluesky.py:57` | `bluesky` |
| Lemmy | `reddit_fetch_lemmy:1586` | `sources/lemmy.py:50` | `lemmy` |
| Mastodon | `reddit_fetch_mastodon:1594` | `sources/mastodon.py:50` | `mastodon` |
| Discourse forum | `reddit_fetch_discourse:1677` | `sources/discourse.py:51` | `discourse` |

### 1.2 Academic & research
| Feature | MCP tool `server.py` | Adapter | `source_type` |
|---|---|---|---|
| arXiv preprints | `reddit_fetch_arxiv:811` | `sources/arxiv.py:58` | `arxiv` |
| PubMed | `reddit_fetch_pubmed:827` | `sources/pubmed.py:79` | `pubmed` |
| Google Scholar | `reddit_fetch_scholar:777` | `sources/scholar.py:49` | `scholar` |
| Semantic Scholar | `reddit_fetch_semantic_scholar:842` | `sources/semantic_scholar.py:84` | `semantic_scholar` |
| OpenAlex | `reddit_fetch_openalex:819` | `sources/openalex.py:65` | `openalex` |
| Crossref | `reddit_fetch_crossref:883` | `sources/crossref.py:103` | `crossref` |
| Direct DOI lookup | `reddit_fetch_by_doi:902` | `sources/crossref.py:143` | `crossref` |

### 1.3 Developer tools & code
| Feature | MCP tool `server.py` | Adapter | `source_type` |
|---|---|---|---|
| GitHub repos | `reddit_fetch_github_repos:1685` | `sources/github_trending.py:55` | `github` |
| GitHub issues | `reddit_fetch_github_issues:1693` | `sources/github_issues.py:56` | `github_issues` |
| Stack Overflow | `reddit_fetch_stackoverflow:785` | `sources/stackoverflow.py:49` | `stackoverflow` |
| Dev.to | `reddit_fetch_devto:1578` | `sources/devto.py:41` | `devto` |
| Package stats (npm/PyPI) | `reddit_fetch_package_stats:1712` | `sources/npmstats.py:18` · `sources/pypistats.py:12` | `npm` / `pypi` |

### 1.4 App stores & consumer reviews
| Feature | MCP tool `server.py` | Adapter | `source_type` |
|---|---|---|---|
| Apple App Store reviews | `reddit_fetch_appstore:740` | `sources/appstore.py:269` | `appstore` |
| Google Play reviews | `reddit_fetch_playstore:760` | `sources/playstore.py:76` | `playstore` |
| Trustpilot reviews | `reddit_fetch_trustpilot:1642` | `sources/trustpilot.py:180` | `trustpilot` |
| Product Hunt | `reddit_fetch_producthunt:1634` | `sources/producthunt.py:53` | `producthunt` |
| AlternativeTo | `reddit_fetch_alternativeto:1650` | `sources/alternativeto.py:48` | `alternativeto` |

### 1.5 News, trends & reference
| Feature | MCP tool `server.py` | Adapter | `source_type` |
|---|---|---|---|
| Google News | `reddit_fetch_gnews:1570` | `sources/gnews.py:25` | `gnews` |
| Google Trends | `reddit_fetch_trends:795` | `sources/trends.py:40` | `trends` |
| Wikipedia (summary + pageviews) | `reddit_fetch_wikipedia:1701` | `sources/wikipedia.py:14` | `wikipedia` |
| YouTube (videos + comments) | `reddit_fetch_youtube:1658` | `sources/youtube.py:462` | `youtube` |
| RSS / Atom feeds | `reddit_fetch_rss:1609` | `sources/rss.py:115` · catalog `sources/rss_catalog.py:161` | `rss` |

### 1.6 Local file ingest
| Feature | Entry point | Implementation | `source_type` |
|---|---|---|---|
| CSV/JSON/TXT/MD/PDF/VTT/SRT ingest | `reddit_ingest_csv:2749` · CLI `ingest file` | `sources/local_file.py:543` · `research/ingest.py:87` | user-supplied |
| Folder walker (recursive ingest) | CLI `ingest folder` | `cli/main.py` (`ingest_app`) · `sources/local_file.py:568` | user-supplied |

**Known gaps:** none. Video ingest (`sources/video.py:125`) is gated behind the `video` pyproject extra (yt-dlp / faster-whisper) — see category 15.

---

## 2. Discovery & collection ✅

### Discover subreddits ✅
**Entry:** `reddit_discover_subs` · CLI `research collect` (internally)
**Flow:** topic keyword → Reddit search + heuristic ranking → relevant subreddit list.
**Implementation:** `server.py:458` · `research/discover.py:280` (`discover_subs`)
**Data:** in-memory result; consumed by the collect orchestrator.

### Research collect — master orchestrator ✅
**Entry:** `reddit_research_collect` · CLI `research collect --topic X` · Tauri *Collect* screen
**Flow:** discover subs → multi-source fan-out fetch → top-of-month/year ranking → parameterised search expansion → optional historical archive → all rows tagged to the topic.
**Implementation:** `server.py:496` · `research/collect.py:227` (`collect`) · adapters dispatched via `sources/collect_adapter.py:49`
**Data:** `posts`, `topic_posts` junction, `topic_prefs` (schedule/settings).

### Aggressive collect preset ✅
**Entry:** `reddit_research_collect` with `aggressive=true`
**Flow:** raises every per-source limit, enables all source categories, pulls ~3 years of history via pullpush.
**Implementation:** `server.py:496` · `research/collect.py:227`
**Data:** `posts`, `topic_posts`.

### Collect job queue ✅
**Entry:** `reddit_jobs_submit("reddit_research_collect", {...})` → `reddit_jobs_get(job_id)`
**Flow:** long-running collect runs in a background worker; caller polls for state.
**Implementation:** `server.py:2435` (submit) · `research/jobs.py`
**Data:** `jobs` table. See category 12.

### Fetch historical archive ✅
**Entry:** `reddit_fetch_historical`
**Implementation:** `server.py:590` · `sources/reddit.py` (pullpush archive)
**Data:** `posts` (`source_type='reddit'`).

### Idea scan (multi-topic sweep) 🟡 → see category 14
A broader "scan many adjacent topics at once" engine exists (`research/idea_scan.py:254`) but is CLI/Tauri-only; documented under Advanced analysis modules.

**Known gaps:** none for the four core MCP-backed flows.

---

## 3. Corpus management ✅

| Feature | Status | MCP tool `server.py` | Implementation | Data |
|---|---|---|---|---|
| Get corpus (engagement-ranked) | ✅ | `reddit_get_corpus:575` | `research/corpus_format.py:107` | reads `posts` + `topic_posts` |
| Topic stats | ✅ | `reddit_topic_stats:612` | `core/db.py` | reads `posts`/`topic_posts` |
| Corpus temporal split | ✅ | `reddit_corpus_temporal_split:552` | `research/collect.py:697` (`corpus_temporal_split`) | reads `posts` |
| Clean corpus (relevance gate) | ✅ | `reddit_clean_corpus:2547` | `research/relevance.py:125` (`filter_topic_posts`) · `research/saturation.py:25` | deletes `posts` rows |
| Collect quality check | ✅ | `reddit_collect_quality_check:2582` | `research/quality_gate.py:64` (`passes_quality`) | diagnostic only |
| Find existing topic (dedup pre-check) | ✅ | `reddit_find_existing_topic:2563` | `research/topic_resolver.py:129` (`find_existing_topic`) | reads palace embeddings |
| Merge duplicate topics | ✅ | `reddit_merge_duplicate_topics:2573` | `research/topic_resolver.py:207` (`merge_duplicate_topics`) | `topic`, `topic_posts` |
| Topic soft delete | ✅ | `reddit_topic_soft_delete:2516` | `research/trash.py:33` (`soft_delete`) | `topic_prefs.deleted_at` |
| Topic restore | ✅ | `reddit_topic_restore:2526` | `research/trash.py:68` (`restore`) | `topic_prefs.deleted_at` |
| Topic trash list | ✅ | `reddit_topic_trash_list:2533` | `research/trash.py:81` (`list_trash`) | reads `topic_prefs` |
| Topic trash purge (>7d) | ✅ | `reddit_topic_trash_purge:2540` | `research/trash.py:112` (`purge_older_than`) | hard-deletes topic rows |

**Known gaps:** none.

---

## 4. Synthesis & gap finding ✅

### Synthesize insights ✅
**Entry:** `reddit_synthesize_insights` · CLI `research synthesize --topic X` · Tauri *Insights* screen
**Flow:** LLM reads the engagement-ranked corpus → extracts pain-points, feature wishes, complaints, DIY workarounds → 4-part report. As of 2026-05-17 the prompt also receives the **top-20 knowledge-graph nodes** for the topic so findings cross-check against known topology.
**Implementation:** `server.py:1340` · `research/insights.py:321` (`synthesize_insights`) · chunked variant `research/insights.py:856` · graph-context block `research/insights.py` (added 2026-05-17)
**Data:** `topic_insights`, `mcp_analyses` (`kind='synthesis'`).

### Deliberate — 5-persona council ✅
**Entry:** `reddit_deliberate` · CLI `research deliberate --topic X`
**Flow:** five LLM personas (Synthesizer, Skeptic, Quantifier, Risk Officer, Devil's Advocate) debate each finding over multiple rounds → findings tier into confirmed / probable / minority / discarded. As of 2026-05-17 the engine also reads **persona-agent conclusions** for the topic, formats them as "PERSONA LENSES" in the vote prompt, and counts ≥2 endorsing conclusions as +1 confirm-equivalent (`persona_grounded` flag on the result).
**Implementation:** `server.py:2074` · `research/deliberate.py:475` (`deliberate`) · persona-conclusion integration `research/deliberate.py` (added 2026-05-17)
**Data:** `mcp_analyses` (transcripts + tiers).

### Find gaps ✅
**Entry:** `reddit_find_gaps`
**Flow:** structured extraction of gap signals (painpoints / feature wishes / workarounds / complaints) from the corpus into graph nodes.
**Implementation:** `server.py:1466` · `research/gaps.py:276` (`find_gaps`) · gap discovery engine `research/gap_discovery.py:213`
**Data:** `graph_nodes` (kinds: painpoint, feature, workaround, complaint).

### Research link (papers → findings) ✅
**Entry:** `reddit_research_link`
**Implementation:** `server.py:2888` · `research/research_linker.py:66` (`link_findings_for_topic`)
**Data:** `finding_research_links`.

### Research links — read ✅
**Entry:** `reddit_research_links`
**Implementation:** `server.py:2896` · `research/research_linker.py:165` (`get_links_for_finding`) / `:185` (`get_links_summary`)
**Data:** reads `finding_research_links`.

### MCP analyses list ✅
**Entry:** `reddit_mcp_analyses_list`
**Implementation:** `server.py:1509`
**Data:** reads `mcp_analyses`.

### Search all (cross-table) ✅
**Entry:** `reddit_search_all`
**Flow:** SQL + semantic search across posts, graph nodes, analyses, papers, hypotheses; optional LLM query expansion.
**Implementation:** `server.py:2906` · `research/search_all.py:248` (`search_all`)
**Data:** writes a summary row to `mcp_analyses` (`kind='search'`).

**Known gaps:** none. Deliberation results are not yet rendered in the Tauri *Insights* screen — tracked under category 15.

---

## 5. Knowledge graph ✅

| Feature | Status | MCP tool `server.py` | Implementation `research/graph.py` | Data |
|---|---|---|---|---|
| Build graph | ✅ | `reddit_graph_build:649` | derives topic/sub/post/comment/user nodes + edges | `graph_nodes`, `graph_edges` |
| Graph stats | ✅ | `reddit_graph_stats:660` | per-kind node/edge counts | reads `graph_*` |
| Top nodes (hubs) | ✅ | `reddit_graph_top_nodes:666` | degree ranking, kind filter | reads `graph_*` |
| Neighbors (expansion) | ✅ | `reddit_graph_neighbors:672` | neighbour lookup, edge-kind filter | reads `graph_*` |
| Upsert semantic nodes | ✅ | `reddit_graph_upsert_semantic:690` | inserts LLM gap signals | `graph_nodes`, `graph_edges` |
| Export graph JSON (D3) | ✅ | `reddit_graph_export_json:719` | D3 force-graph format | JSON output |
| PageRank | ✅ | `reddit_graph_pagerank:1939` | structural importance ranking | computed |
| Communities (Louvain) | ✅ | `reddit_graph_communities:1950` | community detection | computed |
| Betweenness bridges | ✅ | `reddit_graph_bridges:1958` | structural bridge nodes | computed |
| Structural summary | ✅ | `reddit_graph_structural_summary:1966` | density / components metrics | diagnostic |
| Build relations (semantic edges) | ✅ | `reddit_graph_build_relations:2872` | ChromaDB MiniLM post-pass — `relates_to` / `potentially_solves` / `could_address` / `co_evidenced` edges, no LLM cost | `graph_edges` |

**Implementation:** all graph tools wrap `src/reddit_research/research/graph.py`. The dense-relations post-pass is the `dense-graph-relations` skill, battle-tested 2026-04-21.
**Known gaps:** none on the MCP/CLI side. The Tauri *Graph* screen has only basic node viewing — faceted/advanced filtering is unfinished (category 15).

---

## 6. Semantic search & memory palace ✅

The "memory palace" is a local ChromaDB index with an ONNX MiniLM embedding model (~80 MB cached). Fully offline after warmup. See the `mempalace-chromadb-onnx` skill.

| Feature | Status | MCP tool `server.py` | Implementation | Data |
|---|---|---|---|---|
| Palace status | ✅ | `reddit_palace_status:1981` | `research/palace.py` | diagnostic |
| Palace warmup (download model) | ✅ | `reddit_palace_warmup:1996` | `research/palace.py` | `~/.cache/mempalace/` |
| Palace reindex | ✅ | `reddit_palace_reindex:2410` | `research/palace.py` | Mempalace collection |
| Palace repair (heal HNSW) | ✅ | `reddit_palace_repair:2377` | `research/palace.py` | moves corrupt index aside |
| Semantic search (posts) | ✅ | `reddit_semantic_search:2017` | `research/search_all.py` | vector search |
| Related posts (nearest-neighbour) | ✅ | `reddit_related_posts:2062` | `research/search_all.py` | vector search |
| Schema inspector | ✅ | `reddit_describe_schema:365` · `reddit_query_db:220` | `core/db.py` | read-only SQL |

**Known gaps:** none.

---

## 7. Persona agents ✅

Persona agents are single-lens learning agents: each reads collected posts through a fixed `lens`, distils lessons into `persona_memories`, clusters them into high-confidence `persona_conclusions`, and answers questions citing only its own memories. Personas can teach each other and learn from YouTube. Built over phases through 2026-05-12; the full MCP + CLI surface landed 2026-05-17 (`5f0650e`).

The MCP tools live in a dedicated **sub-server** — `src/reddit_research/mcp/tools/persona_tools.py` — mounted into the main server via `mcp.mount()` (`server.py:3441`). The CLI command group is `src/reddit_research/cli/persona_cmds.py`, registered into `cli/main.py:4795`.

### Persona CRUD ✅
**Entry:** `reddit_persona_create` / `_list` / `_get` / `_update` / `_delete` · CLI `persona create|list|update|delete`
**Implementation:** `persona_tools.py:61/85/95/105/132` · `persona/store.py:21/60/77/92/105` (`persona_stats:116`)
**Data:** `personas` table.

### Persona ingest ✅
**Entry:** `reddit_persona_ingest` · CLI `persona ingest`
**Flow:** reads candidate posts for a topic (or all), filters by the persona's lens, LLM-distils lessons, idempotently skips already-processed posts.
**Implementation:** `persona_tools.py:164` · `persona/ingest.py:251` (`ingest_persona`) · fan-out `ingest_all_personas:393`
**Data:** `persona_memories`.

### Persona memories — read ✅
**Entry:** `reddit_persona_memories` · CLI `persona memories`
**Implementation:** `persona_tools.py:145` · `persona/store.py:146` (`list_memories`)
**Data:** reads `persona_memories`.

### Persona chat ✅
**Entry:** `reddit_persona_chat` · CLI `persona chat`
**Flow:** retrieves the persona's top-k memories for the question, answers from those only, cites `(M#)` memory ids — says so when its memories don't cover the question.
**Implementation:** `persona_tools.py:195` · `persona/chat.py:184` (`chat_persona`)
**Data:** reads `persona_memories`.

### Persona conclusions ✅
**Entry:** `reddit_persona_conclusions_build` / `_get` · CLI `persona conclude|conclusions`
**Flow:** clusters memories by semantic similarity, one LLM call per cluster → a generalised belief + confidence score.
**Implementation:** `persona_tools.py:218/245` · `persona/conclude.py:143` (`synthesize_conclusions`) / `:282` (`list_conclusions`)
**Data:** `persona_conclusions`. Consumed by the deliberation engine (category 4).

### Persona memory graph ✅
**Entry:** `reddit_persona_graph` / `reddit_persona_graph_backfill` · CLI `persona graph|backfill`
**Flow:** memory→memory similarity graph built from lesson embeddings; backfill re-embeds every memory and rebuilds all edges.
**Implementation:** `persona_tools.py:263/279` · `persona/graph.py:259` (`graph_payload`) · `:197` (`backfill_persona`) · `:101` (`build_edges_for_memory`)
**Data:** `persona_edges`.

### Teach from YouTube ✅
**Entry:** `reddit_persona_teach_youtube` · CLI `persona teach-video`
**Flow:** fetches a video's description + transcript + top comments → runs the persona's distillation over them. Accepts a full URL or 11-char id.
**Implementation:** `persona_tools.py:293` · `persona/teach.py:64` (`teach_from_youtube`) · `:45` (`parse_youtube_id`)
**Data:** `persona_memories`.

### Peer learning (persona-of-personas) ✅
**Entry:** `reddit_persona_ingest_peers` · CLI `persona ingest-peers`
**Flow:** reads every other active persona's conclusions and distils them through this persona's lens → meta-insight memories.
**Implementation:** `persona_tools.py:326` · `persona/ingest.py:425` (`ingest_from_peers`)
**Data:** `persona_memories` (source id `peer:<conclusion_id>`).

### Cross-persona sharing ✅
**Entry:** `reddit_persona_share` / `reddit_persona_rejections` · CLI `persona share|rejections`
**Flow:** re-frames one persona's memory through another's lens; if it contradicts the receiver's lens the share is rejected and logged.
**Implementation:** `persona_tools.py:355/376` · `persona/share.py:109` (`share_memory`) · `:77` (`list_rejections`)
**Data:** `persona_memories`, `persona_edges`, rejection log.

**Known gaps:** no automated test coverage for the `persona/` module (P2 — `tests/` has no `*persona*` file).

---

## 8. Paper research pipeline ✅

### Multi-source paper search ✅
**Entry:** `reddit_research_papers`
**Flow:** searches 6 academic sources in parallel, dedupes, ranks by citation count.
**Implementation:** `server.py:912` · `research/paper_pipeline.py`
**Data:** `posts` (6 academic source_types), `topic_posts`.

### Full paper research pipeline ✅
**Entry:** `reddit_paper_research_pipeline`
**Flow:** one call — search → rank → fetch fulltext → analyze → store. Primary entry point for paper work (added 2026-05-16).
**Implementation:** `server.py:1731` · `research/paper_pipeline.py:109`
**Data:** `posts`, `paper_full_texts`, `paper_analyses`.

| Feature | Status | MCP tool `server.py` | Implementation | Data |
|---|---|---|---|---|
| Papers for topic (cached read) | ✅ | `reddit_papers_for_topic:1890` | `research/paper_analyze.py:275` | reads `posts`+`paper_analyses` |
| Fetch fulltext PDF | ✅ | `reddit_paper_fulltext:1013` | `research/paper_fulltext.py:294` (`get_full_text`) | `paper_full_texts` |
| Fulltext status report | ✅ | `reddit_paper_fulltext_status:1048` | `research/paper_fulltext.py:577` | reads `paper_full_texts` |
| Parse paper sections | ✅ | `reddit_paper_sections:1060` | `research/paper_sections.py:173` | `paper_sections` |
| Get section text | ✅ | `reddit_paper_section_get:1077` | `research/paper_sections.py:258` | reads `paper_sections` |
| Chunk paper | ✅ | `reddit_paper_chunk:1098` | `research/paper_chunks.py:128` | `paper_chunks` + Mempalace |
| Bulk chunk topic | ✅ | `reddit_paper_chunk_topic:1165` | `research/paper_chunks.py:257` | `paper_chunks` |
| Chunk search (semantic+BM25) | ✅ | `reddit_paper_chunk_search:1114` | `research/paper_chunks.py` | vector search |
| Paper search (chunk rollup) | ✅ | `reddit_paper_search_papers:1138` | `research/paper_chunks.py` | vector search |
| Paper chunks stats | ✅ | `reddit_paper_chunks_stats:1233` | `research/paper_chunks.py` | diagnostic |
| Paper citations (forward) | ✅ | `reddit_paper_citations:864` | `sources/semantic_scholar.py:141` · `research/paper_references.py` | `posts` |
| Paper references (backward) | ✅ | `reddit_paper_references:874` | `sources/semantic_scholar.py:179` | `posts` |
| Extract refs from local PDF | ✅ | `reddit_paper_extract_refs:1181` | `research/paper_references.py:157` | `paper_references` |
| Local refs (corpus match) | ✅ | `reddit_paper_local_refs:1208` | `research/paper_references.py:314` | reads `paper_references` |
| Cited-by (corpus only) | ✅ | `reddit_paper_cited_by:1223` | `research/paper_references.py:326` | reads `paper_references` |
| Analyze paper (single) | ✅ | `reddit_analyze_paper:1242` | `research/paper_analyze.py:122` | `paper_analyses` |
| Analyze papers (bulk) | ✅ | `reddit_analyze_papers_bulk:1285` | `research/paper_analyze.py:189` | `paper_analyses` |
| Paper analyses list | ✅ | `reddit_paper_analyses:1323` | `research/paper_analyze.py:275` | reads `paper_analyses` |
| Generate paper outline | ✅ | `reddit_paper_outline_generate:1419` | `research/paper_pipeline.py:37` | `mcp_analyses` |
| Generate paper draft (IMRaD) | ✅ | `reddit_paper_draft_generate:1426` | `research/paper_pipeline.py:109` | `mcp_analyses` |
| Export with citations | ✅ | `reddit_paper_export_with_citations:1449` | `research/paper_pipeline.py:178` · `research/paper_export.py` | markdown |
| Open-access lookup (Unpaywall) | ✅ | `reddit_oa_lookup:1557` | `sources/unpaywall.py:27` (`lookup_doi`) | reads OA status |
| Papers export (BibTeX/RIS/APA/MD) | ✅ | `reddit_papers_export:1544` | `research/paper_export.py:82/116/144/178` | citation-format output |

**Known gaps:** none. (Fulltext download is best-effort — `paper_full_texts.status` records `not_oa` / `download_failed` / `parse_failed` per the upstream PDF availability; that is expected behaviour, not a defect.)

---

## 9. Product tracking ✅

| Feature | Status | MCP tool `server.py` | Implementation | Data |
|---|---|---|---|---|
| Create product | ✅ | `reddit_product_create:2764` | `research/product.py:48` (`create_product`) | `products` |
| List products | ✅ | `reddit_product_list:2780` | `research/product.py:113` | reads `products` |
| Convert topic → product | ✅ | `reddit_product_convert_topic:2859` | `research/product_sweep.py` | `products` |
| Product sweep (daily scan) | ✅ | `reddit_product_sweep:2786` | `research/product_sweep.py:149` (`run_product_sweep`) | `product_signals`, `sweeps` |
| Product signals (list) | ✅ | `reddit_product_signals:2799` | `research/product_sweep.py:237` (`list_signals`) | reads `product_signals` |
| Signal action (dismiss/snooze/hypothesis) | ✅ | `reddit_product_signal_action:2814` | `research/product_sweep.py:274` (`signal_action`) | `product_signals`, `hypothesis_tests` |
| Product dashboard | ✅ | `reddit_product_dashboard:2827` | `research/product_sweep.py` | reads products/signals/sweeps |
| Product digest (weekly markdown) | ✅ | `reddit_product_digest:2852` | `research/product_digest.py:48` (`build_digest`) | markdown output |
| Signal generators (6 detectors) | ✅ | (used inside sweep) | `research/signals.py:74/100/121/142/165/192` | `product_signals` |

**Known gaps:** none.

---

## 10. Audience & competitors ✅

### Build audience personas (citation-grounded) ✅
**Entry:** `reddit_audience_personas` · Tauri *Personas* screen
**Flow:** clusters the topic's real post authors into ICP personas backed by exemplar posts; optional LLM augmentation adds label, narrative, demographics, personal-memory bullets.
**Implementation:** `server.py:2145` · `research/audience.py:278` (`build_audience_personas`) · clustering `research/_clustering.py:130` (`kmeans_with_silhouette`)
**Data:** `audience_personas` (members, exemplar_post_id, vocab signatures, 7×24 activity heatmap, silhouette tightness, llm fields).

### Get audience personas (cached) ✅
**Entry:** `reddit_audience_personas_get`
**Implementation:** `server.py:2184` · `research/audience.py:513` (`get_audience_personas`)
**Data:** reads `audience_personas`.

### Global competitors (cross-topic unification) ✅
**Entry:** `reddit_global_competitors`
**Flow:** unifies competitor mentions across all topics via embedding cosine clustering.
**Implementation:** `server.py:2606` · `research/competitors.py:217` (`global_competitors`) · `research/cross_topic.py:47`
**Data:** computed from `graph_nodes`.

**Known gaps:** none on the data side; the Tauri *Personas* / *Global Competitors* screens need UI polish (category 15).

---

## 11. Export & documentation ✅

| Feature | Status | MCP tool `server.py` | Implementation | Output |
|---|---|---|---|---|
| Doc design prompt | ✅ | `reddit_doc_design_prompt:2998` | `research/export_deck.py:1201` (`get_design_system_prompt`) | prompt + schema |
| Plan doc layout | ✅ | `reddit_plan_doc_layout:3019` | `research/export_deck.py:260` (`plan_layout`) | layout-plan JSON |
| Render planned DOCX | ✅ | `reddit_render_planned_docx:3044` | `research/export_deck.py:578` (`render_planned_docx`) | `.docx` |
| Export DOCX (direct brief) | ✅ | `reddit_export_docx:2935` | `research/export_deck.py:631` (`build_docx`) · `research/text_report.py:72` | `.docx` |
| Export PPTX (pitch deck) | ✅ | `reddit_export_pptx:2967` | `research/export_deck.py:751` (`build_pptx`) | `.pptx` |
| Export DOCX from markdown | ✅ | `reddit_export_docx_from_markdown:3085` | `research/export_deck.py:920` (`build_docx_from_markdown`) | `.docx` |
| Export PDF from markdown | ✅ | `reddit_export_pdf_from_markdown:3055` | `research/text_report.py` (xeLaTeX + Lua filter) | `.pdf` |
| Launch brief (go-to-market) | ✅ | `reddit_launch_brief:2196` / `reddit_launch_brief_get:2240` | `research/launch.py:463` (`build_launch_brief`) / `:590` | `launch_briefs` table |

**Known gaps:** none.

---

## 12. MCP server & jobs queue ✅

| Feature | Status | MCP tool `server.py` | Implementation | Data |
|---|---|---|---|---|
| Diagnostics (health probe) | ✅ | `reddit_diagnostics:2253` | `research/monitor.py` | diagnostic |
| Submit job (async) | ✅ | `reddit_jobs_submit:2435` | `research/jobs.py` | `jobs` |
| Get job (poll) | ✅ | `reddit_jobs_get:2461` | `research/jobs.py` | reads `jobs` |
| List jobs | ✅ | `reddit_jobs_list:2478` | `research/jobs.py` | reads `jobs` |
| Cancel job | ✅ | `reddit_jobs_cancel:2498` | `research/jobs.py` | `jobs` (state) |
| Sub-server composition | ✅ | `server.py:3441` (`mcp.mount`) | `mcp/tools/persona_tools.py` | — |

**Architecture note:** the server exposes 131 `reddit_*` tools defined directly in `mcp/server.py` plus 16 `reddit_persona_*` tools from the mounted persona sub-server = **147 MCP tools**. New domains should get their own sub-server file under `mcp/tools/` and a `mcp.mount()` call — the pattern established 2026-05-17.
**Known gaps:** none.

---

## 13. CLI ✅

**Status:** ✅
**Entry:** `reddit-cli` (Typer app, `src/reddit_research/cli/main.py`)
**Surface:** sub-apps registered in `main.py` — `fetch`, `analyze`, `mcp`, `auth`, `research` (with nested `graph`), `ingest`, `whisper`, `ytdlp`, and `persona` (registered 2026-05-17 at `cli/main.py:4795`). Every command supports `--json` for machine output consumed by the Tauri sidecar.
**Implementation:** `cli/main.py` · `cli/persona_cmds.py` (14 persona commands)
**Known gaps:** none. (Before 2026-05-17 the `persona` command group was defined but not registered — fixed.)

---

## 14. Advanced analysis modules 🟡

These modules have a working Python core but **no MCP tool** — they are reached only via the CLI and/or Tauri screens. They are marked 🟡 because the analysis logic is implemented but the surfacing (MCP exposure and/or Tauri visualisation) is incomplete.

| Module | Purpose | Implementation | Status | Gap |
|---|---|---|---|---|
| Idea scan | Multi-topic adjacency sweep + synthesis | `research/idea_scan.py:254` (`start_scan`) | 🟡 | no MCP tool; Tauri-driven |
| OST | Opportunity-Solution Tree, experiment cards | `research/ost.py:102` (`build_tree`) | 🟡 | visualisation incomplete (cat. 15) |
| Kano | Kano feature classification | `research/kano.py:110` (`categorize_topic`) | 🟡 | no MCP tool |
| MoSCoW | MoSCoW prioritisation | `research/moscow.py:102` | 🟡 | no MCP tool |
| RICE | RICE scoring of topics | `research/rice.py:93` (`score_topic`) | 🟡 | no MCP tool |
| PMF | Product-market-fit survey scoring | `research/pmf.py:109` (`score`) | 🟡 | no MCP tool |
| Pricing | Van Westendorp / NPS / MaxDiff | `research/pricing.py:86/230/306` | 🟡 | no MCP tool |
| PRD generator | LLM PRD draft | `research/prd.py:59` (`generate`) | 🟡 | no MCP tool |
| Empathy map | Jobs-to-be-done extraction | `research/empathy.py:140` (`build_empathy_map`) | 🟡 | extraction works; UI incomplete |
| Why (root-cause) | Causal cascade on painpoints | `research/why.py:40` (`extract_why_for_painpoint`) | 🟡 | early stage |
| Sentiment by source | Per-source sentiment distribution | `research/sentiment_by_source.py:114` | 🟡 | charts incomplete (cat. 15) |
| Intents | Awareness→decision intent ladder | `research/intents.py:131` (`get_topic_intent`) | 🟡 | UI polish needed |
| Tactic library | Curated tactics extracted from corpus | `research/tactic_library.py:170` | 🟡 | extraction incomplete |
| Hypothesis tracker | A/B hypothesis lifecycle | `research/hypothesis_tracker.py:45` | 🟡 | schema works; UI incomplete |
| Iterate | Config-iteration experiment runs | `research/iterate.py:219` (`start_run`) | 🟡 | UI incomplete |
| Interviews | User-interview store + summarise | `research/interviews.py:46` | 🟡 | UI incomplete |
| PERT | Task rollup / critical path | `research/pert.py:138` (`rollup`) | 🟡 | no MCP tool |
| Solutions / science | Solution synthesis per painpoint | `research/solutions.py:81` · `research/science.py:44` | ✅ | wired into pipeline |
| Concept extraction | Concept map per topic | `research/concept.py:258` | ✅ | wired into graph |
| Coverage / saturation | Corpus coverage metrics | `research/coverage.py:47` · `research/saturation.py:25` | ✅ | wired into clean-corpus |
| Cross-topic opportunities | Top opportunities across topics | `research/cross_topic.py:47` | ✅ | wired into competitors |

**Known gaps:** P1 — 14 modules above are 🟡: the analysis runs but is not exposed via MCP and/or the Tauri screen that should render it is unfinished. Deciding which deserve MCP tools vs. staying Tauri-only is an open product call.

---

## 15. Tauri desktop app 🟡

**Location:** `app-tauri/` — a Tauri 2 shell that drives the Python CLI as a sidecar (`run_cli` / `run_cli_streaming`). Screens live under `app-tauri/src/screens/`. See the `tauri-python-sidecar-app` skill for the architecture.

### Complete screens ✅
| Screen | Purpose |
|---|---|
| Home | Dashboard, workspace links, recent insights |
| Collect | Trigger collection, source selector, live progress, discovered subs |
| Collects (history) | Past collection runs, retry, corpus stats |
| Posts | Browse corpus, search, source filter, engagement ranking |
| Papers | Paper list, fulltext status, analysis detail |
| Paper Chunks | Section-aware chunk search |
| Database | Raw SQLite query tool + schema explorer |
| BYOK | LLM provider / API key / model configuration |
| Ingest | Drag-drop local file ingest |
| Products | Product list + dashboard |
| Launch Brief | Go-to-market brief viewer |
| Export | DOCX / PDF / PPTX generation |
| Diagnostics | Health probe surface |

### Partial screens 🟡
| Screen | Works | Gap |
|---|---|---|
| Graph | basic node view | faceted/advanced filtering unfinished |
| Insights | synthesis findings render | deliberation tiers not wired in |
| Personas (audience) | clustering + heatmap | UI polish |
| Global Competitors | core unification | UI detail |
| OST | data collection | matrix visualisation incomplete |
| Intent Ladder | classification | screen polish |
| Sentiment by Source | data pipeline | charts incomplete |
| Playbook / Tactics | screen shell | LLM extraction incomplete |
| Why (root-cause) | early | causal viz incomplete |
| Empathy (jobs) | early | LLM extraction incomplete |
| Iterate / Bets / Tasks / Activity | schemas exist | UI incomplete / basic |

**Known gaps:** P1 — 11 partial screens above (data pipeline works, visualisation unfinished — not breakage). The sidecar binary is no longer committed (gitignored); `release.yml` rebuilds it fresh per release. Video ingest (`whisper`/`ytdlp` CLI sub-apps, `sources/video.py:125`) is 🔒 behind the `video` pyproject extra.

---

## 16. Customization & feedback ✅

| Feature | Status | MCP tool `server.py` | Implementation | Data |
|---|---|---|---|---|
| Record feedback (finding verdict) | ✅ | `reddit_feedback_record:2649` | `research/feedback.py:34` (`record_feedback`) | `feedback` |
| List feedback | ✅ | `reddit_feedback_list:2667` | `research/feedback.py:79` (`feedback_for_prompt`) | reads `feedback` |
| Create saved view | ✅ | `reddit_saved_view_create:2688` | `research/saved_views.py:50` (`create_view`) | `saved_views` |
| List saved views | ✅ | `reddit_saved_view_list:2705` | `research/saved_views.py:86` (`list_views`) | reads `saved_views` |
| List prompts | ✅ | `reddit_prompt_list:2712` | `research/prompt_store.py:128` (`list_prompts`) | reads `prompt_overrides` |
| Get prompt | ✅ | `reddit_prompt_get:2720` | `research/prompt_store.py:51` (`get_prompt`) | reads `prompt_overrides` |
| Set prompt (override) | ✅ | `reddit_prompt_set:2741` | `research/prompt_store.py:63` (`set_prompt`) | `prompt_overrides` |

Recorded feedback is fed back into synthesis prompts via `research/feedback.py:79` (`feedback_for_prompt`).
**Known gaps:** none.

---

## Data persistence summary

**SQLite (`core/db.py`)** — `posts`, `comments`, `users`, `subreddits`, `topic_posts`, `topic_prefs`, `topic_insights`, `mcp_analyses`, `graph_nodes`, `graph_edges`, `personas`, `persona_memories`, `persona_conclusions`, `persona_edges`, `paper_full_texts`, `paper_sections`, `paper_chunks`, `paper_analyses`, `paper_references`, `finding_research_links`, `products`, `product_signals`, `sweeps`, `hypothesis_tests`, `audience_personas`, `launch_briefs`, `jobs`, `feedback`, `saved_views`, `prompt_overrides`.

**Vector index (Mempalace / ChromaDB, ONNX MiniLM)** — `posts` collection (semantic search) and `paper_chunks` collection (RAG over paper sections). Cache at `~/.cache/mempalace/`.

**Config** — `~/.config/reddit-myind/.env` (BYOK provider/keys).

---

## Known gaps rollup

| Severity | Gap | Location |
|---|---|---|
| ✅ resolved | Sidecar binary staleness — the binary is no longer committed (gitignored); `release.yml` rebuilds it fresh per release, local dev rebuilds via `pyinstaller reddit-cli.spec` | `app-tauri/src-tauri/binaries/` |
| **deferred** | Developer ID cert + notarization — v0.1.0 ships as an unsigned beta by decision | `docs/manual-todo/future-scope-signing-and-secrets.md` |
| **deferred** | `JWT_DESKTOP_SECRET` not in GitHub Secrets — unsigned beta uses the `release.yml` random fallback | `docs/manual-todo/future-scope-signing-and-secrets.md` |
| **deferred** | Auto-update not configured (users manually download `.dmg`) | `docs/manual-todo/future-scope-signing-and-secrets.md` |
| **P1** | 14 advanced analysis modules are 🟡 — core works, no MCP tool / unfinished Tauri screen | category 14 |
| **P1** | 11 Tauri screens 🟡 — data pipeline works, visualisation unfinished | category 15 |
| **P2** | No automated test coverage for the `persona/` module | `tests/` |
| **P2** | Deliberation tiers not rendered in the Tauri *Insights* screen | category 15 |

---

## Update protocol

When to update this file:
- A feature is shipped → flip the status emoji from 🚧 → ✅ (or 🟡 if known gaps remain)
- A bug is fixed → update or remove from "Known gaps"
- A file is moved/renamed → re-run `codegraph sync`, then `codegraph_search` for the symbol to find the new path
- A new feature is added → add a new section under the right category and bump the summary table

Re-run cadence: at least once before every desktop release / build that touches more than one feature.
