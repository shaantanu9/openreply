# What's still missing — honest audit

**Version:** 2026-04-21 (after quality-pass session)
**Purpose:** Inventory every known gap, grouped by leverage. Use this to
pick the next thing to build. Not every item will ever ship — some are
explicit non-goals.

---

## Tier 1 — Retention blockers (ship within 2 weeks)

These are the gaps most likely to make a user stop using the app.

### T1.1 Delete Topic modal also needs to show on Dashboard card
Now the type-to-confirm modal is wired on the topic page, but the
Dashboard topic tiles have no delete affordance at all. Users must
open a topic just to remove it. **Action:** right-click / ⋯ menu on
Dashboard tiles with a Delete option that pops the same modal.
Effort: 0.25 day.

### T1.2 "Re-collect" button on an existing topic
The resolver prompt offers "open existing" but once there, the only way
to get fresh data is via `#/collect/<topic>` which is not obviously
discoverable. **Action:** big "Re-collect" button on topic page header
+ "Augment with more data" menu item in the resolver prompt modal.
Effort: 0.5 day.

### T1.3 Undo for destructive actions (soft-delete)
Delete Topic is irreversible — the graph + findings + bets vanish. Users
who mis-type the confirm string by luck lose work. **Action:** soft-
delete with a 7-day undo. Move deleted topics to a `deleted_at`-stamped
hidden state; purge via nightly sweep. Effort: 1 day.

### T1.4 Progress + cancel for LLM synthesis
`synthesize_insights` takes 30–90s and the UI spinner gives zero signal
while Claude thinks. Long silent waits → users think it's hung → cancel
and retry → duplicate calls → cost. **Action:** stream per-chunk
progress events in chunked mode; add Cancel button that kills the
sidecar subprocess. Effort: 1 day (chunked path only — single-shot
would need provider-side streaming).

### T1.5 Relevance gate UI (let users see what was dropped)
When the gate drops 46/77 posts at collect time, the log line is the
only signal. Users don't know their corpus was filtered. **Action:** a
"dropped for relevance" chip on the topic page with click-through to a
modal listing the dropped sample. Effort: 0.5 day.

### T1.6 Insights tab "dropped findings" surface
Same idea — if the finding-time gate dropped 3 off-topic findings,
surface them under a details/summary fold so the user knows the LLM
mis-fired. Already stamped into `report._relevance_dropped_findings`;
just needs UI. Effort: 0.25 day.

---

## Tier 2 — Quality ceilings (ship within 1 month)

These raise the upper bound of insight quality but don't directly drive
retention.

### T2.1 Sources the user can't easily add yet
13+ sources shipped. Obvious gaps on the consumer-product side:
- **Trustpilot API tier** — we have an HTML scraper with a Cloudflare
  block documented in `sources/trustpilot.py`. Fix = API partnership.
- **App Store reviews** (not just listing) — currently fetch listings;
  reviews unlock sentiment signal per competitor.
- **YouTube comments** — big voice-of-customer channel we don't touch.
- **Twitter/X API v2** — closed off post-2023; monitor for reopening.
- **TikTok transcripts** — hard due to auth; third-party aggregators
  only, paid.
- **Review aggregator RSS** (AlternativeTo, Slant.co, ProductHunt
  comment RSS) — partially shipped; needs polish.

### T2.2 Post-quality filtering
Beyond topic relevance, post-quality is not filtered. Low-karma joke
comments, bots, repost farms all flow into the corpus equal to real
pain signals. **Action:** per-source quality heuristics
(min_score × min_content_length × author_karma_floor) gated behind a
"strict mode" toggle. Effort: 1.5 days.

### T2.3 Multi-language corpora
All relevance + semantic embedding uses the English-leaning default
MiniLM. A user researching a Hindi / Japanese / Portuguese market today
gets the equivalent of garbage. **Action:** swap to
`paraphrase-multilingual-MiniLM-L12-v2` via the existing ChromaDB
SentenceTransformer path. Effort: 0.5 day + QA.

### T2.4 Human-in-the-loop flag
No way for a user to mark a finding as wrong / spam / off-topic. That
feedback would improve the LLM prompt over time and (with enough data)
train a local classifier. **Action:** 👎 button on each finding card
→ appends to a `finding_feedback` table → feeds the next synthesize
prompt as a "these were wrong last time" negative examples block.
Effort: 1 day.

### T2.5 Competitor de-duplication across topics
If the user has 5 topics in the same category, competitors like "Calm"
get re-extracted in each with slightly different labels
("Calm", "Calm.com", "Calm App"). No cross-topic view unifies them.
**Action:** `global_competitors` view that clusters by name similarity.
Effort: 0.5 day.

### T2.6 Finding-level citation modal polish
Evidence modal works but is bare. Missing: evidence post sort by
upvotes, grouped by source_type, filterable by sentiment. Effort: 0.5
day.

---

## Tier 3 — Power-user features (ship as bandwidth allows)

### T3.1 Saved views / smart filters
No way to save "painpoints with opportunity_score > 15 AND triangulation
= strong AND classification = CHRONIC" as a permanent filter. Effort:
1 day.

### T3.2 Topic comparison view
Promised in ROADMAP Phase 11.6 but deferred. `/compare/:topicA/:topicB`
side-by-side Minto + quadrants + shared-finding Venn. Effort: 1 day.

### T3.3 Progressive insights during collect
Promised in ROADMAP Phase 11.7 but deferred. Stream partial findings
as each source completes (Reddit at 30s → + HN at 60s → full at 3min).
Requires restructuring `synthesize_insights` to accept partial corpora.
Effort: 1 day.

### T3.4 Report exports: PDF, DOCX, PowerPoint
Markdown / Slack / hypothesis-card formats shipped. PDF deferred in
`docs/manual-todo/phase7-pdf-export.md` with a playwright-based
approach sketched. DOCX / PPTX would unlock exec-ready decks. Effort:
1.5 days for PDF via playwright; 0.5 day for DOCX.

### T3.5 Shared link / read-only topic page
A user finishes a brief → wants to send it to a cofounder → no
shareable URL exists because everything is local. Needs cloud backend
(rendering the Minto+quadrant+findings as static HTML uploaded to a
bucket with a nonce). Effort: 1 week.

### T3.6 Bulk ingest from CSV / external data
`research ingest` exists for TXT / PDF / MD. Missing: CSV with a
`topic, post_id, title, body, author, url, created_utc, source_type`
schema for users who scraped with a tool we don't support. Effort:
0.5 day.

### T3.7 Custom LLM extractor prompts
Advanced users can't tune the extractor prompt without editing Python.
**Action:** Settings → "Advanced prompts" → editable textarea that
overrides the `prompts/*.yaml` at runtime. Gated behind a "I know what
I'm doing" toggle. Effort: 0.75 day.

---

## Tier 4 — Product Mode (Dual-Mode Pivot) gaps

Core Product Mode (Phases A/B/C/F) is shipped. Remaining:

### T4.1 Daily sweep scheduler (cron / launchd)
`product_sweep` is currently manual. Need a launchd plist (macOS) that
fires `product-sweep` on each registered product daily. `schedule.rs`
has the scaffolding for topic-level scheduling — extend to products.
Effort: 1 day.

### T4.2 Native OS notifications on new high-severity signals
When a sweep produces a `your_product_regression` signal at
sev ≥ 0.8, emit a macOS notification. Effort: 0.5 day.

### T4.3 Product Mode onboarding polish
"Convert a topic" flow works but is buried in the empty state. Add it
as a primary CTA on the registration wizard ("Already have research on
this category? Convert a topic ..."). Effort: 0.25 day.

### T4.4 Signal dashboard polish
The Signals section is a flat list. Missing: snooze-expires-today chip,
mini timeline showing when a signal first emerged, action history per
signal. Effort: 0.75 day.

### T4.5 Connected private sources (Phase D — deferred)
OAuth to Intercom / Zendesk / Stripe. Explicitly deferred — requires
credential vault + cloud / server-side component. Revisit when the
app goes from single-user desktop to hosted.

### T4.6 Stripe billing (Phase E — deferred)
Tiered pricing requires account system. Same architectural shift as D.

### T4.7 Weekly digest email / Slack delivery (Phase G — partial)
Markdown digest ships; delivery infrastructure does not. Clipboard copy
works. Email via user's Apple Mail / Outlook integration possible via
`mailto:` but ugly for formatted markdown. Real fix = cloud relay.

---

## Tier 5 — Infrastructure debt

### T5.1 Unit + integration test coverage
Insight engine has zero unit tests. `_normalize_scores`,
`_credible_interval`, `_validate_hypothesis`, the relevance gate — all
untested. Integration test: run `synthesize_insights` on a frozen 50-post
fixture corpus, assert golden JSON shape. Effort: 2 days.

### T5.2 Prompt versioning + A/B
Prompts live in `prompts/*.yaml` as plain text. No version, no test
harness, no way to compare "new prompt vs old prompt on the same corpus."
Effort: 2 days.

### T5.3 Telemetry / error reporting (opt-in)
No signal on which features are used or which commands crash in the
wild. A local-first desktop app doesn't need Mixpanel, but an opt-in
"send anonymous crash report" via Sentry would catch sidecar panics
users hit. Effort: 1 day.

### T5.4 Benchmark / perf budget
No measured SLO for "how fast should Insights tab load on a 500-post
topic." We think it's ≤1s; there's no guard. Effort: 0.5 day.

### T5.5 LFS budget management
Every sidecar rebuild adds ~220MB to LFS. Free tier = 1GB. Need
quarterly `git lfs prune --verify-remote` + a docs note. Effort: 0.25
day.

### T5.6 CI pipeline (GitHub Actions)
No CI. Every commit relies on local `cargo check` + `python -c "ast"`
+ `node --check`. Need Actions that run on PR: Rust build + tests,
Python tests, JS syntax + eslint. Effort: 0.5 day (existing
`tauri-pipeline-github` skill provides the template).

---

## Tier 6 — UX polish

- **T6.1** — onboarding wizard doesn't detect if the user already has a
  `.env` with keys; shows "none set" in step 3 even when keys exist.
- **T6.2** — collect log is raw text; no per-source status chips.
- **T6.3** — Finding cards don't support drag-to-reorder or manual
  severity override.
- **T6.4** — No "follow up on this bet" reminder when a bet's
  `time_box_days` elapses. Phase 3 mentioned native notifications;
  not shipped.
- **T6.5** — Global search (`⌘K`) is a separate screen; could be a
  spotlight-style command palette that also runs actions (`new topic`,
  `delete`, `run sweep`).
- **T6.6** — No "favorites" / pinned topics. Dashboard shows all 50
  topics equal weight once a user has enough.
- **T6.7** — Minto header has a fold for the full executive summary,
  but no print-friendly styling for cmd+P.
- **T6.8** — Dark mode misses a few surfaces (some modal bodies stay
  light). Needs audit pass.

---

## Explicit non-goals (will NOT build)

Preserved from `PROJECT_STATUS.md` §2 + `DUAL_MODE_PIVOT.md` §12 +
`PRODUCT_GAPS.md` §7:

- Issue trees / SCQA as user-facing step — consulting workflow, not product.
- Dual-model κ adjudication — 2× cost, <5% quality gain.
- 30-source expansion — diminishing returns past 13.
- Neo4j migration — SQLite scales fine for this workload.
- Weekly human-QA dashboard with Krippendorff's α — ship a 👎 button instead.
- BibTeX / reproducibility snapshots — academic-only, no founder value.
- Adversarial test harness — post-PMF.
- CrewAI / multi-agent orchestration — current tool-use agent delivers
  same value at 10% complexity.
- Team workspaces / multi-user (pre-Dual-Mode) — solo-user product for now.
- Ads / tracking pixels / growth hacks — pro-tool users pay.
- Email drip campaigns (pre-Dual-Mode) — desktop app, native
  notifications handle it.
- Gamification / badges / streaks — clout doesn't sell to serious founders.
- Removing Topic Mode — explicitly load-bearing in Dual-Mode Pivot §5.
- Agent swarm "do research for you" — Dual-Mode Pivot §12 rejects it.
- Enterprise CI competition (Crayon / Klue / Kompyte) — wrong buyer.
- Full PM tool (Productboard / Aha!) — scope creep.
- $20/mo tier — anchors wrong buyer.

---

## How to use this doc

- **Tier 1 = ship next.** These directly affect whether users keep the
  app open.
- **Tier 2 = ship when Tier 1 is clean.** Quality ceiling items.
- **Tier 3 = bandwidth permitting.** Power-user features.
- **Tier 4 = Product Mode second wave.** Gated on Dual-Mode validation.
- **Tier 5 = infrastructure debt.** Pay down as incidents hit.
- **Tier 6 = polish.** Batch for a single "polish cycle."

**Effort estimates are realistic for one focused day.** Multi-day items
are starred or marked with time box.

Revisit this doc quarterly. Move shipped items into
`changelogs/` and strike through the entry. When a new gap is
discovered, add it to the correct tier. When a Tier 1 item isn't
shipped within 2 weeks, either move it up (priority was wrong) or out
(it wasn't really Tier 1).

  Explicit non-goals (preserved): issue trees, dual-model κ, 30+ sources, Neo4j,      
  BibTeX, CrewAI, $20/mo tier, ads, gamification, removing Topic Mode, etc.           
                             
