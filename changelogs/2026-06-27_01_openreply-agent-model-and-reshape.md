# OpenReply — Agent DB model + UI reshape (phase 1)

**Date:** 2026-06-27
**Type:** Feature + Refactor + Documentation

## Summary

Ran the app to confirm it works (Tauri + Vite + Python sidecar all boot; ~194.6k posts
indexed; research/product dashboard loads), did a full frontend audit (nav, 85 screens,
routes, onboarding, settings), then executed phase 1 of the ReplyDaddy-clone reshape:
added the Agent (persona) DB model and wired the reply engine to it, generated content
from agent knowledge, and trimmed the sidebar to the OpenReply surface.

## Changes

- **DB (additive):** new `agents` and `content_items` tables + `reply_state` (active
  agent pointer). The reply engine (`opportunity`/`generate`) now reads the active agent
  via a refactored `brand.py` shim, so opportunities/drafts are agent-scoped.
- **Agent engine:** `reply/agent.py` (CRUD, active pointer, knowledge summary, refresh
  via `research.collect`) and `reply/content.py` (generate post/thread/script/article
  from agent voice + corpus excerpts → `content_items`). New `openreply agent` and
  `openreply content` CLI groups. Tested end-to-end (agent create/list/knowledge; content
  generate produced a real draft via the configured LLM).
- **UI reshape:** hid 15 off-mission sidebar items in `app-tauri/index.html` (Products,
  Competitors, Ingest-Video, Reports, Provenance, Science, Playbook, OST, Empathy,
  Interviews, PMF, Pricing, Launch, Improve, Iterate). Routes untouched (reversible).
- **Reshape plan:** `docs/OPENREPLY_RESHAPE.md` — file-level keep/hide/delete across
  screens, backend modules, sources, and DB tables, with a 4-phase safe execution order.

## Files Created

- `src/openreply/reply/agent.py`, `src/openreply/reply/content.py`
- `src/openreply/cli/agent_cmds.py`
- `docs/OPENREPLY_RESHAPE.md`
- `changelogs/2026-06-27_01_openreply-agent-model-and-reshape.md`

## Files Modified

- `src/openreply/reply/{brand,opportunity,__init__}.py` — agent-scoping
- `src/openreply/cli/main.py` — register `agent` + `content` groups
- `app-tauri/index.html` — hide off-mission nav items
