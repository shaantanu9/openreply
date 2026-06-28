# Self-learning agent — close the autonomous loop

**Date:** 2026-06-27
**Type:** Feature

## Summary

All the learning *components* already existed (persona ingest → memories with
`evolves_from` lineage → automatic semantic graph edges → conclusion synthesis →
knowledge blend into content), but the loop was **manually triggered** and never
closed: nothing auto-ingested after a fetch, nothing auto-synthesized, and the
opportunity lifecycle never fed back. This wires the full autonomous loop —
**fetch → learn → connect → believe → write**, with the save/reply/dismiss signal
feeding back — plus a Learning UI surfacing what the agent knows.

## Changes

- **Core learn module** `reply/learn.py`:
  - `ensure_learning_persona(agent)` auto-creates + links a niche-expert persona when
    an agent has none, so learning works out-of-the-box.
  - `learn_for_agent(...)` drains `ingest_persona` (dedups via NOT-EXISTS) then, when
    new memories landed, `synthesize_conclusions(refresh=True)`; stamps
    `agents.last_learn_at`. Never raises; no LLM cost when nothing is new.
  - `learning_summary(...)` → memories/beliefs/feedback counts + recent lessons/beliefs.
- **Feedback loop** `reply/feedback.py` + `reply_feedback` table (`schema.py`):
  - `record_opportunity_feedback(id, engaged|dismissed)`. **engaged** (Saved/Replied)
    upserts the post into `posts` + tags it to the agent topic, so the next learn pass
    distills it — engaging *is* the "learn from this" vote. **dismissed** is recorded
    to suppress.
  - `dismissed_post_ids()` / `feedback_counts()`.
- **Hooks**: `opportunity.set_status` records engaged/dismissed; `find_opportunities`
  drops dismissed `post_id`s so they never resurface.
- **Triggers (all three):**
  - *After every agent fetch:* `agent.refresh_agent` runs `learn_for_agent` after collect
    (returns a `learning` block).
  - *On schedule:* `cli schedule-tick` learns for agents whose topic matches each
    scheduled collect.
  - *Manual:* `openreply agent learn` / `learn-status`.
- **Stack**: `agent learn` + `learn-status` CLI; Rust `agent_learn` / `agent_learn_status`
  (+`main.rs` register); `api.agentLearn` / `agentLearnStatus`.
- **UI**: new **Learning** screen (`renderLearning`, sidebar + route `learning`) — memory/
  belief/feedback KPIs, last-learned, recent lessons + beliefs, and a **🧠 Learn now**
  button; Overview gains **↻ Refresh + learn** and a **Learn** button.
- `agents.last_learn_at` column (migration in `reply/agent.py`).

## Verification

- All 7 Python files parse; functional wiring test: agent auto-provisions a learning
  persona + link; `learn_for_agent` runs gracefully with no new data; feedback engaged →
  post seeded into `posts`, dismissed → in suppression set; `feedback_counts` /
  `learning_summary` shapes correct.
- `vite build` passes (202 KB).
- `cargo check`: my command additions mirror the already-compiling `creds_toggle` /
  `reply_set_status` pattern. (The current `cargo check` fails on a pre-existing,
  environmental build-script glob — `binaries/openreply-cli-onedir/**/*` not present in this
  checkout — unrelated to these changes.)

## Files Created

- `src/openreply/reply/learn.py`, `src/openreply/reply/feedback.py`
- `docs/superpowers/specs/2026-06-27-self-learning-loop-design.md`

## Files Modified

- `reply/schema.py` (reply_feedback), `reply/agent.py` (refresh chains learn + last_learn_at),
  `reply/opportunity.py` (feedback hooks), `cli/agent_cmds.py` (learn/learn-status),
  `cli/main.py` (schedule-tick learns), `src-tauri/src/commands.rs` + `main.rs`
  (agent_learn/agent_learn_status), `or/api.js`, `or/dynamic.js` (Learning screen + Overview),
  `or/shell.js` (nav).

## Follow-up

- Prod sidecar rebuild before a DMG (dev `.venv` has it now).
- Auto-learn LLM cost is capped (`ingest_limit=30`, dedup, synthesize only on new memories).
- Future: semantic down-weighting of posts *similar* to dismissed (we suppress exact
  post_id now); memory decay / re-embedding.
