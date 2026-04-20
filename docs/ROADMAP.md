# Gap Map — Remaining phases roadmap

> Detailed build plan for every phase after Phase 1–2 (which shipped 2026-04-20). Each phase is self-contained and independently shippable. Order optimized for **retention-first**: features that turn Gap Map from one-shot research → weekly research practice come before polish.

**Last updated:** 2026-04-20
**Companion docs:**
- `docs/PROJECT_STATUS.md` — what's shipped / what's rejected
- `docs/PRODUCT_GAPS.md` — retention analysis + why
- `docs/specs/2026-04-20-insight-engine.md` — Phase 1+2 implementation spec

---

## Table of contents

- [The Dual-Mode Fork — decision point after Phase 4](#the-dual-mode-fork--decision-point-after-phase-4)
- [Phase index & status](#phase-index--status)
- [Phase 3 — Hypothesis Tracking / Decision Journal](#phase-3--hypothesis-tracking--decision-journal)
- [Phase 4 — Monitoring Mode + Weekly Delta View](#phase-4--monitoring-mode--weekly-delta-view)
- [Phase 5 — Cross-Topic Search + Dashboard Overhaul](#phase-5--cross-topic-search--dashboard-overhaul)
- [Phase 6 — Onboarding Flow + Empty-State Polish](#phase-6--onboarding-flow--empty-state-polish)
- [Phase 7 — Export Formats](#phase-7--export-formats)
- [Phase 8 — In-Product Chat Sidebar on Insights](#phase-8--in-product-chat-sidebar-on-insights)
- [Phase 9 — Competitor Matrix](#phase-9--competitor-matrix)
- [Phase 10 — Research ↔ Finding Linking via Palace](#phase-10--research--finding-linking-via-palace)
- [Phase 11 — UI Polish Cluster](#phase-11--ui-polish-cluster)
- [Cross-phase concerns](#cross-phase-concerns)
- [Explicitly out of scope](#explicitly-out-of-scope)

---

## The Dual-Mode Fork — decision point after Phase 4

`docs/DUAL_MODE_PIVOT.md` (2026-04-20) proposes a major product bet:
add a second "Product Mode" for continuous monitoring of a user's own
product + competitors, repricing at $79/$199/$499 tiers targeting
post-MVP founders instead of $20/mo indie hackers. It's a strong
strategic doc but has two open questions that deserve data before we
commit 8+ months of work:

1. **Is the thesis true?** Do 3 of 3 target founders engage weekly with
   a manually-built Product Mode dashboard? Validation playbook lives
   at `docs/VALIDATION_PLAN.md`.
2. **Cloud vs. desktop architecture.** Product Mode needs always-on
   sweeps + OAuth to private sources + multi-seat billing, which push
   toward hosted infra. Today Gap Map is local-only Tauri + SQLite.

**The fork lives here:** after shipping **Phase 3 (Hypothesis Tracking)**
and **Phase 4 (Monitoring Mode + Weekly Delta)**, both paths have the
same prerequisites. Those two features are load-bearing regardless —
they ship as Topic-Mode enhancements and 100% become Product-Mode
primitives later. No wasted work.

```
                          [ Phase 1 + 2 SHIPPED ]
                                   │
                                   ▼
                    [ Phase 3 — Hypothesis Tracking ]   ←── next
                                   │
                                   ▼
                   [ Phase 4 — Monitoring + Delta ]
                                   │
                                   ▼
                      [ 3-founder VALIDATION ]
                                   │
                  ┌────────────────┴─────────────────┐
                  │                                  │
                  ▼                                  ▼
          ✓  Thesis holds                   ✗  Thesis fails
          (≥ 2/3 engage weekly)             (≤ 1/3 engage)
                  │                                  │
                  ▼                                  ▼
        DUAL-MODE PIVOT PATH              ROADMAP PATH (unchanged)
        ─────────────────────             ─────────────────────
        Phase A: Product/Competitor       Phase 5: Cross-topic search
                data model                Phase 6: Onboarding polish
        Phase B: Cloud infra + auth       Phase 7: Export formats
        Phase C: Connected sources        Phase 8: Chat sidebar
                (Intercom/Zendesk/Stripe) Phase 9: Competitor matrix
        Phase D: Billing + tiers          Phase 10: Palace linking
        Phase E: Team seats + Slack       Phase 11: UI polish
        Phase F: Topic→Product convert
        (~8–10 mo solo, or ~5 mo w/ 3 devs)    (~5 weeks solo)
```

**The Phase 5–11 sequencing below is the ROADMAP PATH** — the
conservative default that Gap Map becomes a high-quality research
tool with hypothesis tracking + weekly delta monitoring, priced at
$20–40/mo for Topic Mode users.

If validation succeeds, phases 5–11 get DEPRIORITIZED (not rejected)
in favor of the Dual-Mode roadmap in `DUAL_MODE_PIVOT.md` §11.
Hypothesis tracking + monitoring stay; onboarding + exports + chat +
polish ship later as quality-of-life improvements once Product Mode
is live.

See `docs/VALIDATION_PLAN.md` for the concrete experiment design.

---

## Phase index & status

| # | Phase | Goal | Effort | Status | Dependency |
|---|---|---|---|---|---|
| 1 | Claude-native synthesis | One-shot LLM call replacing 4 extractors | 4 d | ✅ shipped | — |
| 2 | Methodology-grade rigor layer | Minto + hypotheses + counter-evidence + Ulwick + CI | 5.5 d | ✅ shipped | Phase 1 |
| 3 | Hypothesis tracking / decision journal | Make each hypothesis card stateful → weekly ritual | 3 d | 🔜 next | Phase 2 |
| 4 | Monitoring mode + weekly delta | Scheduled re-collect + "what's new" view | 5 d | 🔜 | Phase 3 |
| 5 | Cross-topic search + dashboard overhaul | Leaderboard + global search | 3 d | 🔜 | Phase 4 |
| 6 | Onboarding + empty states | First-run flow + actionable emptys | 2 d | 🔜 | none strict |
| 7 | Export formats (PDF / Markdown / PDF card) | Shareable briefs for distribution | 4 d | 🟡 queued | Phase 2 |
| 8 | In-product chat sidebar on Insights | Follow-up Q&A without leaving page | 3 d | 🟡 queued | Phase 2 |
| 9 | Competitor matrix | Feature × product table | 2 d | 🟡 queued | Phase 2 |
| 10 | Research ↔ finding palace linking | Semantic match papers to painpoints | 2 d | 🟡 queued | Phase 2 + palace |
| 11 | UI polish cluster (tabs, cards, dark mode, shortcuts) | Friction reduction across existing surfaces | 3 d | 🟡 queued | any |

**Total remaining: ~30 days of focused build work** to reach the "research SaaS" endpoint.

---

## Phase 3 — Hypothesis Tracking / Decision Journal

### 3.1 Goal

Turn every hypothesis card from read-only prose into a **stateful, trackable bet**. Users return weekly to update states, building Gap Map into the canonical "where I track my product bets" tool.

### 3.2 Why this first

Without it, Gap Map is one-shot research. With it, it's a research PRACTICE. This is the single biggest retention lever available and it depends on nothing beyond Phase 2.

### 3.3 Schema additions

New SQLite table `hypothesis_tests`:

```sql
CREATE TABLE hypothesis_tests (
  id                TEXT PRIMARY KEY,         -- uuid
  topic             TEXT NOT NULL,
  card_json         TEXT NOT NULL,            -- full hypothesis card (frozen at start)
  status            TEXT NOT NULL,            -- 'draft' | 'running' | 'validated' | 'invalidated' | 'paused' | 'archived'
  started_at        TEXT,                     -- ISO UTC, set when status→running
  resolved_at       TEXT,                     -- ISO UTC, set when validated/invalidated
  resolution_notes  TEXT,                     -- free-form user notes
  linked_evidence   TEXT,                     -- JSON list of URLs/screenshots/etc.
  last_updated      TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
CREATE INDEX idx_hypothesis_topic ON hypothesis_tests(topic);
CREATE INDEX idx_hypothesis_status ON hypothesis_tests(status);
```

Added to `init_schema` in `src/reddit_research/core/db.py`.

### 3.4 Backend work

**Files:**
- `src/reddit_research/research/hypothesis_tracker.py` (new) — CRUD helpers
    - `create_hypothesis_test(topic, card) -> id`
    - `update_status(id, status, notes=None) -> dict`
    - `list_hypotheses(topic=None, status=None) -> list`
    - `delete_hypothesis(id)` (soft-delete via status='archived')
- `src/reddit_research/cli/main.py` — new commands under `research hypothesis`:
    - `create --topic T --from-insights-card INDEX` (creates from nth card in topic_insights)
    - `update --id X --status running --notes "..."`
    - `list [--topic T] [--status S] --json`
- `app-tauri/src-tauri/src/commands.rs` — Tauri commands:
    - `hypothesis_create(topic, card_json)`
    - `hypothesis_update_status(id, status, notes)`
    - `hypothesis_list(topic=None, status=None)`
    - `hypothesis_delete(id)`

### 3.5 Frontend work

- `app-tauri/src/api.js` — `api.hypothesisCreate()`, `api.hypothesisUpdate()`, `api.hypothesisList()`.
- `app-tauri/src/screens/insights.js` — each hypothesis card gets a **state selector + "Start this test" button**. If no existing test row → shows "Save as bet"; if linked → shows current state + "update" button.
- New tab in topic page: **Bets** (replacing or joining Actions) — lists all tracked hypotheses for that topic.
- New dashboard section: **My active bets** — grouped by status across all topics.

### 3.6 UX additions

- Hypothesis card state pill with 5 colors: draft (gray) / running (blue) / validated (green) / invalidated (red) / paused (yellow).
- On state→validated: prompt "What evidence confirmed it?" → stores to `resolution_notes`.
- On state→invalidated: same, different prompt.
- Notification (native macOS) when test passes its `time_box_days` without resolution: "Your bet on X is due today — what happened?"

### 3.7 Success criteria

- A user can click "Start this test" on any hypothesis card → see it in the Bets tab → mark validated/invalidated with notes → close app.
- Next open of the app: the decision persists; score can be filtered by state.
- Dashboard shows "2 bets validated · 1 running · 3 paused" at-a-glance.

### 3.8 Out of scope for Phase 3

- Linking bets to Linear/Jira tickets (Phase 7 export layer).
- Team sharing (solo-user product for now).
- Automated resolution detection (monitor mode in Phase 4 could suggest "our weekly scan found a competitor that addresses this — consider resolving").

---

## Phase 4 — Monitoring Mode + Weekly Delta View

### 4.1 Goal

Scheduled re-collect + synthesis for pinned topics → dashboard shows "what's changed this week." Turns Gap Map into a **Monday-morning check-in app**.

### 4.2 Why this next

The biggest single retention driver possible. Every user with ≥1 pinned topic now has a reason to open the app every Monday. Native notification on collect completion makes it frictionless.

### 4.3 Schema additions

Augment existing `topic_prefs` with scheduling fields (already partially there). Add:

```sql
CREATE TABLE topic_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  topic         TEXT NOT NULL,
  run_at        TEXT NOT NULL,                 -- ISO UTC
  trigger       TEXT NOT NULL,                 -- 'manual' | 'scheduled'
  corpus_delta  TEXT,                          -- JSON: {added: N, removed: M, sources_changed: [...]}
  findings_delta TEXT,                         -- JSON: {added: [titles], score_changes: [{title, old, new}]}
  ended_at      TEXT,
  error         TEXT
);
CREATE INDEX idx_topic_runs ON topic_runs(topic, run_at DESC);
```

### 4.4 Backend work

- `src/reddit_research/research/monitor.py` (new):
    - `weekly_tick()` — finds all scheduled topics, runs collect + synthesize, writes `topic_runs` delta.
    - `compute_delta(topic, prev_run_id, cur_run_id) -> dict` — diffs findings, scores, competitors, academic_backing between two runs.
- `src/reddit_research/cli/main.py` — `research monitor --once` (for testing) and `research monitor --watch` (for launchd).
- Uses existing `launchd` infra in `app-tauri/src-tauri/src/schedule.rs` — just add a new plist entry for `research monitor --once` at weekly cadence.

### 4.5 Frontend work

- `app-tauri/src/screens/home.js` (Dashboard):
    - New top card: **"What's changed this week"** — lists topics with deltas since last run.
    - Each delta item shows: `↑ 2 new painpoints`, `Score changed: +1.8` per finding, `🆕 New competitor: Headspace`.
- Insights tab: per-finding delta indicator `↑ opp 13.2 → 15.4 (+2.2) since Apr 13`.
- Settings: schedule toggle per topic (already exists), global cadence (daily / weekly / monthly).

### 4.6 Native OS notifications

- Use `tauri_plugin_notification` (already in Tauri v2 bundle).
- Fire on: `monitor` completion with deltas, hypothesis test `time_box_days` expiry.
- User-configurable (Settings → Notifications toggle).

### 4.7 Success criteria

- A user pins 3 topics.
- Monday morning: native notification "Gap Map: 3 topics updated, 5 new findings."
- Click notification → app opens to Dashboard with "What's changed" card highlighting the 5 new findings.
- User spends 4 minutes reviewing, updates 1 hypothesis state, closes app. **Habit formed.**

### 4.8 Out of scope for Phase 4

- Email / Slack / Discord webhooks (Phase 7 export concerns).
- Per-source scheduling (just per-topic for now).
- Anomaly detection / alerting on spikes (post-PMF signal).

---

## Phase 5 — Cross-Topic Search + Dashboard Overhaul

### 5.1 Goal

Cross-topic leaderboard ("top opportunities across everything I'm tracking") + global semantic search ("show me every painpoint mentioning 'subscription fatigue' across all my research"). Turns Gap Map from **islands of research** into a **compounding research library**.

### 5.2 Why this third

Value compounds with topic count. User with 5 topics has 5× the need for this; user with 1 topic won't notice. So ship AFTER retention features (Phases 3+4) drive users toward having more topics.

### 5.3 Schema additions

No new tables. Add indexes for cross-topic queries:

```sql
CREATE INDEX IF NOT EXISTS idx_graph_nodes_kind_topic ON graph_nodes(kind, topic);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_metadata ON graph_nodes(kind) WHERE kind IN ('painpoint','product','feature_wish','workaround');
```

### 5.4 Backend work

- `src/reddit_research/research/cross_topic.py` (new):
    - `top_opportunities_across_topics(limit=20) -> list[dict]` — joins `graph_nodes` across all topics, sorts by Ulwick `opportunity_score`.
    - `search_findings(query, topic_filter=None) -> list[dict]` — uses semantic palace (already exists) + BM25 over `graph_nodes.label + metadata_json`.
    - `related_topics(topic, limit=5) -> list[str]` — Jaccard similarity over painpoint/product sets.
- CLI: `research top-opportunities --json`, `research search-findings --query X --json`.
- Tauri commands: `top_opportunities`, `search_findings`, `related_topics`.

### 5.5 Frontend work

- `app-tauri/src/screens/home.js` (Dashboard) — rewrite:
    - **Header:** global search bar (⌘K to focus).
    - **Section 1:** "Top opportunities" — leaderboard across all topics, score-sorted.
    - **Section 2:** "What's new this week" (from Phase 4).
    - **Section 3:** topic grid (secondary nav, demoted from main view).
- Search results page: each hit shows finding title + topic + opportunity score + best_quote + "view in topic →".
- On topic page: "Related topics" sidebar showing 3–5 topics with overlap.

### 5.6 Success criteria

- User with 5 topics opens Dashboard → immediately sees the top 10 opportunities (not the 5 topic squares).
- User presses ⌘K, types "voice" → sees every finding mentioning voice across all topics.
- User clicks "related topics" on Topic A → navigates to Topic B.

### 5.7 Out of scope

- Team-shared search (solo-user product).
- Saved searches / alerts on queries (Phase 4 territory, deferred).

---

## Phase 6 — Onboarding Flow + Empty-State Polish

### 6.1 Goal

Fresh install → first Minto brief in ≤30 s of user action. Every empty state gives a specific, actionable next step.

### 6.2 Why

D1 retention depends on this. Users get lost at "type a topic name" today.

### 6.3 Backend work

Minimal. One new helper in `research/canon.py`:
- `suggest_topic_from_url(url) -> str` — scrapes the URL (or uses its meta description), asks Claude to classify → returns a topic string. Gated behind user-pasted URL.

### 6.4 Frontend work

- `app-tauri/src/screens/welcome.js` — redesign:
    - Hero: "What are you researching?"
    - 5 quick-start chips: "AI coding assistants", "sleep tracking apps", "no-code website builders", "meditation apps", "resume builders"
    - Free-text input (existing modal logic reused)
    - **URL paste field:** "Or drop a competitor website URL → we'll suggest a topic"
    - "Skip example" → go to empty dashboard with clear CTA
- Every empty state rewritten:
    - **Dashboard, 0 topics:** "Let's find your first opportunity" + the 5 quick-start chips.
    - **Topic, 0 findings:** "Enrichment didn't produce findings. [reasons: LLM not configured / collect failed / corpus too small]. Try: [run collect again / add LLM key / pick broader topic]."
    - **Insights, before generation:** "Click below to generate a Minto-structured brief from your [N] collected posts. Takes ~90 s with Claude."
    - **Bets tab (Phase 3), 0 bets:** "Your tracked hypotheses will appear here. Start by clicking 'Save as bet' on any hypothesis card in the Insights tab."

### 6.5 Success criteria

- Fresh user sees Welcome → clicks a quick-start chip → first collect starts in ≤30 s.
- During collect: narrated progress ("searching Reddit…", "fetching arXiv…") instead of raw log dump.
- After collect: lands on Insights with a subtle tooltip pointing at the Minto header: "This is the answer. Read this first."
- Every dead-end screen becomes a live one.

### 6.6 Effort

2 days. Most of the code exists; this is rewrites + 1 new helper.

---

## Phase 7 — Export Formats

### 7.1 Goal

Users who do great research want to share. Every share = new user exposure. Zero share surface today.

### 7.2 Formats to ship (priority)

1. **One-page PDF opportunity brief** — Minto-structured, CI-chart quadrant included, citations footer.
2. **Markdown brief for Notion / Linear paste** — no images, just structured text.
3. **Hypothesis card PDFs** — one card per page, printable for interview prep.

Deferred to Phase 7.5 if demand:
- Figma-ready SVG of the quadrant
- BibTeX for the citation bundle (academic users)
- CSV of all findings (for Excel users)

### 7.3 Backend work

- `src/reddit_research/research/export_brief.py` (new):
    - `export_markdown(topic) -> str` — uses `topic_insights.report_json`, formats to Minto-structured markdown.
    - `export_pdf(topic, out_path)` — markdown → HTML → PDF via `weasyprint` (already transitive dep via `chromadb`? check; fallback: `reportlab`).
    - `export_hypothesis_pdfs(topic, out_dir)` — one PDF per tracked hypothesis.
- CLI: `research export --topic T --format pdf|md|hyp-pdfs --out PATH`.
- Tauri commands: `export_brief_pdf(topic) -> path`, `export_brief_md(topic) -> str`, `export_hypothesis_pdfs(topic) -> [paths]`.

### 7.4 Frontend work

- Insights tab toolbar: **Export** split-button with PDF / Markdown / Hypothesis cards options.
- On export: native file dialog for PDF save location; markdown copies to clipboard with toast "Copied — paste into Notion."

### 7.5 Layout (Minto PDF)

```
┌─────────────────────────────────────────────────────────────┐
│  GAP MAP BRIEF — [Topic name]               [Date] [logo]   │
├─────────────────────────────────────────────────────────────┤
│  THE ANSWER                                                  │
│  [Governing thought, 19pt, bold, 1 sentence]                │
├─────────────────────────────────────────────────────────────┤
│  WHY                                                         │
│  ① [Argument 1]          ② [Argument 2]    ③ [Argument 3]   │
│    • cite id1              • cite id1        • cite id1     │
│    • cite id2              • cite id2        • cite id2     │
├─────────────────────────────────────────────────────────────┤
│  TOP 5 OPPORTUNITIES                                         │
│  ┌────────────────────────────────────────┐                  │
│  │ 1. [Title]    opp 15.3   [triang 🟢]   │                  │
│  │    "[Best quote]"                       │                  │
│  │    Test: [cheapest_test]                │                  │
│  └────────────────────────────────────────┘                  │
│  (… 4 more cards)                                             │
├─────────────────────────────────────────────────────────────┤
│  EVIDENCE QUADRANT                                           │
│  [embedded SVG of the 2×2 from Insights tab]                │
├─────────────────────────────────────────────────────────────┤
│  CITATIONS                                                   │
│  [cite_id1] r/sleep · u/foo — "[snippet]"                   │
│  [cite_id2] arXiv:2401.12345 — "[title]"                    │
│  …                                                           │
└─────────────────────────────────────────────────────────────┘
```

### 7.6 Success criteria

- User clicks Export → PDF → opens in Preview → looks consulting-grade.
- User clicks Export → Markdown → pastes into Notion → renders cleanly.
- Sharing the PDF brings in ≥1 new signup per share (measurable via invite codes in Phase 7.5).

### 7.7 Effort

4 days across all three formats. `weasyprint` tends to install cleanly; fallback to `reportlab` if PyInstaller bundle size becomes an issue.

---

## Phase 8 — In-Product Chat Sidebar on Insights

### 8.1 Goal

After reading a brief, users always have follow-up questions. Today they must open the Chat tab (buried). Bring chat into the Insights tab as a persistent sidebar.

### 8.2 Backend work

- `src/reddit_research/research/chat.py` — already has agent tool-use. Extend `AGENT_TOOLS` with 3 new tools:
    - `get_hypothesis_card(index)` — fetches card N from topic_insights.
    - `compare_topics(topics: list[str])` — delegates to Phase 5 `related_topics`.
    - `synthesize_mini_brief(query: str)` — runs a sub-synthesis on filtered corpus matching the query.
- No new schema.

### 8.3 Frontend work

- `app-tauri/src/screens/insights.js` — add a right-hand panel (collapsible):
    - Sticky to viewport; resizable.
    - Pre-seeded prompt chips:
        - "What are the top 3 risks?"
        - "Who's the incumbent I'd compete against?"
        - "What's the smallest experiment to test this?"
        - "Is this big in EU vs US?"
    - Streams tokens in-place (reuses `api.startChat` / `chat:progress` event).
- Chat panel state persists per topic.
- Keyboard: `/` focuses chat input.

### 8.4 Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  INSIGHTS                                         │  🗨 Ask      │
├───────────────────────────────────────────────────┤  chat       │
│  [Minto header]                                   │  history    │
│  [Quadrant]                                       │  …          │
│  [Hypothesis cards]                               │  ──────────│
│  [Finding cards]                                  │  [input]   │
└───────────────────────────────────────────────────┴──────────────┘
```

### 8.5 Success criteria

- On Insights tab, chat is ≤1 click away at all times.
- User reads the Minto header, clicks "What are the top 3 risks?" chip, gets a cited answer in 15 s.
- Chat history persists; user returns tomorrow, sees yesterday's Q&A.

### 8.6 Effort

3 days — most heavy lifting (agent, tool-use) already exists.

---

## Phase 9 — Competitor Matrix

### 9.1 Goal

Auto-extract every named product + its evidenced feature mentions → build a **feature × competitor table**. Answer "what does the competitive space look like" visually.

### 9.2 Schema additions

None. Competitors + features are already in `graph_nodes` (`kind='product'`, `kind='feature'`). Just need a query join + render.

### 9.3 Backend work

- `src/reddit_research/research/competitors.py` (new):
    - `build_matrix(topic) -> dict` — returns `{features: [...], competitors: [...], matrix: {(feature, competitor): 'has'|'missing'|'partial'|'unknown'}}`.
    - `market_position(topic) -> dict` — groups competitors by pricing tier × feature breadth (for a positioning map).
- CLI: `research competitor-matrix --topic T --json`.
- Tauri command: `competitor_matrix(topic)`.

### 9.4 Frontend work

- `app-tauri/src/screens/insights.js` — replace the current competitor list section with a proper matrix:
    - Rows = features (union of all feature mentions across competitors).
    - Columns = competitors (sorted by mention count).
    - Cells = ✓ / ✗ / ~ (partial) / — (unknown).
    - Hover on cell = evidence post_id that supports the claim.
- Toggle: "matrix view" vs. "list view" (current).

### 9.5 Success criteria

- User with 5+ competitors in a topic sees a clear table showing which competitor has which feature.
- User can spot a row with all ✗ → that's a Blue Ocean feature opportunity.

### 9.6 Effort

2 days. Pure data-join + table render.

---

## Phase 10 — Research ↔ Finding Linking via Palace

### 10.1 Goal

Match each painpoint to the top-3 most semantically similar academic papers in the corpus. Surface as "📄 Research backing" on finding cards with actual citations.

### 10.2 Schema additions

```sql
CREATE TABLE finding_research_links (
  finding_node_id TEXT NOT NULL,
  paper_post_id   TEXT NOT NULL,
  similarity      REAL NOT NULL,
  linked_at       TEXT NOT NULL,
  PRIMARY KEY (finding_node_id, paper_post_id)
);
```

### 10.3 Backend work

- `src/reddit_research/research/research_linker.py` (new):
    - Uses existing ChromaDB palace. For every `kind='painpoint'` node, embed its `label + metadata.evidence`, find top-3 posts where `source_type IN ('arxiv','openalex','pubmed','scholar','ingest')`, persist to `finding_research_links`.
- Runs as a step in `synthesize_insights` pipeline (after findings are persisted).
- CLI: `research link-research --topic T`.

### 10.4 Frontend work

- Finding card's "📄 N papers" chip becomes clickable → modal lists the linked papers with titles + authors + similarity scores + "Read on arXiv" links.
- Insights exec summary synthesis prompt updated to reference linked papers when discussing each finding.

### 10.5 Success criteria

- A finding about "blue-light sleep disruption" is linked to arXiv paper "Effects of 480nm light on melatonin suppression."
- User clicks "📄 3 papers" → sees the papers → reads one.

### 10.6 Effort

2 days. Palace infra exists; this is the consumer.

---

## Phase 11 — UI Polish Cluster

Non-structural improvements to existing surfaces. Ship in one batch after Phases 3–5.

### 11.1 Tab cleanup on topic page

Current: 12 tabs. Proposed:
- **Primary (always visible):** Insights · Bets · Evidence · Chat
- **More (dropdown):** Map · Report · Trends · Sentiment · Sources · Posts · Research · Solutions

Effort: 0.5 day.

### 11.2 Finding card density reduction

Current: 8+ chips per card. Proposed:
- **Tier 1 (always visible):** Ulwick score · triangulation · counter-evidence.
- **Tier 2 (on hover OR expand):** all other chips (imp/sat/cov/classification/academic/CI/citations).

Effort: 0.5 day (CSS + conditional rendering).

### 11.3 Dashboard overhaul

(See Phase 5 — already covered there.)

### 11.4 Dark mode

Toggle in Settings. Requires a CSS variable pass (we already use `var(--ink-1)` etc.). Just needs dark-palette definitions.

Effort: 1.5 days.

### 11.5 Keyboard shortcuts

- `⌘K` — global search (Phase 5)
- `⌘N` — new topic (exists)
- `?` — help panel (exists)
- `J/K` — navigate hypothesis cards
- `/` — focus chat input (Phase 8)
- `⌘,` — settings

Effort: 0.5 day.

### 11.6 Topic comparison view

New route `/compare/:topicA/:topicB` → side-by-side Minto + quadrants.

Effort: 1 day.

### 11.7 Progressive insights during collect

Stream partial findings during collect: Reddit-only at 30 s → + HN at 60 s → full brief at 3 min. Reduces perceived latency.

Effort: 1 day (but depends on restructuring the synthesize call to accept partial corpora).

**Total for Phase 11: ~5 days across 7 polish items.**

---

## Cross-phase concerns

### CC.1 Data migrations

Each new table (`hypothesis_tests`, `topic_runs`, `finding_research_links`) added to `init_schema` in `core/db.py`. Idempotent creation. No destructive migrations needed — all additive.

### CC.2 LFS budget

Every sidecar rebuild adds ~220 MB to LFS storage. Free tier = 1 GB. After ~4 rebuilds we'll hit the cap. Mitigation:
- `git lfs prune --verify-remote` quarterly to drop unreferenced blobs.
- Upgrade to a Data Pack ($5/mo for 50 GB) if we need >4 rebuilds per cycle.

### CC.3 Provider cost tracking

Phase 1 set per-provider corpus caps. As we add hypothesis regeneration, weekly auto-refresh, and Minto synthesis per topic, LLM costs accrue. Before Phase 4 ships monitoring mode, add:
- `llm_usage` table: `{topic, command, input_tokens, output_tokens, provider, model, timestamp, cost_usd}`
- Settings panel shows running cost per topic + monthly total
- Soft budget cap: warn user when monthly cost projection exceeds their set limit

Effort: 1 day added to Phase 4.

### CC.4 Testing strategy

Currently zero unit tests for the Insight Engine. Before Phase 7 (where we ship publicly-consumable PDFs), add:
- Unit tests for `_select_corpus`, `_normalize_scores`, `_credible_interval`, `_validate_hypothesis`.
- Integration test: run `synthesize_insights` on a frozen 50-post fixture corpus, assert output matches a golden JSON shape.
- UI smoke test via Playwright: open topic → Insights → hypothesis card → counter-evidence modal → Bets tab.

Effort: 2 days, spread across Phases 3+7.

### CC.5 Performance budget

Insights tab target: ≤1 s from tab click to full render on cached report. Monitor:
- `topic_insights.report_json` grows with hypothesis + findings → keep under 100 KB per topic.
- Dashboard cross-topic leaderboard (Phase 5) should query in ≤200 ms even at 50 topics. Add pagination if topic count ever exceeds 100.

---

## Explicitly out of scope

(Copied from `docs/PROJECT_STATUS.md` §2 and `docs/PRODUCT_GAPS.md` §7 for this doc's self-containedness.)

Not building, with reasons:

- **Issue trees / SCQA as user-facing step** — consulting workflow, not product flow.
- **Dual-model κ adjudication** — 2× cost for <5% gain.
- **30-source expansion** — diminishing returns past 13.
- **Neo4j migration** — SQLite scales fine.
- **Weekly human-QA dashboard with Krippendorff's α** — ship a "flag as wrong" button instead.
- **BibTeX export / reproducibility snapshots** — academic-only, zero founder value.
- **Adversarial test harness** — post-PMF.
- **CrewAI / multi-agent orchestration** — current tool-use agent delivers same value, 10% complexity.
- **Team workspaces / multi-user** — solo-user product for now. Revisit at 1000+ users.
- **Ads / tracking pixels / growth hacks** — pro-tool users pay; no ads.
- **Email drip campaigns** — desktop app, native notifications handle it.
- **Gamification / badges / streaks** — clout doesn't sell to serious founders.

---

## Sequence recap

**Next 6 weeks of focused work:**

```
Week 1        Week 2       Week 3       Week 4       Week 5       Week 6
───────      ───────      ───────      ───────      ───────      ───────
Phase 3      Phase 4      Phase 5      Phase 6      Phase 7      Phase 8
Hypothesis   Monitoring   Cross-topic  Onboarding   Export       Chat
tracking     + deltas     + dashboard  + empty      formats      sidebar
                          overhaul     states
(3 days)     (5 days)     (3 days)     (2 days)     (4 days)     (3 days)
```

**End state:** Gap Map is a **research-SaaS ritual** for pre-PMF founders. Weekly return loop is locked in. Shareable output drives virality. Compounding value per topic.

**Phases 9–11 (Competitor matrix, research linking, polish):** another 8 days across weeks 7–8 to round out the product before hitting the first external user cohort.

---

*This doc is a build plan. When prioritizing an issue, cross-reference against the phase it fits in and its Dependency column. Don't rearrange phases without a written reason — the retention-first sequence is load-bearing.*
