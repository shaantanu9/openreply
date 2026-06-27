# crawl4ai research — ReplyDaddy verbatim findings

**Date:** 2026-06-27
**Type:** Documentation | Research

## Summary

Ran the first crawl4ai-powered competitor research. ReplyDaddy/Reppit are JS SPAs that
static fetch couldn't read; crawl4ai with browser simulation (magic + simulate_user +
scan_full_page) rendered ReplyDaddy's full site. Captured exact positioning, the 5-step
flow, 6 named features, proof stats, FAQ facts, and full pricing — and confirmed their
brand color is #FF4500 (Reddit orange), validating our palette.

## Changes

- Enriched `docs/OPENREPLY_LEARNINGS.md` with a verbatim, crawl4ai-verified ReplyDaddy
  section + OpenReply differentiation (open-source + BYOK ⇒ no scan/post caps; multi-platform).
- Saved raw crawls to `docs/research/replydaddy.md` and `docs/research/replyguy.md`.
- Added `scripts/crawl_research.py` — reusable SPA-friendly crawler; the standard tool
  for future OpenReply market research.

## Files Created
- `docs/research/replydaddy.md`, `docs/research/replyguy.md`
- `scripts/crawl_research.py`
- `changelogs/2026-06-27_04_crawl4ai-replydaddy-research.md`

## Files Modified
- `docs/OPENREPLY_LEARNINGS.md`
