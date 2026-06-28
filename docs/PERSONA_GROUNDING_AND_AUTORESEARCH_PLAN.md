# Persona Grounding + Autoresearch + Simulation — Master Plan

> **Source projects analyzed:**
> - `/Users/shantanubombatkar/Documents/miro_jyotish/autoresearch` — Karpathy-style autonomous-loop Claude Code skill (9 commands, multi-persona deliberation, files-as-DB).
> - `/Users/shantanubombatkar/Documents/miro_jyotish/miroclaw_jyotish` — Flask + Neo4j + OASIS simulator that turns extracted entities into Reddit/Twitter agent profiles, runs synthetic discussions, and evolves prediction parameters via an autoresearch loop.
>
> **Target:** `/Users/shantanubombatkar/Documents/GitHub/reddit-myind` — OpenReply Tauri app with Python sidecar.
>
> **Date:** 2026-05-03
> **Status:** Plan — not yet implemented.

---

## 0 · Why this doc exists

The current OpenReply app has a multi-source corpus, findings, empathy maps, interviews, surveys, and a Launch Brief — but the **personas in those artefacts are LLM-imagined**, not grounded in actual Reddit/HN/etc. authors. The user's explicit ask:

> *"we have some data from reddit actual user post we can link that and proper form the persona around that and make all work proper and real."*

This document specifies, in concrete files-and-functions terms:

1. **What** patterns the two source projects contribute,
2. **How** to graft those patterns onto OpenReply,
3. **Where** every new file/table/screen/skill lands,
4. **Why** each piece matters (importance + product advantage),
5. **A phased plan** with effort estimates so the work is shippable in order.

---

## 1 · Executive summary

| Pattern | Source | Lands in OpenReply as | Effort | Lift |
|---|---|---|---|---|
| **Real-user persona clustering** | (new — inspired by oasis_profile_generator's individual/group split + post-history grounding) | `research/audience.py` + `audience_personas` table + `/audience/<topic>` screen | ~1 day | **Massive** — every persona surface in the app becomes citation-backed |
| **Persona cards UI** | (OpenReply design language) | `screens/audience.js` + sidebar entry | ~1 day | High — visible proof the personas are real |
| **5-persona deliberation** | `autoresearch:predict` (5 expert personas → debate → consensus) | wrapper around `synthesize_insights` + `build_launch_brief` | 2-3 days | High — 3-5× fewer iterations to a confirmed finding |
| **Autoresearch loop skill** | `autoresearch` (Karpathy 8-rule loop) | `.claude/skills/openreply-autoresearch/SKILL.md` + a small Goal/Metric/Verify config schema | 1-2 days | Medium — lets users set "improve until PMF ≥40%" and walk away |
| **OASIS synthetic simulation** | `oasis_profile_generator` + OASIS multi-agent | optional `/simulate/<topic>` screen + Python sidecar plugin | 5+ days | High but heavy — unlocks pre-ship "test your launch copy on synthetic users" |
| **Prediction lenses → evaluation lenses** | miroclaw's 9 lens scoring + weight-evolving mutator | `research/lenses.py` with N evaluation lenses for findings (severity, novelty, actionability, RICE, …) and a weight learner | 2 days | Medium — replaces hand-tuned thresholds with a self-improving composite |
| **Activity heatmap** | `simulation_config_generator` (timezone-aware hourly multipliers) | extension of `best_post_time` in launch brief — full hour×day matrix per topic | 0.5 day | Low-medium — better launch timing than a single best hour |

**Recommended order:** Phase 1 → Phase 2 → Phase 3 → Phase 4. Phase 5 (OASIS) only if synthetic simulation becomes a strategic priority.

---

## 2 · Source-project pattern catalog

This section names each pattern, points at the source file, and states the takeaway.

### 2.1 — Karpathy autonomous-loop pattern (`autoresearch/claude-plugin/skills/autoresearch/SKILL.md`)

The whole skill is ~70 lines of prompt + 9 markdown command files. Core loop:

```
1. Read state + git log + results.tsv
2. Pick ONE next change
3. Apply
4. git commit (with "experiment:" prefix)
5. Run mechanical verify command (e.g. pytest, custom CLI)
6. Improved? keep. Worse? git revert. Crashed? skip.
7. Append result to TSV
8. Loop forever or N times
```

**8 critical rules** (their own list):
1. Loop until done — unbounded or N
2. Read before write
3. ONE change per iteration (atomic, debuggable)
4. Mechanical verification only — no "looks good"
5. Automatic rollback on regression
6. Simplicity wins (equal result + less code → keep)
7. Git is memory (`experiment:` commits, agent reads `git log` each iter)
8. When stuck, think harder (re-read, combine near-misses, radical changes)

**Why it matters for OpenReply:** every "re-build" button (Re-build empathy, Re-run synthesize, Re-generate launch brief) is currently a one-shot. Wrapping it in this loop turns each into "iterate until metric ≥ threshold."

### 2.2 — Multi-persona deliberation (`autoresearch:predict`, guide at `autoresearch/guide/autoresearch-predict.md`)

8-phase workflow:

```
Phase 1: Setup            — parse scope/goal/depth
Phase 2: Reconnaissance   — read code, build 3 markdown knowledge files
Phase 3: Persona gen      — 5 personas with role + bias direction
Phase 4: Independent      — each persona analyzes alone, no cross-talk
Phase 5: Debate           — 1-3 rounds of structured cross-examination
Phase 6: Consensus        — voting + scoring (severity × confidence × consensus)
Phase 7: Report           — findings.md, hypothesis-queue, overview
Phase 8: Handoff          — handoff.json, optional --chain to next tool
```

The 5 default personas (Architecture / Security / Performance / Reliability / Devil's-Advocate) are domain-agnostic — they map cleanly onto findings analysis ("does this finding hold up under skeptical review?"). The Devil's Advocate is constrained to challenge ≥50% of majority positions, ensuring real adversarial pressure.

**Knowledge representation is plain markdown** (`codebase-analysis.md`, `dependency-map.md`, `component-clusters.md`) — no vector DB, no graph engine. Audited with the current `git rev-parse HEAD`; staleness flagged on next run.

**Why it matters for OpenReply:** our `synthesize_insights` produces a single LLM pass — the LLM has no internal critic. A pre-write debate would catch the off-topic findings, the duplicate hypotheses, and the JTBD statements that don't actually map to evidence. Their measured payoff: 3-5× fewer iterations to a confirmed root cause, 37% higher precision on real issues.

### 2.3 — Other autoresearch commands worth grafting

| Command | Behaviour | OpenReply fit |
|---|---|---|
| `autoresearch:scenario` | Seed scenario → derivative scenarios + edge cases | Generate "what if this finding is wrong?" / "what edge case breaks this experiment?" before running it |
| `autoresearch:debug` | 7-technique scientific bug hunt loop | Already covered by our `openreply_diagnostics` tool — could deepen with this pattern |
| `autoresearch:fix` | Fix-until-zero (tests/types/lint/build) | Wrap `npm run test` + `cargo check` + `pytest` into one "fix everything" loop |
| `autoresearch:learn` | Doc generation with validation-fix loop | Could regenerate the `docs/` folder when code changes (lower priority) |
| `autoresearch:security` | STRIDE + OWASP + 4 red-team personas | Could audit the Tauri capabilities + Python sidecar surface (use the existing `/security-review` slash command instead) |

### 2.4 — OASIS persona generator (`miroclaw_jyotish/backend/app/services/oasis_profile_generator.py`)

Key data structure (the takeaway):

```python
@dataclass
class OasisAgentProfile:
    user_id: int
    user_name: str
    name: str
    bio: str               # ~200 chars
    persona: str           # ~2000 chars — narrative
    karma: int = 1000
    age: Optional[int] = None
    gender: Optional[str] = None
    mbti: Optional[str] = None
    country: Optional[str] = None
    profession: Optional[str] = None
    interested_topics: list[str] = []
    source_entity_uuid: Optional[str] = None   # provenance back to graph
    source_entity_type: Optional[str] = None
```

Two prompt templates — **individual** vs **group** entity — with carefully different sections:

- **Individual persona** prompt asks for: basic info, background ties to events, MBTI + emotional expression, posting frequency + content prefs + interaction style + language quirks, stance on the topic, what would anger/move them, idiosyncratic traits, **personal_memory linking the persona to specific past actions in the corpus**.
- **Group persona** prompt asks for: institutional info, account positioning, voice, content cadence, official stance, how it handles controversy, and **institutional_memory** of past actions.

The "**personal memory** linking persona → specific past actions" is the bit that makes simulated agents behave realistically rather than as bland archetypes. We'd grab that prompt structure verbatim.

### 2.5 — OASIS simulator + IPC (`miroclaw_jyotish/backend/scripts/run_reddit_simulation.py`)

OASIS itself is a 3rd-party multi-agent social-simulation library that:
- Reads a profile JSON (Reddit or Twitter format) and a config (timesteps, action rates, network density)
- Runs the agents through a synthetic platform with `Post`, `Comment`, `Like`, `Follow`, `Vote` actions
- Logs every action to a SQLite file that can be analyzed afterwards
- Supports **Interview** mode mid-run via IPC files — drop a JSON command into `ipc_commands/`, get a JSON response in `ipc_responses/`. Lets you ask "what do you think about X?" of any agent during the simulation.

**Why it matters for OpenReply:** before shipping a launch announcement, you'd run it through 200 personas grounded in your actual corpus and see which segments react how. The fail-cases (cluster N hates the messaging) become signals before you ship rather than after.

### 2.6 — Simulation config generator (`miroclaw_jyotish/backend/app/services/simulation_config_generator.py`)

Encodes **timezone-aware hourly activity profiles**:

```
dead_hours        = [0,1,2,3,4,5]    × 0.05 multiplier
morning_hours     = [6,7,8]           × 0.4
work_hours        = [9..18]           × 0.7
peak_hours        = [19..22]          × 1.5
night_hours       = [23]              × 0.5
```

Then per-agent activity_level (0.0..1.0) modulates that. Result: realistic posting cadence rather than uniformly random.

**Why it matters for OpenReply:** our current `best_post_time` returns a single hour. Extending to a full hour×day-of-week heatmap with audience-segment overlays is a much sharper "when to launch" signal — and it's pure SQL over `posts.created_utc`.

### 2.7 — Prediction Evolution Engine (`miroclaw_jyotish/backend/app/services/evolution/`)

Five files that together implement the autoresearch loop:

- `prediction_engine.py` — runs the loop body
- `loop_runner.py` — background-execution + signal handling
- `mutator.py` — perturbs config (lens weights, prompt parameters, …)
- `scorer.py` — composite metric: numerical (40%) + directional (30%) + event (30%) against ground truth
- `experiment_logger.py` — TSV log
- `ground_truth.py` — real-world data fetcher
- `historical_collector.py` — bulk-pull historical truth
- `time_travel.py` — replay framework for backtesting

**Why it matters for OpenReply:** we don't predict economy time series, but the **same machinery** can evolve our prompt parameters / extraction thresholds / clustering hyperparams against our existing ground truth (e.g. user `feedback_record` rows say "this finding was wrong" — the mutator can hill-climb the synthesize prompt to minimize that signal).

### 2.8 — 9 Prediction Lenses (`miroclaw_jyotish/PREDICTION_LENSES_GUIDE.md`)

Each lens implements a contract:

```
INPUT:  date/time + context
OUTPUT: signal (bullish/bearish/neutral) + confidence (0..1) + reasoning
```

Composite = Σ (lens_score × lens_weight); weights learned by the loop.

**The takeaway is not the lenses themselves** (Vedic astrology isn't relevant) — it's the **plug-in lens architecture**. We can have evaluation lenses for findings:

- **Severity lens** — how severe is this painpoint (mention count, sentiment intensity, recency)
- **Novelty lens** — is this finding new vs. already-known?
- **Actionability lens** — could a small team ship a fix in <8 weeks?
- **Defensibility lens** — does the moat exist after the fix?
- **Market-size lens** — what's the TAM × penetration estimate?

Each is a single function returning `{score, confidence, reasoning}`. The loop learns which lens correlates with user-confirmed findings (`feedback_record.verdict='ok'`) and reweights accordingly.

---

## 3 · Mapping to OpenReply — what each piece becomes

### 3.1 — Real-user persona clustering (the user's explicit ask)

**The gap:** today's `audience.icp_personas` in the Launch Brief is built from `empathy_maps` (LLM-derived) + `interviews.persona` (manually entered) + a one-shot LLM augment. None of those tie back to a specific Reddit user.

**The fix:** cluster `posts.author` × their post history within a topic, derive the persona from the cluster's posts, and persist with citations.

**Algorithm:**

```
For topic T:
  1. SELECT author, GROUP_CONCAT(title || ' ' || selftext)   FROM posts
     JOIN topic_posts USING (post_id)                         WHERE topic = T
     GROUP BY author HAVING count(*) >= 3                     -- skip drive-bys
  2. For each author, build a feature vector:
     - sub-mix one-hot (which subs they post in)
     - TF-IDF n-grams over concatenated text
     - engagement profile (avg score, comment-per-post ratio, post freq, recency)
     - sentiment distribution (3-bucket: pos / neu / neg)
     - existing palace MiniLM embedding of concatenated text  ← reuse what's there
  3. Cluster (HDBSCAN or k-means at k∈{3..7}, pick by silhouette)
  4. For each cluster:
     - members             → list of user IDs
     - exemplar_post       → highest-engagement post
     - top_subs            → top 3 subs members post in
     - vocab_signatures    → top 20 distinctive n-grams (TF-IDF over cluster vs corpus)
     - says/wants/hates    → verb-extraction over cluster posts (existing empathy pattern, cluster-scoped)
     - demographics        → keyword scan over cluster posts (existing helper, cluster-scoped)
     - activity_heatmap    → hour×dow matrix from members' posts.created_utc
     - tightness           → silhouette score for cluster
  5. LLM-augment (one call per cluster):
     - reuse `oasis_profile_generator`'s individual prompt template
     - add hard constraint "every claim cites ≥1 post_id from members"
     - generate: name, bio (200 char), persona (2000 char), age estimate,
                 mbti, profession, interested_topics, personal_memory
  6. Persist to audience_personas
```

**New table:**

```sql
CREATE TABLE audience_personas (
  id              INTEGER PRIMARY KEY,
  topic           TEXT NOT NULL,
  cluster_id      INTEGER NOT NULL,
  label           TEXT,                  -- LLM-written name
  bio             TEXT,
  persona         TEXT,                  -- 2000-char narrative
  member_authors  TEXT,                  -- JSON array of user IDs
  exemplar_post_ids TEXT,                -- JSON array of post IDs
  top_subs        TEXT,                  -- JSON array
  vocab_signatures TEXT,                 -- JSON array
  says_wants_hates_json TEXT,            -- {says:[...], wants:[...], hates:[...]}
  demographics_json TEXT,                -- {age, mbti, country, profession, ...}
  activity_heatmap_json TEXT,            -- 7×24 matrix
  tightness       REAL,
  generated_at    TEXT,
  provider        TEXT,
  model           TEXT,
  UNIQUE(topic, cluster_id)
);
```

**Files to touch:**

- **NEW** `src/reddit_research/research/audience.py` — `build_audience_personas(topic, k=None, llm=True, persist=True)`, `get_audience_personas(topic)`.
- **NEW** `src/reddit_research/research/_clustering.py` — pure-deterministic helpers (vector building, HDBSCAN/k-means, silhouette).
- **MODIFY** `src/reddit_research/cli/main.py` — `research audience-build` + `research audience-get` subcommands.
- **MODIFY** `src/reddit_research/mcp/server.py` — `openreply_audience_personas(topic, llm=True)` + `openreply_audience_personas_get(topic)`.
- **MODIFY** `src/reddit_research/research/launch.py` — `_personas_from_existing` reads from `audience_personas` first, falls back to existing empathy/interview path.

### 3.2 — Persona cards UI

**New screen** `/audience/<topic>` styled the same way as the redesigned PMF/OST/Launch screens.

**Layout:**

```
topbar:    crumbs + topbar-spacer + "Re-cluster" / "Re-build with AI" buttons
stat-grid: clusters count · members covered · cluster tightness · top occupation
section-head: "Personas grounded in your corpus"
topic-grid: cluster cards (one per persona)
  each card:
    - card-head:  avatar (deterministic SVG seed) + name + member count + tightness chip
    - card-body:
        * persona blurb (first 240 chars + "Read full" expand)
        * demographic chips (age range, country, profession, mbti)
        * top-3 subs as pill links
        * "Says / Wants / Hates" 3-column mini-grid
        * activity heatmap (7×24 mini SVG, intensity by mean engagement)
        * exemplar post link (opens in new tab)
        * member dropdown listing actual usernames (linkable)
section-head: "How these were built"
card:      methodology explanation (clustering features used, k chosen, source counts)
```

**Files to touch:**

- **NEW** `app-tauri/src/screens/audience.js` — picker (no topic) + topic view.
- **MODIFY** `app-tauri/src/api.js` — `api.audiencePersonas(topic)` + `api.audiencePersonasBuild(topic, opts)`.
- **MODIFY** `app-tauri/src-tauri/src/commands.rs` + `main.rs` — `audience_personas` + `audience_personas_build` Tauri commands.
- **MODIFY** `app-tauri/src/main.js` — route `/audience/<topic>` + explainer slug `audience`.
- **MODIFY** `app-tauri/index.html` — sidebar entry "Audience" with `users` icon, between Empathy Maps and Interviews.

### 3.3 — Multi-persona deliberation wrapper

**Pattern:** identical 5-persona setup as `autoresearch:predict`, but our personas are scoped to *finding analysis* not code analysis. Rename:

| Predict's name | Our equivalent | Bias |
|---|---|---|
| Architecture Reviewer | Synthesizer | Spots duplicates and confused taxonomy |
| Security Analyst | Skeptic | Demands evidence; flags hallucinated claims |
| Performance Engineer | Quantifier | Wants mention counts, sentiment, RICE inputs |
| Reliability Engineer | Risk Officer | Asks "what breaks if this finding is acted on?" |
| Devil's Advocate | Devil's Advocate | Must challenge ≥50% of majority positions |

**Where it bolts in:**

```
synthesize_insights(topic) → { findings, ... }
   ↓
deliberate(findings, topic) → {
   confirmed:  [findings with ≥3/5 confirm votes],
   probable:   [findings with 2/5 confirm votes],
   minority:   [findings with 1/5 confirm votes],
   discarded:  [findings with 0/5 confirm votes — dropped],
}
   ↓
persist confirmed+probable; surface "X minority views" badge
```

**Files to touch:**

- **NEW** `src/reddit_research/research/deliberate.py` — pure-Python implementation of the 5-persona debate loop on a list of findings. ~300 lines.
- **MODIFY** `src/reddit_research/research/insights.py` — optional `deliberate=True` flag on `synthesize_insights` that runs `deliberate.run(findings)` post-parse and tags each finding with `consensus`.
- **MODIFY** `src/reddit_research/research/launch.py` — same flag on `build_launch_brief`.
- **MODIFY** schema — add columns to `topic_insights`: `consensus_json TEXT` (per-finding tier).
- **UI:** chips on finding cards `[Confirmed]` / `[Probable]` / `[Minority]`; expandable "Why disputed" panel showing the persona votes.

### 3.4 — Autoresearch loop as a Claude Code skill

**Not in-app code** — lives in `.claude/skills/` so it ships with the repo and works in any Claude Code session.

**Files to create:**

- `.claude/skills/openreply-autoresearch/SKILL.md` — name, description, trigger phrases, embedded loop body adapted from autoresearch's SKILL.md but pre-configured for OpenReply.
- `.claude/skills/openreply-autoresearch/references/synthesize-loop.md` — Goal=`PMF≥40%` / Verify=`python -m reddit_research.cli pmf score --topic $T` / Scope=`research/insights.py` + `research/prompts/insights_synthesis.json` / Direction=`reduce off-topic findings, sharpen JTBD, prune duplicates`.
- `.claude/skills/openreply-autoresearch/references/audience-loop.md` — same shape but for the audience clustering hyperparams.
- `.claude/skills/openreply-autoresearch/references/launch-loop.md` — for the Launch Brief.

**Trigger:** user types `/openreply-autoresearch` in Claude Code; the skill loads, asks the 4-7 setup questions, then runs the loop with mechanical verification via the Python CLI we already have.

### 3.5 — Activity heatmap upgrade

**Trivial extension** of the existing `_best_post_time` in `research/launch.py`:

```python
def _activity_heatmap(db, topic):
    # 7×24 matrix of avg engagement
    rows = db.query("""
      SELECT created_utc, coalesce(score,0)+coalesce(num_comments,0) AS eng
      FROM posts JOIN topic_posts USING (post_id)
      WHERE topic = :t AND created_utc > 0
    """, {"t": topic})
    grid = [[[] for _ in range(24)] for _ in range(7)]
    for r in rows:
        dt = datetime.fromtimestamp(r["created_utc"], tz=UTC)
        grid[dt.weekday()][dt.hour].append(r["eng"])
    return [[mean(c) if c else 0 for c in row] for row in grid]
```

Render in launch screen + per-persona in the audience screen.

### 3.6 — Evaluation lenses (Phase 5 extension)

**Lens contract:**

```python
class FindingLens(Protocol):
    name: str
    weight: float          # learned by the loop, default 1.0/N

    def score(self, finding: dict, ctx: dict) -> dict:
        return {"score": float, "confidence": float, "reasoning": str}
```

**N starter lenses:**

| Lens | Score signal |
|---|---|
| `severity_lens` | mention_count × sentiment_intensity × recency_decay |
| `novelty_lens` | 1 − cosine(finding.embedding, recent_findings.embedding).max() |
| `actionability_lens` | RICE.score normalized; require effort < 8w |
| `defensibility_lens` | competitor coverage gap from `global_competitors` |
| `market_size_lens` | mention_count × extrapolated_user_base |
| `evidence_strength_lens` | n_unique_sources × avg_post_score |

**Composite** = Σ weight × score. `mutator.py`-style learner perturbs weights and keeps the version that maximizes user-confirmed-finding rate (`feedback_record.verdict='ok'` / total feedback).

**Files:**

- **NEW** `src/reddit_research/research/lenses/__init__.py` + one file per lens.
- **NEW** `src/reddit_research/research/lens_evolver.py` — the autoresearch-style mutator that hill-climbs lens weights against `feedback_record`.
- **MODIFY** `synthesize_insights` to attach `composite_score` per finding.

### 3.7 — OASIS synthetic simulation (Phase 5)

**Optional but high-leverage.** Wraps `oasis-ai` + `camel-ai` as a separate Python package the sidecar can shell out to (because `oasis-ai` pulls 150+ MB of deps).

**Workflow:**

1. `audience_personas` → OASIS profile JSON (Reddit format) — straightforward dataclass map.
2. User pastes a launch announcement / new feature copy / pricing page text.
3. Sidecar spawns OASIS subprocess with a pre-canned config (200 agents, 20 timesteps).
4. OASIS posts the user's copy as a seed post; agents Post / Comment / Like / Vote.
5. After completion, sidecar parses the OASIS SQLite log and returns:
   - reaction histogram (love / lukewarm / hostile per cluster),
   - top 10 simulated comments (with author cluster),
   - sentiment trajectory over 20 timesteps,
   - per-cluster "would they share" odds.
6. New screen `/simulate/<topic>` shows the report with each cluster's reaction, deep-link to interview a specific agent (using OASIS IPC).

**Files to touch:**

- **NEW** `src/reddit_research/simulate/oasis_runner.py` — orchestrates spawn / monitor / parse.
- **NEW** `src/reddit_research/simulate/oasis_profile_map.py` — adapter `audience_personas` row → OASIS `OasisAgentProfile` (the dataclass we lift from miroclaw verbatim).
- **NEW** `app-tauri/src/screens/simulate.js`.
- **NEW** sidebar entry "Simulate" with `cpu` icon, gated behind a Settings toggle "Enable synthetic simulation (downloads ~150 MB)."

---

## 4 · Where every new artefact lives

```
openreply-map/
├── .claude/
│   └── skills/
│       └── openreply-autoresearch/
│           ├── SKILL.md                          [Phase 4]
│           └── references/
│               ├── synthesize-loop.md            [Phase 4]
│               ├── audience-loop.md              [Phase 4]
│               └── launch-loop.md                [Phase 4]
│
├── docs/
│   └── PERSONA_GROUNDING_AND_AUTORESEARCH_PLAN.md  ← this file
│
├── src/reddit_research/
│   ├── research/
│   │   ├── audience.py                           [Phase 1]   NEW
│   │   ├── _clustering.py                        [Phase 1]   NEW
│   │   ├── deliberate.py                         [Phase 3]   NEW
│   │   ├── lenses/                               [Phase 5]   NEW
│   │   │   ├── __init__.py
│   │   │   ├── severity.py
│   │   │   ├── novelty.py
│   │   │   ├── actionability.py
│   │   │   ├── defensibility.py
│   │   │   ├── market_size.py
│   │   │   └── evidence_strength.py
│   │   ├── lens_evolver.py                       [Phase 5]   NEW
│   │   ├── insights.py                           [Phase 3]   MODIFY (deliberate flag)
│   │   └── launch.py                             [Phase 1+5] MODIFY (real personas + lenses)
│   ├── simulate/                                 [Phase 5]   NEW
│   │   ├── __init__.py
│   │   ├── oasis_runner.py
│   │   └── oasis_profile_map.py
│   ├── cli/main.py                               [Phase 1+]  MODIFY (new subcommands)
│   ├── mcp/server.py                             [Phase 1+]  MODIFY (new MCP tools)
│   └── core/db.py                                [Phase 1]   MODIFY (audience_personas table)
│
├── app-tauri/
│   ├── index.html                                [Phase 2]   MODIFY (sidebar)
│   ├── src/
│   │   ├── main.js                               [Phase 2]   MODIFY (routes + slug)
│   │   ├── api.js                                [Phase 2]   MODIFY (api helpers)
│   │   └── screens/
│   │       ├── audience.js                       [Phase 2]   NEW
│   │       └── simulate.js                       [Phase 5]   NEW
│   └── src-tauri/src/
│       ├── commands.rs                           [Phase 2]   MODIFY (Tauri cmd wrappers)
│       └── main.rs                               [Phase 2]   MODIFY (generate_handler!)
│
└── changelogs/
    ├── 2026-MM-DD_NN_audience-personas-from-real-users.md   [Phase 1]
    ├── 2026-MM-DD_NN_audience-screen.md                     [Phase 2]
    ├── 2026-MM-DD_NN_multi-persona-deliberation.md          [Phase 3]
    ├── 2026-MM-DD_NN_openreply-autoresearch-skill.md          [Phase 4]
    └── 2026-MM-DD_NN_evaluation-lenses-and-oasis-sim.md     [Phase 5]
```

---

## 5 · Importance + product advantage (per phase)

### Phase 1 — Real-user persona grounding

**Importance:** ★★★★★ — directly answers the user's stated requirement.

**Advantages:**

1. **Defensible personas.** Today's personas are LLM hallucinations. Tomorrow's personas cite specific real Reddit users + posts → every claim is auditable.
2. **Better Launch Brief.** The Launch Brief already has a `audience.icp_personas` slot. Filling it with real-user clusters makes every downstream artefact (positioning, channel ranking, MVP feature list) more credible.
3. **Better empathy maps.** Says/Thinks/Does/Feels per *cluster* (rather than imagined "primary persona") becomes statistically meaningful.
4. **Better PMF surveys.** "Run the survey on cluster X first" — the personas tell you which segments to over-serve.
5. **Better OST experiments.** Each experiment can target a specific cluster; success criteria become "≥30% of cluster X clicks the export button."
6. **Cold-start advantage.** Even when no LLM is configured, the deterministic pass alone produces usable personas. Phase 1 has an LLM fallback path that fully degrades.

**Quantitative effect estimates:**

- Findings precision (`feedback_record.verdict='ok'` / total) — expected +20-30% (synthesize prompt now sees real-user persona vocab).
- "I don't recognize these personas" friction in welcome flow — expected −60% (replaced by names from your real audience).
- Launch Brief regeneration rate (proxy for "I don't trust this") — expected −40%.

### Phase 2 — Persona cards UI

**Importance:** ★★★★ — the visible proof. Without the screen, users won't trust the data.

**Advantages:**

1. **Single-screen view of who is in your audience.** Currently scattered across home/topic/empathy.
2. **Click-through to actual posts.** A user can click an exemplar post link and see the real Reddit comment that grounded the cluster.
3. **Sticky moment.** "I never knew my audience had a 'frustrated freelancer' segment" — that's the moment users tell colleagues about the app.

### Phase 3 — Multi-persona deliberation

**Importance:** ★★★★ — quality bump on every existing pipeline.

**Advantages:**

1. **3-5× fewer iterations** to a confirmed root cause (per autoresearch's measured result).
2. **Consensus tiers** (Confirmed/Probable/Minority) replace the binary "extracted/not extracted" — users can see what's been challenged and why.
3. **Reduced LLM hallucination.** Devil's Advocate constraint forces ≥50% challenges; the synthesize prompt can no longer get away with a confident-but-wrong finding.
4. **Same machinery extends to OST experiments, launch brief sections, even pricing recommendations** — the wrapper is generic.
5. **Logs are auditable.** Every debate transcript lands in `mcp_analyses` + a `deliberations.md` per topic — users can see exactly why a finding was rejected.

### Phase 4 — Autoresearch loop skill

**Importance:** ★★★ — power-user feature, but the multiplier is huge once invoked.

**Advantages:**

1. **Unattended improvement.** "Improve until PMF ≥ 40%" → kicks the loop, walks away, comes back to a result.
2. **Mechanical verification.** No more "the prompt feels better"; only the metric counts.
3. **Compounding gains.** Every improvement stacks; failures auto-revert via git.
4. **Learnability.** The TSV log + git history teach the user (and Claude in future sessions) what worked.
5. **Zero new in-app code.** Lives in `.claude/skills/`; works whenever Claude Code is open in this repo.

### Phase 5a — Evaluation lenses

**Importance:** ★★★ — sharpens ranking. Lower priority than 1-3.

**Advantages:**

1. **Replaces hand-tuned thresholds** (e.g. our hard-coded `OPENREPLY_FINDING_RELEVANCE_THRESHOLD=0.40`) with a learned composite.
2. **Per-user weights.** Different teams care about different things; lens weights become user prefs.
3. **Self-improving** — the `feedback_record` table is the ground truth, the mutator hill-climbs against it.

### Phase 5b — OASIS synthetic simulation

**Importance:** ★★★★ once stable, but ★★ until then (heavy deps, longer dev cycle).

**Advantages:**

1. **Pre-ship validation.** Simulate launch reaction across 200 cluster-grounded agents before posting to Reddit/HN.
2. **What-if exploration.** "What if we pivot the headline?" — re-run the sim with a new seed post, compare reaction histograms.
3. **Reduces real-world failure cost.** A bad launch on real Reddit is permanent; a bad simulated launch is a tab refresh.
4. **Differentiator.** No competing research tool ships synthetic-audience simulation. This is moat material.

**Risks:**

- 150 MB+ extra dependencies (oasis-ai + camel-ai + their transitive deps).
- Simulation realism is bounded by persona quality — Phase 1 must be solid first.
- Adds a ~30s sidecar warmup the first time the user opens `/simulate`.

---

## 6 · Phased implementation plan

| Phase | Deliverables | Effort | Sequence prereqs | Ship criteria |
|---|---|---|---|---|
| **1** | `research/audience.py` + `_clustering.py` + `audience_personas` table + 2 CLI subcommands + 2 MCP tools + Launch Brief integration | 1 day | none | `audience_personas` populated for ≥3 demo topics; Launch Brief shows real users + post citations |
| **2** | `screens/audience.js` + sidebar entry + Tauri commands + api.js helpers + route | 1 day | Phase 1 | Audience screen renders for any topic with ≥1 cluster; click-through to real Reddit posts works |
| **3** | `research/deliberate.py` + flag on `synthesize_insights` + flag on `build_launch_brief` + UI tier chips | 2-3 days | Phase 1 (lens needs real personas) | Every new finding tagged Confirmed/Probable/Minority; debate transcript persisted |
| **4** | `.claude/skills/openreply-autoresearch/` with 3 references | 1-2 days | none | `/openreply-autoresearch` runs the loop end-to-end on the synthesize pipeline |
| **5a** | `research/lenses/*.py` + `lens_evolver.py` + finding `composite_score` | 2 days | Phase 1, 3 | Lens weights mutate against `feedback_record`; composite score visible on findings |
| **5b** | `simulate/oasis_runner.py` + `oasis_profile_map.py` + `screens/simulate.js` + sidebar gate + Settings toggle | 5+ days | Phase 1, 2 | Settings toggle enables OASIS; simulation runs on demo topic and produces reaction histogram |

**Total to ship Phases 1-4:** ~5-7 working days.
**With Phase 5a:** +2 days.
**With Phase 5b:** +5 days.

---

## 7 · Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Clustering produces 1 mega-cluster on tiny topics.** | Min 3 clusters required; fall back to "single audience" mode with a banner "more posts needed for segmentation." |
| **Author de-anonymization concerns.** | Display only author IDs the topic's posts already display; no email / external lookup. Add a Settings toggle "Hide author IDs in audience cards." |
| **Reddit `[deleted]` / AutoModerator pollute clusters.** | Filter list already exists in `research/launch.py`; reuse. |
| **LLM augmentation cost spikes** (1 call per cluster × N topics). | Cache aggressively; deliberate only on first build. Per-topic budget cap via env. |
| **Multi-persona debate triples LLM cost.** | Skip when `topic_insights.confidence_avg ≥ 0.85`. Make `deliberate=False` the default for the first 90 days. |
| **OASIS deps balloon the bundle.** | Gate Phase 5b behind a Settings toggle that lazy-installs on first use; do not bundle by default. |
| **Cluster instability between runs.** | Persist a stable `cluster_id` keyed on the centroid embedding hash so re-clustering doesn't shuffle existing personas. |

---

## 8 · Open questions (decisions needed before Phase 1)

1. **Clustering library.** HDBSCAN (better for variable-density clusters but heavier dep) vs scikit-learn k-means (lighter, already a dep) vs the existing palace ChromaDB clustering primitive (zero new deps but less control)? — **Default proposal: ChromaDB-based, fall back to k-means.**
2. **Min posts per author** to enter a cluster. — **Default: 3.**
3. **Default cluster count** when k is auto-picked. — **Default: try {3,5,7} and pick best silhouette.**
4. **LLM call budget per audience build.** — **Default: 1 call per cluster (max 7), 2000 max_tokens each.**
5. **Should Empathy Maps degrade to a per-cluster view automatically once Phase 1 ships?** — **Proposal: yes, but keep the manual "primary" persona path for users who haven't run audience-build yet.**
6. **Is the Audience screen a sibling of Empathy Maps in the sidebar, or does it replace it?** — **Proposal: sibling, between Empathy Maps and Interviews. Empathy Maps stays as the deeper Says/Thinks/Does/Feels per persona.**

---

## 9 · Success metrics

After Phase 1+2 ship:

- ≥80% of demo topics produce ≥3 distinct clusters.
- Average cluster has ≥5 backing authors and ≥15 backing posts.
- ≥1 cluster per topic has a `tightness` score ≥ 0.4.
- Launch Brief regeneration rate drops by ≥30% (proxy for "I trust the personas").
- User-confirmed-finding rate (`feedback_record.verdict='ok'`) increases by ≥15%.

After Phase 3 ships:

- ≥40% of findings rated `Confirmed`; ≥10% `Discarded` outright.
- Average finding precision (manual eval on 100 random findings) increases by ≥20%.

After Phase 4 ships:

- One demo run of `/openreply-autoresearch` produces ≥3 net-positive iterations on PMF / synthesize accuracy / off-topic finding rate.

After Phase 5b ships (if pursued):

- Simulated launch reaction predicts real launch outcome direction (positive/negative reception) on ≥3 historical case studies with ≥70% directional accuracy.

---

## 10 · TL;DR for stakeholders

We've analyzed two existing internal projects:
- An autonomous-loop Claude Code skill (autoresearch).
- A persona-grounded multi-agent simulator (miroclaw_jyotish).

Both contribute patterns that fix OpenReply's biggest current weakness: **the personas the app produces are LLM-imagined, not grounded in your actual Reddit users**. The fix is a 1-day deterministic clustering pass over `posts.author` + a 1-day UI screen — that alone replaces every persona surface in the app with citation-backed real users. The follow-on work (5-persona debate over findings, autoresearch loop skill, optional synthetic simulation) compounds quality further. Phases 1-4 ship in ~5-7 days; phase 5 is opt-in.

The core promise: **every claim OpenReply makes about your audience traces back to a specific user post you can click on.** That's the only persona ground-truth that matters.
