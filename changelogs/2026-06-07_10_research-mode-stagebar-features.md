# Research Mode — workspace stage-bar + FEATURES.md

**Date:** 2026-06-07
**Type:** Feature + Documentation

## Summary

Adds the Gather→Read→Synthesize→Write **stage spine** above the project tabs
(research mode only, pure anchor links — CSP-safe, no event wiring, hidden in
product mode), and documents the full Research Mode suite in FEATURES.md
(new section 19 + persistence + R4 reading surface flipped to ✅ via the Reader).

## Changes

- **`screens/topic.js`**: `researchStageBar(topic)` rendered above `#topic-tabs`
  in research mode — links to #/research, #/library, #/lit-matrix/<topic>,
  #/write/<topic>.
- **FEATURES.md**: new "## 19. Research Mode" section (App Mode, Reader, reading
  status, highlights/notes, lit-matrix, Write, Library, cited Q&A) with file:line
  surfaces + known gaps; persistence summary updated with the 5 new tables;
  removed the now-shipped R4 student-reading gap.

## Files Created
- `changelogs/2026-06-07_10_research-mode-stagebar-features.md`

## Files Modified
- `app-tauri/src/screens/topic.js`, `FEATURES.md`
