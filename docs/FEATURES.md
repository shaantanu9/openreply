# Gap Map — Features & Usage Guide

> A complete inventory of what's shipped, how to use it, and an honest coverage map against the Dual-Mode Pivot.

**Version:** 2026-04-20 (post-Dual-Mode-foundation)
**Status:** All 11 ROADMAP phases + DUAL_MODE_PIVOT Phases A/B/C/F shipped. Phases D (OAuth), E (billing), G (cloud/share) deferred — see §15.
**Related:** `docs/ROADMAP.md`, `docs/DUAL_MODE_PIVOT.md`, `docs/GAP_MAP_METHODOLOGY.md`, `docs/GAP_MAP_GUIDE.md`

---

## Table of contents

1. [What Gap Map is, today](#1-what-gap-map-is-today)
2. [Phase 1 — Claude-native synthesis](#2-phase-1--claude-native-synthesis)
3. [Phase 2 — Methodology rigor layer](#3-phase-2--methodology-rigor-layer)
4. [Phase 3 — Hypothesis tracking & decision journal](#4-phase-3--hypothesis-tracking--decision-journal)
5. [Phase 4 — Monitoring & weekly delta](#5-phase-4--monitoring--weekly-delta)
6. [Phase 5 — Cross-topic search & leaderboard](#6-phase-5--cross-topic-search--leaderboard)
7. [Phase 6 — Onboarding & empty-state polish](#7-phase-6--onboarding--empty-state-polish)
8. [Phase 7 — Export formats](#8-phase-7--export-formats)
9. [Phase 8 — Chat sidebar on Insights](#9-phase-8--chat-sidebar-on-insights)
10. [Phase 9 — Competitor matrix](#10-phase-9--competitor-matrix)
11. [Phase 10 — Research-to-finding linker](#11-phase-10--research-to-finding-linker)
12. [Phase 11 — Polish cluster](#12-phase-11--polish-cluster)
13. [Keyboard shortcuts (full list)](#13-keyboard-shortcuts-full-list)
14. [LLM & data infrastructure](#14-llm--data-infrastructure)
15. [Coverage vs Dual-Mode Pivot](#15-coverage-vs-dual-mode-pivot)
16. [Next steps](#16-next-steps)

---

## 1. What Gap Map is, today

Gap Map is a **local-first desktop research app** (Tauri 2 + vanilla-JS frontend + PyInstaller-bundled Python sidecar) that turns a topic into a decision-ready brief.

**Core loop that exists today:**

```
Type topic  →  Collect multi-source corpus  →  One-shot LLM synthesis  →
  Minto-structured brief  →  Hypothesis cards  →  Track bets  →
  Weekly monitoring sweep  →  Export (markdown/Slack) / Ask follow-ups in chat
```

**13+ data sources:** Reddit, Hacker News, Dev.to, Stack Overflow, arXiv, OpenAlex, PubMed, Google Scholar, App Store, Play Store, GitHub issues/repos, GNews, Wikipedia, Discourse, Lemmy, Mastodon, Historical/RSS. Full list in `src/reddit_research/sources/`.

**8 LLM providers supported:** Anthropic, OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Google Gemini, Ollama (local). Auto-resolved via `resolve_provider()`.

**100% local:** SQLite at `~/Library/Application Support/com.reddit.myind/`. No server. No sign-up. Your keys, your data.

**Synthesis methodology (baked in):** Minto Pyramid, Ulwick Opportunity Scoring, Popper Falsifiability, Triangulation (Denzin 1978), Bayesian credible intervals (Beta-binomial).

---

## 2. Phase 1 — Claude-native synthesis

**Shipped:** 2026-04-20 · `changelogs/2026-04-20_05_insight-engine-phase1.md`

**What it does:** One-shot LLM call replaces the previous 4-extractor pipeline. Takes the entire topic corpus, packs it into a single prompt (provider-aware caps), returns a structured JSON report.

**Usage:**
- Open any topic → **Insights** tab → click **Generate insights**.
- First run takes 30–90 s on a full corpus.
- Subsequent loads are instant (cached in `topic_insights.report_json`).
- Click **Regenerate** to re-run the LLM.

**What you get:**
- `executive_summary` — narrative paragraph
- `findings[]` — ranked painpoints / feature wishes / workarounds with evidence
- `competitors[]` — named products with features & weaknesses
- `corpus_coverage` — posts considered, sources represented
- `_generated_at`, `_provider`, `_model` — provenance

**Per-provider corpus caps (prevents OOM/credit errors):**
| Provider | Cap | Max output tokens |
|---|---|---|
| Anthropic | 2000 posts | 12000 |
| OpenAI | 1500 posts | 8000 |
| Google Gemini | 2000 posts | 8000 |
| OpenRouter | 400 posts | 4000 |
| DeepSeek | 800 posts | 6000 |
| Mistral | 600 posts | 6000 |
| Groq | 300 posts | 3000 |
| Ollama | 100 posts | 2000 |

**Resilience:** Two-dimensional retry ladder. Output-overflow → halve max_tokens; input-overflow → halve corpus. Partial-JSON recovery (`_try_recover_truncated_json`) reassembles truncated LLM output when free-tier tokens run out.

**Code paths:**
- `src/reddit_research/research/insights.py`
- CLI: `reddit-cli research synthesize --topic "<name>" --json`
- Tauri: `api.synthesizeInsights(topic, useCache)`

---

## 3. Phase 2 — Methodology rigor layer

**Shipped:** 2026-04-20 · `changelogs/2026-04-20_07_insight-engine-phase2.md`

**What it adds:** The Insights JSON gains six methodology-grade fields that turn raw LLM output into a defensible brief:

### 3.1 Minto Pyramid header

The Insights tab opens with a big **"The answer"** callout (governing thought, 1 sentence) and 3 numbered key arguments with citations. Minto's rule: a reader should be able to stop after sentence one and have the decision.

**Usage:** Rendered automatically at the top of Insights tab above the quadrant.

### 3.2 Hypothesis cards (Popper-validated)

Every synthesis emits 3–5 hypothesis cards with mandatory structure:
- **WE BELIEVE** (assumption)
- **EXPERIENCES / AND WOULD / FOR** (Ulwick-style job statement)
- **Falsifiers** (≥1 required — without these the card is rejected)
- **Cheapest test** (≤2 weeks, ≤$X budget)

Cards that fail the Popper validator get listed in a collapsed `details` block with the validator errors.

**Usage:** Auto-populated on Insights tab below the Minto header. Click any card to expand. Click **"Save as bet"** to promote to Bets tab (Phase 3).

### 3.3 Counter-evidence chips (⚖ N disagree)

Every finding has a `disconfirming_evidence: [post_ids]` array. Click the **⚖ N disagree** chip → modal shows the actual disconfirming posts from the corpus. Biggest credibility feature per methodology doc §6.2.

### 3.4 Ulwick Opportunity Score

Each finding gets `opportunity_score = importance + max(importance − satisfaction, 0)` on a 0-20 scale. Rendered as a colored badge:
- **≥15** red = extreme opportunity
- **10–14** orange = clear opportunity
- **<10** gray = overserved market

### 3.5 Triangulation badges (🟢/🟡/🔴)

- 🟢 **strong** = ≥3 source types
- 🟡 **moderate** = 2 source types
- 🔴 **narrow** = 1 source type (single-channel risk)

### 3.6 Bayesian credible intervals

Every finding gets `evidence_prevalence_ci = {lower_pct, upper_pct, confidence}` from a Beta-binomial on (hits, corpus_size). Rendered as a **📊 X%–Y% of corpus** chip. Honest statistical range instead of raw N.

**Code paths:**
- `src/reddit_research/research/insights.py` → `_normalize_scores`, `_validate_hypothesis`, `_credible_interval`
- `app-tauri/src/screens/insights.js` → `renderMinto`, `renderHypothesisCard`, `renderFindingCard`

---

## 4. Phase 3 — Hypothesis tracking & decision journal

**Shipped:** 2026-04-20 · `changelogs/2026-04-20_08_phase3-hypothesis-tracking.md`

**What it does:** Promotes read-only hypothesis cards into **stateful, trackable bets** with a 6-state machine and append-only journal. This is the single biggest retention lever — turns one-shot research into a research *practice*.

**State machine:**
```
draft → running → validated  ┐
                 invalidated ├→ archived
                 paused      ┘
```

**Usage:**
1. Open any topic → **Insights** → expand a hypothesis card → click **Save as bet**.
2. Go to the **Bets** tab on the same topic.
3. Click the bet card to transition state. Validated / invalidated prompts for resolution notes.
4. Dashboard shows "2 validated · 1 running · 3 paused" across all topics (Bets summary slot).
5. Per-topic pill next to the topic name shows bet stats at a glance.

**Schema (SQLite):**
```sql
CREATE TABLE hypothesis_tests (
  id TEXT PRIMARY KEY, topic TEXT, card_json TEXT,
  status TEXT, started_at TEXT, resolved_at TEXT,
  resolution_notes TEXT, linked_evidence TEXT,
  last_updated TEXT, created_at TEXT
);
```

**CLI:**
```bash
reddit-cli research hypothesis-create --topic <t> --card-json '{...}'
reddit-cli research hypothesis-update-status --id <id> --status validated --notes "..."
reddit-cli research hypothesis-list --topic <t> --json
reddit-cli research hypothesis-stats --topic <t>
```

**Tauri:** `api.hypothesisCreate / UpdateStatus / List / Delete / Stats`

**Code paths:**
- `src/reddit_research/research/hypothesis_tracker.py`
- `app-tauri/src/screens/bets.js`

---

## 5. Phase 4 — Monitoring & weekly delta

**Shipped:** 2026-04-20 · `changelogs/2026-04-20_09_phase4-monitoring-weekly-delta.md`

**What it does:** Every synthesize run now writes to `topic_runs` table with a diff vs. the previous report: findings added/removed, score changes ≥1.0, competitors added/removed, new academic papers, corpus size change. Dashboard's "What's changed this week" card shows the cross-topic delta digest.

**Usage:**
- **Passive:** Every time you click **Regenerate** in Insights, a delta row is written. A toast flashes "✨ N changes this run — see Dashboard for the delta digest" if anything changed.
- **Active:** Dashboard `#weekly-deltas-slot` shows last 7 days of deltas across all topics, sorted by magnitude.
- **Manual sweep:** `reddit-cli research monitor-tick` re-runs synthesize for every enabled topic (for cron).

**Schema:**
```sql
CREATE TABLE topic_runs (
  id INTEGER PRIMARY KEY, topic TEXT, run_at TEXT,
  trigger TEXT, corpus_delta TEXT, findings_delta TEXT,
  report_json_prev TEXT
);
```

**CLI:**
```bash
reddit-cli research monitor-run --topic <t> --skip-collect --json
reddit-cli research monitor-tick --skip-collect --json
reddit-cli research monitor-deltas --limit 20 --since-days 7 --json
```

**Tauri:** `api.monitorRunTopic / monitorTick / monitorDeltas`

**launchd cron setup (not yet automated):**
See `app-tauri/src-tauri/src/schedule.rs` for `schedule_install / uninstall / status` — user-facing toggle on Settings page wires this up.

**Code paths:**
- `src/reddit_research/research/monitor.py`
- `app-tauri/src/screens/home.js` → `loadWeeklyDeltas`

---

## 6. Phase 5 — Cross-topic search & leaderboard

**Shipped:** 2026-04-20 · `changelogs/2026-04-20_11_phase5-7-9-10-bundle.md`

**What it does:** Three cross-topic surfaces on the Dashboard.

### 6.1 Top-opportunities leaderboard

Ranked list of highest Ulwick-scored findings across **every** topic you've synthesized. Click a row → opens the topic.

**Usage:** Dashboard scrolls down past Activity → "Top opportunities across all topics" card. Silent when empty.

### 6.2 Global findings search

Substring search across every finding title + narrative in every topic. Relevance-ranked.

**Usage:** Keyboard `⌘K` → opens the global-find screen.

**CLI:** `reddit-cli research search-findings --query "<q>" --limit 25 --json`

### 6.3 Related topics (Jaccard)

For any given topic, shows the 5 most semantically-similar other topics (Jaccard similarity on `source_breakdown`).

**CLI:** `reddit-cli research related-topics --topic <t> --limit 5 --json`

**Code paths:**
- `src/reddit_research/research/cross_topic.py`
- `app-tauri/src/screens/home.js` → `loadTopOpportunities`

---

## 7. Phase 6 — Onboarding & empty-state polish

**Shipped:** 2026-04-20 · `changelogs/2026-04-20_12_phase6-8-11-completion.md`

**What it does:** Fresh-install experience goes from "blank screen" to "first Minto brief in ≤30 s".

### 7.1 Welcome wizard (4 steps)

- Step 1 — value prop + pipeline explainer
- Step 2 — local profile (name / email / role)
- Step 3 — connect sources (LLM keys + Reddit creds — all optional)
- Step 4 — first topic picker (6 example tiles + free-text)

**Usage:** Auto-routes to `#/welcome` on first launch. Re-runnable from Settings → "Reset onboarding".

### 7.2 Dashboard 0-topic empty state

Replaces bland "+ Start your first topic" button with:
- 5 quick-start chips: AI coding assistants · sleep tracking apps · no-code website builders · meditation apps · resume builders
- "Start a custom topic" button beneath

Clicking a chip jumps straight to `#/collect/<chip>`.

### 7.3 Contextual Insights empty state

If synthesis fails, the empty-state text now surfaces the real failure reason:
- **No LLM key:** "Open Settings" button added
- **Empty corpus:** button text flips to "Collect posts first"
- **Other errors:** raw error surfaced verbatim

**Code paths:**
- `app-tauri/src/screens/welcome.js` (wizard)
- `app-tauri/src/screens/home.js` (empty state)
- `app-tauri/src/screens/insights.js` → `renderEmpty`

---

## 8. Phase 7 — Export formats

**Shipped (markdown/hypotheses/slack):** 2026-04-20 · `changelogs/2026-04-20_11_phase5-7-9-10-bundle.md`
**Deferred (PDF):** `docs/manual-todo/phase7-pdf-export.md`

### 8.1 Shipped formats (clipboard)

On the Insights toolbar → **Export** dropdown → 3 options:

| Format | Output | Paste into |
|---|---|---|
| **Full brief (markdown)** | Minto-structured with governing thought, arguments, top opportunities, competitors, hypothesis cards, citations | Notion, Linear, Google Docs, GitHub issues |
| **Hypothesis cards** | Each bet as its own standalone markdown block | Kanban cards, Linear tickets, retro docs |
| **Slack summary** | 5 lines: title + top 3 opps + 1 bet | DMs, Slack channels |

**Usage:** Click Export → pick format → markdown is copied to clipboard → toast confirms char count.

**CLI:**
```bash
reddit-cli research export-brief --topic <t> --format markdown
reddit-cli research export-brief --topic <t> --format hypotheses
reddit-cli research export-brief --topic <t> --format slack
```

**Tauri:** `api.exportBrief(topic, format)` — returns string (not JSON).

### 8.2 Deferred formats

- ❌ **One-page PDF** — weasyprint would add ~30MB + C libs to the bundle. Revisit with playwright headless-chromium when ≥3 users request it. See `docs/manual-todo/phase7-pdf-export.md` for implementation sketch.
- ❌ **Hypothesis card PDF stack** — same bundle-cost reasoning.
- ❌ **BibTeX** — academic-only, zero founder value per PROJECT_STATUS rejection list.

**Workaround for PDF:** On macOS, cmd+P the Markdown preview in Obsidian / Typora / Marked 2 → Save as PDF. Zero engineering.

**Code paths:**
- `src/reddit_research/research/export_brief.py`
- `app-tauri/src/screens/insights.js` → Export dropdown wiring

---

## 9. Phase 8 — Chat sidebar on Insights

**Shipped:** 2026-04-20 · `changelogs/2026-04-20_12_phase6-8-11-completion.md`

**What it does:** After reading a brief, follow-up questions happen without leaving the Insights tab. A collapsible right-hand chat panel (sticky-positioned) reuses the existing chat streaming API with `agent=true` for tool-use.

**Usage:**
1. Open any topic → Insights tab.
2. Click **Ask** button in the toolbar (or press `⌘/`).
3. The sidebar slides in with 4 pre-seeded prompt chips:
   - "Top 3 risks"
   - "Main incumbent?"
   - "Cheapest test?"
   - "US vs EU?"
4. Click a chip → auto-sends. Or type a free-form question + Enter.
5. Chat history persists per-topic in `localStorage.gapmap.insights.chat.<topic>` (last 40 turns).
6. Press `⌘/` again to collapse.

**Features:**
- Streaming tokens render as they arrive (reuses `chat:progress` events).
- Agent tool-use so the LLM can run `list_topics`, `run_query`, `sample_posts`, etc. on your corpus.
- Sidebar open/closed state persists per topic via `localStorage`.

**Code paths:**
- `app-tauri/src/screens/insights.js` → `wireChatSidebar`
- Backend: existing `src/reddit_research/research/chat.py` agent loop

---

## 10. Phase 9 — Competitor matrix

**Shipped:** 2026-04-20 · `changelogs/2026-04-20_11_phase5-7-9-10-bundle.md`

**What it does:** Auto-generates a **feature × competitor** table from the report's competitor list, with status cells and a greenfield call-out.

**Usage:** Opens automatically on the Insights tab below the Competitor landscape section. Populated async after main render.

**Cell states:**
- ✓ green — has the feature
- ✗ red — missing (competitor doesn't have it)
- ⚠ orange — weakness (has it, but users complain)
- — gray — unknown

**Gap features callout:** Features where **no** competitor has strong coverage → greenfield opportunity. Rendered as a highlighted banner above the table.

**CLI:** `reddit-cli research competitor-matrix --topic <t> --json`

**Tauri:** `api.competitorMatrix(topic)`

**Code paths:**
- `src/reddit_research/research/competitors.py` → `build_matrix`
- `app-tauri/src/screens/insights.js` → `renderCompetitorMatrix`

---

## 11. Phase 10 — Research-to-finding linker

**Shipped:** 2026-04-20 · `changelogs/2026-04-20_11_phase5-7-9-10-bundle.md`

**What it does:** Palace-backed semantic matcher ties each finding to the top-K academically-similar papers already in your corpus (arXiv, OpenAlex, PubMed, Scholar, or user-ingested PDFs).

**Usage:**
- After every synthesize run, the linker runs in the background (fire-and-forget).
- Finding cards with matches show a clickable **📚 N research** chip.
- Click → modal with paper titles, similarity scores, source-type badges, author, and a 300-char excerpt.

**Degradation:** If the palace (ChromaDB) isn't warmed, the linker returns `{skipped: true, reason: "..."}` silently. Findings still render; they just don't get research chips.

**Schema:**
```sql
CREATE TABLE finding_research_links (
  finding_id TEXT, topic TEXT, finding_title TEXT,
  paper_post_id TEXT, similarity REAL, linked_at TEXT,
  PRIMARY KEY (finding_id, paper_post_id)
);
```

**CLI:**
```bash
reddit-cli research link-research --topic <t> --k 3 --json
reddit-cli research research-links --topic <t> [--finding "<title>"] --json
```

**Tauri:** `api.linkResearch(topic, k)` / `api.researchLinks(topic, finding?)`

**Code paths:**
- `src/reddit_research/research/research_linker.py`
- `app-tauri/src/screens/insights.js` → `annotateWithResearchLinks`, `showResearchLinksModal`

---

## 12. Phase 11 — Polish cluster

**Shipped:** 2026-04-20 · `changelogs/2026-04-20_12_phase6-8-11-completion.md`

### 12.1 Tab cleanup on topic page

**Before:** 13 tabs (tab overflow).
**After:** 4 primary tabs (**Insights · Bets · Evidence · Chat**) + "More" dropdown (Map / Report / Trends / Sentiment / Sources / Posts / Research / Solutions / Database).

### 12.2 Dark mode

Settings → Preferences → **Dark mode** toggle. Applied via `<html class="dark">`; all cards, inputs, modals, matrix table, chat sidebar, dropdowns have dark-palette overrides. Applied at boot **before first paint** to prevent flash.

### 12.3 Dense finding cards

Settings → Preferences → **Dense finding cards** toggle. Hides Tier-2 chips (importance/satisfaction/coverage/classification/academic/CI) by default; hover to expand. Tier-1 chips stay visible: Ulwick score, triangulation, counter-evidence, research-link.

### 12.4 Keyboard shortcuts

See [§13](#13-keyboard-shortcuts-full-list).

### 12.5 Deferred Phase 11 items

- ❌ **Topic comparison view** (`/compare/:topicA/:topicB`) — 1 day, not yet shipped
- ❌ **Progressive insights during collect** — streams partial findings as each source completes, not yet shipped (would require restructuring `synthesize_insights` to accept partial corpora)

**Code paths:**
- `app-tauri/src/screens/topic.js` (tab dropdown)
- `app-tauri/src/style.css` (dark mode, dense cards)
- `app-tauri/src/main.js` (early-prefs IIFE, keyboard handler)

---

## 13. Keyboard shortcuts (full list)

| Binding | Action |
|---|---|
| `⌘ N` | New topic (opens the modal) |
| `⌘ K` | Global search / find anything across topics |
| `⌘ ,` | Open Settings |
| `⌘ /` | Toggle chat sidebar on Insights tab |
| `J` / `K` | Next / previous hypothesis card on Insights |
| `?` | Open shortcuts help panel |
| `Esc` | Close any open dialog |
| `Enter` | Submit the focused form |
| `Tab` / `⇧ Tab` | Cycle focus within a modal |

Global shortcuts are skipped when the user is typing in an input/textarea.

**Wiring:** `app-tauri/src/main.js` → `wireKeyboard`.

---

## 14. LLM & data infrastructure

### 14.1 Provider selection

Zero hardcoded provider defaults. Every extractor/synthesizer/enricher calls `resolve_provider(explicit)` which:
1. Uses `explicit` if provided
2. Falls back to `LLM_PROVIDER` env var
3. Scans env for any API key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)
4. Falls back to Ollama if reachable on `localhost:11434`
5. Raises `RuntimeError("No LLM provider configured")` otherwise

Settings → **AI extraction** card lets users add keys via an in-app modal (`openByokModal`). Keys stored in `~/Library/Application Support/com.reddit.myind/byok.json`.

### 14.2 Ollama model auto-pick

Skips non-chat families: `bert`, `nomic-bert`, `glmocr`, plus any name containing `embed` or `ocr`. Picks the first chat-capable installed model; falls back to `gemma3:4b` if nothing found.

### 14.3 Collect pipeline

Parallel multi-source fetch with error classification on exit:
- `reddit_rate_limit` → "Wait 60s or add creds"
- `llm_key` → "Add a key in Settings"
- `llm_model` → "Switch provider or model"
- `network` → "Check connection"
- `db` → "DB locked — retry"
- `unknown` → raw exit code

Surfaces `error_class` on `collect:done` events for targeted UI guidance.

### 14.4 Parameterized queries (SQL injection safe)

All topic-scoped queries use `:topic` / `:name` placeholders. Frontend passes `topic` + `params` separately through the `run_query` Tauri command, which forwards to `sqlite_utils.Database.query(sql, params)`. Never string-interpolate user values.

### 14.5 Semantic palace (ChromaDB)

Optional retrieval layer at `palace/` directory. Used by:
- Phase 10 research-finding linker
- Related-posts lookups
- Semantic search endpoints

Degrades gracefully when not installed — palace calls return empty results, nothing crashes.

### 14.6 LFS operations

The PyInstaller sidecar (~220 MB per rebuild) is tracked via Git LFS. Quarterly prune cadence, exact commands, and the quota-exhaustion runbook live in **[docs/ops/lfs-maintenance.md](ops/lfs-maintenance.md)**. CI jobs check out with `lfs: false` to stay inside the 1 GB/mo free-tier bandwidth budget.

---

## 15. Coverage vs Dual-Mode Pivot

**Updated 2026-04-20 after shipping Product Mode foundation.**

Phases **A + B + C + F** from `docs/DUAL_MODE_PIVOT.md` are now shipped (local-first). Phases **D + E + G** remain deferred — they require architectural shifts (OAuth, accounts, cloud backend) that are out of scope for a local desktop app today.

### 15.0 What Product Mode looks like now

- **Register a product:** `#/products` → "Register a product" → name, one-liner, category, competitors, linked topic. Or: "Convert an existing topic" → auto-extracts competitors from the graph.
- **Daily Dashboard:** `#/product/<id>` shows 5 sections in one scroll:
  - **The Mirror** — your product's regression signals + mention spikes
  - **The Lens** — per-competitor release/vulnerability counts
  - **The Field** — category emerging / rising / top findings
  - **The Signals** — ranked by severity × confidence with 4 action verbs (Acted / Convert to bet / Snooze 7d / Dismiss)
  - **Recent sweeps** — timestamped run history
- **Run a sweep:** button on the dashboard header — runs `daily_product_sweep` which re-synthesizes, diffs, emits typed signals.
- **Copy weekly digest:** same header — markdown digest copies to clipboard for Slack/Notion.
- **Signal → Bet:** clicking "Convert to bet" on any signal creates a `hypothesis_tests` row (Phase 3 state machine) with the signal title/description as the WE BELIEVE text and a 14-day time box.

### 15.0.1 Six typed signals (canonical)

| Emoji | Type | When it fires | Suggested action |
|---|---|---|---|
| 🚀 | `competitor_release` | Tracked competitor ships something | "Position against or consider migration CTA" |
| ⚠ | `chronic_emergence` | New painpoint crosses chronic threshold (Ulwick ≥12) | "Add to roadmap; consider cheapest-test hypothesis" |
| 🔻 | `your_product_regression` | Your product's complaint velocity +30%+ WoW | "Immediate engineering attention" |
| 📈 | `unmet_need_intensifying` | Existing need's Ulwick score jumped ≥1.0 | "Prioritize in next planning cycle" |
| 🎯 | `competitor_vulnerability` | Competitor has evidenced weakness | "Run a positioning campaign" |
| 🔊 | `mention_spike` | Entity mentioned 4×+ normal rate | "Check the thread" |

**Severity scale:** 0–1. Dashboard renders high (combined ≥0.5) with a red left border, mid (≥0.3) with orange, low with gray.

### 15.1 What's shipped that IS foundational for Product Mode

These phases lay groundwork Product Mode can lean on:

| Shipped phase | Feeds Product Mode capability | Notes |
|---|---|---|
| Phase 1+2 — synthesis engine | "Deep-dive" per competitor or category | Called from both modes per DUAL_MODE_PIVOT §6.2 |
| Phase 3 — hypothesis tracker | Signal→hypothesis conversion verb | Already stateful & resolvable |
| Phase 4 — `topic_runs` + delta engine | Delta detection per-product | Schema + diff logic already in place |
| Phase 5 — cross-topic leaderboard | Early "signal inbox" prototype | Magnitude ranking already works |
| Phase 9 — competitor matrix | The Lens section of the Daily Dashboard | Feature × competitor extraction done |
| Phase 10 — research linker | Academic backing in signals | Generalizes to any semantic match |
| Phase 11 — dark mode, dense cards | UI polish for daily-use context | Required for a tool users open every morning |

### 15.2 Current coverage against DUAL_MODE_PIVOT.md

| DUAL_MODE_PIVOT section | Required for Product Mode | Shipped? |
|---|---|---|
| §4.1 Onboarding branch (exploring vs have-a-product) | New wizard path | ✅ step 1 branches |
| §4.2 Daily Dashboard (Mirror / Lens / Field / Signals / Hypotheses) | 5-section dashboard shell | ✅ `#/product/<id>` |
| §4.2 Signal types + action verbs | 6 typed constructors, 4 verbs | ✅ + severity × confidence ranking |
| §4.3 Connected private sources (Intercom/Stripe/Zendesk OAuth) | OAuth + vault + private ingestion | ❌ **deferred — needs cloud/credential vault** |
| §4.4 Weekly digest — email/Slack delivery | SMTP + webhook infra | ⚠️ markdown → clipboard only |
| §7.1 New entities (Product, Competitor, ConnectedSource, Signal) | Full schema | ✅ 4 tables (ConnectedSource deferred) |
| §7.2 `product_id` nullable FK on Topic/Finding | Migration | ⚠️ product.topic links the two; Finding-level FK not needed |
| §7.3 Delta engine (`daily_product_sweep`) | Scheduled sweep + typed signals | ✅ via `run_product_sweep` + launchd cron scaffolded |
| §8 Pricing tiers (Founder/Team/Growth/Enterprise) | Stripe + account system | ❌ **deferred — single-user local today** |
| §9.2 Acquisition channels | LinkedIn / Indie Hackers / PH launch | N/A (not engineering) |
| §10 Validation plan (3 founders, 2 weeks) | Design-partner experiment | ❌ ready to run — product is shippable |
| §11 Implementation Phase A (weeks 1–3) | Dual-mode foundation | ✅ |
| §11 Implementation Phase B (weeks 4–6) | Delta engine + dashboard | ✅ |
| §11 Implementation Phase C (weeks 7–9) | Signals + weekly digest | ✅ (local digest; email/Slack deferred) |
| §11 Implementation Phase D (weeks 10–13) | Connected sources | ❌ deferred |
| §11 Implementation Phase E (weeks 14–16) | Pricing + billing | ❌ deferred |
| §11 Implementation Phase F (week 17) | Topic → Product conversion | ✅ |
| §11 Implementation Phase G (weeks 18–20) | Export/share/virality | ⚠️ markdown export only |

### 15.3 Honest gap assessment

**What we have is a working, methodologically-grounded, local-first Topic Mode tool.** The research engine is battle-tested. Methodology is defensible. Retention loops via Bets tab + monitoring deltas are in place at the topic-scope.

**What we do NOT have, and what DUAL_MODE_PIVOT.md would require:**

1. **A concept of a user-owned product** — there is no `Product` entity. Today every surface is scoped to a `topic`, which is a free-form string.
2. **A concept of competitors as first-class entities** — they exist as `graph_nodes(kind='product')` inside a topic's graph, but not as monitored, persisted, cross-topic objects.
3. **OAuth and credential vault** — BYOK stores API keys for LLMs only. No Intercom / Stripe / Zendesk OAuth flow.
4. **Account system / billing** — Gap Map is single-user local-only. No Stripe. No auth.
5. **Scheduled sweeps per product with typed signals** — the Phase 4 monitor is generic (per-topic synthesize diff); not the `daily_product_sweep` that produces typed `competitor_release` / `your_product_regression` / etc. signals.
6. **Weekly digest infra** — no email transport, no Slack webhook delivery (though the "Slack summary" export format is clipboard-ready).
7. **Dashboard sections: The Mirror / The Lens / The Field / The Signals / The Hypotheses** — we have individual surfaces (leaderboard, weekly deltas, competitor matrix, hypothesis bets) but they are **per-topic**, not **per-product**. No product-scoped dashboard exists.
8. **Validation with 3 founders** — not yet run.

### 15.4 Recommended next step before building Product Mode

**Run the validation experiment first** (DUAL_MODE_PIVOT §10):

- 3 founders with publicly-identifiable products
- Manually scaffold Product Mode for each using existing Topic Mode infra
- Build a one-page dashboard (Notion is fine) with the 5 sections
- Send unsolicited, observe for 10 days
- Decide: ≥2 out of 3 want to keep using it → build Product Mode

Timeline: 2 weeks. De-risks the entire 5-month Phase A–G build.

This experiment requires zero new code. Everything needed (collection, synthesis, competitor extraction, hypothesis cards, weekly deltas) is already shipped. The test is **whether users want a product-centric surface, not whether we can build one.**

---

## 15.5 Quality & safety layers (2026-04-21)

Four cross-cutting fixes shipped in the quality-pass session. These are
not phases on the main ROADMAP but are critical to making the output
trustworthy.

### 15.5.1 Dense graph relations

Was: `topic → finding → post` tree only. Two painpoints about the same
concept never linked. Users saw disconnected islands in the gap map.

Now: after `upsert_semantic` persists findings, a post-pass uses ChromaDB
MiniLM ONNX embeddings + shared-evidence signal to emit four new edge kinds:

- `relates_to` — any pair of findings with cosine ≥ 0.55. Weight = similarity.
- `potentially_solves` — workaround↔painpoint ≥ 0.50.
- `could_address` — feature_wish↔painpoint ≥ 0.50.
- `co_evidenced` — two findings sharing ≥2 evidence posts.

Per-node top-N cap (default 8) prevents hairballs. Env-tunable. Hooked
into both `upsert_semantic` and `build_structural`. See
`graph/relations.py` and `~/.claude/skills/dense-graph-relations/`.

### 15.5.2 Relevance gate (anti-garbage)

Was: Reddit / HN search on "meditation sound frequency brainwave app"
token-matched r/politics threads about ICE, Epstein, Disney+. The LLM
extractor faithfully surfaced "Lack of transparency in law enforcement"
as a meditation-app painpoint.

Now: three-layer relevance filter using the same MiniLM embedder:

| Layer | Threshold env | Default | What it does |
|---|---|---|---|
| Collect-time | `GAPMAP_RELEVANCE_GATE_THRESHOLD` | 0.28 | `_tag_posts` gates by cosine-to-topic before inserting into `topic_posts`. Recall-leaning. |
| LLM-output | `GAPMAP_FINDING_RELEVANCE_THRESHOLD` | 0.40 | `synthesize_insights` drops findings whose label is off-topic. Precision-leaning. |
| Retroactive | `research clean-corpus --topic T --threshold 0.30` | user | Cleans existing corpora. Dry-run by default; inspect `sample_dropped` first. |

Set any threshold to 0 to disable. Graceful chromadb-missing skip.

### 15.5.3 Topic resolver (anti-duplicate)

Was: typing `Indian student exam stress` could land three rows — user-typed
+ LLM-lowercased + slug-only. Each split the corpus.

Now: explicit user-respecting contract.
- `resolve_topic(user_input, register=False)` is read-only. Never
  auto-lowercases or silently redirects user input.
- `topic_aliases` table populated ONLY by the LLM canonicalize path or
  explicit merges. User retyping a variant is never auto-merged.
- `find_existing_topic(user_input)` pre-check on the New Topic modal →
  user prompted with "open existing / create separate" when a duplicate
  is detected.
- `merge_duplicate_topics(apply)` — retroactive cleanup scoped to
  system-caused dupes only (traced via `topic_canonicalizations`).
- `collect.py` moved the `topic_prefs` insert to AFTER canonicalize
  resolves → only one row is ever written per collect.

See `research/topic_resolver.py`, CLI: `research find-existing-topic`,
`research merge-duplicate-topics`.

### 15.5.4 Type-to-confirm delete

Was: `confirm('Delete topic?')` one-click-away accidental loss.

Now: reusable `confirmDestructiveAction({title, body, matchText,
confirmLabel, confirmDanger, hint})` modal. User must type the exact
topic name to unlock the Delete button. Escape / backdrop / Cancel all
abort. Enter submits when matched. Lives in `lib/deleteConfirm.js` —
reusable for Delete Product, Clear Data, Reset DB, etc.

Wired on both Delete Topic sites in `screens/topic.js`.

---

## 16. Next steps

### 16.1 Short-term (no new engineering)

- [ ] Run Dual-Mode validation experiment (§15.4) — 2 weeks, 0 code.
- [ ] Push `multi-source` branch to origin (6 commits ahead currently).
- [ ] Manual user test of every Phase 1–11 surface with a fresh install.
- [ ] Write launch blog post / Product Hunt submission copy.

### 16.2 Medium-term (if validation says yes)

Follow `docs/DUAL_MODE_PIVOT.md` §11 Phases A–G in order:
- **A (wks 1–3):** Dual-mode foundation — new entities, onboarding branch, registration flow
- **B (wks 4–6):** Delta engine + dashboard shell
- **C (wks 7–9):** Signals + weekly digest email/Slack
- **D (wks 10–13):** Connected sources (OAuth Intercom/Zendesk/Stripe)
- **E (wks 14–16):** Pricing, billing, Stripe integration
- **F (wk 17):** Topic → Product conversion flow
- **G (wks 18–20):** Export, share, virality

### 16.3 Deferred items from current ROADMAP

Already queued in `docs/manual-todo/`:
- PDF export (Phase 7) — `phase7-pdf-export.md`
- Topic comparison view (Phase 11.6) — 1 day
- Progressive insights during collect (Phase 11.7) — 1 day

### 16.4 Explicit non-goals

From PROJECT_STATUS §2 + PRODUCT_GAPS §7 + DUAL_MODE_PIVOT §12, still rejected:
- Issue trees / SCQA as user-facing step
- Dual-model κ adjudication
- 30-source expansion
- Neo4j migration
- Weekly human-QA dashboard with Krippendorff's α
- BibTeX / reproducibility snapshots
- Adversarial test harness
- CrewAI / multi-agent orchestration
- Team workspaces / multi-user (pre-Dual-Mode)
- Ads / tracking / growth hacks
- Email drip campaigns (pre-Dual-Mode)
- Gamification / badges / streaks
- Removing Topic Mode (explicitly load-bearing in DUAL_MODE_PIVOT §5)
- Agent swarm "do research for you" (DUAL_MODE_PIVOT §12)
- Enterprise CI competition (Crayon/Klue/Kompyte) — wrong buyer
- Full PM tool (Productboard/Aha!) — scope creep
- $20/mo tier — anchors wrong buyer

---

## Appendix — File index

### Backend (Python)
- `src/reddit_research/research/insights.py` — Phases 1+2 synthesis
- `src/reddit_research/research/hypothesis_tracker.py` — Phase 3
- `src/reddit_research/research/monitor.py` — Phase 4
- `src/reddit_research/research/cross_topic.py` — Phase 5
- `src/reddit_research/research/export_brief.py` — Phase 7
- `src/reddit_research/research/competitors.py` — Phase 9
- `src/reddit_research/research/research_linker.py` — Phase 10
- `src/reddit_research/cli/main.py` — Typer CLI entry point
- `src/reddit_research/core/db.py` — SQLite schema + init_schema

### Rust (Tauri)
- `app-tauri/src-tauri/src/commands.rs` — all `#[tauri::command]` handlers
- `app-tauri/src-tauri/src/main.rs` — invoke_handler registry
- `app-tauri/src-tauri/src/cli.rs` — sidecar runner (dev venv + prod PyInstaller)
- `app-tauri/src-tauri/src/schedule.rs` — launchd cron install (Phase 4)

### Frontend (vanilla JS)
- `app-tauri/src/main.js` — router, keyboard, modal wiring, early-prefs IIFE
- `app-tauri/src/api.js` — Tauri IPC bindings + staleness cache
- `app-tauri/src/screens/home.js` — Dashboard (topics + bets summary + deltas + top-opportunities)
- `app-tauri/src/screens/topic.js` — topic page with 4+More tab layout
- `app-tauri/src/screens/insights.js` — Insights tab (Minto / quadrant / hypotheses / findings / competitors / matrix / chat sidebar)
- `app-tauri/src/screens/bets.js` — Bets tab (state-grouped tracked hypotheses)
- `app-tauri/src/screens/welcome.js` — 4-step onboarding wizard
- `app-tauri/src/screens/settings.js` — keys, prefs, dark mode, schedule
- `app-tauri/src/style.css` — single stylesheet (all themes, all phases)

### Changelogs
All in `changelogs/`:
- `_05_insight-engine-phase1.md`
- `_07_insight-engine-phase2.md`
- `_08_phase3-hypothesis-tracking.md`
- `_09_phase4-monitoring-weekly-delta.md`
- `_10_customer-feedback-sources.md`
- `_11_phase5-7-9-10-bundle.md`
- `_12_phase6-8-11-completion.md`

---

*Generated 2026-04-20 after Phase 11 shipped. Re-generate this doc when Product Mode (Dual-Mode Pivot Phases A–G) is underway.*
