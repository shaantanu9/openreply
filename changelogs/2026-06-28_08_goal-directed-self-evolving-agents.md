# Goal-Directed, Self-Evolving Agents (Phase 1)

**Date:** 2026-06-28
**Type:** Feature

## Summary

Each agent can now carry a **structured goal** and grows a **self-evolving Goal
Playbook** — a living promotion strategy distilled from its memory (persona
ChromaDB embeddings + graph), its conclusions, and the feedback on every
reply/post (engaged/dismissed + human edit-diffs). Generation (replies, posts,
articles) writes from the playbook + goal, with an optional self-critique pass.
The agent also links ideas **across data sources** (`associates` edges) and
**synthesizes content ideas** that combine those threads. Built entirely on the
existing personas/memories/conclusions + palace + `persona_edges` stack.

## Changes

- **Structured goal** on `agents`: `objective`, `audience`, `win_signal`,
  `guardrails` (+ `last_evolve_at`, `feedback_since_evolve`). `get_agent`
  composes a `goal` string from them. (`reply/agent.py`)
- **`reply_playbook` + `reply_ideas` tables** (`reply/schema.py`).
- **Goal Playbook engine** (`reply/playbook.py`): `evolve_playbook` (goal-as-query
  semantic retrieval over each linked persona + conclusions + feedback +
  edit-diffs → LLM-distilled versioned strategy), `current_playbook`,
  `playbook_block`. Fail-soft.
- **Playbook-aware generation + self-critique** (`reply/generate.py`,
  `reply/content.py`): inject goal + product + playbook; one critic rewrite pass
  (toggle `OR_SELF_CRITIQUE`).
- **Cross-source associative links** (`persona/graph.py`): `link_associations`
  (`associates` edges across the agent's personas with an LLM rationale in
  `meta`), `list_associations`, and `neighbors(... include_associates=)`.
- **Idea synthesis** (`reply/ideas.py`): `suggest_ideas` (cluster linked
  memories+beliefs → content ideas tagged with source-mix + goal-fit),
  `draft_from_idea`, `list_ideas`, `set_idea_status`.
- **Auto-evolve triggers** (`reply/learn.py`, `reply/feedback.py`): after a learn
  pass (+ associate-link) and after 5 feedback events.
- **CLI** (`cli/reply_cmds.py`): `goal-set`, `playbook`, `evolve`, `ideas`,
  `idea-draft`, `idea-status`.
- **Command triangle**: `agent_goal_set/playbook_get/evolve/ideas/idea_draft/idea_status`
  in `commands.rs` + `main.rs`, wrappers in `or/api.js`.
- **UI** (`or/dynamic.js`): Goal fields on the agent edit screen; Strategy
  playbook panel ("Evolve now") + Idea board ("Suggest ideas" / "Draft this")
  on the Learning screen.

## Files Created

- `src/openreply/reply/playbook.py`, `src/openreply/reply/ideas.py`
- `tests/test_agent_goal.py`, `tests/test_playbook.py`, `tests/test_associations.py`, `tests/test_ideas.py`
- `docs/superpowers/specs/2026-06-28-goal-directed-self-evolving-agents-design.md`
- `docs/superpowers/plans/2026-06-28-goal-directed-self-evolving-agents.md`

## Files Modified

- `src/openreply/reply/{agent,schema,generate,content,learn,feedback}.py`
- `src/openreply/persona/graph.py`
- `src/openreply/cli/reply_cmds.py`
- `app-tauri/src-tauri/src/{commands.rs,main.rs}`
- `app-tauri/src/or/{api.js,dynamic.js}`

## Verification

- 10 unit tests pass (`tests/test_agent_goal.py test_playbook.py test_associations.py test_ideas.py`).
- `cargo check` clean (JWT debug-fallback warning only); `vite build` succeeds.
- Phase 2 (real engagement metrics from published posts) intentionally deferred.
