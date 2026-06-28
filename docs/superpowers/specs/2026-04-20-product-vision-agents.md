# OpenReply — vision for a research-backed product-design starting point

**Date:** 2026-04-20
**Status:** Vision doc. Not a build plan (yet). Each section can be promoted to its own spec via the brainstorming skill when ready.

> "This app should act as a starting point for anyone who wants to make an app and do market research — UX/UI designer, solopreneur, or enterprise company. Science- and research-backed in everything."

This doc captures the full direction. The mechanics (collect → gap map → solutions → sentiment) are done. What's next is **turning the research into actionable product design** via an agent layer that every audience can use, with every recommendation grounded in evidence the user can click through to.

---

## 1. The three audiences + what each wants

| Audience | Primary question | What they need from OpenReply |
|---|---|---|
| **UX / UI designer** | "Who am I designing for and what do they struggle with?" | User personas · JTBD map · quote-rich journey · pain hierarchy · competitor friction points · accessibility / emotional triggers |
| **Solopreneur / indie hacker** | "Should I build this and is the market real?" | TAM signals · momentum (chronic vs emerging) · competitor gaps · pricing sensitivity · differentiation thesis · launch-ready positioning |
| **Enterprise researcher / strategist** | "What's defensible in front of legal / leadership / investors?" | Cited literature · methodology transparency · confidence tiers · contested claims flagged · exportable evidence-linked brief |

All three share the same underlying corpus (Reddit, HN, arXiv, App Store reviews, PubMed, OpenAlex, Scholar, …). What differs is the **lens** — the synthesis on top — and the **deliverable shape**.

---

## 2. The agent layer — product-design agents grounded in evidence

Today the app's synthesis stops at "here are painpoints + science-backed solutions." The vision: a chain of agents that **continue from there** into concrete product-design deliverables.

```
CORPUS (collected)          AGENTS (synthesize)              DELIVERABLES
──────────────────          ──────────────────              ──────────────
posts · comments            1. Concept Agent     ────▶      Product concept brief
painpoints · workarounds    2. Persona Agent     ────▶      Evidence-linked personas
papers · sentiment          3. Feature Agent     ────▶      Ranked feature list + MoSCoW
evidence tiers              4. UX Flow Agent     ────▶      User flows + wireframes spec
                            5. Design System Agent ──▶      Typography, color, components brief
                            6. Architecture Agent ───▶      Stack, data model, API contract
                            7. Roadmap Agent     ────▶      Prioritized dev plan + KPIs
                            8. Iteration Agent   ────▶      "what changed since last look" diff
```

**Every agent** produces output with inline citations back to specific posts / painpoints / papers / sentiment cards. Click any claim → jump to the evidence. Non-negotiable; this is the "research-backed" promise.

### Agent roster in detail

#### Agent 1 — Concept Agent ("From pain to product")
**Input:** corpus + painpoints (ranked by CHRONIC + sentiment intensity)
**Process:** pick the 3–5 most severe + widespread painpoints; for each, synthesize a 1-sentence product concept, a 1-line target user, 3 competitor weaknesses, a differentiation thesis.
**Output:** "Product concept brief" card with 3–5 candidate concepts, each linking to its source painpoints.
**Science-backing:** cites the evidence tier (chronic / emerging / meta-analysis) + pulls Palace-retrieved papers related to the underlying problem.

#### Agent 2 — Persona Agent ("Who exactly is this for")
**Input:** posts + comments for a chosen concept + JTBD extraction from the Why stage
**Process:** cluster users by writing style, life-stage cues, vocabulary, mentioned contexts. Produce 2–3 personas with: demographic inference (life stage, role), Jobs-To-Be-Done (struggling moment, anxiety, desired outcome), emotional drivers (Plutchik emotions), exact quotes that typify each persona.
**Output:** Evidence-linked persona cards. Hover a quote → post appears; hover an emotion → sentiment-source link.
**Science-backing:** references the JTBD framework (Christensen) + self-efficacy / locus-of-control (Bandura) in the bios where applicable.

#### Agent 3 — Feature Agent ("What the product must do")
**Input:** painpoints + feature wishes + workarounds + solutions (mechanisms) from the research loop
**Process:** for each persona, list features that would address their struggling moments. MoSCoW-prioritize (Must / Should / Could / Won't). Each feature gets: 1-sentence description, mechanism (WHY it works, cites a paper or workaround), effort tier, evidence tier.
**Output:** Feature spec table with sortable columns; export to CSV / JSON / markdown for Notion, Linear, Jira.
**Science-backing:** each feature cites the underlying BCT (Michie taxonomy) or interaction pattern (Nielsen / Shneiderman heuristic) it embodies.

#### Agent 4 — UX Flow Agent ("How the user actually moves")
**Input:** features + personas + JTBD
**Process:** turn each persona's top Must-have features into a user flow: entry point → main task → success state. Flag friction points pulled from the corpus ("users complain X takes too many taps"). Suggest progressive disclosure, empty-state copy, error recovery paths.
**Output:** Markdown flow spec (step list + decision branches) + auto-generated Mermaid diagram + optional text-to-image wireframe prompt.
**Science-backing:** each flow decision cites Shneiderman's 8 golden rules, Fitts's law, or Hick's law where applicable; links to specific painpoint evidence for each friction flag.

#### Agent 5 — Design System Agent ("What it should feel like")
**Input:** concept + persona emotional profile + sentiment analysis
**Process:** derive design tokens: color palette suggestion (warm/cool based on emotional tone), typography pairing, voice and tone guidelines, accessibility floor (WCAG AA minimum), animation rhythm (serious domain = slower). Cite the emotional evidence for each choice.
**Output:** Design token JSON + Figma-importable variable set + a "voice and tone" one-pager with do/don't copy examples drawn from the corpus.
**Science-backing:** cites color psychology research (Elliot & Maier), attention research for motion timing, Nielsen accessibility heuristics.

#### Agent 6 — Architecture Agent ("What to build it with")
**Input:** feature list + expected scale (from TAM signals) + latency requirements (from UX flows)
**Process:** recommend a stack (mobile / web / desktop; native / React-Native / Tauri / web; backend; DB; hosting). Design the data model to support the features. Specify API endpoints. Flag build-vs-buy decisions for every non-core capability.
**Output:** Architecture decision record (ADR) with tradeoffs + ERD + OpenAPI skeleton + 5-item "build vs buy" list.
**Science-backing:** cites current year's Stack Overflow survey for tech popularity / dev availability, Gartner + Forrester for enterprise-grade choices.

#### Agent 7 — Roadmap Agent ("What to ship when")
**Input:** feature list (MoSCoW) + effort tiers + evidence tiers + persona priorities
**Process:** sequence features into releases (v0.1 / v0.5 / v1.0). Every release includes: user value headline, success metric (pulled from what users complain is broken today), KPI target, 1-sentence "done means."
**Output:** Roadmap markdown + CSV export. Can be re-synthesized as research updates.
**Science-backing:** cites the painpoints that justify each release's prioritization; flags "we'd prioritize X higher if we had more evidence of Y."

#### Agent 8 — Iteration Agent ("What changed since last time")
**Input:** prior Concept / Feature / Persona outputs + fresh corpus diff (new posts since last run)
**Process:** compute what changed: new painpoints emerging, fading concerns, shifting sentiment, new competitor mentions. Suggest which prior agent outputs to regenerate.
**Output:** A diff report: "3 new chronic painpoints since last week · emotion profile shifted from anger→anxiety · 2 competitor launches mentioned." Links back to the updated evidence.
**Science-backing:** this is the continuous-research loop — every insight has a timestamp, every claim is invalidatable.

---

## 3. The "science-backed everything" principle

Every agent output MUST satisfy:

1. **Every claim cites evidence** — clickable in the UI. A persona quote links to the post; a feature rationale links to a painpoint card; a UX decision links to a named heuristic; an architecture choice links to a survey datum.
2. **Every claim shows its evidence tier** — anecdote / expert / peer-reviewed / meta-analysis — inline badges, color-coded.
3. **Every agent surfaces uncertainty** — "based on N posts across M sources; would upgrade from medium to high confidence with more data on X."
4. **Nothing is hallucinated** — if no evidence supports a claim, the agent says "no data" rather than making one up. Hard rule.

Operationally: each agent's system prompt bakes in the citation requirement; response parsing validates that every claim block has a `source_id` field; UI refuses to render claims without sources (shows a red "unsupported" badge instead).

---

## 4. Data flow — how agents consume the existing pipeline

```
┌──────────────┐
│   COLLECT    │  15+ sources (Reddit, HN, arXiv, App Store, …)
└──────┬───────┘
       ▼
┌──────────────┐
│ BASELINE     │  painpoints · feature_wishes · products · workarounds
│ EXTRACT      │  (existing gap-mining stage)
└──────┬───────┘
       ▼
┌──────────────┐
│ ENRICHMENT   │  why (emotions · JTBD) · science (papers) · sentiment-by-source
│ LAYER        │  (existing research-loop + sentiment-by-source)
└──────┬───────┘
       ▼
┌──────────────┐
│ PALACE       │  semantic retrieval (ChromaDB + BM25) indexed per topic
│ INDEX        │  so agents can pull targeted evidence for any claim
└──────┬───────┘
       ▼
┌──────────────────────────────────────────────────┐
│  AGENT LAYER (new — this vision)                 │
│                                                   │
│  Concept → Persona → Feature → UX → Design →     │
│  Architecture → Roadmap → Iteration              │
│                                                   │
│  Each agent: 1 LLM call (or a tool-using loop)   │
│  Output: JSON with claim + source_ids + tier     │
│  Cached per topic + version; re-runs on request  │
└──────────────────────────────────────────────────┘
       ▼
┌──────────────┐
│ DELIVERABLE  │  Audience-tailored templates:
│ RENDERER     │  - UX brief (Persona Agent + UX Flow Agent output)
└──────────────┘  - Market one-pager (Concept + Roadmap + TAM signals)
                  - Literature report (Feature + Architecture + citations)
```

---

## 5. Audience-specific wiring

All audiences run the same pipeline; what differs is:

### UX / UI designer view
- Default tab after collect: **Persona** + **UX Flow**
- Starter kits: "Habit tracker UX gaps," "Onboarding fatigue in meditation apps," "Password-less sign-in friction"
- Deliverable template: "Research brief" — personas + journey + painpoint hierarchy + quote bank
- Hides: architecture, stack recommendations (not their job)

### Solopreneur view
- Default tab: **Concept** + **Market Brief** (leveraging existing Trends + Sentiment)
- Starter kits: "Bootstrap SaaS niches 2026," "Indie hacker opportunity radar," "Pre-launch validation"
- Deliverable: "Market one-pager" — concept + TAM signals + competitor gaps + go-to-market hook
- Emphasizes: sentiment-by-source, momentum (CHRONIC/EMERGING), "who hates the current options"

### Enterprise researcher view
- Default tab: **Literature report** + **Evidence** (existing)
- Starter kits: "Compliance tooling pain," "Procurement friction," "Internal-tool satisfaction benchmarks"
- Deliverable: "Strategic brief" — citation-heavy, methodology-transparent, contested-claims flagged
- Emphasizes: evidence tiers, replication status, audit trail

All three see the full agent chain. The role-picker just sets defaults + reorders tabs + curates starter kits.

---

## 6. Continued development mode — the iteration loop

Product research isn't one-shot. Every week:

1. Scheduled `collect --aggressive` pulls fresh data (already supported via `schedule_install` Tauri command + launchd on macOS)
2. Enrichment layer re-runs on new posts
3. **Iteration Agent** generates a diff report: "3 new chronic painpoints · 2 fading · sentiment shifted · 1 new competitor"
4. User reviews the diff → taps "Regenerate Feature spec" / "Update roadmap" / "Refresh personas"
5. Prior outputs get re-synthesized with the new data; diffs highlighted (red/green like a git diff)

This turns OpenReply from "one-time research" into "living research" — the whole reason market research fails is it goes stale 90 days after the report ships.

---

## 7. Phased rollout — what to build first

### Phase 1 — MVP agent layer (2–3 weeks of focused work)
- Agent 1 (Concept) + Agent 3 (Feature) + Agent 7 (Roadmap)
- Role-picker in Welcome (§5 above)
- Three deliverable templates (UX brief / Market one-pager / Strategic brief)
- Evidence citation system (claim → source_id + tier)

### Phase 2 — Design + flow (2 weeks)
- Agent 2 (Persona)
- Agent 4 (UX Flow) + Mermaid rendering
- Agent 5 (Design System) + Figma token export

### Phase 3 — Technical + continuous (2 weeks)
- Agent 6 (Architecture)
- Agent 8 (Iteration) + scheduled-collect wiring to the iteration diff
- Starter kits (curated content, 6–8 per role)

### Phase 4 — Polish
- Team / multiplayer mode (comments on agent outputs)
- Evidence browser as a first-class screen
- Export to Figma / Notion / Linear

---

## 8. Build decisions + open questions

### Decisions already made today
- **Storage:** agent outputs land as graph_nodes kinds (`concept`, `persona`, `feature`, `flow`, `design_token`, `architecture`, `roadmap_item`, `iteration_diff`). Reuses the existing graph infrastructure. Citations = edges back to `post` / `painpoint` / `evidence_paper` nodes.
- **LLM:** agents use existing provider resolution (`get_provider()` with FallbackProvider chain). Cost per topic grows linearly with agent count; estimated 8–12 additional LLM calls per topic for the full chain.
- **Science-backing:** Palace (ChromaDB + BM25) is already indexed on every topic; agents pull evidence for claim-grounding. No new infra.
- **UI:** new "Agents" top-level route with per-agent cards; also surfaces per-tab on topic screen when contextually relevant.

### Open questions
1. **Agent authoring** — do agents live as YAML prompts (like existing `painpoints.yaml`) or in Python with tool-use loops? Leaning YAML for simple agents, Python tool-use for the ones that need retrieval mid-generation (UX Flow, Iteration).
2. **Versioning** — when research updates, old agent outputs go stale. Keep history (every re-run is a new version) or overwrite? Leaning history — users should see "concept v3 diffs from v2 in these 2 bullet points."
3. **Evidence-tier threshold** — should agents REFUSE to emit features backed only by anecdote? Or emit with a red "anecdote-only" flag? Leaning flag — user gets to decide what bar they want.
4. **Role-picker placement** — Welcome wizard step (blocking) or a dismissible banner (opt-in)? Leaning opt-in banner so existing users aren't gated.
5. **Cost ceiling** — the full agent chain is 8–12 LLM calls per topic. Should we cap total spend per topic per month? Leaning yes — show estimated $/topic in the roadmap screen.

---

## 9. What this doc is (and isn't)

**This is:** a vision and roster. Each agent gets its own design spec via brainstorming → writing-plans → subagent-driven-development when we actually build it. This doc captures *what* and *why* — individual specs capture *how*.

**This is not:** committing to build all 8 agents. Phase 1 ships 3 agents + role-picker + templates. Each subsequent phase is a separate go/no-go.

**Related docs:**
- `2026-04-19-research-loop-design.md` — the Problem→Why→Science→Solution pipeline that feeds the agents
- `2026-04-19-research-loop-post-mvp.md` — deferred research-loop enhancements (cognitive biases, BCT taxonomy, etc.) that would upgrade agent outputs
- `2026-04-19-app-ui-guidelines.md` — design language the agent UI must follow
- `2026-04-19-cli-to-desktop-audit.md` — current CLI surface; agents add a new layer on top

---

## 10. Immediate next step (pick one)

### A · Write the Phase-1 spec and build it
Full design for Concept + Feature + Roadmap agents + role-picker + deliverable templates. Run through brainstorming → writing-plans → subagent-driven-development. End state: v1 ready in 2-3 focused days of work. **Recommended.**

### B · Build role-picker first (1 day), defer agents to after
Smallest-possible win. Welcome wizard step + role-scoped defaults. Ship today, use the next session to design the agent layer.

### C · Validate with one real user first
Pick an existing topic, hand-run the full agent chain via the Chat tab + prompts, see if the output is actually useful for a UX designer / solopreneur / enterprise researcher. Only build the automation after qualitative confirmation.

**I'd pick A** — the foundation work (citation system, role-picker, one agent) unlocks the rest and gives you a testable v1. B fragments the effort. C is valuable but you can do it in parallel with A.

Reply with A / B / C (or your own direction) and I'll write the Phase-1 spec.
