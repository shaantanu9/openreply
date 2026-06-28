# Wire Alerts + AI Visibility (GEO) — 15/15 screens live

**Date:** 2026-06-27
**Type:** Feature

## Summary
Added the last two backend stores and wired the final two screens, bringing OpenReply to
15/15 screens functional (UI → invoke → CLI → reply_* DB).

## Changes
- Engine: `reply/alerts.py` (reply_alerts table — rule store + matcher) and
  `reply/geo.py` (geo_queries table — tracked queries + citation rate).
- CLI: `openreply reply alert-list/alert-add/alert-delete` and
  `reply geo-list/geo-add/geo-set/geo-delete`.
- Rust: `alerts_list/add/delete`, `geo_list/add/set/delete` (commands.rs + main.rs).
- JS: `api.alerts*`/`api.geo*`; `dynamic.js` `renderAlerts` + `renderGeo` (DYN keys).
- Build: created `binaries/openreply-cli-onedir/.placeholder` so the tauri build-script
  resource glob resolves in dev.

## Verified
- `cargo check` clean on the integrated tree (my alerts/geo + parallel persona-blend), 3m39s.
- CLI: `reply alert-add/list`, `reply geo-add` persist & return correctly.

## New DB tables
- `reply_alerts` (id, agent_id, rule, channel, intent_min, score_min, status, created_at)
- `geo_queries` (id, agent_id, query, surface, status, last_checked, created_at)
