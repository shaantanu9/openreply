# Gap Map — Product Strategy: The Dual-Mode Pivot

> How Gap Map evolves from a one-shot research tool into a daily-use product intelligence platform — without losing the research engine that makes it defensible.

**Version:** 1.0
**Last updated:** April 20, 2026
**Status:** Strategic direction document — precedes implementation spec
**Related:** `docs/specs/2026-04-20-insight-engine.md`, `docs/GAP_MAP_METHODOLOGY.md`, `PROJECT_STATUS.md`

---

## Table of Contents

1. [The Core Insight](#1-the-core-insight)
2. [Two Modes, One Product](#2-two-modes-one-product)
3. [The User Journey — Build → Maintain](#3-the-user-journey--build--maintain)
4. [Product Mode — What It Looks Like](#4-product-mode--what-it-looks-like)
5. [Topic Mode — What Stays and Why](#5-topic-mode--what-stays-and-why)
6. [Shared Infrastructure](#6-shared-infrastructure)
7. [Data Model Changes](#7-data-model-changes)
8. [Pricing & Commercial Model](#8-pricing--commercial-model)
9. [The Path to $100K ARR](#9-the-path-to-100k-arr)
10. [Validation Plan — Three Founders, Two Weeks](#10-validation-plan--three-founders-two-weeks)
11. [Implementation Roadmap](#11-implementation-roadmap)
12. [What We Are NOT Doing](#12-what-we-are-not-doing)

---

## 1. The Core Insight

Gap Map today is a **one-shot research tool**. A user picks a topic, the engine runs, they get a brief. They close the tab. They open it again months later for another topic. This is episodic use — valuable, but not daily, and not defensible against a $20/mo price ceiling.

The pivot is to add a second mode that turns Gap Map into **continuous product intelligence for an existing product**. Instead of asking "what should I build?", the user asks "what should I fix next, what are my competitors doing, and what is the market telling me about my product?"

**This does not replace topic-mode research.** It adds a second mode. Both modes share the same engine, the same graph, the same synthesis pipeline. What differs is the *object of attention* (topic vs. product) and the *cadence of consumption* (one-shot vs. continuous).

### 1.1 Why two modes, not one

The naive pivot would kill topic mode. That's wrong. Here's why both are load-bearing:

| Stage in founder's journey | Dominant mode | Why |
|---|---|---|
| Pre-build / ideation | Topic | No product exists yet. Founder is evaluating a space. |
| Early build (MVP) | Topic + Product | Topic to shape the build; Product to monitor early traction. |
| Post-launch | Product | Real users, real reviews, real competitors. Monitoring is the job. |
| Considering expansion / adjacent market | Topic | Back to exploration for a new space. |
| Mature operation | Product | Ongoing market intelligence, competitor tracking, user pain monitoring. |

**Founders move between modes throughout a product's life.** A tool that only serves one mode loses them at the transition. A tool that serves both becomes a lifecycle companion — and lifecycle companions have the lowest churn in SaaS.

### 1.2 The philosophical shift

| | Research tool (today) | Product intelligence platform (pivot) |
|---|---|---|
| Unit of attention | Topic | Product (user's own + competitors) |
| Cadence | One-shot, episodic | Continuous, daily/weekly |
| Question answered | "What should I build?" | "What should I fix, and what are they doing?" |
| Output | Brief | Dashboard + signals + brief |
| User relationship | Consultant | Operating system |
| Switching cost | Low (can re-run elsewhere) | High (monitoring history + connected data) |
| Pricing anchor | Market research ($500–5000/report) | Monitoring SaaS ($50–500/mo, always on) |
| Daily-use eligibility | No | Yes |

---

## 2. Two Modes, One Product

### 2.1 Topic Mode (the existing product, preserved)

**Purpose:** Exploration. Answer open-ended strategic questions about a market or category.

**When a user uses it:**
- Pre-build validation ("is there a real problem here?")
- Adjacent market exploration ("should we expand into X?")
- Competitive landscape study for a new category
- Academic or consulting research
- One-off strategic questions from leadership

**Core loop:** Enter topic → triangulated collection → synthesis → Minto brief + hypothesis cards → export.

**Nothing about this changes.** Topic mode is the product we just finished building in Phase 1 + Phase 2 (insights engine, Ulwick scoring, hypothesis cards, counter-evidence, triangulation badges).

### 2.2 Product Mode (the new addition)

**Purpose:** Operations. Continuously monitor a specific product, its competitors, and its category — ongoing, not one-shot.

**When a user uses it:**
- Every morning: check what's new about their product and competitors
- Weekly: review digest of deltas, act on highest-priority signals
- Before a release: check if the next build should address a newly-emerged painpoint
- After a release: monitor how it's landing

**Core loop:** Register product (name, category, competitors, connected sources) → continuous collection → daily signal dashboard + weekly digest + on-demand deep-dive briefs (which are actually topic-mode runs scoped to the product's category).

**Key property:** Product Mode *uses* Topic Mode as a primitive. A "deep dive on a specific competitor" is a Topic Mode run scoped to that competitor. A "category exploration" is a Topic Mode run on the product's category. Product Mode is the always-on surface; Topic Mode is the on-demand surface.

### 2.3 The relationship

```
┌─────────────────────────────────────────────────────────────────┐
│                          GAP MAP                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌──────────────────┐         ┌──────────────────────────┐     │
│   │   TOPIC MODE     │         │     PRODUCT MODE         │     │
│   │  (exploration)   │         │    (operations)          │     │
│   │                  │         │                          │     │
│   │  • One-shot runs │ ◄─────► │  • Continuous monitoring │     │
│   │  • Any category  │   uses  │  • Registered product    │     │
│   │  • Deep briefs   │         │  • Daily dashboard       │     │
│   │  • Hypothesis    │         │  • Weekly digest         │     │
│   │    cards         │         │  • Signal inbox          │     │
│   └──────────────────┘         └──────────────────────────┘     │
│           │                               │                     │
│           └───────────────┬───────────────┘                     │
│                           ▼                                     │
│     ┌─────────────────────────────────────────────┐             │
│     │  SHARED ENGINE                              │             │
│     │  • Multi-source collection (13+ sources)    │             │
│     │  • Semantic graph (posts → findings)        │             │
│     │  • Claude-native synthesis (Phase 1+2)      │             │
│     │  • Ulwick scoring, Popper falsifiers,       │             │
│     │    Minto pyramid, triangulation             │             │
│     └─────────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. The User Journey — Build → Maintain

This is the argument for why both modes must coexist, shown as a timeline for a single hypothetical user.

### 3.1 Day 0 — Idea stage

**User:** "I'm thinking of building a meditation app with sound frequency / brainwave features. Is there a real market here?"

**Gap Map mode used:** **Topic Mode**

**What they do:**
- Create a topic: "meditation sound frequency brainwave app"
- Run collection across all sources
- Review the Minto brief: governing thought, 3 arguments, opportunity table
- Inspect hypothesis cards: which unmet jobs have the highest Ulwick Opportunity Score?
- Export the brief to their cofounder

**Outcome:** Decision to build, with evidence of a chronic underserved painpoint (say: "users complain that existing apps have shallow sound science — just background music labeled as 432Hz").

**Time spent in Gap Map:** 4 hours across 3 sessions in one week. Then closed.

### 3.2 Day 30 — MVP built

**User:** "App is in TestFlight. Let me turn on product monitoring."

**Gap Map mode used:** **Both — registers Product Mode for the first time**

**What they do:**
- Register their product ("MindWave Pro") in Product Mode
- Add competitors: Calm, Headspace, Brain.fm, Endel, Insight Timer
- Connect sources: their subreddit (new, small), their app store page, their Reddit mentions
- Product Mode starts continuous monitoring
- Topic Mode run on "meditation app onboarding" to inform their launch flow

**Outcome:** Dashboard now shows weekly digest of what's happening in the category, plus any mentions of MindWave Pro.

**Time spent:** 30 min setup, then ~15 min/week reading the digest.

### 3.3 Day 90 — Public launch

**User:** "We're live on Product Hunt. Reviews coming in."

**Gap Map mode used:** **Product Mode dominant, Topic Mode on demand**

**What they do:**
- Daily: open Gap Map first thing, check "The Mirror" for what new users are saying about MindWave Pro
- Weekly: review "The Signals" — competitor X released a new feature, triggered 200 reviews, 60% negative about pricing changes. Actionable.
- Triggered: run a Topic Mode deep-dive on "meditation app pricing resistance" after noticing the signal.

**Outcome:** Product Mode catches a churn pattern in week 2 — users complain about a confusing session-length picker. Ship fix in week 3. Regression avoided.

**Time spent:** 10 min every morning + 30 min Monday digest review + occasional Topic Mode runs.

### 3.4 Day 180 — Considering expansion

**User:** "Growth is steady. Considering adding a sleep feature."

**Gap Map mode used:** **Topic Mode for the expansion question, Product Mode stays on**

**What they do:**
- Topic Mode run: "sleep sounds sleep meditation app features"
- Separately, Product Mode continues monitoring their core product
- Decision: expansion backed by fresh research, core product health visible in parallel

**Outcome:** Two modes working in concert. User has never churned because the tool has been load-bearing at every stage.

### 3.5 The lesson

A **research-only tool** would have lost this user on Day 31. A **monitoring-only tool** would never have captured them on Day 0. The combined tool captures them at Day 0, retains them through Day 180 and beyond, and increases wallet share as they need both modes.

**This is why both modes are required. Not optional.**

---

## 4. Product Mode — What It Looks Like

### 4.1 Onboarding

1. User creates an account, is asked: "Do you have a product, or are you exploring an idea?"
   - "Exploring" → lands in Topic Mode (existing flow)
   - "I have a product" → Product Mode setup
2. Product setup:
   - Product name
   - One-sentence description
   - Category (LLM-suggested from description)
   - Competitors (LLM-suggested + user-confirmed; typically 3–10)
   - Optional connected sources (see §4.3)
3. First collection kicks off; takes ~10–20 min for initial corpus.
4. User lands on the **Daily Dashboard** (see §4.2).

### 4.2 The Daily Dashboard — five sections

The dashboard refreshes every 24 hours. Each section shows delta vs. the last 7 days.

#### Section 1 — The Mirror

*What's being said about **your** product.*

- New painpoints mentioning your product (from reviews, Reddit, forums, support if connected)
- Sentiment trend line (7-day, 30-day, 90-day)
- New praise / new complaints, ranked by severity
- Churn signals: reviews mentioning cancellation, switching, disappointment
- Review velocity vs. expected baseline

**Why it matters:** This replaces the manual "check our reviews every morning" task every founder does. Single biggest time-saver.

#### Section 2 — The Lens

*What's being said about **each competitor**.*

- Per-competitor mini-card: review velocity, sentiment trend, top new painpoint, new feature announcements detected from news/blogs
- **The delta view** — the most valuable part:
  - "Users praise Competitor X for [thing]" vs. "Users complain about your product for [related thing]" → opportunity
  - "Users complain about Competitor Y's pricing" → opportunity to position against
- Competitor release detection: product updates inferred from review spikes + changelog scraping

**Why it matters:** Competitive intelligence that currently takes a junior analyst 4 hours per week is automated.

#### Section 3 — The Field

*What's happening in **your category as a whole**.*

- Emerging painpoints crossing into chronic threshold (using existing Guest/Hennink saturation logic)
- Fading painpoints (losing relevance)
- New entrants detected (products mentioned as alternatives in your category)
- Category-level trends from Google Trends + news velocity

**Why it matters:** This is your existing Topic Mode engine, pointed at a fixed category, refreshed continuously. No additional research effort required from the user.

#### Section 4 — The Signals

*Specific events worth acting on **this week**, ranked.*

A signal is a typed event:

| Signal type | Example | Recommended action |
|---|---|---|
| `competitor_release` | "Calm shipped a sleep-story redesign; 73 reviews, 61% negative, complaint: 'too many ads'" | Position against; consider migration CTA |
| `chronic_emergence` | "New chronic painpoint in category: 'privacy of meditation data'" | Add privacy page; consider feature |
| `your_product_regression` | "Review velocity down 40% WoW; top complaint cluster: 'latest update crashes'" | Immediate engineering attention |
| `unmet_need_intensifying` | "Opportunity Score for 'offline mode' jumped 15 → 19" | Prioritize in next planning cycle |
| `competitor_vulnerability` | "Brain.fm: 3-star avg, trending down; top complaint: 'pricing'" | Comparison campaign |
| `mention_spike` | "Your product mentioned 4× normal rate on Reddit last 48h — source: r/meditation thread" | Check the thread |

Every signal has: severity, confidence, evidence count, suggested action, "mark done" / "snooze" / "convert to hypothesis" verbs.

**Why it matters:** This is the daily-use trigger. Users open the app to clear the signal queue. Like email, but strategically relevant.

#### Section 5 — The Hypotheses

*Your existing Phase 2 hypothesis cards, auto-generated continuously.*

But now framed against **what the user has already built**, not against a generic market. The card asks: "Given MindWave Pro's current feature set, what's the highest-leverage next hypothesis to test?" — with falsifier, cheapest test, and expected outcome.

**Why it matters:** Connects the monitoring surface to action. A signal without a hypothesis is gossip; a signal with a testable hypothesis is product strategy.

### 4.3 Connected Sources (private data pipes)

Public sources continue as in current collection. In Product Mode, users can **optionally** connect private sources for richer signal:

| Source | What it gives | Integration effort |
|---|---|---|
| App Store / Play Store reviews (your app) | Direct user sentiment, rating trends | Public; use store APIs |
| Your subreddit | Direct community feedback | Public via Reddit API |
| Your Product Hunt page | Launch-window feedback | Public scrape |
| G2 / Capterra / Trustpilot (your page) | B2B buyer sentiment | Public scrape |
| Zendesk / Intercom (support tickets) | Private: actual issues users report | OAuth + ticket ingestion |
| Stripe (churn events + reasons) | Private: quantified churn | OAuth + webhook |
| Changelog / blog RSS | Your release history, competitor releases | RSS |
| GitHub Issues (if OSS) | Direct technical painpoints | API token |

**Why this matters commercially:** Connected sources increase switching cost dramatically. A user who has 6 months of Intercom ticket history ingested will not churn.

### 4.4 The weekly digest

Every Monday 8am (user's timezone), an email + Slack message:

```
Subject: MindWave Pro — Week of April 20

▓▓▓ Your product ▓▓▓
• Review velocity: +12% WoW (healthy)
• New top complaint: session timer UX (17 mentions, new)
• New top praise: sound quality (32 mentions, steady)

▓▓▓ Competitor moves ▓▓▓
• Calm: shipped sleep-story redesign; mixed reception
• Endel: raised prices; negative reaction in reviews
• Brain.fm: no detected changes

▓▓▓ Category ▓▓▓
• Emerging: privacy of meditation data (crossed chronic threshold)
• Fading: generic "relaxation" positioning

▓▓▓ Top 3 signals this week ▓▓▓
1. [Your regression] Session timer UX complaints — ACT
2. [Competitor vulnerability] Endel pricing backlash — POSITION
3. [Unmet need] Offline mode opportunity score rising — PLAN

[Open dashboard →]
```

The weekly digest is the retention anchor. Even users who skip daily checks see value every Monday.

---

## 5. Topic Mode — What Stays and Why

**Nothing about Topic Mode gets removed or downgraded.** It continues as the exploration surface. Clarification on how it integrates with the new world:

### 5.1 Topic Mode stays as:

- **Pre-product validation tool** — anyone building something new still starts here
- **Adjacent exploration tool** — Product Mode users run topic queries when considering expansion
- **Deep-dive mechanism within Product Mode** — clicking "deep dive" on a signal or a competitor kicks off a Topic Mode run scoped to that question
- **Research-for-hire mode** — strategy / CI / consulting users who don't have a single product to monitor still use this

### 5.2 Topic Mode improvements inherited from Product Mode

Product Mode needs continuous collection infrastructure (delta detection, scheduled runs, freshness tracking). These capabilities, once built, can flow back to Topic Mode as opt-in features:

- "Re-run this topic weekly and notify me of new findings"
- "Watch this topic" (lighter than a product, heavier than a one-shot)
- Topic collections can mature into products when a user acts on one

### 5.3 The conversion path

A common user journey:

1. Run a Topic Mode exploration
2. Decide to build something based on the findings
3. Click "Turn this topic into a product I monitor" → pre-populated Product Mode registration
4. Topic evidence carries over as historical context; competitors from the topic auto-suggest

This conversion flow is itself a feature and a commercial hook. Topic users convert to Product users, with zero friction.

---

## 6. Shared Infrastructure

Both modes share:

### 6.1 The collection engine

All 13+ sources, the graph model, the triangulation badges, the saturation logic, the bot filtering, the semantic deduplication. No duplication of ingestion code across modes.

### 6.2 The synthesis engine

The Claude-native Phase 1 + Phase 2 synthesis (Minto pyramid, Ulwick scoring, Popper hypothesis cards, counter-evidence, credible intervals, triangulation badges) is called from both modes. Topic Mode runs it on a topic's corpus; Product Mode runs it on a sliding window of the product+competitors corpus.

### 6.3 The graph

One graph. Topics and products both anchor subgraphs. A product's subgraph is larger, more frequently updated, and linked to the user's account. A topic's subgraph is bounded and frozen per run (with optional re-run).

### 6.4 The citation chain

Every claim in either mode traces back to source via the existing Citation object. Shneiderman details-on-demand applies uniformly.

### 6.5 The prompt library

One versioned `/prompts` directory. Mode-specific variants live as separate YAMLs but share common structural rules.

---

## 7. Data Model Changes

### 7.1 New root entities

```python
# Existing
Topic

# New
@dataclass
class Product:
    id: str
    user_id: str
    name: str
    one_liner: str
    category: str
    created_at: datetime
    competitor_ids: List[str]
    connected_sources: List[ConnectedSource]
    monitoring_cadence: str  # daily / weekly
    last_collected_at: datetime
    is_active: bool

@dataclass
class Competitor:
    id: str
    product_id: str          # belongs to a product
    name: str
    category: str
    urls: Dict[str, str]     # {"website": ..., "appstore": ..., "g2": ..., "subreddit": ...}
    tracked_since: datetime

@dataclass
class ConnectedSource:
    id: str
    product_id: str
    source_type: str         # intercom / stripe / zendesk / github / ...
    credential_ref: str      # vault reference, never the raw token
    last_ingested_at: datetime
    status: str              # active / failing / disconnected

@dataclass
class Signal:
    id: str
    product_id: str
    signal_type: str         # see §4.2 signal types
    severity: float          # 0-1
    confidence: float        # 0-1
    detected_at: datetime
    title: str
    description: str
    evidence_ids: List[str]
    suggested_action: str
    user_action: Optional[str]   # dismissed / acted / snoozed / converted_to_hypothesis
    user_action_at: Optional[datetime]
```

### 7.2 Existing entities extended

- `Topic` gets a nullable `product_id` — if set, the topic run is scoped to that product's context
- `Finding` (painpoint, feature_wish, etc.) gains a nullable `product_id`
- `Collection` gains a `mode` field (topic / product) and a `parent_product_id`

### 7.3 Delta engine

The scheduler that powers Product Mode:

```python
# delta_engine.py

def daily_product_sweep(product: Product):
    # 1. Collect last 24h of new posts across product's sources
    new_posts = collect_fresh(product, hours=24)

    # 2. Run open coding on new posts only
    new_codes = open_code(new_posts)

    # 3. Compare to product's running code set
    novel_codes = set(new_codes) - set(product.known_codes)

    # 4. For each novel code, check if it crosses thresholds
    signals = []
    for code in novel_codes:
        if crosses_chronic_threshold(code, product):
            signals.append(build_signal("chronic_emergence", code, product))

    # 5. Detect velocity changes
    for entity in [product] + product.competitors:
        if review_velocity_delta(entity) > 0.3:
            signals.append(build_signal("velocity_spike", entity, product))

    # 6. Detect competitor releases
    competitor_releases = detect_releases(product.competitors)
    signals.extend(build_release_signals(competitor_releases))

    # 7. Rerank + dedupe against last 7 days of signals
    signals = dedupe_and_rerank(signals, product.recent_signals)

    # 8. Publish to dashboard + push notification channels
    publish(product, signals)
    send_weekly_digest_if_monday(product)
```

This runs on a scheduler (cron on macOS launchd for desktop; server-side cron for the hosted version).

---

## 8. Pricing & Commercial Model

### 8.1 The pricing error in the current instinct

$20/mo fails on three independent dimensions:

1. **Unit economics** — continuous monitoring across 13+ sources with LLM synthesis costs $5–15/month per active product at current token prices. $20 leaves too little margin after Stripe fees and infra.
2. **Buyer psychology** — monitoring SaaS at <$50/mo reads as "hobby tool" to anyone with a product live. Tools like Mixpanel, Amplitude, Datadog, Crayon, Klue, Kompyte, Similarweb all sit at $99–$999+/mo per seat. The mental category your tool enters in Product Mode is *that* category, not the $20 productivity tool category.
3. **Wrong buyer** — $20/mo targets hobbyists. Hobbyists churn at 15%+ monthly. The buyer you want is a post-MVP founder or small product team — a buyer who already spends thousands per month on tools and thinks in that unit.

### 8.2 Recommended pricing tiers

| Tier | Price (monthly) | Price (annual) | Target user | Limits |
|---|---|---|---|---|
| **Explorer** | $0 | $0 | Topic Mode only, trial | 3 topic runs/month, no Product Mode |
| **Founder** | $79/mo | $790/yr | Indie founders, solo builders | 1 product, 3 competitors, 5 topic runs/mo, daily digest |
| **Team** | $199/mo | $1,990/yr | Small startups, PM teams | 3 products, 10 competitors each, 25 topic runs/mo, Slack integration, 3 seats |
| **Growth** | $499/mo | $4,990/yr | Growth-stage companies | Unlimited products, unlimited competitors, unlimited topic runs, API, 10 seats, connected private sources (Intercom/Zendesk/Stripe) |
| **Enterprise** | Custom | Custom | 200+ employee companies | SSO, SOC 2, DPA, deployment options, SLA, dedicated success |

### 8.3 Packaging principles

- **No free tier for Product Mode.** Free Product Mode destroys unit economics. Free tier exists only for Topic Mode, as a lead magnet.
- **Annual discount at ~17%** (≈2 months free). Encourages upfront commitment and improves cash position.
- **Product count is the primary limiter across tiers.** Competitor count and source connection gating are secondary.
- **One team seat in Founder, three in Team.** Small teams often share a single account — seat gating forces upgrade when a team actually forms.
- **Connected private sources are a paywall** at Growth tier. This is the feature sophisticated buyers will pay for and the one that creates real switching costs.

### 8.4 Migration path from today's pricing

Existing (if any) $20/mo users grandfather for 12 months. Otherwise, launch Product Mode at Founder tier $79 from day one. The price anchors are set by the category you're entering, not by the comfort of existing users.

---

## 9. The Path to $100K ARR

With the dual-mode product, the math changes favorably.

### 9.1 The revised math

| Route | Customers needed | Time to achieve | Difficulty |
|---|---|---|---|
| All Founder tier | 105 × $79 × 12 = $99,540 | 9–12 months | Medium — hobbyists-plus-pros funnel |
| Mixed Founder + Team | 50 × $79 + 30 × $199 × 12 = $119,040 | 7–10 months | Medium — realistic mix |
| Team-dominant | 42 × $199 × 12 = $100,296 | 6–9 months | Best ROI — fewer, stickier customers |
| Growth tier anchor | 17 × $499 × 12 = $101,796 | 9–12 months | Harder but highest LTV |

**Recommended target: Team-dominant mix.** 30 Team + 20 Founder customers = $87,240 + $18,960 = $106,200 ARR. Achievable in 6–9 months with focused founder-led sales.

### 9.2 The acquisition channels that work at this price

For a tool in the product-intelligence category targeting indie founders + small SaaS teams:

1. **Founder LinkedIn content** — posts dissecting public product launches using Gap Map outputs. Every post is a live case study. 3–5x per week. Builds organic inbound.
2. **Indie Hackers + Reddit r/SaaS / r/startups posts** — free value ("here's what the reviews of [popular app] reveal about their roadmap") drives sign-ups.
3. **Product Hunt launch** — one high-effort launch with 5+ design partner testimonials ready. Mid-six-figure traffic spike; convert 0.5–2%.
4. **Cold outbound** — 20–50 personalized messages/week to post-MVP founders visible on Twitter, Indie Hackers, LinkedIn. Not mass-blast; targeted.
5. **Partnership with no-code / dev-tool ecosystems** — integrations with Bubble, Webflow, Supabase, Vercel dashboards. Founder audiences overlap.

Paid ads do not work at this price point and buyer type. Don't try.

### 9.3 Retention levers (more important than acquisition)

Monthly churn at this tier should be <4% for the model to work. Levers:

- **Weekly digest** — forces re-activation even for skippers
- **Connected sources** — every integration connected = meaningful switching cost
- **Historical data accumulation** — 6 months of monitoring history is irreplaceable; user won't start over elsewhere
- **Hypothesis → outcome tracking** — once a user logs a shipped feature back to a Gap Map hypothesis, the tool has proven its ROI in their internal narrative

---

## 10. Validation Plan — Three Founders, Two Weeks

Before building Product Mode, validate the core thesis with a cheap experiment.

### 10.1 The experiment

Pick three founders whose products are publicly identifiable (active subreddit, App Store presence, real competitive category). For each:

1. Manually set up a "Product Mode" experience — create their product + competitors + sources using existing Topic Mode infrastructure as scaffolding.
2. Run collection and synthesis for their product + each competitor.
3. Build a one-page dashboard (even a shared Notion page is fine) with the five dashboard sections.
4. Send it to them with a note: "Built this for your product as an experiment. No strings. Curious what you think."

### 10.2 What to observe

Not what to ask — what to *observe*:

- Do they open it more than once? (Required for daily-use thesis)
- Which sections do they screenshot or forward? (Tells you which sections have pull)
- Do they ask for more? (Pull request = product-market fit signal)
- Do they offer to pay unprompted? (Strongest possible signal)
- What do they complain is missing? (Roadmap)
- What do they ignore entirely? (Cut candidate)

### 10.3 Decision criteria

- **All three want to keep using it** → ship Product Mode aggressively. Thesis confirmed.
- **Two of three want to keep using it** → ship, but investigate the hold-out deeply before building.
- **One or fewer** → pivot is wrong. The research-tool shape is the real product. Re-evaluate.

**Timeline: 2 weeks total. 3 days build, 10 days observe, 1 day decide.**

This experiment costs almost nothing and de-risks the entire roadmap below.

---

## 11. Implementation Roadmap

Assuming validation succeeds.

### Phase A — Dual-mode foundation (weeks 1–3)

- Add Product / Competitor / ConnectedSource / Signal to data model
- Onboarding branching (exploring vs. have a product)
- Product registration flow (name, competitors, sources)
- Modify Topic to accept optional `product_id` scoping
- Scaffolding for the daily dashboard (static layout, wired to real collection)

### Phase B — Delta engine + dashboard (weeks 4–6)

- Scheduler (launchd desktop / cron server) for daily sweeps
- Delta detection logic (novel codes, velocity, cross-threshold)
- Signal generation and typing
- Live daily dashboard: The Mirror, The Lens, The Field
- Counter-evidence and triangulation carry over from Phase 2

### Phase C — Signals + weekly digest (weeks 7–9)

- The Signals section with severity ranking and action verbs
- Weekly digest email template
- Slack integration for weekly digest
- Signal → hypothesis conversion flow

### Phase D — Connected sources (weeks 10–13)

- OAuth flows for Intercom, Zendesk, Stripe
- Private ticket/event ingestion
- Gated at Growth tier

### Phase E — Pricing, billing, onboarding polish (weeks 14–16)

- Stripe integration
- Seat and product count enforcement
- Upgrade flows
- Onboarding optimization based on design-partner feedback

### Phase F — Topic → Product conversion (week 17)

- "Turn this topic into a monitored product" flow
- Historical evidence carries over
- Competitor auto-suggestion from topic findings

### Phase G — Export, share, virality (weeks 18–20)

- Shareable read-only dashboard links (gated by email capture)
- PDF export for weekly digest
- Notion integration
- Public "state of [category]" reports as SEO lead magnets

Total: ~5 months to a fully-featured Product Mode with billing, integrations, and conversion flows. First paid Product Mode customer realistically in month 3.

---

## 12. What We Are NOT Doing

Keeping this list visible to prevent re-litigation.

| Thing we are not doing | Why |
|---|---|
| Removing Topic Mode | It's load-bearing for the build phase, for adjacent exploration, and as the deep-dive mechanism within Product Mode. Losing it loses the ideation-stage user. |
| Building an agent swarm to "do research for you" | Current synthesis works. Agents are a UX anti-pattern at this price point and increase cost 5–20×. |
| Competing head-on with Crayon / Klue / Kompyte (enterprise CI) | Different buyer (strategy leaders at 500+ person companies), different price ($15–50K/year), different sales motion (field sales). Wrong to target as a solo founder. |
| Building a full PM tool (Productboard / Aha! territory) | Scope creep. Hypothesis cards connect to Linear/Jira via integration; we don't own the product spec workflow. |
| Adding free Product Mode | Destroys unit economics; attracts wrong users; creates support burden. Free tier = Topic Mode only. |
| Supporting "any website" as a private source | Unbounded scope, unreliable scraping, legal risk. Stick to the curated integration list. |
| Offering a $20/mo tier | Anchors wrong buyer. Attracts hobbyists. Better to have no tier there than the wrong tier. |

---

## Appendix A — How this document relates to prior docs

- **`docs/GAP_MAP_METHODOLOGY.md`** — theoretical basis for the research engine. Still accurate; still the foundation for synthesis logic in both modes.
- **`PROJECT_STATUS.md`** — records what Phase 1 + Phase 2 shipped. This document extends that into Phase 3+ with a new modal dimension.
- **`docs/specs/2026-04-20-insight-engine.md`** — the implementation spec for the synthesis engine used by both modes.

## Appendix B — Decision log

- **Decision:** Dual-mode (Topic + Product), not pivot away from Topic Mode.
- **Date:** April 20, 2026
- **Rationale:** Topic Mode is load-bearing across the founder's lifecycle (ideation, expansion, deep-dive). Removing it costs the ideation-stage user entirely. Product Mode adds the daily-use shape without sacrificing the existing product.
- **Revisit trigger:** If Topic Mode usage falls below 15% of total runs six months after Product Mode ships, revisit whether Topic Mode deserves dedicated roadmap investment or becomes a feature within Product Mode.

---

*Fin.*
