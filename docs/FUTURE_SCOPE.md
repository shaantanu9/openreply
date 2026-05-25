# Gap Map — Future Scope

**Version:** 2026-04-21
**Horizon:** 2026-Q3 → 2027
**Purpose:** single source of truth for "what's next, what's deferred,
what's deliberately out-of-scope." Every future-scope item scattered
across other docs is consolidated here.

**How to use this doc:**
- Pick work from Horizon 1 first. Move to Horizon 2 only after
  H1 drains.
- An item moves **up** when its decision-gate fires (e.g. "≥3 users
  request it", "≥100 paying customers exist").
- An item moves **down / out** when the decision-gate inverts (e.g.
  "after 6 months no one asked for X — cut it").
- Revisit quarterly. Strike out what's shipped; add what's new.

---

## Table of contents

1. [Where we are today](#1-where-we-are-today)
2. [Horizon 1 — next 8 weeks (ship)](#2-horizon-1--next-8-weeks-ship)
3. [Horizon 2 — next 6 months (validate-first)](#3-horizon-2--next-6-months-validate-first)
4. [Horizon 3 — 12-24 months (architectural bets)](#4-horizon-3--12-24-months-architectural-bets)
5. [Horizon ∞ — explicit non-goals](#5-horizon---explicit-non-goals)
6. [Decision gates — when to promote](#6-decision-gates--when-to-promote)
7. [Quarterly review checklist](#7-quarterly-review-checklist)

---

## 1. Where we are today

As of 2026-04-21, shipped:

- **All 11 ROADMAP phases** (synthesis engine → polish cluster)
- **Dual-Mode Pivot Phases A / B / C / F** (Product Mode local-first)
- **Quality pass** (dense graph relations, relevance gate, topic
  resolver, 👎 feedback, global competitor dedup, saved views,
  custom prompts, compare view, CSV ingest, tests, CI, LFS docs)
- **Production hardening** (MCP zombie guards, data-dir SSOT)
- **73 MCP tools**, 30+ CLI commands, 21 passing tests

Repo state: `multi-source` branch, ~9,000 lines of Python, ~15,000
lines of frontend (JS + CSS), ~3,000 lines of Rust shell.

The base is stable. Everything below is the argument for what to
build next, and what to deliberately not build.

---

## 2. Horizon 1 — next 8 weeks (ship)

Items here have **clear value**, **clear implementation path**, and
**no unanswered strategic question**. Pick in order.

### H1-01 · Launchd daily sweep scheduler for Product Mode (1 day)

**Why:** Product Mode's `run_product_sweep` is manual today. The whole
daily-use retention story needs an automatic trigger.
**What:** Extend `app-tauri/src-tauri/src/schedule.rs` — which already
schedules topics — to also schedule registered products. Add a
Settings → "Daily product sweep" toggle.
**Effort:** 1 day. `launchd` plist + `plutil` load.
**Dependencies:** none.
**Blocks:** H1-02 (notifications rely on sweeps running unattended).

### H1-02 · Native OS notifications on high-severity signals (0.5 day)

**Why:** Without notifications, a "daily-use PM tool" still requires
the user to remember to open the app.
**What:** Add `tauri-plugin-notification`. Fire a macOS notification
when `product_sweep` produces a signal at severity ≥ 0.8. Include
product name + signal title + deep-link to the signal card.
**Effort:** 0.5 day + Apple notification entitlement (already have it
for macOS dev).

### H1-03 · ⌘K command palette (0.5 day)

**Why:** Current `⌘K` opens the `/find` search screen. A command
palette replaces 80% of sidebar navigation for power users.
**What:** Spotlight-style modal with fuzzy-search over: open topic,
new topic, run sweep, open settings, export brief, convert topic
to product, run compare, etc. Keyboard-first.
**Effort:** 0.5 day.

### H1-04 · Pinned / favorite topics (0.5 day)

**Why:** Users with 20+ topics lose their most-important ones in
the list. Schema (`topic_favorites`) already landed.
**What:** `⌘D` / star button → pin to top of Dashboard. Drag-to-
reorder favorites. Replaces the unsorted blob of the topics grid.

### H1-05 · Pre-seeded saved views (0.25 day)

**Why:** Saved views are shipped but empty on first use.
**What:** Seed 3 built-in views on first run: "High opportunity",
"Chronic only", "Triangulated only". Users edit / delete like any
other view.

### H1-06 · Relevance threshold slider in Settings (0.5 day)

**Why:** The three relevance-gate env vars are power-user-only. A
slider + preview surfaces it to everyone.
**What:** Settings → Quality gates card with three sliders:
collect-time, LLM-finding, retroactive. Preview ("would drop N
posts" on the right) uses the clean-corpus dry-run.

### H1-07 · Eager-warm embedder on sidecar boot when gates enabled (0.25 day)

**Why:** First-ever use of a relevance gate silently admits everything
because the ONNX model isn't loaded yet. User doesn't know.
**What:** At sidecar boot, if any `GAPMAP_*_THRESHOLD` > 0, run one
throwaway embedding call to warm the ONNX session. Emit a one-time
"warming up relevance model, ~10 s" toast on first collect.

### H1-08 · E2E tests in GitHub Actions CI (1 day)

**Why:** We have unit tests + E2E tests locally; CI only runs unit.
**What:** Extend `.github/workflows/ci.yml` python-check job to run
`pytest tests/test_integration_tier_e2e.py -q`. Fix the 1 known
flaky test (saved_views race on parallel runs).

### H1-09 · "Where am I" diagnostic command (0.25 day)

**Why:** Single most useful support command. Users can share output
when reporting bugs.
**What:** `reddit-cli where` prints: data_dir, DB size, palace size,
exports count, last collect, LLM provider resolved, MCP PID file,
ChromaDB version, Python version.

### H1-10 · Mid-collect-delete guard (0.25 day)

**Why:** Race condition — user soft-deletes a topic while a collect
is in flight → new posts can still land under the deleted topic.
**What:** In `_tag_posts`, if the topic has `deleted_at != ''`,
silently skip the insert and log.

### H1-11 · Onboarding step 3 `.env` auto-detect (0.25 day)

**Why:** Wizard step 3 always says "No providers set" even when the
user has keys in their shell env. Confusing.
**What:** Call `byok_status` first; if ≥1 provider is ready, flip
the chip.

### H1-12 · Per-source collect status chips (0.5 day)

**Why:** Collect log is raw scrolling text. Users can't tell at a
glance which sources succeeded vs. errored vs. still running.
**What:** Sticky chip row above the log: `[✓ reddit 142] [⏳ arxiv]
[✓ hn 27] [✗ playstore]`. Chip color by status. Click to filter
the log.

### H1-13 · "Bet due today" dashboard reminder (0.5 day)

**Why:** Hypothesis cards have `time_box_days`; nothing surfaces
when they expire. Users forget to revisit bets.
**What:** Dashboard "Your bets" card highlights any running bet
whose `started_at + time_box_days` is today or past. Red chip.

### H1-14 · Clipboard digest → "Send via email" mailto: shortcut (0.25 day)

**Why:** Weekly digest copies to clipboard. For users who want to
email it, one-click mailto with subject prefilled.
**What:** Digest dropdown → "Email digest" option opens
`mailto:?subject=<product> — Weekly digest&body=<markdown>`.

### H1-15 · Feedback effectiveness metric (0.5 day)

**Why:** We ship 👎 but don't measure whether it reduces wrong
findings in the next synth.
**What:** After a synth with feedback injected, compare findings
against the feedback list. Emit `{improved: N, unchanged: M}` into
`report._feedback_efficacy`. Surface a small "feedback working"
badge on the Insights tab after run N+1.

**Horizon 1 total: ~6 days of focused work across 15 items.**
Ship in 2 sprints.

---

## 3. Horizon 2 — next 6 months (validate-first)

Items with clear value but a required validation step before commit.

### H2-01 · LAN-companion mobile app (5-6 weeks after POC)

**Why:** See `docs/architecture/local-network-mobile-companion.md`.
Best path to mobile without a cloud backend.
**What:**
- Phase 0: **3-day POC** — FastAPI layer + mDNS announce + Flutter
  Bonjour-browse + 1 paired screen
- Phase 1 (3 wk): read-only mobile (pairing, topic list, insights,
  offline cache)
- Phase 2 (1 wk): optimistic-UI writes + queued mutations
- Phase 3 (1 wk): WebSocket streaming
- Phase 4: App Store + Play Store submission
**Decision gate:** 3-day POC ships → mDNS + pair + single screen
working end-to-end on iPhone + Mac → commit to phase 1.
**Blocks:** H2-03 (path B FastAPI is a prerequisite).

### H2-02 · Flutter desktop UI (Path B — FastAPI server) (4 weeks)

**Why:** Current vanilla-JS stack is 15,000 lines of custom CSS +
DOM mutation. Flutter is genuinely better for 2026+ UI work, *if*
UI effort is ongoing.
**What:** See `docs/architecture/flutter-port-feasibility.md`. Keeps
the Python backend 100% intact. Same FastAPI server feeds desktop
+ mobile.
**Decision gate:** do we expect ≥5 new frontend surfaces in next 6
months? If yes, port. If no, keep vanilla-JS.
**Dependencies:** none (FastAPI is H2-03 below but that's also a
prerequisite for mobile).

### H2-03 · FastAPI localhost server (1 week)

**Why:** Prerequisite for both H2-01 (mobile companion) and H2-02
(Flutter desktop). Also: the FastAPI layer is intrinsically more
testable + easier to script against than the stdio protocol.
**What:** `reddit-cli serve-http --port 8732`. Wraps every current
Tauri command as an HTTP endpoint. WebSocket for streaming.
OpenAPI spec auto-generated. See §4 of the Flutter feasibility doc.
**Decision gate:** mobile or Flutter desktop chosen → land this
first.

### H2-04 · Product Mode daily digest — email delivery (1 week)

**Why:** Clipboard markdown ships (Phase C); automatic email is the
retention hook. A Monday-morning email brings users back.
**What:** Per-product setting: "Email digest every Monday at 8 AM
to <addr>". Uses user's default SMTP (macOS Mail, Gmail API, or
transactional relay like Postmark).
**Decision gate:** would need some delivery infra — revisit when
either
- We have a small SMTP relay (Postmark free tier = 100 mail/mo for
  dev)
- ≥3 users explicitly ask for email delivery

### H2-05 · Shared read-only report link (2 weeks)

**Why:** Users want to send a Minto brief to cofounders / advisors
without asking them to install Gap Map.
**What:** Export → "Publish read-only link" → the desktop uploads
the report HTML + quadrant SVG to a one-time bucket (Cloudflare
R2, S3, or Backblaze B2 — $0-5/month). URL with a nonce. Auto-
expires in 30 days.
**Decision gate:** needs a bucket. Simplest option is a per-user
Cloudflare R2 account with their credentials (not a hosted service
we run). $0 recurring.

### H2-06 · PDF export via headless Playwright (1 day with approach from manual-todo)

**Why:** Deferred in `docs/manual-todo/phase7-pdf-export.md`.
Users ask for PDF for exec decks + investor share.
**What:** Dedicated `#/pdf-preview/:topic` route with a print
stylesheet. Tauri command spawns a headless Chromium via Playwright
(already transitive via `browser_use`), renders the route, writes
PDF. ~1 day work.
**Decision gate:** ≥3 users request PDF. Currently 0. Revisit.

### H2-07 · DOCX / PPTX export (1 day)

**Why:** Some users paste the export into Google Docs or a deck.
DOCX / PPTX lands cleaner than markdown.
**What:** `python-docx` + `python-pptx`. Same content as markdown,
different serializer.
**Decision gate:** same as H2-06 — validate demand first.

### H2-08 · Multilingual corpora end-to-end validation (1 day + QA)

**Why:** Multilingual embeddings shipped (T2.3). No QA on real
non-English corpora.
**What:** Collect 3 test topics in Hindi / Japanese / Portuguese,
run through the pipeline, verify relevance gate keeps ≥70% of
on-topic posts. Document issues.
**Decision gate:** a user in a non-English market asks, or we do
our own validation spring.

### H2-09 · Progressive insights during collect (ROADMAP 11.7) (1.5 days)

**Why:** Current synth waits for full corpus. Partial results in 30s
→ 60s → 3m would feel dramatically faster.
**What:** Restructure `synthesize_insights` to accept a partial
corpus and re-run incrementally as sources complete. Stream deltas
over WebSocket.
**Decision gate:** user complaints about perceived latency. Today
the bigger complaint is corpus quality, not speed.

### H2-10 · Topic comparison view on mobile (0.5 day after H2-01)

**Why:** Compare view exists on desktop; makes natural sense on
mobile.
**What:** Same route pattern `#/compare/A/B` in Flutter. Read-only.

### H2-11 · Invalid-YAML error for custom prompts (0.5 day)

**Why:** Today an invalid override silently falls through to the
bundled prompt. User thinks their edit was saved but nothing
happens.
**What:** Parse YAML on save. Surface structured errors
("expected dict, got str at line 5"). Prevent save until valid.

### H2-12 · Competitor matrix export to spreadsheet (0.5 day)

**Why:** Phase 9 shipped the matrix; export to CSV / Excel for
workshop use.
**What:** Export button on the matrix → `.csv` with feature × comp
grid. DOCX / Google Sheets paste lands cleanly.

### H2-13 · Settings → "Running processes" diagnostic (0.5 day)

**Why:** The MCP zombie-guard doc has a §7 playbook for common
user issues. A UI surface makes support trivial.
**What:** Settings card listing live MCP + sidecar PIDs, ages,
file-lock states. One-click "kill orphans" button.

### H2-14 · Opt-in telemetry + crash reporting (1 week + privacy review)

**Why:** No signal on which features fire in the wild. Crashes are
invisible until users report.
**What:** Sentry or plausible-analytics-style opt-in. Only crash
reports + anonymous feature-flag counts, no content. Toggle in
Settings.
**Decision gate:** external launch (beyond the single-user dev
loop). Needs a privacy review + a clear opt-in UX.

### H2-15 · Prompt versioning + A/B comparison (2 weeks)

**Why:** Today we have override-or-bundled. No history, no A/B, no
way to compare two prompts on the same corpus.
**What:** Every prompt save stores a version. New UI: "Run synth
with prompt v3 vs. v4 on the same topic — show side-by-side
diff." Like a DVC for prompts.
**Decision gate:** prompt engineering becomes a user-facing workflow.
Today it's a power-user feature.

### H2-16 · More third-party sources via API partnerships (ongoing)

**Why:** Gaps in coverage noted in `MISSING_AND_NEXT.md` §T2.1.
**What:** Each source needs a separate deal:
- Trustpilot — requires API partnership
- App Store reviews — public-ish but rate-limited
- YouTube comments — YouTube Data API v3 (free, rate-limited)
- G2 / Capterra — partnership
- TikTok transcripts — third-party aggregator (paid)
- Twitter/X API v2 — closed off; monitor
**Decision gate:** each source is its own yes-if. YouTube is
cheapest + highest value; start there.

---

## 4. Horizon 3 — 12-24 months (architectural bets)

Big moves that would reshape the product. Commit only after strong
validation.

### H3-01 · Hosted Product Mode (Dual-Mode Pivot Phases D+E+G)

**Scope:** OAuth integrations (Intercom / Zendesk / Stripe) + Stripe
billing + multi-user accounts + email/Slack digest delivery + shared
read-only dashboards.
**Why:** Described in full at `docs/DUAL_MODE_PIVOT.md`. Transforms
Gap Map from single-user desktop to team SaaS at $79-499/mo.
**When:** after ≥3 founder-teams explicitly request it AND we've
validated willingness-to-pay via the `docs/VALIDATION_PLAN.md`
experiment.
**Effort:** ~5 months engineering. Adds Supabase or similar + auth
+ billing + cloud relay for digests + OAuth vault.
**Risk:** breaks the local-first positioning we've built. Requires
parallel local + cloud stories.
**Decision gate:** run the 2-week 3-founder validation experiment
first. If 2+ say "I'd pay $99/mo for hosted," commit. If not,
defer indefinitely.

### H3-02 · CRDT-based multi-device sync

**Scope:** Desktop + mobile + tablet all editable, conflicts resolve
automatically.
**Why:** Current LAN companion is last-write-wins; fine for solo
user with one desktop. Teams + multiple paired devices need better.
**What:** Move topic_posts + graph + hypothesis_tests + feedback to
a CRDT layer (Automerge, Yjs, or tinybase). Replace the
`queued_mutation` pattern with op logs.
**Effort:** 4-6 weeks. Non-trivial — touches every write path.
**Decision gate:** we see real conflict complaints from the LAN
companion launch. Today it's hypothetical.

### H3-03 · Plug-in architecture for sources

**Scope:** Third parties can drop a `.py` file in `~/.gapmap/sources/`
to add a new source (e.g. custom API, internal tool).
**What:** Standardize the source-adapter interface, ship an SDK
(`from gap_map_sdk import Source, fetch_window`), publish docs.
**Effort:** 3 weeks.
**Decision gate:** ≥5 external contributors ask. Today 0.

### H3-04 · Web app via Flutter Web

**Scope:** `gapmap.app` in-browser version.
**Why:** Lowest-friction install → "try it without downloading
anything."
**What:** Flutter Web compiles the same Dart code to JS. Backend
still Python. CORS setup + iframe Chroma problem to solve.
**Effort:** 2 weeks after H2-02 (Flutter desktop).
**Caveat:** ChromaDB-in-browser requires a hosted backend. Web path
inherently breaks local-first.

### H3-05 · First-party LLM router

**Scope:** Move from "user brings their own key" to "we proxy every
LLM call, user pays us a markup."
**Why:** Turns cost from user-borne to platform-borne; enables
prepaid credit bundles, usage caps, team billing, analytics.
**Effort:** 4 weeks. Needs a small relay + per-user token accounting.
**Risk:** inverts the BYOK promise. Only ship if paired with a free
tier that still uses local Ollama for privacy.
**Decision gate:** paid users exist and explicitly say they want to
stop managing keys.

### H3-06 · Mobile-native features (camera OCR, voice memo ingest)

**Scope:** iPhone camera → OCR interview notes. Voice memos →
Whisper → ingest into a topic.
**Why:** Native mobile opens new input modalities the desktop can't
touch.
**Effort:** 2 weeks per modality.
**Decision gate:** mobile (H2-01) ships and has ≥100 active users.

### H3-07 · Agent-based research automation

**Scope:** "Wake me when a signal about my product hits severity
0.9" — fire-and-forget agents that monitor in the background.
**What:** Cron + LLM-driven pattern matching + native notifications.
**Effort:** 3 weeks.
**Caveat:** Dual-Mode Pivot §12 explicitly warns against agent swarm
hype. Keep scope tight.

### H3-08 · Visual graph editor (interactive map)

**Scope:** Today the graph is a static SVG/HTML dump. Interactive
Cytoscape / D3 with filter + group + drag.
**Why:** Explore-the-graph is a common user request, no good UX
today.
**Effort:** 3 weeks.

### H3-09 · Neo4j migration (only if scale demands)

**Scope:** Replace SQLite graph tables with Neo4j.
**Why:** SQLite handles ≤50k nodes comfortably. Neo4j opens Cypher
queries + better visualization.
**Effort:** 2 weeks.
**Decision gate:** any user has ≥50k nodes in a single topic. Today
max is ~10k. Revisit when we see performance issues.

---

## 5. Horizon ∞ — explicit non-goals

**Will NOT build** (preserved from `docs/PROJECT_STATUS.md` §2,
`docs/DUAL_MODE_PIVOT.md` §12, `docs/PRODUCT_GAPS.md` §7 +
consolidated here).

### Product / scope non-goals

- **Removing Topic Mode.** Explicitly load-bearing; Dual-Mode Pivot
  §5 rejects.
- **Adding a $20/mo tier.** Anchors wrong buyer; Dual-Mode §8.1
  rejects.
- **Full PM tool (Productboard / Aha!).** Scope creep; we integrate
  via Linear / Jira instead.
- **Enterprise CI (Crayon / Klue / Kompyte).** Wrong buyer; Dual-Mode
  §12.
- **Agent swarm to "do research for you."** UX anti-pattern at our
  price point; 5-20× cost; Dual-Mode §12.

### Methodology non-goals

- **Issue trees / SCQA as user-facing step.** Consulting workflow,
  not product flow.
- **Dual-model κ adjudication.** 2× cost for <5% gain.
- **Adversarial test harness.** Post-PMF.
- **Weekly human-QA with Krippendorff's α.** Ship a 👎 button
  instead (done).
- **BibTeX / reproducibility snapshots.** Academic-only, zero
  founder value.

### Architecture non-goals

- **30-source expansion.** Diminishing returns past 13.
- **CrewAI / multi-agent orchestration.** Current tool-use agent
  covers same ground at 10% complexity.
- **Blockchain / decentralized anything.** No user need; high
  maintenance burden.
- **Fully rewriting backend in Dart.** Flutter feasibility §4 shows
  this is a 3-5 month trap; loses ChromaDB + FastMCP + PRAW.

### Growth / GTM non-goals

- **Ads / tracking pixels / growth hacks.** Pro-tool users pay; no
  ads.
- **Email drip campaigns (pre-Dual-Mode).** Native notifications
  handle it.
- **Gamification / badges / streaks.** Clout doesn't sell to serious
  founders.
- **Teams / multi-user pre-Dual-Mode.** Solo product until cloud
  lands.

---

## 6. Decision gates — when to promote

The one-sentence trigger that moves an item from its current horizon
up to H1 (ship now).

| Item | Current | Trigger to ship |
|---|---|---|
| LAN-companion mobile | H2-01 | 3-day POC validates mDNS + pair + fetch |
| Flutter desktop UI | H2-02 | ≥5 new frontend surfaces planned in 6 months |
| FastAPI server | H2-03 | either mobile or Flutter desktop is green-lit |
| Email digest delivery | H2-04 | ≥3 users ask OR Postmark free tier signed up |
| Shared read-only links | H2-05 | ≥3 users ask for "send to cofounder" |
| PDF / DOCX / PPTX | H2-06/07 | ≥3 users request PDF |
| Multilingual E2E QA | H2-08 | any non-English user reports bad findings |
| Progressive insights | H2-09 | latency complaints surface |
| Opt-in telemetry | H2-14 | external launch beyond dev loop |
| Prompt versioning + A/B | H2-15 | prompt-engineering becomes a user workflow |
| More sources | H2-16 | one-by-one; each needs its own deal |
| Hosted Product Mode (D+E+G) | H3-01 | Dual-Mode validation: 2/3 founders say "pay" |
| CRDT multi-device sync | H3-02 | real conflict complaints from LAN launch |
| Plug-in sources | H3-03 | ≥5 external contributor requests |
| Web app (Flutter Web) | H3-04 | browser install is blocking acquisition |
| First-party LLM router | H3-05 | paid users explicitly want out of key-management |
| Mobile-native features | H3-06 | LAN companion ships + ≥100 active users |
| Agent automation | H3-07 | clear user pattern; guard against scope creep |
| Graph editor UI | H3-08 | explore-the-graph complaints surface |
| Neo4j migration | H3-09 | any user has ≥50k nodes in one topic |

---

## 7. Quarterly review checklist

At the start of each quarter (Q3 2026, Q4 2026, Q1 2027, …) run:

- [ ] Strike out H1 items shipped → move their changelog entries
      to the archive.
- [ ] Promote H2 items that hit their decision gate this quarter.
- [ ] Demote or cut H2 items whose gate hasn't fired in 6 months.
- [ ] Add new items discovered during the quarter to the correct
      horizon.
- [ ] Update `docs/MISSING_AND_NEXT.md` + `docs/FEATURES.md` to
      match.
- [ ] If a non-goal starts getting requested → explicit write-up
      of why it moved (or didn't) with evidence.

Store each review as `docs/reviews/YYYY-QN.md` — a 1-page snapshot
of what shipped, what was cut, what's next.

---

## Appendix Z — 2026-04-24 addendum: streaming collect + enrich UX

**Problem.** First-result latency in the Tauri app is ~20 min: fetch-all
→ gate → enrich-all. Users sit on an empty findings panel until the
whole pipeline finishes.

**App target state (Horizon 2).**

1. **Streaming fetch** is already per-source; keep.
2. **Rolling enrichment** — the enrichment worker pulls from a FIFO
   batch queue (default batch = 25 posts) instead of waiting for the
   terminal gate. Findings start landing within 1–2 min.
3. **User gate (existing setting) preserved.**
   - `gate=100` → worker idle until ≥100 posts exist for the topic.
   - `gate=all` → worker idle until `collect:done` fires.
   - New default: `gate=rolling` (start immediately, batch=25).
4. **UI contract.**
   - Posts counter ticks live (already).
   - Findings counter ticks live once the gate opens.
   - Phase-B card reveals incrementally as painpoints/features/workarounds cross the confidence floor.
   - "AI conclusions" card (topic-level synthesis) renders at `collect:done`, not before — this is the only non-streaming piece, because synthesis wants the full corpus.
5. **Tradeoff acknowledged.** Rolling enrichment costs ~10–15% more
   tokens (some enriched posts get superseded by dedupe later). We
   accept this for UX; cost-conscious users flip gate to `100` or `all`.

**Implementation sketch.**

- Python: `enrichment_worker.py` subscribes to `collect:progress` and
  maintains a per-topic pending queue; drains in batches of N on a tick.
- Gate logic lives in `core/enrich_gate.py` (reads user setting, returns
  `should_drain(topic)`).
- Rust: forward a new `enrich:batch-done` event so the UI can tick the
  findings counter without a DB roundtrip every time.
- UI: `src/screens/collect.js` adds a "rolling findings" strip above the
  log; keep the terminal "Conclusions" card for `collect:done`.

**Decision gate for promotion to H1.** Promote when ≥3 users complain
about the 20-min wait OR when paying customers run ≥5 collects/week
(rolling UX becomes table-stakes).

---

## Appendix Y — 2026-04-24 addendum: MCP intelligence surface

**Principle.** In MCP mode the *client LLM* (Claude Desktop, Cursor,
Claude Code, etc.) is the reasoning engine. The app's configured LLM
provider key is for the app's own sidecar pipeline — it must NOT be
used by MCP tools. That way:

- The user's app key never gets spent on MCP calls.
- The client LLM already has context about the user's question and can
  orchestrate fetch → analyze → fetch → analyze on its own terms.
- MCP tools stay deterministic and cheap (return data, not LLM calls).

**Exceptions — persisted analysis tools (see below).** Some MCP tools
DO run LLM calls, but only when the user has explicitly asked for a
synthesis that should be cached and shown in the app GUI. Those tools
use the app's configured provider and write results to the shared DB
so the GUI can render them.

**Tool taxonomy.**

| Tier | Uses LLM? | Persists to DB? | Examples |
|------|-----------|-----------------|----------|
| Fetch tools | no | yes (raw corpus) | `gapmap_fetch_hn`, `gapmap_fetch_arxiv`, etc. |
| Query tools | no | no | `gapmap_query_db`, `gapmap_graph_neighbors` |
| Analysis tools (deterministic) | no | yes | `gapmap_graph_build`, `reddit_cluster_painpoints` |
| Analysis tools (LLM-backed) | yes | yes (new `mcp_analyses` table) | `reddit_summarize_topic`, `reddit_synthesize_findings` |
| Orchestrator | yes (delegates) | yes | `gapmap_research_collect` |

**New DB table (shared with GUI).**

```sql
CREATE TABLE IF NOT EXISTS mcp_analyses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  topic      TEXT NOT NULL,
  kind       TEXT NOT NULL,          -- 'summary' | 'synthesis' | 'cluster_note' | 'conclusion'
  source     TEXT NOT NULL,          -- 'mcp' | 'app'
  tool       TEXT,                   -- which MCP tool produced it
  params_json TEXT,                  -- input args (for reproducibility)
  content    TEXT NOT NULL,          -- the LLM output (markdown)
  tokens_in  INTEGER,
  tokens_out INTEGER,
  model      TEXT,
  created_at INTEGER NOT NULL        -- ms epoch
);
CREATE INDEX IF NOT EXISTS idx_mcp_analyses_topic ON mcp_analyses(topic, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_analyses_kind  ON mcp_analyses(topic, kind, created_at DESC);
```

**GUI surface.** Topic page grows an "AI Analyses" tab that lists every
`mcp_analyses` row for the topic (newest first), showing kind + source
+ model + content. Same widget works for app-generated conclusions.

**Interleaved fetch/analyze in MCP.** Because the client LLM drives,
no orchestrator change is needed — expose the fine-grained tools and
the client will call them in whatever order. The one-shot
`gapmap_research_collect` remains for clients that want "do it all"
in a single call.

**Decision gate.** Ship this *before* the streaming app rework (this
appendix); the MCP side is smaller and unblocks "let the MCP brain
drive" immediately.

---

## Appendix A — cross-references

- [`docs/MISSING_AND_NEXT.md`](./MISSING_AND_NEXT.md) — short-term
  tier breakdown (source of H1)
- [`docs/ROADMAP.md`](./ROADMAP.md) — original Phase 1-11 roadmap
  (fully shipped; archived here for traceability)
- [`docs/DUAL_MODE_PIVOT.md`](./DUAL_MODE_PIVOT.md) — A-G strategic
  plan (A/B/C/F shipped; D/E/G are H3-01)
- [`docs/architecture/flutter-port-feasibility.md`](./architecture/flutter-port-feasibility.md)
  — H2-02, H2-03 analysis
- [`docs/architecture/local-network-mobile-companion.md`](./architecture/local-network-mobile-companion.md)
  — H2-01 analysis
- [`docs/TESTING_AND_IMPROVEMENTS.md`](./TESTING_AND_IMPROVEMENTS.md)
  — acceptance criteria + metrics + 2-week sprint source
- [`docs/VALIDATION_PLAN.md`](./VALIDATION_PLAN.md) — the 3-founder
  experiment that gates H3-01
- [`docs/ops/`](./ops/) — per-topic strategy docs (MCP lifecycle,
  data-dir SSOT, LFS maintenance, UI declutter rule)
- [`docs/learnings/`](./learnings/) — post-session pattern writeups

---

*This doc is a roadmap, not a promise. Items migrate between
horizons as reality changes. If an item is shipped, strike through
the heading. If it's cut, move to §5 with evidence. Update
quarterly.*
