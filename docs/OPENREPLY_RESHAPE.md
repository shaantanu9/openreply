# OpenReply — Reshape Plan (Keep / Hide / Delete)

> The app is being converted from a market-research / gap-finding / academic tool into
> **OpenReply** — a social reply + content co-pilot built on Agents (personas). This is
> the authoritative, file-level plan for what stays, what gets hidden, and what gets
> deleted, across UI screens, backend modules, data sources, and DB tables.
>
> **Safety order:** HIDE in the nav first (done — reversible) → build the OpenReply
> screens → then physically DELETE dead code + drop tables behind a branch once nothing
> references them. Nothing is deleted by this doc.

---

## 0. Status

- ✅ **DB (additive):** Agent model shipped — `agents`, `content_items`, `reply_*`,
  `reply_state` tables. The reply engine is now agent-scoped. (Existing research tables
  untouched — the app still has its 194.6k-post corpus; drops happen in Phase 3.)
- ✅ **Nav trimmed:** 15 off-mission sidebar items hidden (`display:none`) in
  `app-tauri/index.html` — Products, Competitors, Ingest-Video, Reports, Provenance,
  Science, Playbook, OST, Empathy, Interviews, PMF, Pricing, Launch, Improve, Iterate.
- ✅ **UI port (done 2026-06-27):** OpenReply Tailwind+Lucide UI ported into the Tauri app;
  old research frontend (`src/screens`, `lib`, `components`, `style.css`) removed.
- ✅ **Backend cleanup (done 2026-06-27):** removed **96 research Python modules**
  (papers/academic/product/consultancy) — `research/` trimmed from 106 → 10 files
  (keep-set: collect, discover, gaps, prompts, prompt_store, quality_gate, relevance,
  topic_resolver, corpus_format, __init__). `graph/semantic.py` tactic import guarded.
  Verified: cli.main + mcp.server + reply/agent/content/discover/info all clean.
- ✅ **Engagement-weighted RRF ranking** added (`reply/rank.py`).
- ⏭️ **Deferred (lower priority / more coupled):** prune off-mission **source adapters**
  (academic/econ: arxiv/pubmed/openalex/worldbank/fred/gdelt/…) from `sources/` +
  `collect_adapter.SOURCES` + their MCP fetch tools; prune the now-inert research **CLI
  command stubs** from `cli/main.py` (their lazy imports already fail gracefully).

---

## 1. UI screens — Keep / Reframe / Hide / Delete

`app-tauri/src/screens/` — 85 files.

### ✅ KEEP (core to OpenReply)
| Screen | Role in OpenReply |
|---|---|
| `home.js` | → reframe to **Agents dashboard** (persona cards) |
| `topic.js` | → an **Agent workspace** (Knowledge Map + Sources + Chat tabs) |
| `collect.js`, `collects.js` | knowledge **refresh** stream + manager |
| `reachConnections.js`, `connections.js` (auth) | **Connections** — multi-platform login (essential) |
| `search.js` | find posts/conversations to reply to |
| `find.js` | semantic search over corpus (reply context) |
| `watch.js` | live stream of trending conversations |
| `chats.js`, `chat/` | AI chat (assist drafting) |
| `audience.js`, `audiences.js` | → **Reply personas / target accounts** |
| `personas.js`, `agentsTab.js` | → fold into the **Agent** concept |
| `ingest.js` | feed your own docs into agent knowledge |
| `settings.js`, `byok.js` | settings + BYOK keys (trim research toggles) |
| `welcome.js` | onboarding → rewrite to **Create-Agent** wizard |
| `activity.js`, `tasks.js`, `database.js` | infra/visibility |
| `sentiment.js`, `trends.js` | useful niche signal (keep, secondary) |
| `help.js`, `why.js`, `mergeModal.js` | utility |

### 🆕 ADD (new screens)
- `agents.js` — Agents dashboard (replaces topics list as home).
- `opportunities.js` — find → score → draft replies (UI over the shipped `reply` engine).
- `compose.js` — generate post / thread / script / article from agent knowledge (`content` engine).
- `queue.js` — content calendar / draft queue (`content_items`).
- Create-Agent wizard (rewrite of `welcome.js`).

### 🙈 HIDE now → 🗑️ DELETE in Phase 3 (off-mission)
Research/gap analysis: `pain_scores, gap_audience, gap_alerts, gap_verdict, gap_digest,
insights, concepts, hypotheses, bets, solutions, swot, tactics, root_cause, porter,
prioritize, intent_ladder, debatePanel, fleetFlow`.
Academic/papers: `papers, library, lit_matrix, paperMap, reader, write, academic,
research_home, research_workspace, conclusions, provenance, science`.
Product/consultancy: `product, compare, global_competitors, lean_canvas, north_star,
value_prop, market, pmf, pricing, interviews, empathy, estimate, prd, launch, ost,
playbook, improve, iterate`.
Misc research: `ingest_video` (Whisper), `reports`.

> Hidden in nav already; routes in `main.js` still resolve them. Phase 3 removes the
> nav entries' routes + deletes the files + their `renderXxx` imports together.

---

## 2. Backend Python — Keep / Delete

`src/openreply/`

### ✅ KEEP
- `core/` (db, credentials, public_client, client, config, exporters)
- `sources/` — the **social/community/news** adapters only (see §3)
- `research/discover.py` (sub discovery + canonicalization), `research/collect.py`
  (knowledge refresh), `research/gaps.py` + `insights.py` (→ content **angles**),
  `research/audience.py` (→ agent voice)
- `graph/` (the Agent **Knowledge Map**)
- `analyze/providers/` (BYOK LLM) + `analyze/{themes,summarize,painpoints}.py`
- `reply/` (the new engine — agents, opportunities, content, rules)
- `ingest/`, `mcp/` (expose the new `reply`/`agent`/`content` tools)

### 🗑️ DELETE (Phase 3)
- **Papers:** `research/paper_*.py`, `retrieval/palace.py` (ChromaDB/ONNX paper search),
  `research/academic_*.py`, `research/lit_matrix*.py`, citations, reading queue.
- **Product Mode:** `research/product*.py`, competitors/signals/sweeps.
- **Consultancy frameworks:** `research/deliberate.py` (5-persona debate), SWOT, lean
  canvas, market sizing, north star, PERT/estimate, porter, OST, playbook, launch,
  prd, pricing, interviews, empathy, pmf, improve, iterate engines.
- **Video:** whisper/yt-dlp ingest (unless keeping script-from-video).

> Deleting papers + palace alone removes the heaviest sidecar deps (ChromaDB, ONNX,
> pypdf, many academic clients) → much smaller PyInstaller bundle.

---

## 3. Data sources — Keep / Drop

`sources/collect_adapter.py:SOURCES` (58 adapters).

- ✅ **KEEP (content-relevant):** `reddit_free, x, linkedin, threads, bluesky, mastodon,
  lemmy, instagram, tiktok, truthsocial, hn, stackoverflow, stackexchange, discourse,
  devto, producthunt, youtube, gnews, rss_*, duckduckgo, trends, exa, tavily, wikipedia`.
- 🗑️ **DROP (academic/econ/conflict — not content sources):** `arxiv, pubmed, openalex,
  crossref, dblp, europepmc, semantic_scholar, scholar, worldbank, fred, bis, yfinance,
  openmeteo, polymarket, acled, gdelt, steam, package_stats`.

These map 1:1 to the `reply/platforms.py` catalog already shipped (which only exposes the
KEEP set to the user).

---

## 4. DB tables — Keep / Drop (Phase 3, destructive)

- ✅ **KEEP:** `posts, comments, topic_posts, subreddits, fetches, source_credentials,
  graph_nodes, graph_edges, findings, topic_prefs, topic_canonicalizations,
  chat_conversations` + new `agents, content_items, reply_opportunities, reply_drafts,
  reply_sub_rules, reply_state`.
- 🗑️ **DROP (after UI no longer reads them):** `paper_full_texts, paper_sections,
  paper_chunks, paper_references, paper_analyses, ingested_documents, document_elements,
  products, product_competitors, product_signals, product_sweeps, hypothesis_tests,
  audience_personas` (if superseded), `launch_briefs, trend_series, saved_views`
  (research-only), `extraction_queue/daily_usage` (if extraction dropped).

> Provide a one-shot `openreply reply migrate --drop-research` that drops these behind a
> confirmation + a DB backup copy — never silent.

---

## 5. Settings to trim (`settings.js`)

Remove: App-mode (Product vs Research) toggle, Whisper/yt-dlp section, Scheduled-runs
(repurpose to agent refresh cadence), academic/semantic-paper toggles. Keep: Profile,
BYOK keys, Reach Connections, Local data, Custom RSS, Danger zone (trash/feedback).

---

## 6. Execution phases

1. **Phase 1 (done):** Agent DB model + reply/content engine + nav trim.
2. **Phase 2 (next):** build `agents.js`, `opportunities.js`, `compose.js`, `queue.js`;
   rewrite onboarding to Create-Agent; relabel "Topics"→"Agents"; trim settings.
3. **Phase 3 (reshape, behind a branch):** delete hidden screens + their routes; delete
   dead backend modules; drop academic/econ sources from `SOURCES`; `migrate
   --drop-research` to drop tables (with backup); shrink the sidecar build.
4. **Phase 4:** outbound `publish/` adapters + scheduler (see `SOCIAL_CONTENT_TOOL_PLAN.md`).
