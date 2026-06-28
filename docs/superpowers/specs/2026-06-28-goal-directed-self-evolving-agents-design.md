# Goal-Directed, Self-Evolving Agents — Design Spec

**Date:** 2026-06-28
**Status:** Approved design → implementation planning

## 1. Goal & summary

Make each OpenReply agent **goal-directed** and **self-evolving**: it carries an
explicit, structured goal (promote the product toward a measurable win), and it
continuously refines a **Goal Playbook** — a living, inspectable strategy — from
its memory, the data it fetches, its synthesized conclusions, and the feedback on
every reply/post/article it produces. Every new output is written from that
evolving playbook, so quality compounds toward the goal.

This is built **on top of the existing memory/graph/palace stack** (personas,
ChromaDB/ONNX embeddings, `persona_edges` graph, `build_knowledge_context`) — the
Goal Playbook is a new *strategy* layer above the existing *knowledge* layer, not
a parallel system.

It should also behave like a **real brain**: knowledge **accumulates and is never
lost**, similar ideas are **linked associatively across data sources** (reddit ↔ HN
↔ YouTube ↔ reviews) and across the agent's personas the way humans connect things,
and the agent **combines** that knowledge — from a single source, from its
conclusions, or a mix — into **suggested articles/posts** with the threads it fused
made explicit. (§3.3, §4.5–4.6.)

## 2. What already exists (build on this — do not reinvent)

| Layer | Where | Notes |
|---|---|---|
| Agent identity + goal/product | `reply/agent.py` `agents` table | **Already has `goal`, `product` columns**; `update_agent` accepts them |
| Agent → memory | `agent_personas` (agent_id, persona_id, weight) | "Agent memory" = its **linked personas** |
| Memories | `persona_memories` (per `persona_id`: lesson, excerpt, importance, source_post_id) | `persona/store.py::list_memories` |
| Conclusions (beliefs) | `persona_conclusions` (statement, evidence_memory_ids, confidence) | `persona/conclude.py::synthesize_conclusions` |
| Per-persona graph | `persona_edges` (`relates_to`/`builds_on`, weight) + ChromaDB `persona_memories_<id>` cosine collection (MiniLM ONNX) | `persona/graph.py` `embed_and_link`, `neighbors`, `build_edges_for_memory` |
| Palace (corpus) | ChromaDB `posts`/`paper_chunks` in `<data_dir>/palace/chroma.sqlite3` | `retrieval/palace.py` `search_posts` (cosine+BM25) |
| Knowledge blend for generation | `reply/knowledge.py::build_knowledge_context(agent_id, query)` | beliefs → semantic memories → graph neighbors → corpus excerpts |
| Generation | `reply/generate.py::generate_reply` (already threads `goal`/`product`/sub-rules), `content_*` for posts/articles | |
| Feedback | `reply/feedback.py` `reply_feedback` (engaged/dismissed) → seeds corpus → next learn picks up | `feedback_counts()`, `record_opportunity_feedback()` |
| Learn loop | `reply/learn.py::learn_for_agent` → `ingest_persona` (memories + `embed_and_link`) → `synthesize_conclusions` | |
| Draft versions | `reply_drafts` (source = `generated` / `edited`, `version`) | edit-diff signal is derivable here |

## 3. New concepts

### 3.1 Structured goal (extends the agent)
Replace the single free-text `goal` as the *source of truth* with four fields,
and **compose** the legacy `goal` string from them (so `generate.py`'s existing
`agent.get("goal")` keeps working):

- `objective` — what we're trying to achieve (e.g. "drive TestNotes signups")
- `audience` — who we're trying to reach (e.g. "students who struggle to organize notes")
- `win_signal` — what counts as a win (e.g. "reply posted + author engages / clicks")
- `guardrails` — hard limits (e.g. "never spam; always disclose; obey sub rules")

Stored as new nullable columns on `agents` (idempotent migration, mirroring the
`reply_opportunities` add-column pattern). `update_agent` allow-list gains them.
`get_brand()`/`get_agent()` compose `goal = "{objective} · for {audience} · win = {win_signal}"`
when the structured fields are present.

### 3.2 Goal Playbook (the evolving strategy)
A per-agent, versioned, structured artifact — the heart of "self-evolving."

**New table `reply_playbook`** (`reply/schema.py`):
`id` (str pk), `agent_id` (str), `version` (int), `playbook_json` (str),
`sources_json` (str — what it was built from: #memories, #conclusions, feedback
counts, edit-diff count), `summary` (str — one-line "what changed"),
`created_at` (int). Current = max version per agent; history retained.
Index `(agent_id, version)`.

**Playbook JSON shape:**
```json
{
  "winning_angles": [{"angle": "...", "why": "...", "for": "pain/audience"}],
  "phrasings":      ["openers / structures that land"],
  "avoid":          ["what got dismissed or edited away + why"],
  "per_platform":   {"reddit": "...", "x": "..."},
  "next_experiments": ["1-2 things to try next toward the win signal"]
}
```

### 3.3 Brain-like associative knowledge (accumulate · link · combine)
The agent should behave like a real brain: **never forget**, **link similar ideas
across sources the way humans do**, and **combine knowledge into new ideas**. Three
properties, all built on existing infra:

**(a) Accumulate & retain — knowledge only grows.**
Memories (`persona_memories`) and conclusions (`persona_conclusions`) already
persist across sessions and dedup on re-ingest (NOT-EXISTS), so nothing is lost.
We make retention *active*: every Learn pass re-embeds new memories into the
ChromaDB `persona_memories_<id>` collection and re-links them (`embed_and_link`),
and conclusions are *updated in place* (not duplicated) as evidence accumulates —
so a belief strengthens over time instead of fragmenting. The Goal Playbook is the
distilled "long-term strategy memory" layered on top.

**(b) Associative idea-linking — connect related ideas like a human.**
Today `persona_edges` links memories *within one persona* (`relates_to` via cosine,
`builds_on` via lineage). We extend linking to be **cross-source and cross-persona**
so the agent surfaces non-obvious connections:
- **Cross-persona linking:** when an agent has multiple linked personas (e.g. a
  "pain-listener" and a "competitor-watcher"), `evolve_playbook` runs a
  cosine pass across *all* their memory embeddings and records the strongest
  cross-persona pairs as **idea links** — "this pain (from Reddit) connects to this
  competitor gap (from a review site)." Stored as `persona_edges` rows with a new
  `kind='associates'` and a `meta` note on *why* they connect (LLM one-liner).
- **Source-blended association:** because all memories carry `source_post_id` →
  `posts.source_type`, an idea link can span data sources (reddit ↔ HN ↔ YouTube ↔
  RSS), which is exactly the "combine knowledge from data source" ask.
- Reuses the existing cosine machinery (`build_edges_for_memory`, `neighbors`),
  just widened beyond a single persona and tagged with the connection rationale.

**(c) Combine into new ideas — synthesis, not just recall.**
A human brain doesn't just retrieve; it *fuses* facts into a fresh thesis. The new
**Idea Synthesis** step (4.7) clusters associatively-linked memories+conclusions
and asks the LLM to produce **content ideas** — each idea naming the threads it
combined (e.g. "memory A + belief B + competitor note C → article: …").

## 4. Components

### 4.1 `reply/playbook.py` (new) — the self-evolving engine
- **`current_playbook(agent_id) -> dict | None`** — latest version's parsed JSON (+ meta). Cheap read for generation.
- **`evolve_playbook(agent_id, provider=None, reason="manual") -> dict`** — the engine:
  1. Load structured goal + product. If no goal/objective → `{ok:False, skipped:True, reason:"no goal set"}` (never raise).
  2. **Goal-relevant retrieval via palace + graph** (the "proper" part): for each linked persona, semantic-search its `persona_memories_<id>` ChromaDB collection using the **goal text as the query** (top-K, e.g. 8), then expand with `persona/graph.py::neighbors` (1-hop `persona_edges`). Pull all `persona_conclusions` (beliefs). Fall back to keyword retrieval if `palace.model_status()` not ready (existing fallback path in `persona/retrieve.py`).
  3. **Feedback signals:** `feedback_counts(agent_id)` (engaged/dismissed); recent engaged vs dismissed titles; **edit-diffs** = for recent opportunities, pair the newest `reply_drafts` `source='edited'` (or `status='posted'`) text with its preceding `source='generated'` text → "what the human changed" (strong signal). Derived from `reply_drafts`, no new table.
  4. **LLM distill** → the playbook JSON above, *explicitly conditioned on the goal* (objective/audience/win/guardrails). One structured-output call.
  5. Persist as `version = prev+1`; compute a one-line `summary` delta vs previous; stamp `agents.last_evolve_at`, reset `feedback_since_evolve`.
- Idempotent + fail-soft (no LLM → skip with reason; no memories → still produce a goal-only starter playbook).

### 4.2 Goal- & playbook-aware generation
- `generate_reply` and the `content_*` generators inject a **compact playbook block**
  (top 3 winning angles + the avoid list) alongside the already-present goal/product/
  sub-rules blocks. So replies, posts, and articles all write from the current strategy.
- Implemented by having generation call `current_playbook(agent_id)` and append a
  short block; `build_knowledge_context` stays as-is (knowledge), playbook is strategy.

### 4.3 Self-critique pass (Phase 1, toggleable)
After the draft is produced, **one** critic LLM call: "Does this advance the goal,
obey the guardrails + sub rules, sound human (not an ad), and respect the
playbook's avoid-list? If not, rewrite once." Controlled by a per-app setting
`OR_SELF_CRITIQUE` (default on) since it doubles the LLM call. Reuses the existing
provider chain; the revised text flows through the same `_persist_draft` + compliance.

### 4.4 Evolution triggers (auto + manual)
- **After Learn:** `learn_for_agent` tail calls `evolve_playbook(agent_id, reason="learn")` when a goal is set and new memories/conclusions were produced.
- **After N feedback events:** `record_opportunity_feedback` and reply status changes increment `agents.feedback_since_evolve`; when it crosses a threshold (default 5) → `evolve_playbook(reason="feedback")`.
- **Manual:** new `agent_evolve` command + an **"Evolve now"** button.

### 4.5 Associative knowledge linking (brain-like) — `persona/graph.py` extension
- New edge `kind='associates'` on `persona_edges` for **cross-persona / cross-source**
  links (today's `relates_to` is within one persona). `link_associations(agent_id)`:
  gather every linked persona's memory embeddings, cosine-match the strongest pairs
  *across* personas/sources (threshold ~0.45, cap per memory), and for the top pairs
  ask the LLM a one-line *why they connect*; store as `associates` edges with the
  rationale in `meta`. Called inside `evolve_playbook` so links refresh with learning.
- Read side: extend `neighbors()` to optionally include `associates` edges so
  retrieval and synthesis can walk cross-source connections.

### 4.6 Idea Synthesis & article suggestions — `reply/ideas.py` (new)
The "combine knowledge → suggest articles" engine.
- **New table `reply_ideas`**: `id`, `agent_id`, `title`, `thesis`, `kind`
  (`article`|`post`|`thread`), `combines_json` (the memory/conclusion/source threads
  it fuses), `goal_fit` (float), `status` (`suggested`|`used`|`dismissed`),
  `created_at`. Index `(agent_id, status)`.
- **`suggest_ideas(agent_id, n=5, provider=None) -> dict`**: cluster the
  associatively-linked memories + conclusions (union-find over `relates_to` +
  `associates` edges, like `synthesize_conclusions` already does), then per cluster
  ask the LLM for a **content idea** that *combines* the threads, each tagged with:
  the source mix it draws from (data-source / conclusion / mixed), which memories &
  beliefs it fuses, and a `goal_fit` score. Fail-soft (no LLM → skip; no clusters →
  `{ideas: []}`).
- **`draft_from_idea(idea_id, kind, platform, provider=None)`**: hands the idea's
  thesis + combined threads to the existing `content_generate` path so an idea
  becomes a real post/thread/article — written from the goal + playbook, grounded
  in the fused knowledge.
- This is where "suggest article combining knowledge from data source, conclude, or
  mixed, and link similar ideas the way humans do" lives.

### 4.7 UI
- **Agent edit screen** (`renderKeywords`): add the 4 structured goal fields (Objective / Audience / Win signal / Guardrails). Saved via `agentUpdate`.
- **Strategy panel** (on the Learning screen, or a new "Evolution" tab): show the
  current playbook (winning angles · avoid · next experiments), freshness
  ("evolved 2h ago · 3 feedback since"), an **"Evolve now"** button, and version
  history. Skeletons per the existing pattern.
- **Idea board** (Compose screen / Knowledge screen): a list of **suggested ideas**,
  each showing its title, thesis, the threads it combines (with source badges:
  reddit / HN / belief / competitor), and goal-fit. Buttons: **"Draft this"**
  (→ `draft_from_idea` → Compose) and dismiss. A "Suggest ideas" refresh button.
- **Connections view (light):** on the Knowledge screen, show the top `associates`
  links ("idea A ↔ idea C — because …") so the user *sees* how the brain connected
  things. Read-only list (no heavy graph canvas in Phase 1).
- **Drafts:** a small "written from playbook v{n}" note.

### 4.8 Command triangle (new commands)
`agent_evolve` (CLI `reply evolve --json` → `evolve_playbook`),
`agent_playbook_get` (read current), `agent_ideas` (`reply ideas --json` →
`suggest_ideas`), `agent_idea_draft` (`reply idea-draft` → `draft_from_idea`),
`agent_idea_status` (mark used/dismissed). Register each in `commands.rs` +
`main.rs` `generate_handler!` + `or/api.js` wrappers (`api.agentEvolve`,
`api.agentPlaybook`, `api.agentIdeas`, `api.agentIdeaDraft`, `api.agentIdeaStatus`).

## 5. Data flow (the evolving loop)
```
fetch (refresh_agent → collect → palace upsert)
  → learn_for_agent → ingest_persona (memories + embed_and_link graph)
                    → synthesize_conclusions (beliefs)
  → link_associations(agent)   # cross-persona/cross-source idea links (associates edges)
  → evolve_playbook(reason="learn")
       ├─ palace semantic search (goal as query) over persona_memories_<id>
       ├─ persona graph neighbors (persona_edges: relates_to + associates)
       ├─ conclusions (beliefs)
       └─ feedback (engaged/dismissed + edit-diffs from reply_drafts)
       → LLM distill → reply_playbook v(n+1)
  → suggest_ideas(agent)        # cluster linked memories+beliefs → article/post ideas (reply_ideas)

generate_reply / content_*  ← current_playbook(agent_id) + goal + product + sub-rules + knowledge
   → self-critique (optional) → draft

draft_from_idea(idea)  → content_generate (thesis + fused threads + goal + playbook) → draft

user posts / edits / dismisses → reply_feedback + reply_drafts(edited)
   → feedback_since_evolve++ → (threshold) → evolve_playbook(reason="feedback")
```
Knowledge is **append-only** (memories/conclusions persist + dedup), links **accrue**
(`relates_to`/`builds_on`/`associates`), and strategy + ideas **re-distill** as the
brain grows — so suggestions get better and more cross-connected over time.

## 6. Phasing
- **Phase 1a — goal & strategy:** structured goal model + `reply/playbook.py`
  engine (palace+graph+conclusions+feedback+edit-diffs) + goal/playbook-aware
  generation + self-critique (toggle) + auto/manual evolution + goal-fields UI +
  command triangle.
- **Phase 1b — brain (this addition):** `associates` cross-persona/cross-source
  links in `persona/graph.py`; `reply/ideas.py` (`suggest_ideas`, `draft_from_idea`)
  + `reply_ideas` table; Idea board + Connections UI; wired into the evolve loop.
  Builds directly on 1a's retrieval, so it ships right after.
- **Phase 2 (follow-on):** real engagement metrics (mark a reply posted → later
  fetch its upvotes/replies → feed top performers into the playbook + idea ranking)
  and playbook/idea-example embedding retrieval. Deferred because it needs
  published-post tracking, which fights the manual-post model.

## 7. Error handling & cost
- Every new function is **fail-soft** (returns a status dict, never raises) —
  matches the existing learn/feedback style.
- No LLM configured → evolve/critique skip with `{skipped:True, reason}`.
- Palace model not ready → keyword-retrieval fallback (existing).
- Cost guard: self-critique behind a setting; evolution debounced (won't run twice
  within N seconds; respects the daemon-lock-timeout fallback).

## 8. Testing
- `evolve_playbook`: mock provider returns structured JSON → row persisted, version increments; no-goal → skipped; no-memories → starter playbook; no-LLM → skipped.
- Goal migration is idempotent (run twice, columns once).
- `current_playbook` returns latest version; generation prompt includes the block when present, omits cleanly when absent.
- Edit-diff pairing returns (generated, edited) for an opportunity with both.
- Composed `goal` string is non-empty when structured fields are set.
- `link_associations`: two memories from different personas above threshold → an `associates` edge with a rationale; below threshold → none.
- `suggest_ideas`: clusters with linked memories+beliefs → ideas tagged with their combined threads + source mix; no clusters → `{ideas: []}`; no-LLM → skipped.
- `draft_from_idea`: produces a draft that references the idea's fused threads, written through `content_generate`.

## 9. Open decisions (default chosen; flag if you disagree)
- Feedback→evolve threshold: **5** events (configurable).
- Self-critique: **on** by default (1 extra LLM call) — toggle in Settings.
- Playbook retrieval K: **8 memories/persona** + 4 neighbors (mirrors `build_knowledge_context`).
- Structured goal stored as **columns** (not JSON blob) for queryability + simplest migration.
