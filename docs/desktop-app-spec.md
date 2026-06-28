# Desktop app build spec

**Audience:** A developer (or LLM) building the Flutter Desktop wrapper for reddit-myind.
**Status:** Complete. The Python CLI does all heavy lifting; the desktop app is a UI layer that spawns it as a subprocess and renders results.

---

## 🧭 Part A — The Build Prompt (paste this into Claude/Cursor)

> Build a **Flutter Desktop** app (macOS + Windows + Linux) named **"OpenReply"**.
> It wraps the existing `reddit-myind` Python CLI. Spawn `reddit-cli` as a
> subprocess for every operation. Never re-implement the research logic in
> Dart — just orchestrate calls and render results.
>
> **Core loop:**
> User types a topic → app runs `research collect --aggressive` → shows a
> live progress log → builds + enriches the graph → embeds our existing
> self-contained HTML openreply-map viewer in a `webview_flutter_plus` panel →
> user can export / share / tweak / ingest their own files.
>
> **Stack (non-negotiable):**
> - Flutter 3.22+ with Material 3
> - Riverpod for state
> - GoRouter for navigation
> - `webview_flutter_plus` (macOS needs `webview_flutter_wkwebview`)
> - `process` package for spawning Python subprocess
> - `path_provider` for app data dir
> - RevenueCat (flutter plugin) for licensing
>
> **Subprocess contract:**
> - Bundle Python + reddit-myind via `pyinstaller` → single executable at `resources/reddit-cli`
> - Pass `--json` flag on every command
> - Parse stdout line-by-line for progress, then final JSON blob
> - Env var `REDDIT_MYIND_DATA_DIR` = `<app documents dir>/reddit-myind`
>
> **Design principles (research-backed, see `docs/methodology.md`):**
> - Shneiderman: overview → filter → details on demand
> - Tufte: max data-ink, minimal chrome
> - Gestalt: color-code by kind, cluster by proximity
> - Progressive disclosure: start minimal, reveal on click
>
> **Non-goals (for v1):**
> - Don't rewrite the HTML viewer — embed our existing one
> - Don't add new sources in Dart — they stay in Python
> - Don't do in-app LLM calls — users BYO Anthropic/OpenAI key; Claude-as-LLM via MCP is the free path
> - No cloud sync, no auth, no team features (those are v2 hosted-tier)
>
> **Monetization:**
> - Free (open-source): all CLI features, no app polish
> - Desktop Pro $49 one-time: the Flutter UI we're building
> - Team $99/mo: v2 hosted features only

---

## 📦 Part B — Complete feature surface

### Top-level CLI commands (11 groups)

| Command | What it does | Example |
|---|---|---|
| `reddit-cli info` | Show config + DB stats + active mode | — |
| `reddit-cli auth login` | Browser OAuth flow for Reddit | one-time setup |
| `reddit-cli fetch posts` | Fetch posts from a sub | `--sub resumes --limit 50` |
| `reddit-cli fetch comments` | Fetch comment tree | `--post abc123` |
| `reddit-cli fetch user` | Pull a user's history | `--name spez` |
| `reddit-cli fetch historical` | Pullpush archive (pre-May 2025) | `--sub X --days 730` |
| `reddit-cli fetch sub-comments` | Comment firehose | `--sub python` |
| `reddit-cli search` | Reddit search, sub-scoped or all | `"ATS" --sub resumes` |
| `reddit-cli stream` | Blocking keyword stream | `--sub X --keywords a,b` |
| `reddit-cli query` | Raw SQL against SQLite | `"SELECT ..."` |
| `reddit-cli export` | JSON/CSV/Parquet export | `posts --format csv` |
| `reddit-cli ingest file` | Local CSV/JSON/TXT/VTT/SRT/MD | `--path X --topic Y --source-type interviews` |

### Research subcommands (the main pipeline)

| Command | What it does | Output |
|---|---|---|
| `research discover` | Topic → top-N subs | list of subs |
| `research collect` | Full corpus build | upserts posts + tags topic |
| `research corpus` | Query what's collected | JSON/table |
| `research gaps` | LLM extracts 4 gap types | JSON report |
| `research temporal-gaps` | Pre/post-2025 classification | CHRONIC/EMERGING/FADING |
| `research report` | Simple markdown report | report.md |
| `research report-pro` | Premium citation-rich (755-line) | report-pro.md |
| `research findings` | Ranked markdown scan | findings.md |
| `research graph build` | Build structural graph | stats dict |
| `research graph enrich` | LLM painpoints → graph nodes | summary |
| `research graph stats` | Node/edge counts | dict |
| `research graph neighbors` | Walk edges | list |
| `research graph export` | HTML (D3 viewer) or JSON | file |

### Data sources (20 total, all free-tier)

**Auto-discovering + ingesting:**
| Source | Config | Notes |
|---|---|---|
| Reddit (live) | OAuth web app | `reddit-cli auth login` |
| Reddit (historical to May 2025) | None | Pullpush archive |
| Hacker News | None | Algolia API |
| App Store reviews | None | iTunes RSS (throttled ~60/min) |
| Play Store reviews | None | `google-play-scraper` |
| arXiv | None | Atom API |
| OpenAlex | None | Free public API |
| PubMed | Optional `NCBI_API_KEY` | Higher quota with key |
| Semantic Scholar | None | Rate-limited |
| Google News RSS | None | Keyword feeds |
| DEV.to | None | API v1 |
| Lemmy | Instance choice | Federated |
| Mastodon | Instance + tag | Public timeline |
| Stack Overflow | None | StackExchange API |
| GitHub repos | Optional `GITHUB_TOKEN` | 60→5000 req/hr |
| GitHub Issues | Optional `GITHUB_TOKEN` | Same |
| Wikipedia | None | Summary + pageviews |
| Google Trends | None | `pytrends` + urllib3 shim |
| npm / PyPI stats | None | Download counts |
| Discourse forums | Per-instance | `forum.X.com/.json` |

**Local ingest (bring-your-own):**
| Format | Parser | Example use |
|---|---|---|
| `.csv` | Columns: text (required); optional title, author, score, created_at, url | Slack export, interview transcripts |
| `.json` | List of dicts with same keys | Typeform exports, API dumps |
| `.txt` | Blank-line-separated paragraphs | Interview notes |
| `.vtt` / `.srt` | Subtitle captions | Call transcripts (Zoom, Grain) |
| `.md` | Headers as titles, blocks as rows | Notion exports, meeting notes |

### MCP surface (40 tools, used by Claude Code; desktop doesn't use MCP)

Exposed so AI agents can drive research without the desktop UI.
Full list in `src/reddit_research/mcp/server.py`; key ones:

- `openreply_research_collect(topic, aggressive=true, sources=[...])`
- `openreply_graph_build(topic)` / `openreply_graph_stats(topic)` / `openreply_graph_pagerank(topic)`
- `openreply_graph_upsert_semantic(topic, painpoints=[], features=[], ...)` — lets Claude persist its synthesis
- `openreply_graph_export_json(topic)` — get the D3 data shape
- `openreply_corpus_temporal_split(topic)` — pre/post-May-2025 for CHRONIC/EMERGING/FADING classification

---

## 🗄️ Part C — Data model

### SQLite schema (auto-migrated on first run)

```sql
-- Core Reddit/source data
CREATE TABLE posts (
    id TEXT PRIMARY KEY,         -- reddit id, hn_<id>, appstore_<trackid>_<rev>, etc.
    sub TEXT,                     -- subreddit or source container (e.g. 'appstore:Streaks')
    source_type TEXT DEFAULT 'reddit',  -- reddit|hn|appstore|playstore|arxiv|...|local_csv
    author TEXT,
    title TEXT,
    selftext TEXT,
    url TEXT,
    score INTEGER,
    upvote_ratio REAL,
    num_comments INTEGER,
    created_utc REAL,             -- unix timestamp
    is_self INTEGER,
    over_18 INTEGER,
    flair TEXT,
    permalink TEXT,
    fetched_at TEXT               -- ISO8601 when we scraped it
);
CREATE INDEX idx_posts_sub ON posts(sub);
CREATE INDEX idx_posts_source_type ON posts(source_type);
CREATE INDEX idx_posts_created ON posts(created_utc);
CREATE INDEX idx_posts_author ON posts(author);

CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    post_id TEXT,
    parent_id TEXT,
    author TEXT,
    body TEXT,
    score INTEGER,
    created_utc REAL,
    depth INTEGER,
    fetched_at TEXT
);
CREATE INDEX idx_comments_post ON comments(post_id);
CREATE INDEX idx_comments_author ON comments(author);

CREATE TABLE users (
    name TEXT PRIMARY KEY,
    link_karma INTEGER,
    comment_karma INTEGER,
    created_utc REAL,
    is_mod INTEGER,
    fetched_at TEXT
);

CREATE TABLE subreddits (
    name TEXT PRIMARY KEY,
    subscribers INTEGER,
    description TEXT,
    fetched_at TEXT
);

-- Audit log of every fetch (for debugging + retry)
CREATE TABLE fetches (
    id INTEGER PRIMARY KEY,
    kind TEXT,
    params_json TEXT,
    started_at TEXT,
    ended_at TEXT,
    rows INTEGER,
    error TEXT
);

-- Keyword monitoring (real-time, blocking)
CREATE TABLE streams (
    id INTEGER PRIMARY KEY,
    name TEXT,
    sub TEXT,
    keywords TEXT,
    started_at TEXT,
    active INTEGER
);
CREATE TABLE stream_hits (
    stream_id INTEGER,
    item_type TEXT,
    item_id TEXT,
    matched_at TEXT,
    keywords_matched TEXT,
    PRIMARY KEY (stream_id, item_type, item_id)
);

-- Topic tagging — many-to-many between topics and posts
CREATE TABLE topic_posts (
    topic TEXT,
    post_id TEXT,
    source TEXT,                  -- why it was tagged: 'top:sub:month' / 'search:pain:...' / 'pullpush:sub' / 'hn:story' / 'appstore:<app>' / 'local:<filename>'
    added_at TEXT,
    PRIMARY KEY (topic, post_id)
);
CREATE INDEX idx_topic_posts_topic ON topic_posts(topic);

-- Knowledge graph — nodes and edges keyed by topic
CREATE TABLE graph_nodes (
    id TEXT PRIMARY KEY,          -- format: '<topic>::<kind>::<key>'
    topic TEXT,
    kind TEXT,                    -- topic|era|subreddit|source|post|comment|user|painpoint|feature_wish|product|workaround
    label TEXT,
    metadata_json TEXT
);
CREATE INDEX idx_gn_topic ON graph_nodes(topic);
CREATE INDEX idx_gn_kind ON graph_nodes(kind);
CREATE INDEX idx_gn_topic_kind ON graph_nodes(topic, kind);

CREATE TABLE graph_edges (
    src TEXT,
    dst TEXT,
    kind TEXT,                    -- contains|has_comment|authored|era|has_painpoint|evidenced_by|about_product|has_workaround|solves|built_in|has_feature_wish|wished_in|has_product
    topic TEXT,
    weight REAL,
    metadata_json TEXT,
    PRIMARY KEY (src, dst, kind)
);
CREATE INDEX idx_ge_topic ON graph_edges(topic);
CREATE INDEX idx_ge_src ON graph_edges(src);
CREATE INDEX idx_ge_dst ON graph_edges(dst);
CREATE INDEX idx_ge_kind ON graph_edges(kind);

-- Google Trends time series (not graph nodes — overlay data)
CREATE TABLE trend_series (
    id INTEGER PRIMARY KEY,
    topic TEXT,
    keyword TEXT,
    timeframe TEXT,
    geo TEXT,
    point_ts TEXT,                -- ISO date
    interest INTEGER,             -- 0-100
    fetched_at TEXT
);
CREATE INDEX idx_trend_topic ON trend_series(topic, keyword);
```

### Temporal classification boundary

`CUTOFF_UTC = 1747699200` (2025-05-20 00:00 UTC). Posts before = pullpush era; after = Reddit live.

---

## 🧠 Part D — Pipelines (user flows)

### D.1 — Collect pipeline (`research collect --aggressive`)

```
1. Discover     /subreddits/search.json?q=<topic>          → top N subs
2. Fetch top    Per sub: top of month + top of year          → ~100-500 posts
3. Search       Render prompts/queries.yaml with topic,
                run each search query against Reddit         → ~500-1500 posts
4. Historical   Pullpush: sub + date range (2 years back)    → up to 1000/sub
5. Sources      Per --source: hn, appstore, playstore,
                arxiv, openalex, scholar, ...                → 30-500 per source
6. Tag          Upsert into topic_posts(topic, post_id, source)
```

Output: ~2,000-10,000 posts tagged under topic.

### D.2 — Build pipeline (`research graph build`)

```
1. Create nodes:
   - 1 topic node
   - 2 era nodes (pre_2025, post_2025)
   - N subreddit nodes (for reddit source)
   - N source nodes (for hn, appstore, playstore, ...)
   - 1 node per post (kind=post)
   - 1 node per comment (kind=comment)
   - 1 node per distinct author (kind=user)
2. Create edges:
   - topic → sub/source: contains
   - sub/source → post: contains
   - post → era: era (pre_2025 or post_2025 by created_utc)
   - post → comment: has_comment
   - user → post/comment: authored
3. Upsert (idempotent)
```

### D.3 — Enrich pipeline (`research graph enrich` OR `openreply_graph_upsert_semantic` via MCP)

**Option A (CLI, needs LLM key):** Runs `research gaps` → persists to graph.

**Option B (MCP, Claude-as-LLM, no key):**
```
1. Claude calls openreply_get_corpus(topic, limit=200)
2. Claude synthesizes in-context: 8-15 painpoints, 5-10 features, products, DIYs
3. Claude calls openreply_graph_upsert_semantic(
     topic,
     painpoints=[{painpoint, severity, frequency, classification, evidence, example_post_ids}],
     feature_wishes=[{feature, user_quote, frequency, example_post_ids}],
     product_complaints=[{product, complaint, severity, frequency, example_post_ids}],
     diy_workarounds=[{workaround, gap, user_quote, frequency, example_post_ids}],
   )
4. Tool creates painpoint/product/workaround/feature_wish nodes + evidence edges to posts
```

### D.4 — Export pipeline

```
research graph export --topic X --out file.html   → skeleton D3 viewer (200-400 nodes)
research graph export --format json              → raw {nodes, links, meta, findings}
research report-pro --out report.md              → 500-line citation report
research findings --top 10 --out findings.md     → quick scan
research findings --tweet                        → 3-finding summary
```

---

## 🗣️ Part E — LLM prompts (all externalized in `prompts/*.yaml`)

All prompts live in `prompts/`. Users can override with `REDDIT_MYIND_PROMPTS_DIR`. Non-devs can edit without touching code.

### E.1 — `queries.yaml` (search query templates)

```yaml
version: 1

pain:
  - "frustrated with {topic}"
  - "problem with {topic}"
  - "{topic} is broken"
  - "hate {topic}"
  - "{topic} issues"
  - "why does {topic}"
  - "struggling with {topic}"

features:
  - "wish {topic}"
  - "looking for {topic}"
  - "best {topic}"
  - "{topic} that can"
  - "recommendation {topic}"
  - "{topic} recommendation"

complaints:
  - "{topic} sucks"
  - "alternative to {topic}"
  - "stop using {topic}"
  - "switched from {topic}"
  - "{topic} is terrible"

diy:
  - "built my own {topic}"
  - "made my own {topic}"
  - "ended up using {topic}"
  - "hack for {topic}"
  - "workaround for {topic}"
  - "DIY {topic}"
```

### E.2 — `painpoints.yaml`

```yaml
name: painpoints
system: |
  You are a product researcher. From the Reddit posts provided, extract the
  distinct pain points users are expressing. Be specific — not generic.
  For each pain point:
    - quote a short phrase from a post that evidences it
    - tag severity (low / medium / high) based on user sentiment
    - estimate frequency from the sample (integer — count of posts)
    - list up to 5 example post IDs

  Reply with JSON only. Schema:
  [{"painpoint": str, "evidence": str, "severity": "low|medium|high",
    "frequency": int, "example_post_ids": [str]}]

user_template: |
  Topic: {topic}
  Posts to analyze:
  {corpus}
```

### E.3 — `features.yaml` · `complaints.yaml` · `diy.yaml`

Same shape, different extraction:
- `features.yaml` → `{feature, user_quote, frequency, example_post_ids}`
- `complaints.yaml` → `{product, complaint, severity, frequency, example_post_ids}`
- `diy.yaml` → `{workaround, user_quote, gap, frequency, example_post_ids}`

### E.4 — `temporal_gaps.yaml` (CHRONIC/EMERGING/FADING classification)

Input: pre_2025_corpus + post_2025_corpus.
Output: for each painpoint → `{title, classification: CHRONIC|EMERGING|FADING, pre_2025_freq, post_2025_freq, evidence, example_ids, strategic_note}`.

---

## 🔍 Part F — Key SQL queries (copy into your Dart layer for live queries)

### F.1 — Source breakdown for a topic

```sql
SELECT coalesce(p.source_type, 'reddit') AS src, count(*) AS n
FROM posts p JOIN topic_posts tp ON tp.post_id = p.id
WHERE tp.topic = :topic
GROUP BY src ORDER BY n DESC;
```

### F.2 — Top posts by engagement in a topic

```sql
SELECT p.id, p.sub, p.title, p.score, p.num_comments,
       p.created_utc, p.permalink,
       (p.num_comments * 2 + p.score) AS engagement
FROM posts p JOIN topic_posts tp ON tp.post_id = p.id
WHERE tp.topic = :topic
ORDER BY engagement DESC
LIMIT :limit;
```

### F.3 — Saturation math per finding (Guest/Bunce/Johnson 2006)

```sql
WITH ev AS (
    SELECT CASE WHEN e.src = :node_id THEN e.dst ELSE e.src END AS nid
    FROM graph_edges e
    WHERE e.topic = :topic
      AND (e.src = :node_id OR e.dst = :node_id)
      AND e.kind IN ('evidenced_by','wished_in','built_in','solves','about_product')
)
SELECT
  count(*) AS n_evidence,
  count(DISTINCT CASE WHEN p.author NOT IN ('[deleted]','[anon]','[local]','') THEN p.author END) AS unique_authors,
  count(DISTINCT coalesce(p.source_type,'reddit')) AS source_diversity
FROM posts p
JOIN ev ON ev.nid = :topic || '::post::' || p.id;
```

Thresholds:
- `n_evidence ≥ 12 AND source_diversity ≥ 2` → **saturated ✓**
- `n_evidence ≥ 8 AND source_diversity ≥ 2` → **adequate ≈**
- `n_evidence ≥ 4` → **tentative ⚠**
- else → **thin ·**

### F.4 — Temporal split (pre/post May 2025)

```sql
SELECT
  CASE WHEN p.created_utc < 1747699200 THEN 'pre_2025' ELSE 'post_2025' END AS era,
  p.id, p.sub, p.title, substr(p.selftext, 1, 500) AS excerpt,
  p.score, p.num_comments
FROM posts p JOIN topic_posts tp ON tp.post_id = p.id
WHERE tp.topic = :topic AND p.score >= :min_score
ORDER BY era, (p.num_comments * 2 + p.score) DESC
LIMIT :limit_per_bucket * 2;
```

### F.5 — All findings ranked by evidence

```sql
SELECT n.id, n.label, n.metadata_json,
       (SELECT count(*) FROM graph_edges e
        WHERE e.topic = n.topic AND (e.src = n.id OR e.dst = n.id)
        AND e.kind IN ('evidenced_by','wished_in','built_in','solves','about_product'))
        AS evidence_count
FROM graph_nodes n
WHERE n.topic = :topic AND n.kind = :kind  -- painpoint | feature_wish | product | workaround
ORDER BY evidence_count DESC;
```

### F.6 — Evidence posts for a node

```sql
WITH evidence_node_ids AS (
    SELECT DISTINCT CASE WHEN e.src = :node_id THEN e.dst ELSE e.src END AS node_id
    FROM graph_edges e
    WHERE e.topic = :topic AND (e.src = :node_id OR e.dst = :node_id)
      AND e.kind IN ('evidenced_by','wished_in','built_in','solves','about_product')
)
SELECT p.id, p.sub, p.source_type, p.author, p.title,
       substr(p.selftext, 1, 220) AS excerpt,
       p.score, p.num_comments, p.created_utc, p.permalink
FROM posts p
JOIN evidence_node_ids ei ON ei.node_id = :topic || '::post::' || p.id
ORDER BY (p.num_comments * 2 + p.score) DESC;
```

### F.7 — Topic inventory (for home screen topic list)

```sql
SELECT tp.topic,
       count(DISTINCT tp.post_id) AS posts,
       count(DISTINCT coalesce(p.source_type,'reddit')) AS sources,
       max(tp.added_at) AS last_collect,
       (SELECT count(*) FROM graph_nodes n
        WHERE n.topic = tp.topic AND n.kind = 'painpoint') AS painpoints
FROM topic_posts tp
LEFT JOIN posts p ON p.id = tp.post_id
GROUP BY tp.topic
ORDER BY last_collect DESC;
```

---

## 📊 Part G — Graph algorithms (NetworkX, called server-side)

All exposed via CLI and MCP:

| Function | What it returns | Use case |
|---|---|---|
| `pagerank_nodes(topic, top_n, kind?)` | Ranked by structural importance | "What painpoint is most central?" |
| `detect_communities(topic, max)` | Louvain clusters | "Which painpoints co-occur?" |
| `betweenness_bridges(topic, top_n)` | Nodes connecting separate clusters | "What's the bridge between markets?" |
| `graph_summary(topic)` | nodes, edges, density, is_dag, components | Dashboard stat |

---

## 🖥️ Part H — Flutter UI spec

### H.1 — Screens (routes)

| Route | Purpose | Key widgets |
|---|---|---|
| `/` | Topic dashboard | List of topics with inline stats, "New topic" button |
| `/topic/:id/collect` | Live collect progress | Progress bar, live log feed, cancel button |
| `/topic/:id/map` | **The hero screen** — embedded HTML gap map | WebView full-bleed, side drawer for actions |
| `/topic/:id/report` | Rendered report-pro.md | Flutter Markdown widget, pinned "Copy / Export" bar |
| `/topic/:id/corpus` | Raw posts table | DataTable with filter by source_type |
| `/ingest` | Drop local files | File picker, preview parsed rows, confirm |
| `/settings` | Config | Reddit creds status, LLM key, data dir, model |
| `/settings/license` | RevenueCat status, restore purchases | — |

### H.2 — Navigation flow

```
[Home /]  ──→ click topic ──→ [/topic/:id/map]
    │                              ├─→ [Report tab]
    │                              ├─→ [Corpus tab]
    │                              └─→ [Actions drawer: rerun collect, enrich, export, ingest file]
    └─→ "+" New topic ──→ modal → kicks off [/topic/:newid/collect]
                                      (on complete, routes to /topic/:id/map)
```

### H.3 — Home screen (`/`)

```
┌─────────────────────────────────────────────────────┐
│ OpenReply                           [Settings] [Help] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────────────────────────────────┐       │
│  │ 🔍  New topic...                         │ + Go  │
│  └──────────────────────────────────────────┘       │
│                                                     │
│  YOUR TOPICS                                        │
│  ┌──────────────────────────────────────────────┐   │
│  │ ATS resume and job search apps     [Open]    │   │
│  │ 8,682 posts · 9 sources · 15 painpoints      │   │
│  │ Last collected: 2 days ago                   │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │ UX research SaaS tools            [Open]     │   │
│  │ 762 posts · 2 sources · 8 painpoints         │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │ + Start a new research topic                 │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### H.4 — Collect screen (`/topic/:id/collect`)

Live-streaming progress from Python subprocess. Pipe stderr line-by-line:

```
┌─────────────────────────────────────────────────────┐
│ Collecting: "ATS resume and job search apps"       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [═════════════════════░░░░]  68%  ~3 min left     │
│                                                     │
│  Recent activity:                                   │
│  • fetch r/resumes top(month) limit=100             │
│  • fetch r/cscareerquestions top(year) limit=100    │
│  • search 'pain': 'frustrated with ATS resume...'  │
│  • historical r/resumes last 730d                   │
│  • source:hn — fetching…                            │
│  • source:appstore — fetching…                      │
│                                                     │
│  Counters:                                          │
│    Reddit: 3,421 posts                              │
│    HN: 30 stories                                   │
│    App Store: 250 reviews                           │
│    Play Store: 126 reviews                          │
│                                                     │
│  [Cancel]                                           │
└─────────────────────────────────────────────────────┘
```

### H.5 — Map screen (`/topic/:id/map`)

The hero screen. **Embed the existing HTML openreply-map via WebView.** The HTML already has:
- Exec summary block with copy-tweet + save-as-PNG
- Findings panel (painpoints, workarounds, products, features)
- D3 graph with skeleton mode
- Evidence panel on click

```
┌─────────────────────────────────────────────────────┐
│ ← Back to topics    "ATS resume..."     [⋮ actions] │
├─────────────────────────────────────────────────────┤
│                                                     │
│   [  EMBEDDED HTML GAP-MAP VIEWER (full bleed)  ]   │
│                                                     │
│   Left pane: exec summary + findings               │
│   Middle:    D3 force graph                         │
│   Right:     selected node evidence                 │
│                                                     │
├─────────────────────────────────────────────────────┤
│ [Map] [Report] [Corpus] [Temporal]   [Rerun] [Share]│
└─────────────────────────────────────────────────────┘

Actions drawer (⋮):
  - Rerun collect (--aggressive)
  - Enrich via Claude (LLM key) OR via MCP (paste Claude output)
  - Ingest local file
  - Export report-pro.md
  - Export raw JSON
  - Publish to openreply.io (Pro only — v2)
  - Delete topic
```

### H.6 — Report screen (`/topic/:id/report`)

Render `report-pro.md` in Flutter Markdown, with:
- Sticky "Copy markdown / Download PDF / Email to stakeholder" bar
- Jump-to sections
- Click any post link → opens in browser

### H.7 — Visual tokens (match the HTML viewer)

```dart
class AppColors {
  static const bg = Color(0xFF0B0E13);
  static const panel = Color(0xFF141921);
  static const border = Color(0xFF2A3340);
  static const text = Color(0xFFE6EDF3);
  static const muted = Color(0xFF8B949E);
  static const accent = Color(0xFF58A6FF);

  // classification badges
  static const chronic = Color(0xFFF85149);
  static const emerging = Color(0xFFFFA657);
  static const fading = Color(0xFF8B949E);

  // source-type colors (match HTML viewer)
  static const srcReddit = Color(0xFFFF4500);
  static const srcHn = Color(0xFFFF6600);
  static const srcAppStore = Color(0xFF58A6FF);
  static const srcPlayStore = Color(0xFF3FB950);
  static const srcArxiv = Color(0xFFD2A8FF);
}

// Typography: -apple-system / SF Pro / Inter
// Font sizes: 11px meta, 13px body, 15px heading, 18px title
// Radii: cards 5px, buttons 4px, pills 3px
// Spacing: 4 / 6 / 8 / 12 / 14 / 16 px
```

### H.8 — State management (Riverpod)

```dart
// Global state
final configProvider = StateNotifierProvider<ConfigNotifier, AppConfig>(...);
final topicsProvider = FutureProvider<List<Topic>>(...);

// Per-topic state
final topicProvider = FutureProvider.family<Topic, String>(...);
final findingsProvider = FutureProvider.family<Findings, String>(...);
final graphJsonProvider = FutureProvider.family<String, String>(...);  // for webview
final corpusProvider = FutureProvider.family<List<Post>, String>(...);

// Active jobs
final activeCollectProvider = StateProvider<CollectJob?>(...);
final progressStreamProvider = StreamProvider<String>(...);  // subprocess stderr
```

---

## 🔌 Part I — Subprocess contract (Flutter ↔ Python)

### I.1 — Shipping Python with the app

Bundle via `pyinstaller`:

```bash
cd reddit-myind/
uv run pyinstaller --onefile --name reddit-cli \
  --paths=src \
  --collect-all reddit_research \
  src/reddit_research/cli/main.py
# outputs: dist/reddit-cli (macOS/Linux) or dist/reddit-cli.exe (Windows)
```

Copy the binary to the Flutter app at `assets/bin/reddit-cli` + add to `pubspec.yaml` assets. At first run, extract to `<app support dir>/bin/reddit-cli` and make executable.

### I.2 — Every command uses `--json`

```dart
Future<Map<String, dynamic>> runCli(List<String> args, {
  String? dataDir,
}) async {
  final env = Map.of(Platform.environment);
  if (dataDir != null) env['REDDIT_MYIND_DATA_DIR'] = dataDir;

  final result = await Process.run(
    resolvedCliPath,
    [...args, '--json'],
    environment: env,
    runInShell: false,
  );
  if (result.exitCode != 0) {
    throw CliException(result.stderr as String, result.exitCode);
  }
  return jsonDecode(result.stdout as String) as Map<String, dynamic>;
}
```

### I.3 — Streaming commands (collect / stream)

For long-running commands pipe stderr line-by-line for progress:

```dart
final process = await Process.start(
  resolvedCliPath,
  ['research', 'collect', '--topic', topic, '--aggressive'],
  environment: env,
);
final progressController = StreamController<String>();
process.stderr.transform(utf8.decoder).transform(const LineSplitter()).listen(
  (line) => progressController.add(line),
);
final code = await process.exitCode;
```

### I.4 — The commands the UI uses

```
# Topic list (home)
reddit-cli query --json "SELECT tp.topic, count(*) posts, ..."

# Start collect
reddit-cli research collect --topic X --aggressive --sources hn,appstore,playstore

# Build graph
reddit-cli research graph build --topic X

# Enrich (CLI path, needs LLM key)
reddit-cli research graph enrich --topic X --provider anthropic

# Export HTML for the webview
reddit-cli research graph export --topic X --format html --out <path>

# Export markdown report for the report tab
reddit-cli research report-pro --topic X --out <path>

# Ingest local file
reddit-cli ingest file --path <file> --topic X --source-type interviews

# Get ranked findings as JSON (for custom UI rendering outside webview)
reddit-cli research graph export --topic X --format json
```

### I.5 — Cross-session state

Everything is in SQLite at `REDDIT_MYIND_DATA_DIR/reddit.db`. If the user closes the app mid-collect, the partial work is there; restarting `research collect` on the same topic is idempotent (dedup via primary keys + `topic_posts.PRIMARY KEY(topic, post_id)`).

---

## ⚙️ Part J — Config / settings surface

What users configure via `/settings`:

| Setting | Env var | Default | Purpose |
|---|---|---|---|
| Reddit client_id | `REDDIT_CLIENT_ID` | — | OAuth app |
| Reddit client_secret | `REDDIT_CLIENT_SECRET` | — | OAuth app |
| Reddit refresh_token | `REDDIT_REFRESH_TOKEN` | — | via `auth login` |
| Reddit user_agent | `REDDIT_USER_AGENT` | `reddit-myind/0.1` | Required by Reddit |
| Anthropic key | `ANTHROPIC_API_KEY` | — | Optional (or use Claude-MCP path) |
| OpenAI key | `OPENAI_API_KEY` | — | Alternative |
| Ollama URL | `OLLAMA_BASE_URL` | `http://localhost:11434` | Local LLM |
| GitHub token | `GITHUB_TOKEN` | — | Higher-quota GH fetches |
| YouTube key | `YOUTUBE_API_KEY` | — | Enables YouTube comments |
| NCBI key | `NCBI_API_KEY` | — | Higher-quota PubMed |
| Data dir | `REDDIT_MYIND_DATA_DIR` | `<app support>/reddit-myind` | SQLite + logs |
| Prompts dir | `REDDIT_MYIND_PROMPTS_DIR` | bundled | Override prompt templates |
| Mode override | `REDDIT_MYIND_MODE` | auto | Force `public` or `auth` |

Settings UI:
- Grouped by category (Reddit / LLM / Sources / Advanced)
- Secret fields masked
- "Verify" button per key (actually calls the relevant endpoint)
- "Reset to defaults"
- Settings file at `<app support>/reddit-myind/.env` chmod 600

---

## 📂 Part K — File locations (macOS)

```
~/Library/Application Support/com.yourco.openreply/
├── bin/
│   └── reddit-cli                       ← extracted at first run
├── reddit-myind/
│   ├── reddit.db                        ← SQLite (user data)
│   ├── .env                             ← secrets (chmod 600)
│   └── exports/
│       └── openreply-map-<topic-slug>.html    ← generated artifacts
└── logs/
    └── reddit-cli-<date>.log            ← subprocess stderr tail
```

---

## 🚀 Part L — Monetization hooks

### License gates (inside the Flutter app only — CLI stays free)

| Feature | Free | Pro ($49 lifetime) |
|---|:---:|:---:|
| All CLI features | ✅ | ✅ |
| Pretty Flutter UI | ⚠ (7-day trial) | ✅ |
| Unlimited topics | 3 | ∞ |
| Scheduled re-runs | ❌ | ✅ |
| Publish to openreply.io | ❌ | ✅ |
| Export PDF | ❌ | ✅ |
| Priority support | ❌ | ✅ |

### RevenueCat integration

```dart
// On app launch:
await Purchases.configure(...);
// Every screen that gates a feature:
final entitlements = await Purchases.getCustomerInfo();
if (!entitlements.entitlements.active.containsKey('pro')) {
  showPaywall();
}
```

Product ID: `openreply_pro_lifetime` · Price: $49 · one-time in-app purchase (no subscription).

---

## ✅ Part M — Build order (week-by-week)

**Week 1:**
- [ ] Flutter project scaffold with theme tokens + Riverpod setup
- [ ] Subprocess wrapper (`CliService`) with JSON parsing + error handling
- [ ] PyInstaller bundle of `reddit-cli` → `assets/bin/`
- [ ] Home screen with topic list (calls `reddit-cli query` for list)
- [ ] "New topic" modal → kicks off `research collect`

**Week 2:**
- [ ] Collect screen with live-streaming stderr
- [ ] Map screen with `webview_flutter` loading our HTML
- [ ] Actions drawer (rerun, enrich, export, ingest)
- [ ] Report screen with Flutter Markdown
- [ ] Corpus tab with filterable DataTable

**Week 3:**
- [ ] Settings screen with env var management + "verify" buttons
- [ ] RevenueCat setup + paywall widget
- [ ] Code signing (Apple Developer + Win cert)
- [ ] Auto-update via Sparkle (macOS) / winsparkle (Windows)
- [ ] Landing page + Gumroad checkout

**Week 4:**
- [ ] Public beta to 10 users
- [ ] Product Hunt launch prep
- [ ] Fix whatever the betas surface
- [ ] 🚀 Ship

---

## 🔮 Part N — v2 roadmap (post-launch)

From `docs/self-gap-analysis.md` — open gaps our research surfaced:

- **Emergent theme clustering** via `sentence-transformers` (replaces YAML 4-category model)
- **Slack / Intercom / Gong OAuth** (real-time vs file exports)
- **Scheduled weekly runs + diff mode** ("what changed since last week?")
- **Notion / Airtable direct export**
- **Team workspaces + cloud sync** (for $99/mo hosted tier)
- **Public openreply-map gallery** at openreply.io/explore (SEO moat)
- **Browser extension** — highlight a Reddit thread, send to tool
- **Podcast transcript ingestion** (Listennotes)
- **YouTube comments** (already stubbed, needs key)

---

## 📎 Appendix — Quick-start for the Flutter dev

```bash
# 1. Clone + set up Python CLI
git clone <this-repo> && cd reddit-myind
uv sync --all-extras
uv run reddit-cli auth login   # one-time Reddit OAuth

# 2. Bundle Python for your Flutter build
uv run pyinstaller --onefile --name reddit-cli \
  --paths=src --collect-all reddit_research \
  src/reddit_research/cli/main.py
# → dist/reddit-cli

# 3. Verify the CLI works as a subprocess
./dist/reddit-cli info
./dist/reddit-cli research discover --topic "habit tracker apps" --json

# 4. Scaffold Flutter Desktop
flutter create --platforms=macos,windows,linux openreply
cd openreply
# Copy dist/reddit-cli → assets/bin/
# Add to pubspec.yaml assets
# Start building screens per Part H above
```
