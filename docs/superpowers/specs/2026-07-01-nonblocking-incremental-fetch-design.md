# Non-Blocking Incremental Daily Fetch (Hybrid Progress UI) — Design

**Date:** 2026-07-01
**Status:** Approved (design) — sub-project **A** of the daily-automation roadmap
**Scope:** Make "Refresh + learn" (and the daily auto-fetch) run fully in the
background, show live source-by-source progress that survives navigation, and
refresh the Overview as data lands — without ever freezing the rest of the app.

## Context

Prior fixes this session already established the backbone:

- `agent refresh --stream` + `agent_refresh_stream` (Rust) drive the fetch via
  `run_cli_streaming`, which spawns a **separate** process (dev: `.venv` python;
  prod: PyInstaller sidecar) and does **not** hold the daemon slot lock — so a
  running fetch does not block UI reads.
- `collect()` already fans out sources in parallel (`ThreadPoolExecutor`,
  env-tunable pool + `OPENREPLY_SOURCE_TIMEOUT_SEC` budget); wall-time ≈ slowest
  source, not the sum.
- `init_schema` contention (which made fetch/scan hang) is fixed.

What's missing is the **UX layer**: progress is only surfaced in the Refresh
button's tooltip, is lost when you navigate away, and the fetch emits
human-readable strings that are awkward to render. This design adds structured
progress, a shared status store, a persistent global chip, and an inline
Overview panel.

This is the roadmap's **sub-project A**. B (source expansion), C (auth-gated
connections: X/LinkedIn/etc.), and D (continuous learning + memory-palace
evolution) are separate specs that build on A.

## Components (one clear purpose each)

### 1. Structured progress events (backend)
`agent refresh --stream` currently wraps any non-dict progress value as
`{"event":"log","msg":…}`. Enhance the collect/refresh progress path to emit
**structured** events the UI can consume directly:

- `{"event":"phase","name":"collect"|"learn"|"canonicalize"}`
- `{"event":"source","name":"hn","status":"start"|"done"|"error","count":125,"ms":60300}`
- `{"event":"result","posts_fetched":703,"by_source":{…},"error":null}`

Requirements:
- The **non-stream / CLI path keeps emitting the existing human strings** (stderr)
  — no behavior change for terminal users.
- Structured emission is additive: a thin adapter maps collect's per-source
  progress to the events above when a structured sink is active. Where collect
  only has a formatted string, the adapter parses the stable
  `[N/M] [source] ✓/✗ K posts (Xs)` shape; net-new structured emits are added at
  phase boundaries (canonicalize → collect → learn) and at the final result.
- `log` events remain supported as a fallback so nothing is ever dropped.

### 2. Shared fetch-status store (frontend)
A small module (e.g. `app-tauri/src/or/fetchStatus.js`) holding:
```
{ running, agentId, phase, sources: { <name>: { status, count, ms } },
  totalPosts, done, error, startedAt }
```
- Pure state + a pub/sub (`subscribe(cb) → unsubscribe`, `getState()`).
- Updated **only** by the app-level listener (below). No DOM knowledge.

### 3. App-level event listener (registered once at startup)
In `main.js` (app boot), subscribe **once** to `agent_refresh:progress` and
`agent_refresh:done` and feed the store. This is the key change that makes
progress **survive navigation** — the subscription is not owned by any screen.
On `done`: mark store done, then broadcast so the current view can reload.

### 4. Global chip (app shell)
A persistent element in the shell (near the header/sidebar), subscribed to the
store:
- While `running`: `Fetching… <done>/<total> · <totalPosts> posts` + a **Stop**
  button (calls the existing cancel command for the active stream) + click →
  navigate to `#/` (Overview).
- Idle: hidden.

### 5. Inline Overview panel
When `running`, Overview renders a detailed source-by-source panel from the
store (mirrors the Opportunities scan's `scanPanel`): each source spinner → ✓
count / ✗, an `N/M sources` header, running post total, current phase
(collect/learn). On `done`, reload the digest + KPIs + top opportunities so new
data appears without a manual reload.

## Data flow

```
Refresh click (or auto)                     launchd schedule-tick (auto, app closed)
        │                                            │  (separate process, persists data;
        ▼                                            │   no UI events — shown next open)
api.agentRefreshStream ─▶ Rust run_cli_streaming ─▶ `agent refresh --stream` (separate proc)
        │                                            │
        │                          NDJSON structured progress
        ▼                                            ▼
Rust re-emits `agent_refresh:progress` / `:done` Tauri events
        │
        ▼
app-level listener (main.js) ─▶ fetchStatus store ─▶ subscribers
        │                                              ├─ global chip (any screen)
        │                                              └─ Overview inline panel
        ▼ (on done)
reload digest + KPIs + opportunities on the active view
```

## Behavior

- **Manual:** the Refresh button just kicks `agentRefreshStream`; it no longer
  owns the progress listener (the app-level one does). Button reflects
  `running` from the store (disabled + spinner while a fetch is active).
- **Auto-daily:** enabled by the user via Settings → Automation → Daily
  (installs launchd + sets cadence). Runs in its own process; the app shows the
  results on next open / next Overview load. No incremental UI for closed-app
  runs (out of scope, see below).
- **Concurrency UX:** `collect` is single-flight. While `running`, the Refresh
  and "Find opportunities" actions show *"a fetch is in progress…"* (disabled or
  a clear message) instead of silently blocking or erroring.
- **Timeouts:** keep an env-tunable per-source cap + overall budget so a
  straggler (e.g. YouTube ~240s) is abandoned and shown as ✗ rather than
  stalling the run. The streaming path itself has **no** frontend timeout (it's
  event-driven) — replacing the old 120s/360s ceilings that killed the fetch.

## Error handling

- Per-source failures → `source` event with `status:"error"`; shown as ✗ in the
  panel; never fail the whole run.
- Partial data is already persisted per-source as it lands, so a Stop or a
  straggler-timeout still leaves the fetched posts in the corpus.
- `done` with a non-zero exit code → toast with the hint; store keeps whatever
  landed; Overview still reloads.
- Store is reset defensively on a new run so a prior error state can't stick.

## Scope boundaries (YAGNI)

**In scope:** structured progress; shared store; app-level listener; global chip
with Stop; inline Overview panel; concurrency-aware button states; per-source
timeout/budget tuning.

**Out of scope (later sub-projects):**
- Incremental UI for auto-runs that happen while the app is closed (B/D era).
- Adding new source adapters (sub-project **B**).
- Auth-gated source connection flows — X/LinkedIn/etc. (sub-project **C**).
- Learning / memory-palace evolution changes (sub-project **D**).
- Persisting progress across an app restart (a fetch that outlives the app).

## Testing

- **Manual/E2E:** start a refresh; navigate to Opportunities/Queue/Settings and
  confirm (a) the chip persists and keeps updating, (b) those screens stay
  responsive (reads return promptly) during the fetch, (c) returning to Overview
  shows the inline panel, (d) on completion the digest/KPIs reload with new data,
  (e) Stop cancels and leaves partial data intact.
- **Unit:** the structured-event adapter (string → `source`/`phase`/`result`
  events); the store reducer (progress events → state, reset-on-new-run,
  done/error transitions).
- **Backend:** `agent refresh --stream` emits valid NDJSON whose lines are the
  structured event shapes above (extends the existing NDJSON-validity check).

## File change map (indicative)

- `src/openreply/cli/agent_cmds.py` — `refresh_cmd --stream`: emit structured events.
- `src/openreply/research/collect.py` (and/or `reply/agent.py`, `reply/learn.py`)
  — thin structured-progress adapter at phase/source boundaries (additive; human
  strings unchanged).
- `app-tauri/src/or/fetchStatus.js` — new shared store + pub/sub.
- `app-tauri/src/main.js` — register the single app-level progress listener; mount the chip.
- `app-tauri/src/or/dynamic.js` — Overview inline panel + concurrency-aware button states; Refresh button reads `running` from the store.
- (Rust already has `agent_refresh_stream` + cancel plumbing — no new command expected.)
