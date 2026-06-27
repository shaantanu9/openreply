# OpenReply — clickable HTML prototype

Static, no-backend prototype to lock the **UX + flow** before changing the real app.
Pure HTML + one CSS file + tiny inline JS (show/hide + step wizard). Open in any browser.

## Run

```bash
open prototype/index.html        # macOS
# or just double-click prototype/index.html
```

Everything is navigable by links/buttons — no server, no build.

## Pages & flow

```
index.html ─ landing / value prop
   └─► onboarding.html ─ Create-Agent wizard (5 steps: identity → voice → sources → connect → BYOK)
          └─► agent.html ─ Agent overview (KPIs · fresh angles · top opportunities)

App shell (sidebar on every page below):
  agents.html ......... dashboard of agent personas (create / switch / open)
  agent.html .......... active agent overview
  opportunities.html .. find → score (relevance×intent×fit) → Draft reply (+ compliance badge)
  compose.html ........ generate post / thread / script / article from knowledge
  queue.html .......... drafts + scheduled + posted content
  knowledge.html ...... niche knowledge map + refresh cadence + angles
  connections.html .... per-platform login (Reddit/X/LinkedIn/…)
  settings.html ....... BYOK key · voice defaults · refresh · data
```

## Design decisions encoded here (the "learnings")

- **Agent = the unit.** Every screen is scoped to the active agent (brand/niche persona);
  the sidebar switcher makes multi-brand first-class.
- **Flow mirrors the job:** ideate (Knowledge/angles) → engage (Opportunities → reply) →
  create (Compose) → schedule (Queue). One primary CTA per screen.
- **Scoring is visible** (relevance × intent × fit) so users trust the ranking.
- **Ban-proof is surfaced** as a compliance badge on each reply draft.
- **BYOK + manual-post** are explicit (matches ReplyDaddy + our privacy stance).
- **Empty/loading/scanning states** are shown (e.g. the "Scanning…" status on Opportunities).

## How to iterate

Edit the HTML directly — it's intentionally simple. When the flow is approved, we map each
page to the real screens already wired in `app-tauri/src/screens/` (agents, opportunities,
compose) and build the rest (queue, knowledge map, onboarding wizard). Boilerplate +
backend functions stay the same.
