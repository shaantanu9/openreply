# Gap Map — Research Methodology & Implementation Guide

> A consulting-grade, academically-anchored pipeline for discovering market gaps from unstructured public data. This document is the technical and methodological reference for Gap Map's research engine.

**Version:** 1.0  
**Last updated:** April 20, 2026  
**Scope:** End-to-end pipeline from topic intake to actionable opportunity brief

---

## Table of Contents

1. [Philosophy & First Principles](#1-philosophy--first-principles)
2. [The Nine-Phase Research Pipeline](#2-the-nine-phase-research-pipeline)
3. [Phase-by-Phase Deep Dive](#3-phase-by-phase-deep-dive)
4. [Data Architecture](#4-data-architecture)
5. [LLM Extraction Layer](#5-llm-extraction-layer)
6. [Scoring & Prioritization](#6-scoring--prioritization)
7. [UI / UX Design Principles](#7-ui--ux-design-principles)
8. [Quality Assurance & Validation](#8-quality-assurance--validation)
9. [Deliverables & Integrations](#9-deliverables--integrations)
10. [Reference Library](#10-reference-library)

---

## 1. Philosophy & First Principles

### 1.1 The core thesis

Most "market research" tools collapse the research process into keyword-matched sentiment dashboards. That produces noise, not insight. Gap Map rejects this approach and instead implements the same sequential rigor used by **McKinsey, BCG, Bain, and academic qualitative researchers**: hypothesis framing → triangulated collection → grounded coding → saturation testing → JTBD synthesis → competitive mapping → opportunity scoring → structured synthesis → falsifiable output.

### 1.2 Three non-negotiable principles

**Principle 1 — Research exists to enable decisions.** Every feature, every extraction, every dashboard widget must move the user closer to a go/no-go/pivot decision. If it doesn't, cut it.

**Principle 2 — Rigor beats volume.** A saturated, triangulated finding from 30 well-analyzed posts outperforms a sentiment score over 30,000 posts. Gap Map optimizes for epistemic quality, not corpus size.

**Principle 3 — Every claim is traceable.** No insight is displayed without a citation trail back to the raw source. This is the Shneiderman "details-on-demand" tier and the foundation of user trust.

### 1.3 What Gap Map is *not*

- Not a social listening tool (Brandwatch, Sprout)
- Not a keyword volume tracker (SEMrush, Ahrefs)
- Not a survey platform (Typeform, SurveyMonkey)
- Not a review aggregator (G2, Capterra)

It is a **qualitative research automation platform** that produces consulting-grade opportunity briefs from public digital exhaust.

---

## 2. The Nine-Phase Research Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GAP MAP PIPELINE                            │
└─────────────────────────────────────────────────────────────────────┘

 PHASE 1: FRAME           → Issue tree + SCQA hypothesis skeleton
 PHASE 2: TRIANGULATE     → Multi-source, multi-method data design
 PHASE 3: CODE            → Open → axial → selective coding
 PHASE 4: SATURATE        → Dual saturation (code + meaning)
 PHASE 5: EXTRACT JOBS    → Functional / emotional / social JTBD
 PHASE 6: MAP LANDSCAPE   → Strategy canvas + ERRC + Blue Ocean
 PHASE 7: SCORE           → Opportunity Score × RICE × 3-Horizons
 PHASE 8: SYNTHESIZE      → Minto pyramid structured output
 PHASE 9: FALSIFY         → Hypothesis cards + build-measure-learn

 Each phase outputs a typed artifact that feeds the next phase.
```

Each phase has: (a) an academic/consulting anchor, (b) a concrete algorithmic implementation, (c) a data artifact, and (d) a UI surface. The rest of this document details each layer.

---

## 3. Phase-by-Phase Deep Dive

### Phase 1 — Problem Framing

**Anchor:** Minto (1987) *The Pyramid Principle*; McKinsey Issue Tree method; SCQA (Situation-Complication-Question-Answer).

**Why it matters.** Unframed research confirms whatever the researcher already believed. A MECE (Mutually Exclusive, Collectively Exhaustive) issue tree forces the system to attach each piece of evidence to a specific branch of a pre-declared hypothesis, which is the only way to detect absence of evidence (itself a critical finding).

**Algorithmic implementation:**

```python
# phase_1_framing.py

from dataclasses import dataclass
from typing import List, Optional
from anthropic import Anthropic

@dataclass
class IssueNode:
    id: str
    question: str
    parent_id: Optional[str]
    children: List[str]
    hypothesis: str              # falsifiable claim
    evidence_required: int       # min N to confirm/reject
    evidence_for: List[str]      # citation IDs
    evidence_against: List[str]  # counter-citation IDs

@dataclass
class SCQA:
    situation: str    # the status quo
    complication: str # what changed / what's broken
    question: str     # the research question
    answer: str       # the current working answer (updated as evidence accrues)

def build_issue_tree(topic: str, client: Anthropic) -> List[IssueNode]:
    """Uses Claude to decompose a topic into a MECE issue tree."""
    prompt = f"""
    You are a McKinsey-trained strategy consultant. Decompose the following
    research topic into a MECE issue tree with 3-5 top-level branches and
    2-4 sub-branches each. Every leaf must be a falsifiable hypothesis.

    Topic: {topic}

    Return JSON matching the IssueNode schema. Root node first.
    """
    # ... LLM call, parse, validate MECE-ness ...
    return nodes
```

**Data artifact:** `issue_tree.json` — stored with the topic; every downstream painpoint / JTBD / competitor must attach to a leaf node.

**UI surface:** A collapsible tree on the topic page, shown *before* any evidence is collected. Users can edit branches (critical — pre-registers the hypothesis and prevents retrofitting).

**Key upgrade over existing pipeline:** Your current system extracts painpoints bottom-up from posts. Add the top-down frame and reconcile. Orphan painpoints (don't attach to any tree branch) are a signal — either the tree is incomplete, or the painpoint is off-topic noise.

---

### Phase 2 — Triangulation Design

**Anchor:** Denzin (1978) *The Research Act*, which formalized four triangulation types.

**The four triangulations:**

| Type | Definition | Gap Map implementation |
|------|------------|------------------------|
| Data | Multiple sources, times, persons | 30+ corpora (Reddit, HN, reviews, RSS, Trends, job postings, GitHub issues, podcasts via Whisper, patents, complaints DBs) |
| Methodological | Multiple methods (qual + quant) | Pair qualitative extraction with quantitative signals (Trends velocity, job posting counts, review volume) |
| Investigator | Multiple analysts | Dual-LLM extraction (Claude + a second model); flag disagreements for human review |
| Theoretical | Multiple theoretical lenses | Run the same corpus through JTBD, Five Forces, and Kano lenses; compare outputs |

**Algorithmic implementation:**

```python
# phase_2_triangulation.py

SOURCE_REGISTRY = {
    "reddit":       {"type": "forum",      "demo_bias": "western_tech_young", "weight": 1.0},
    "hackernews":   {"type": "forum",      "demo_bias": "technical_founder",  "weight": 1.1},
    "trustpilot":   {"type": "review",     "demo_bias": "frustrated_users",   "weight": 1.2},
    "g2":           {"type": "review",     "demo_bias": "b2b_buyers",         "weight": 1.3},
    "appstore":     {"type": "review",     "demo_bias": "consumer_mobile",    "weight": 1.0},
    "rss_news":     {"type": "news",       "demo_bias": "editorial",          "weight": 0.8},
    "google_trends":{"type": "quant",      "demo_bias": "search_behavior",    "weight": 1.0},
    "jobs":         {"type": "signal",     "demo_bias": "employer_demand",    "weight": 1.4},
    "github_issues":{"type": "technical",  "demo_bias": "developer",          "weight": 1.2},
    "podcasts":     {"type": "long_form",  "demo_bias": "niche_expert",       "weight": 1.1},
    "patents":      {"type": "signal",     "demo_bias": "enterprise_rd",      "weight": 1.3},
    "complaints":   {"type": "formal",     "demo_bias": "regulatory",         "weight": 1.5},
    "stackoverflow":{"type": "technical",  "demo_bias": "developer",          "weight": 1.2},
    "linkedin":     {"type": "professional","demo_bias": "b2b_worker",        "weight": 0.9},
    "youtube_cmt":  {"type": "video",      "demo_bias": "general_consumer",   "weight": 0.7},
    # ... extend to 30+
}

def triangulation_score(painpoint_id: str, evidence: List[Evidence]) -> float:
    """
    A painpoint's credibility is a function of source diversity,
    not just evidence count. Returns 0-1.
    """
    unique_sources = {e.source for e in evidence}
    unique_types   = {SOURCE_REGISTRY[e.source]["type"] for e in evidence}
    unique_biases  = {SOURCE_REGISTRY[e.source]["demo_bias"] for e in evidence}

    # Harmonic combination penalizes narrow triangulation
    source_div = len(unique_sources) / 5        # cap at 5
    type_div   = len(unique_types)   / 4        # cap at 4
    bias_div   = len(unique_biases)  / 4        # cap at 4

    return min(1.0, (source_div + type_div + bias_div) / 3)
```

**UI surface:** A "triangulation badge" on every painpoint card: 🟢 Strong (3+ types, 3+ bias profiles), 🟡 Moderate, 🔴 Narrow (warns the user that the signal may be an echo chamber).

---

### Phase 3 — Open → Axial → Selective Coding

**Anchor:** Glaser & Strauss (1967) *The Discovery of Grounded Theory*; Strauss & Corbin (1990) *Basics of Qualitative Research*; Braun & Clarke (2006) *Using Thematic Analysis in Psychology*.

**The three passes** (most LLM extraction pipelines collapse these — don't):

**Pass 1 — Open coding:** Every post/comment gets raw descriptive codes. No structure, no hierarchy. Codes stay close to the informant's language ("in vivo" codes).

```python
# phase_3a_open_coding.py

OPEN_CODING_PROMPT = """
Read the following post. Extract 1-5 short descriptive codes (2-6 words each)
that capture what the author is expressing. Stay close to their actual language.
Do NOT categorize or interpret — just label.

Post:
{post_text}

Return JSON: [{"code": "...", "span": "...", "in_vivo": true/false}, ...]
"""
```

**Pass 2 — Axial coding:** Codes get clustered into categories, and *relationships* between categories are identified using Strauss & Corbin's coding paradigm:

- **Causal conditions** (what causes the phenomenon)
- **Phenomenon** (the central painpoint)
- **Context** (specific conditions)
- **Intervening conditions** (broader factors)
- **Action/interaction strategies** (what users do about it — DIY workarounds!)
- **Consequences** (outcomes of those strategies)

```python
# phase_3b_axial_coding.py

AXIAL_CODING_PROMPT = """
You have a cluster of open codes that appear related. Identify:
1. The central phenomenon (1 sentence)
2. Causal conditions: what triggers it?
3. Context: when/where does it occur?
4. User strategies: DIY workarounds users try
5. Consequences: outcomes of those strategies

Codes:
{codes}

Source snippets:
{snippets}
"""
```

**Pass 3 — Selective coding:** Identify the *core category* that ties axial categories together and tells the story of the topic. This becomes the headline insight.

**Why three passes matter.** Single-pass LLM extraction produces plausible-looking but shallow outputs. Sequential coding forces the model to do genuinely different cognitive work at each stage, and each stage's output is auditable.

**Semantic deduplication** happens between Pass 1 and Pass 2:

```python
# semantic_dedup.py
import numpy as np
from sklearn.cluster import HDBSCAN

def deduplicate_codes(codes: List[str], embeddings: np.ndarray, eps=0.15):
    """
    Collapse semantically identical codes.
    'app keeps crashing' / 'freezes on launch' / 'hangs constantly'
    should become ONE code with N=3.
    """
    clusterer = HDBSCAN(min_cluster_size=2, metric="cosine", cluster_selection_epsilon=eps)
    labels = clusterer.fit_predict(embeddings)
    # Merge codes within each cluster; pick most frequent wording as canonical
    return merge_by_cluster(codes, labels)
```

---

### Phase 4 — Dual Saturation Check

**Anchor:** Guest, Bunce & Johnson (2006) *How Many Interviews Are Enough?*; Hennink, Kaiser & Marconi (2017) *Code Saturation vs. Meaning Saturation*; Malterud, Siersma & Guassora (2016) *Sample Size in Qualitative Studies: Guided by Information Power*.

**The critical insight from Hennink et al.:** Code saturation (no new codes emerge) typically hits around **N=9**. Meaning saturation (no new dimensions, nuances, or edge cases of existing codes emerge) requires **N=16–24**. Your current ≥12 threshold is between these — sufficient for existence, insufficient for understanding.

**Dual saturation implementation:**

```python
# phase_4_saturation.py

@dataclass
class SaturationState:
    n_analyzed: int
    code_curve: List[int]        # new codes per batch
    meaning_curve: List[int]     # new code dimensions per batch
    code_saturated_at: Optional[int]
    meaning_saturated_at: Optional[int]

def check_saturation(state: SaturationState, window: int = 3, threshold: int = 1) -> SaturationState:
    """
    Saturation achieved when the rolling sum of new codes/dimensions
    over the last `window` batches falls below `threshold`.
    """
    if len(state.code_curve) >= window and sum(state.code_curve[-window:]) < threshold:
        state.code_saturated_at = state.code_saturated_at or state.n_analyzed
    if len(state.meaning_curve) >= window and sum(state.meaning_curve[-window:]) < threshold:
        state.meaning_saturated_at = state.meaning_saturated_at or state.n_analyzed
    return state
```

**Malterud's Information Power** adds five modifiers that scale the required N up or down:

1. **Study aim** — narrow aim = smaller N
2. **Sample specificity** — dense, targeted sample = smaller N
3. **Established theory** — prior theoretical framing = smaller N
4. **Quality of dialogue** — richer sources = smaller N
5. **Analysis strategy** — case analysis vs. cross-case = varies

Implement this as a per-topic *target N* that adjusts from the default 12.

**UI surface:** A saturation curve visualization on the topic page — two lines, code and meaning, plotted against N. Users see when saturation was reached; they can request more collection if meaning hasn't saturated.

---

### Phase 5 — Jobs-to-be-Done Extraction

**Anchor:** Christensen, Hall, Dillon & Duncan (2016) *Competing Against Luck*; Ulwick (2005) *What Customers Want*; Ulwick's Outcome-Driven Innovation (ODI).

**The JTBD frame.** People don't buy products; they "hire" them to make progress on a Job. Every Job has three dimensions:

- **Functional:** the objective outcome ("send invoice to client")
- **Emotional:** how they want to feel ("feel in control, professional")
- **Social:** how they want to be perceived ("be seen as a legit business")

**Ulwick's Opportunity Score** — the math every gap-discovery tool should use:

```
Opportunity Score = Importance + max(Importance − Satisfaction, 0)

Scale: both dimensions on 1–10.
Interpretation:
  > 15  = extreme opportunity (high importance, low satisfaction)
  10–15 = clear opportunity
  < 10  = overserved or unimportant
```

**Algorithmic implementation:**

```python
# phase_5_jtbd.py

@dataclass
class Job:
    id: str
    statement: str           # "When [situation], I want to [motivation], so I can [outcome]"
    functional: str
    emotional: str
    social: str
    importance: float        # 1-10, inferred from language intensity + frequency
    satisfaction: float      # 1-10, inferred from sentiment toward current solutions
    opportunity_score: float # Ulwick formula
    supporting_painpoints: List[str]
    citations: List[str]

JTBD_EXTRACTION_PROMPT = """
You are an expert in Jobs-to-be-Done research (Christensen / Ulwick).

From the following clustered painpoint evidence, extract the underlying Job
using the format: "When [situation], I want to [motivation], so I can [outcome]".

Then decompose into:
- Functional dimension
- Emotional dimension (what feeling do they want?)
- Social dimension (how do they want to be perceived?)

Then rate on 1-10:
- Importance: how critical is this job to the person?
  (infer from: language intensity, frequency, time/money spent on workarounds)
- Satisfaction: how well are existing solutions serving it?
  (infer from: sentiment toward current tools, DIY workaround complexity,
   complaints about existing solutions)

Evidence:
{clustered_evidence}

Return strict JSON.
"""

def compute_opportunity_score(importance: float, satisfaction: float) -> float:
    return importance + max(importance - satisfaction, 0)
```

**Willingness-to-pay signals** (feed into Satisfaction — low WTP for existing tools = low satisfaction):

```python
WTP_PATTERNS = [
    r"(?i)I'?d pay (\$|£|€)?\d+",
    r"(?i)would gladly pay",
    r"(?i)take my money",
    r"(?i)why (doesn't|does no one make|isn't there)",
    r"(?i)built (a|my own) (script|tool|hack) because",
    r"(?i)shut up and take",
    r"(?i)willing to pay",
    r"(?i)been looking for this",
    # Negative (overserved / low WTP):
    r"(?i)wouldn'?t pay for this",
    r"(?i)free alternatives work fine",
]
```

**UI surface:** Every painpoint cluster displays its Job statement, the three dimensions, and the Opportunity Score as a prominent card. Sort topics by max Opportunity Score, not by painpoint count.

---

### Phase 6 — Competitive Landscape Mapping

**Anchor:** Porter (1979) *How Competitive Forces Shape Strategy*; Kim & Mauborgne (2005) *Blue Ocean Strategy*.

**The Strategy Canvas** plots existing solutions on 6–10 factors (price, ease of use, speed, integration, support, customization, mobile experience, etc.) and visualizes where competitors cluster. Gaps on the canvas = differentiation opportunities.

**The ERRC Grid** (Eliminate / Reduce / Raise / Create):

| Action | Meaning | Gap Map source |
|--------|---------|----------------|
| Eliminate | Factors the industry takes for granted that should be removed | Common complaints about standard features |
| Reduce | Factors that are overserved | Features users say they don't need |
| Raise | Factors that are underserved | Common DIY workarounds → unmet needs |
| Create | Factors the industry has never offered | Novel painpoints with no existing solution |

**Algorithmic implementation:**

```python
# phase_6_landscape.py

COMPETITOR_DISCOVERY_SOURCES = [
    "g2.com", "capterra.com", "producthunt.com",
    "github.com (alternatives repos)", "reddit (asking for recommendations threads)",
    "alternativeto.net"
]

@dataclass
class Competitor:
    name: str
    url: str
    factors: Dict[str, float]   # factor -> score 1-10
    strengths: List[str]
    weaknesses: List[str]
    pricing: str
    market_position: str        # leader / challenger / niche / emerging

@dataclass
class StrategyCanvas:
    job_id: str
    factors: List[str]          # the 6-10 axes
    competitors: List[Competitor]
    crowded_zones: List[str]    # factors where all competitors cluster
    gap_zones: List[str]        # factors no one serves well
    errc: Dict[str, List[str]]  # eliminate / reduce / raise / create
```

**Solution-gap score** — the most actionable number in the whole system:

```python
def solution_gap_score(job: Job, canvas: StrategyCanvas) -> float:
    """
    High score = large unmet opportunity.
    Combines Ulwick opportunity with market saturation.
    """
    saturation = len(canvas.competitors) / 20  # normalize, cap at 20
    gap_factor = len(canvas.gap_zones) / len(canvas.factors)
    return job.opportunity_score * (1 - saturation) * (1 + gap_factor)
```

**UI surface:** An interactive Strategy Canvas (radar or parallel-coordinate plot) per Job, with competitors overlaid. Hovering on a gap zone shows the supporting painpoint evidence.

---

### Phase 7 — Opportunity Scoring & Prioritization

**Anchor:** Ulwick ODI; Intercom's RICE framework; Baghai, Coley & White (2000) *The Alchemy of Growth* (Three Horizons).

**The composite score:**

```python
# phase_7_scoring.py

def gap_map_score(opportunity: Opportunity) -> float:
    """
    The single ranking number users see.
    Transparent, weighted, auditable.
    """
    # Ulwick Opportunity (0-20, we normalize)
    ulwick = opportunity.job.opportunity_score / 20

    # RICE (reach × impact × confidence / effort) — normalize each 0-1
    rice = (opportunity.reach
            * opportunity.impact
            * opportunity.confidence
            / max(opportunity.effort, 1))

    # Triangulation credibility (from Phase 2)
    triangulation = opportunity.triangulation_score

    # Solution gap (from Phase 6)
    solution_gap = opportunity.solution_gap_score / 20

    # WTP signal density (from Phase 5)
    wtp = min(1.0, opportunity.wtp_mentions / 10)

    # Weighted combination
    return (
        0.30 * ulwick +
        0.20 * rice +
        0.15 * triangulation +
        0.25 * solution_gap +
        0.10 * wtp
    )
```

**Three Horizons classification** gives the opportunity a strategic time frame:

- **Horizon 1** — Core: improvements to what exists; 0–12 months; high confidence, modest upside
- **Horizon 2** — Emerging: new offerings in adjacent spaces; 12–36 months; medium confidence, significant upside
- **Horizon 3** — Transformational: entirely new markets; 36+ months; low confidence, potentially transformative

Map your CHRONIC / EMERGING / FADING tiers onto this:

| Gap Map tier | Three Horizons | Strategic implication |
|--------------|----------------|------------------------|
| Chronic      | H1             | Ship fast; proven demand |
| Emerging     | H2             | Build a thesis; MVP |
| Fading       | (Deprioritize) | Market moving on |
| Novel + weak saturation | H3  | Explore; don't commit |

---

### Phase 8 — Synthesis via the Pyramid

**Anchor:** Minto (1987) *The Pyramid Principle*.

**The rule:** Every deliverable leads with **one governing thought**, supported by **3–5 key arguments**, each supported by **evidence**. Nothing else is allowed on the front page.

**The Gap Map topic brief structure:**

```
┌─────────────────────────────────────────────────────────────┐
│  GOVERNING THOUGHT (1 sentence)                              │
│  "The $X market is underserved in Y; a solution that does    │
│   Z could capture the [segment] opportunity."                │
├─────────────────────────────────────────────────────────────┤
│  KEY ARGUMENT 1    │  KEY ARGUMENT 2    │  KEY ARGUMENT 3    │
│  (1 sentence)      │  (1 sentence)      │  (1 sentence)      │
│  + 3-5 evidence    │  + 3-5 evidence    │  + 3-5 evidence    │
│    citations       │    citations       │    citations       │
└─────────────────────────────────────────────────────────────┘
```

**Algorithmic implementation:**

```python
# phase_8_synthesis.py

SYNTHESIS_PROMPT = """
You are a McKinsey principal producing a client brief.

Given these ranked opportunities, their JTBD analyses, and competitive
landscape, write a one-page synthesis following the Minto Pyramid:

1. GOVERNING THOUGHT (exactly 1 sentence):
   The single most important insight. Action-oriented.

2. THREE KEY ARGUMENTS (1 sentence each):
   Each must be independently defensible and collectively exhaustive.

3. FOR EACH ARGUMENT, 3-5 pieces of EVIDENCE:
   Direct citations with source + snippet + N.

Inputs:
{opportunities}

Constraints:
- No filler. No "it's important to note."
- Every claim cites evidence.
- Total length: 400-600 words.
"""
```

**UI surface:** The topic page leads with the pyramid. Data tables, charts, and evidence trails live below the fold. Minto's rule is brutal: the reader should be able to stop after sentence one and have the answer.

---

### Phase 9 — Falsification & Build-Measure-Learn

**Anchor:** Popper (1959) *The Logic of Scientific Discovery*; Ries (2011) *The Lean Startup*; Blank (2013) *The Four Steps to the Epiphany*.

**The hypothesis card** — every opportunity exports as:

```
┌────────────────────────────────────────────────────────────┐
│  HYPOTHESIS CARD                                            │
├────────────────────────────────────────────────────────────┤
│  We believe:    [segment]                                   │
│  Experiences:   [painpoint]                                 │
│  Because:       [mechanism / root cause]                    │
│  And would:     [behavior: pay / switch / adopt]            │
│  For:           [proposed solution]                         │
├────────────────────────────────────────────────────────────┤
│  WE WILL KNOW WE ARE WRONG IF:                              │
│    • [Falsifier 1 — specific, measurable]                   │
│    • [Falsifier 2]                                          │
│    • [Falsifier 3]                                          │
├────────────────────────────────────────────────────────────┤
│  CHEAPEST TEST:                                             │
│    [Smoke test / landing page / 5 customer interviews]      │
│  TIME BOX:  [2 weeks]                                       │
│  BUDGET:    [$X]                                            │
└────────────────────────────────────────────────────────────┘
```

If there is no falsifier, the hypothesis is unscientific and gets rejected by the system. This is Popper's criterion applied to product discovery.

**Algorithmic implementation:**

```python
# phase_9_falsification.py

@dataclass
class HypothesisCard:
    opportunity_id: str
    segment: str
    painpoint: str
    mechanism: str
    expected_behavior: str
    proposed_solution: str
    falsifiers: List[str]       # MUST be non-empty; MUST be measurable
    cheapest_test: str
    time_box_days: int
    budget_usd: int

def validate_hypothesis(card: HypothesisCard) -> List[str]:
    """Returns list of validation errors; empty list = valid."""
    errors = []
    if not card.falsifiers:
        errors.append("FATAL: No falsifiers. Hypothesis is unscientific.")
    if not all(is_measurable(f) for f in card.falsifiers):
        errors.append("Some falsifiers are not measurable.")
    if card.time_box_days > 60:
        errors.append("Time box too long; violates Lean Startup cycle time.")
    return errors
```

---

## 4. Data Architecture

### 4.1 The graph model

Gap Map is a **property graph**, not a relational dump. Nodes and edges:

```
NODES:
  Topic
  Source        (reddit, g2, trustpilot, ...)
  Post          (raw collected unit)
  Author        (deduplicated across sources where possible)
  OpenCode
  AxialCategory
  Job           (JTBD)
  Painpoint
  Workaround
  Competitor
  Feature
  Opportunity
  Hypothesis

EDGES:
  Post        --POSTED_IN-->     Source
  Post        --AUTHORED_BY-->   Author
  Post        --CITES-->         Post
  Post        --TAGGED_WITH-->   OpenCode
  OpenCode    --CLUSTERED_INTO--> AxialCategory
  AxialCategory --REVEALS-->    Job
  Job         --MANIFESTS_AS--> Painpoint
  Job         --SCORED_AS-->    Opportunity
  Painpoint   --ADDRESSED_BY--> Workaround
  Painpoint   --ADDRESSED_BY--> Competitor
  Competitor  --OFFERS-->       Feature
  Opportunity --GENERATES-->    Hypothesis
```

**Recommended storage:** Neo4j or ArangoDB for the graph; Postgres for structured metadata; a vector store (Qdrant, Weaviate, or pgvector) for embeddings.

### 4.2 Every claim is a citation

```python
@dataclass
class Citation:
    id: str
    post_id: str
    source: str
    url: str
    author_handle: str
    timestamp: datetime
    snippet: str              # the exact quoted text
    context_before: str       # 1-2 sentences before
    context_after: str        # 1-2 sentences after
    extraction_confidence: float
    extractor_model: str      # for reproducibility
    extractor_version: str
    extracted_at: datetime
```

No display element in the UI ever shows a claim without a clickable citation chain.

### 4.3 Reproducibility snapshots

```python
@dataclass
class RunSnapshot:
    run_id: str
    topic_id: str
    timestamp: datetime
    sources_queried: List[str]
    n_posts_collected: int
    dataset_hash: str           # SHA256 of sorted post IDs
    pipeline_version: str
    model_versions: Dict[str, str]  # {"claude": "opus-4.7", "embedding": "..."}
    prompt_versions: Dict[str, str] # {"open_coding": "v2.3", ...}
    outputs_hash: str           # SHA256 of final brief
```

This turns Gap Map outputs into **citable research artifacts**. "According to Gap Map run #47A2, April 2026..." becomes a legitimate sentence.

---

## 5. LLM Extraction Layer

### 5.1 Prompt versioning

Every prompt lives in a versioned registry. Prompts are code.

```
/prompts
  /open_coding
    v1.0.md
    v2.0.md
    v2.3.md         ← current
    CHANGELOG.md
  /axial_coding
    v1.0.md
    v1.4.md         ← current
  /jtbd_extraction
    ...
```

### 5.2 Dual-model adjudication

```python
# adjudication.py

def extract_with_adjudication(text: str, prompt: str) -> ExtractionResult:
    result_a = claude.complete(prompt, text)
    result_b = gpt.complete(prompt, text)

    agreement = semantic_similarity(result_a, result_b)

    if agreement > 0.85:
        return ExtractionResult(value=result_a, confidence=agreement)
    elif agreement > 0.60:
        # Adjudicate with a third model or Claude with CoT
        return adjudicate(result_a, result_b, text)
    else:
        # Flag for human review
        return flag_for_review(result_a, result_b, text)
```

### 5.3 Hallucination guardrails

1. **Citation enforcement** — every extracted claim must quote a span from the source. If the quoted span isn't in the source, reject.
2. **Schema validation** — outputs are validated against a Pydantic schema; malformed JSON triggers a retry.
3. **Entailment check** — a second, smaller model verifies that the extracted claim is entailed by the cited span. NLI models (DeBERTa-v3 fine-tuned on MNLI) are fast and effective.
4. **Calibration sampling** — 5% of outputs are sampled for human review weekly; precision and recall are tracked and published on an internal dashboard.

---

## 6. Scoring & Prioritization

The full composite score was defined in Phase 7. Two additional layers:

### 6.1 Bayesian credible intervals

Replace raw counts with intervals. For a painpoint with N=14 observations in a plausible universe of M=200 relevant posts:

```python
from scipy.stats import beta

def credible_interval(successes: int, total: int, confidence: float = 0.87):
    """Beta-binomial posterior; returns (lower, upper)."""
    alpha, beta_ = successes + 1, total - successes + 1
    lo = beta.ppf((1 - confidence) / 2, alpha, beta_)
    hi = beta.ppf(1 - (1 - confidence) / 2, alpha, beta_)
    return lo, hi
```

Displayed as: **"Chronic (87% CI: 5.2%–11.8% of relevant posts mention this pain)"** instead of **"N=14."**

### 6.2 Counter-evidence surfacing

For every painpoint, find and display the top 3 posts that *disagree* or defend the status quo. This is the single most important credibility feature you can add. It forces users to confront the other side and prevents confirmation bias.

---

## 7. UI / UX Design Principles

### 7.1 Shneiderman's mantra (the foundational law)

**Overview → Zoom & Filter → Details-on-Demand.**

- **Overview:** Dashboard of all topics, ranked by max Opportunity Score
- **Zoom & Filter:** Per-topic gap map with facet filters (source, time, sentiment, triangulation strength)
- **Details-on-Demand:** Click any claim → see citation chain → click citation → see full source context

### 7.2 The Minto topic page

```
┌────────────────────────────────────────────────────────────────┐
│  [Topic name]  [Horizon tag]  [Confidence badge]               │
│                                                                │
│  GOVERNING THOUGHT                                             │
│  ───────────────────                                           │
│  One sentence. Bold. Unambiguous.                              │
│                                                                │
│  ╭───────────────╮  ╭───────────────╮  ╭───────────────╮      │
│  │ ARGUMENT 1    │  │ ARGUMENT 2    │  │ ARGUMENT 3    │      │
│  │ One sentence  │  │ One sentence  │  │ One sentence  │      │
│  │ [3 evidence]  │  │ [3 evidence]  │  │ [3 evidence]  │      │
│  ╰───────────────╯  ╰───────────────╯  ╰───────────────╯      │
│                                                                │
│  ▼ Saturation curve                                            │
│  ▼ Strategy Canvas                                             │
│  ▼ Opportunity table                                           │
│  ▼ Hypothesis cards (exportable)                               │
│  ▼ Full painpoint gap map                                      │
│  ▼ Citations index                                             │
└────────────────────────────────────────────────────────────────┘
```

### 7.3 Explicit epistemic status on every claim

Every card shows:

- **Evidence count** with credible interval
- **Triangulation badge** (🟢🟡🔴)
- **Saturation status** (code ✓, meaning ✓/✗)
- **Extraction confidence** (from dual-model agreement)
- **Counter-evidence** ("3 posts disagree") as a clickable link
- **Freshness** (oldest → newest evidence date range)

Users learn in seconds whether a finding is solid or speculative.

---

## 8. Quality Assurance & Validation

### 8.1 Inter-rater reliability on LLM outputs

Run classical qualitative QA even though your "raters" are models:

- **Cohen's κ** between the two extractor models; report per-prompt κ publicly inside the app
- **Krippendorff's α** when >2 models are used
- Target: κ > 0.75 for acceptable reliability; κ > 0.85 for excellent

### 8.2 Human-in-the-loop sampling

Weekly, sample 100 random extractions across all prompts. A trained researcher grades each on:

- Accuracy (claim matches source)
- Faithfulness (no invented content)
- Completeness (didn't miss key content)
- Coding quality (applies relevant code)

Results become the model's report card, shown in the app's "Methods" page. **This is the feature that will separate you from every competitor.** No one else does this.

### 8.3 Adversarial testing

Seed known-bad posts into collection (bots, astroturf, irrelevant, low-quality) and verify the pipeline correctly downweights or rejects them. Run monthly.

---

## 9. Deliverables & Integrations

Research that doesn't ship doesn't matter. Gap Map must close the loop:

### 9.1 Export formats

- **One-page PDF opportunity brief** (Minto-structured)
- **Hypothesis cards** as PDF + Notion page
- **Strategy canvas** as SVG/PNG
- **Raw evidence bundle** as CSV + JSON for audit
- **Citation bibliography** in BibTeX for academic use

### 9.2 Workflow integrations

- **Linear / Jira** — auto-create tickets from top opportunities
- **Notion** — sync topic briefs as pages
- **Slack / Teams** — "chronic painpoint detected" alerts
- **Figma** — export gap map to FigJam for team synthesis
- **Webhook API** — trigger downstream pipelines on new findings

### 9.3 The killer demo

Click a topic → 10 seconds later you have: governing thought, three arguments, ranked opportunity table, top-5 hypothesis cards, and a shareable Notion doc. *That* is the user-facing promise. Everything else is scaffolding.

---

## 10. Reference Library

### 10.1 Primary academic citations

- Braun, V., & Clarke, V. (2006). Using thematic analysis in psychology. *Qualitative Research in Psychology*, 3(2), 77–101.
- Denzin, N. K. (1978). *The Research Act: A Theoretical Introduction to Sociological Methods* (2nd ed.). McGraw-Hill.
- Glaser, B. G., & Strauss, A. L. (1967). *The Discovery of Grounded Theory*. Aldine.
- Guest, G., Bunce, A., & Johnson, L. (2006). How many interviews are enough? An experiment with data saturation and variability. *Field Methods*, 18(1), 59–82.
- Hennink, M. M., Kaiser, B. N., & Marconi, V. C. (2017). Code saturation versus meaning saturation: How many interviews are enough? *Qualitative Health Research*, 27(4), 591–608.
- Malterud, K., Siersma, V. D., & Guassora, A. D. (2016). Sample size in qualitative interview studies: Guided by information power. *Qualitative Health Research*, 26(13), 1753–1760.
- Popper, K. (1959). *The Logic of Scientific Discovery*. Hutchinson.
- Strauss, A., & Corbin, J. (1990). *Basics of Qualitative Research: Grounded Theory Procedures and Techniques*. SAGE.

### 10.2 Strategy & consulting

- Baghai, M., Coley, S., & White, D. (2000). *The Alchemy of Growth*. Perseus.
- Christensen, C. M., Hall, T., Dillon, K., & Duncan, D. S. (2016). *Competing Against Luck: The Story of Innovation and Customer Choice*. HarperBusiness.
- Kim, W. C., & Mauborgne, R. (2005). *Blue Ocean Strategy*. Harvard Business School Press.
- Minto, B. (1987). *The Pyramid Principle: Logic in Writing and Thinking*. Pitman.
- Porter, M. E. (1979). How competitive forces shape strategy. *Harvard Business Review*, 57(2), 137–145.
- Ulwick, A. W. (2005). *What Customers Want: Using Outcome-Driven Innovation*. McGraw-Hill.

### 10.3 Product & lean

- Blank, S. (2013). *The Four Steps to the Epiphany*. K&S Ranch.
- Ries, E. (2011). *The Lean Startup*. Crown Business.
- Shneiderman, B. (1996). The eyes have it: A task by data type taxonomy for information visualizations. In *Proceedings of IEEE Visual Languages* (pp. 336–343).

### 10.4 Information architecture & QA

- Cohen, J. (1960). A coefficient of agreement for nominal scales. *Educational and Psychological Measurement*, 20(1), 37–46.
- Krippendorff, K. (2004). *Content Analysis: An Introduction to Its Methodology*. SAGE.

---

## Appendix A — End-to-end pipeline pseudocode

```python
# main_pipeline.py

def run_gap_map(topic: str) -> TopicBrief:
    # Phase 1
    issue_tree = build_issue_tree(topic)
    scqa       = build_scqa(topic)

    # Phase 2
    sources    = select_triangulated_sources(topic)
    posts      = collect_from_all(sources, topic)
    posts      = filter_bots_and_spam(posts)
    posts      = weight_by_quality(posts)

    # Phase 3
    open_codes    = open_code_all(posts)
    open_codes    = semantic_deduplicate(open_codes)
    axial_cats    = axial_code(open_codes)
    selective_cat = selective_code(axial_cats)

    # Phase 4
    saturation = check_dual_saturation(open_codes, axial_cats)
    if not saturation.meaning_saturated_at:
        request_more_collection(topic)

    # Phase 5
    jobs = extract_jtbd(axial_cats, posts)
    for job in jobs:
        job.opportunity_score = compute_opportunity_score(
            job.importance, job.satisfaction
        )

    # Phase 6
    for job in jobs:
        canvas = build_strategy_canvas(job)
        errc   = derive_errc(canvas, axial_cats)
        job.solution_gap_score = solution_gap_score(job, canvas)

    # Phase 7
    opportunities = [build_opportunity(job) for job in jobs]
    for opp in opportunities:
        opp.score   = gap_map_score(opp)
        opp.horizon = classify_horizon(opp)
    opportunities.sort(key=lambda o: -o.score)

    # Phase 8
    brief = synthesize_minto(opportunities, issue_tree, scqa)

    # Phase 9
    for opp in opportunities[:10]:
        opp.hypothesis = generate_hypothesis_card(opp)
        errors = validate_hypothesis(opp.hypothesis)
        if errors:
            opp.hypothesis = revise_hypothesis(opp.hypothesis, errors)

    # Snapshot for reproducibility
    snapshot = create_run_snapshot(topic, posts, brief)

    return TopicBrief(
        topic=topic,
        scqa=scqa,
        issue_tree=issue_tree,
        saturation=saturation,
        opportunities=opportunities,
        synthesis=brief,
        snapshot=snapshot,
    )
```

---

## Appendix B — Implementation roadmap (90 days)

**Days 1–14:** Phase 3 upgrade — replace single-pass extraction with open → axial → selective. Add semantic dedup. Biggest quality win per engineering hour.

**Days 15–28:** Phase 4 — dual saturation curves. Surface in UI.

**Days 29–45:** Phase 5 — JTBD extraction + Opportunity Score. Restructures the entire "findings" view.

**Days 46–60:** Phase 6 — competitor collection + Strategy Canvas. New UI surface.

**Days 61–75:** Phase 8 — Minto topic page redesign. Phase 9 — hypothesis cards export.

**Days 76–90:** QA layer — dual-model adjudication, weekly human sampling, κ tracking, counter-evidence display. The credibility moat.

After 90 days you have a tool that is defensibly a *research instrument*, not a listening dashboard. That is the category no one else occupies.

---

*Fin.*
