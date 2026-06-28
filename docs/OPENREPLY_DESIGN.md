# OpenReply — Product Design, User Journey & App Reshape

> **What this app is becoming:** an open-source **social marketing co-pilot**. You
> create **Agents** (each one a brand/niche persona). An Agent continuously fetches the
> latest knowledge in its niche (the existing collect + graph engine), and from that
> living knowledge it generates **replies, posts, threads, scripts, and articles** in
> the brand's voice — which you review and publish.
>
> This doc defines: (1) the **Topic → Agent** reframe, (2) the full **user journey &
> flow**, (3) the complete **page inventory**, and (4) a concrete **keep / remove /
> repurpose** plan for the existing codebase now that the app's role has changed.
>
> Status: design proposal. No code is deleted by this doc — removals are a reviewed,
> later step (§5).

---

## 1. The core reframe: a "Topic" becomes an "Agent"

Today the app's central noun is a **topic** (a research subject with a corpus, a graph,
findings). For OpenReply we promote that into a first-class **Agent** (a.k.a. Persona):

```
        OLD (research tool)                NEW (OpenReply)
        ───────────────────                ───────────────
        Topic                              Agent  (a brand/niche persona)
          ├─ corpus (posts)         →        ├─ Knowledge  (same corpus, auto-refreshed)
          ├─ graph map              →        ├─ Knowledge Map (same graph)
          ├─ findings/gaps          →        ├─ Angles      (what to talk about)
          └─ insights               →        └─ Voice + Outputs (replies / posts / scripts)
```

An **Agent** = identity + knowledge + outputs:

- **Identity (the persona/voice):** name, brand, niche, audience, persona bio
  (expertise/background), tone, and the platforms it operates on.
- **Knowledge (auto-refreshed):** the Agent owns a topic corpus. It re-runs collect on a
  cadence so its graph/angles always reflect the *latest* niche chatter. This is the
  existing `collect → graph build/enrich → gaps/insights` pipeline, scoped to the agent.
- **Outputs:** from that knowledge the Agent produces, on demand or on schedule:
  - **Replies** — to scored opportunities (the engine shipped in `src/openreply/reply/`).
  - **Posts / threads** — original short-form for X/LinkedIn/Reddit.
  - **Scripts** — short-video / YouTube scripts for a niche.
  - **Articles** — long-form posts / blog drafts.
  All land as drafts you review; publishing is manual now, automated later.

> **Terminology decision (default):** call the entity an **Agent**; "persona" is its
> voice attribute. One Agent = one brand/niche. Multiple Agents = multiple brands or
> multiple niches under one brand. (If you prefer "Persona" as the entity name, it's a
> rename — the model is identical.)

### Why one Agent per niche (not one giant topic)
Each niche has different audience language, different best subreddits/sources, a
different voice, and different angles. Binding knowledge + voice + outputs into one
Agent keeps generations on-brand and on-topic, and lets the knowledge refresh be scoped
(cheap) instead of boiling the ocean.

---

## 2. Data model (Agent supersedes topic + brand)

The engine already shipped `reply_brands` (single brand). The Agent model generalizes it
and **links to the existing topic corpus** (no data migration of posts/graph needed — an
Agent just *points at* a topic key):

```sql
-- Supersedes reply_brands. One row per brand/niche persona.
agents (
  id TEXT PK,
  name TEXT,                 -- "Acme Notes — student productivity"
  brand TEXT, niche TEXT,
  persona TEXT,              -- background/expertise = the voice
  tone TEXT, audience TEXT,
  topic TEXT,                -- FK to the existing corpus (topic_posts.topic, graph, findings)
  platforms_json TEXT,       -- picked source keys (reddit_free, x, hn, gnews, …)
  accounts_json TEXT,        -- which connected accounts it posts AS (source_credentials)
  refresh_cadence TEXT,      -- off | daily | weekly
  last_refresh_at INTEGER,
  created_at INTEGER, updated_at INTEGER
)

-- Unifies reply_drafts + future posts/scripts/articles. One row per generated artifact.
content_items (
  id TEXT PK,
  agent_id TEXT,
  kind TEXT,                 -- reply | post | thread | script | article
  platform TEXT,
  opportunity_id TEXT,       -- set when kind=reply (FK reply_opportunities)
  title TEXT, body TEXT,
  compliant INTEGER, compliance_notes TEXT,
  status TEXT,               -- draft | scheduled | posted | archived
  scheduled_at INTEGER,
  posted_at INTEGER, remote_url TEXT,
  created_at INTEGER, updated_at INTEGER
)
```

Reused as-is: `reply_opportunities` (per-agent via brand_id→agent_id), `reply_sub_rules`,
and the whole `posts` / `topic_posts` / `graph_nodes` / `graph_edges` / `findings`
knowledge layer (scoped by `agents.topic`). `source_credentials` stays the auth store.

> Migration path: rename `reply_brands` → `agents` and add the columns above; backfill
> `topic` = a slug of the agent name. `reply_drafts` rows fold into `content_items` with
> `kind='reply'`. Additive, no destructive change.

---

## 3. User journey (end-to-end)

```
FIRST RUN
  └─ Welcome → "Create your first Agent"
       ├─ Step 1  Identity: name, brand, what you do, niche
       ├─ Step 2  Voice: persona/background, tone, audience
       ├─ Step 3  Sources: pick platforms (Reddit, X, LinkedIn, HN, news…) + keywords
       ├─ Step 4  Connect accounts (Reach Connections) — optional, can do later
       └─ Step 5  BYOK: add an LLM key (or use local Ollama)
  └─ Agent builds knowledge (first collect runs) → corpus + graph + angles ready

DAILY LOOP (per Agent)
  1. Open Agent → Overview shows: fresh angles, new opportunities, queue status
  2. KNOWLEDGE refreshes on cadence (or "Refresh now") → graph + angles update
  3. ENGAGE:   Opportunities tab → scored posts → "Draft reply" → review → mark posted
  4. CREATE:   Create tab → pick kind (post/thread/script/article) + an angle →
               generate → edit → schedule or publish
  5. QUEUE:    Calendar/Queue shows scheduled + drafts; reorder, edit, publish
  6. MEASURE:  posted items can be re-fetched for engagement (later milestone)

MULTI-BRAND
  └─ Agents dashboard: cards for each persona; switch context; clone an Agent for a
     new niche (copies voice + sources, fresh knowledge)
```

The throughline: **knowledge is always fresh → every reply/post/script is generated from
the latest niche state, in the Agent's voice.**

---

## 4. Page inventory (what we need to build / keep)

| # | Page | Purpose | Built on |
|---|------|---------|----------|
| P0 | **Onboarding / Create-Agent wizard** | 5-step agent setup (identity→voice→sources→connect→BYOK) | new; reuses source picker + Reach Connections + BYOK modal |
| P1 | **Agents dashboard** | grid of persona cards; create/clone/switch | new (replaces topics list) |
| P2 | **Agent · Overview** | fresh angles, new opportunities, queue + refresh status | reuses insights/gaps surfacing |
| P3 | **Agent · Knowledge Map** | the niche graph (D3 force map), "what's happening" | **keep** existing Map/graph tab |
| P4 | **Agent · Opportunities** | find → score → draft replies (the shipped engine) | `reply` engine + new UI |
| P5 | **Agent · Create** | generate post / thread / script / article from an angle | new generator UI over providers |
| P6 | **Agent · Queue / Calendar** | scheduled + draft `content_items`; edit/publish | new |
| P7 | **Agent · Connections** | accounts this Agent posts as | **keep** Reach Connections, scope to agent |
| P8 | **Agent · Settings** | voice, tone, keywords, sources, refresh cadence | reuses settings patterns |
| P9 | **Global Settings** | BYOK / providers, data dir, app prefs | **keep** existing settings |
| P10 | **Connections hub** | all connected accounts across agents | **keep** Reach Connections |

Removed pages (research-era): topic research home, papers/library, academic mode, product
mode dashboard, deck/report export, deliberation/debate, SWOT/lean-canvas/PERT (see §5).

---

## 5. Keep / Remove / Repurpose — reshaping the codebase

The app was a **market-research / gap-finding / academic-paper** tool. Its new role is
**social content + reply generation**. Here's what changes. *(This is a proposal list —
deletion happens later with your go-ahead; nothing here is removed by writing this doc.)*

### ✅ KEEP — core to the new role
- **Tauri shell + sidecar bridge** (`app-tauri/`, `cli.rs`, `api.js`, `db.rs`) — the platform.
- **Fetch layer for social/community/news** sources (`sources/reddit_free`, `hn`, `x`,
  `linkedin`, `threads`, `bluesky`, `mastodon`, `lemmy`, `instagram`, `tiktok`,
  `producthunt`, `devto`, `stackoverflow`, `discourse`, `gnews`, `rss_*`, `duckduckgo`,
  `trends`, `youtube`) — the knowledge intake + opportunity feed.
- **Subreddit discovery + canonicalization** (`research/discover.py`) — niche → best subs.
- **Collect orchestrator** (`research/collect.py`) — the per-Agent knowledge refresh.
- **Graph build/enrich/relations** (`graph/`) — the Agent's Knowledge Map.
- **Gaps + insights** (`research/gaps.py`, `insights.py`) — repurposed as **content angles**
  ("painpoints/feature-wishes" → "what to write about").
- **Audience personas** (`research/audience.py`) — folds into the Agent persona/voice.
- **LLM provider layer** (`analyze/providers/`) — generation, BYOK.
- **Credentials / Reach Connections** (`core/credentials.py`) — auth + post-as accounts.
- **Ingest** (`ingest/`) — feed your own docs/notes into an Agent's knowledge.
- **The new `reply/` engine** — opportunities + drafts (already shipped).

### ❌ REMOVE / ARCHIVE — research/academic cruft, off-mission
- **Papers subsystem** — `research/paper_*`, `retrieval/palace.py` (ChromaDB paper search),
  and academic sources `arxiv, pubmed, openalex, crossref, dblp, europepmc,
  semantic_scholar, scholar`. (Academic lit review — not content creation.)
- **Academic mode** — lit matrix, citations, experiment plans, paper draft/outline,
  passports, reading queue.
- **Product Mode** — `research/product*.py`, `products/competitors/signals/sweeps` tables.
- **Consultancy artifacts** — SWOT, lean canvas, market sizing, North Star, PERT,
  deliberation/debate engine (`research/deliberate.py`).
- **Econ/market + conflict sources** — `worldbank, fred, bis, yfinance, openmeteo,
  polymarket, acled, gdelt` (not content sources; keep none in defaults).
- **Research exports** — DOCX/PPTX deck/brief generators (replaced by content export).
- *(Optional trim)* **video/whisper ingest** — keep only if you want script-from-video;
  otherwise drop to slim the sidecar.

### ♻️ REPURPOSE — same code, new meaning
| Existing | Becomes |
|---|---|
| Topic | **Agent** (brand/niche persona) |
| `find_gaps` painpoints/feature-wishes | **Content angles** (reply hooks + post ideas) |
| `audience` personas | the Agent's **voice + target audience** |
| Knowledge graph | the Agent's **Knowledge Map** ("what's happening in my niche") |
| `schedule-enable/tick` (research recollect) | **Agent knowledge-refresh cadence** + **content scheduler** |
| Insights report | **Overview** angles feed |

### Net effect
Removing the papers + product + consultancy + academic-source code is the bulk of the
deletion and **shrinks the sidecar a lot** (drops ChromaDB/ONNX paper retrieval, pypdf,
many academic clients). The remaining engine is: fetch social/news → graph + angles →
generate replies/posts/scripts/articles → review/publish.

---

## 6. Build order (incremental, on top of the shipped engine)

1. **Agent model** — rename `reply_brands`→`agents` (+columns), add `content_items`; CLI
   `openreply agent create/list/get/refresh` wrapping brand + a scoped `collect`.
2. **Knowledge refresh** — `agent refresh` = `collect(topic=agent.topic, sources=agent.platforms)`
   + `graph build/enrich` + `gaps` → angles cached on the agent.
3. **Create generators** — `content/generate.py`: `post|thread|script|article` prompts
   over (agent voice + chosen angle + top corpus excerpts). Persist to `content_items`.
4. **UI** — P1 dashboard, P0 wizard, P2 overview, then P4 Opportunities, P5 Create, P6 Queue.
5. **Scheduler** — `content schedule-tick` fires due `content_items` (manual-publish list
   now; outbound `publish/` adapters later — see `SOCIAL_CONTENT_TOOL_PLAN.md`).
6. **Reshape** — execute §5 removals behind a branch once the new surface is proven.

---

## 7. What already works today (shipped in this branch)

`openreply reply` is live and tested:
- `reply platforms` — the pickable platform catalog (engage vs discovery-only).
- `reply brand-set / brand-get` — the Agent identity+voice (precursor to `agent`).
- `reply find` — scans picked platforms, scores by relevance/intent/fit, persists opportunities.
- `reply list` — ranked opportunities.
- `reply draft -o <id>` — value-first reply in brand voice + Reddit rule compliance.
- `reply rules --sub <sub>` — fetch/cache subreddit rules.

This is the P4 (Opportunities) engine. The rest of this doc is the plan to wrap it into
the Agent model and add Create/Queue + the reshape.
