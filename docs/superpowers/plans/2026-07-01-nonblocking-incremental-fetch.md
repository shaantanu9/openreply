# Non-Blocking Incremental Daily Fetch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Refresh + learn" (and the daily auto-fetch) run in the background with live, source-by-source progress that survives navigation and refreshes the Overview as data lands — without freezing the app.

**Architecture:** The streaming backbone already exists (`agent refresh --stream` → `agent_refresh_stream` → `run_cli_streaming`, a separate process; `collect` is parallel). This plan adds: (1) structured NDJSON progress events, (2) a pure frontend `fetchStatus` store, (3) a single app-level event listener in `main.js`, (4) a persistent global chip in the shell, (5) an inline Overview panel + concurrency-aware buttons.

**Tech Stack:** Python 3.11 (Typer CLI, pytest), Rust (Tauri, already done), vanilla ES modules (no DOM test framework; pure JS units tested via `node`).

## Global Constraints

- Non-stream / terminal CLI path MUST keep emitting the existing human-readable progress strings to stderr — structured events are additive and stream-only.
- No new Rust command is needed (`agent_refresh_stream` + cancel plumbing already exist). Do not revert prior session fixes.
- Frontend must degrade gracefully outside Tauri (`api.isTauri()` false → no-op).
- Event names are fixed: `agent_refresh:progress`, `agent_refresh:done`.
- Commit after every task. Stage explicit paths only; never `git add -A` (a parallel session is editing icons/docs).

---

### Task 1: Structured progress events for `agent refresh --stream`

**Files:**
- Create: `src/openreply/cli/_progress.py`
- Modify: `src/openreply/cli/agent_cmds.py` (the `refresh_cmd --stream` block)
- Test: `tests/test_refresh_progress.py`

**Interfaces:**
- Produces: `to_structured_event(msg: str) -> dict` — maps one collect/learn progress string to a structured event dict. Recognized shapes:
  - `"[19/23] [hn] ✓ 125 posts (60.3s)"` → `{"event":"source","name":"hn","status":"done","count":125,"index":19,"total":23}`
  - `"  ! [youtube] ✗ timed out after 240s — skipped"` → `{"event":"source","name":"youtube","status":"error"}`
  - `"canonicalizing topic ..."` → `{"event":"phase","name":"canonicalize"}`
  - `"learning · ..."` → `{"event":"phase","name":"learn"}`
  - anything else → `{"event":"log","msg":<msg>}`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_refresh_progress.py
from openreply.cli._progress import to_structured_event

def test_source_done_line():
    assert to_structured_event("[19/23] [hn] ✓ 125 posts (60.3s)") == {
        "event": "source", "name": "hn", "status": "done",
        "count": 125, "index": 19, "total": 23,
    }

def test_source_error_line():
    ev = to_structured_event("  ! [youtube] ✗ timed out after 240s — skipped")
    assert ev == {"event": "source", "name": "youtube", "status": "error"}

def test_learn_phase():
    assert to_structured_event("learning · Logiciel — niche brain: reading new posts…") == {
        "event": "phase", "name": "learn"}

def test_canonicalize_phase():
    assert to_structured_event("canonicalizing topic via LLM (first run may take ~30-60s)…") == {
        "event": "phase", "name": "canonicalize"}

def test_unrecognized_is_log():
    assert to_structured_event("embedder warmed in 0.2s") == {
        "event": "log", "msg": "embedder warmed in 0.2s"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_refresh_progress.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'openreply.cli._progress'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/openreply/cli/_progress.py
"""Map collect/learn human progress strings to structured stream events.

Kept pure + separately testable so the `agent refresh --stream` UI has a stable
event contract instead of the frontend regex-parsing free-text. The non-stream
CLI path still prints the original strings; this only runs for --stream."""
from __future__ import annotations

import re

# "[19/23] [hn] ✓ 125 posts (60.3s)"
_SRC_DONE = re.compile(r"\[(\d+)/(\d+)\]\s*\[([^\]]+)\]\s*✓\s*(\d+)\s*posts")
# "  ! [youtube] ✗ timed out after 240s — skipped"
_SRC_ERR = re.compile(r"\[([^\]]+)\]\s*✗")


def to_structured_event(msg: str) -> dict:
    s = (msg or "").strip()
    m = _SRC_DONE.search(s)
    if m:
        return {"event": "source", "name": m.group(3), "status": "done",
                "count": int(m.group(4)), "index": int(m.group(1)), "total": int(m.group(2))}
    m = _SRC_ERR.search(s)
    if m:
        return {"event": "source", "name": m.group(1), "status": "error"}
    low = s.lower()
    if low.startswith("canonicalizing"):
        return {"event": "phase", "name": "canonicalize"}
    if low.startswith("learning"):
        return {"event": "phase", "name": "learn"}
    return {"event": "log", "msg": s}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_refresh_progress.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Wire it into `refresh_cmd --stream`**

In `src/openreply/cli/agent_cmds.py`, change the `--stream` `_emit` so a **string** progress value is converted to a structured event (dicts still pass through):

```python
    if stream:
        from ._progress import to_structured_event
        def _emit(m):
            try:
                ev = m if isinstance(m, (dict, list)) else to_structured_event(m)
                typer.echo(json.dumps(ev, default=str))
            except Exception:
                pass
        res = _agent.refresh_agent(id, light=not deep, progress=_emit)
        _emit({"event": "result", "posts_fetched": res.get("posts_fetched"),
               "by_source": res.get("by_source"), "error": res.get("error")})
        return
```

- [ ] **Step 6: Verify `--stream` emits structured events**

Run (kill after a few seconds):
```bash
.venv/bin/python -m openreply.cli.main agent refresh --stream 2>/dev/null | head -8
```
Expected: JSON lines including at least one `{"event":"phase",...}` or `{"event":"source",...}` (plus `log` lines). All lines valid JSON.

- [ ] **Step 7: Commit**

```bash
git add src/openreply/cli/_progress.py src/openreply/cli/agent_cmds.py tests/test_refresh_progress.py
git commit -m "feat(refresh): structured NDJSON progress events for --stream"
```

---

### Task 2: `fetchStatus` store (pure, framework-free)

**Files:**
- Create: `app-tauri/src/or/fetchStatus.js`
- Test: `app-tauri/tests/fetch-status.test.mjs`

**Interfaces:**
- Consumes: structured events from Task 1 (`source`/`phase`/`result`/`log`).
- Produces:
  - `applyEvent(state, ev) -> newState` (pure reducer)
  - `initialState() -> state`
  - `store` singleton: `store.getState()`, `store.subscribe(cb) -> unsub`, `store.start(agentId)`, `store.apply(ev)`, `store.finish(doneObj)`
  - state shape: `{ running:bool, agentId:string|null, phase:string, sources:{[name]:{status,count}}, totalPosts:int, sourcesDone:int, done:bool, error:string|null }`

- [ ] **Step 1: Write the failing test**

```js
// app-tauri/tests/fetch-status.test.mjs
import assert from "node:assert";
import { initialState, applyEvent } from "../src/or/fetchStatus.js";

let s = { ...initialState(), running: true };
s = applyEvent(s, { event: "phase", name: "collect" });
assert.equal(s.phase, "collect");

s = applyEvent(s, { event: "source", name: "hn", status: "done", count: 125 });
assert.equal(s.sources.hn.status, "done");
assert.equal(s.sources.hn.count, 125);
assert.equal(s.sourcesDone, 1);
assert.equal(s.totalPosts, 125);

s = applyEvent(s, { event: "source", name: "youtube", status: "error" });
assert.equal(s.sources.youtube.status, "error");
assert.equal(s.sourcesDone, 1); // errors don't count as done-with-data
assert.equal(s.totalPosts, 125);

s = applyEvent(s, { event: "result", posts_fetched: 703 });
assert.equal(s.totalPosts, 703); // result total wins

console.log("fetch-status OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node app-tauri/tests/fetch-status.test.mjs`
Expected: FAIL — cannot find module `fetchStatus.js`

- [ ] **Step 3: Write minimal implementation**

```js
// app-tauri/src/or/fetchStatus.js
// Pure fetch-progress state + a tiny pub/sub. Fed ONLY by the app-level
// agent_refresh event listener (main.js); read by the global chip + Overview
// panel. No DOM knowledge so it stays unit-testable under plain node.

export function initialState() {
  return { running: false, agentId: null, phase: "", sources: {},
           totalPosts: 0, sourcesDone: 0, done: false, error: null };
}

export function applyEvent(state, ev) {
  if (!ev || !ev.event) return state;
  const s = { ...state, sources: { ...state.sources } };
  if (ev.event === "phase") { s.phase = ev.name || s.phase; return s; }
  if (ev.event === "source") {
    s.sources[ev.name] = { status: ev.status, count: ev.count || 0 };
    if (ev.status === "done") { s.sourcesDone += 1; s.totalPosts += (ev.count || 0); }
    return s;
  }
  if (ev.event === "result") {
    if (typeof ev.posts_fetched === "number") s.totalPosts = ev.posts_fetched;
    if (ev.error) s.error = ev.error;
    return s;
  }
  return s; // log
}

function makeStore() {
  let state = initialState();
  const subs = new Set();
  const emit = () => { for (const cb of subs) { try { cb(state); } catch (e) {} } };
  return {
    getState: () => state,
    subscribe(cb) { subs.add(cb); try { cb(state); } catch (e) {} return () => subs.delete(cb); },
    start(agentId) { state = { ...initialState(), running: true, agentId: agentId || null, phase: "collect" }; emit(); },
    apply(ev) { state = applyEvent(state, ev); emit(); },
    finish(d) { state = { ...state, running: false, done: true, error: (d && d.code && d.code !== 0) ? (d.hint || `exit ${d.code}`) : state.error }; emit(); },
    reset() { state = initialState(); emit(); },
  };
}

export const store = makeStore();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node app-tauri/tests/fetch-status.test.mjs`
Expected: prints `fetch-status OK`, exit 0

- [ ] **Step 5: Commit**

```bash
git add app-tauri/src/or/fetchStatus.js app-tauri/tests/fetch-status.test.mjs
git commit -m "feat(fetch): pure fetchStatus store + reducer"
```

---

### Task 3: App-level progress listener + reload-on-done (main.js)

**Files:**
- Modify: `app-tauri/src/main.js` (add a `wireFetchStatus()` called once during boot, near `prewarm()`/`healthBanner()`)

**Interfaces:**
- Consumes: `store` from Task 2; `api.onEvent` from `api.js`.
- Produces: a live `store` populated for any in-flight refresh, regardless of current screen; a `window`-level custom event `openreply:fetch-done` the Overview listens for.

- [ ] **Step 1: Add the listener wiring**

Add near the other imports in `main.js`:
```js
import { store as fetchStore } from "./or/fetchStatus.js";
```
Add this function and call it once inside the boot sequence (same place `prewarm()` is called):
```js
async function wireFetchStatus() {
  if (!api.isTauri || !api.isTauri()) return;
  const parse = (p) => { try { return typeof p === "string" ? JSON.parse(p) : p; } catch (e) { return null; } };
  await api.onEvent("agent_refresh:progress", (payload) => {
    const ev = parse(payload); if (ev) fetchStore.apply(ev);
  });
  await api.onEvent("agent_refresh:done", (payload) => {
    fetchStore.finish(parse(payload) || {});
    // Let the active view (e.g. Overview) reload its data now that the fetch landed.
    window.dispatchEvent(new CustomEvent("openreply:fetch-done"));
  });
}
```
Call it: add `wireFetchStatus();` right after the existing `prewarm();` call.

- [ ] **Step 2: Verify boot doesn't throw**

Run: `cd app-tauri && npm run build 2>&1 | tail -5` (or rely on the running `tauri dev` recompiling the JS)
Expected: build/HMR succeeds, no import errors in the dev console.

- [ ] **Step 3: Commit**

```bash
git add app-tauri/src/main.js
git commit -m "feat(fetch): app-level agent_refresh listener feeding the store"
```

---

### Task 4: Global fetch chip in the shell

**Files:**
- Modify: `app-tauri/src/or/shell.js` (add a chip element + a `mountFetchChip()` that subscribes to the store)
- Modify: `app-tauri/src/or/api.js` (add `cancelRefresh` wrapper if absent)

**Interfaces:**
- Consumes: `store` (Task 2). Cancel via the existing Rust cancel command.
- Produces: `mountFetchChip()` exported from shell.js, called from `mountShell`.

- [ ] **Step 1: Confirm the cancel command name**

Run: `grep -nE "cancel_active_stream|cancel_active_job" app-tauri/src-tauri/src/main.rs`
Expected: a registered `#[tauri::command]` for cancelling the active stream. Use that exact name in the api wrapper below (shown as `cancel_active_stream`; adjust to the real name if different).

- [ ] **Step 2: Add the api wrapper (if not already present)**

In `app-tauri/src/or/api.js`:
```js
  cancelRefresh: () => call("cancel_active_stream"),
```

- [ ] **Step 3: Add the chip**

In `shell.js`, append a fixed-position chip to the shell markup (bottom-right), and a mount function:
```js
export function mountFetchChip() {
  let el = document.getElementById("fetch-chip");
  if (!el) {
    el = document.createElement("div");
    el.id = "fetch-chip";
    el.className = "fixed bottom-4 right-4 z-50 hidden items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold shadow-lg dark:border-zinc-700 dark:bg-zinc-900";
    document.body.appendChild(el);
  }
  const { store } = window.__orFetchStore || {};
  // store is imported directly below instead of via window; see import note.
}
```
Simpler: import the store at the top of shell.js (`import { store as fetchStore } from "./fetchStatus.js";`) and implement:
```js
export function mountFetchChip() {
  let el = document.getElementById("fetch-chip");
  if (!el) {
    el = document.createElement("div");
    el.id = "fetch-chip";
    el.className = "fixed bottom-4 right-4 z-50 hidden items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold shadow-lg dark:border-zinc-700 dark:bg-zinc-900";
    document.body.appendChild(el);
  }
  fetchStore.subscribe((s) => {
    if (!s.running) { el.classList.add("hidden"); el.classList.remove("flex"); return; }
    el.classList.remove("hidden"); el.classList.add("flex");
    const n = Object.keys(s.sources).length;
    el.innerHTML =
      `<i data-lucide="loader" class="h-3.5 w-3.5 animate-spin text-reddit"></i>` +
      `<span class="cursor-pointer" data-fetch-open>Fetching… ${s.sourcesDone}/${n || "…"} · ${s.totalPosts} posts</span>` +
      `<button data-fetch-stop class="ml-1 rounded px-1.5 py-0.5 text-rose-500 hover:bg-rose-500/10">Stop</button>`;
    if (window.refreshIcons) window.refreshIcons();
  });
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-fetch-open]")) location.hash = "#/";
    if (e.target.closest("[data-fetch-stop]")) { import("./api.js").then(({ api }) => api.cancelRefresh && api.cancelRefresh()); }
  });
}
```
Call `mountFetchChip();` at the end of `mountShell()`.

- [ ] **Step 4: Manual verify**

In the running app: trigger Refresh on Overview, then navigate to Opportunities/Settings.
Expected: the chip stays visible bottom-right, counts increase, other screens stay responsive; **Stop** hides the chip and halts the fetch.

- [ ] **Step 5: Commit**

```bash
git add app-tauri/src/or/shell.js app-tauri/src/or/api.js
git commit -m "feat(fetch): persistent global fetch chip with stop"
```

---

### Task 5: Overview inline panel + concurrency-aware buttons

**Files:**
- Modify: `app-tauri/src/or/dynamic.js` (`renderOverview` / `#ov-refresh` handler)

**Interfaces:**
- Consumes: `store` (Task 2), `openreply:fetch-done` window event (Task 3).
- Produces: an inline progress panel on Overview driven by the store; the Refresh button reflects `store.getState().running`.

- [ ] **Step 1: Import the store in dynamic.js**

Add near the top imports: `import { store as fetchStore } from "./fetchStatus.js";`

- [ ] **Step 2: Render the panel + reflect running state**

In `renderOverview`, after the header renders, add a container `<div id="ov-fetch-panel"></div>` and a subscription that fills it while running (mirrors `scanPanel`):
```js
  const fpHost = view.querySelector("#ov-fetch-panel");
  const unsubFetch = fetchStore.subscribe((s) => {
    const btn = view.querySelector("#ov-refresh");
    if (btn) btn.disabled = !!s.running;
    if (!fpHost) return;
    if (!s.running && !s.done) { fpHost.innerHTML = ""; return; }
    const rows = Object.entries(s.sources).map(([n, v]) =>
      `<div class="flex items-center gap-2 text-sm">${v.status === "done"
        ? `<span class="text-emerald-500">✓</span><span class="text-zinc-600 dark:text-zinc-300">${esc(n)}</span><span class="ml-auto text-xs text-zinc-400">${v.count} posts</span>`
        : v.status === "error"
        ? `<span class="text-rose-500">✗</span><span class="text-zinc-500">${esc(n)}</span><span class="ml-auto text-xs text-zinc-300">skipped</span>`
        : `<i data-lucide="loader" class="h-3.5 w-3.5 animate-spin text-zinc-400"></i><span class="text-zinc-500">${esc(n)}</span>`}</div>`).join("");
    fpHost.innerHTML = s.running
      ? `<div class="${card}"><div class="mb-2 flex items-center justify-between"><b class="text-zinc-900 dark:text-white">Fetching latest — ${s.phase || "collecting"}…</b><span class="text-xs text-zinc-400">${s.totalPosts} posts</span></div>${rows}</div>`
      : "";
    if (window.refreshIcons) window.refreshIcons();
  });
  view.addEventListener("or:teardown", () => { try { unsubFetch(); } catch (e) {} }, { once: true });
```
(If the Overview has no teardown hook, unsubscribe on the next `renderOverview` by storing the unsub on `view`. Keep it simple: it's idempotent.)

- [ ] **Step 3: Reload Overview data on fetch-done**

Add once in `renderOverview`:
```js
  const onDone = () => renderOverview(view);
  window.addEventListener("openreply:fetch-done", onDone, { once: true });
```

- [ ] **Step 4: Refresh handler starts the store; drop the button-owned listener**

Replace the current `#ov-refresh` handler body so it just marks the store started and fires the stream (the app-level listener now drives progress):
```js
  view.querySelector("#ov-refresh").onclick = async () => {
    if (fetchStore.getState().running) { toast("A fetch is already running"); return; }
    if (!api.agentRefreshStream) {   // non-Tauri / old shell fallback
      try { await api.agentRefresh(null, false); toast("Knowledge refreshed + learned"); renderOverview(view); } catch (e) { toast("Refresh failed"); }
      return;
    }
    fetchStore.start(null);
    try { await api.agentRefreshStream(null, false); }
    catch (err) { fetchStore.finish({ code: 1, hint: String(err) }); toast("Refresh failed: " + err); }
  };
```

- [ ] **Step 5: Concurrency-aware "Find opportunities"**

In `renderOpportunities`, at the top of the `#op-find` handler, add:
```js
    if (fetchStore.getState().running) { statusEl.textContent = "A fetch is in progress — try again in a moment."; return; }
```
(Import `fetchStore` in dynamic.js is already done in Step 1.)

- [ ] **Step 6: Manual verify**

In the app: click Refresh on Overview → inline panel fills source-by-source, button disabled; navigate away and back → panel reflects current store; on completion the Overview reloads (digest/KPIs update); clicking Find during a fetch shows the "in progress" message.

- [ ] **Step 7: Commit**

```bash
git add app-tauri/src/or/dynamic.js
git commit -m "feat(fetch): live Overview fetch panel + concurrency-aware actions"
```

---

### Task 6: Per-source timeout / budget sanity + changelog

**Files:**
- Modify: `src/openreply/research/collect.py` (only if the per-source cap / overall budget is not already env-tunable with a sane default)
- Create: `changelogs/2026-07-01_07_nonblocking-incremental-fetch.md`

- [ ] **Step 1: Confirm the existing budget knobs**

Run: `grep -nE "OPENREPLY_SOURCE_TIMEOUT_SEC|per.source|timeout|budget|max_workers" src/openreply/research/collect.py | head`
Expected: `OPENREPLY_SOURCE_TIMEOUT_SEC` (overall) and a per-source timeout already exist. If a per-source cap is missing or a straggler can exceed the overall budget, add a per-source `min(remaining_budget, PER_SOURCE_CAP)` guard (env `OPENREPLY_PER_SOURCE_TIMEOUT_SEC`, default 90). If already present, no code change — just record the defaults in the changelog.

- [ ] **Step 2: Verify a straggler is abandoned (not infinite)**

Run: `OPENREPLY_SOURCE_TIMEOUT_SEC=60 .venv/bin/python -m openreply.cli.main agent refresh --stream 2>/dev/null | tail -3`
Expected: emits a `result` event within ~60–75s (budget + drain grace), i.e. it does not hang indefinitely.

- [ ] **Step 3: Write the changelog** (Feature; list the files from Tasks 1–6).

- [ ] **Step 4: Commit**

```bash
git add src/openreply/research/collect.py changelogs/2026-07-01_07_nonblocking-incremental-fetch.md
git commit -m "chore(fetch): source-timeout sanity + changelog for incremental fetch"
```

---

## Self-review notes

- **Spec coverage:** structured events (T1), store (T2), app-level listener + reload (T3), global chip + stop (T4), inline panel + concurrency UX + button-owned-listener removal (T5), timeout/budget (T6). Auto-daily needs no new UI (spec: out of scope for closed-app runs); enabling it is the user's Settings action.
- **Types:** `fetchStore` API (`getState/subscribe/start/apply/finish/reset`) is consistent across T3/T4/T5; event shapes from T1 match the T2 reducer.
- **No new Rust:** `agent_refresh_stream` + cancel already exist; T4 Step 1 verifies the exact cancel command name before wiring `cancelRefresh`.
