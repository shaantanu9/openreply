# Gap Map — Product gaps + retention plan

> What we built is great for **first-use** ("wow, this found insights I'd never have surfaced"). It's not yet great for **tenth-use** — there's no daily/weekly loop that pulls people back. This doc names the gap and the fix list.

**Last updated:** 2026-04-20
**Companion to:** `docs/PROJECT_STATUS.md` (what's done) · `docs/specs/2026-04-20-insight-engine.md` (Phase 1+2 spec)

---

## 1. How our current features help the app

### 1.1 What Phase 1 + Phase 2 actually delivers

| Feature | What it gives the user | Where in app |
|---|---|---|
| **Minto pyramid header** | First-sentence answer. User gets the decision prompt in ≤5 s instead of scrolling through 45 bullets. | Insights tab, top |
| **Hypothesis cards with falsifiers** | Every top opportunity becomes a testable bet with a 2-week cheapest test. Turns research → action. | Insights tab, hypothesis section |
| **Counter-evidence modal** | One click shows "3 posts disagree." Kills confirmation bias. Pro researchers love this; no competitor has it. | Insights card chip → modal |
| **Ulwick Opportunity Score (0–20)** | Citable scoring math users can defend to their co-founder/investor. | Every finding card |
| **Triangulation badges** | Visual signal of "3 sources agree vs. 1." Takes half a second to read cross-source validity. | Every finding card |
| **Credible intervals on counts** | "87% CI: 5.2–11.8% of corpus" instead of "N=14." Statistically honest. | Every finding card |
| **Multi-source parallel collect** | 13 sources in parallel (HN + arXiv + App Store + …) in ~2–3 min. 5× richer than Reddit-only tools. | Collect screen |
| **Cross-source graph with source_evidence edges** | Painpoints visibly link to the sources that evidence them. Click a source → drill into Posts. | Map + Sources + Evidence tabs |
| **Provider-agnostic synthesis** | Works with Claude, OpenAI, OpenRouter, Gemini, DeepSeek, Mistral, Groq, Ollama. Per-provider corpus caps auto-adapt to context windows. | Invisible infra |

### 1.2 Today's end-to-end flow

```
NEW USER  →  Welcome screen  →  Enter topic  →  Collect (~2-5 min)
              ↓                                         ↓
         Explore dashboard                      Topic page (Insights tab auto-loads)
              ↓                                         ↓
         Click topic card                        Read Minto header (15 s)
                                                       ↓
                                                 Skim opportunities (60 s)
                                                       ↓
                                                 Read top-1 hypothesis card (30 s)
                                                       ↓
                                                 Click counter-evidence (45 s)
                                                       ↓
                                           ???  (nothing pulls them back tomorrow)
```

**This is the retention problem.** The first run is high-value. The second visit has nothing new to offer unless the user manually starts another collect.

---

## 2. What's MISSING to make users stick

Ranked by retention impact per engineering hour. Each item names the concrete feature, why users need it, and how long to build.

### 2.1 🔴 Critical for retention (ship in next 2–3 weeks)

#### **Hypothesis tracking / decision journal**
**Why:** Every hypothesis card today is ephemeral. Users think "great idea" and the card sits there. If each card had **[ ] running** / **[ ] validated** / **[ ] invalidated** / **[ ] paused** states with notes + dates, Gap Map becomes the **one place you track your product bets** — the "Superhuman for product research."

**The retention unlock:** users come back every Friday to update their hypothesis states. That's the weekly ritual we lack.

**What to build:**
- New `hypothesis_tests` SQLite table: `{id, topic, card_json, status, started_at, resolved_at, resolution_notes, linked_evidence}`
- State toggle UI on every hypothesis card
- "My bets" tab on the dashboard — all hypotheses across all topics, grouped by state
- Weekly "update your bets" reminder (native macOS notification)

**Effort:** ~3 days. **Retention lift:** massive.

---

#### **Monitoring mode / weekly delta view** (Phase 5 from the spec)
**Why:** Without auto-refresh, Gap Map is a one-shot tool. With it: users open the app and see "this week in your topics: 3 new painpoints, 1 new competitor, 2 new arXiv papers." That's the Kindle-of-research hook — something changed since you last looked.

**What to build:**
- `launchd` weekly cron (already have the infra) → re-runs `collect` + `synthesize_insights` on scheduled topics
- Delta table: `topic_deltas{topic, run_date, new_findings, new_competitors, changed_scores}`
- Dashboard "What's new this week" card at the top
- Per-finding indicator: "↑ opportunity score up 2.3 this week"
- Native OS notification on collect completion

**Effort:** ~5 days. **Retention lift:** the biggest single feature we could ship for DAU.

---

#### **Cross-topic search + dashboard overview**
**Why:** When users have 5+ topics, they lose sight of "what's the biggest opportunity across everything I'm tracking?" Today each topic is an island.

**What to build:**
- Dashboard "Top opportunities" leaderboard (cross-topic) sorted by Ulwick score
- Global search bar: "show me all painpoints mentioning 'subscription fatigue'" → hits across every topic's findings
- "Related topics" suggestion on each topic page ("you've researched X, consider Y based on overlap")
- Semantic palace is already there — just needs the cross-topic query path

**Effort:** ~2 days. **Retention lift:** directly correlates with active topics (more topics = more need = more stickiness).

---

### 2.2 🟡 High-value (next 4–6 weeks)

#### **Exportable briefs** (Phase 6 from the spec)
**Why:** Users who do great research want to share with co-founders, investors, partners. Every share = new user exposure. Today there's no share surface.

**Formats to ship (priority order):**
1. **One-page PDF brief** — Minto header + top-3 hypotheses + quadrant chart + citations footer. Claude generates the layout prose; we handle typography.
2. **Markdown export for Notion / Linear** — copy-paste ready. Notion users are our target demographic; this is the virality channel.
3. **Hypothesis cards as standalone PDFs** — one card per page, printable for interview prep.

**Effort:** ~4 days for all three. **Retention lift:** moderate (drives pull-through, doesn't directly drive returns, but brings new users via shares).

---

#### **In-product chat on Insights tab**
**Why:** After reading the brief, every user has follow-up questions. ("Who else is already solving this?" "What's the smallest test I could run?" "Is this big in EU too?") Chat tab exists but is buried. Move it to the Insights tab as a persistent sidebar.

**What to build:**
- Sticky chat panel on right side of Insights tab
- Pre-seeded prompts: "What are the top 3 risks?", "Who's the incumbent I'd compete against?", "What's the smallest experiment?"
- Agent's tool set expanded with 3 new tools: `get_hypothesis_card`, `compare_topics`, `synthesize_market_report`
- Chat thread persists per-topic (already does)

**Effort:** ~3 days. **Retention lift:** high — natural way to extend engagement past initial read.

---

#### **Onboarding / empty-state flow for first-run**
**Why:** New user sees empty dashboard. Cognitive leap from "I have a vague product idea" to "type a topic name" is too big. Today we lose users at this step.

**What to build:**
- Welcome → "What are you researching?" single-text prompt with 5 example topics ("AI coding assistants", "sleep tracking apps", "no-code website builders") as quick-start chips
- Optional URL/competitor-paste: "drop in a competitor website, we'll suggest topics" (Claude call extracts category)
- 90-second explainer video or gif showing the Minto header → hypothesis → counter-evidence flow
- Skip to first collect in ≤30 s from fresh install

**Effort:** ~2 days. **Retention lift:** massive for TOP-of-funnel conversion. Directly affects D1 retention.

---

### 2.3 🟢 Nice-to-have (after retention features ship)

#### **Topic comparison view**
"Is market X bigger than market Y?" — side-by-side quadrants, merged Minto summaries. ~2 days.

#### **Competitor matrix** (Phase 3 from spec)
Feature-vs-competitor table, auto-extracted. ~2 days. Makes the existing competitor section more actionable.

#### **"Flag as wrong" button on findings**
1-day implementation. Valuable feedback channel.

#### **Dark mode**
Users expect this in a professional tool. ~1.5 days.

#### **Keyboard shortcuts**
Cmd+K global search, Cmd+N new topic (exists), J/K navigate cards, / focus search. ~1 day.

#### **Progressive insights during collect**
Show Reddit findings after 30 s, academic findings after 60 s, full brief at 3 min. Reduces perceived latency. ~2 days.

---

## 3. UX / UI gaps on existing features

Things that LOOK fine but have measurable friction.

### 3.1 The topic page has too many tabs

**Current:** Insights · Map · Report · Evidence · Trends · Sentiment · Sources · Posts · Research · Chat · Solutions · Actions (12 tabs).

**Problem:** tab bar overflows on standard displays; users don't know where to start; 70% of tabs are used by <10% of users.

**Fix:** collapse to 4 primary + "More" dropdown:
- **Primary:** Insights · Evidence · Chat · Actions
- **More:** Map, Report, Trends, Sentiment, Sources, Posts, Research, Solutions

Insights becomes the undisputed home. Power users still get everything via More.

**Effort:** ~0.5 day.

### 3.2 Finding cards are visually dense

**Current:** every card has 8+ meta-chips (imp, sat, cov, triangulation, classification, academic, CI, counter-evidence, citations). Reads as noise at first glance.

**Fix:**
- Tier 1 (always visible): Ulwick score badge + 1-2 most important chips (triangulation + counter-evidence)
- Tier 2 (on hover or expand): all other chips
- Visual hierarchy: governing thought > opportunity score > chips > narrative > quote > sources

**Effort:** ~0.5 day CSS + JS.

### 3.3 Dashboard is a topic grid with no signal

**Current:** squares with topic names, painpoint counts, "last collected" dates.

**Fix:**
- Top section: "Your top 5 opportunities across all topics" — cross-topic leaderboard (requires cross-topic search from §2.1)
- Middle: "What's new this week" — requires monitoring mode
- Bottom: topic grid as secondary nav

**Effort:** ~1 day after monitoring + cross-topic features exist.

### 3.4 Empty states are unhelpful

- Topic with 0 findings: "No findings extracted." Should suggest *why* and what to do.
- Dashboard with 0 topics: no welcome guidance.
- Insights tab before generation: generic "click to generate" instead of explaining what the user will get.

**Fix:** rewrite every empty-state copy to be **specific + actionable**. ~0.5 day across all screens.

---

## 4. User flows missing today

### 4.1 Onboarding flow (doesn't exist)

Should exist:
```
Fresh install → Welcome (what Gap Map does, 15s)
             → Quick-start: "pick a research topic or paste a competitor URL"
             → [5 example chips + free-text + URL paste]
             → First collect (with narrated progress: "we're searching Reddit… arXiv…")
             → Landing on Insights with a "read the governing thought first" callout
             → After 90s: "Want to test this? Open the hypothesis card"
             → After reading hypothesis: "Save to your bets list" CTA
```

### 4.2 Weekly check-in flow (doesn't exist)

Should exist:
```
Monday morning  → Native notification "3 topics updated this weekend"
              → Click → Dashboard shows delta banner
              → Click a topic with "↑ new opportunity" badge
              → Insights tab shows what changed (arXiv paper dropped, new competitor, score delta)
              → User updates 2 hypothesis states (1 validated, 1 paused)
              → Close app. Came back for 4 min. Habit formed.
```

### 4.3 Research-to-decision flow (halfway there)

Exists: collect → insights → read hypothesis card.
Missing: what happens AFTER reading? Where does the user go to take action?

Should exist:
```
Read hypothesis card → "Start this test" button
                    → Creates entry in `hypothesis_tests` with status=running
                    → Shows a mini-checklist: interview prep / landing-page URL slot / "paste results here"
                    → 2 weeks later: notification "Your test is due — what happened?"
                    → User marks validated/invalidated with notes
                    → Insights tab highlights: "Validated bets: 2 · Invalidated: 1 · Running: 3"
```

---

## 5. What users actually pay $20–40/mo for (thesis)

Based on category comparables (Superhuman, Notion, Linear, Perplexity Pro):

1. **Time savings** — "gives me in 10 minutes what 3 hours of Reddit + App Store browsing would." ✓ Already delivered.
2. **Confidence** — "I can share this with my co-founder and defend every claim." ✓ Already delivered (citations + credible intervals + counter-evidence).
3. **Habit/ritual** — "I check it every Monday morning alongside my coffee." ✗ Missing. This is what §2.1 fixes.
4. **Shareability** — "I exported a brief and our investor took a meeting." ✗ Missing. Phase 6 / §2.2.
5. **Compounding value** — "the more topics I research, the more useful the app becomes." ✗ Missing. Cross-topic search + "your bets" dashboard (§2.1).

Without #3–5, we're at best a "great tool you buy once and churn from." With them, we're a research SaaS.

---

## 6. Concrete 6-week ship plan

If the goal is **retention + first paying users**, this is the order:

**Week 1:** Hypothesis tracking / decision journal (§2.1 #1) — 3 days
**Week 2:** Monitoring mode + weekly delta view (§2.1 #2) — 5 days
**Week 3:** Cross-topic search + dashboard overhaul (§2.1 #3 + §3.3) — 3 days
**Week 4:** Onboarding flow + empty-state polish (§2.2 onboarding + §3.4) — 3 days
**Week 5:** Exportable briefs (§2.2 #1) — 4 days
**Week 6:** In-product chat on Insights (§2.2 #2) + tab cleanup (§3.1) — 3.5 days

End of 6 weeks: Gap Map is a **research SaaS**, not a one-shot tool. Each user has a reason to return weekly, a way to share, and a compounding library of tracked bets.

---

## 7. What we do NOT do to improve retention

Rejected tactics (same honesty-filter as §2 of `PROJECT_STATUS.md`):

| Tactic | Why not |
|---|---|
| Email drip campaigns, newsletter | We're a desktop app, not a web SaaS. Email is out of flow. Native notifications handle the same job in-app. |
| Gamification / streaks / badges | Clout doesn't sell to serious founders. Progress on real hypothesis tests = the only "streak" that matters. |
| Social features / team workspaces | Solo-user product first. Team workspaces = big architectural lift (auth, permissions, sync). Revisit only at 1000+ users. |
| Feature walkthroughs / popups | Interrupt flow. Replace with smart empty states + tooltips on hover. |
| Ads / tracking pixels | We're a pro tool. Users pay. No ads. |

---

*This doc is a product-thinking audit. Companion to `PROJECT_STATUS.md` which logs what's shipped.*
