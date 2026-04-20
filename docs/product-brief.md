# Gap Map — product brief

**Date:** 2026-04-19
**Repo:** `reddit-myind` (Python CLI + MCP) + `app-tauri/` (desktop)
**Bundle name:** `com.shantanu.gapmap`
**Status:** MVP — shippable DMG, P0/P1/P2 items closed per `docs/mvp-checklist.md`.

This is the single source of truth for what the product is, what is actually built today, which fields it serves, who it is sold to, and how to sell it. Everything here is cross-referenced with the code and existing docs — no aspirational features unless explicitly flagged as "roadmap".

---

## 1. What Gap Map actually is

Gap Map is a **local-first market-research + product-discovery engine**. It turns raw chatter (Reddit, Hacker News, arXiv, PubMed, App Store reviews, GitHub issues, private PDFs, Slack exports, interview transcripts…) into:

1. a deduplicated local **SQLite corpus**, tagged by source,
2. a **knowledge graph** of painpoints / feature wishes / competitors / DIY workarounds — each edge backed by citations,
3. a **build-guide Report** with ranked findings + named Reddit handles ready to DM,
4. a **40-tool MCP server** that lets Claude Code query all of the above as persistent memory.

Three surfaces ship today:

| Surface | Entry | Who uses it |
|---|---|---|
| `reddit-cli` Python CLI | `uv run reddit-cli …` | devs, scripts, CI |
| MCP server | `uv run reddit-cli mcp serve` | Claude Code sessions |
| Desktop app (Tauri 2) | `app-tauri/` → DMG | non-technical PMs, founders, researchers |

Local-first by design: API keys, corpus DB, and generated HTML live under `~/.config/reddit-myind/` and `~/Library/Application Support/com.shantanu.gapmap/`. Nothing leaves the user's machine except LLM calls they explicitly make with their own key (BYOK).

---

## 2. What is actually built (code-verified inventory)

### 2.1 Data sources — 20 backends, one common `posts` shape

From `src/reddit_research/sources/__init__.py`:

**Zero-config free sources** (no API key needed):
reddit · hackernews · appstore (iTunes RSS) · playstore · google scholar · stackoverflow · google trends · arxiv · openalex · pubmed · gnews · devto · lemmy · mastodon · github_trending · npm stats · pypi stats · wikipedia · discourse

**Config-gated** (free key):
github_issues (`GITHUB_TOKEN`) · youtube (`YOUTUBE_API_KEY`) · producthunt (`PH_TOKEN`)

**Anti-bot blocked** (documented, not silent):
bluesky (requires app-password auth as of 2026) · alternativeto (Cloudflare-gated)

**Historical backfill:** pullpush.io (Pushshift successor) — covers Dec 2012 → May 2025, the rest covers May 2025 → now. This is what powers the **CHRONIC / EMERGING / FADING** temporal classifier.

**Your own documents** (via Ingest screen or `reddit-cli ingest file`):
`.csv .json .txt .vtt .srt .md .pdf` — PDF uses `opendataloader-pdf` (preserves headings/tables) if Java 11+ is installed, falls back to `pypdf` otherwise.

### 2.2 Pipeline — what a collect actually does

From `docs/HOW_TO_USE.md` Step 2, backed by `src/reddit_research/research/collect.py` + `discover.py`:

1. **Discovery** — LLM-backed topic canonicalization (SQLite cache) finds the 8 most-relevant subreddits for a topic.
2. **Reddit top posts** — top-of-month + top-of-year per sub.
3. **Parameterized searches** — pain / feature / complaint / DIY query templates from `prompts/*.yaml` run against each sub. All prompts live in YAML and can be overridden via `REDDIT_MYIND_PROMPTS_DIR`.
4. **Multi-source fan-out (Aggressive mode)** — HN · App Store · Play Store · arXiv · OpenAlex · PubMed · Scholar · GitHub · DevTo · Lemmy · Mastodon · gnews · stackoverflow · trends run **in parallel across 6 workers** (~4–6× faster than the old serial run).
5. **Historical backfill** — pullpush.io for pre-May-2025 data.

Every row lands in the `posts` table with a `source_type` column so every downstream step (graph, report, trends) stays source-aware. Dedup is by row id; re-running a collect is safe.

### 2.3 LLM extractors — four kinds of findings

From `docs/HOW_TO_USE.md` Step 4 + the prompts folder (`complaints.yaml`, `diy.yaml`, `features.yaml`, `painpoints.yaml`, `solutions.yaml`, `temporal_gaps.yaml`, `why.yaml`):

- **Painpoints** — user complaints, severity, frequency, CHRONIC/EMERGING/FADING classification.
- **Feature wishes** — explicit user asks.
- **Products complained about** — named competitors + their weak spots.
- **DIY workarounds** — what users are building themselves. *The strongest buy-signal* — each workaround ≈ a feature that does not exist in any shipping product.

Evidence is source-aware. arXiv/PubMed papers no longer dropped for score=0 — they reach the LLM alongside Reddit threads with a source prefix so peer-reviewed claims can be weighted differently from anecdotal ones.

### 2.4 Pluggable LLM providers (BYOK)

Supported providers today (`src/reddit_research/analyze/providers/` + Settings screen):

Anthropic · OpenAI · OpenRouter · Groq · DeepSeek · Mistral · Gemini · Ollama (local, auto-start on first Test click, can pull `gemma3:4b` from the UI).

Provider and model are resolved **at call-time**, so switching the default in Settings affects the next Enrich / Chat / Report without touching previous data.

### 2.5 MCP server — 40 tools exposed

`grep -c "@mcp.tool" src/reddit_research/mcp/server.py` → **40**. Named groups:

- Core fetch: `reddit_fetch_posts`, `reddit_fetch_comments`, `reddit_fetch_user`, `reddit_search`, `reddit_query_db`, `reddit_sub_stats`.
- Historical: `reddit_fetch_historical`.
- Research (gap-finding): `reddit_discover_subs`, `reddit_research_collect`, `reddit_get_corpus`, `reddit_corpus_temporal_split`, `reddit_topic_stats`.
- Graph (agent memory): `reddit_graph_build`, `reddit_graph_stats`, `reddit_graph_top_nodes`, `reddit_graph_neighbors`, `reddit_graph_upsert_semantic`, `reddit_graph_export_json`.
- Extra-source adapters: `reddit_fetch_hn`, `reddit_fetch_appstore`, `reddit_fetch_playstore`, `reddit_fetch_scholar`, `reddit_fetch_stackoverflow`, `reddit_fetch_trends`, `reddit_fetch_arxiv`, `reddit_fetch_openalex`, `reddit_fetch_pubmed`, … (+ lemmy/mastodon/devto/gnews/gh/etc.).

The MCP server intentionally has **no LLM calls inside**. Claude Code is the LLM; the server is pure data access. One-line install: `uv run reddit-cli mcp install`.

### 2.6 Desktop app (Tauri 2 + Python sidecar)

`app-tauri/src/screens/` — **18 screens** actually built:

`welcome.js` · `home.js` · `topic.js` · `collect.js` · `ingest.js` · `posts.js` · `database.js` · `search.js` · `science.js` · `find.js` · `trends.js` · `reports.js` · `solutions.js` · `activity.js` · `byok.js` · `settings.js` · `watch.js` · (+ onboarding/test variants).

Key UX surfaces:

| Tab | What it shows | What it's for |
|---|---|---|
| **Map** | Interactive D3 force-graph of every finding + its linked posts | cluster inspection, hub painpoints |
| **Report** | Deterministic markdown synthesis | read top-to-bottom — acts as a build plan |
| **Evidence** | Raw findings grouped by kind | click through to supporting posts + saturation badge |
| **Trends** | Keyword frequency over time | validate rising/fading |
| **Sources** | Per-source counts + date range + top subs | gut-check corpus balance |
| **Research** | arXiv / OpenAlex / PubMed / Scholar / Ingested PDFs | open real DOIs |
| **Chat** | Ask questions grounded in the graph | "1-week plan", "Features to build" presets |
| **Solutions** | Prototype / design variants | visual brainstorming |
| **Find** | Local semantic search over corpus | ONNX embeddings, opt-in ChromaDB palace |
| **Watch** | Live keyword stream | continuous listening (new) |

Architectural spine (from `docs/tauri-app-plan.md` + `docs/pyinstaller-verified.md` + code):

```
Tauri 2 (Rust core) ──┐
                      ├── Python sidecar (`reddit-cli`, PyInstaller bundled)
                      │   ├── SQLite corpus
                      │   ├── LLM providers (BYOK)
                      │   └── MCP tools
                      └── WebView UI (vanilla JS + D3)
```

Battle-tested patterns from `tauri-python-sidecar-app` skill are all present: portable capabilities, dev-venv bypass on macOS, `PYTHONUNBUFFERED=1` + tolerant JSON parsing, parameterized SQL (`:topic` binding — P1-4 fix), stale-while-revalidate cache, asset-protocol scope, error-class tagging on `collect:done`.

### 2.7 SQLite schema (what's persisted)

From `docs/DESIGN.md`:

- `fetches` — audit log of every fetch.
- `subreddits` / `posts` / `comments` / `users` — deduped on source id.
- `streams` / `stream_hits` — keyword monitor hits (Watch screen).
- `graph_nodes` / `graph_edges` — structural + semantic findings per topic.
- `topic_posts` — which rows belong to which topic (multi-topic safe).

All writes are idempotent upserts; schema is pre-created in `init_schema` so the UI never hits a "no such table" error.

### 2.8 Reports — the deliverable

Generated on demand. Six sections (from `docs/HOW_TO_USE.md` Step 6):

1. Corpus stats + science evidence (every paper with DOI/URL — re-verifiable).
2. **Painpoints** — ranked by frequency, cross-source confirmation, severity badge, direct quotes.
3. **DIY workarounds** — each row = a product backlog item.
4. **Competitors** — named products + their weaknesses. Positioning map.
5. **Feature wishes** — roadmap with frequency counts.
6. **First 20 users to interview** — highest-engagement authors from the top 3 painpoints, real Reddit handles.
7. Footer: "How to use this report" (day-1 through day-6+ action list).

Reports are also saved to disk next to the DB. Viewer HTML is one self-contained file — drops into Slack, screenshots into tweets, embeds in decks.

### 2.9 Validated proof artifacts in this repo

Not hypotheticals — actual runs under `data-validate-*/`:

- `data-validate-ats-resume-and-job-search-apps/` — 8,682 posts across 9 sources, 15 painpoints × 10 posts each = 117 evidence edges. Report = 755 lines.
- `data-validate-product-research-tools-dovetail-condens-notably/` — meta-research on our own market.
- `data-validate-user-research-and-voice-of-customer-tools/` — VoC-tools vertical.
- `data-validate-ux-research-saas/` — the corpus `docs/self-gap-analysis.md` is built on.

---

## 3. Applications — by field, with concrete use

### 3.1 Indie founders / bootstrappers / solopreneurs
**Use:** "Should I build X?" — validate a product bet in an afternoon. DIY-workaround clusters become the backlog, named competitors become the positioning map, the "20 users to DM" section becomes day-1 outreach.
**Concrete commands:**
```
reddit-cli research collect --topic "freelance invoicing" --aggressive
reddit-cli research graph build --topic "freelance invoicing"
reddit-cli research report --topic "freelance invoicing" --out report.md
```

### 3.2 Product managers (startups + SMB)
**Use:** Voice-of-Customer across public channels **plus** private Slack/Gong/interview exports. Roadmap validation: "is this feature being asked for, and by how many users across how many sources?" Feature-wish frequency counts feed directly into prioritization.
**Differentiator:** triangulation of public chatter with private transcripts — something Dovetail/Condens can't do because they don't ingest public sources.

### 3.3 UX researchers / research ops
**Use:** Dovetail/Condens alternative. Ingest interview transcripts (`.vtt`, `.srt`, `.txt`), triangulate with Reddit + App Store + HN. Saturation math (Guest et al.) is surfaced as a badge per finding — defends against "you're just cherry-picking quotes" pushback.
**Honest gap (from `docs/self-gap-analysis.md`):** no Slack OAuth or Gong integration yet — local file ingest covers it today, real-time integrations are v2.

### 3.4 Growth / content marketers
**Use:** Weekly "Gap Map of X" tweet threads. Each gap-map is a self-contained HTML artifact → screenshot → thread. SEO moat via public gallery at `gapmap.io/explore/<topic>`.
**Concrete flow:** collect → graph export → screenshot cluster → caption with 2 non-obvious findings → thread.

### 3.5 VCs / scouts / strategy consultants
**Use:** Thesis validation, DD artifacts, market maps. "Show me the gap map for vertical X" becomes a deck slide. Diff-mode (roadmap) → catalyst detection. Competitor cluster = positioning map for portfolio companies.

### 3.6 Academic / R&D / bio-pharma meta-research
**Use:** Cross-source meta-analysis across arXiv + PubMed + OpenAlex + Scholar. Source-aware prompts let the LLM weight peer-reviewed claims vs anecdotal ones. Each paper is listed with DOI/URL so every downstream claim is re-verifiable.

### 3.7 Consulting / research agencies
**Use:** Deliverable factory — one repo per client, one gap-map per engagement. The $49 one-time pricing becomes a cost line in a client bill, not a recurring SaaS seat.
**Roadmap:** white-label / branded reports is a clear v2 play.

### 3.8 AI-agent builders (developer segment)
**Use:** Persistent cross-session memory for Claude Code. The graph is structured state; `reddit_graph_top_nodes` + `reddit_graph_neighbors` give agents curated context 10× more efficient than `reddit_get_corpus(limit=300)`. Multi-agent compose: agent A collects, agent B enriches, agent C reports — each idempotent, typed, independent (see `docs/applications.md` §"What it does for AI agents").

### 3.9 Investors / equity analysts
**Use:** Track App Store + Play Store review sentiment over time for public-comp companies. Aggressive mode pulls 3 years history → baseline → weekly delta = early catalyst.

### 3.10 Policy / journalism / social research
**Use:** Cross-source pattern-finding for health/social issues. PubMed + Reddit + gnews + Mastodon into one corpus with citation integrity.

---

## 4. Who to sell to (ICPs, ranked by volume × willingness-to-pay)

### ICP 1 — Indie founders + PM-solopreneurs
- **Tier:** Desktop Pro · **$49 one-time**
- **Why they buy:** already pay $20–100/mo for other indie tools (Linear, Notion, Raycast). One-time removes sub friction. Matches Setapp-tier pricing.
- **Channels:** Twitter, ProductHunt, Indie Hackers, Hacker News "Show HN", r/Entrepreneur, r/SaaS.
- **Expected volume:** highest. 20 sales/mo = first $1k MRR-equivalent.

### ICP 2 — SMB UX / research ops teams (1–20 researchers)
- **Tier today:** Desktop Pro $49 seats · **Tier v2:** Team $99/mo/workspace
- **Why they buy:** Dovetail is $12k/yr minimum and doesn't ingest public signal. We're 1/40th the price *and* cover a gap Dovetail can't.
- **Channels:** UX Twitter, ResearchOps Community (slack/forum), UXR subreddits, LinkedIn UX/research content, conference sponsorships (UX Week, Config).

### ICP 3 — AI / dev power-users
- **Tier:** free OSS CLI + MCP. **Star-farm and funnel, not a revenue line.**
- **Why they convert:** they install for themselves, then their non-technical PM/founder teammate wants the GUI → buys Desktop Pro.
- **Channels:** GitHub, Claude Code community, MCP showcase sites, awesome-mcp lists.

### ICP 4 — VCs / scouts / strategy consultants
- **Tier:** Hosted **$99–299/mo** with shared boards + webhook alerts + hosted LLM.
- **Why they buy:** produces a shareable artifact their LP/IC can consume. BYOK friction is unacceptable at this ACV.
- **Channels:** warm intros, LP newsletters, Substack thought-leader content, targeted LinkedIn.
- **Volume low, ACV high (10× solopreneur).**

### ICP 5 — UX / growth / market-research agencies
- **Tier:** white-label variant or $49 bulk seats.
- **Why they buy:** branded deliverable = higher client bill. Each engagement funds another tool.
- **Play:** later — wait until the core artifact is battle-tested + hosted gallery is live.

### ICP 6 — Enterprise (Qualtrics / Medallia competitors)
- **Not a near-term target.** Requires SSO, audit, SOC2, procurement. Revisit after 1,000+ Desktop Pro seats.

---

## 5. Pricing ladder (current + roadmap)

| Tier | Price | What's in | Status |
|---|---|---|---|
| **OSS CLI** | free | All 20 sources, MCP server, CLI commands, local viewer | **shipped** |
| **Desktop Pro** | $49 one-time | Polished Tauri UI, scheduled re-runs, export (PDF/Notion/Linear/JSON), license + priority support | MVP **shipped**; Gumroad licensing = 3 days work |
| **Hosted Team** | $99/mo/workspace | Shared workspaces, we pay LLM, Slack/Discord integrations, webhooks, API | v2 roadmap |
| **VC / Consultant** | $299/mo | Hosted gap-map gallery, DD-branded reports, priority access | v3 roadmap |
| **Agency / white-label** | custom | Per-client workspace, branded exports | post-launch |

Rationale (from `docs/product-roadmap.md`):
- $49 one-time ≈ 5-month LTV of $9.99/mo → matches Setapp ceiling.
- Gumroad takes 10% → $44 net/sale. Breakeven at 5 sales/mo for $10–20/mo infra.

---

## 6. Competitive landscape — where we actually win

From `docs/product-roadmap.md` §"Competitive landscape" + my read of `docs/self-gap-analysis.md`:

### Tier 1 — Enterprise research platforms ($200–2000/mo)
**Dovetail · Condens · Notably · Aurelius · UserTesting · Qualtrics · Medallia**
**They miss:** public-data ingestion. They assume you already *have* user interviews — they don't help you *find* what to research.
**We win on:** multi-source collection + citation-integrity synthesis + 1/40th the price.

### Tier 2 — Trend / market intel ($39–500/mo)
**Sparktoro · Exploding Topics · Trends.vc · Crayon · Klue · Sensor Tower · Apptopia**
**They miss:** painpoint extraction, temporal classification, cross-source triangulation.
**We win on:** temporal CHRONIC/EMERGING/FADING math + evidence graph + build-plan Report.

### Tier 3 — Indie manual workflows
Reddit + ChatGPT + Notion databases + Google Sheets.
**They miss:** automation, persistence, sharable output.
**We win on:** zero-config automation + graph + HTML artifact.

### Durable wedges (all three tiers)
1. **Only tool combining 20-source triangulation + temporal classifier + graph viz + build-guide Report.**
2. **Local-first + BYOK** — eliminates the "data leaves our walls" enterprise objection without enterprise sales. Also: no shared rate-limit ceiling (each user uses their own IP for scraping, per their own ToS).
3. **Report is a build plan, not a summary.** Ends with 20 real Reddit handles to DM — that's the shareable money-shot.
4. **Academic + practical.** arXiv/PubMed alongside Reddit = peer-reviewed claims can be weighted higher than anecdotes. Nobody else does this.

### Positioning line
> **"Qualtrics meets Sparktoro, at $49 instead of $15,000, local-first, BYOK."**

---

## 7. Go-to-market

### 7.1 Three distribution loops, ranked by leverage

**Loop 1 — Artifact-led growth (the moat).** Every gap-map is a self-contained, sharable HTML. Publish one per week for a trending niche (AI coding assistants, habit trackers, ATS resumes, note-taking apps, meditation apps). Each artifact → tweet → PH/HN post → SEO page at `gapmap.io/explore/<topic>`. Volume compounds; the gallery becomes the moat.

**Loop 2 — OSS flywheel.** Free CLI on GitHub + one-line MCP install inside Claude Code. Devs star, fork, post. The paid Desktop Pro wraps the same functionality for their non-technical teammate or boss.

**Loop 3 — Narrative content.** Show HN launch using the ATS gap map as proof artifact. Indie Hackers interview. Weekly newsletter digest of newly-emerging painpoints → email list → Desktop Pro upsell.

### 7.2 Launch sequence (from `docs/product-roadmap.md`, adjusted to what is actually shipped)

| Day | Milestone | Status |
|---|---|---|
| 0–14 | Desktop Pro MVP + Gumroad checkout + `gapmap.io` landing | DMG ready, licensing TODO |
| 14 | 3 public gap-maps for trending markets (each a tweet-driven launch) | 2/3 ready (ATS + habit tracker exist) |
| 21 | Product Hunt launch | TODO |
| 30 | HN "Show HN" with ATS artifact as proof | TODO |
| 45 | Indie Hackers weekly thread / interview | TODO |
| 60 | First $1k "MRR-equivalent" (20 lifetime sales = $980) | target |

### 7.3 Content calendar idea (weekly cadence)

- **Mon:** run collect on next week's topic.
- **Tue–Wed:** write narrative pulling 2 non-obvious findings from the map.
- **Thu:** publish gap-map HTML to `gapmap.io/explore/<slug>`, tweet thread.
- **Fri:** post to 1–2 relevant subs (r/SaaS, r/Entrepreneur, r/UXResearch depending on topic).

### 7.4 Risks (from roadmap) + mitigations

| Risk | Mitigation |
|---|---|
| Reddit IP-blocks mass scraping | Local-first → user's IP, no shared ceiling |
| LLM cost explodes | BYO key by default, hosted tier only for Pro+ |
| "Just another Reddit scraper" | Differentiate via graph + temporal + 20-source citations |
| Slow growth (no SEO loop initially) | Public gap-map gallery *is* the SEO loop |
| Scraping legality (Reddit/App Store ToS) | Happens on user's machine under their ToS, not ours — we ship software, not data |

---

## 8. Honest gaps (what we don't have yet)

Not hiding these — the roadmap should acknowledge what's still open.

From `docs/self-gap-analysis.md` + `docs/mvp-checklist.md` P3:

- 🔴 **Emergent theme clustering via embeddings** — today the 4-category YAML prompts are rigid. `sentence-transformers` → near-duplicate merging = next UX win.
- 🔴 **Diff-two-corpora mode** — run today vs last month = trend delta. Temporal classification *across runs* is the natural extension of CHRONIC/EMERGING/FADING.
- 🔴 **Slack / Gong / Intercom OAuth** — today covered only via file export ingest. Real-time integrations = v2 wedge for research ops ICP.
- 🔴 **Hosted gap-map gallery at `gapmap.io`** — each user's published map = SEO + social proof. Biggest unrealized loop.
- 🔴 **Scheduled weekly runs + email digest** — "here's what changed in your markets." Foundation for the Team tier.
- 🔴 **Bundled local LLM via llama.cpp + Gemma** — removes the BYOK friction for non-technical buyers. Tracked in `docs/manual-todo/future-scope-bundled-local-llm.md`.
- 🔴 **Browser extension** — in-context annotation while browsing Reddit/HN.
- 🔴 **Recruiter panel integration (Calendly / PeopleDataLabs)** — closes the UX-research DIY #5 gap.

None of these block launch. All are v2+.

---

## 9. TL;DR for the founder

- **Product:** local-first Gap Map — 20 sources + temporal classifier + knowledge graph + build-guide Report + 40-tool MCP. CLI free, desktop $49.
- **Who to sell to first:** indie founders + PMs via Gumroad + ProductHunt. Then SMB UX-research teams. VCs / consultants last (higher ACV, needs hosted).
- **How to sell:** weekly public gap-maps as marketing artifacts + OSS MCP as dev funnel + narrative content (Show HN, PH, IH).
- **What to build next for revenue:** Gumroad license flow (3 days) + `gapmap.io` landing + public gallery v1 (SEO loop) + diff-mode + Slack export parser.
- **What NOT to build yet:** SSO, SOC2, enterprise panel tools. Revisit at 1,000 Pro seats.

Biggest risk is *marketing*, not technical — the ATS proof artifact already exists (`data-validate-ats-resume-and-job-search-apps/report-pro.md`, 755 lines, 8,682 posts). Total to revenue from here ≈ 3–4 weeks of focused GTM work.
