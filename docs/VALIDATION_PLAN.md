# OpenReply — Dual-Mode Validation Plan

> Before committing 8 months to build Product Mode, we run a concierge-MVP experiment with 3 post-MVP founders. Two weeks, ~3 days of effort, measurable outcome. This doc operationalizes §10 of `DUAL_MODE_PIVOT.md` into an executable playbook.

**Last updated:** 2026-04-20
**Runs after:** Phase 3 (Hypothesis Tracking) + Phase 4 (Monitoring Mode) ship
**Decides:** whether to commit to the cloud-pivot Dual-Mode roadmap or stay on the Topic-Mode-only roadmap

---

## Why we're running this

`DUAL_MODE_PIVOT.md` proposes a major pivot: add always-on Product Mode, reprice at $79–$499/mo, target post-MVP founders. Thesis is plausible but unproven. Committing 8–10 months based on intuition is irresponsible when 2 weeks of observation can de-risk it.

The experiment answers one question: **Do post-MVP founders find continuous product + competitor monitoring valuable enough to return to daily/weekly?**

Secondary questions:
- Which of the 5 dashboard sections (Mirror / Lens / Field / Signals / Hypotheses) do they actually use?
- Which do they ignore?
- Would they pay, and at what tier?
- What's missing that would make it a must-have?

---

## The 3-founder cohort

### 1.1 Selection criteria

Each founder must meet ALL of these to generate usable signal:

- **Shipped product with real users.** Not pre-launch. Not side-project. App Store presence, Play Store presence, active website, or $100+ MRR.
- **Publicly-traceable product.** Has a subreddit presence (even small), App Store reviews, or G2/Product Hunt page. If we can't find 200+ posts/reviews about them across public sources, we can't do the experiment.
- **Identifiable competitive category.** 3+ named competitors we can enumerate from their website or their subreddit.
- **Solo founder or <5 person team.** Target demographic. Founders at 50-person companies have different buying behavior.
- **Active on Twitter / LinkedIn / Indie Hackers.** So they'll actually respond to outreach and commit to 30 min of feedback.

### 1.2 Diversity requirements

To prevent a one-category false positive:

- **Different categories:** e.g., one consumer mobile app, one dev tool, one B2B SaaS.
- **Different stages:** one pre-$1K MRR, one $1–10K MRR, one $10K+ MRR (if findable).
- **Different public source mix:** one with heavy Reddit, one with heavy App Store, one with heavy HN/Product Hunt. So we see if OpenReply works across source distributions.

### 1.3 Where to find them

Priority order:

1. **Direct network — your own contacts.** Warmest intros; highest response rate.
2. **Indie Hackers "I built this" threads.** Filter to products launched 3–12 months ago. Skim for products with identifiable competitive sets.
3. **r/SaaS, r/startups, r/Entrepreneur weekly "show & tell" threads.**
4. **Product Hunt "launched in last 90 days" list.** Filter to solo founders (visible in maker profile).
5. **Twitter #buildinpublic feed — replies to MRR posts in $100–10K range.**

**Avoid:**
- Cold-emailed YC founders (too crowded, low response rate).
- Students building "first app" — not target demographic.
- Products without a real competitive category (too vague to model).

---

## Timeline — 14 days end-to-end

```
Day 0-2   Identify + pitch 6-10 candidate founders (expect 30-50% response)
Day 2-4   Lock 3 founders, schedule 30-min intake calls
Day 4-6   Run intake calls; manually set up Product Mode concierge per founder
Day 6-16  2-week observation window; light-touch check-ins
Day 17    1:1 exit interviews, 45 min each
Day 18    Write up findings + decision memo
```

Total: 3 days of setup + ongoing observation. Ships in parallel with Phase 4 work.

---

## The concierge Product Mode build

This is manual, not automated. The experiment doesn't require shipping Product Mode code. It requires **simulating the experience** well enough that founder behavior is realistic.

For each founder:

### 3.1 Data collection (you do this manually)

1. **Run Topic Mode collect** on 3 queries using existing OpenReply infrastructure:
   - `"<their product name>"` — captures direct mentions
   - `"<their category>"` — captures the broader field
   - `"<competitor1>" OR "<competitor2>"` — captures competitor mentions
2. **Use existing Phase 1+2 synthesis** on each corpus. This is already what OpenReply does.
3. **Also use Phase 3 Hypothesis Tracking** (if shipped) to seed a few cards for them.

### 3.2 Manual dashboard (Notion page or Google Doc)

Build a 1-page living document with 5 sections matching `DUAL_MODE_PIVOT.md §4.2`:

```
─────────────────────────────────────────────────────
GAP MAP — [Product name] Intelligence Dashboard
Week of [date]
─────────────────────────────────────────────────────

📱 THE MIRROR — What's being said about your product
  • 47 new reviews this week (vs. 32 baseline; +47%)
  • Top new complaint: "timer UX" (17 mentions, new cluster)
  • Top new praise: "sound quality" (32 mentions, steady)
  • Sentiment: 71% positive (-4 pts WoW)
  [Link to 3 exemplar quotes]

🔍 THE LENS — What's being said about your competitors
  • Calm: shipped sleep-story redesign; 73 reviews; 61% negative
    about "too many ads"
  • Headspace: no detected changes
  • Insight Timer: price increase backlash, 200+ Reddit comments
    [with link]

🌍 THE FIELD — Your category as a whole
  • Emerging painpoint (new): "privacy of meditation data"
    — crossed chronic threshold this week
  • Fading painpoint: generic "relaxation" positioning

⚡ THE SIGNALS — Top 3 actionable events this week
  1. [Your regression] Timer UX complaints up 3× — ACT
  2. [Competitor vulnerability] Insight Timer pricing backlash
     — POSITION AGAINST
  3. [Unmet need] Offline mode opportunity score jumped 12→17

💡 THE HYPOTHESES — Top 3 testable bets for this week
  H1: Improved session timer would reduce review complaints 30%
      → falsifier: no improvement in 2-week review window
  H2: "Privacy-first meditation" positioning attracts 2% signup lift
      → falsifier: landing page converts <3%
  H3: Offline mode feature justified by 17+ weekly mentions
      → falsifier: <5% of survey respondents want it

─────────────────────────────────────────────────────
Updated every Monday. Questions? Reply to this link.
─────────────────────────────────────────────────────
```

Each section populated from Topic Mode outputs on the 3 queries.

### 3.3 Delivery

Share each founder's dashboard as a Notion page or read-only Google Doc (not a Figma mockup — must feel real). Initial message:

> Subject: Built you a product-intelligence dashboard (no strings)
>
> Hey [name],
>
> I've been working on a research tool and wanted to test a new mode on a real product. I picked yours.
>
> Here's [link] — a dashboard I'll update every Monday for the next 2 weeks showing: what users are saying about [product], what competitors are doing, and 3 signals I think are worth acting on this week.
>
> No strings, no sales. Curious if this feels useful, useless, or something in between. Open to any feedback — and zero obligation to respond.
>
> – [you]

This framing removes pressure; founders either engage or don't, which is itself the signal.

### 3.4 Weekly refresh

Every Monday morning, update each dashboard with the week's new data. Takes ~45 min per founder per week.

---

## What to observe (not what to ask)

Observation > survey. Track behaviors, not opinions.

### 4.1 Primary signals (sorted by value)

| Signal | How to detect | Interpretation |
|---|---|---|
| Opens dashboard within 24h of send | Notion view analytics OR "thanks for this" reply | Curiosity — table stakes |
| Opens dashboard 2+ times in a week | Same, count views | **Daily-use thesis is alive** |
| Opens after Monday without prompting | Same, check timestamps | **Strong engagement signal** |
| Forwards or screenshots any section | Reply mentioning or social share | **Product-market fit signal** |
| Asks for more, unprompted | "Can you also track X?" or "How often does this update?" | **Wants to be a customer** |
| Asks what you charge, unprompted | Direct ask | **Strongest possible signal — conversion-ready** |
| Shares with co-founder / team | "My cofounder wants in" | **Team tier validation** |
| Mentions it in a tweet/post | Social listening | Viral coefficient evidence |

### 4.2 Negative signals (equally valuable)

| Signal | Interpretation |
|---|---|
| Doesn't open at all | Dashboard is invisible OR uninteresting. Check: is the headline grabby enough? |
| Opens once, never again | Content is low-value. Probe in exit interview: which section was weakest? |
| Opens only The Mirror (their product section) | Narcissistic-mode only; "The Field" / "The Lens" may be filler. Re-scope the product. |
| Ignores The Signals | Signals aren't actionable enough. Severity ranking is off. |
| Polite "thanks" with no follow-up | Social nicety, no real engagement. Treat as "no". |

### 4.3 What NOT to do during the 2 weeks

- Don't send multiple nudge emails. ONE delivery + ONE mid-week "any thoughts?" at most.
- Don't talk about pricing (yet).
- Don't pitch features they didn't ask for.
- Don't interpret silence as rejection — wait for exit interview.

---

## The exit interview

Day 17. 45 minutes. Record if they consent.

### 5.1 Opening (2 min)

"Thanks for letting me test this. I want to understand how it landed — both what worked and what didn't. No wrong answers; I'd rather hear 'it was useless' than 'it was great' if the truth is the former."

### 5.2 Behavioral questions (not opinion questions — 20 min)

- "Walk me through the last time you opened it. What were you doing before? What did you click first?"
- "Which section, if any, did you come back to?"
- "Did you talk to anyone about it? Show anyone?"
- "Did anything you saw cause you to take an action? What was the action?"
- "If you didn't come back after the first view — what happened? What would have brought you back?"

### 5.3 Willingness-to-pay probe (10 min)

Do NOT lead with "would you pay $X." Instead:

- "If this were a real product, what would it replace in your workflow?"
- "What does that replacement cost you right now (time, money, tools)?"
- "If I told you this would be a paid product — no number yet — what's your gut: yes I'd consider it, no I wouldn't, or it depends?"
- Only after their anchor: "Numbers like $99/mo for one product monitoring are in the category — does that feel rich, right, or cheap?"

The "replacement cost" question is the single most valuable probe. It reveals their true budget ceiling.

### 5.4 Missing-features probe (10 min)

- "If I said 'we'll only build one more thing before launch' — what would it be?"
- "What's the one section we should DROP?"
- "If you had to describe what this does to your cofounder in one sentence, what would you say?"

Their 1-sentence description is your tagline.

### 5.5 Close (3 min)

"If we build this out, do you want to be one of the first users? Paid or free — would need to decide — but just the signal of interest."

---

## Decision matrix

Applied after all 3 exit interviews.

| # of founders with ≥2 of the "strong" signals (forwarded / asked for more / asked price / shared with team / would pay) | Decision |
|---|---|
| 3 / 3 | **SHIP DUAL-MODE PIVOT aggressively.** Thesis confirmed, cloud infra investment justified. |
| 2 / 3 | **Ship — but investigate the hold-out deeply.** If they rejected for a scope reason, cut that scope. If for a category fit reason, target narrower. |
| 1 / 3 | **Do NOT ship Dual-Mode as currently scoped.** Possible narrower thesis (maybe only one category works). Run 3 MORE founders in that narrower cohort before any commitment. |
| 0 / 3 | **Reject the pivot.** Stay on the Topic-Mode-only ROADMAP. Thesis is wrong at this scope. Revisit in 6 months with a different framing. |

### 6.1 What "strong signal" means

- Opened the dashboard ≥3 times over 2 weeks (without nudge)
- AND at least one of:
  - Replied with specific feedback referencing a section
  - Asked to add something or change something
  - Forwarded / shared / mentioned it somewhere
  - Asked about pricing / availability
  - Said "when are you launching" in some form

Polite "thanks, looks cool" does NOT count. You want traction signals, not validation-theater signals.

### 6.2 Ambiguous cases

If a founder was enthusiastic but didn't open the dashboard (because life/ops got in the way) — that's evidence the tool isn't **pull-enough** to compete with their inbox. That's a negative signal even if the verbal feedback was positive.

---

## Cost + resource budget

| Item | Cost |
|---|---|
| 3 Topic Mode collects × 3 queries × 3 founders = 9 runs | ~$15 in Claude API (at current rates, ~400K tokens/run) |
| 2 weekly refreshes × 3 founders = 6 weekly refresh runs | ~$30 in Claude API |
| Manual time — setup | 6 hours (2 hours per founder) |
| Manual time — weekly refresh | 2.5 hours (~45 min × 3) × 2 weeks = 5 hours |
| Manual time — intake + exit interviews | 4.5 hours (30 min intake + 45 min exit × 3) |
| Total cost | **~$45 + ~16 hours over 2 weeks** |

Tiny compared to the 8 months of dev time it de-risks.

---

## What we do AFTER the decision

### 7.1 If thesis holds (ship dual-mode)

1. Write up findings memo to yourself + anyone else involved.
2. Commit to the `DUAL_MODE_PIVOT.md §11` roadmap (5+ months).
3. **Immediate architectural decision:** cloud vs. desktop vs. hybrid. Don't start coding until this is written down.
4. First build: Product + Competitor data model additions, product-registration flow, concierge-style dashboard (rendered from synthesize output). Months 1-2.
5. Validation cohort founders get grandfathered into the early access program. They become your first design partners.

### 7.2 If thesis fails (stay on Topic-Mode ROADMAP)

1. Write up findings memo documenting WHY it failed. (Wrong founder type? Dashboard design? Missing sections?)
2. Continue on ROADMAP Phases 5–11: cross-topic search, onboarding, exports, chat sidebar, competitor matrix, palace linking, polish.
3. Keep DUAL_MODE_PIVOT.md as a historical decision doc. Revisit the thesis in 6 months with a different cohort or different framing if Topic Mode saturates.

### 7.3 Ambiguous result (1–2 of 3)

1. Do NOT commit to either path yet.
2. Run a second 3-founder cohort in a narrower target (e.g., only consumer mobile app founders, or only dev-tool makers) based on what worked in cohort 1.
3. Only commit to Dual-Mode after 2 consecutive cohorts with ≥2/3 positive.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| All 3 founders are the wrong type (not post-MVP enough) | Selection criteria in §1.1 are strict for a reason. Don't relax them. Better to delay than run with wrong cohort. |
| Manual dashboards look janky vs. real product | Use Notion with a consistent visual template. It doesn't need to be pretty; it needs to be credible. |
| Founders flake after agreeing | Expect 1 of 3 to ghost. Have a 4th on standby. |
| Observation period too short (2 weeks) | If after week 1 everyone is engaging but week 2 would add clarity, extend by 1 week. Don't extend beyond 3. |
| You become emotionally attached to a positive outcome | Write the decision memo BEFORE running exit interviews — commit to the criteria in §6 in writing. |
| Validation succeeds but cloud infra takes longer than expected | Build a realistic 8-10 month timeline, not the 5-month one in DUAL_MODE_PIVOT.md. |

---

## Appendix A — Founder outreach templates

### A.1 Initial DM / email (selected founder)

Subject: A free weekly product-intelligence report for [product name]

Hey [name],

I'm building a research tool and want to test a new monitoring feature on a real product. Picked yours.

For the next 2 weeks, I'll maintain a weekly dashboard showing:
- What users are saying about [product] (reviews, Reddit, etc.)
- What each of your main competitors is up to
- 3 signals I think are worth acting on this week

No strings, completely free, happy to kill it if unhelpful.

If you're in: reply with "yes" and I'll send the first dashboard within 48 hours.

– [your name]

### A.2 Follow-up after dashboard delivery (day 3 if no response)

Hey [name], did that dashboard land? No pressure, just making sure it didn't go to spam. If you took a look and it wasn't for you, I'd love a one-line "not for me because…" — helps me more than polite silence.

### A.3 Exit interview invite (day 15)

Hey [name], 2 weeks are up — thanks for letting me test on your product. Could I get 45 min of your time for a proper debrief? I'd love to hear what worked and what didn't. 3 time slots: [slot 1] / [slot 2] / [slot 3]. Zoom or phone.

---

## Appendix B — Data to collect per founder

Keep a sheet:

| Field | Founder 1 | Founder 2 | Founder 3 |
|---|---|---|---|
| Product name + category | | | |
| Stage (MRR / users) | | | |
| Cohort bucket | | | |
| Outreach date + channel | | | |
| Dashboard delivery date | | | |
| View count (week 1) | | | |
| View count (week 2) | | | |
| Replies / questions count | | | |
| Forwarded/shared? | | | |
| Asked about pricing? | | | |
| "Strong signal" count (see §6.1) | | | |
| Verdict | ship / investigate / reject | | |

Single source of truth. Update daily.

---

*Fin. Good experiments make the right decision cheap. This one is cheap by design.*
