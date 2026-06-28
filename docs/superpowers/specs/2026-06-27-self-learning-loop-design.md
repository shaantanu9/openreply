# Self-Learning Agent — close the autonomous loop

**Date:** 2026-06-27
**Status:** Approved (all triggers + feedback loop + full UI) — implementing

## Problem

All learning *components* are real and work: `persona/ingest.py` distills posts →
memories (with `evolves_from` lineage), `persona/graph.py` auto-embeds + builds
semantic edges, `persona/conclude.py` synthesizes beliefs, `reply/knowledge.py`
blends beliefs+memories+graph+corpus into content. But the loop is **manually
triggered** — nothing auto-ingests after a fetch, nothing auto-synthesizes, and the
opportunity lifecycle (save/reply/dismiss) never feeds back. The maintenance layer
(launchd `schedule.rs` → `schedule-tick` → collect; Rust `ExtractionWorker`) runs
collection/findings but never the persona learning loop.

## Design — one learn() the triggers call, plus a feedback loop

### 1. Core learning module — `reply/learn.py`
- `ensure_learning_persona(agent)` → if the agent has no linked persona, auto-create
  one (`create_persona` name=`<agent> — niche`, goal/lens from the agent) and
  `link_persona` it (weight 1). Makes the loop work out-of-the-box.
- `learn_for_agent(agent_id=None, *, ingest_limit=30, synthesize=True, provider, progress)`:
  for each linked persona drain `ingest_persona(topic=agent.topic, limit)` (already
  dedups via NOT-EXISTS), then if new memories and `synthesize` drain
  `synthesize_conclusions(refresh=True)`. Stamp `agents.last_learn_at`. Returns a
  summary (per-persona learned/beliefs counts). Never raises.
- `learning_summary(agent_id=None)` → memories, beliefs, feedback counts, last_learn_at,
  recent lessons + beliefs (for the UI).

### 2. Feedback loop — `reply/feedback.py` + `reply_feedback` table
- `record_opportunity_feedback(opportunity_id, signal)` (`engaged` | `dismissed`):
  - **engaged** (Saved / Replied): upsert the opportunity's post into `posts` + tag to
    the agent topic so the next ingest distills it into a (high-value) memory — engaging
    *is* the "learn from this" signal, reusing existing ingest.
  - **dismissed** (Dismiss): write a `reply_feedback` row used to suppress.
- `dismissed_post_ids(agent_id)` → set; `feedback_counts(agent_id)`.

### 3. Hooks
- `opportunity.set_status`: saved/posted → `record_opportunity_feedback(engaged)`;
  skipped → `dismissed`. Best-effort, never breaks the status update.
- `opportunity.find_opportunities`: drop candidates whose `post_id` ∈ dismissed set
  (dismissed conversations stop resurfacing — a real feedback effect).

### 4. Triggers (all three)
- **After every (agent) fetch:** `agent.refresh_agent` → after collect, `learn_for_agent`.
  (Generic research collects stay learning-free by design — agent fetch = refresh.)
- **On schedule:** `cli schedule-tick` → after each scheduled topic's collect, learn for
  agents whose topic matches.
- **Manual:** `openreply agent learn` → Rust `agent_learn` → JS `agentLearn()` → a
  "🧠 Learn now" button.

### 5. CLI / Rust / JS
- `agent learn` + `agent learn-status` (`agent_cmds.py`).
- `agent_learn` + `agent_learn_status` (`commands.rs` + `main.rs`).
- `api.agentLearn()` / `api.agentLearnStatus()` (`or/api.js`).

### 6. UI — a Learning surface
- New `renderLearning` view (route `learning` + sidebar link): memories / beliefs /
  feedback counts, last-learned, recent lessons + beliefs, and a **🧠 Learn now** button
  (with progress). Add **🧠 Learn now** to the Overview next to "Refresh knowledge".

## Cost guard
Auto-learn caps `ingest_limit` (default 30) and only ingests NEW posts; synthesize only
runs when new memories landed. No new LLM cost when there's nothing new.

## Out of scope (future)
- Semantic down-weighting of posts *similar* to dismissed (we suppress exact post_id now).
- Memory decay / re-embedding.
- Persona `product/brand` field (separate gap).

## Verify
- `learn_for_agent` round-trip on a test agent (ingest→memory→synthesize→belief).
- set_status engaged → post appears in corpus; dismissed → suppressed from find.
- CLI `agent learn` / `learn-status` JSON; vite build; cargo check.
