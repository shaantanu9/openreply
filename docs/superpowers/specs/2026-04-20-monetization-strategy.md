# Gap Map — monetization + sales strategy

**Date:** 2026-04-20
**Status:** Opinion doc. Not a commitment. Decisions here direct which features get built first.

## TL;DR

The agent-layer vision (`2026-04-20-product-vision-agents.md`) helps monetization IF you ship **deliverables** users can export/share, not just "data to browse." But:

1. Pick **one** audience first (solopreneur recommended — highest volume willing to pay)
2. Ship **one** killer deliverable first (Concept Agent → market one-pager)
3. Validate **willingness to pay** before building the rest of the 8-agent chain
4. Desktop-first is a real distribution headwind — plan a web/cloud companion for year-2

## Why agents help monetization

Today Gap Map gives users **data** (gap maps, sentiment cards, painpoint lists). Data is nice-to-have.

Agents give users **artifacts** (concept briefs, feature specs, roadmaps). Artifacts = concrete value = something to show a client / send to leadership / add to a pitch deck = willingness to pay.

That's the unlock.

## Strategic tradeoffs

### Why solopreneur first
- Largest volume in the 3-audience matrix
- Clearest "should I build this?" hook — the product answers a question they're actively paying for (via paid tools, newsletters, or mentors)
- Lowest-friction sales — 1 person, no procurement cycle, card on file
- The evidence-backing pitch ("not AI slop — actual Reddit quotes + papers") is strongest here since they'll actually read the citations

### Why NOT UX designer first
- Smaller TAM
- Already have tooling (Dovetail, Notably, Condens) — have to displace incumbents
- Evidence-backing matters less — personas and journeys are interpretive, not quantitative

### Why NOT enterprise first (yet)
- Long sales cycles (3-9 months)
- Procurement, legal, SSO, SOC2, DPA
- Different feature set (team, audit trail, on-prem)
- Makes sense after solopreneur product has traction

## Distribution realities

| Channel | Pros | Cons |
|---|---|---|
| Tauri desktop | Privacy-first moat, local-first data, BYOK LLM = users pay API directly | DMG/MSI friction, no in-app auto-update without paid notarization, Apple Gatekeeper, no mobile |
| Web app companion | Zero-install signup, mobile access, SEO/content marketing, Stripe-native billing | Your infra cost, data-privacy becomes a concern, you pay LLM costs unless BYOK |
| Hybrid | Desktop for privacy power-users, web for everyone else, sync via OAuth | 2x codebase maintenance |

**Leaning:** keep desktop as the premium tier ("private mode — your data never leaves your Mac"). Build a web-light companion year 2 for onboarding + sharing.

## Pricing model (v1 recommendation)

```
Free         — 3 topics, watermarked exports, basic painpoints      (onboarding + growth loop)
Pro $19/mo   — unlimited topics, clean PDF/markdown exports,        (solopreneur sweet spot)
                Concept Agent, scheduled re-research, iteration diffs
Team $49/seat/mo, min 3 — shared library, role-assigned deliverables (agencies, small startups)
Enterprise $500+/seat — SSO, on-prem, custom kits, dedicated support (year 2+)
```

**Annual discount:** 2 months free → $190/yr = tempting enough to reduce churn.

**Lifetime deal on Gumroad/AppSumo:** $149 one-time for launch — generates goodwill + testimonials even if LTV is worse.

## Minimum monetizable slice (this doc's actionable part)

Don't build the full 8-agent vision speculatively. Ship this first:

### Must-have to launch paid (v0.1)
1. **Concept Agent** — 3–5 product ideas from painpoints, each citing evidence
2. **Clean export** — markdown + PDF of the concept brief, shareable
3. **Free-tier gate** — 3 topics free, then "upgrade to Pro" banner

### Nice-to-have for paid (v0.2)
4. **Scheduled re-research** — weekly corpus refresh (already half-built via `schedule_install`)
5. **Iteration diff** — what changed since last week
6. **Feature Agent** — MoSCoW-prioritized feature list (second agent in chain)

### Skip until validated
- UX Flow Agent, Design System Agent, Architecture Agent — Phase 2
- Team features, SSO, audit trail — Phase 3
- Role-picker — skip entirely until 3 audiences actually validated

## Pre-launch validation loop (do before writing billing code)

1. Ship v0.1 (Concept Agent + export) — 1-2 days
2. Post the DMG free on IndieHackers, r/SideProject, r/SaaS, Twitter
3. Attach a form: "would you pay $19/mo for this?"
4. If ≥5 of first 50 say yes → build Pro tier + Stripe
5. If <5 → reposition messaging first (not features)

## Skip all of this if

- You're happy with Gap Map as a **personal tool** (research for your own projects only)
- You're willing to run a **paid consulting service** that uses Gap Map as an internal tool
- You're optimizing for **portfolio / OSS contributions** not revenue

Those are all valid outcomes. Monetization only makes sense if you actually want the revenue.

## Immediate next step

Ship the **bare-minimum Concept Agent** (one Python module + CLI command + Tauri command + simple UI + one prompt). No Stripe, no billing, no tier gates — just the feature itself, in the existing app. Post it free. See if anyone cares.

If people engage → build export + paywall next.
If nobody engages → the problem is positioning, not features. Don't double down on features.

Ship the Concept Agent next. This doc's recommendations wait on that signal.
