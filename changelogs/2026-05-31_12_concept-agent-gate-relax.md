# Concept Agent: relax the over-restrictive painpoint gate

**Date:** 2026-05-31
**Type:** Fix

## Summary

The Concepts tab refused to generate product concepts for any topic with fewer
than 2 painpoints — showing "Only N painpoints for this topic. Run gap
extraction first." But the Concept Agent reads painpoints **+ sentiment +
workarounds**, and there's a deterministic fallback that works from
painpoints + workarounds. So a topic with 1 painpoint, 2 workarounds,
sentiment, and a full corpus (e.g. "Indian community help app") had plenty to
work with but was hard-blocked. This is the same over-gating anti-pattern as
the Chat tab ("gap map not built yet" on a 7,000-post topic) — gate on *is
there a corpus*, never on *have we extracted exactly N findings*.

## Changes

- `concept.py::concepts_for_topic` — moved the sentiment + workarounds fetch
  above the gate and changed the gate from `len(pps) < 2` to
  `len(pps) + len(was) == 0`. Concepts now generate whenever there's at least
  one painpoint OR one workaround; the block only fires for a truly empty
  topic. Updated the `reason` copy accordingly.

## Files Modified

- `src/openreply/research/concept.py`

## Verification

- `python -m py_compile src/openreply/research/concept.py` ✅
- For topic "Indian community help app" (1 painpoint, 2 workarounds): old gate
  `< 2 painpoints` → BLOCKED; new gate `pps+was==0` → PASS. The Concept Agent
  now runs (LLM + deterministic fallback) instead of showing the block.

## Note

Python sidecar change — takes effect after the dev app / Python daemon
restarts, and ships to the prod DMG with the next sidecar rebuild
(`pyinstaller` → copy → codesign).
