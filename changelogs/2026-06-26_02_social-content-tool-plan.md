# Social Content Tool — Build & Migration Plan

**Date:** 2026-06-26
**Type:** Documentation

## Summary

Authored a detailed, self-contained plan for forking the Gap Map (reddit-myind) Tauri 2
+ Python-sidecar architecture into a NEW repo for a social-media content-creation tool.
The plan specifies the exact file manifest to copy (copy-as-is / copy-and-trim / do-not-copy),
the target repo structure, the new outbound `publish/` layer and `drafts`/`publish_log`
data model, phased milestones (M0 scaffold → M1 one-platform end-to-end → scheduling →
generation → more platforms → metrics), an identity-rename checklist, exact git commands
to init the repo and connect a GitHub remote, risks/failure modes, and which skills to
invoke. Default decisions (fork-and-strip, X-first, keep the Python sidecar, keep vanilla
JS) are listed as overridable open decisions.

## Changes

- Added the migration/build plan with a concrete file-copy manifest tied to the reuse map
- Defined new SQLite tables (`drafts`, `publish_log`) and the `post_<platform>()` outbound contract
- Defined the new `content`/`publish` CLI groups and `start_publish`/`draft_*` Tauri commands
- Provided exact `git init` + `gh repo create` + `git push` commands for the new repo
- Listed risks (cookie fragility, API approval lag, sidecar signing, media upload, idempotency) and skills to invoke

## Files Created

- `SOCIAL_CONTENT_TOOL_PLAN.md` — the plan (root-level for easy copy into the new repo)
- `changelogs/2026-06-26_02_social-content-tool-plan.md` — this entry
