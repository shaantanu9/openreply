# Personal Brand Mode — Design & Working Spec

**Date:** 2026-06-30
**Type:** Documentation

## Summary

Captured a deep, pre-MVP design/working spec for repurposing OpenReply (today a *product*
social-marketing co-pilot) into a tool that also manages a *person's* brand. The core finding:
this is ~80% reframing + ~20% net-new — the engine already does multi-source listening,
persona learning, opportunity→draft→post, content generation, scheduling, and delivery. The
spec lays out the four pillars (Voice/Identity "You-Agent", Show up & post consistently, Join
the right conversations, Track reputation & mentions), the data-model additions, the MVP line,
a phased roadmap, and authenticity/reputation guardrails — so work can continue after MVP.

## Changes

- Documented the brand-as-product → brand-as-person reframing and why the existing
  `personas` schema already supports a person-shaped agent.
- Mapped each pillar to existing code (`persona/store.py`, `ingest.py`, `conclude.py`,
  `reply/opportunity.py`, `reply/rank.py`, §21 content engine, `reply/poster.py`, GEO,
  Telegram delivery) vs. clearly-marked net-new work.
- Proposed 4 additive tables: `brand_profiles`, `content_ideas`, `brand_targets`, `brand_mentions`.
- Defined MVP (Pillars 1+2 + minimal 3) vs. after-MVP scope, a P0–P5 roadmap, risks, and 6 open questions.

## Files Created

- `docs/specs/PERSONAL_BRAND_MODE.md` — the full design/working spec
- `changelogs/2026-06-30_14_personal-brand-mode-design-spec.md` — this entry

## Files Modified

- None
