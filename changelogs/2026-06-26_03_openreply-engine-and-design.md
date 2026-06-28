# OpenReply — Reply Engine + Product Design (Topic → Agent)

**Date:** 2026-06-26
**Type:** Feature + Documentation

## Summary

Started the open-source ReplyDaddy-style pivot on the `open-reply` branch. Researched
ReplyDaddy + Reppit (Reddit marketing co-pilots) and built a working multi-platform
"reply co-pilot" engine that reuses the existing fetch + LLM + credentials layers, then
authored the product design that reframes the app's central "topic" into an **Agent**
(brand/niche persona) and lays out the full user journey, page inventory, and a concrete
keep/remove/repurpose plan now that the app's role has changed from market research to
social content creation.

## Changes

- New `src/openreply/reply/` engine: brand/persona profile, pickable platform catalog
  (Reddit, X, LinkedIn, HN, news, … — engage vs discovery-only), opportunity find+score
  (relevance/intent/fit via BYOK LLM with heuristic fallback), value-first reply
  generation, and subreddit-rule compliance ("ban-proof") — all persisted to new
  `reply_*` SQLite tables in the shared openreply.db.
- New `openreply reply` CLI group (`platforms`, `brand-set/get`, `find`, `list`, `draft`,
  `rules`) wired into `cli/main.py`; all `--json`. Tested end-to-end (pulled real Reddit
  posts via the RSS fallback; clean error handling).
- Design doc: Topic→Agent reframe, agents/content_items data model, end-to-end user
  journey, 11-page inventory, and a keep/remove/repurpose breakdown (removes papers,
  academic mode, product mode, consultancy artifacts, econ/market sources, research
  exports — keeping the social/news fetch + graph + LLM + connections core).

## Files Created

- `src/openreply/reply/{__init__,util,schema,platforms,brand,opportunity,rules,generate}.py`
- `src/openreply/cli/reply_cmds.py`
- `docs/OPENREPLY_DESIGN.md`
- `changelogs/2026-06-26_03_openreply-engine-and-design.md`

## Files Modified

- `src/openreply/cli/main.py` — register the `reply` Typer group
