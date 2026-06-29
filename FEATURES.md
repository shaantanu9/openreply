# OpenReply (openreply) — Features & Flows

> **Updated:** 2026-06-29 by Claude · **§21 OpenReply content engine** (7 structured kinds — post/thread/article/short-script/youtube/follow-up-reply/follow-up-sequence + edit/save/schedule, verified end-to-end) · §1.8 social fetch end-to-end (Connect = enabled; ScrapeCreators/TruthSocial/Bluesky wired through Connections) · §21 Opportunity lifecycle (save/draft/replied/dismiss + filter chips + social badges; Inbox=saved; Analytics funnel) · §21 Self-learning loop (auto ingest→memories→beliefs after fetch/schedule/manual + save/dismiss feedback + Learning screen) · journey/flow audit (command triangle 100% wired, no onboarding blockers) + completed Queue (edit/status/delete), Agents edit/delete, live Pricing, onboarding clarity · **Build state:** v0.1.23 shipped (signed+notarized → `myind-ai/openreply`, Apple Silicon) — adds **§1.7 International platforms + Reach Connections** (9 Agent-Reach-ported sources: v2ex · bilibili · xueqiu · xiaohongshu · exa · reddit_free · web/linkedin readers · xiaoyuzhou) + the in-app browser-login → cookie-capture credential flow + the tiered Reddit fetch cascade (praw→cookie→proxy→rss). 🟡 = the §1.7 partials (xiaohongshu/linkedin-deep/xiaoyuzhou-transcription, P2) · branch `multi-source`
> Source of truth for every user-facing feature, its flow, code location, completeness, and known gaps. Update after every feature change. Re-run `codegraph sync` / `graphify update .` before editing to keep file:line citations fresh.

> ### 🗓️ 2026-06 session changes (what moved)
> - **Reddit** — anon `.json` is 403-blocked in 2026; added **RSS** (free, no-auth) + **read-only OAuth** (client_id+secret → full JSON, 100/min) + 3-yr PullPush history. ✅
> - **New sources** — **Stack Exchange network ×8**, **Europe PMC**, **DBLP**, **Steam reviews**, **Bluesky** (app-password fix). Lemmy + GitHub Issues now default-on. ✅
> - **Paper full-text** — auto-prefetch (download+extract PDF, no LLM) of top-15 papers after collect → chat grounds on intro+conclusions, not just abstracts. ✅
> - **Prioritize tab** (NEW) — ranked opportunity list (RICE + Kano + MoSCoW). Closes the cat-14 🟡 for RICE/Kano/MoSCoW. ✅
> - **Docs** — `CHANGES-2026-06.md`, `docs/USER-FEEDBACK-SOURCES.md`.
> - **Cat-14 fully closed** — Why root-cause, Sentiment charts, Tactics, Hypothesis-tracker screen shipped; PERT + idea-scan exposed as MCP tools. ✅
> - **All cat-15 screens done** — consensus tiers, OST 2×2 matrix, Global-Competitors detail, Personas enrichment, Bets polish, and Map clickable-legend faceted filtering all shipped. **0 🟡 remain (196/196 ✅).**

OpenReply is a **Tauri 2 desktop app + FastMCP server + Python CLI** — an open-source social marketing reply & content co-pilot. The same Python core (`src/openreply/`) powers all three surfaces: the MCP server exposes 120 tools to Claude Code, the Typer CLI exposes the equivalent command tree, and the Tauri desktop app drives the CLI as a sidecar.

## Legend
- ✅ **Complete** — works end-to-end, no known half-done parts
- 🟡 **Partial** — works but has half-done gaps documented in "Known gaps"
- 🚧 **In progress** — actively being built, not shippable
- ❌ **Missing** — table-stakes or planned but not started
- 🔒 **Gated** — exists but locked behind a flag / optional extra

## Quick status summary

| Category | Total | ✅ | 🟡 | 🚧 | ❌ |
|---|---|---|---|---|---|
| 1. Data fetching — source adapters | 37 | 37 | 0 | 0 | 0 |
| 2. Discovery & collection | 6 | 6 | 0 | 0 | 0 |
| 3. Corpus management | 11 | 11 | 0 | 0 | 0 |
| 4. Synthesis & gap finding | 7 | 7 | 0 | 0 | 0 |
| 5. Knowledge graph | 13 | 13 | 0 | 0 | 0 |
| 6. Semantic search & memory palace | 7 | 7 | 0 | 0 | 0 |
| 7. Persona agents | 10 | 10 | 0 | 0 | 0 |
| 8. Paper research pipeline | 25 | 25 | 0 | 0 | 0 |
| 9. Product tracking | 9 | 9 | 0 | 0 | 0 |
| 10. Audience & competitors | 3 | 3 | 0 | 0 | 0 |
| 11. Export & documentation | 8 | 8 | 0 | 0 | 0 |
| 12. MCP server & jobs queue | 6 | 6 | 0 | 0 | 0 |
| 13. CLI | 1 | 1 | 0 | 0 | 0 |
| 14. Advanced analysis modules | 18 | 18 | 0 | 0 | 0 |
| 15. Tauri desktop app | 25 | 25 | 0 | 0 | 0 |
| 16. Customization & feedback | 7 | 7 | 0 | 0 | 0 |
| 18. Research & paper-writing assistant | 8 | 7 | 1 | 0 | 0 |
| 21. OpenReply — content, analytics, visibility & brain | 7 | 7 | 0 | 0 | 0 |
| **Total** | **208** | **207** | **1** | **0** | **0** |

> Category numbering 17, 19 and 20 are intentionally retired (legacy research-only suites — strategy frameworks, Research Mode, and intelligence monitoring — were removed when this repo became OpenReply); the gaps in numbering are expected.

Nearly the whole surface is ✅: MCP (cats 1–13, 16), advanced analysis (14), and the Tauri desktop app (15). The only 🟡 is the planned student-PDF entry surface in category 18. The reply/content co-pilot is driveable both in-app and via the 120 MCP tools.

---

## 1. Data fetching — source adapters ✅

**Status:** ✅ · 42 source adapters (9 added in v0.1.23 — §1.7), all complete
**Entry points:** `reddit_fetch_*` MCP tools · `openreply fetch *` · Tauri *Collect* screen source selector
**User flow:** caller supplies a keyword/query (+ optional source-specific params) → adapter calls the upstream API → results normalise to the canonical `posts` schema → rows persist to SQLite tagged with a `source_type`.
**Data:** every adapter writes to the `posts` table with a distinct `source_type`; Reddit comment fetches also write `comments`.
**Implementation:** each adapter is one module under `src/openreply/sources/`; the MCP tool wrapper lives in `src/openreply/mcp/server.py`. All adapters share `sources/_http.py:44` (`polite_get` — rate-limited, retrying HTTP).

### 1.1 Social & community
| Feature | MCP tool `server.py` | Adapter | `source_type` |
|---|---|---|---|
| Reddit posts | `openreply_fetch_posts:170` | `sources/reddit.py` | `reddit` |
| Reddit comments | `openreply_fetch_comments:188` | `sources/reddit.py` | (writes `comments`) |
| Reddit user profile | `openreply_fetch_user:194` | `sources/reddit.py` | `reddit` |
| Reddit historical archive | `openreply_fetch_historical:590` | `sources/reddit.py` (pullpush) | `reddit` |
| Hacker News | `openreply_fetch_hn:732` | `sources/hackernews.py:48` | `hn` |
| Bluesky | `openreply_fetch_bluesky:1602` | `sources/bluesky.py:57` | `bluesky` |
| Lemmy | `openreply_fetch_lemmy:1586` | `sources/lemmy.py:50` | `lemmy` |
| Mastodon | `openreply_fetch_mastodon:1594` | `sources/mastodon.py:50` | `mastodon` |
| Discourse forum | `openreply_fetch_discourse:1677` | `sources/discourse.py:51` | `discourse` |

### 1.2 Academic & research
| Feature | MCP tool `server.py` | Adapter | `source_type` |
|---|---|---|---|
| arXiv preprints | `openreply_fetch_arxiv:811` | `sources/arxiv.py:58` | `arxiv` |
| PubMed | `openreply_fetch_pubmed:827` | `sources/pubmed.py:79` | `pubmed` |
| Google Scholar | `openreply_fetch_scholar:777` | `sources/scholar.py:49` | `scholar` |
| Semantic Scholar | `openreply_fetch_semantic_scholar:842` | `sources/semantic_scholar.py:84` | `semantic_scholar` |
| OpenAlex | `openreply_fetch_openalex:819` | `sources/openalex.py:65` | `openalex` |
| Crossref | `openreply_fetch_crossref:883` | `sources/crossref.py:103` | `crossref` |
| Direct DOI lookup | `openreply_fetch_by_doi:902` | `sources/crossref.py:143` | `crossref` |
| Europe PMC (bio + preprints) ✅ NEW | (collect only) | `sources/europepmc.py` | `europepmc` |
| DBLP (computer science) ✅ NEW | (collect only) | `sources/dblp.py` | `dblp` |

### 1.3 Developer tools & code
| Feature | MCP tool `server.py` | Adapter | `source_type` |
|---|---|---|---|
| GitHub repos | `openreply_fetch_github_repos:1685` | `sources/github_trending.py:55` | `github` |
| GitHub issues | `openreply_fetch_github_issues:1693` | `sources/github_issues.py:56` | `github_issues` |
| Stack Overflow | `openreply_fetch_stackoverflow:785` | `sources/stackoverflow.py:49` | `stackoverflow` |
| Stack Exchange network ×8 ✅ NEW | (collect only) | `collect_adapter.run_stackexchange` (reuses `stackoverflow.py` per-site) | `stackexchange` |
| Dev.to | `openreply_fetch_devto:1578` | `sources/devto.py:41` | `devto` |
| Package stats (npm/PyPI) | `openreply_fetch_package_stats:1712` | `sources/npmstats.py:18` · `sources/pypistats.py:12` | `npm` / `pypi` |

### 1.4 App stores & consumer reviews
| Feature | MCP tool `server.py` | Adapter | `source_type` |
|---|---|---|---|
| Apple App Store reviews | `openreply_fetch_appstore:740` | `sources/appstore.py:269` | `appstore` |
| Google Play reviews | `openreply_fetch_playstore:760` | `sources/playstore.py:76` | `playstore` |
| Trustpilot reviews | `openreply_fetch_trustpilot:1642` | `sources/trustpilot.py:180` | `trustpilot` |
| Product Hunt | `openreply_fetch_producthunt:1634` | `sources/producthunt.py:53` | `producthunt` |
| AlternativeTo 🟡 | `openreply_fetch_alternativeto:1650` | `sources/alternativeto.py:48` | `alternativeto` |
| Steam reviews ✅ NEW | (collect only) | `sources/steam.py` | `steam` |

### 1.5 News, trends & reference
| Feature | MCP tool `server.py` | Adapter | `source_type` |
|---|---|---|---|
| Google News | `openreply_fetch_gnews:1570` | `sources/gnews.py:25` | `gnews` |
| Google Trends | `openreply_fetch_trends:795` | `sources/trends.py:40` | `trends` |
| Wikipedia (summary + pageviews) | `openreply_fetch_wikipedia:1701` | `sources/wikipedia.py:14` | `wikipedia` |
| YouTube (videos + comments + transcripts) | `openreply_fetch_youtube:1658` | `sources/youtube.py` · `run_youtube` (`collect_adapter.py:387`) | `youtube` / `youtube_description` / `youtube_transcript` |
| RSS / Atom feeds | `openreply_fetch_rss:1609` | `sources/rss.py:115` · catalog `sources/rss_catalog.py:161` | `rss` |

### 1.6 Local file ingest
| Feature | Entry point | Implementation | `source_type` |
|---|---|---|---|
| CSV/JSON/TXT/MD/PDF/VTT/SRT ingest | `openreply_ingest_csv:2749` · CLI `ingest file` | `sources/local_file.py:543` · `research/ingest.py:87` | user-supplied |
| Folder walker (recursive ingest) | CLI `ingest folder` | `cli/main.py` (`ingest_app`) · `sources/local_file.py:568` | user-supplied |

### 1.7 International platforms + Reach Connections ✅ NEW (v0.1.23)
Ported from Agent Reach (MIT). Login/key-gated sources unlock via the in-app
**Reach Connections** flow (open platform login in the browser → import the
session cookie → verify → use). Credentials live in `source_credentials`
(local SQLite); nothing leaves the machine.

| Feature | MCP tool | Adapter | `source_type` |
|---|---|---|---|
| V2EX (Chinese dev forum) | `openreply_fetch_v2ex` | `sources/v2ex.py` | `v2ex` |
| Bilibili (video search) | `openreply_fetch_bilibili` | `sources/bilibili.py` | `bilibili` |
| Xueqiu 雪球 (investor posts) | `openreply_fetch_xueqiu` | `sources/xueqiu.py` | `xueqiu` |
| Xiaohongshu 小红书 🟡 (cookie, best-effort) | `openreply_fetch_xiaohongshu` | `sources/xiaohongshu.py` | `xiaohongshu` |
| Exa neural web search | `openreply_fetch_exa` | `sources/exa_search.py` (EXA_API_KEY) | `exa` |
| Reddit free (cookie/proxy + RSS fallback) | `openreply_fetch_reddit_free` | `sources/reddit_free.py` | `reddit_free` |
| Web reader (any URL → markdown) | `openreply_read_web` | `sources/web_reader.py` (Jina) | `web` |
| LinkedIn URL reader 🟡 (Jina; deep needs MCP) | `openreply_read_linkedin` | `sources/linkedin.py` | `linkedin` |
| Xiaoyuzhou 小宇宙 🟡 (episode metadata) | `openreply_read_xiaoyuzhou` | `sources/xiaoyuzhou.py` | `xiaoyuzhou` |

**Reach Connections (credential flow):** Tauri *Connections* screen
(`app-tauri/src/screens/reachConnections.js`) + a Settings card · backend
`research/reach_connections.py` (list/verify/import_browser/save_manual/delete) ·
store `core/credentials.py` + `source_credentials` table (`core/db.py`) ·
multi-platform browser cookie extraction `sources/_cookie_extract.py`
(`COOKIE_REGISTRY`) · MCP `openreply_creds_list`/`openreply_creds_verify` · CLI
`openreply creds list|import|save|verify|delete` · Tauri IPC `creds_*`
(`src-tauri/src/commands.rs` + `main.rs`). All gated sources degrade to `[]`
+ a hint when no credential is connected.

**Reddit cascade (fix):** the first-class Reddit fetch is now tiered —
PRAW → cookie → proxy → RSS (`fetch/_reddit_tiers.py`, `fetch/posts.py`,
`fetch/search.py`); full score/comments when a `reddit_session` cookie is
connected, never a hard 403. Optional `REDDIT_PROXY` in `core/public_client.py`.

**Known gaps (1.7):** Xiaohongshu signed-header brittleness; LinkedIn deep
profile/company search needs the upstream linkedin-scraper MCP; Xiaoyuzhou
audio→text transcription deferred (would reuse the Whisper pipeline) — all P2,
each degrades to `[]` cleanly.

### 1.8 Social fetch — end-to-end (Connect = enabled) ✅ NEW (2026-06-27)
Every social adapter now fetches **from the app**, not just from an explicit CLI
`--sources` flag. Connect a platform in the Connections screen → verify → it's
auto-pulled into collection runs; mute any source with the per-card **"Used in
collection"** toggle. Reference: `docs/SOCIAL_FETCH.md`.

| Platform | Mechanism | Credential (kind) | `source_type` | State |
|---|---|---|---|---|
| X / Twitter | bird/cookie → xAI → xquik | `twitter` (cookie) / `XAI`/`XQUIK` key | `x` | ✅ |
| TikTok · Instagram · Threads · Pinterest | ScrapeCreators REST | `scrapecreators` (api_key) — one key, 4 platforms | `tiktok`/`instagram`/`threads`/`pinterest` | ✅ (needs key) |
| YouTube | yt-dlp search→comments+transcript | none | `youtube` | ✅ |
| Bluesky | AT Protocol authed search | `bluesky` (login_pair: handle+app-password) | `bluesky` | ✅ |
| Mastodon | public hashtag search | none | `mastodon` | ✅ |
| TruthSocial | Mastodon-compatible API | `truthsocial` (api_key/token) | `truthsocial` | ✅ |

**Implementation:** adapters read `core/credentials.py` first then env
(`sources/_scrapecreators.py`, `truthsocial.py`, `bluesky.py`) ·
`source_credentials.enabled` flag (`core/db.py` migration) + `is_enabled`/`set_enabled` ·
catalogue + `login_pair` kind + `toggle_connection` + `connected_collection_sources`
(`research/reach_connections.py`) · default-sweep injection (`research/collect.py`) ·
`openreply creds toggle` (`cli/main.py`) · `creds_toggle` IPC (`src-tauri/src/commands.rs`,
`main.rs`) · UI cards/toggle/pills (`app-tauri/src/or/dynamic.js::renderConnections`).

**Known gaps (1.8):** ScrapeCreators uses one shared key → the four platforms toggle
together (per-platform sub-toggles are P2). LinkedIn stays URL-only (not topic-search).
`source_credentials` is local-trust (OS-keychain hardening is future scope).

**Known gaps:** none. Two transcript paths: (1) yt-dlp captions for any topic-collected video; (2) Whisper fallback for *caption-less* videos in the bulk YouTube source — `_whisper_transcript_rows` in `sources/youtube.py`, capped at 3 videos/collect and aggressive/rerun-only (`research/collect.py` `_run_source`). Manual paste-a-URL ingest (`sources/video.py:125`) is gated behind the `video` pyproject extra (yt-dlp / faster-whisper) — see category 15.

---

## 2. Discovery & collection ✅

### Discover subreddits ✅
**Entry:** `openreply_discover_subs` · CLI `research collect` (internally)
**Flow:** topic keyword → Reddit search + heuristic ranking → relevant subreddit list.
**Implementation:** `server.py:458` · `research/discover.py:280` (`discover_subs`)
**Data:** in-memory result; consumed by the collect orchestrator.

### Research collect — master orchestrator ✅
**Entry:** `openreply_research_collect` · CLI `research collect --topic X` · Tauri *Collect* screen
**Flow:** discover subs → multi-source fan-out fetch → top-of-month/year ranking → parameterised search expansion → optional historical archive → all rows tagged to the topic.
**Implementation:** `server.py:496` · `research/collect.py:227` (`collect`) · adapters dispatched via `sources/collect_adapter.py:49`
**Data:** `posts`, `topic_posts` junction, `topic_prefs` (schedule/settings).

### Aggressive collect preset ✅
**Entry:** `openreply_research_collect` with `aggressive=true`
**Flow:** raises every per-source limit, enables all source categories, pulls ~3 years of history via pullpush.
**Implementation:** `server.py:496` · `research/collect.py:227`
**Data:** `posts`, `topic_posts`.

### Collect job queue ✅
**Entry:** `openreply_jobs_submit("openreply_research_collect", {...})` → `openreply_jobs_get(job_id)`
**Flow:** long-running collect runs in a background worker; caller polls for state.
**Implementation:** `server.py:2435` (submit) · `research/jobs.py`
**Data:** `jobs` table. See category 12.

### Fetch historical archive ✅
**Entry:** `openreply_fetch_historical`
**Implementation:** `server.py:590` · `sources/reddit.py` (pullpush archive)
**Data:** `posts` (`source_type='reddit'`).

### Idea scan (multi-topic sweep) 🟡 → see category 14
A broader "scan many adjacent topics at once" engine exists (`research/idea_scan.py:254`) but is CLI/Tauri-only; documented under Advanced analysis modules.

**Known gaps:** none for the four core MCP-backed flows.

---

## 3. Corpus management ✅

| Feature | Status | MCP tool `server.py` | Implementation | Data |
|---|---|---|---|---|
| Get corpus (engagement-ranked) | ✅ | `openreply_get_corpus:575` | `research/corpus_format.py:107` | reads `posts` + `topic_posts` |
| Topic stats | ✅ | `openreply_topic_stats:612` | `core/db.py` | reads `posts`/`topic_posts` |
| Corpus temporal split | ✅ | `openreply_corpus_temporal_split:552` | `research/collect.py:697` (`corpus_temporal_split`) | reads `posts` |
| Clean corpus (relevance gate) | ✅ | `openreply_clean_corpus:2547` | `research/relevance.py:125` (`filter_topic_posts`) · `research/saturation.py:25` | deletes `posts` rows |
| Collect quality check | ✅ | `openreply_collect_quality_check:2582` | `research/quality_gate.py:64` (`passes_quality`) | diagnostic only |
| Find existing topic (dedup pre-check) | ✅ | `openreply_find_existing_topic:2563` | `research/topic_resolver.py:129` (`find_existing_topic`) | reads palace embeddings |
| Merge duplicate topics | ✅ | `openreply_merge_duplicate_topics:2573` | `research/topic_resolver.py:207` (`merge_duplicate_topics`) | `topic`, `topic_posts` |
| Topic soft delete | ✅ | `openreply_topic_soft_delete:2516` | `research/trash.py:33` (`soft_delete`) | `topic_prefs.deleted_at` |
| Topic restore | ✅ | `openreply_topic_restore:2526` | `research/trash.py:68` (`restore`) | `topic_prefs.deleted_at` |
| Topic trash list | ✅ | `openreply_topic_trash_list:2533` | `research/trash.py:81` (`list_trash`) | reads `topic_prefs` |
| Topic trash purge (>7d) | ✅ | `openreply_topic_trash_purge:2540` | `research/trash.py:112` (`purge_older_than`) | hard-deletes topic rows |

**Known gaps:** none.

---

## 4. Synthesis & gap finding ✅

### Synthesize insights ✅
**Entry:** `openreply_synthesize_insights` · CLI `research synthesize --topic X` · Tauri *Insights* screen
**Flow:** LLM reads the engagement-ranked corpus → extracts pain-points, feature wishes, complaints, DIY workarounds → 4-part report. As of 2026-05-17 the prompt also receives the **top-20 knowledge-graph nodes** for the topic so findings cross-check against known topology.
**Implementation:** `server.py:1340` · `research/insights.py:321` (`synthesize_insights`) · chunked variant `research/insights.py:856` · graph-context block `research/insights.py` (added 2026-05-17)
**Data:** `topic_insights`, `mcp_analyses` (`kind='synthesis'`).

### Deliberate — 5-persona council ✅
**Entry:** `openreply_deliberate` · CLI `research deliberate --topic X`
**Flow:** five LLM personas (Synthesizer, Skeptic, Quantifier, Risk Officer, Devil's Advocate) debate each finding over multiple rounds → findings tier into confirmed / probable / minority / discarded. As of 2026-05-17 the engine also reads **persona-agent conclusions** for the topic, formats them as "PERSONA LENSES" in the vote prompt, and counts ≥2 endorsing conclusions as +1 confirm-equivalent (`persona_grounded` flag on the result).
**Implementation:** `server.py:2074` · `research/deliberate.py:475` (`deliberate`) · persona-conclusion integration `research/deliberate.py` (added 2026-05-17)
**Data:** `mcp_analyses` (transcripts + tiers).

### Find gaps ✅
**Entry:** `openreply_find_gaps`
**Flow:** structured extraction of gap signals (painpoints / feature wishes / workarounds / complaints) from the corpus into graph nodes.
**Implementation:** `server.py:1466` · `research/gaps.py:276` (`find_gaps`) · gap discovery engine `research/gap_discovery.py:213`
**Data:** `graph_nodes` (kinds: painpoint, feature, workaround, complaint).

### Research link (papers → findings) ✅
**Entry:** `openreply_research_link`
**Implementation:** `server.py:2888` · `research/research_linker.py:66` (`link_findings_for_topic`)
**Data:** `finding_research_links`.

### Research links — read ✅
**Entry:** `openreply_research_links`
**Implementation:** `server.py:2896` · `research/research_linker.py:165` (`get_links_for_finding`) / `:185` (`get_links_summary`)
**Data:** reads `finding_research_links`.

### MCP analyses list ✅
**Entry:** `openreply_mcp_analyses_list`
**Implementation:** `server.py:1509`
**Data:** reads `mcp_analyses`.

### Search all (cross-table) ✅
**Entry:** `openreply_search_all`
**Flow:** SQL + semantic search across posts, graph nodes, analyses, papers, hypotheses; optional LLM query expansion.
**Implementation:** `server.py:2906` · `research/search_all.py:248` (`search_all`)
**Data:** writes a summary row to `mcp_analyses` (`kind='search'`).

**Known gaps:** none. Deliberation results are not yet rendered in the Tauri *Insights* screen — tracked under category 15.

---

## 5. Knowledge graph ✅

| Feature | Status | MCP tool `server.py` | Implementation `research/graph.py` | Data |
|---|---|---|---|---|
| Build graph | ✅ | `openreply_graph_build:649` | derives topic/sub/post/comment/user nodes + edges | `graph_nodes`, `graph_edges` |
| Graph stats | ✅ | `openreply_graph_stats:660` | per-kind node/edge counts | reads `graph_*` |
| Top nodes (hubs) | ✅ | `openreply_graph_top_nodes:666` | degree ranking, kind filter | reads `graph_*` |
| Neighbors (expansion) | ✅ | `openreply_graph_neighbors:672` | neighbour lookup, edge-kind filter | reads `graph_*` |
| Upsert semantic nodes | ✅ | `openreply_graph_upsert_semantic:690` | inserts LLM gap signals | `graph_nodes`, `graph_edges` |
| Export graph JSON (D3) | ✅ | `openreply_graph_export_json:719` | D3 force-graph format | JSON output |
| PageRank | ✅ | `openreply_graph_pagerank:1939` | structural importance ranking | computed |
| Communities (Louvain) | ✅ | `openreply_graph_communities:1950` | community detection | computed |
| Betweenness bridges | ✅ | `openreply_graph_bridges:1958` | structural bridge nodes | computed |
| Structural summary | ✅ | `openreply_graph_structural_summary:1966` | density / components metrics | diagnostic |
| Build relations (semantic edges) | ✅ | `openreply_graph_build_relations:2872` | ChromaDB MiniLM post-pass — `relates_to` / `potentially_solves` / `could_address` / `co_evidenced` edges, no LLM cost | `graph_edges` |
| FSD Fleet debate on the Map | ✅ | (CLI `research debate` / `debate-verdicts` / `debate-audit`) | 5-persona debate (`deliberate()`) tiers each finding Confirmed/Probable/Minority/Discarded; verdicts + lineage + checks persisted; trust badges + node glyphs; ↺ Replay audit timeline + token-cost/budget (`research/debate_run.py`) | `debate_verdicts`, `debate_runs`, `graph_nodes.debate_*` |
| FSD Fleet flow orchestration | ✅ | (CLI `research fleet-plan` / `fleet-run` / `fleet-status`) | decision gate → route plan (quick/standard/deep) → clarify → ground → debate → synthesize → audit, staged + recorded; Run Fleet picker + flow timeline on the Map (`research/fleet_flow.py`, `screens/fleetFlow.js`) | `fleet_runs` |

**Implementation:** all graph tools wrap `src/openreply/research/graph.py`. The dense-relations post-pass is the `dense-graph-relations` skill, battle-tested 2026-04-21. The Fleet debate wraps `src/openreply/research/deliberate.py` via `research/debate_run.py`; the Tauri Map surface is `app-tauri/src/screens/debatePanel.js` (Debate button + panel + `renderTrustBadge`) wired into `screens/topic.js`, with node glyphs in `graph/export.py:217`. Spec: `docs/specs/FLEET_AGENTS_TOPIC_MAP.md`.
**Known gaps:** none on the MCP/CLI side. The Tauri *Graph* screen has only basic node viewing — faceted/advanced filtering is unfinished (category 15). FSD Fleet Phase 1 (debate + badges), Phase 2 (Agent Memory tab), Phase 3a (debate replay/audit timeline), Phase 3b (token-cost estimate + budget governance via `OPENREPLY_DEBATE_TOKEN_BUDGET`), and Phase 4 (flow orchestration — decision gate → route → clarify → ground → debate → synthesize → audit, Run Fleet on the Map) are shipped. Remainder: true live token-streaming of the flow (stages settle from the result; `on_stage` hook is wired for a future NDJSON command). Out of scope by design (different product): WhyBuddy's SPEC-tree generation, 3D scene, Docker executor, A2A/swarm/reputation/marketplace, UE5, Feishu. Note: debate cost is a character-based estimate, not real provider token usage. Tracked in `docs/specs/FLEET_AGENTS_TOPIC_MAP.md`.

---

## 6. Semantic search & memory palace ✅

The "memory palace" is a local ChromaDB index with an ONNX MiniLM embedding model (~80 MB cached). Fully offline after warmup. See the `mempalace-chromadb-onnx` skill.

| Feature | Status | MCP tool `server.py` | Implementation | Data |
|---|---|---|---|---|
| Palace status | ✅ | `openreply_palace_status:1981` | `research/palace.py` | diagnostic |
| Palace warmup (download model) | ✅ | `openreply_palace_warmup:1996` | `research/palace.py` | `~/.cache/mempalace/` |
| Palace reindex | ✅ | `openreply_palace_reindex:2410` | `research/palace.py` | Mempalace collection |
| Palace repair (heal HNSW) | ✅ | `openreply_palace_repair:2377` | `research/palace.py` | moves corrupt index aside |
| Semantic search (posts) | ✅ | `openreply_semantic_search:2017` | `research/search_all.py` | vector search |
| Related posts (nearest-neighbour) | ✅ | `openreply_related_posts:2062` | `research/search_all.py` | vector search |
| Schema inspector | ✅ | `openreply_describe_schema:365` · `openreply_query_db:220` | `core/db.py` | read-only SQL |

**Known gaps:** none.

---

## 7. Persona agents ✅

Persona agents are single-lens learning agents: each reads collected posts through a fixed `lens`, distils lessons into `persona_memories`, clusters them into high-confidence `persona_conclusions`, and answers questions citing only its own memories. Personas can teach each other and learn from YouTube. Built over phases through 2026-05-12; the full MCP + CLI surface landed 2026-05-17 (`5f0650e`).

The MCP tools live in a dedicated **sub-server** — `src/openreply/mcp/tools/persona_tools.py` — mounted into the main server via `mcp.mount()` (`server.py:3441`). The CLI command group is `src/openreply/cli/persona_cmds.py`, registered into `cli/main.py:4795`.

### Persona CRUD ✅
**Entry:** `openreply_persona_create` / `_list` / `_get` / `_update` / `_delete` · CLI `persona create|list|update|delete`
**Implementation:** `persona_tools.py:61/85/95/105/132` · `persona/store.py:21/60/77/92/105` (`persona_stats:116`)
**Data:** `personas` table.

### Persona ingest ✅
**Entry:** `openreply_persona_ingest` · CLI `persona ingest`
**Flow:** reads candidate posts for a topic (or all), filters by the persona's lens, LLM-distils lessons, idempotently skips already-processed posts.
**Implementation:** `persona_tools.py:164` · `persona/ingest.py:251` (`ingest_persona`) · fan-out `ingest_all_personas:393`
**Data:** `persona_memories`.

### Persona memories — read ✅
**Entry:** `openreply_persona_memories` · CLI `persona memories`
**Implementation:** `persona_tools.py:145` · `persona/store.py:146` (`list_memories`)
**Data:** reads `persona_memories`.

### Topic Agents overlay (UI) ✅
**Entry:** topic view → **Agents** tab (`screens/topic.js` tab `agents`).
**Flow:** lists personas, pulls each one's topic-scoped memories in parallel, then conclusions + rejections for agents that learned the topic; shows lessons (cited to posts, with importance bar), distilled beliefs (confidence), and cross-agent divergences. "Learn this topic" teaches an agent the topic's posts via `personaIngest`.
**Implementation:** `app-tauri/src/screens/agentsTab.js` (`loadAgents`) · reuses `api.personaList` / `personaMemories({topic})` / `personaConclusions` / `personaRejections` / `personaIngest`. FSD Fleet Phase 2; spec `docs/specs/FLEET_AGENTS_TOPIC_MAP.md`.
**Data:** reads `personas`, `persona_memories`, `persona_conclusions`, `persona_rejections`.

### Persona chat ✅
**Entry:** `openreply_persona_chat` · CLI `persona chat`
**Flow:** retrieves the persona's top-k memories for the question, answers from those only, cites `(M#)` memory ids — says so when its memories don't cover the question.
**Implementation:** `persona_tools.py:195` · `persona/chat.py:184` (`chat_persona`)
**Data:** reads `persona_memories`.

### Persona conclusions ✅
**Entry:** `openreply_persona_conclusions_build` / `_get` · CLI `persona conclude|conclusions`
**Flow:** clusters memories by semantic similarity, one LLM call per cluster → a generalised belief + confidence score.
**Implementation:** `persona_tools.py:218/245` · `persona/conclude.py:143` (`synthesize_conclusions`) / `:282` (`list_conclusions`)
**Data:** `persona_conclusions`. Consumed by the deliberation engine (category 4).

### Persona memory graph ✅
**Entry:** `openreply_persona_graph` / `openreply_persona_graph_backfill` · CLI `persona graph|backfill`
**Flow:** memory→memory similarity graph built from lesson embeddings; backfill re-embeds every memory and rebuilds all edges.
**Implementation:** `persona_tools.py:263/279` · `persona/graph.py:259` (`graph_payload`) · `:197` (`backfill_persona`) · `:101` (`build_edges_for_memory`)
**Data:** `persona_edges`.

### Teach from YouTube ✅
**Entry:** `openreply_persona_teach_youtube` · CLI `persona teach-video`
**Flow:** fetches a video's description + transcript + top comments → runs the persona's distillation over them. Accepts a full URL or 11-char id.
**Implementation:** `persona_tools.py:293` · `persona/teach.py:64` (`teach_from_youtube`) · `:45` (`parse_youtube_id`)
**Data:** `persona_memories`.

### Peer learning (persona-of-personas) ✅
**Entry:** `openreply_persona_ingest_peers` · CLI `persona ingest-peers`
**Flow:** reads every other active persona's conclusions and distils them through this persona's lens → meta-insight memories.
**Implementation:** `persona_tools.py:326` · `persona/ingest.py:425` (`ingest_from_peers`)
**Data:** `persona_memories` (source id `peer:<conclusion_id>`).

### Cross-persona sharing ✅
**Entry:** `openreply_persona_share` / `openreply_persona_rejections` · CLI `persona share|rejections`
**Flow:** re-frames one persona's memory through another's lens; if it contradicts the receiver's lens the share is rejected and logged.
**Implementation:** `persona_tools.py:355/376` · `persona/share.py:109` (`share_memory`) · `:77` (`list_rejections`)
**Data:** `persona_memories`, `persona_edges`, rejection log.

**Known gaps:** no automated test coverage for the `persona/` module (P2 — `tests/` has no `*persona*` file).

---

## 8. Paper research pipeline ✅

### Multi-source paper search ✅
**Entry:** `openreply_research_papers`
**Flow:** searches 6 academic sources in parallel, dedupes, ranks by citation count.
**Implementation:** `server.py:912` · `research/paper_pipeline.py`
**Data:** `posts` (6 academic source_types), `topic_posts`.

### Full paper research pipeline ✅
**Entry:** `openreply_paper_research_pipeline`
**Flow:** one call — search → rank → fetch fulltext → analyze → store. Primary entry point for paper work (added 2026-05-16).
**Implementation:** `server.py:1731` · `research/paper_pipeline.py:109`
**Data:** `posts`, `paper_full_texts`, `paper_analyses`.

### Build Knowledge & Write Paper workflow ✅
**Entry points:** Papers tab → "Build Knowledge base" panel · `openreply research paper-knowledge --stream` · Tauri `paper_knowledge_build`
**User flow:** one button runs full text (all papers) → summarize each → relations → detect patterns & gaps → synthesize insights, with a live 5-stage stepper; then Generate-draft / Export buttons produce a paper grounded in the corpus + gaps.
**Implementation:** `research/paper_workflow.py` (`build_paper_knowledge`) · CLI `cli/main.py` (`paper-knowledge`) · `commands.rs` (`paper_knowledge_build`, streaming) · `app-tauri/src/screens/papers.js` (`wirePaperKnowledge`, `renderKnowledgePanel`)
**Data:** writes `paper_full_texts`, `paper_analyses`, `graph_edges` (paper_*), `paper_gaps`, `topic_insights`. Resumable (skips cached work); `scope` ∈ all|top50|top25|abstracts.
**Validated:** OCR topic (180 papers) end-to-end, `workflow:done` ok.

### Paper pattern & gap detection ✅
**Entry points:** part of the workflow above · `openreply research paper-gaps --topic … [--detect]` · Tauri `paper_gaps_list`
**User flow:** detects + persists four gap kinds (understudied intersection, contradiction, temporal, method/replication), each cited to evidence papers; shown as a gaps panel on the Papers tab and folded into the draft prompt as the paper's positioning.
**Implementation:** `research/paper_gaps.py` (`detect_gaps` / `list_gaps`) — deterministic temporal + one consolidated LLM pass; `research/paper_pipeline.py` draft prompt gaps block.
**Data:** `paper_gaps` (previously empty table — now populated).

### Academic Mode — multi-agent grounded, cited research brief ✅ NEW
**Entry points:** Topic → **Academic** tab (Run button + level/format controls, live timeline, verdict chips) · `openreply research academic --topic … [--level/--approved/--stream]` · `openreply research academic-passport` · MCP `openreply_academic_brief` / `openreply_academic_brief_get` / `openreply_academic_passport` · Tauri `academic_brief_run(_stream)` / `academic_brief_get` / `academic_passport_get`
**User flow:** one run chains research → synthesize → **grounding gate** → **peer-review panel** → finalize → **integrity gate** → **citation gate** into a cited markdown brief, shown as a live staged timeline (7 stages) with a grounding-gate badge and a verdict-chips strip (⚖ editorial decision · 🛡 integrity verdict · 🔗 citations verified · 🧾 passport). Export emits md/docx/pdf. Governance: L1 suggest · L2 gated (pause-for-approval) · L3 auto. Citations are restricted to committed academic papers; **finalize hard-blocks when fewer than 2 are grounded**; a **blocking integrity finding flags the brief (`gate_status=blocked`)** while citation misses are advisory. Panel dissent, blocking integrity findings, and unresolved citations all fold into an "Acknowledged Limitations" section. Every stage appends a SHA-256 hash-chained Material Passport entry.
**Implementation:** `research/academic_mode.py` (`run_academic_brief` / `get_academic_brief`, orchestrates the four agent modules) · `research/academic_review.py` (5-reviewer panel) · `research/academic_integrity.py` (7-mode AI-failure checklist) · `research/academic_citations.py` (deterministic DOI verification via `sources/crossref.py`) · `research/academic_passport.py` (append-only hash-chained ledger) · `core/db.py` (`academic_briefs` +`review_decision`/`integrity_verdict`/`citations_verified`, `academic_passport` table) · CLI `cli/main.py` (`academic`, `academic-get`, `academic-passport`) · `mcp/server.py` · `commands.rs` (`academic_brief_run`, `_stream`, `_get`, `academic_passport_get`) · `app-tauri/src/screens/academic.js`
**Data:** `academic_briefs` (+3 columns) + new append-only `academic_passport` table; reuses `checks_ledger` + `lineage` (one gate/lineage row per stage); citations reference committed `posts`.
**Known gaps:** P2 — bundled (DMG) sidecar needs a rebuild to expose the upgraded `research academic`/`academic-passport` CLI commands (dev works via the `.venv` bypass). Panel/integrity gates degrade fail-soft to deterministic fallbacks when no LLM key is configured. Deferred: multi-index (OpenAlex/S2) citation verification beyond Crossref/arXiv, bilingual abstracts, citation-format conversion at export.

| Feature | Status | MCP tool `server.py` | Implementation | Data |
|---|---|---|---|---|
| Papers for topic (cached read) | ✅ | `openreply_papers_for_topic:1890` | `research/paper_analyze.py:275` | reads `posts`+`paper_analyses` |
| Fetch fulltext PDF | ✅ | `openreply_paper_fulltext:1013` | `research/paper_fulltext.py:294` (`get_full_text`) | `paper_full_texts` |
| Fulltext status report | ✅ | `openreply_paper_fulltext_status:1048` | `research/paper_fulltext.py:577` | reads `paper_full_texts` |
| Parse paper sections | ✅ | `openreply_paper_sections:1060` | `research/paper_sections.py:173` | `paper_sections` |
| Get section text | ✅ | `openreply_paper_section_get:1077` | `research/paper_sections.py:258` | reads `paper_sections` |
| Chunk paper | ✅ | `openreply_paper_chunk:1098` | `research/paper_chunks.py:128` | `paper_chunks` + Mempalace |
| Bulk chunk topic | ✅ | `openreply_paper_chunk_topic:1165` | `research/paper_chunks.py:257` | `paper_chunks` |
| Chunk search (semantic+BM25) | ✅ | `openreply_paper_chunk_search:1114` | `research/paper_chunks.py` | vector search |
| Paper search (chunk rollup) | ✅ | `openreply_paper_search_papers:1138` | `research/paper_chunks.py` | vector search |
| Paper chunks stats | ✅ | `openreply_paper_chunks_stats:1233` | `research/paper_chunks.py` | diagnostic |
| Paper citations (forward) | ✅ | `openreply_paper_citations:864` | `sources/semantic_scholar.py:141` · `research/paper_references.py` | `posts` |
| Paper references (backward) | ✅ | `openreply_paper_references:874` | `sources/semantic_scholar.py:179` | `posts` |
| Extract refs from local PDF | ✅ | `openreply_paper_extract_refs:1181` | `research/paper_references.py:157` | `paper_references` |
| Local refs (corpus match) | ✅ | `openreply_paper_local_refs:1208` | `research/paper_references.py:314` | reads `paper_references` |
| Cited-by (corpus only) | ✅ | `openreply_paper_cited_by:1223` | `research/paper_references.py:326` | reads `paper_references` |
| Analyze paper (single) | ✅ | `openreply_analyze_paper:1242` | `research/paper_analyze.py:122` | `paper_analyses` |
| Analyze papers (bulk) | ✅ | `openreply_analyze_papers_bulk:1285` | `research/paper_analyze.py:189` | `paper_analyses` |
| Paper analyses list | ✅ | `openreply_paper_analyses:1323` | `research/paper_analyze.py:275` | reads `paper_analyses` |
| Generate paper outline | ✅ | `openreply_paper_outline_generate:1419` | `research/paper_pipeline.py:37` | `mcp_analyses` |
| Generate paper draft (IMRaD) | ✅ | `openreply_paper_draft_generate:1426` | `research/paper_pipeline.py:109` | `mcp_analyses` |
| Export with citations | ✅ | `openreply_paper_export_with_citations:1449` | `research/paper_pipeline.py:178` · `research/paper_export.py` | markdown |
| Open-access lookup (Unpaywall) | ✅ | `openreply_oa_lookup:1557` | `sources/unpaywall.py:27` (`lookup_doi`) | reads OA status |
| Papers export (BibTeX/RIS/APA/MD) | ✅ | `openreply_papers_export:1544` | `research/paper_export.py:82/116/144/178` | citation-format output |

**Known gaps:** none. (Fulltext download is best-effort — `paper_full_texts.status` records `not_oa` / `download_failed` / `parse_failed` per the upstream PDF availability; that is expected behaviour, not a defect.)

---

## 9. Product tracking ✅

| Feature | Status | MCP tool `server.py` | Implementation | Data |
|---|---|---|---|---|
| Create product | ✅ | `openreply_product_create:2764` | `research/product.py:48` (`create_product`) | `products` |
| List products | ✅ | `openreply_product_list:2780` | `research/product.py:113` | reads `products` |
| Convert topic → product | ✅ | `openreply_product_convert_topic:2859` | `research/product_sweep.py` | `products` |
| Product sweep (daily scan) | ✅ | `openreply_product_sweep:2786` | `research/product_sweep.py:149` (`run_product_sweep`) | `product_signals`, `sweeps` |
| Product signals (list) | ✅ | `openreply_product_signals:2799` | `research/product_sweep.py:237` (`list_signals`) | reads `product_signals` |
| Signal action (dismiss/snooze/hypothesis) | ✅ | `openreply_product_signal_action:2814` | `research/product_sweep.py:274` (`signal_action`) | `product_signals`, `hypothesis_tests` |
| Product dashboard | ✅ | `openreply_product_dashboard:2827` | `research/product_sweep.py` | reads products/signals/sweeps |
| Product digest (weekly markdown) | ✅ | `openreply_product_digest:2852` | `research/product_digest.py:48` (`build_digest`) | markdown output |
| Signal generators (6 detectors) | ✅ | (used inside sweep) | `research/signals.py:74/100/121/142/165/192` | `product_signals` |

**Known gaps:** none.

---

## 10. Audience & competitors ✅

### Build audience personas (citation-grounded) ✅
**Entry:** `openreply_audience_personas` · Tauri *Personas* screen
**Flow:** clusters the topic's real post authors into ICP personas backed by exemplar posts; optional LLM augmentation adds label, narrative, demographics, personal-memory bullets.
**Implementation:** `server.py:2145` · `research/audience.py:278` (`build_audience_personas`) · clustering `research/_clustering.py:130` (`kmeans_with_silhouette`)
**Data:** `audience_personas` (members, exemplar_post_id, vocab signatures, 7×24 activity heatmap, silhouette tightness, llm fields).

### Get audience personas (cached) ✅
**Entry:** `openreply_audience_personas_get`
**Implementation:** `server.py:2184` · `research/audience.py:513` (`get_audience_personas`)
**Data:** reads `audience_personas`.

### Global competitors (cross-topic unification) ✅
**Entry:** `openreply_global_competitors`
**Flow:** unifies competitor mentions across all topics via embedding cosine clustering.
**Implementation:** `server.py:2606` · `research/competitors.py:217` (`global_competitors`) · `research/cross_topic.py:47`
**Data:** computed from `graph_nodes`.

**Known gaps:** none on the data side; the Tauri *Personas* / *Global Competitors* screens need UI polish (category 15).

---

## 11. Export & documentation ✅

| Feature | Status | MCP tool `server.py` | Implementation | Output |
|---|---|---|---|---|
| Doc design prompt | ✅ | `openreply_doc_design_prompt:2998` | `research/export_deck.py:1201` (`get_design_system_prompt`) | prompt + schema |
| Plan doc layout | ✅ | `openreply_plan_doc_layout:3019` | `research/export_deck.py:260` (`plan_layout`) | layout-plan JSON |
| Render planned DOCX | ✅ | `openreply_render_planned_docx:3044` | `research/export_deck.py:578` (`render_planned_docx`) | `.docx` |
| Export DOCX (direct brief) | ✅ | `openreply_export_docx:2935` | `research/export_deck.py:631` (`build_docx`) · `research/text_report.py:72` | `.docx` |
| Export PPTX (pitch deck) | ✅ | `openreply_export_pptx:2967` | `research/export_deck.py:751` (`build_pptx`) | `.pptx` |
| Export DOCX from markdown | ✅ | `openreply_export_docx_from_markdown:3085` | `research/export_deck.py:920` (`build_docx_from_markdown`) | `.docx` |
| Export PDF from markdown | ✅ | `openreply_export_pdf_from_markdown:3055` | `research/text_report.py` (xeLaTeX + Lua filter) | `.pdf` |
| Launch brief (go-to-market) | ✅ | `openreply_launch_brief:2196` / `openreply_launch_brief_get:2240` | `research/launch.py:463` (`build_launch_brief`) / `:590` | `launch_briefs` table |

**Known gaps:** none.

---

## 12. MCP server & jobs queue ✅

| Feature | Status | MCP tool `server.py` | Implementation | Data |
|---|---|---|---|---|
| Diagnostics (health probe) | ✅ | `openreply_diagnostics:2253` | `research/monitor.py` | diagnostic |
| Submit job (async) | ✅ | `openreply_jobs_submit:2435` | `research/jobs.py` | `jobs` |
| Get job (poll) | ✅ | `openreply_jobs_get:2461` | `research/jobs.py` | reads `jobs` |
| List jobs | ✅ | `openreply_jobs_list:2478` | `research/jobs.py` | reads `jobs` |
| Cancel job | ✅ | `openreply_jobs_cancel:2498` | `research/jobs.py` | `jobs` (state) |
| Sub-server composition | ✅ | `server.py:3441` (`mcp.mount`) | `mcp/tools/persona_tools.py` | — |

**Architecture note:** the server exposes **120 `openreply_*` tools** defined in `mcp/server.py`, plus the `openreply_persona_*` tools from the mounted persona sub-server (`mcp/tools/persona_tools.py`). New domains should get their own sub-server file under `mcp/tools/` and a `mcp.mount()` call — the pattern established 2026-05-17.
**Known gaps:** none.

---

## 13. CLI ✅

**Status:** ✅
**Entry:** `openreply` (Typer app, `src/openreply/cli/main.py`)
**Surface:** sub-apps registered in `main.py` — `fetch`, `analyze`, `mcp`, `auth`, `research` (with nested `graph`), `ingest`, `whisper`, `ytdlp`, and `persona` (registered 2026-05-17 at `cli/main.py:4795`). Every command supports `--json` for machine output consumed by the Tauri sidecar.
**Implementation:** `cli/main.py` · `cli/persona_cmds.py` (14 persona commands)
**Known gaps:** none. (Before 2026-05-17 the `persona` command group was defined but not registered — fixed.)

---

## 14. Advanced analysis modules ✅

Every module now has its surfacing complete — a Tauri screen and/or an MCP tool. The 8 frameworks finished via the screen-completion workflow (OST/PMF/Pricing/PRD/Empathy/Intents/Iterate/Interviews + the Prioritize tab for RICE/Kano/MoSCoW), and the last 6 finished this pass: **Idea scan + PERT** (MCP tools), **Why root-cause + Tactics** (new module+screen+wiring), **Sentiment-by-source** (charts), **Hypothesis tracker** (dedicated screen). A few still lack an MCP tool (Tauri-only) — noted per row — but none are half-done.

| Module | Purpose | Implementation | Status | Gap |
|---|---|---|---|---|
| **Idea scan** | Multi-topic adjacency sweep + synthesis | `research/idea_scan.py:254` (`start_scan`) · MCP `openreply_idea_scan_start/get/list` | ✅ NEW | MCP tools added (start under timeout guard + jobs fallback) |
| **OST** | Opportunity-Solution Tree, experiment cards | `research/ost.py` · `ost.js` | ✅ NEW | tree + orphan/unlinked experiments + severity rendered; no MCP tool |
| **Kano** | Kano feature classification | `research/kano.py` · **Prioritize tab** | ✅ NEW | surfaced in Prioritize tab (`prioritize.js`); no MCP tool |
| **MoSCoW** | MoSCoW prioritisation | `research/moscow.py` · **Prioritize tab** | ✅ NEW | surfaced in Prioritize tab; no MCP tool |
| **RICE** | RICE scoring of opportunities | `research/rice.py` · `research/prioritize.py` · **Prioritize tab** | ✅ NEW | ranked opportunity list w/ Kano+MoSCoW chips; no MCP tool |
| **PMF** | Product-market-fit survey scoring | `research/pmf.py` · `pmf.js` | ✅ NEW | screen completed (n_scored denominator + persona buckets + responses); no MCP tool |
| **Pricing** | Van Westendorp / NPS / MaxDiff | `research/pricing.py` · `pricing.js` | ✅ NEW | screen completed (VW acceptable-range + per-instrument response tables); no MCP tool |
| **PRD generator** | LLM PRD draft | `research/prd.py` · `prd.js` | ✅ NEW | screen completed (sparse-state guidance + Copy/Download in all states); no MCP tool |
| **Empathy map** | Jobs-to-be-done extraction | `research/empathy.py` · `empathy.js` | ✅ NEW | screen completed (JTBD grid + persona switcher + XSS fix); no MCP tool |
| **Why (root-cause / 5-Whys)** | 5-Whys cascade on top painpoints → root cause | `research/root_cause.py` (`root_cause_get/_compute`) · `root_cause.js` → **Root Cause** tab | ✅ NEW | new module+screen+CLI(`research root-cause`)+Rust+api+tab; no MCP tool |
| **Sentiment by source** | Per-source sentiment distribution + charts | `research/sentiment_by_source.py:114` · `sentiment.js` (per-source comparison charts) | ✅ NEW | comparison charts added to the Sentiment screen |
| **Intents** | Awareness→decision intent ladder | `research/intents.py` · `intent_ladder.js` | ✅ NEW | screen completed (ladder + states + active-guard); no MCP tool |
| **Tactic library** | Curated tactics matched to the topic's painpoints | `research/tactic_library.py` (`tactics_for_topic`) · `tactics.js` → **Tactics** tab | ✅ NEW | topic view + CLI(`research tactics`)+Rust(`tactics_get`)+api+tab; no MCP tool |
| **Hypothesis tracker** | A/B hypothesis lifecycle | `research/hypothesis_tracker.py:45` · `hypotheses.js` → **Hypotheses** tab | ✅ NEW | dedicated screen (status pills + update/delete) on existing Rust+api surface |
| **Iterate** | Config-iteration experiment runs | `research/iterate.py` · `iterate.js` | ✅ NEW | screen completed (runs feed + empty-state + guard); no MCP tool |
| **Interviews** | User-interview store + summarise | `research/interviews.py` · `interviews.js` | ✅ NEW | screen completed (store + deterministic summary + guard); LLM digest + MCP still open |
| **PERT** | Task rollup / critical path | `research/pert.py:138` (`rollup`) · MCP `openreply_pert_list/add_task/rollup` | ✅ NEW | MCP tools added (three-point + McConnell rollup); screen exists (`estimate.js`) |
| Solutions / science | Solution synthesis per painpoint | `research/solutions.py:81` · `research/science.py:44` | ✅ | wired into pipeline |
| Concept extraction | Concept map per topic | `research/concept.py:258` | ✅ | wired into graph |
| Coverage / saturation | Corpus coverage metrics | `research/coverage.py:47` · `research/saturation.py:25` | ✅ | wired into clean-corpus |
| Cross-topic opportunities | Top opportunities across topics | `research/cross_topic.py:47` | ✅ | wired into competitors |

**Known gaps:** none half-done. P2 only: a few legacy Tauri-only modules (OST, Kano/MoSCoW/RICE, PMF, Pricing, PRD, Empathy, Intents, Iterate, Interviews) still lack their own MCP tool — most are reachable via the synthesis/pipeline tools.

---

## 15. Tauri desktop app ✅ (25/25)

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
| Map/Graph ✅ | node view + clickable-legend faceted filtering | done (click any kind to hide/show its nodes + edges, client-side) |
| Insights ✅ | synthesis + consensus deliberation tiers | done (collapsible Consensus section: tiers + scores + rationales) |
| Personas (audience) ✅ | clustering + heatmap + enriched cards | done (memory/conclusions/topics chips, active pill, latest-lesson preview) |
| Global Competitors ✅ | core unification + enriched cards | done (topic chips + cross-topic reach bar + mentions/topic) |
| OST ✅ | tree + orphan/unlinked + severity + Impact×Effort 2×2 matrix | done (RICE-scored interventions plotted in quadrants) |
| Intent Ladder ✅ | classification + ladder + states | done (cosmetic polish only) |
| Sentiment by Source ✅ | per-source comparison charts added | done |
| Tactics ✅ | matches seeded tactics to painpoints | done (corpus LLM-extraction of new tactics is a P2 enhancement) |
| Why (root-cause) ✅ | 5-Whys cascade screen + cards | done |
| Empathy (jobs) ✅ | JTBD grid + persona switcher | done |
| Iterate ✅ / Bets ✅ / Tasks ✅ / Activity ✅ | Iterate + Bets done (status strip, card parse, empty state); Tasks (runtime jobs) + Activity (fetch log) functional | done (Tasks/Activity are intentionally minimal admin screens) |

**Known gaps:** none. The sidecar binary is no longer committed (gitignored); `release.yml` rebuilds it fresh per release. Video ingest (`whisper`/`ytdlp` CLI sub-apps, `sources/video.py:125`) is 🔒 behind the `video` pyproject extra (opt-in, not a gap).

---

## 16. Customization & feedback ✅

| Feature | Status | MCP tool `server.py` | Implementation | Data |
|---|---|---|---|---|
| Record feedback (finding verdict) | ✅ | `openreply_feedback_record:2649` | `research/feedback.py:34` (`record_feedback`) | `feedback` |
| List feedback | ✅ | `openreply_feedback_list:2667` | `research/feedback.py:79` (`feedback_for_prompt`) | reads `feedback` |
| Create saved view | ✅ | `openreply_saved_view_create:2688` | `research/saved_views.py:50` (`create_view`) | `saved_views` |
| List saved views | ✅ | `openreply_saved_view_list:2705` | `research/saved_views.py:86` (`list_views`) | reads `saved_views` |
| List prompts | ✅ | `openreply_prompt_list:2712` | `research/prompt_store.py:128` (`list_prompts`) | reads `prompt_overrides` |
| Get prompt | ✅ | `openreply_prompt_get:2720` | `research/prompt_store.py:51` (`get_prompt`) | reads `prompt_overrides` |
| Set prompt (override) | ✅ | `openreply_prompt_set:2741` | `research/prompt_store.py:63` (`set_prompt`) | `prompt_overrides` |

Recorded feedback is fed back into synthesis prompts via `research/feedback.py:79` (`feedback_for_prompt`).
**Known gaps:** none.

---

## 18. Research & paper-writing assistant 🟡

Turns OpenReply into a tool for researchers / paper-writers / PDF-reading students:
ingest literature → **find novel cross-paper connections** → analyse → write
(outline → draft → cited export). ~80% reused the existing academic engine; see
`docs/RESEARCH-WRITER-PLAN.md`. The whole flow is driveable in-app **and**
headlessly via MCP.

| Feature | Status | Surface | Implementation |
|---|---|---|---|
| **Connect the Dots** — novel cross-paper connections ranked by novelty | ✅ NEW | **Connect Dots** tab · CLI `research connections` · MCP `openreply_connections` | `research/connections.py` (intersections + contradictions + method-repl + shared-but-uncited; persists `strategy_artifacts` kind `connections`) |
| Paper full-text RAG (download/extract/section/chunk + grounded chat) | ✅ | Papers/Chat tabs · MCP `openreply_paper_fulltext*` | `research/paper_fulltext.py`, `paper_sections.py`, `paper_chunks.py`, `chat/retrieval_context.py` |
| Cross-paper gaps (intersections / contradictions / method-replication) | ✅ | CLI `research paper-gaps` · MCP `openreply_paper_gaps` | `research/paper_gaps.py` |
| Paper↔paper relations (cites / relates_to / shared_finding / same_author) | ✅ | Paper map · CLI · MCP `openreply_paper_relations_build` | `research/paper_relations.py` |
| Build paper knowledge (one-shot pipeline) | ✅ | Papers tab "Build knowledge base" · MCP `openreply_paper_knowledge_build` | `research/paper_workflow.py` |
| Paper outline + IMRaD draft generation | ✅ | Papers tab "Generate paper draft" · MCP `openreply_paper_outline/draft_generate` | `research/paper_pipeline.py` |
| Citations export (BibTeX / RIS / APA / Markdown) | ✅ | Papers tab export buttons · CLI `papers-export` · api `papersExport` | `research/paper_export.py` (`to_bibtex/to_ris/to_apa/to_markdown`) |
| Student "drop PDF → cited Q&A" lightweight surface | 🟡 | — | planned (R4); chat + RAG + PDF ingest exist, needs a topic-optional entry screen |

Headless chain: `openreply_paper_knowledge_build` → `openreply_paper_relations_build` →
`openreply_connections` → `openreply_paper_outline_generate` → `openreply_paper_draft_generate`
→ `papers_export`. **Known gaps:** P2: MLA + LaTeX `.tex`+`.bib` export,
community-bridge connection detection.

---

## Data persistence summary

**SQLite (`core/db.py`)** — `posts`, `comments`, `users`, `subreddits`, `topic_posts`, `topic_prefs`, `topic_insights`, `mcp_analyses`, `graph_nodes`, `graph_edges`, `personas`, `persona_memories`, `persona_conclusions`, `persona_edges`, `paper_full_texts`, `paper_sections`, `paper_chunks`, `paper_analyses`, `paper_references`, `finding_research_links`, `jobs`, `feedback`, `saved_views`, `prompt_overrides`, plus the OpenReply reply/content tables (`reply_opportunities`, `reply_drafts`, `content_items`, `geo_queries`, `geo_checks`, `reply_feedback`, `reply_notify`, `source_credentials`).

**Vector index (Mempalace / ChromaDB, ONNX MiniLM)** — `posts` collection (semantic search) and `paper_chunks` collection (RAG over paper sections). Cache at `~/.cache/mempalace/`.

**Config** — `~/.config/openreply/.env` (BYOK provider/keys).

---

## Known gaps rollup

| Severity | Gap | Location |
|---|---|---|
| ✅ resolved | Sidecar binary staleness — the binary is no longer committed (gitignored); `release.yml` rebuilds it fresh per release, local dev rebuilds via `pyinstaller openreply-cli.spec` | `app-tauri/src-tauri/binaries/` |
| ✅ resolved | Developer ID cert + notarization — v0.1.21 ships **signed + notarized** via CI | `.github/workflows/release-mac.yml` |
| **deferred** | Auto-update not configured (users manually download `.dmg`) | `docs/manual-todo/` |
| ✅ resolved | **Advanced-analysis completion punch-list — DONE.** All 14 cat-14 🟡 now ✅: RICE/Kano/MoSCoW (Prioritize tab) · OST/PMF/Pricing/PRD/Empathy/Intents/Iterate/Interviews (screen-completion workflow) · **Why root-cause** (new `root_cause` module+screen+tab) · **Sentiment-by-source** (charts) · **Tactic library** (`tactics_for_topic`+screen) · **Hypothesis tracker** (dedicated screen) · **PERT + Idea-scan** (MCP tools). | category 14 |
| ✅ resolved | **All cat-15 Tauri screens done** — consensus tiers, OST 2×2 matrix, Global-Competitors detail, Personas enrichment, Bets polish, Map clickable-legend faceted filtering. cat-15 now 25/25. | category 15 |
| **P2** | New collect-only sources (Stack Exchange, Europe PMC, DBLP, Steam) lack their own MCP tool (reachable via `openreply_collect`) | category 1 |
| **P2** | No automated test coverage for the `persona/` module | `tests/` |
| **P2** | Deliberation tiers not rendered in the Tauri *Insights* screen | category 15 |
| **P2** | Bluesky / AlternativeTo 🟡 — Bluesky needs app-password; AlternativeTo Cloudflare-gated | category 1 |

### 🛠️ Completion roadmap (next, to drive each 🟡 → ✅)
- ✅ **Done this session:** Prioritize tab (RICE/Kano/MoSCoW) + screen-completion workflow (OST, PMF, Pricing, PRD, Empathy, Intents, Iterate, Interviews).
- ✅ **Remaining cat-14 🟡 — DONE:** Why root-cause, Sentiment-by-source charts, Tactic library, Hypothesis-tracker screen, PERT + Idea-scan MCP.
- **R4 — student PDF surface (category 18 🟡):** a topic-optional "drop a PDF → cited Q&A" entry screen on top of the existing chat + RAG + ingest.
- **Cross-cutting:** expose cat-14 modules + new sources as MCP tools so Claude Code drives the whole funnel headlessly; add persona tests.

---

## 21. OpenReply — content, analytics & visibility ✅ NEW

> OpenReply is the social engagement layer built on the same Python core: an
> **Agent** (brand/niche persona with linked-persona knowledge blend) finds
> Reddit/HN reply opportunities AND generates publishable content from its live
> niche knowledge. This category covers the **content composer** specifically
> (the Compose + Queue screens and the `content_*` command triangle). Adjacent
> OpenReply screens (Agents, Connections, Keywords, Subreddit Intelligence, GEO,
> Alerts, Activation) are wired in `or/dynamic.js` but not yet individually
> catalogued here. **Opportunities** is catalogued below.

### Opportunities (discovery) + Inbox (reply workspace) ✅ NEW (2026-06-27)
**Status:** ✅ Complete — full discover → triage → draft → approve → post flow
**Entry points:** Tauri *Opportunities* + *Inbox* screens · CLI `openreply reply
find/list/draft/save-draft/drafts/approve/queue/snooze/set-status` · Rust
`reply_find/list/draft/save_draft/drafts/approve/queue/snooze/set_status`.
**User flow:**
- **Opportunities = discovery triage.** Find → engine scans the agent's platforms
  (Reddit live + connected social) → engagement-weighted RRF scoring → ranked cards.
  Per card: **☆ Save** (→ Inbox) · **⏰ Snooze** (3h/1d/3d/1w; auto-resurfaces) ·
  **✕ Skip**. Text search · sort (score/recent/engagement) · min-score filter ·
  New/Snoozed/Dismissed/All · bulk select + bulk Save/Skip · Load-more · skeleton/
  empty/error states.
- **Inbox = reply workspace.** Tabs **Saved · Drafting · Ready · Posted**. Per card,
  a lazy draft editor: generate → **edit → 💾 Save (versioned, gap #1)** → **✓ Approve**
  (→ ready) → **📅 Queue** (schedule; auto-post where creds exist, else remind) or
  **✓ Mark posted** (manual-assisted with **📋 Copy** + **Open thread ↗**). Compliance
  badge (Reddit rules + platform length/link/hashtag), draft-version history,
  search/sort/paginate, states.
**Lifecycle:** `new →(Save) saved →(Draft) drafted →(Approve) ready →(Queue) queued
→(post) posted`; `→(Skip) skipped`; `→(Snooze) snoozed →(elapsed) new`.
**Implementation:** `reply/opportunity.py` (`find_opportunities`, `set_status`,
`snooze`/`approve`/`queue`/`mark_posted`, `_resurface_snoozed`, `list_opportunities`
w/ query/sort/offset, `count_opportunities`) · `reply/generate.py` (`save_draft`,
`_persist_draft`, `_platform_compliance`, `list_drafts`/`current_draft`) ·
`reply/rank.py` (RRF) · `cli/reply_cmds.py` · `src-tauri/src/commands.rs` (+`main.rs`
register) · `or/api.js` · `or/dynamic.js` (`renderOpportunities`, `renderInbox`;
shared `platformBadge`/`statusPill`/`skeleton`/`debounce`).
**Data:** `reply_opportunities` (status ∈ new/saved/drafted/ready/queued/posted/
skipped/snoozed; + `snooze_until`/`scheduled_at`/`posted_at`/`updated_at`) ·
`reply_drafts` (+ `version`/`source`/`updated_at` — full draft history).
**Known gaps:** Social opportunities surface only what's been collected/connected
(see §1.8 social fetch).

### Scheduled auto-flow (find → learn → post → GEO) ✅ NEW (2026-06-27)
**Status:** ✅ Complete (auto-find + learn + reminder/best-effort-post + GEO refresh)
**Entry points:** Settings → **Automation** (Off/Daily/Weekly — one control wires the
launchd schedule AND the agent cadence) · launchd `schedule.rs` → `research schedule-tick`.
**Per-tick flow:** ① **auto-find** new opportunities on the agent's `refresh_cadence`
(`reply/opportunity.find_if_due` — off/manual skip, daily ~20h, weekly ~6.5d, throttled
via `last_refresh_at`) → ② **learn** → ③ **post due** queued replies (poster, below) →
④ **refresh AI-visibility** (`reply/geo.check_all_if_due`, throttled ~daily). All
best-effort; `opps_found`/`replies_due`/`geo_checked` in the tick result.
**Implementation:** `reply/opportunity.find_if_due` + `_CADENCE_HOURS` · `reply/geo.
check_all_if_due` + `due_for_scheduled_check` · `cli/main.py schedule-tick` ·
`or/dynamic.js buildAutomationCard` (drives `agentUpdate({cadence})` + last-scan status).
**Cost-safe:** auto-find/GEO are opt-in (default cadence `off`) and throttled, so a fast
launchd interval never re-runs more than the cadence allows.

#### Scheduled poster + reminder ✅
**Status:** ✅ Complete (reminder + best-effort auto-post hook)
**Entry points:** the launchd scheduler (`schedule.rs` → `research
schedule-tick`) · CLI `openreply reply post-due [--notify]` · Rust `reply_post_due` ·
Inbox on-open + "Due now" badge.
**Flow:** a queued reply (status `queued` + `scheduled_at`) becomes due → the poster
(`reply/poster.py process_due`) tries `_autopost` (Reddit write hook — no-op while the
client is read-only) and otherwise surfaces a **reminder**: a native macOS notification
when run headless via launchd, plus a **"Due now"** badge in the Inbox Ready tab. The
Inbox also calls `reply post-due` on open so due items are processed in-app.
**Implementation:** `reply/poster.py` (`process_due`, `due_opportunities`, `_autopost`,
`_notify`) · `cli/reply_cmds.py` (`post-due`) · `cli/main.py` (wired into
`schedule-tick`, `replies_due` in result) · `commands.rs`/`main.rs` (`reply_post_due`) ·
`or/api.js` (`replyPostDue`) · `or/dynamic.js renderInbox` ("Due now" + on-open process).
**Known gaps:** auto-post is a hook only — Reddit/social *write* APIs aren't wired
(read-only clients). With a write-enabled Reddit account (OAuth refresh token),
`_autopost`'s Reddit branch is where `submission.reply` goes. Notifications are macOS-only.

### Connections (Reach credentials) — list + live test ✅ (2026-06-27: Test-all)
**Status:** ✅ Complete
**Entry points:** Connections screen · CLI `openreply` creds_* · Rust `creds_*`.
**Flow:** sources from the `GATED` registry (`research/reach_connections.py`); each card
shows connected/error state, **last-verified** time, and **"unlocks"** chips. Per-source
**Verify** and a header **Test all** run the genuine `verify_connection` (a live fetch
per source). Connect via browser-cookie import, paste cookie, API key, or login-pair.
**Implementation:** `research/reach_connections.py` (`list_connections`, `verify_connection`,
`_live_check`) · `core/credentials.py` · `commands.rs` creds_* · `or/dynamic.js
renderConnections` (`testAll`).

### Self-learning loop — autonomous evolution ✅ NEW (2026-06-27)
**Status:** ✅ Complete (wiring + feedback + UI; LLM-distillation paths inherited from
the mature persona subsystem)
**Entry points:** Tauri *Learning* screen + Overview "Learn" / "Refresh + learn" · CLI
`openreply agent learn` / `agent learn-status` · auto on `agent refresh` + `schedule-tick`.
**Loop:** collect → `ingest_persona` (LLM-distill posts → memories with `evolves_from`
lineage) → `embed_and_link` (automatic ChromaDB semantic edges) → `synthesize_conclusions`
(cluster → beliefs) → `build_knowledge_context` (blend into replies/content). Closed by a
**feedback loop**: Saved/Replied opportunities seed the learning corpus; Dismissed ones are
suppressed from future finds.
**Triggers (all three):** after every agent fetch (`reply/agent.refresh_agent`), on schedule
(`cli schedule-tick` → matching agents), and manual (`reply/learn.learn_for_agent`).
**Implementation:** `reply/learn.py` (`ensure_learning_persona`, `learn_for_agent`,
`learning_summary`) · `reply/feedback.py` + `reply_feedback` table · `persona/{ingest,graph,
conclude}.py` (existing engine) · hooks in `reply/opportunity.py` · `cli/agent_cmds.py` +
`cli/main.py` · `commands.rs`/`main.rs` (`agent_learn`/`agent_learn_status`) ·
`or/dynamic.js::renderLearning` + Overview · `or/shell.js` nav.
**Data:** `persona_memories` / `persona_edges` / `persona_conclusions` / `reply_feedback` ·
`agents.last_learn_at`.
**Known gaps:** auto-learn LLM cost capped (`ingest_limit=30`, dedup, synthesize-on-new-only);
dismissed suppression is exact post_id (semantic similarity is P2); no memory decay /
re-embedding yet.

### Content generation — 7 structured kinds ✅ NEW
**Status:** ✅ Complete — verified end-to-end (real LLM output for every kind)
**Entry points:** Tauri *Compose* screen · CLI `openreply content generate <kind>` · Rust `content_generate`
**User flow:** pick a kind → (Follow-up: choose Reply/Sequence sub-mode + give
context) → optional platform + angle → Generate → the engine blends the agent's
voice + linked-persona knowledge + topic corpus → a structured draft persists to
`content_items` and renders editable → Save / Schedule.
**Kinds & structure:**
- `post` · `thread` — single post / 5–8 numbered parts
- `article` — `# Title` · 2-sent intro · 3 `## sections` · `**Takeaway:**` (600–900w)
- `script` — Short (Reels/Shorts): HOOK + 3 BEATS + CTA (~120 spoken words)
- `youtube` — Long-form: HOOK · INTRO · 3–5 SEGMENTS w/ `[VISUAL: …]` cues · CTA · OUTRO
- `followup_reply` — answers a pasted conversation's latest reply
- `followup_post` — sequence/part-2 that builds on a prior draft (linked via `parent_id`)
**Implementation:** `reply/content.py` — `_KIND_SPECS:21` · `generate_content:131`
· `_load_original:122` · `_PLATFORM_HINTS:71` (per-platform length/format) ·
dynamic `max_tokens` per kind. CLI `cli/agent_cmds.py` `gen_cmd:160`
(`--context-id`/`--context-text`). Rust `commands.rs` `content_generate:377`.
Frontend `or/api.js` `contentGenerate:42` → `or/dynamic.js` `renderCompose:228`
(kind buttons `KINDS:221`, follow-up Reply/Sequence panel, loading state).
**Data:** `content_items` SQLite (id, agent_id, kind, platform, parent_id, title,
body, status, scheduled_at, posted_at, angle, timestamps).
**Known gaps:** generation needs an active agent + configured LLM provider (BYOK/
Ollama); empty corpus falls back to a "run agent refresh" prompt rather than
blocking (P2). Non-Tauri prototype renders statically (calls return null).

### Edit / save / schedule drafts ✅ NEW
**Status:** ✅ Complete
**User flow:** any generated or recent-draft card is an editable textarea →
**Save draft** persists the edited body · **Schedule** flips status →
`scheduled` with an epoch `scheduled_at`. Status badges colour by state.
**Implementation:** `reply/content.py` `update_content:213` (body/status/
scheduled_at, validates status ∈ draft|scheduled|posted, stamps `posted_at`).
CLI `content_update_cmd:187`. Rust `content_update:396` (registered in
`main.rs` handler). Frontend `or/api.js` `contentUpdate:50` → delegated
Save/Schedule handler + `contentCard:346` in `or/dynamic.js`.
**Data:** mutates `content_items` in place; `parent_id` column added to existing
DBs via a guarded `add_column` migration in `_ensure` (`content.py:104`).
**Known gaps:** scheduling sets state only — there is no auto-publish yet
(publishing stays manual by design; outbound adapters are a later milestone).

### Queue — drafts & scheduled list ✅
**Status:** ✅ Complete
**User flow:** Queue screen lists all `content_items` (type · body preview ·
platform · status); "+ New content" → Compose.
**Implementation:** `or/dynamic.js` `renderQueue:829` → `api.contentList`
(`api.js:48`) → CLI `content_list_cmd:204` → `content.list_content`.
**Known gaps:** read-only table (edits happen on the Compose cards); no inline
status change from Queue yet (P2).

### Analytics — KPIs, trends & charts ✅ NEW
**Status:** ✅ Complete — server-side aggregation + inline-SVG charts
**Entry points:** Tauri *Analytics* screen · CLI `openreply reply analytics [--days]` · Rust `analytics_summary`
**User flow:** open Analytics → one aggregation call renders KPIs (opportunities,
replied, content, citation rate, saved/drafted/scheduled/posted), a 30-day
multi-series activity trend (opportunities · content · posted), content-by-type
bars, a draft→scheduled→posted funnel, and top-subreddit + by-keyword breakdowns.
**Implementation:** `reply/analytics.py` `analytics_summary` (KPIs · `_series`
daily buckets · `_top` drivers · geo citation rate). CLI `reply_cmds.py`
`analytics_cmd`. Rust `commands.rs` `analytics_summary`. Frontend `or/api.js`
`analyticsSummary` → `or/dynamic.js` `renderAnalytics` with `sparkChart` +
`barList` SVG helpers.
**Data:** read-only roll-up over `reply_opportunities` (`found_at`/`sub`/
`platform`/`status`) + `content_items` (`kind`/`status`/`created_at`/`posted_at`).
**Known gaps:** keyword breakdown is a substring match of agent keywords against
opportunity title/body (no per-opportunity keyword column) (P2); fixed 30-day
window in the UI (CLI takes `--days`).

### AI Visibility (GEO) — automated citation check ✅ NEW
**Status:** ✅ Complete — automated via BYOK provider (was manual-only)
**Entry points:** Tauri *AI Visibility* screen · CLI `openreply reply geo-check[-all]` · Rust `geo_check`
**User flow:** track a query (+ surface) → **Check** asks the configured BYOK
model the query as that surface would answer, captures the answer, and classifies
the brand as **cited** / **competitor** / **absent**; the card shows the captured
answer + competitor chips + "checked Nm ago". **Check all** re-runs every query;
manual "Mark cited" remains as an override.
**Implementation:** `reply/geo.py` `check_query` (LLM call · `_parse_json` ·
`_classify`) · `check_all` · `query_history`; `geo_checks` history table +
`answer`/`competitors` columns (guarded migration). CLI `reply_cmds.py`
`geo_check_cmd`/`geo_check_all_cmd`/`geo_history_cmd`. Rust `geo_check`/
`geo_check_all`/`geo_history`. Frontend `or/api.js` `geoCheck`/`geoCheckAll` →
`or/dynamic.js` `renderGeo`.
**Data:** `geo_queries` (status/answer/competitors/last_checked) + `geo_checks`
(per-check history for trend).
**Known gaps:** the check uses the BYOK model's own answer as a proxy — not the
live ChatGPT/Perplexity product with web browsing (P1, by design — real-surface
APIs are a paid later milestone); no scheduled auto-recheck (manual for now, P2).

### Unified Brain — graph + tree of all knowledge ✅ NEW
**Status:** ✅ Complete — merges the structural topic graph + every linked
persona's memory graph + beliefs into one connected, browsable brain.
**Entry points:** Tauri *Brain* screen (sidebar, `network` icon) · CLI
`openreply agent brain` / `agent brain-relink` · Rust `agent_brain`.
**User flow:** open Brain → see the merged **graph** (force-directed canvas;
nodes colored by kind belief/memory/painpoint/product/user/source/post, sized by
degree, drag + click-to-inspect, neighbor highlight, cross-links in purple) or
toggle to the **tree** (persona/lens → beliefs with confidence; structural
concepts by connections). **Rebuild** re-runs the merge.
**Implementation:** `reply/brain_unified.py` — `relink()` builds cross-links
(`grounds` shared-post, `concludes` belief→evidence, `about` MiniLM-ONNX
similarity) into new `brain_links`; `unified_brain()` returns
`{graph:{nodes,edges}, tree, stats}` with namespaced ids (`g:`/`m:`/`b:`). CLI
`agent_cmds.py` `brain_cmd`/`brain_relink_cmd`. Rust `agent_brain`/
`agent_brain_relink`. Frontend `or/api.js` `agentBrain`/`agentBrainRelink` →
`or/dynamic.js` `renderBrain` + `forceGraph` (dependency-free canvas sim).
**Data:** reads `graph_nodes`/`graph_edges` (topic) + `persona_memories`/
`persona_edges`/`persona_conclusions` (per linked persona) + persisted
`brain_links` cross-edges.
**Known gaps:** force layout is O(n²)/tick (node cap 400; needs Barnes-Hut for
thousands) (P2); exact `grounds` links depend on personas sharing the structural
graph's source posts — semantic `about` bridges otherwise (P2).

### Telegram + Slack notifications — two-way control ✅ NEW (2026-06-29)
**Status:** ✅ Complete — config + transport + dedup + two-way Telegram poller +
Settings UI, all verified via CLI roundtrip + frontend build. (Live send not
exercised against a real bot token/webhook.)
**Entry points:** Settings → **Notifications** card · CLI `openreply reply
notify-get` / `notify-set` / `notify-test` / `bot-poll [--once]` · Rust
`notify_get`/`notify_set`/`notify_test`/`bot_poll_once`.
**User flow:** open Settings → enter a Telegram bot token (@BotFather) + chat id
(@userinfobot) and/or a Slack incoming-webhook URL → pick which events to receive
(new opportunity / new drafted post / reply due, plus optional digest + AI-
visibility) → set a min opportunity-match floor → Save → "Send test" confirms each
channel. While the app window is open, alerts arrive as they happen; on Telegram,
opportunity and reply alerts carry **Approve/Draft · Regenerate · Skip** buttons
whose taps are handled live (the desktop polls `bot-poll --once` every 4s and
stops on window close — no server, no public webhook).
**Events & sources (existing event producers, new transport):**
- new opportunity → `reply/opportunity.py::_notify_new_opportunities` (gated by
  `events.opportunity` + `min_score`)
- new drafted post/article → `reply/scheduler.py::_notify_article` (autopilot loop)
- reply due → `reply/poster.py` reminder branch (`notify_once("reply:…")`)
**Implementation:** `reply/notify.py` (`reply_notify` config row, `get_config`/
`set_config` with masked secrets, `notify_once`/`was_notified`/`mark_notified`
dedup keyed `opp:`/`reply:`/`art:`, `send_telegram` inline-keyboard + `send_slack`
via stdlib `urllib`, formatters, `dispatch`, `send_test`) · `reply/bot.py`
(`poll(once)` — `getUpdates` callback_query handler for skip/posted/draft/regen,
SIGTERM/SIGINT + `bot.stop` sentinel) · `cli/reply_cmds.py` (notify-get/set/test,
bot-poll) · `commands.rs`/`main.rs` (4 commands) · `or/api.js`
(`notifyGet`/`notifySet`/`notifyTest`/`botPollOnce`) · `or/dynamic.js`
(`buildNotifyCard`, `ensureBotPoller`) · `main.js` (poller boot).
**Data:** `reply_notify` singleton (token/chat/webhook/event flags/min_score in
the local app-data SQLite — secrets never leave the machine, masked to last-4 in
the UI) · `reply_notified` dedup ledger · `bot.stop` sentinel file in data dir.
**Known gaps:** Slack is **notify-only** — its interactive buttons need a public
endpoint a local Mac can't host (P2). Two-way Telegram only works **while the app
window is open** (the poller is frontend-driven by design — "while running on the
PC") (P2). Live send not yet exercised against a real token/webhook in this build
(P1 — verify on first real configure). Headless launchd ticks fire one-way
notifications (no button handling) since the poller needs the open window (P2).

---

## Update protocol

When to update this file:
- A feature is shipped → flip the status emoji from 🚧 → ✅ (or 🟡 if known gaps remain)
- A bug is fixed → update or remove from "Known gaps"
- A file is moved/renamed → re-run `codegraph sync`, then `codegraph_search` for the symbol to find the new path
- A new feature is added → add a new section under the right category and bump the summary table

Re-run cadence: at least once before every desktop release / build that touches more than one feature.
