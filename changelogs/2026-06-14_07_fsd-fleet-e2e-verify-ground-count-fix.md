# FSD Fleet — real-LLM end-to-end verification + ground-count fix

**Date:** 2026-06-14
**Type:** Fix / Verification

## Summary

Ran the full agent/debate/fleet flow end-to-end against a **live LLM** (NVIDIA
OpenAI-compatible provider) on a seeded 12-post / 3-source corpus, in an isolated
temp data dir (no impact on the real DB). Confirmed every stage works and fixed
one cosmetic counting bug found in the process.

## What was verified (live)

- **Synthesize** → real findings from the LLM.
- **Decision gate / route plan** → correct simple/complex classification + route
  recommendation.
- **Deep fleet flow** end to end: clarify → ground → synthesize → debate → audit,
  with the streaming `on_stage` callback firing per stage.
- **Real 5-persona debate** → verdicts tiered, **4-turn transcript with genuine
  per-persona rationales** persisted (validates the LLM debate path and the
  earlier `persona_conclusions` fix live, not just via the fake-provider test).
- **Agent grounding** → persona ingest created memories cited to source posts.
- **Audit / verdicts / lineage / cost / fleet-status** all persisted and
  round-tripped cross-call.
- **Graceful degradation** → on a run where the (free) model returned 0 findings,
  the flow reported synthesize=attention, debate=needs_synthesis, audit=skipped,
  and still completed `done` without crashing.

## Fix

- `fleet_flow._stage_ground` counted a non-existent `added` field on ingest
  events, so a successful grounding reported "+0 memories" even when memories
  were created. Now counts `event:"memory"` events (per new lesson) and
  `event:"done"` events (per agent): reports `N agent(s) grounded (+M memories)`.
  Verified: a clean run reported `2 agent(s) grounded (+24 memories)`.

## Known non-fatal noise (pre-existing, not introduced here)

During persona ingest the persona-graph step logs `An instance of Chroma already
exists … with different settings` even under `GAPMAP_SKIP_PALACE=1`. It's caught
and best-effort (memories are still created with `edges_added=0`). Lives in the
persona-graph/palace interplay, not the fleet flow — left as-is to avoid
destabilizing that subsystem.

## Files Modified

- `src/gapmap/research/fleet_flow.py` — correct ground-stage memory/agent count.
