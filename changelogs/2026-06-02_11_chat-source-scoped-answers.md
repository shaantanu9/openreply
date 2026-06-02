# Chat — source-scoped answers ("what do papers/news/users/app reviews say")

**Date:** 2026-06-02
**Type:** Feature

## Summary

Chat can now answer scoped to a specific source family. Asking "what do the
research papers say", "what does the news say", "what do users reply", or "what
do app reviews complain about" now grounds the answer ONLY on that source's
evidence instead of a relevance-ranked mix dominated by Reddit.

## Changes

- `src/gapmap/research/chat.py`:
  - Added `_SOURCE_FAMILIES` mapping DB `source_type` values into families
    (research papers · news · app store reviews · developer sources · video ·
    community discussion) with trigger keywords.
  - Added `_detect_source_intent(question)` — keyword-scored, returns the target
    family or None.
  - `_topic_context()` now scopes evidence to the detected family: filters the
    semantic/engagement posts to those source types and tops up from SQL when
    under-represented; sets an "Evidence — scoped to <family>" heading and a
    "⚠ Source scope" instruction so the LLM answers from that source only (or
    says plainly when the topic has no data from it).

## Verification

- Detector returns correct families for papers/news/users/app-reviews/github/
  youtube; generic questions return None (no scoping).
- On a 16-source topic: "research papers" → citations all `openalex`;
  "app reviews complain" → citations all `appstore`/`playstore`.
