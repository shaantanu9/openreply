# Gap Map — Product-Discovery Framework Coverage (Gap Map applied to itself)

> Goal: make Gap Map a *complete* pre-build product-discovery tool — everything a
> PM / product designer does to find a market gap and judge it **before** writing
> code. This doc learns the canonical frameworks, maps Gap Map's coverage against
> them, and lists the gaps to close. **Updated:** 2026-06-06.

Sources: [Product School — opportunity assessment](https://productschool.com/blog/product-fundamentals/opportunity-assessment) ·
[Product School — product discovery](https://productschool.com/blog/product-fundamentals/what-is-product-discovery) ·
[Creately — 35 PM frameworks](https://creately.com/guides/product-management-frameworks/) ·
[Teresa Torres — Continuous Discovery](https://www.shortform.com/blog/product-discovery-process/) ·
[Productfolio — 21 frameworks](https://productfolio.com/21-product-management-frameworks/).

---

## The pre-build product-discovery toolkit (what PMs actually use)

A PM/founder moves through six stages before committing to build. Gap Map's job
is to support every stage with evidence pulled from the corpus + market.

| # | Stage | Canonical frameworks | Gap Map today |
|---|---|---|---|
| 1 | **Understand the customer** | JTBD · Empathy map · Continuous Discovery (weekly interviews) · The Mom Test · personas | painpoints ✅ · personas ✅ · Empathy/JTBD 🟡 · Interviews 🟡 |
| 2 | **Map the problem space** | Opportunity-Solution Tree · root-cause (5-whys) · intent ladder · gap map (pain↔product↔evidence) | gap map ✅ · OST 🟡 · Why 🟡 · Intents 🟡 |
| 3 | **Assess the market** | **TAM/SAM/SOM market sizing** · market value/cap · demand trend · competitive analysis (direct/indirect) · Porter's Five Forces · SWOT · Blue Ocean | competitors ✅ · Trends ✅ · **TAM/SAM/SOM ❌** · **Porter ❌** · **SWOT ❌** · Blue-Ocean (partial in product.py) |
| 4 | **Frame the business** | Lean Canvas · Business Model Canvas · Value Proposition Canvas · North Star metric | **all ❌** |
| 5 | **Prioritize** | RICE/ICE · Kano · MoSCoW · opportunity scoring | RICE+Kano+MoSCoW ✅ (Prioritize tab) |
| 6 | **Validate before building** | PMF (Sean Ellis) · Van Westendorp pricing · assumption/hypothesis testing · concierge/MVP tests · PERT estimate + LTV/CAC | PMF 🟡 · Pricing 🟡 · Hypothesis/Bets 🟡/✅ · PERT+LTV/CAC ✅ · PRD 🟡 |

---

## Where Gap Map is already strong
- **Evidence-first gap discovery** (stage 1–2) — the core: 40 sources → painpoints / feature-wishes / complaints → a pain↔product↔evidence graph, grounded in real quotes. This is the hard part most tools skip.
- **Competitive + demand** (stage 3, partial) — `competitors.py`, global-competitors, compare, Google Trends.
- **Estimation** (stage 6) — `estimate.js`: three-point PERT, McConnell overhead, LTV/CAC (Skok), tiered pricing.
- **Prioritization** (stage 5) — RICE/Kano/MoSCoW (new Prioritize tab).

## The framework GAPS (what to build to be "complete")

### P0 — Market assessment (you named this: "market value, market cap, market gaps")
1. **TAM / SAM / SOM market sizing** ❌ — top-down (industry $ × segment) + bottom-up (reachable users × price). The headline missing piece for "is this worth pursuing."
2. **Market value / cap signal** ❌ — pull comparable-company / category revenue signal (e.g., from the corpus + news) to anchor the sizing.

### P1 — Strategy frameworks
3. **Porter's Five Forces** ❌ — rivalry, new entrants, substitutes, buyer/supplier power → structural attractiveness of the market.
4. **SWOT** ❌ — synthesized from the gap map (strengths/opportunities from gaps; threats from competitors).
5. **Blue Ocean / value-innovation grid** 🟡 — partial in `product.py`; needs a surfaced view.

### P1 — Business framing
6. **Lean Canvas** ❌ — 9 blocks (problem, solution, UVP, channels, segments, cost, revenue, metrics, unfair advantage), auto-seeded from the gap map + painpoints.
7. **Value Proposition Canvas** ❌ — customer jobs/pains/gains ↔ product pain-relievers/gain-creators (ties directly to the JTBD/Empathy work).
8. **North Star metric** ❌ — propose the one metric for the chosen opportunity.

### In-flight (already 🟡, being completed)
- OST · Empathy/JTBD · Interviews · Why · Intents · PMF · Pricing · PRD · Hypothesis tracker · Iterate — finishing now (the partial-screens workflow).

---

## Build roadmap (to make Gap Map a complete pre-build solution)

| Phase | Build | Closes |
|---|---|---|
| **Now** | Finish the 🟡 discovery/validation screens | stages 1,2,6 partials |
| **E — Market** | TAM/SAM/SOM market-sizing module + screen (top-down + bottom-up, evidence-anchored) | P0 market gap |
| **F — Strategy** | Porter's Five Forces + SWOT (auto-synthesized from gap map + competitors) | P1 strategy |
| **G — Business** | Lean Canvas + Value Proposition Canvas (seeded from painpoints/JTBD) + North Star | P1 framing |
| **Cross** | MCP tools for every module → Claude Code drives the whole funnel headlessly | automation |

**End state:** open a topic → collect → find gaps → understand users (JTBD/empathy/interviews) → size the market (TAM/SAM/SOM) → assess strategy (Porter/SWOT/Blue-Ocean) → frame the business (Lean/Value-Prop/North-Star) → prioritize (RICE/Kano/MoSCoW) → validate (PMF/pricing/hypotheses) → spec (PRD) → estimate (PERT/LTV-CAC). Every step evidence-backed. That's the complete PM pre-build toolkit in one app.

> Meta: this doc *is* Gap Map applied to Gap Map — the gap analysis that found
> what's missing in our own product-discovery coverage.
