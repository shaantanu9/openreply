# Research loop — Problem → Why → Science → Solution

**Date:** 2026-04-19
**Status:** Design approved. MVP scope locked. Implementation plan pending (next: invoke `superpowers:writing-plans`).
**Companion:** `2026-04-19-research-loop-post-mvp.md` (deferred work, in same folder)

## Why this exists

Today the app stops at "here are the painpoints." A user gets a list of problems extracted from Reddit, but the system never tells them *why* people feel that way, *what science says about it*, or *what evidence-backed solutions exist*. That last-mile gap is the difference between a research tool and a decision tool.

The user's framing: *"science and research-backed solutions knowing the problem."* The corpus we already collect is rich enough to answer all five common decision shapes (build, message, market, intervene, synthesize) **if** we layer two new things on top: deeper extraction and grounded solution synthesis. We don't need a new app per audience — we need shared extraction + lens-shaped reports.

## The core loop

Every topic flows through four stages:

```
Problem  →  Why  →  Science  →  Solution
```

| Stage | Output | Source |
|---|---|---|
| **Problem** | painpoints, complaints, workarounds (already exists) | Reddit + forums + app reviews |
| **Why** | emotion vector, JTBD (struggling moment / anxiety / desired outcome), and — post-MVP — cognitive biases, persuasion triggers, demographic context | LLM extraction over the same corpus |
| **Science** | papers, effect sizes, replication status, expert consensus | PubMed + Scholar + OpenAlex (existing fetchers, new lookup logic) |
| **Solution** | 1–3 evidence-backed interventions per painpoint, each with mechanism + supporting paper IDs + confidence tier | LLM synthesis grounded in Science stage output |

### Two entry points (post-MVP supports both)

- **Discovery mode (MVP)** — start with a topic ("ADHD productivity"), the pipeline mines problems from Reddit and works rightward to solutions.
- **Verification mode (post-MVP)** — start with a stated problem ("how do I help users build a daily habit?"), the pipeline pulls community evidence + science + intervention library.

### The lens layer

Five lenses sit on top of the same enriched corpus, each a different synthesis prompt + UI tab. They re-purpose the same data for different decisions:

| Lens | Audience | Question answered |
|---|---|---|
| **A. Build Map** | Indie hackers, PMs | What should I build? Evidence-ranked. |
| **B. Message Lab** | Marketers, copywriters | What hooks/triggers/exact phrases land? |
| **C. Market Brief** | Investors, founders | Is this niche real, growing, underserved? |
| **D. Intervention Designer** | Health/edu/wellness builders | What science-backed mechanism actually changes behavior? |
| **E. Literature Report** | Researchers, consultants | Defensible synthesis with citations + evidence tiers. |

**MVP ships A + D fused** as one "Build & Intervene" map — they share the most signal and best showcase the full loop. B, C, E land post-MVP.

## MVP scope (v1)

Smallest slice that proves the loop end-to-end and earns the right to add lenses B/C/E.

| Layer | MVP | Deferred (see post-mvp doc) |
|---|---|---|
| Pipeline stages | All 4 (Problem → Why → Science → Solution) | — |
| Why extraction | Emotion (Plutchik 8) + JTBD (struggling moment, anxiety, desired outcome) | Cognitive biases (Kahneman list), Cialdini 7 triggers, demographics, life-stage |
| Science layer | Auto-pull via existing PubMed + Scholar + OpenAlex fetchers, keyed by painpoint label | PsyArXiv, Cochrane, replication DBs, effect-size parsing, contradiction detection |
| Solution layer | LLM synthesis: 1–3 interventions per painpoint, each with mechanism + paper IDs + confidence tier (anecdote / expert / peer-reviewed / meta-analysis — matches the `evidence_paper.tier` enum below) | BCT taxonomy formalization, side-effects, contraindications, cohort-specific recommendations |
| New sources | **Zero** — reuse the 25 existing fetchers | 10 candidates: PsyArXiv, Pew/GSS surveys, Glassdoor, podcast transcripts, Substack, court/regulatory filings, Wayback historical, Reddit user-history cohorts, replication databases, expert YouTube |
| Lenses | One: "Build & Intervene" map (fused A + D) | B (Message Lab), C (Market Brief), E (Literature Report) |
| Entry mode | Discovery only (topic → pipeline) | Verification mode (stated problem → pipeline) |
| Graph additions | Node kinds: `evidence_paper`, `intervention`, `mechanism`. Edges: `explained_by`, `addressed_by`, `supported_by` | Cross-topic linking, contradiction edges |
| UI | New "Solutions" tab on the topic screen, one card per painpoint showing the full loop | Per-lens UI tabs, comparison views, export-to-report |

## Data model

New node kinds added to `graph_nodes` (existing schema in `src/reddit_research/graph/schema.py`):

| kind | label | metadata fields |
|---|---|---|
| `mechanism` | Free-text "why this works" | `theory_basis` (e.g. "implementation intentions"), `confidence` |
| `intervention` | Short imperative ("Use a 2-minute rule for tasks") | `mechanism_id`, `evidence_tier`, `effort` (low/med/high), `supporting_paper_ids` |
| `evidence_paper` | Paper title | `source` (pubmed/scholar/openalex), `year`, `authors`, `abstract_excerpt`, `tier` (anecdote/expert/peer-reviewed/meta-analysis) |

New edge kinds in `graph_edges`:

- `painpoint --explained_by--> mechanism`
- `mechanism --addressed_by--> intervention`
- `intervention --supported_by--> evidence_paper`
- `painpoint --has_emotion--> emotion_tag` (or store on painpoint metadata as JSON — decide in plan)
- `painpoint --has_jtbd--> jtbd_tag` (same decision)

**Open question for the plan:** emotion + JTBD as nodes or as JSON metadata on the painpoint node? Trade-off is queryability (nodes win) vs. graph bloat (metadata wins). Default to metadata for MVP, promote to nodes if a lens needs to query across them.

## Pipeline architecture

The four stages run as separate, cacheable passes — not one mega-prompt — so cost is predictable and partial failures don't lose all work.

```
collect (existing) ─► extract_problems (existing) ─► extract_why (NEW)
                                                      ↓
                                build_graph (existing, extended)
                                                      ↓
                                  fetch_science (NEW) ─► synthesize_solutions (NEW)
                                                      ↓
                                            render Solutions tab (NEW)
```

Each new stage is its own Python module under `src/reddit_research/research/` (matches existing structure: `gaps.py`, `discover.py`, etc.) and exposes a CLI subcommand so users can re-run a single stage.

### Per-stage details

**`extract_why`** — One LLM call per painpoint. Input: painpoint label + 3–5 evidence post excerpts already linked to it. Output JSON: `{emotions: [...], jtbd: {struggling_moment, anxiety, desired_outcome}}`. Persist as metadata on the painpoint node.

**`fetch_science`** — For each painpoint, build a search query from `painpoint.label + jtbd.desired_outcome`. Query existing PubMed / Scholar / OpenAlex fetchers. Dedupe by DOI/title. Top 5 papers per painpoint persisted as `evidence_paper` nodes. No LLM here — pure fetch + dedupe.

**`synthesize_solutions`** — One LLM call per painpoint. Input: painpoint + why + top 5 papers' titles+abstracts. Output JSON: 1–3 interventions, each `{label, mechanism, supporting_paper_ids: [...], confidence_tier, effort}`. Persist as `intervention` + `mechanism` nodes with edges.

## UI: the "Solutions" tab

New tab on the topic screen (`app-tauri/src/screens/topic.js`), to the right of existing tabs. One card per painpoint, collapsed by default. Expanding shows:

```
┌─ Painpoint: "Can't focus more than 10 minutes" ──────┐
│ 😰 Frustration · Shame   |   JTBD: deep work        │
│                                                      │
│ ▸ Why people feel this way                          │
│   Struggling moment: trying to start hard tasks     │
│   Anxiety: "I'll never finish on time"              │
│   Desired outcome: 2-hour focused block             │
│                                                      │
│ ▸ What science says (5 papers)                      │
│   • Pomodoro effectiveness — peer-reviewed [link]   │
│   • Implementation intentions — meta-analysis [link]│
│   ...                                                │
│                                                      │
│ ▸ Try this (3 interventions)                        │
│   1. Use 2-minute rule [peer-reviewed · low effort] │
│   2. ...                                             │
└──────────────────────────────────────────────────────┘
```

The fused A+D lens means each card answers both *"what should I build for this?"* (intervention as feature spec) and *"how should the feature actually work to change behavior?"* (mechanism + evidence).

## Cost & latency estimates

For a typical topic (current `extract_painpoints` returns up to ~15–20 painpoints from 50 top posts):

| Stage | LLM calls | External calls | Notes |
|---|---|---|---|
| `extract_why` | 20 | 0 | One per painpoint, ~500 tokens each |
| `fetch_science` | 0 | 60 (3 sources × 20 painpoints) | Parallelizable, cached by query |
| `synthesize_solutions` | 20 | 0 | One per painpoint, ~1500 tokens each (paper abstracts in context) |
| **Total per topic** | **40 LLM calls** | **60 fetches** | Roughly 2× current `enrich_graph` cost |

Re-running a stage skips painpoints that already have the relevant nodes — same incremental pattern as today's `enrich_graph`.

## File-level changes (sketch — full breakdown lives in the plan)

**New files:**
- `src/reddit_research/research/why.py` — `extract_why()` per painpoint
- `src/reddit_research/research/science.py` — `fetch_science_for_painpoint()` (uses existing fetchers)
- `src/reddit_research/research/solutions.py` — `synthesize_solutions()` per painpoint
- `src/reddit_research/cli/solutions_commands.py` — CLI subcommands `extract-why`, `fetch-science`, `synthesize-solutions`, `solutions-pipeline` (runs all three)
- `app-tauri/src/screens/solutions.js` — the new tab content

**Modified files:**
- `src/reddit_research/graph/schema.py` — register new node + edge kinds
- `src/reddit_research/graph/semantic.py` — extend `enrich_graph` to optionally chain into the new stages
- `src/reddit_research/cli/main.py` — wire CLI subcommands
- `app-tauri/src-tauri/src/commands.rs` — Tauri command `run_solutions_pipeline`
- `app-tauri/src/api.js` — JS wrapper for the new command
- `app-tauri/src/screens/topic.js` — mount the Solutions tab

**Prompts (new YAML files in `src/reddit_research/research/prompts/`):**
- `why.yaml` — emotion + JTBD extraction
- `solutions.yaml` — intervention synthesis grounded in papers

## Success criteria for MVP

- Run pipeline on a fresh topic. Solutions tab populates within 3 minutes.
- Each painpoint card shows ≥1 intervention with ≥1 linked paper.
- Confidence tier visible (peer-reviewed > expert > anecdote) — user can tell at a glance which solutions to trust.
- Re-running any single stage works without re-doing earlier stages.
- Zero crashes when an LLM key is missing — pipeline reports skipped stages cleanly (same pattern as `enrich_graph` today).

## What this design intentionally does NOT do

- No new source fetchers (defer to keep diff small).
- No automatic effect-size parsing (papers are linked, not numerically synthesized).
- No replication-status checking (any peer-reviewed paper counts as "peer-reviewed" tier in MVP).
- No verification-mode entry (only discovery from a topic).
- No per-lens UI tabs (the fused A+D card serves the MVP audience).
- No BCT taxonomy lookup (mechanisms are free-text in MVP).
- No cohort-specific recommendations (one intervention list per painpoint, not segmented).

All of these are tracked in `2026-04-19-research-loop-post-mvp.md`.
