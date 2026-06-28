# OpenReply — Master Learnings & Knowledge Base

> Single, detailed record of everything learned while turning the OpenReply
> (reddit-myind) codebase into **OpenReply**, an open-source Reddit/social reply &
> content co-pilot (a ReplyDaddy-style tool). Covers the product research, the
> architecture we're reusing, every design/flow/UX decision, the palette, what was
> built, and what's next. Keep this current — it's the onboarding doc for the pivot.
>
> Companion docs: `ARCHITECTURE.md`, `docs/architecture/TAURI_AND_FETCH_ARCHITECTURE.md`,
> `docs/OPENREPLY_DESIGN.md` (flow + pages), `docs/OPENREPLY_RESHAPE.md` (keep/hide/delete),
> `SOCIAL_CONTENT_TOOL_PLAN.md` (fork-as-boilerplate plan), `prototype/` (clickable HTML).

---

## 1. The product we're building

**OpenReply** = an open-source ReplyDaddy. You create an **Agent** (a brand/niche
persona). It continuously learns its niche, finds high-intent conversations to reply to
across many platforms, and drafts authentic, rule-safe replies and original content in
your voice. You review and post. **BYOK** (bring your own AI key) — model cost is on the
user, never us.

### Why this codebase is the perfect boilerplate
OpenReply already implements the *entire inbound half* of a reply tool:
- Reddit fetching **without the official API** (cookie/RSS tier cascade).
- Subreddit discovery + LLM topic canonicalization.
- ~58 multi-source adapters (Reddit, X, LinkedIn, HN, news, …) on one contract.
- An 8-provider **BYOK LLM layer** with auto-resolution.
- Per-platform **credentials** store (Reach Connections).
- A Tauri 2 desktop shell + warm Python sidecar bridge + local SQLite + streaming.

So OpenReply ≈ OpenReply's intake engine + a thin **scoring + reply/content + compliance**
layer + a new UI/flow. That's why we build in-place on the `open-reply` branch and use
the repo as boilerplate rather than rewriting.

---

## 2. Competitor research (ReplyDaddy + alternatives)

### ReplyDaddy (the target to clone & beat)
- **What it is:** a Reddit marketing tool / co-pilot.
- **Core loop:** scan Reddit for posts matching your keywords + brand → multi-factor
  score → generate authentic, value-first replies that comply with subreddit rules →
  **you review and post manually** (no auto-post).
- **Scoring:** uses Claude Sonnet 4; **~70% weight on relevance**; scans **hot, rising,
  and new** to maximize coverage.
- **Setup:** analyzes your website to learn products/tone/messaging; you define a persona
  (background/expertise); AI auto-suggests best subreddits & keywords.
- **Free tier:** 5 subreddits + 10 keywords. **Unlimited replies** (every opportunity in
  a scan can get a draft).
- **Extras:** daily goals + momentum tracking; always-on monitoring + prioritization;
  "ban-proof" rule/eligibility checks.
- **Pricing:** Solo ~$49/mo, Business ~$199/mo, Team ~$799/mo; lifetime deals
  ($59/$159/$259 seen on LTD sites). **BYOK** (your OpenAI/Anthropic key).

### ReplyDaddy — VERBATIM, crawl4ai-verified (2026-06-27)
Static fetch failed (SPA); crawl4ai with `magic=True, simulate_user=True, scan_full_page`
rendered the full page. Source of truth below (raw saved at `docs/research/replydaddy.md`).

- **Positioning:** "Reddit Marketing Tool & Co-Pilot for Authentic Growth." · "Navigate
  Reddit faster, find relevant posts to engage with, and respond authentically. **Build
  real connections, not spam.**" · "Co-pilot, Stay In Control" · "You stay in control ·
  100% authentic." Framed *vs spammy auto-posters*.
- **Brand color = `#FF4500`** (confirmed in CSS) → our Reddit-orange palette is exactly right.
- **5-step flow (their onboarding/how-it-works):** 01 **Brand Analysis** (analyze your
  website → products, voice, value props) · 02 **Your Persona** (work history + expertise
  → credible responses) · 03 **Smart Discovery** (AI finds best subreddits + keywords
  automatically) · 04 **Start Engaging** (review opportunities, craft responses, **post
  manually**) · 05 **Build Habits** (daily goals, momentum). "No Reddit account connection
  needed."
- **6 named features:** **Opportunity Finder** ("10x faster discovery") · **Smart
  Prioritization** ("Focus on what converts") · **Authentic Response Assistant** ("Never
  sound like AI slop") · **Ban-Proof Post Creator** ("Posts that never get removed") ·
  **Subreddit Intelligence** ("Know before you post") · **Brand Context Engine** ("Your
  voice, amplified").
- **Proof stats:** 50K+ posts analyzed daily (hot/rising/new) · 0 bans reported · 24/7 AI
  monitoring + multi-factor scoring · "Trusted by 2,847+ marketers."
- **FAQ facts:** NO auto-post (you review + manually post) · you **never connect your
  Reddit account** (read-only scan of public content, copy-paste to post) · **Claude
  Sonnet 4**, **70% weight on relevance**, scans hot/rising/new · positioned as a
  "discovery + content generation assistant," not automation.
- **Pricing (exact):**
  | Plan | Price | Projects | Subs | Keywords | Posts/mo | Scans/mo |
  |---|---|---|---|---|---|---|
  | Free | $0 | 1 | 5 | 10 | — | — |
  | Solopreneur | $49/mo ($490/yr) | 1 | 5 | 10 | 60 | 30 |
  | Growing Business ★ | $199/mo ($1,990/yr) | 1 | 15 | 30 | 300 | 60 |
  | Teams & Agencies | $799/mo ($7,990/yr) | 5 | 15/proj | 30/proj | 300/proj | 60/proj |
  | Enterprise | Book a call | ∞ | custom | custom | custom | custom |
  "Unlimited replies" = every opportunity in a scan can get a draft. No credit card; free plan.
- **Their nouns:** "Project" (= our **Agent**), "scan" (a metered run), monthly **post
  generation caps**, "subreddits monitored", "keywords tracked".

### OpenReply's differentiation (sharpened by the crawl)
- **Open-source + BYOK ⇒ no scan caps, no posts/month caps** — ReplyDaddy meters scans
  (30–60/mo) and post generation (60–300/mo); ours is limited only by your own API key.
- **Multi-platform**, not Reddit-only (X, LinkedIn, HN, news, …) — ReplyDaddy is Reddit-only.
- **Agent = richer than "Project"** (persistent persona + auto-refreshed knowledge graph).
- **Self-host** the whole thing. Adopt their proven microcopy/flow (5 steps, feature
  names, "never sound like AI slop", "read-only / account-safe").

### Reppit (crawl note)
Even harder SPA — crawl4ai returned only the title even with simulation. Known from
research: dark theme (emerald `#10b981` accent on slate), scores threads by **buying
intent**. Re-crawl later with a `wait_for` selector or its `/features` route.

### The alternatives landscape (three categories)
1. **Monitoring/alerting** — *F5Bot* (free, keyword email alerts), *Syften* (faster,
   <1-min delivery, Slack, best filtering/noise control). Great at *finding*, nothing
   after.
2. **AI reply generation** — *ReplyGuy* (cheapest, volume+price), *Reppit* (scores
   threads by **buying intent**), *Redreach*, *LeadsRadar* (decide + help reply).
3. **Managed/agency & multi-platform** — *CrowdReply* (rented placements at scale),
   *Devi AI* (multi-platform incl. Facebook groups), *Devta* (presence-building agent).

### Key insight (where tools lose users)
"A monitoring tool is only as valuable as what you do after the alert." F5Bot/Syften nail
*finding*; founders lose hours on *deciding* and *replying*. **OpenReply's edge = own the
whole loop**: find → score by intent → draft in-voice → compliance → post → measure, all
in one place, BYOK, open-source.

### Feature gaps we added because of this research
Mentions **Inbox** (real-time, intent+sentiment filters, noise control) · **Keywords &
subreddits** tracking with AI-suggest + negative keywords · **Analytics** (replies, leads,
reply→lead rate, momentum, by-platform) · **Alert rules** (Slack/email, intent/score
thresholds) · **daily goal + streak + account safety** (karma, posting limits, rule flags)
· **Plans** page.

---

## 3. Visual identity & palette (decision)

ReplyDaddy is a Reddit tool and its marketing site is JS-rendered (plain fetch returned
almost nothing — see §7), so we adopted the **official Reddit palette**:

| Token | Hex | Use |
|---|---|---|
| `--reddit` | `#FF4500` | primary accent (orangered) |
| `--reddit-hi` | `#ff5700` | hover |
| `--reddit-soft` | `#ff8b60` | soft accent |
| `--blue` | `#0079D3` | secondary (links/info), also `#336699` |
| dark UI | `#1a1a1b` panel / `#272729` / `#343536` lines | Reddit night |
| light UI | `#dae0e6` bg / `#ffffff` panel | Reddit day |
| extended | `#c6c6c6 #9494ff #eff7ff #cee3f8` | chips/badges |

**Theme system:** CSS variables with `[data-theme="light"]` override; pre-paint inline
script (no flash) + persisted toggle. Dark is default. One variable (`--reddit`) retunes
the whole accent if we get ReplyDaddy's exact brand hex later.

---

## 4. The Agent model (the central reframe)

A "topic" (research subject) becomes an **Agent** (brand/niche persona). One agent owns:
- **Identity/voice:** name, brand, niche, persona, tone, audience, disclosure style.
- **Knowledge (auto-refreshed):** a `topic` corpus + graph + angles, re-fetched on a
  cadence so output is always current.
- **Platforms** it watches/posts on, and the **accounts** it posts as.
- **Outputs:** replies (to scored opportunities) + content (post/thread/script/article).

DB (additive, shipped): `agents`, `content_items`, `reply_opportunities`, `reply_drafts`,
`reply_sub_rules`, `reply_state` (active-agent pointer) — all in the shared `openreply.db`.
`brand.py` now projects the *active agent* into the engine's "brand" shape, so the reply
engine is agent-scoped without changing it.

---

## 5. UX / flow decisions (from design + onboarding/ui-state learnings)

- **Agent is the unit of everything** — every screen scoped to the active agent; sidebar
  switcher makes multi-brand first-class.
- **Flow mirrors the job:** ideate (Knowledge/angles) → engage (Inbox/Opportunities →
  reply) → create (Compose) → schedule (Queue) → measure (Analytics).
- **One primary CTA per screen**; progressive disclosure (draft expands inline).
- **Trust signals visible:** score breakdown (relevance × intent × fit), ban-proof
  compliance badge on each draft, BYOK + manual-post stated explicitly.
- **States shown:** scanning / empty / draft / scheduled / posted.
- **Momentum mechanics** (daily goal, streak) — borrowed from ReplyDaddy; drives habit.
- **Landing flow:** `#/` lands on **Agents** (the research dashboard was demoted to
  `#/dashboard`).
- **Page set (15 in prototype):** landing, onboarding wizard, agents, agent overview,
  inbox, opportunities, keywords, compose, queue, knowledge, analytics, alerts,
  connections, settings, plans.

---

## 6. What's been built (state)

### Backend (Python, `src/openreply/reply/`) — working & tested
- `platforms.py` — pickable platform catalog (engage vs discovery-only).
- `agent.py` — Agent CRUD, active pointer, knowledge summary, refresh (reuses `collect`).
- `brand.py` — active-agent → brand shim.
- `opportunity.py` — find candidates (reddit live; others via shared `posts`), LLM score
  (relevance/intent/fit, heuristic fallback), persist + rank.
- `generate.py` — reply drafts (voice + platform length) + Reddit compliance.
- `content.py` — post/thread/script/article from voice + corpus excerpts.
- `rules.py` — subreddit `about/rules.json` fetch/cache + LLM compliance check.
- CLI: `openreply reply …`, `openreply agent …`, `openreply content …` (all `--json`).
  Verified end-to-end (real Reddit posts via RSS fallback; real LLM drafts).

### Desktop UI (Tauri, `app-tauri/`) — wired, compiles, runs
- 12 Rust command bridges (`commands.rs` + `main.rs`), `api.js` wrappers.
- Screens: `agents.js`, `opportunities.js`, `compose.js`. Flow: `#/` → Agents.
- Sidebar trimmed (15 off-mission items hidden).

### Prototype (`prototype/`) — clickable HTML, Reddit theme, dark/light
- 15 static pages + `proto.css` + shared `app.js` (injected sidebar + theme toggle).

### Branch / commits
All on `open-reply` (pushed to origin). Sequence: reply engine → agent model → nav trim →
reshape plan → UI screens+bridge → prototype → Reddit-theme prototype with new pages.

---

## 7. Hard-won technical learnings (gotchas)

- **ReplyDaddy/Reppit sites are JS-rendered** → `WebFetch` (static fetch) returns almost
  nothing. Use a **headless-browser crawler** (crawl4ai/Playwright) for real content +
  computed colors. (This is why we installed crawl4ai — §8.)
- **Dev sidecar lock contention:** on `tauri dev` boot the warm Python daemon can lose a
  lock and fall back to slow one-shot calls (~10–30s each) until it pre-warms (~17s).
  Dev-only; not a bug. Production uses the bundled ONEDIR sidecar.
- **macOS Gatekeeper** can hang an unsigned PyInstaller binary for minutes on first spawn
  → the dev `.venv` bypass exists for this.
- **Command triangle** is mandatory: `commands.rs` (`#[tauri::command]`) ↔
  `main.rs` `generate_handler![]` ↔ `api.js` `invoke`. Miss one → "command not found".
- **Reddit needs no official API**: cookie `.json` (when connected) → RSS fallback,
  via a tier cascade; never raises.
- **Screenshots blocked by lock screen** — when verifying GUI, the Mac may auto-lock
  during long builds; rely on functional checks (compile + `node --check`) too.
- **Visual confirmed:** dark theme + injected sidebar render correctly; orange accent.

---

## 8. Research tooling — crawl4ai (going forward)

**Decision:** do all further web research with **crawl4ai** (https://github.com/unclecode/crawl4AI),
a Playwright-based, LLM-friendly crawler. It renders JS sites (unlike static fetch),
returns clean markdown, and supports CSS/LLM extraction strategies — ideal for scraping
competitor sites (ReplyDaddy, Reppit, etc.) for exact features, copy, and brand colors.

Install (project venv):
```bash
.venv/bin/pip install -U crawl4ai
.venv/bin/crawl4ai-setup        # installs Playwright Chromium + diagnostics
.venv/bin/crawl4ai-doctor       # verify
```
Minimal usage:
```python
import asyncio
from crawl4ai import AsyncWebCrawler
async def main():
    async with AsyncWebCrawler() as c:
        r = await c.arun(url="https://replydaddy.com/")
        print(r.markdown)          # rendered, clean markdown
asyncio.run(main())
```
Use it to: extract competitor feature lists & pricing verbatim, pull exact brand colors
(crawl the CSS / screenshot), and gather subreddit-rule patterns for the compliance
engine. Replace static `WebFetch` for any JS-heavy or content-rich research target.

---

## 9. Next steps (prioritized)

1. **Crawl ReplyDaddy + 3 alternatives with crawl4ai** → exact features, copy, pricing,
   brand hex; retune `--reddit`/accent if their brand differs; fold findings here.
2. **Build the gap screens for real** (Inbox, Keywords, Analytics, Queue, Alerts) +
   onboarding wizard, mapping the approved prototype to `app-tauri/src/screens/`.
3. **Phase 3 reshape** (per `OPENREPLY_RESHAPE.md`): delete papers/product/academic code
   + sources to slim the sidecar; drop dead tables (with backup).
4. **Outbound publishing** (`publish/` adapters) + scheduler so "post" isn't only manual.
5. **Account-safety engine** (karma/limits/rule flags) behind the overview widget.

---

## 10. Update protocol

Update this file whenever: competitor research yields new facts, a design/flow decision
changes, a screen/feature ships, or a gotcha is found. Pair every changelog entry that
touches OpenReply with an update here. Re-crawl competitors with crawl4ai before any
positioning/pricing decision.
