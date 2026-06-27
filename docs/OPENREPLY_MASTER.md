# OpenReply — Master Document (Learnings · Flow · User Journey · References)

> **The single source of truth for the OpenReply pivot.** It consolidates everything
> learned and decided across the whole effort: what we're building and why, the
> competitor landscape (crawl4ai-verified), the architecture we reuse, the Agent model,
> the complete user journey & screen flow, UX/design principles, what's built, technical
> gotchas, research tooling, pricing/positioning, and the roadmap — with references to
> every companion doc and source.
>
> **Updated:** 2026-06-27 · **Branch:** `open-reply` · **Status:** engine + agent model +
> 3 real screens shipped; full clickable prototype done; competitor research complete.

---

## 0. Companion documents (read map)

| Doc | What it covers |
|---|---|
| **`docs/OPENREPLY_MASTER.md`** (this) | Hub — consolidated learnings, flow, journey, references |
| `docs/OPENREPLY_LEARNINGS.md` | Deep learnings log + ReplyDaddy verbatim + gotchas |
| `docs/OPENREPLY_DESIGN.md` | Topic→Agent reframe, data model, page inventory, journey |
| `docs/OPENREPLY_RESHAPE.md` | File-level keep / hide / delete plan (screens, backend, DB, sources) |
| `docs/research/COMPETITOR_LANDSCAPE.md` | Full competitor matrix, per-tool profiles, pricing, gaps |
| `docs/research/replydaddy.md` · `docs/research/competitors/*.md` | Raw crawl4ai captures (sources) |
| `SOCIAL_CONTENT_TOOL_PLAN.md` | Fork-as-boilerplate plan (outbound publish layer) |
| `docs/architecture/TAURI_AND_FETCH_ARCHITECTURE.md` | How the Tauri app + fetch engine work |
| `prototype/` (+ `prototype/README.md`) | Clickable HTML prototype (15 pages, Reddit theme, dark/light) |
| `scripts/crawl_research.py` | Reusable crawl4ai research crawler |

---

## 1. Product — what OpenReply is

**OpenReply = an open-source ReplyDaddy.** You create an **Agent** (a brand/niche
persona). It continuously learns its niche, finds high-intent conversations to reply to
across many platforms, and drafts authentic, rule-safe replies and original content in
your voice. **You review and post** (human in the loop). **BYOK** — model cost is on the
user, never us.

**One-line positioning:** *"Reply where your customers already are — open-source, BYOK,
multi-platform. Automate the 90%, you do the 10% that matters."*

**Why this repo is the boilerplate:** Gap Map already ships the *entire inbound half* —
Reddit fetch without the API, subreddit discovery + LLM canonicalization, ~58 source
adapters, an 8-provider BYOK LLM layer, a credentials store, and a Tauri 2 + Python
sidecar + SQLite shell. OpenReply ≈ that intake engine + a thin scoring/reply/content/
compliance layer + a new UI/flow. (See `TAURI_AND_FETCH_ARCHITECTURE.md`.)

---

## 2. Competitor landscape — key points (full detail in `COMPETITOR_LANDSCAPE.md`)

Verified by crawling 15 sites/articles with crawl4ai (ReplyDaddy, ReplyGuy, Redreach,
Syften, F5Bot, Crowdreply, LeadsRadar, RedditGrow, Devta, Brand24 + 4 comparison articles).

1. **Three categories** — *monitoring/alerting* (F5Bot, Syften, Brand24), *AI reply/lead-gen*
   (ReplyDaddy, ReplyGuy, Redreach, LeadsRadar, RedditGrow, Crowdreply), *managed/agent
   posting* (Crowdreply network, Devta). Buyers routinely pick the wrong category.
2. **Macro thesis:** Reddit now feeds Google SERPs + LLM answers (GEO / AI-visibility) —
   "Reddit is the #1 cited domain in AI answers." Newest shared surface = GEO dashboards.
3. **Full automation is in retreat** — a Reddit update reportedly wiped ~70% of automated
   posting accounts. Market converging on **"automate discovery + drafting, human posts."**
4. **AI drafting is table stakes;** differentiation moved to **0–100 intent scoring** and
   **ban-safety** (warm-ups, shadowban detection, eligibility pre-checks).
5. **Pricing range is huge:** free (F5Bot) / $19 (LeadsRadar, Redreach) → $799/mo
   (ReplyDaddy agency). Emerging: pay-as-you-go credits, BYOK lifetime.
6. **Decisive gap: NO competitor is open-source / self-hostable;** only ReplyDaddy offers
   BYOK (lifetime tier only). Everyone else meters scans/replies/keywords/credits.
7. **No tool does multi-platform monitoring + multi-platform drafting + safe posting** —
   monitors are broad-but-dumb; reply tools are smart-but-Reddit-only.
8. **GummySearch shut down in 2026** → active migration wave (Syften, LeadsRadar,
   RedditGrow, Replymer courting refugees).

**ReplyDaddy (the clone target) — verbatim facts:** brand color `#FF4500`; 5-step flow
(Brand Analysis → Your Persona → Smart Discovery → Start Engaging → Build Habits); 6
features (Opportunity Finder, Smart Prioritization, Authentic Response Assistant,
Ban-Proof Post Creator, Subreddit Intelligence, Brand Context Engine); Claude Sonnet 4,
70% relevance weight, scans hot/rising/new; **no auto-post, never connect your Reddit
account** (read-only); pricing Free / $49 / $199 / $799 with metered scans (30–60/mo) +
posts (60–300/mo).

**OpenReply's wedges:** open-source + self-host · **BYOK with no caps** ("you pay
Anthropic, not us") · **true multi-platform** reply co-pilot · user-owned **Agent** with a
review gate · AI-native **MCP/CLI/API** in the free core.

**Microcopy to borrow:** "Your next customer just complained on Reddit" (LeadsRadar) ·
"Automate the 90%, you do the 10% that matters" (Redreach) · "Be a Redditor who happens to
have a business" / "Never sound like AI slop" / "Build real connections, not spam"
(ReplyDaddy).

---

## 3. The Agent model (central reframe)

A research **"topic" becomes an Agent** (brand/niche persona). One Agent owns:
- **Identity/voice:** name, brand, niche, persona, tone, audience, disclosure style.
- **Knowledge (auto-refreshed):** a `topic` corpus + graph + angles, re-fetched on a
  cadence so output is always current.
- **Platforms** it watches/posts on + the **accounts** it posts as.
- **Outputs:** replies (to scored opportunities) + content (post/thread/script/article).

**DB (additive, shipped):** `agents`, `content_items`, `reply_opportunities`,
`reply_drafts`, `reply_sub_rules`, `reply_state` (active-agent pointer) — in the shared
`gapmap.db`. The reply engine reads the *active agent* via `brand.py`, so it's
agent-scoped without rewrites. Full data model + migration in `OPENREPLY_DESIGN.md §2`.

---

## 4. User journey (end-to-end)

```
FIRST RUN
  Landing → "Create your first agent"
    Wizard (mirrors ReplyDaddy's proven 5 steps):
      1 Identity   — name, website (auto-read for tone/keywords), niche
      2 Voice      — persona/background, tone, disclosure style
      3 Sources    — keywords + pick platforms (Reddit, X, LinkedIn, HN, news…)
      4 Connect    — optional account logins (read-only safe; unlock reach/posting)
      5 BYOK       — your AI key (or local Ollama)
    → Agent runs first knowledge fetch (~1–2 min) → ready

DAILY LOOP (per Agent)
  1 IDEATE   Knowledge/angles refresh on cadence → "what my niche is saying"
  2 ENGAGE   Inbox (live mentions, intent+sentiment filtered) / Opportunities
             (scored relevance×intent×fit) → Draft reply (+ rule compliance) → post manually
  3 CREATE   Compose post / thread / script / article from latest knowledge
  4 SCHEDULE Queue / calendar of drafts + scheduled + posted
  5 MEASURE  Analytics (replies, leads, reply→lead rate, momentum, by-platform)
  +          Alerts push high-intent mentions to Slack/email (sub-minute)
  +          Daily goal + streak + account-safety (karma, posting limits, rule flags)

MULTI-BRAND  Agents dashboard → switch/clone personas
```

Throughline: **knowledge is always fresh → every reply/post is generated from the latest
niche state, in the Agent's voice, with a human review gate.**

---

## 5. Screen flow & page inventory (prototype = 15 pages)

```
index.html ─ landing
  └─► onboarding.html ─ 5-step Create-Agent wizard
        └─► agent.html ─ Overview (daily goal · momentum · account safety · angles · top opps)

App shell (shared sidebar + dark/light toggle; nav grouped, defined once in prototype/app.js):
  Agents:        agents.html (persona dashboard)
  Per-agent:     agent.html (overview) · inbox.html (live mentions) ·
                 opportunities.html (find→score→draft+compliance) · compose.html · queue.html
  Intelligence:  keywords.html · subreddit.html (Subreddit Intelligence: rules/strictness/
                 timing/eligibility) · knowledge.html · analytics.html ·
                 geo.html (AI Visibility / GEO — brand citations in Google/LLM answers)
  Account:       connections.html (read-only, account-safe) · settings.html ·
                 pricing.html (open-source/BYOK-no-caps + competitor comparison) · alerts.html
```
The landing, the proven 5-step onboarding (Brand Analysis → Your Persona → Smart Discovery
→ Start Engaging → BYOK/Build Habits), feature names (Opportunity Finder, Authentic Response
Assistant, Ban-Proof, Subreddit Intelligence, Brand Context Engine), and Plans all encode the
competitor findings from `docs/research/COMPETITOR_LANDSCAPE.md`.

Mapping to the real app + keep/hide/delete is in `OPENREPLY_RESHAPE.md`. Today in the
real Tauri app: `agents`, `opportunities`, `compose` screens are wired (command triangle
JS→Rust→Python); the rest are prototype-only pending Phase 2.

---

## 6. UX / design principles (learnings applied)

- **Agent is the unit of everything** — every screen scoped to the active agent; a sidebar
  switcher makes multi-brand first-class.
- **Flow mirrors the job:** ideate → engage → create → schedule → measure. **One primary
  CTA per screen**; progressive disclosure (drafts expand inline).
- **Trust is the product:** show the score breakdown (relevance×intent×fit), a ban-proof
  **compliance badge** per draft, and state **BYOK + manual-post + read-only/account-safe**
  explicitly (directly from the competitive analysis — safety & authenticity win).
- **Momentum mechanics** (daily goal, streak) drive habit — borrowed from ReplyDaddy.
- **Canonical states** shown everywhere: scanning / empty / draft / scheduled / posted.
- **Landing flow:** `#/` lands on **Agents** (legacy research dashboard demoted to `#/dashboard`).

### Visual identity / palette (decision)
ReplyDaddy is a Reddit tool and its brand color is `#FF4500` (crawl-confirmed), so
OpenReply uses the **official Reddit palette** with **dark (default) + light** themes:

| Token | Hex | Use |
|---|---|---|
| `--reddit` | `#FF4500` | primary accent |
| `--reddit-hi` | `#ff5700` | hover |
| `--blue` | `#0079D3` / `#336699` | secondary |
| dark UI | `#1a1a1b` / `#272729` / `#343536` | Reddit night |
| light UI | `#dae0e6` / `#ffffff` | Reddit day |

Theme = CSS variables + `[data-theme]`, pre-paint script (no flash), persisted toggle.
One variable (`--reddit`) retunes the whole accent.

---

## 7. Architecture reused (engine stays the same)

- **Tauri shell + warm Python sidecar bridge** (`cli.rs` daemon/one-shot/streaming),
  `api.js` (cache/dedup/timeout/invalidate/poller), native rusqlite reads (`db.rs`).
- **Command triangle (mandatory):** `commands.rs` `#[tauri::command]` ↔ `main.rs`
  `generate_handler![]` ↔ `api.js` `invoke`.
- **Fetch:** Reddit tier cascade (PRAW→cookie→RSS, no API key), `discover_subs` + LLM
  canonicalization, ~58 source adapters on one contract, `source_credentials` store.
- **LLM:** 8-provider BYOK chain with auto-resolution.
- **New OpenReply engine** (`src/gapmap/reply/`): `agent`, `brand`, `opportunity`,
  `generate`, `content`, `rules`, `platforms`, **`rank`**. CLI: `gapmap reply|agent|content` (all `--json`).

**Ranking — engagement-weighted RRF** (`reply/rank.py`, adapted from last30days):
each opportunity's LLM base score (relevance/intent/fit) is fused with a per-platform
**RRF** term, a **freshness** decay, and a log-scaled **engagement** signal into a single
`final` score: `0.55·base + 0.20·rrf + 0.15·engagement + 0.10·freshness`. Persisted to
`reply_opportunities` (+ `engagement`/`freshness`/`rrf` columns) and used to sort the Inbox
/ Opportunities. Verified live (Reddit) + deterministic unit test.

**Backend cleanup (2026-06-27):** the gapmap Python was trimmed to the OpenReply keep-set.
Removed **96 research modules** (papers, academic mode, product mode, and the consultancy
frameworks: SWOT/lean-canvas/PMF/pricing/launch/OST/empathy/interviews/deliberate/…).
**Kept:** `research/{collect, discover, gaps, prompts, prompt_store, quality_gate,
relevance, topic_resolver, corpus_format}` + all of `core/`, `fetch/`, `sources/`,
`analyze/providers`, `graph/`, `reply/`. Verified: `gapmap.cli.main` + `gapmap.mcp.server`
+ `reply/agent/content/discover/info` all import and run clean.

Full detail: `TAURI_AND_FETCH_ARCHITECTURE.md` · removal map: `OPENREPLY_RESHAPE.md`.

---

## 8. What's built (state)

- **Backend (working, tested):** reply engine + Agent model + content generation; CLI
  verified end-to-end (real Reddit posts via RSS fallback; real LLM drafts/content).
- **Desktop UI (wired, compiles, runs):** 12 Rust command bridges + `api.js` wrappers;
  `agents`/`opportunities`/`compose` screens; `#/` → Agents; 15 off-mission nav items hidden.
- **Prototype:** 17-page clickable HTML on **Tailwind CSS** + **Lucide icons**, Reddit
  theme, dark/light, shared injected sidebar. Working interactions: agent switcher,
  Track-a-query modal, reusable toast/modal, global button feedback. QA: all internal
  links resolve, every page wired, no emoji left, JS syntax-clean; verified rendering in
  a real browser (landing, agents, geo dark+light, inbox, opportunities, compose).
  *Note (gotcha): crawl4ai's DOM snapshot doesn't capture client-rendered `<svg>`/late
  CDN icons — verify client-rendered UI with real-browser screenshots, not the crawl.*
- **Research:** crawl4ai installed; 15 competitor sources captured; `COMPETITOR_LANDSCAPE.md`.
- **Branch `open-reply`** pushed: reply engine → agent model → nav trim → reshape plan →
  UI screens+bridge → prototype → Reddit-theme prototype → learnings → crawl4ai research.

---

## 9. Technical learnings / gotchas

- **JS-rendered competitor sites** (ReplyDaddy, Reppit) defeat static fetch → use crawl4ai
  with `magic + simulate_user + scan_full_page + delay` (and `wait_until=networkidle` for
  the stubborn ones). Reppit/Devi first-party pages still resisted; comparison articles
  filled the gap.
- **Dev sidecar lock contention:** on `tauri dev` the warm daemon can fall back to slow
  one-shot calls (~10–30s) until it pre-warms (~17s). Dev-only.
- **macOS Gatekeeper** can hang an unsigned PyInstaller binary for minutes → dev `.venv` bypass.
- **Reddit needs no official API** (cookie `.json` → RSS cascade; never raises).
- **GUI verification** can be blocked by the Mac lock screen during long builds → rely on
  `cargo` compile + `node --check` + CLI tests too.
- **crawl4ai must NOT go in the PyInstaller sidecar** (Playwright is huge) — it's a
  research-only dev dependency.

---

## 10. Research tooling — crawl4ai (standard going forward)

Installed in `.venv` (+ Playwright Chromium). Standard crawler for all further market
research (renders SPAs that static fetch can't).

```bash
.venv/bin/python scripts/crawl_research.py <url> [<url> …] [--out docs/research]
```
It uses the SPA-friendly config and saves clean markdown + sniffs hex colors per URL.
Re-crawl competitors before any positioning/pricing decision. Raw captures live in
`docs/research/` and `docs/research/competitors/`.

---

## 11. Pricing & positioning strategy (from the landscape)

- **Free core = open-source + self-host + BYOK, no caps.** Undercuts every metered tool;
  "you pay Anthropic, not us."
- **Optional hosted convenience tiers** (managed scans/alerts/Slack/seats) priced under
  ReplyDaddy ($49/$199/$799) since our marginal AI cost is the user's.
- **Lead with safety + authenticity + multi-platform + GEO** (Reddit→AI-answers visibility),
  the surfaces competitors are racing toward but none own end-to-end.

---

## 12. Roadmap (prioritized)

1. **Apply crawl findings to the prototype/app:** adopt ReplyDaddy's exact 5-step
   onboarding + feature names; add **Subreddit Intelligence** + "read-only / account-safe"
   messaging; align Plans to verified tiers; consider a **GEO / AI-visibility** view.
2. **Build the gap screens for real** (Inbox, Keywords, Analytics, Queue, Alerts) +
   onboarding wizard → map prototype to `app-tauri/src/screens/`.
3. **Phase 3 reshape** (`OPENREPLY_RESHAPE.md`): delete papers/product/academic code +
   sources; drop dead tables (with backup); slim the sidecar.
4. **Outbound publishing** (`publish/` adapters) + scheduler so "post" isn't only manual.
5. **Account-safety engine** (karma/limits/shadowban/eligibility) behind the overview widget.
6. **GEO/AI-visibility tracking** (does your brand get cited in LLM answers / Reddit SERPs).

---

## 13. References & sources

- **Companion docs:** see §0 table.
- **Raw competitor captures (crawl4ai, 2026-06-27):** `docs/research/replydaddy.md`,
  `docs/research/replyguy.md`, `docs/research/competitors/` (redreach, syften, f5bot,
  crowdreply, leadsradar, redditgrow, devta, brand24, replydaddy-how-to-use + 4 comparison
  articles: replymer, growffic, devta-blog, leadsradar-blog).
- **Synthesis:** `docs/research/COMPETITOR_LANDSCAPE.md`.
- **Changelogs:** `changelogs/2026-06-26_*` and `changelogs/2026-06-27_*` (engine, agent
  model, UI, prototype, learnings, crawl research).

## 14. Update protocol
Update this master doc whenever a companion doc changes materially, a screen/feature ships,
competitor research is refreshed (re-crawl with crawl4ai), or a positioning/pricing
decision is made. Keep §0 and §13 in lockstep with the files that actually exist.
