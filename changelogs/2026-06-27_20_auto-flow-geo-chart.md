# Scheduled auto-flow (auto-find) + GEO chart + Settings status

**Date:** 2026-06-27
**Type:** Feature

## Summary

Completes the OpenReply auto-flow: the launchd scheduler now **auto-finds new
opportunities** on the agent's cadence (previously it only learned, posted due
replies, and refreshed GEO — never scanned). The Settings automation card drives
the cadence end-to-end and shows what each run does + last-scan time, and the AI
Visibility page gets a citation-rate-over-time chart.

## Changes

- `reply/opportunity.py`: `find_if_due()` — auto-scan on the active agent's
  `refresh_cadence` (off/manual skip; daily ~once/20h; weekly ~once/6.5d;
  throttled via `last_refresh_at`, stamps it after a run). Opt-in + cost-safe.
- `cli/main.py`: `schedule-tick` runs `find_if_due()` before the poster (so a
  freshly found → queued reply is handled the same tick); `opps_found` in result.
- `reply/geo.py`: `list_queries` returns a daily `trend` (citation rate =
  cited/total per UTC day, aggregated across queries) via `_citation_trend`.
- `or/dynamic.js`:
  - `buildAutomationCard` — the cadence selector now ALSO sets the active agent's
    `refresh_cadence` (via `agentUpdate({cadence})`), so Daily/Weekly genuinely
    turns on auto-scan; lists the 4 things each run does + "Last auto-scan: …".
  - `renderGeo` — "Citation rate over time" chart (`sparkChart`) above the query
    list once ≥2 days of check history exist.

## Files Created

- `changelogs/2026-06-27_20_auto-flow-geo-chart.md`

## Files Modified

- `src/openreply/reply/opportunity.py`, `src/openreply/cli/main.py`,
  `src/openreply/reply/geo.py`, `app-tauri/src/or/dynamic.js`

## The full auto-flow (per scheduled tick)

1. **Auto-find** new opportunities (agent cadence) → scored, ranked
2. **Learn** from the fetched posts (persona memories → beliefs)
3. **Post due** queued replies (auto where write creds exist, else macOS reminder)
4. **Refresh AI-visibility** citation checks (throttled ~daily)

Turned on from **Settings → Automation** (Off/Daily/Weekly) — one control wires
both the launchd schedule and the agent cadence.

## Verification

- Python (`.venv`): `find_if_due` skips no-agent / cadence-off / scanned-recently
  (daily+weekly); GEO `trend` computes 50%→100% over 2 days. Frontend: `vite build`
  clean.

## Notes

- Cost-safe: auto-find is opt-in (default cadence `off`) and throttled, so a fast
  launchd interval never re-scans more than the cadence allows.
- Scheduler + reminders remain macOS-only (launchd).
