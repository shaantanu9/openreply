# OpenReply — master learnings doc + crawl4ai research tooling

**Date:** 2026-06-27
**Type:** Documentation | Infrastructure

## Summary

Captured all session learnings into a single detailed knowledge base and adopted
crawl4ai (Playwright-based crawler) as the standard tool for further web research,
since competitor sites (ReplyDaddy, Reppit) are JS-rendered and static fetch returns
nothing.

## Changes

- Wrote `docs/OPENREPLY_LEARNINGS.md`: product definition, ReplyDaddy + alternatives
  research, Reddit palette decision, the Agent model, UX/flow decisions, build state,
  technical gotchas, crawl4ai usage, and next steps.
- Installed `crawl4ai` into the project `.venv` for rendered-page research.

## Files Created
- `docs/OPENREPLY_LEARNINGS.md`
- `changelogs/2026-06-27_03_openreply-learnings-and-crawl4ai.md`
