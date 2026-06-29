# OpenReply — clickable HTML prototype

Static, no-backend prototype to lock the **UX + flow** before changing the real app.
Built with **Tailwind CSS** (Play CDN — zero build) + **Lucide icons**, Reddit-inspired
palette (orangered `#FF4500`), and **dark + light** themes. A tiny shared `app.js`
injects the sidebar, loads Lucide, handles the theme toggle, and provides the agent
switcher + reusable toast/modal helpers.

## Run
```bash
open prototype/index.html      # or double-click it
```
No server, no build. Toggle **dark/light** from the bottom of the sidebar; choice
persists. Working interactions: the **Active agent** switcher (persists / "+ New agent"
→ onboarding), **+ Track a query** (opens a modal, adds a row), and every other button
gives feedback via a toast. Hard-refresh (Cmd+Shift+R) any open tab after pulling.

## Pages
```
index.html ......... landing / value prop
onboarding.html .... Create-Agent wizard (identity → voice → keywords → connect → BYOK)

App (shared sidebar, theme toggle):
  agents.html ....... persona dashboard (create / switch / open)
  agent.html ........ agent overview: daily goal · momentum · account safety · angles · top opps
  inbox.html ........ live mentions feed — intent/sentiment filters, real-time alerts  ★ new
  opportunities.html  find → score (relevance×intent×fit) → Draft reply (+ compliance)
  keywords.html ..... tracked keywords + subreddits, AI-suggest, negative keywords  ★ new
  compose.html ...... generate post / thread / script / article, save drafts, schedule
  queue.html ........ drafts · scheduled · posted (shares localStorage with Compose)
  chat.html ......... AI research assistant for angles, competitors, and drafts  ★ new
  subreddit.html .... Subreddit Intelligence — rules, strictness, timing, account eligibility  ★ new
  knowledge.html .... niche knowledge map + refresh cadence + angles
  analytics.html .... replies/leads KPIs · momentum · by-platform · top subs · best content
  geo.html .......... AI Visibility (GEO) — brand citations in Google/LLM answers  ★ new
  alerts.html ....... alert rules (Slack/email, intent/score thresholds)
  connections.html .. per-platform login (read-only, account-safe)
  settings.html ..... BYOK · appearance · voice · alerts · refresh · data
  pricing.html ...... open-source/BYOK-no-caps positioning + competitor comparison
```

Nav is grouped: **Agents** · per-agent (Overview/Inbox/Opportunities/Compose/Queue/Chat) ·
**Intelligence** (Keywords/Subreddit Intel/Knowledge/Analytics/AI Visibility) · **Account**.
Compose/Queue/Chat share one `localStorage` draft list so edits and saves flow between screens.
Landing, onboarding (proven 5-step flow), and Plans encode the competitor findings from
`docs/research/COMPETITOR_LANDSCAPE.md`.

## What changed in this pass (learned from ReplyDaddy + alternatives)
- **Reddit palette + dark/light** theme system (CSS vars, persisted toggle).
- **Mentions Inbox** (F5Bot/Syften-style real-time alerts) with intent + sentiment filters.
- **Keywords & subreddits** tracking page with AI-suggest + negative keywords.
- **Analytics** (replies posted, leads, reply→lead rate, momentum, by-platform).
- **Alert rules** (Slack/email, intent/score thresholds, sub-minute latency framing).
- **Daily goal + momentum + account safety** on the agent overview.
- **Plans** page (ReplyDaddy-style tiers + lifetime, BYOK note).
- **App-shell scroll fix**: sidebar stays fixed, main content scrolls independently on every page.
- **Chat** page with a working AI-assistant message flow.
- **Compose + Queue wiring**: kind buttons generate correct Post/Thread/Video script/Article samples, Save draft persists, Schedule → Queue, and drafts are editable from both screens.
- **Knowledge map** is taller; angle links prefill Compose with the selected angle.

## Iterate
Edit HTML directly. Sidebar/nav is defined once in `app.js` (the `NAV` array). When the
flow is approved, map each page to the real screens in `app-tauri/src/screens/`
(`agents`, `opportunities`, `compose` already wired) and build the rest. Boilerplate +
backend functions stay the same.
