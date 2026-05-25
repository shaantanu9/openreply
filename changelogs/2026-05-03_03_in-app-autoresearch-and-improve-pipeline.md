# Full in-app autoresearch flow + Improve pipeline + auto persona-build

**Date:** 2026-05-03
**Type:** Feature

## Summary

Removes the Claude Code skill and brings the entire autoresearch + pipeline
flow inside the Tauri app. The user now gets:

1. **Auto persona-build after collect** — every successful collect
   triggers a deterministic audience-clustering build in the
   background. The app's first artefact for a topic is a set of
   real-Reddit-user personas, *before* anything else runs.
2. **`/improve/<topic>` screen** — guided "one button" runner that
   walks audience → synthesize → deliberate → launch in order, lights
   up each checkpoint as it completes, and reads from each stage's
   cache so re-clicks skip fresh stages.
3. **`/iterate/<topic>` + `/iterate/run/<run_id>` screens** — replace
   the in-memory sweeper with a full persistent autoresearch loop.
   Runs land in `iterate_runs` + `iterate_iterations` tables and
   survive page reloads. Live polling refreshes the run-detail view
   every 2 s while running.
4. **Per-topic best-config memory** — clicking "Apply best" on a
   finished run writes the winning config to a new
   `topic_pipeline_config(topic, loop_kind)` table. Future calls to
   `synthesize_insights` / `build_audience_personas` read those
   overrides, so improvements **stick** without any prompt edits.

The Claude Code skill at `.claude/skills/gap-map-autoresearch/` is
removed — every loop now runs from inside the sidebar.

## How it ties together

```
collect finishes
       ↓
gapmap:changed (kind=collect)
       ↓
audiencePersonasBuild(topic, llm=false)   ← AUTO, no LLM key needed
       ↓
audience_personas table populated
       ↓
user opens /improve/<topic>
       ↓
pipelineRun(topic) walks 4 stages:
   1. audience       — uses topic_pipeline_config['audience'] if applied
   2. synthesize     — runs with deliberate=True (audience-grounded)
   3. deliberate     — skips if stage 2 already tiered
   4. launch         — refreshes Launch Brief
       ↓
later: user opens /iterate/<topic>, runs the deliberate loop
       ↓
iterate_runs + iterate_iterations populated; sparkline shows score progression
       ↓
user clicks "Apply best config"
       ↓
topic_pipeline_config['deliberate'] gets the winning {rounds, use_llm}
       ↓
next /improve run uses those values — improvement persisted
```

## Three new tables

| Table | Purpose |
|---|---|
| `iterate_runs` | One row per loop execution (run_id, topic, loop_kind, status, best_config_json, best_score, total_iters, grid_size). |
| `iterate_iterations` | One row per config tried within a run. Sparkline data. |
| `topic_pipeline_config` | The winning config per (topic, loop_kind) — read by audience.py and insights.py to apply learned improvements. |

## Files Created

- `src/reddit_research/research/iterate.py` — engine: start_run, execute_run, cancel_run, get_run, list_runs, apply_best_config, get_applied_config, list_applied_configs. Two registered loops (`deliberate`, `audience`) with sensible default config grids and composite scoring.
- `src/reddit_research/research/pipeline.py` — orchestrator: run_pipeline (audience → synthesize → deliberate → launch with skip-on-fresh logic), pipeline_status (lightweight cache freshness check).
- `app-tauri/src/screens/improve.js` — the "one button" guided runner.
- `app-tauri/src/screens/iterate.js` — *rewrite* into persistent run-feed + run-detail with live polling + "Apply best" CTA.
- `changelogs/2026-05-03_03_in-app-autoresearch-and-improve-pipeline.md` — this file.

## Files Modified

- `src/reddit_research/research/audience.py` — `build_audience_personas` reads `topic_pipeline_config['audience']` and applies overrides when caller didn't pass non-default values.
- `src/reddit_research/research/insights.py` — same override logic on the `deliberate_rounds` parameter.
- `src/reddit_research/cli/main.py` — 9 new subcommands: iterate-start, iterate-execute, iterate-run, iterate-status, iterate-list, iterate-cancel, iterate-apply, iterate-applied, pipeline-run, pipeline-status.
- `src/reddit_research/mcp/server.py` — already exposed `gapmap_deliberate` and audience tools. iterate / pipeline live as CLI surfaces only (small footprint; the GUI calls them via Tauri commands; can be promoted to MCP tools later if agents need them).
- `app-tauri/src-tauri/src/commands.rs` — 10 new Tauri commands wrapping the iterate + pipeline CLI subcommands.
- `app-tauri/src-tauri/src/main.rs` — all 10 registered in `generate_handler!`.
- `app-tauri/src/api.js` — `api.iterateRun`, `iterateStart`, `iterateExecute`, `iterateStatus`, `iterateList`, `iterateCancel`, `iterateApply`, `iterateApplied`, `pipelineRun`, `pipelineStatus`.
- `app-tauri/src/main.js` — `renderImprove` import, route, explainer slug; auto-trigger `audiencePersonasBuild(topic, llm=false)` on `gapmap:changed{kind:collect}` with localStorage marker so it only fires once per topic per session.
- `app-tauri/index.html` — sidebar entries "Improve" (`zap` icon) + "Iterate" (`repeat` icon) grouped at the end of Workspace. Order: Audience (real users) → ... → Improve (run pipeline) → Iterate (tune configs).
- `app-tauri/src/style.css` — `.improve-stage-icon` helper.

## Files Removed

- `.claude/skills/gap-map-autoresearch/` (full directory) — replaced
  entirely by the in-app `/iterate` and `/improve` screens.

## Verification

- `ast.parse` clean on every modified Python file.
- `node --check` clean on every modified JS file.
- `cargo check` clean (just the existing JWT_DESKTOP_SECRET warning).
- Functional smoke test of `iterate.py` against an in-memory SQLite
  with a stub registry (`{a: 1, 2, 3}` → run picks `{a: 3}` as best;
  `apply_best_config` writes to `topic_pipeline_config`;
  `get_applied_config` reads it back).

## Defaults adopted

| Decision | Value |
|---|---|
| Auto-build audience after collect | yes, deterministic (no LLM) — once per topic per browser session |
| Improve stage staleness threshold | 24 h (re-runs if older) |
| Deliberate default grid | 4 configs: rounds×{1,2,3} × use_llm×{T,F} |
| Audience default grid | 4 configs: min_posts×{2,3,5}, k×{[3,5,7],[5,7,10]} |
| Polling interval (run detail) | 2 s while running, stops on terminal state |
| Sidebar order | …Empathy / Audience / Interviews / PMF / Pricing / Launch / **Improve** / **Iterate** |

## What's next

The discovery framework is now feature-complete on:
- ✅ Real-user persona grounding (Phase 1)
- ✅ Audience screen (Phase 2)
- ✅ 5-persona deliberation (Phase 3)
- ✅ In-app autoresearch loop with persistent best-config memory (Phase 4 in-app)
- ✅ Pipeline orchestrator (this changelog)

Phase 5 (evaluation lenses + OASIS synthetic simulation) remains
optional and unbuilt.
