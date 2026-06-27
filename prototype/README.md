# OpenReply — clickable HTML prototype

Static, no-backend prototype to lock the **UX + flow** before changing the real app.
Reddit-inspired palette (orangered `#FF4500`) with **dark + light** themes. Pure HTML +
one CSS file + a tiny shared `app.js` (injects the sidebar + handles the theme toggle).

## Run
```bash
open prototype/index.html      # or double-click it
```
Everything is navigable by links/buttons — no server, no build. Toggle **dark/light**
from the bottom of the sidebar (or the 🌓 button on the landing page); choice persists.

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
  compose.html ...... generate post / thread / script / article
  queue.html ........ drafts · scheduled · posted
  knowledge.html .... niche knowledge map + refresh cadence + angles
  analytics.html .... replies/leads KPIs · momentum · by-platform · top subs · best content  ★ new
  alerts.html ....... alert rules (Slack/email, intent/score thresholds)  ★ new
  connections.html .. per-platform login
  settings.html ..... BYOK · appearance · voice · alerts · refresh · data
  pricing.html ...... Free/self-host · Solo $49 · Business $199 · Team $799 + lifetime  ★ new
```

## What changed in this pass (learned from ReplyDaddy + alternatives)
- **Reddit palette + dark/light** theme system (CSS vars, persisted toggle).
- **Mentions Inbox** (F5Bot/Syften-style real-time alerts) with intent + sentiment filters.
- **Keywords & subreddits** tracking page with AI-suggest + negative keywords.
- **Analytics** (replies posted, leads, reply→lead rate, momentum, by-platform).
- **Alert rules** (Slack/email, intent/score thresholds, sub-minute latency framing).
- **Daily goal + momentum + account safety** on the agent overview.
- **Plans** page (ReplyDaddy-style tiers + lifetime, BYOK note).

## Iterate
Edit HTML directly. Sidebar/nav is defined once in `app.js` (the `NAV` array). When the
flow is approved, map each page to the real screens in `app-tauri/src/screens/`
(`agents`, `opportunities`, `compose` already wired) and build the rest. Boilerplate +
backend functions stay the same.
