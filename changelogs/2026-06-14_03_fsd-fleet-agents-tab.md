# FSD Fleet — Agent Memory overlay ("Agents" tab) (Phase 2)

**Date:** 2026-06-14
**Type:** Feature

## Summary

Phase 2 of the FSD Fleet roadmap (`docs/specs/FLEET_AGENTS_TOPIC_MAP.md`): a new
per-topic **Agents** tab in the topic view that surfaces what each persona/agent
has *learned* about the current topic. Pure surfacing of the existing persona
system — no new backend. Each agent card shows its lens, the lessons it
remembers on this topic (cited back to source posts, with an importance bar),
its distilled beliefs (conclusions with confidence), and cross-agent
divergences (share rejections — where one lens contradicts another). A
"Learn this topic" / "Re-learn" button teaches an agent the topic's posts via
the existing `personaIngest` flow.

## Changes

- New self-contained `app-tauri/src/screens/agentsTab.js` (`loadAgents`):
  lists personas (`api.personaList`), pulls each one's topic-scoped memories
  (`api.personaMemories(id, {topic})`) in parallel, then conclusions +
  rejections only for agents that learned the topic; agents who learned the
  topic sort first. "Learn this topic" calls `api.personaIngest({personaId,
  topic})` and refreshes.
- `topic.js`: import `loadAgents`, register the `agents` loader, add the
  **Agents** tab button (between Conclusions and AI Analyses).
- `style.css`: agent-card grid + memory/conclusion/rejection styles.

All plumbing (CLI `persona memories/conclusions/rejections/ingest`, Rust
`persona_agent_*` commands, `api.persona*`) already existed — Phase 0 for
personas was complete, so this is frontend-only.

## Verification

- `node --check` on the new module; `npm run build` clean; `npm test` 52/52.

## Files Created

- `app-tauri/src/screens/agentsTab.js`

## Files Modified

- `app-tauri/src/screens/topic.js` — import + loader + tab button.
- `app-tauri/src/style.css` — Agents overlay styles.
- `FEATURES.md` — category 7 entry.
