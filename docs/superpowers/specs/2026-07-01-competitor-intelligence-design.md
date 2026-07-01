# Competitor Intelligence — Design Spec

**Date:** 2026-07-01
**Status:** Approved design (pre-implementation) · **Revised after codebase mapping (2026-07-01)**
**Author:** brainstormed with Claude
**Scope:** New user-driven, seed-based competitor research + tracking workflow for OpenReply, grounded in cited posts and wired into chat, knowledge graph, memory palace, reply, and the opportunity/content engine.

> **Codebase-reality addendum (added after mapping the real code — FEATURES.md was stale):**
> - There is already an **unused scaffolding** for product/competitor tracking: `products` (each linked to a `topic`), `product_competitors` (product_id, competitor_name, urls_json{website,appstore,subreddit}, category, is_active), `product_signals` (signal_type incl. `competitor_release`/`competitor_vulnerability`, severity, confidence, evidence_post_ids, related_competitor, suggested_action, user_action lifecycle: dismissed|acted|snoozed|hypothesis), and `product_sweeps` (run history). **These tables exist in `core/db.py` schema but NO code reads/writes them and there is no sweep engine.** We build the logic on top of them (extending columns), not a fresh `competitors` table.
> - `collect(topic, sources=[...], extra_keywords=[...])` in `research/collect.py` **already is a fetch orchestrator** — it fans out to source adapters and tags results into `topic_posts(topic, post_id)`. Tagging a post to a topic automatically flows it into the shared `posts` store, the memory palace (`retrieval/palace.py`), and (via `enrich_from_llm(topic)`) the knowledge graph, and makes it chat-retrievable. **So we reuse `collect()` instead of writing a fetch orchestrator.**
> - **Actually reusable (verified):** `research/gaps.py:find_gaps(topic,…)` (painpoints/complaints/feature-gaps), `graph/semantic.py:upsert_semantic()`/`enrich_from_llm()`, `retrieval/palace.py:search_posts()`, `reply/opportunity.py` (find/list/set_status), `reply/generate.py:generate_reply()`, `reply/content.py:generate_content(kind="followup_reply")`, `reply/rank.py:fuse_and_rank()`, `mcp/jobs.py` (submit/get/list).
> - **Does NOT exist (must build or descope):** sentiment-by-source (**build** — needed for the Complaints tab), root-cause/5-Whys (**descope to §11**), real RICE/Kano/MoSCoW (**descope** — use `fuse_and_rank` + signal severity for ranking in v1).

---

## 1. Problem & intent

Today OpenReply discovers competitors **bottom-up** — `research/competitors.py` (`global_competitors`, `openreply_global_competitors`) clusters competitor names that people *happen to mention* inside an already-collected corpus. There is no way for a user who **already knows their competitors** to:

1. Name them explicitly (and paste their site / Product Hunt / App Store / review-page links),
2. Have the app fetch and research each one **deeply across all relevant data sources**,
3. See **every complaint / feedback / feature-gap** per competitor, cited to the source post,
4. Turn those gaps into **opportunities** ("what we can build") and **replies** ("what we can reply to such a post"),
5. **Track it over time** (deltas), and
6. Have the whole competitor corpus **available to chat, the knowledge graph, and the memory palace** so they can plan around it.

This spec defines that top-down, seed-driven **Competitor Intelligence** feature.

### Design decisions locked during brainstorming
- **Output:** all three views as tabs — Opportunities, Complaints (per competitor), Comparison — plus reply drafting and build-idea generation, everything grounded with cited posts.
- **Seed model:** rich structured seed (name + aliases + subreddits + review/listing pages) with an auto-enrich entry UX, **plus** user-pasted URLs (site, Product Hunt, App Store / Play listing, G2/Trustpilot, etc.) that are fetched directly.
- **Cadence:** saved, **tracked-over-time** entities (snapshots + deltas, feeding Daily Update) **plus a manual "Run / Refresh now" button**.
- **Source coverage:** curated "competitor pack" default, user-togglable to any of the 42 adapters; pasted URLs always fetched.
- **Pipelines:** competitor tracking participates in **daily fetch** and **opportunity scan**.
- **Config:** all setup (competitors, per-competitor sources, cadence, URLs) is created and edited from the **Settings page**.
- **Architecture:** **Approach 3 (Hybrid)** — competitors are first-class entities (own config/snapshot tables) but their fetched posts flow into the shared `posts` store tagged with `competitor_id`, so chat/graph/memory work for free while a thin competitor layer reuses existing analysis modules.

---

## 2. Architecture (Approach 3 — Hybrid)

Competitors are **first-class entities** for config + delta tracking, but their fetched content lives in the **shared corpus** so the rest of the app picks it up automatically. The competitor layer **reuses** existing analysis code (~80% reuse) rather than reimplementing painpoint/sentiment/opportunity logic.

### 2.1 Component boundaries

Eight focused, independently testable units:

| # | Unit | Responsibility | Depends on |
|---|---|---|---|
| 1 | **Competitor registry** | CRUD + config store for saved competitors | `competitors` table |
| 2 | **Seed enricher** | Name → auto-resolve aliases, subreddit, review-page URLs (user confirms) | `exa_search` / `web_reader`, LLM |
| 3 | **Fetch orchestrator** | Per competitor: run curated pack + toggled extras + pasted URLs → write tagged posts | existing 42 source adapters, jobs queue |
| 4 | **Analysis engine** | Complaints, sentiment, feature-gaps, opportunities, comparison | *reuses* painpoint / sentiment_by_source / root_cause / rice / kano / moscow / solutions modules |
| 5 | **Snapshot / delta engine** | Snapshot each run; diff vs previous → "new this week" | `competitor_snapshots` |
| 6 | **Integration adapters** | Push corpus into graph + memory palace; enable chat grounding; feed reply + build-idea generation | graph, memory palace, opportunity lifecycle, content engine |
| 7 | **Pipeline hooks** | Register competitor tracking into daily-fetch + opportunity-scan | existing daily/scan pipelines |
| 8 | **Surfaces** | Tauri 3-tab screen · Settings config · MCP sub-server · CLI group | Tauri sidecar, `mcp.mount()`, Typer |

Each unit answers: *what does it do, how is it used, what does it depend on* — see the table. Units 1–7 are Python under `src/openreply/research/competitor_intel/` (new package); unit 8 spans MCP, CLI, and Tauri.

---

## 3. Data model

**Build on the existing (unused) `product_*` scaffolding** rather than a fresh `competitors` table. All migrations are **guarded/idempotent** using the repo's established pattern: check `db.table_names()` before `.create()`, and `{c.name for c in db[table].columns}` before each `ALTER TABLE … ADD COLUMN` (see `core/db.py:343`, `:512`).

**Extend `product_competitors`** (additive nullable columns):
```
product_competitors  (existing PK: product_id, competitor_name)
  urls_json      TEXT   -- EXISTING: {"website":..,"appstore":..,"subreddit":..}
                        --   → widen usage to also hold producthunt/playstore/trustpilot/g2 + free-form pasted URLs
  + slug          TEXT   -- stable id for the competitor's topic
  + topic         TEXT   -- the topic string its fetched posts are tagged under, e.g. "competitor:notion"
  + aliases_json  TEXT   -- ["notion.so","@NotionHQ","Notion Labs"]
  + subreddits_json TEXT -- ["Notion","NotionSo"]
  + source_config_json TEXT -- {enabled_adapters:[...], params:{...}} (curated pack pre-selected)
  + status        TEXT   -- active | paused  (distinct from is_active)
  + daily_fetch   INTEGER DEFAULT 0
  + in_opp_scan   INTEGER DEFAULT 1
  + notes         TEXT
  + updated_at    TEXT
```

**Reuse `product_signals`** as the unified findings + opportunities store (it already has the exact shape we need — evidence, severity, related_competitor, suggested_action, and the `user_action` lifecycle: dismissed|acted|snoozed|hypothesis):
```
product_signals  (existing)  -- one row per finding/opportunity, each cited via evidence_post_ids
  signal_type    -- reuse + extend the enum:
                 --   complaint | feature_gap | churn_trigger | praise   (Complaints tab)
                 --   competitor_vulnerability                            (Opportunities tab = "what we can build")
  related_competitor  -- the competitor_name (already exists)
  evidence_post_ids   -- JSON array of post ids (already exists) → citations
  severity, confidence, title, description, suggested_action  (already exist)
  user_action         -- lifecycle (already exists)
```

**New `competitor_snapshots`** (per-competitor per-run metrics for deltas — `product_sweeps` is per-product run history and stays as-is for run bookkeeping):
```
competitor_snapshots
  id             INTEGER PK
  product_id     TEXT
  competitor_name TEXT
  sweep_id       INTEGER   -- FK → product_sweeps.id (the run)
  created_at     TEXT
  metrics_json   TEXT  -- {complaint_count, sentiment_score, top_painpoints[],
                       --  mentions_by_source{}, share_of_voice}
  summary        TEXT
  delta_json     TEXT  -- vs previous snapshot: {new_complaints, sentiment_change, new_features[]}
```

**Posts need no new column** — a competitor's posts are scoped by being tagged to its `topic` in the existing `topic_posts(topic, post_id)` table (via `collect(topic=…)` / `_tag_posts`). That is what makes them flow into corpus/palace/graph/chat automatically. **Do NOT add `competitor_id` to `posts`.**

**Decision (revised):** the earlier plan to add `competitor_id` to `posts`/`opportunities` is dropped — the topic-tagging mechanism (`topic_posts`) already provides corpus scoping, and `product_signals` already provides the opportunity/finding lifecycle. This is less invasive and reuses more.

---

## 4. Orchestration flow (one competitor, one run)

Runs execute async via the existing jobs queue (`research/jobs.py`) and stream progress to the UI the way Collect already does (`run_cli_streaming`).

```
enrich seed (only if new / requested) ─┐
                                       ├─► fetch: curated pack + toggled extras + pasted URLs
                                       │      curated pack = App Store, Play Store, Trustpilot,
                                       │      G2/AlternativeTo, Product Hunt, Reddit (name + their
                                       │      subreddit), Hacker News, Stack Overflow  (+ pasted URLs)
                                       ▼
             write posts (source_type + competitor_id) ──► shared corpus (posts table)
                                       ▼
             analysis engine (reuse existing modules):
               painpoints        → complaints / feature_gaps  → competitor_findings
               sentiment_by_source                            → snapshot metrics
               root_cause (5-Whys) on top painpoints          → churn drivers
               solutions + RICE / Kano / MoSCoW               → opportunities (competitor_id set)
                                       ▼
             snapshot + delta vs previous snapshot
                                       ▼
             integration: graph nodes/edges · memory-palace ingest ·
                          opportunities → reply drafts + build ideas
```

The **fetch orchestrator is thin** — it selects which adapters to call and tags the output; it does not reimplement any adapter. The **analysis engine calls the existing research modules** and stores their results into competitor tables.

---

## 5. Surfaces

### 5.1 Tauri screen — "Competitor Intelligence" (3 tabs)

New screen under `app-tauri/src/screens/`, driven via `run_cli` / `run_cli_streaming`, following the `tauri-python-sidecar-app` pattern (Rust command in `main.rs`, `api.js` wrapper, `.js` screen module). Every card **cites the actual post/URL** — no ungrounded claims.

**Tab 1 — Opportunities** ("what we can build")
Ranked list of gaps competitors leave open. Each card: opportunity text, RICE/Kano/MoSCoW chips, evidence = cited competitor posts, and two actions — **Draft reply** (→ follow-up-reply content kind on the complaint post) and **Build this** (→ PRD/OST/solution). Wired to the existing opportunity lifecycle (save/draft/dismiss).

**Tab 2 — Complaints (per competitor)** ("know all their complaints/feedback")
Competitor switcher → for the selected competitor: complaints clustered by painpoint, sentiment breakdown, most-hated features, churn triggers, verbatim quotes each linking to the source post/URL, and a **delta banner** ("+12 new complaints this week, sentiment ↓ on billing").

**Tab 3 — Comparison** (head-to-head)
Your tracked Product (cat 9) vs each competitor across sources: share-of-voice, sentiment delta, painpoint-overlap matrix, "where you win / where they win."

### 5.2 Settings page — "Competitors" section

Lives alongside BYOK et al. Provides:
- Add / edit / remove competitors. Type a name → seed enricher auto-suggests aliases / subreddit / review URLs → user confirms/edits → paste extra URLs.
- Per-competitor source toggles (curated pack pre-checked; expandable to any of the 42 adapters).
- Cadence controls: include in daily fetch (on/off), include in opportunity scan (on/off), pause/resume.
- **Run / Refresh now** per competitor, and Refresh all.

### 5.3 MCP + CLI

Following the established sub-server pattern (`mcp/tools/<domain>_tools.py` + `mcp.mount()`):
- MCP tools: `openreply_competitor_add / list / enrich / run / findings / opportunities / compare / delta`.
- CLI group: `openreply research competitors add|list|run|show|compare` — all support `--json` for the sidecar.

---

## 6. Pipeline hooks

- **Daily fetch:** active competitors with `daily_fetch=true` are refreshed in the daily run; their deltas surface in the existing **Daily Update** digest as a "Competitor moves" section.
- **Opportunity scan:** competitors with `in_opp_scan=true` contribute painpoints to the scan, so competitor gaps appear in the ranked opportunity list automatically.

---

## 7. Chat / graph / memory / reply integration

Because fetched posts land in the shared `posts` store tagged `competitor_id`:
- **Chat:** grounded competitor questions ("What do people hate most about X?", "Draft a plan to win users frustrated with Y") with citations.
- **Knowledge graph:** competitor painpoints/features become nodes/edges linked to your topics.
- **Memory palace:** competitor findings are semantically searchable alongside everything else.
- **Reply:** any complaint finding → one click into the existing follow-up-reply content kind.
- **Build:** any opportunity → PRD/OST/solution generation.

---

## 8. Reuse vs. build (revised to match real code)

**Reuse (verified to exist, no new logic):**
- `research/collect.py:collect(topic, sources=[...], extra_keywords=[...])` — the fetch orchestrator (fans out to adapters, tags `topic_posts`).
- all 42 fetch adapters (incl. `producthunt`, `appstore`, `playstore`, `trustpilot`, `alternativeto`, `web_reader`).
- `research/gaps.py:find_gaps(topic,…)` / `run_extractor(...)` — painpoints / complaints / feature-gaps / diy.
- `graph/semantic.py:upsert_semantic()` / `enrich_from_llm(topic)` — knowledge-graph nodes+edges.
- `retrieval/palace.py:upsert_posts_many()` / `search_posts()` — memory palace (auto-synced on `upsert_posts`).
- `reply/opportunity.py:find_opportunities()/list_opportunities()/set_status()` — opportunity lifecycle.
- `reply/generate.py:generate_reply()` and `reply/content.py:generate_content(kind="followup_reply")` — reply/build drafting.
- `reply/rank.py:fuse_and_rank()` — engagement/freshness ranking (used in place of RICE for v1).
- `reply/digest.py:build_digest()` (+ `CATEGORY_SOURCES`) — Daily Update.
- `mcp/jobs.py:submit()/get()/list_jobs()` — async jobs.
- existing `products`/`product_competitors`/`product_signals`/`product_sweeps` tables + `topic_posts`.

**Build new:**
- schema migrations: extend `product_competitors` columns + new `competitor_snapshots` table (§3).
- `research/competitor_intel/` package: registry (CRUD over `product_competitors`), seed enricher, **sentiment classifier** (`analyze/sentiment.py`, LLM per-source — does not exist), the sweep runner (orchestrates `collect` → `find_gaps` → sentiment → `product_signals` → snapshot/delta), comparison builder.
- surfaces: 3-tab Tauri screen (`renderCompetitors` in `dynamic.js` + `DYN` route + `shell.js` nav), Settings "Competitors" card, Rust commands (`commands.rs` + `main.rs` `generate_handler!`), `api.js` wrappers, CLI `competitor_cmds.py` (+ `add_typer` in `cli/main.py`), MCP `mcp/tools/competitor_tools.py` (+ `mcp.mount()` in `mcp/server.py`).
- pipeline hooks: competitor sweep participates in daily fetch + opportunity scan.

Roughly **65% reuse / 35% new** — the new part is the sweep runner + sentiment + UI. (Down from the original "80%" estimate because sentiment/root-cause/RICE turned out not to exist.)

---

## 9. Testing strategy

- **Unit 1 (registry):** CRUD round-trip, slug uniqueness, JSON column serialization.
- **Unit 2 (enricher):** given a name, returns plausible aliases/subreddit/URLs; degrades gracefully when lookup fails (returns name-only seed, never crashes).
- **Unit 3 (orchestrator):** with mocked adapters, verifies correct adapter selection per `source_config`, that pasted URLs are always fetched, and that every written post carries `competitor_id` + `source_type`.
- **Unit 4 (analysis):** on a fixture corpus, produces findings with non-empty `post_id`/`url` citations; opportunities carry `competitor_id`.
- **Unit 5 (delta):** two sequential snapshots produce a correct delta (new complaints, sentiment change).
- **Integration:** end-to-end run for one competitor writes posts → findings → snapshot → opportunities, and the corpus is retrievable via chat/graph/memory queries.
- **Surfaces:** CLI `--json` shape stable for the sidecar; MCP tools return schema-valid payloads.

---

## 10. Rollout / migration notes

- All schema changes are additive and guarded — safe on existing DBs.
- `competitor_id` on `posts`/`opportunities` is nullable → existing rows unaffected.
- Feature is inert until the user adds a competitor in Settings, so it ships dark and turns on per-user.
- Update `FEATURES.md` (category 10 "Audience & competitors") and add a changelog entry on ship, per repo rules.

---

## 11. Out of scope (YAGNI for v1)

- Proactive **alerts** on competitor complaint spikes (fast-follow after tracking lands).
- New scraper adapters — the curated pack is covered by existing adapters; only add adapters if a user's pasted URL is from an unsupported host.
- Automated competitor *discovery* suggestions (bottom-up); this feature is top-down/seed-driven.
- **Root-cause / 5-Whys** on competitor painpoints — the module does not exist in the codebase; deferred. v1 surfaces painpoint clusters + severity from `find_gaps` instead.
- **Full RICE / Kano / MoSCoW** scoring UI — those modules do not exist. v1 ranks opportunities with the existing `reply/rank.py:fuse_and_rank()` (engagement + freshness) plus `product_signals.severity`. A real RICE layer is a fast-follow.
