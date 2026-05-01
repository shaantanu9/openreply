# Active-Collects Manager Screen + Manual Test Plan

**Date:** 2026-04-30
**Type:** Feature

## Summary

Adds the central place where you see and control everything happening
in the collect pipeline: which topic is currently fetching, what's
queued, what finished this session — with start/stop/open-log controls
on each row.

Companion to yesterday's `2026-04-30_01_collect-queue-and-busy-modal.md`.
That landed the queue + busy modal + status bar; this lands the dedicated
window the status bar links to.

## Changes

### New screen: `#/collects` (`src/screens/collects.js`)

Three panes, refreshed every 1.5s and on every collect-related Tauri
event:

1. **Running** — the one in-flight topic with elapsed timer, last 5
   log lines (live), `[Open full log →]` and `[Cancel collect]` buttons.
   Empty state offers `+ Start a new collect`.
2. **Queue** — every queued topic with its position number, a
   "queued ago" timestamp, `[Open log when running →]` and
   `[Remove]` buttons.
3. **This session** — every topic touched this session (status:
   done / failed / idle / queued) with `[Open log →]` and
   `[Re-collect]` buttons.

### Wiring

- New route `/^\/collects\/?$/` registered in `src/main.js`.
- New sidebar nav entry "Active collects" (with Lucide `activity`
  icon and a live count badge `1+2` = 1 running + 2 queued).
- The global `CollectStatusBar` now ends with a `Manage all →` link
  that deep-links to `#/collects` from any screen.
- The status bar additionally writes the count into
  `#nav-collects-count` so the sidebar badge stays in sync.
- `screens/collect.js` exports `getCollectSnapshot()` so the manager
  can read every topic's last 5 log lines + line count + start time
  without re-spawning the sidecar.

### Styles

`.cm-grid`, `.cm-pane`, `.cm-row`, `.cm-tail`, etc. — uses the same
brand tokens as the rest of the app (accent `#1F4E79`, ink `#0F172A`,
hairline `#E2E8F0`). The running row gets a 3px accent halo so it
visually pops.

## Manual test plan

Reproduce yesterday's bug + verify the new flow end-to-end:

### Setup

```bash
cd app-tauri
npm run tauri:dev          # picks up the cargo-lock-fix wrapper too
```

(If you ever see the old `Blocking waiting for file lock on package
cache` stall, the wrapper from yesterday now kills stale workers
before booting.)

### Test 1 — Single collect (baseline regression check)

1. Sidebar → **Active collects**. Pane should say "No collect is
   running right now" + a `+ Start a new collect` button.
2. Hit `Cmd+K` → enter `pomodoro timer apps`. Hit Enter.
3. The collect screen mounts. The recon card at the top should fill
   in within ~1s with: canonical name, ~10 search-keyword chips, the
   subreddit chips (first row), and 15 external-source chips (HN /
   App Store / Play Store / Trustpilot / Product Hunt / RSS Products
   / RSS Tech / arXiv / OpenAlex / PubMed / GNews / Dev.to / SO /
   GitHub / Trends).
4. As the sidecar fetches, individual chips should flip from `queued`
   (gray hollow dot) to `fetched: N` (accent-blue with a count pill).
5. The global status bar at the top of every screen should show
   `● Collecting pomodoro timer apps · <elapsed> [Cancel]
   [Manage all →]`.
6. Click `Manage all →` → lands on `#/collects`. The Running pane
   shows the current collect with live elapsed + last 5 log lines.

### Test 2 — Second collect → busy modal → queue path

1. While Test-1's collect is still running, sidebar → **Find** /
   `Cmd+K` → enter a different topic, e.g. `note-taking apps`.
2. The busy modal pops with three buttons:
   - **Queue this one** ← default-highlighted
   - **Cancel running and start this**
   - **Open running collect's log →**
   - **Dismiss**
3. Click **Queue this one**. Modal closes; the collect screen says
   `⏳ queued "note-taking apps" — position 1 in line.`
4. Sidebar → **Active collects**. Running pane still shows the first
   topic; Queue pane shows `1 · note-taking apps · queued <Xs> ago
   [Open log when running →] [Remove]`.
5. Sidebar nav badge reads `1+1`.
6. Status bar at top now shows `+ 1 queued: note-taking apps`.

### Test 3 — Queue auto-drain on completion

1. Wait for Test-1's collect to finish (or hit `[Cancel collect]` on
   the manager screen).
2. The Tauri backend fires `collect:queue:dequeued`; the queued
   collect (`note-taking apps`) automatically starts.
3. Manager screen Running pane swaps to the new topic. Queue pane
   becomes "Nothing queued."

### Test 4 — Cancel-and-start path

1. While `note-taking apps` is running, search a third topic, e.g.
   `mind-mapping tools`.
2. Modal pops. Click **Cancel running and start this**.
3. The current collect (`note-taking apps`) is SIGTERMed (its
   collect:done fires with code -1; partial data is preserved).
4. After ~150ms the new collect (`mind-mapping tools`) starts.
5. Manager screen reflects the swap within one refresh tick.

### Test 5 — Cancel a queued item before it starts

1. Setup: collect-A running + collect-B queued.
2. Manager screen → Queue row for B → click `Remove`.
3. Tauri emits `collect:queue:cancelled`; row disappears from
   Manager + status bar updates.

### Test 6 — Resilience

1. Quit + reopen the app while a collect is running.
2. The new session sees no running collect (Active map is in-memory)
   but the Python sidecar from the previous session has been
   reaped by the OS / package-cache wrapper.
3. Manager screen shows empty Running pane + empty Queue. Last
   session's logs are gone (they live in module-scope JS Maps).

## Verified

- `cargo check` ✓ clean
- `node --check` ✓ on every changed JS file: `src/screens/collects.js`,
  `src/screens/collect.js`, `src/components/CollectStatusBar.js`,
  `src/components/CollectReconCard.js`, `src/main.js`, `src/api.js`
- IPC contract sanity-checked against `active_collects`,
  `list_collect_queue`, `cancel_queued_collect`, `cancel_collect`,
  `start_collect` (with `if_busy` policy).

## Files Created

- `app-tauri/src/screens/collects.js` — the Manager screen (260 LOC)
- `changelogs/2026-04-30_02_collects-manager-screen-and-test-plan.md`
  — this changelog

## Files Modified

- `app-tauri/src/main.js` — registered `/collects` route + import
- `app-tauri/index.html` — sidebar nav entry "Active collects"
- `app-tauri/src/components/CollectStatusBar.js` — `Manage all →` deep
  link + writes the running+queued count into the sidebar badge
- `app-tauri/src/screens/collect.js` — exported `getCollectSnapshot()`
- `app-tauri/src/style.css` — `.cm-*` styles + `.csb-manage` styles

## What this answers from the prompt

> "where to see the all fetching of multiple topic properly with proper window"

→ `#/collects` shows every collect (running, queued, this session) in one window.

> "and when needed how to stop that where we can"

→ Per-row Cancel buttons in every pane: `Cancel collect` (running),
  `Remove` (queued), plus the topbar's existing Cancel.

> "and know where which topic is getting"

→ Manager + status bar both surface the running topic name,
  elapsed, queue contents, and counts. The recon card on each
  collect screen shows EXACTLY which subreddits + 15 external
  sources are being swept, with live `fetched: N` numbers as
  data arrives.

> "and need to stop and start for specific topic"

→ Manager pane → Stop (per row) or Re-collect (per finished topic).
  Sidebar `+ Start a new collect` button → `#/find` to enter a topic.
