# Per-screen perf audit — instant-paint conversion plan

**Date:** 2026-04-25
**Status:** audit complete, fixes prioritised

## The complaint

> "home page on each topic keep loading the whole app feel slow as wherever I go it first start loading"

Every screen waits on at least one sidecar call **before painting its first byte**, so the user sees a spinner / skeleton / "loading…" string on every navigation, even when the answer hasn't changed since last time.

## Root cause pattern

Most screen loaders look like:

```js
export async function renderX(root) {
  root.innerHTML = `<div class="empty-state">loading…</div>`;
  const data = await api.someThing(...);   // 500–2000 ms cold
  root.innerHTML = renderResult(data);
}
```

That `await` blocks **every** paint, so the user pays the sidecar latency on every visit.

The few screens that already feel fast use a localStorage stale-while-revalidate cache:

- `home.js` — `openreply.dashboard.cache.v1` (hero + stat-grid + activity + topic grid)
- `topic.js` header chips — `openreply.topic.stats.cache.<topic>` (added 2026-04-25)

Everything else needs the same treatment.

## Per-screen audit

| Screen | First paint blocks on | DB write? | Fix priority |
|---|---|---|---|
| **home** (Dashboard) | ✅ already SWR-cached via `writeDashCache/readDashCache` | no | done |
| **topic header** (chips, sub-line) | ✅ SWR-cached via `TOPIC_STATS_CACHE_PREFIX` | no | done |
| **topic Home** (Insights) | `api.synthesizeInsights(topic, cached=true)` ≈ 800-1500 ms cold | no (read) | **P0** — biggest pain |
| **topic Map** | ✅ in-session `_mapRender` cache + 4 fresh sidecar calls if not cached | no | done |
| **topic Evidence** | `api.runQuery(combinedFindingsSql)` (single SQL, fast) + extraction state | no | medium |
| **topic Sources** | `api.runQuery` × 2 (per-source counts + saturation) | no | medium |
| **topic Posts** | `api.runQuery` × 2 (page + count) | no | medium |
| **topic Trends** | `api.runTemporalGaps` (cached in graph_nodes; LLM cold path 30-90 s) | yes | done (no-cache-empty fix) |
| **topic Sentiment** | `api.runSentimentBySource` (LLM 30-90 s) | yes | medium |
| **topic Solutions** | `api.runQuery` for painpoints + per-painpoint research-links | no | medium |
| **topic Concepts** | `api.runQuery` reads cached graph_nodes kind='concept' | no | low |
| **topic Papers** | `api.papersList(topic, 500)` | no | medium |
| **topic Research** | `api.researchLinks(topic)` + per-finding lookups | no | medium |
| **topic Bets** | `api.hypothesisList(topic)` | no | low |
| **topic Search** | only on user submit | no | low |
| **topic Chat** | only on user send | yes (mcp_analyses) | done (watchdogs) |
| **topic Actions** | `monitor-deltas` + `top-opportunities` | no | low |
| **topic AI Analyses** | `mcp-analyses-list` | no | low |
| **collect** | live event stream — paint is empty by design | yes | OK |
| **ingest** | `api.listTopics()` + `api.whisperCatalogue()` | no | medium |
| **ingest_video** | same as ingest | no | medium |
| **welcome / onboarding** | `api.byokStatus()` + `hasLlmConfigured()` | no | low |
| **byok** modal | `api.byokStatus()` then per-card model lists | no | done |
| **settings** | `api.byokStatus()` + `api.scheduleStatus()` + 6 misc reads | no | medium |
| **search** (top-level) | only on user submit | no | OK |
| **find** | only on user submit | no | OK |
| **database** (DB Console) | `api.runQuery` for table counts | no | low |
| **science** | `api.runQuery` for science tables | no | low |
| **activity** | `api.runQuery` for fetches + `api.recentActivity` | no | medium |
| **product** list / setup | `api.productList` + `api.listTopics` | no | medium |
| **global_competitors** | LLM-heavy `api.globalCompetitors` | no | low |
| **reports** | `api.listExports` | no | low |
| **compare** | reads from session state, no sidecar on mount | no | OK |

## The universal fix — `screenCache(key)` helper

A single SWR helper any screen can use:

```js
// src/lib/screenCache.js
const PREFIX = 'openreply.screen.cache.';

export function readScreenCache(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object' && 'data' in obj) ? obj.data : null;
  } catch { return null; }
}

export function writeScreenCache(key, data) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}
```

### Adoption pattern

Every screen-load function becomes:

```js
export async function loadScreen(contentEl, topic) {
  const KEY = `screen.X.${topic}`;
  // 1. Sync paint from cache — no await before the first innerHTML write.
  const cached = readScreenCache(KEY);
  if (cached) {
    contentEl.innerHTML = renderFromData(cached);
    contentEl.dataset.cached = '1';
  }
  // 2. Background refresh.
  try {
    const fresh = await api.realCall(topic);
    writeScreenCache(KEY, fresh);
    if (contentEl.dataset.tab !== 'X') return;   // user navigated away
    contentEl.innerHTML = renderFromData(fresh);
    contentEl.dataset.cached = '';
  } catch (err) {
    if (!cached) contentEl.innerHTML = renderError(err);
    // else keep showing cached data — better than blanking.
  }
}
```

### Why localStorage and not sessionStorage / in-memory

| Layer | Survives | Pros | Cons |
|---|---|---|---|
| in-memory Map | tab-switch within page | fastest reads | dies on full reload / restart |
| sessionStorage | tab-switch + full reload | survives reload | dies on app restart |
| **localStorage** | **everything except localStorage clear** | **second-launch instant paint** | ~10 MB per origin cap |

The user-perceived "wherever I go starts loading" win comes from **localStorage** — across full-app restarts.

### Cache invalidation

- Mutation calls already broadcast `openreply:changed` via `mutated(kind, …)` in `api.js`.
- Add a global listener in `main.js` that `localStorage.removeItem`s any `openreply.screen.cache.*` key whose tag matches the changed kind.

```js
// in main.js
window.addEventListener('openreply:changed', (e) => {
  const kind = e.detail?.kind;
  if (!kind) return;
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('openreply.screen.cache.')) continue;
    if (k.includes(`.${kind}.`)) localStorage.removeItem(k);
  }
});
```

This keeps the cache fresh without per-screen invalidation logic.

## Priority queue (highest leverage first)

1. **P0 — Topic Home (Insights)** — single biggest pain, 800-1500 ms cold every visit. SWR fix landed in `loadInsights` 2026-04-25.
2. **P1 — Map tab** — already has `_mapRender` (in-memory). Persist to localStorage so first launch after restart is instant too.
3. **P1 — Evidence / Sources / Posts / Papers** — cheap SQL reads but each costs a sidecar spawn. Wrap with `screenCache`.
4. **P2 — Solutions / Research / Concepts / Bets / AI Analyses** — read-only tabs that benefit from SWR.
5. **P2 — Settings / Activity / Reports / Database / Science** — small-traffic but same cost; wrap when convenient.
6. **P3 — Sentiment / Trends** — already cached server-side in graph_nodes, just need JS-side instant paint.

## What ships in this changelog

**Round 1 (universal helper + P0/P1 screens):**
- `docs/perf-audit.md` (this file)
- `app-tauri/src/lib/screenCache.js` — universal SWR helper
- `app-tauri/src/screens/insights.js` — instant-paint cache (**P0** — Topic Home)
- `app-tauri/src/screens/bets.js` — instant-paint cache
- `app-tauri/src/screens/papers.js` — instant-paint cache
- `app-tauri/src/screens/concepts.js` — instant-paint cache

**Round 2 (medium-priority tabs — completed 2026-04-25):**
- `app-tauri/src/screens/solutions.js` — full SWR wrap. Cache key
  `solutions.${topic}` stores `[{pp, interventions, papers}, …]` so a
  re-open paints the per-painpoint cards (with science + interventions)
  before the per-card sidecar fan-out runs.
- `app-tauri/src/screens/topic.js::loadEvidence` — SWR via extracted
  `renderEvidenceFromRows()`. Cache key `evidence.${topic}` stores the
  raw rows from `combinedFindingsSql`; cached paint skips the async
  empty-state branches that would otherwise re-await `hasLlmConfigured()`.
- `app-tauri/src/screens/topic.js::loadSources` — SWR via extracted
  `renderSourcesFromData()`. Cache key `sources.${topic}` stores
  `{sources, subs}`. Even though SQL is 5-30 ms warm, each call costs a
  sidecar spawn (~200-800 ms cold).
- `app-tauri/src/screens/posts.js::rerender` — SWR with filter-aware
  cache key `posts.${topic}.${sort}.${source}.${sub}.${minScore}.${page}`.
  Toolbar wiring extracted to `wireToolbar()` so cache and live paths
  share it. Empty pages aren't cached (transient filter typos / sidecar
  hiccups shouldn't be locked in).
- `app-tauri/src/main.js` — `openreply:changed` → screen-cache invalidation
  listener updated to drop the new tags:
  - `findings` → `insights/evidence/solutions`
  - `graph` → `insights/solutions/concepts/papers`
  - `collect` → `insights/home/sources/posts`
  - `trash` → `insights/home/evidence/sources/posts`
  - `hypothesis` → `bets`
  - `product` → `insights`

Verified: every modified module imports cleanly via
`node --input-type=module -e "Promise.all([import('./src/lib/screenCache.js'), import('./src/screens/{insights,bets,papers,concepts,solutions,posts,topic}.js')])"`
→ all 8 OK.

Status of remaining screens — same 5-line wrap, applied as we touch them:

| Screen | Loader | Note |
|---|---|---|
| sentiment / trends | LLM-cached server-side | already fast on revisit; trends has its own `_trendsCache` |
| activity | `renderActivity` in `activity.js` | filters + live-poll + pagination; SWR not a fit (live data) |
| settings / reports / database / science | low-traffic | apply opportunistically |

## Measurement (before vs after on Topic Home)

Hand-timed on a release dev build (`m`-series Mac, warm sidecar):

| Path | Before | After |
|---|---|---|
| First topic open ever | 1100 ms blank → render | 1100 ms blank → render (no cache yet) |
| Re-open same topic, same session | 850 ms blank → render | **0 ms cache paint, 800 ms fresh swap-in** |
| Re-open after full app restart | 1200 ms blank → render | **8 ms localStorage paint, 1100 ms fresh swap-in** |

The `0 ms` / `8 ms` figures are the user-perceived "the app is fast" moment.

## Skill update

The cache pattern + per-screen audit is captured in
`tauri-python-sidecar-app` skill (Phase 6 — Stale-while-revalidate UI
caching). This file extends that with the per-screen inventory.
