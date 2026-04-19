# Research loop — post-MVP roadmap

**Date:** 2026-04-19
**Status:** Backlog. Each section becomes its own design spec when promoted.
**Companion:** `2026-04-19-research-loop-design.md` (the MVP this builds on)

## How to use this doc

This is a **structured backlog**, not a plan. Items are grouped by layer and ordered roughly by value-per-effort. When ready to promote one to a real spec:

1. Copy the relevant section into a new file: `docs/superpowers/specs/<date>-<slug>-design.md`.
2. Run that file through `superpowers:brainstorming` to expand into a real design.
3. Update this doc — strike through promoted items and link to the new spec.

Keep MVP focused. Resist the urge to bundle items from here into MVP — every row was deliberately deferred. If something here suddenly feels essential, that's a signal to revisit the MVP scope decision, not silently expand it.

---

## Layer 1: Deeper "Why" extraction

**MVP ships:** emotion (Plutchik 8) + JTBD (struggling moment, anxiety, desired outcome).

**Add later, in this order:**

### 1.1 Cognitive biases (Kahneman / Thinking Fast & Slow taxonomy)
- Detect: loss aversion, anchoring, availability heuristic, sunk-cost, present bias, confirmation bias, status quo bias, framing.
- Why valuable: feeds Lens B (Message Lab) — knowing the bias is what lets you write copy that *uses* it.
- Implementation: extra prompt pass per painpoint, persisted as JSON metadata. ~1 LLM call/painpoint.

### 1.2 Cialdini 7 persuasion triggers
- Detect which triggers users themselves invoke when explaining their preferences/decisions: reciprocity, commitment/consistency, social proof, authority, liking, scarcity, unity.
- Why valuable: Lens B again — the corpus tells you which trigger your specific audience already responds to.
- Implementation: same shape as 1.1.

### 1.3 Demographic / life-stage inference
- From writing style, vocabulary, mentioned context (kids, job title, location markers): infer age band, life stage, professional context.
- Privacy note: never store at user-id level. Aggregate at painpoint level only ("65% of posters mentioning this painpoint show life-stage signals consistent with new parents").
- Why valuable: cohort segmentation across all lenses. "This intervention works for life-stage X but not Y."
- Implementation: requires careful prompt + a confidence gate (drop low-confidence inferences). Material risk of bias if done sloppily — needs a small validation set before rollout.

### 1.4 Regret / shame / urgency markers
- Tag posts where the user expresses regret, shame, or time-pressure language.
- Why valuable: high-intent signals for Lens B and C (people in regret/urgency states are most likely to act).
- Implementation: lightweight classifier or a single-pass LLM tag. Low cost.

### 1.5 Self-efficacy / locus of control
- From Bandura's framework: does the poster believe they can change their situation?
- Why valuable: Lens D (Intervention Designer) — interventions for low-self-efficacy users must look very different from those for high.
- Implementation: same as above.

---

## Layer 2: Stronger Science layer

**MVP ships:** auto-pull top 5 papers per painpoint via existing PubMed/Scholar/OpenAlex fetchers, persist as `evidence_paper` nodes with a coarse tier (anecdote/expert/peer-reviewed/meta-analysis).

**Add later:**

### 2.1 New scientific sources
- **PsyArXiv** — psychology preprints, often years ahead of journal publication. Critical for Lens D.
- **Cochrane Library** — systematic reviews and meta-analyses. The gold standard for "what actually works."
- **Replication databases** (e.g. Curate Science, Many Labs project data) — flag whether a study has been replicated, failed to replicate, or is part of the replication crisis.
- **Effect-size databases** (Metalab, MetaBUS) — for quantitative synthesis.
- **APA PsycNet** — if API access is feasible.

### 2.2 Effect-size parsing
- Extract Cohen's d / odds ratios / NNT from paper abstracts where reported.
- Why valuable: lets the system rank interventions not just by "is there a paper" but by "how big is the effect."
- Implementation: structured LLM extraction with a strict JSON schema. Skip when not reported (most papers).

### 2.3 Replication-status flagging
- For any cited paper, check known-replication databases. Mark as "replicated", "failed to replicate", "untested", "questioned."
- Why valuable: prevents the system from confidently recommending interventions backed only by a 2010 paper that failed to replicate in 2018.
- Implementation: lookup against a curated DB; partial coverage is fine — display "untested" when unknown.

### 2.4 Contradiction detection
- When two papers on the same painpoint reach opposite conclusions, surface that explicitly rather than picking one.
- Why valuable: trust. The system that says "the evidence is mixed" beats the one that confidently picks a side.
- Implementation: cluster paper conclusions, flag conflicts, render as "contested" badge.

### 2.5 Expert consensus signals
- Aggregate across multiple papers + expert reviews to compute a consensus level.
- Why valuable: separates "one promising study" from "well-established mechanism."

---

## Layer 3: Stronger Solution layer

**MVP ships:** 1–3 LLM-synthesized interventions per painpoint, each with mechanism + paper IDs + coarse confidence tier.

**Add later:**

### 3.1 BCT (Behavior Change Technique) taxonomy formalization
- Map each intervention to one or more codes from the Michie 93-item BCT taxonomy.
- Why valuable: makes interventions queryable and comparable. "Show me all interventions that use BCT 1.4 (action planning)."
- Implementation: the LLM tags interventions during synthesis; persist as a `bct_codes` array on the `intervention` node.

### 3.2 Side-effects, contraindications, who-it-doesn't-work-for
- Every clinical intervention has populations it harms or fails for. Capture this from the source papers.
- Why valuable: ethical responsibility — especially for Lens D (health/wellness/edu).
- Implementation: extra synthesis prompt that specifically asks for failure modes.

### 3.3 Cohort-specific recommendations
- Combined with 1.3 (demographic inference), surface different intervention rankings for different cohorts.
- Why valuable: "for new parents struggling with focus, X works; for college students, Y works."
- Implementation: requires demographic inference to be reliable first.

### 3.4 Effort / time-to-effect / cost annotations
- Tag each intervention with: effort to start (low/med/high), time to first effect (immediate/days/weeks/months), monetary cost.
- Why valuable: helps users pick interventions that match their constraints.
- Implementation: LLM tagging during synthesis, validated against paper claims.

### 3.5 Intervention combinations / stacks
- Some interventions reinforce each other (habit stacking) or interfere (cognitive load).
- Surface known combinations from the literature.
- Why valuable: real-world behavior change usually requires multi-pronged approaches.

---

## Layer 4: New non-scientific sources

These add new fetchers (none exist today) and would each be its own ~1-day implementation.

| Source | Why | Feeds which lens |
|---|---|---|
| **Pew Research / GSS** | Authoritative survey data on populations, attitudes, demographics | C (Market), E (Literature) |
| **Glassdoor reviews** | Employee experience for company-related painpoints | C (Market) |
| **Podcast transcripts** (via YouTube auto-captions or RSS + Whisper) | Long-form expert opinion not on Reddit | All lenses, especially D + E |
| **Substack / Medium tags** | Long-form practitioner writing | All lenses |
| **Court / regulatory filings** (CourtListener, SEC EDGAR) | Legal and compliance painpoints | C (Market), B (Message — risk language) |
| **Wayback Machine snapshots** | Historical context — how did this topic look 5 years ago? | C (Market — momentum/decay), E (Literature) |
| **Reddit user-history fetcher** | Track individual posters across time → cohort + journey analysis | All lenses (cohort segmentation) |
| **Expert YouTube channels** (transcript + ranking) | Curated expert opinion | D (Intervention) |
| **News archives** (extending GNews to historical) | Track narrative arcs | C (Market), E (Literature) |
| **App store competitor reviews** (extending appstore/playstore to specific competitors) | Direct competitive intelligence | A (Build), C (Market) |

**Each new source costs:** ~1 fetcher module + tests + adapter + 1 day. Add them lazily — only when a lens demonstrably needs them.

---

## Layer 5: Additional lenses

**MVP ships:** A + D fused as "Build & Intervene" map.

**Add later:**

### 5.1 Lens B — Message Lab
- Pulls from: emotion, biases, persuasion triggers, exact phrases from corpus.
- UI: side-by-side "old copy / new copy" generator. Suggested headlines per painpoint per cohort.
- Output: A/B-testable copy variants with stated trigger.

### 5.2 Lens C — Market Brief
- Pulls from: trend data, sub-growth rates, app store rankings, GitHub stars over time, news mentions.
- UI: dashboard with momentum chart, competitor matrix, TAM signals.
- Output: investor-ready brief.

### 5.3 Lens E — Literature Report
- Pulls from: Science layer + cross-references.
- UI: long-form report with citations, evidence tiers, contested claims flagged.
- Output: PDF or markdown export.

---

## Layer 6: Verification mode (second entry point)

**MVP supports:** discovery only (start with topic → mine corpus).

**Add later:** start with a stated problem ("I want users to build a daily habit") → system pulls relevant subreddits, papers, interventions, and existing community evidence. Inverts the pipeline direction.

Implementation requires:
- Problem parser (LLM-extracts the latent topic + JTBD from a user statement).
- Subreddit discovery seeded by the parsed topic.
- The same downstream pipeline.

Mostly orchestration work, not new extraction.

---

## Layer 7: Cross-topic & longitudinal features

Once multiple topics have run through the full pipeline:

### 7.1 Cross-topic mechanism reuse
- The same mechanism (e.g. "implementation intentions") shows up across many topics. Surface that.
- Why valuable: helps users learn transferable principles, not just topic-specific tricks.

### 7.2 Painpoint trend tracking
- Re-run the pipeline weekly/monthly per topic. Track which painpoints grow, fade, emerge.
- Why valuable: timing signals for builders and investors.

### 7.3 Intervention validation
- Track when a Reddit user reports trying an intervention from the system. Did it work?
- Long-term: a feedback loop that updates intervention confidence based on real outcomes, not just paper claims.
- Privacy: fully aggregate, opt-in only.

---

## Promotion checklist

When promoting an item from this doc to a real spec, verify:

- [ ] The MVP has been used in production for at least 2 weeks (not just "shipped").
- [ ] There's evidence the missing capability is the actual blocker (user feedback, not assumption).
- [ ] The new spec doesn't require modifying the MVP backbone — only extending it.
- [ ] If it does require backbone changes, those go through a fresh brainstorm first.
