# Insight Engine — turn OpenReply into a research-to-decision tool

**Status:** in progress (Phase 1 implementation starting 2026-04-20)
**Owner:** Shantanu
**LLM backend:** Claude Opus 4.7 (1M context) as primary; Ollama as optional local fallback.

---

## Why

OpenReply today extracts painpoints / features / workarounds / products from a
multi-source corpus and shows them as ranked lists. That is **exploration**,
not **decision**. Users leave with "here's what people complain about,"
not "here's what I should build, why, and where the opportunity is."

With Claude as the default LLM (1M context, fast, reliable, tool-use-capable),
the compute bottleneck that previously forced us into 4 isolated extractors
on 50-post corpora is gone. We can now operate on the **full corpus at once**
and produce grounded, cited, decision-grade output.

The gap between what OpenReply produces and what a product strategist or
early-stage founder actually needs is the opportunity.

---

## Problem statement

Current output per topic:

```
Painpoints: [45 bullets]
Feature wishes: [23 bullets]
Products: [18 bullets]
DIY workarounds: [12 bullets]
```

What users need instead:

```
OPPORTUNITY MAP

1. Sleep-onset anxiety loop (score: 8.7/10, greenfield)
   - Pain: high severity, 142 posts, 4 sources
   - Competitor coverage: thin — Calm/Headspace treat symptoms, don't address root
   - Research backing: 3 arXiv papers on physiological arousal cycles (cite list)
   - MVP spec: heart-rate-entrained audio that adapts to user's own HRV
   - Differentiator: real-time biofeedback (others use static playlists)
   - Unit economics: users pay $12/mo for Calm solving less of the problem
   - Evidence: "I've tried every app, none actually helps me fall asleep" (u/xyz, r/insomnia, 340 upvotes)

2. ...
```

That's the product. Opportunity scoring + build recommendations + research
grounding, all Claude-synthesized from the corpus we already collect.

---

## Vision

Turn OpenReply into **the desktop app for product strategists and pre-PMF
founders** to answer: "what should I build in {domain}, what's the evidence,
and how does it compete?" — in under 15 minutes per topic, citation-grounded,
with a corpus that refreshes weekly.

---

## Current state (2026-04-20)

**What works:**
- Multi-source collect (Reddit + HN + arXiv + App Store + Play Store + OpenAlex + PubMed + Dev.to + Stack Overflow + GitHub + gnews + Google Trends)
- SQLite corpus with `posts`, `topic_posts`, `graph_nodes`, `graph_edges`
- Basic extractor pipeline (4 YAML-defined prompts, 1 per kind)
- Temporal classification (chronic / emerging / fading)
- Cross-source evidence edges + source-diversity scoring on findings (added 2026-04-20)
- Tool-use chat agent (5 tools: list_topics, run_query, get_findings, source_breakdown, sample_posts)
- Solutions pipeline (Problem → Why → Science → Solution) — runs but output is generic
- Semantic palace (ChromaDB + BM25 hybrid) for retrieval
- Temporal gap diff

**What's weak:**
- Extractors run on 50-post batches with no cross-source synthesis narrative
- No opportunity scoring — all findings listed equal
- No build recommendations — users get lists, not specs
- Research papers sit in Research tab but don't feed painpoint grounding
- No competitor matrix
- No monitoring / delta view for returning users
- No shareable export formats (pitch deck, battlecard, memo)

---

## Phased roadmap

Each phase = one shippable improvement. No big bang.

### Phase 1 — Claude-native synthesis + opportunity scoring (this week)

**The single biggest quality jump possible.**

Replace the 4 isolated extractors with ONE long-context Claude call that sees
the entire relevant corpus at once and produces a **structured market report**:

```json
{
  "executive_summary": "3-paragraph narrative",
  "findings": [
    {
      "title": "Sleep-onset anxiety loop",
      "kind": "painpoint",
      "pain_weight": 8.7,               // severity × frequency × source-diversity
      "competitor_coverage": 0.3,       // 0=greenfield, 1=saturated
      "opportunity_score": 8.3,         // pain_weight × (1 - coverage) × academic_backing
      "academic_backing": ["arxiv:2401.12345", "pubmed:39481023"],
      "evidence_post_ids": ["abc123", "def456", ...],
      "source_breakdown": {"reddit": 45, "arxiv": 3, "appstore": 12},
      "best_quote": "I've tried every app, none actually helps...",
      "best_quote_attribution": {"author": "u/xyz", "source": "r/insomnia"},
      "why_chronic_or_emerging": "short narrative"
    }
  ],
  "competitors": [
    {"name": "Calm", "features": [...], "weaknesses": [...], "evidence_post_ids": [...]},
    ...
  ],
  "opportunity_quadrant": {
    "greenfield": [...],   // high pain, low coverage
    "crowded":    [...],   // high pain, high coverage
    "niche":      [...],   // low pain, low coverage
    "mature":     [...]    // low pain, high coverage
  }
}
```

**Why one call, not N:**
- Claude sees ALL sources simultaneously → can say "arXiv identifies biomarker
  X that matches Reddit complaints about Y." Impossible with isolated extractors.
- Opportunity scoring needs cross-finding awareness (competitor coverage requires
  seeing products alongside painpoints).
- One prompt-cache-hit is 10× cheaper than 4 separate calls on overlapping corpus.

**UI:**
- New **Insights tab** (replaces or augments Map) — renders the market report
- 2×2 quadrant chart (Pain vs. Competitor density) with clickable findings
- Each finding card: title, scores, inline citations, best quote pull-out
- "Why this matters" narrative from executive summary

**Files created / changed:**
- `src/reddit_research/research/insights.py` — new synthesize function
- `prompts/insights_synthesis.yaml` — single long-context prompt
- `src/reddit_research/cli/main.py` — `research insights --topic T --json` command
- `app-tauri/src-tauri/src/commands.rs` — `synthesize_insights` command
- `app-tauri/src/api.js` — `api.synthesizeInsights(topic)`
- `app-tauri/src/screens/topic.js` — new `loadInsights` function, Insights tab
- `app-tauri/src/screens/insights.js` — new file for the quadrant + cards
- `app-tauri/src/style.css` — quadrant chart CSS

**Prompt-cache strategy:**
- System prompt + static instructions → `cache_control.ephemeral` (5-min TTL)
- Corpus content (2000 posts, can be 200K+ tokens) → also cached so re-runs
  within a session are fast
- Dynamic user asks at the end (uncached) for cheap iteration

**Claude tool-use:**
- The synthesize call has tools: `get_more_posts(source, kind)` so it can drill
  if it needs additional evidence for a specific finding
- Max 3 tool-use rounds per synthesize call (bounded)

**Success criteria:**
- Insights tab shows ≥5 findings with scores, citations, and narrative
- Opportunity quadrant renders and is clickable
- Single call completes in <60 s on 2000 posts
- Citations link back to real posts in the DB

### Phase 2 — Methodology-grade rigor layer (this week)

**Informed by `docs/RESEARCH_METHODOLOGY.md` review.** Ships 6 concrete
additions that transform Insights from an "opportunity list" into a
**consulting-grade research brief** — Minto-structured, hypothesis-anchored,
credibility-honest. Builds on the Phase-1 synthesis; same provider-agnostic
call, extended output schema, extended UI.

Each item is evaluated for ROI vs. methodology-doc noise. What's IN:

**2.1 Minto pyramid header (~1 day)**
- Single `governing_thought` (1 sentence, action-oriented) + 3 `key_arguments`
  (1 sentence each, with evidence citations) baked into the synthesis output.
- Rendered as the FIRST section on Insights tab, above executive summary.
- Minto rule: reader should get the answer in the first sentence.
- Anchor: Minto (1987) *The Pyramid Principle*.

**2.2 Hypothesis cards (~2 days)** — biggest conceptual upgrade
- Top-5 opportunities each generate a falsifiable hypothesis card:
  ```
  WE BELIEVE:   [segment]
  EXPERIENCES:  [painpoint]
  BECAUSE:      [mechanism / root cause]
  AND WOULD:    [behavior: pay / switch / adopt]
  FOR:          [proposed solution]
  WE'LL KNOW WE'RE WRONG IF:
    • [falsifier 1 — specific, measurable]
    • [falsifier 2]
  CHEAPEST TEST: [smoke test / 5 customer interviews / landing page]
  TIME BOX: 2 weeks · BUDGET: $X
  ```
- No falsifiers → reject (Popper's criterion programmatically enforced).
- Stored in `topic_insights.report_json` (no new table — hypotheses are part of the report).
- Exportable to markdown / Notion in Phase 6.
- Anchor: Popper (1959); Ries (2011) *The Lean Startup*; Blank (2013).

**2.3 Counter-evidence surfacing (~1 day)** — biggest credibility win per hour
- Each finding gets `disconfirming_evidence`: top 3 post_ids that disagree
  or defend the status quo. Asked in the same synthesis call (one round-trip).
- UI: "N posts disagree" link on every finding card; click opens a modal
  with the actual disconfirming quotes.
- No competitor in the space does this. Massive trust signal.

**2.4 Ulwick Opportunity Score (~0.5 day)** — replace ad-hoc formula
- Switch from `opportunity_score = pain × (1-coverage) × academic_bonus`
  to `importance + max(importance − satisfaction, 0)` on a 0–20 scale.
- Cleaner, citable (Ulwick 2005), simpler to explain in UI tooltip.
- `importance` (1–10) inferred from language intensity + frequency + WTP signals.
- `satisfaction` (1–10) inferred from sentiment toward current tools + DIY
  workaround complexity.
- Keep the 2×2 quadrant; just swap the x-axis source.

**2.5 Triangulation badge (~0.5 day)** — pure UI
- `source_diversity` already in metadata from Phase 1. Render as colored chip:
  🟢 Strong (≥3 source types), 🟡 Moderate (2), 🔴 Narrow (1).
- Shows up on finding cards + quadrant tooltip.
- Anchor: Denzin (1978) triangulation theory.

**2.6 Credible intervals on evidence counts (~0.5 day)**
- Replace "N=14" with "87% CI: 5.2–11.8% of relevant posts mention this."
- Beta-binomial posterior, 10 lines of Python in `insights.py::_credible_interval`.
- Displayed as a subtle chip next to evidence count.
- Anchor: classic Bayesian statistics; makes OpenReply *statistically honest*.

**Files:**
- `prompts/insights_synthesis.yaml` — schema extended for Minto + hypotheses +
  counter-evidence + Ulwick importance/satisfaction.
- `src/reddit_research/research/insights.py` — `_credible_interval`,
  `_validate_hypothesis` (Popper check), schema normalization updated.
- `app-tauri/src/screens/insights.js` — Minto header section, hypothesis
  card section, counter-evidence modal, triangulation badges.
- `app-tauri/src/style.css` — Minto + hypothesis + badge styles.
- No Rust changes, no DB schema changes (all fits in `topic_insights.report_json`).

**Total: ~5.5 days.** Ships as one coherent commit — all additions share
the same LLM call and output schema, so piecemeal shipping is wasteful.

**Explicitly rejected from the methodology doc as noise/scope-creep:**
- Issue trees / SCQA as user-facing Phase-1 step (too consulting-heavy for founders)
- Dual-model adjudication + Cohen's κ dashboard (doubles cost, marginal precision gain)
- 30-source expansion (we have 13, diminishing returns; ~6-month engineering)
- Neo4j/ArangoDB migration (SQLite works at scale; premature)
- Weekly human QA dashboard with Krippendorff's α (ship a "flag as wrong" button instead)
- BibTeX citation export / reproducibility snapshots (academic-use, zero founder value)
- Adversarial testing harness (post-PMF concern)

Deferred to later phases (not now but worth revisiting):
- Three-pass open→axial→selective coding (Phase 3 methodology) — pilot A/B later
- Saturation *curves* (Phase 4 methodology) — we have labels; curves are polish

### Phase 3 — Competitor matrix

Auto-extract every named product from `graph_nodes[kind=product]` + their
evidenced feature mentions. Produce:
- Feature-vs-competitor table
- Market-position map (pricing tier × feature breadth)
- "What each competitor misses" summary

**Files:**
- `src/reddit_research/research/competitors.py`
- New **Competitors tab** or section inside Insights

### Phase 4 — Research-to-finding linking via the palace

Use ChromaDB palace to match each painpoint/finding to the top-3 most
semantically similar academic papers. Surface them as "Research backing" on
each finding card.

Already partially there — palace exists. Just need the linking query +
persistence of the links as `grounded_in` edges.

### Phase 5 — Monitoring mode

Weekly cron → re-collect → delta view:
- "This week: 2 new painpoints, 1 new competitor, 3 new arXiv papers"
- Email/Slack webhook if user wires one
- Visible on Dashboard home

**Files:**
- Schedule already exists. Add `research weekly-digest` command.
- Dashboard home card for "What changed this week."

### Phase 6 — Export formats

One-click generators from the insight JSON:
- Pitch-deck markdown (title, problem, opportunity, solution, evidence)
- Competitor battlecard (PDF/Notion-ready)
- Investor memo (2-pager with citations)
- Notion page (import-friendly)

**Files:**
- `src/reddit_research/research/export_formats.py`
- Reports tab gains new format buttons

---

## Architecture decisions for Phase 1

### Why one long-context call, not a multi-agent crew

- Claude 4.7 has 1M context. A full aggressive-mode corpus (2000 posts, 50
  arXiv abstracts, 200 app store reviews) is ~200–400K tokens — well within
  budget. No chunking needed.
- One call = reproducible output (re-run gives similar synthesis).
  Multi-agent = chatty + variable.
- One call = one prompt-cache hit. Multi-agent = N cache misses.
- Determinism matters for a research tool users compare deltas on.

### Why a new Insights tab, not overload Map

- Map is a visualization. Insights is a narrative + decision tool.
- Different mental models, different layouts. Keep them separate.
- Map stays the "explore the graph" tab; Insights becomes the "tell me what
  to do" tab.

### Corpus selection for synthesize

```
top N posts by (score + num_comments × 2) per source_type, where
N = 50 for Reddit, 30 for HN, 20 for App Store, all for arXiv/PubMed.
```

Rationale: balance representation across sources so App Store reviews don't
drown out arXiv papers (Reddit is ~80% of raw post count). Cap at ~2000
total posts to stay under 400K input tokens.

### Schema additions

Add to `graph_nodes.metadata_json` for painpoints:
- `pain_weight` (float)
- `competitor_coverage` (float 0–1)
- `opportunity_score` (float)
- `academic_backing` (list of post IDs that are academic papers)
- `best_quote` (string)
- `best_quote_attribution` (object)

No new tables. Existing `graph_nodes` schema accommodates all of this in
metadata_json.

### Storing the insight run

New table `topic_insights`:
```sql
CREATE TABLE topic_insights (
  topic TEXT PRIMARY KEY,
  report_json TEXT,        -- full insight JSON
  generated_at TEXT,       -- ISO UTC
  corpus_size INTEGER,
  provider TEXT,
  model TEXT
);
```

One row per topic, overwritten on re-run. Previous versions can be recovered
from git history of the DB if needed; we don't version them in-table to
avoid bloat.

---

## Phase 1 task breakdown

### Backend (Python)

1. Create `prompts/insights_synthesis.yaml` with system + user template +
   response JSON schema.
2. Create `src/reddit_research/research/insights.py`:
   - `synthesize_insights(topic, provider=None) -> dict` — packs corpus,
     calls Claude with cache headers, parses + validates JSON.
   - `_select_corpus(topic)` — balanced sampling as above.
   - `_compute_scores(report)` — post-process raw LLM output to normalize
     scores to 0–10.
3. Add `topic_insights` table to `init_schema` in `core/db.py`.
4. Add CLI command `research insights --topic T --json` in `cli/main.py`.
5. Extend `analyze/providers/anthropic.py` (if not already there) to support
   `cache_control` via the Anthropic SDK.

### Rust (Tauri)

6. Add `synthesize_insights` command in `commands.rs`.
7. Register in `main.rs` invoke_handler.

### Frontend (JS)

8. Add `api.synthesizeInsights(topic)` in `api.js`.
9. Create `app-tauri/src/screens/insights.js` exporting `loadInsights(contentEl, topic)`.
10. Add Insights tab to `topic.js` tab bar + loader map.
11. Implement quadrant chart (SVG, no d3 for this one — lighter) + finding cards.
12. Style in `style.css`.

### Testing

13. Unit test `_select_corpus` with a fixture topic_posts fixture.
14. Integration test (manual) — run `research insights --topic <existing>` against a live Anthropic key.

### Rough sizes

- `insights.py`: ~200 lines
- `insights_synthesis.yaml`: ~80 lines (mostly system prompt + JSON schema)
- `insights.js`: ~300 lines (quadrant + cards + wiring)
- CSS additions: ~100 lines

Total ≈ 700 lines, ~4-8 hours implementation + tuning.

---

## Open questions (answer during Phase 1)

- Q: Should Phase 1 **replace** the existing 4-extractor pipeline, or run alongside?
  - Leaning: run alongside. Old extractors populate `graph_nodes`, new synthesize
    populates `topic_insights`. Users can read both during transition. Later we
    can drop the old extractors if Insights proves superior.

- Q: How do we handle a user who clicks "Insights" with no Anthropic key?
  - Fall back to the configured provider (Ollama, OpenAI, etc.). Note on the card
    that "quality is optimized for Claude; smaller models may truncate or fail JSON."

- Q: Prompt caching requires the Anthropic SDK version with cache_control support — is it installed?
  - Yes, already in `pyproject.toml`: `anthropic>=0.34`. Cache control is supported.

- Q: What's the auth flow if someone calls `research insights` without a topic that's been collected?
  - Return `{ok: false, error: "Topic not collected — run `research collect` first"}`.

---

## Success metrics for "best product"

After Phase 1–3:
- A non-technical early-stage founder can open OpenReply, enter a topic, wait 5 min,
  and walk away with a **shareable one-page opportunity brief** with citations.
- Return visit triggers a delta view: "here's what changed since last time you looked."
- Export to pitch deck / memo takes 1 click.

If we hit that, OpenReply is a $20–40/mo SaaS-quality product.

---

## Related docs

- `docs/specs/2026-04-19-retrieval-palace.md` — semantic palace (feeds Phase 4)
- `changelogs/` — per-change log entries
- `~/.claude/skills/tauri-python-sidecar-app/SKILL.md` — architecture patterns
