// Thin wrapper over Tauri's invoke + event API, plus a two-layer cache:
//
//   1) **In-flight dedup** — if the same idempotent query is already being
//      awaited, callers share one promise instead of each spawning a new
//      Python process. Critical for rapid sidebar navigation.
//
//   2) **Short TTL memoisation** — every idempotent read caches its last
//      result in memory for `ttlMs`. Clicking Dashboard → Activity → back
//      to Dashboard within 5s reads from memory instead of respawning the
//      sidecar. Write/mutation calls bypass the cache and invalidate it.
//
// Only read-only / stat queries are cached. Streaming + write commands
// (startCollect, byokSet, buildGraph, enrichGraph, ingestFile, delete_topic)
// always hit the sidecar fresh.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

if (typeof window !== 'undefined') {
  const inTauri = typeof isTauri === 'function' ? isTauri() : !!window.__TAURI_INTERNALS__;
  console.info('[api] tauri runtime:', inTauri ? 'yes' : 'NO');
}

// ---------- cache internals ----------
// `_cache` is keyed by `(name, args-json)`. Without a bound, every distinct
// arg combination accumulates an entry forever — `run_query` with thousands of
// unique SQL strings, `get_findings` per-topic, `topic_saturation` per-topic,
// `recent_activity` with shifting time windows etc. all add entries that
// `mutated()` may not target (its INVALIDATE_MAP only knows a fixed list of
// names). Over a long session this is a real leak — the JS heap keeps every
// past response alive. Cap at MAX_CACHE_ENTRIES, evict oldest-by-ts when over.
const _cache = new Map();     // key → { value, ts }
const _inflight = new Map();  // key → Promise
const MAX_CACHE_ENTRIES = 200;
// Default TTL for idempotent reads. 5s is short enough that data feels
// live (Dashboard won't miss a collect that just finished) but long enough
// that sidebar pogo-sticking doesn't re-fetch.
const DEFAULT_TTL_MS = 5000;

function cacheKey(name, args) {
  return args == null ? name : `${name}:${JSON.stringify(args)}`;
}

// ---------- localStorage SWR (cross-session "instant paint") ----------
// In-memory `_cache` evaporates on page reload. For read-only stats whose
// values rarely change between sessions (Bets pill counts, saturation hints,
// coverage gaps, BYOK status), persist the last result to localStorage so
// that the *next* topic-page open (even after a fresh app launch) resolves
// from disk in microseconds instead of paying a Python-sidecar spawn. Only
// callers that opt in via `persistTtlMs` write/read here.
const PERSIST_PREFIX = 'gapmap.api.cache.';

// Cross-navigation SWR window for read-only "build output" reads (empathy
// maps, product-strategy analyses, PMF/pricing surveys, PERT, audience
// personas, launch briefs, …). These change ONLY on an explicit user
// build/run, and every such mutation calls `invalidate('<command>')` (which
// clears both the in-memory map AND this localStorage mirror). So a generous
// persist window is safe: a revisit paints instantly from disk while a
// background fetch refreshes, and the next mutation wipes the stale entry.
// Deliberately NOT applied to volatile status/poll reads (pipeline_status,
// iterate_status, *_worker_status, runtime_snapshot, collect/stream/chat
// status) — a stale "running 3/7" there is worse than a slow-but-fresh one.
const SWR_BUILD_OUTPUT_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

function readPersisted(key, ttlMs) {
  try {
    const raw = localStorage.getItem(PERSIST_PREFIX + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || typeof obj._ts !== 'number') return null;
    if (Date.now() - obj._ts > ttlMs) return null;
    return obj.value;
  } catch { return null; }
}
function writePersisted(key, value) {
  try {
    localStorage.setItem(PERSIST_PREFIX + key, JSON.stringify({ value, _ts: Date.now() }));
  } catch {}
}

function evictIfOverCap() {
  if (_cache.size <= MAX_CACHE_ENTRIES) return;
  // Drop the 25% oldest entries by ts. Sorting once and slicing is cheaper
  // than evicting one-at-a-time when many big sessions land at once. JS
  // Map iteration order is insertion order so we can't rely on it for ts —
  // sort explicitly.
  const drop = Math.ceil(MAX_CACHE_ENTRIES * 0.25);
  const entries = [..._cache.entries()].sort((a, b) => a[1].ts - b[1].ts);
  for (let i = 0; i < drop && i < entries.length; i++) {
    _cache.delete(entries[i][0]);
  }
}

// A transient sidecar failure (Python import hiccup, brief lock contention,
// ECONNRESET on an Ollama call mid-startup) looks like a thrown Error whose
// message matches one of these patterns. Never retry a genuine logic error
// ("no such table", "ANTHROPIC_API_KEY not set" etc.) — users need to see
// those.
const TRANSIENT_PATTERNS = [
  /spawn failed/i,
  /resource temporarily unavailable/i,
  /broken pipe/i,
  /bad file descriptor/i,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /timed? ?out/i,
];
function isTransient(e) {
  const msg = (e?.message || e || '').toString();
  return TRANSIENT_PATTERNS.some(re => re.test(msg));
}

// Detect the parse-error sentinel the Rust `parse_or_diagnostic` helper
// returns when the Python sidecar emitted non-JSON stdout (traceback,
// Rich-formatted output, empty stdout). Throwing here lets existing
// .catch() blocks render the real Python error instead of the silently-
// null UI we used to get. See cli.rs::parse_or_diagnostic + the
// 2026-04-20 audit-fixes plan, Fix 3.
function throwIfParseError(name, result) {
  if (result && typeof result === 'object' && result._parse_error) {
    const raw = String(result._raw || '').slice(0, 800);
    const msg = result._parse_error_message || 'non-JSON output';
    const err = new Error(`[${name}] sidecar returned non-JSON: ${msg}\n--- raw output ---\n${raw}`);
    err.parseError = true;
    err.raw = result._raw;
    throw err;
  }
  return result;
}

// Default 90s per-call timeout. Tauri's `invoke()` has no built-in timeout,
// so a hung Python sidecar (cold-spawn, deadlock, anything) leaves every
// caller stuck on a Promise that never resolves — which the UI renders as
// infinite skeletons. Wrapping each invoke in a Promise.race surfaces a
// clean error after 90s; the caller's .catch can show a Retry button.
//
// Override per-call by passing { __timeoutMs } in args (read here and
// stripped before forwarding). Long-running commands (collect, paper
// pipeline, deep enrich) should pass a higher value or run via the
// dedicated streaming API instead of cachedInvoke.
const DEFAULT_INVOKE_TIMEOUT_MS = 90_000;
function invokeWithTimeout(name, args, timeoutMs) {
  let cleanedArgs = args;
  let ms = timeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;
  if (args && typeof args === 'object' && args.__timeoutMs != null) {
    ms = Number(args.__timeoutMs) || ms;
    cleanedArgs = { ...args };
    delete cleanedArgs.__timeoutMs;
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Timed out after ${Math.round(ms / 1000)}s waiting for "${name}". The sidecar may be cold-starting or busy — try again.`));
    }, ms);
    invoke(name, cleanedArgs).then(
      v => { if (settled) return; settled = true; clearTimeout(t); resolve(v); },
      e => { if (settled) return; settled = true; clearTimeout(t); reject(e); },
    );
  });
}

async function invokeWithRetry(name, args) {
  try {
    return throwIfParseError(name, await invokeWithTimeout(name, args));
  } catch (e) {
    if (!isTransient(e)) throw e;
    // Back off once, then try again. If it still fails, surface the error.
    await new Promise(r => setTimeout(r, 500));
    return throwIfParseError(name, await invokeWithTimeout(name, args));
  }
}

async function cachedInvoke(name, args, ttlMs = DEFAULT_TTL_MS, persistTtlMs = 0) {
  const key = cacheKey(name, args);
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && now - hit.ts < ttlMs) return hit.value;

  // localStorage SWR — when caller opted in via `persistTtlMs`, resolve from
  // disk immediately if the persisted value is still within the cross-session
  // freshness window. Kick off a background fetch to keep things current; the
  // persisted value is fine to surface meanwhile (these are stats that only
  // change on explicit user action, which invalidates everything anyway).
  if (persistTtlMs > 0) {
    const persisted = readPersisted(key, persistTtlMs);
    if (persisted != null) {
      _cache.set(key, { value: persisted, ts: now });
      if (!_inflight.has(key)) {
        const refresh = invokeWithRetry(name, args).then(value => {
          _cache.set(key, { value, ts: Date.now() });
          writePersisted(key, value);
          _inflight.delete(key);
          return value;
        }).catch(e => { _inflight.delete(key); throw e; });
        _inflight.set(key, refresh);
        refresh.catch(() => {}); // silent in background
      }
      return persisted;
    }
  }

  // In-flight dedup: multiple callers get the same promise
  if (_inflight.has(key)) return _inflight.get(key);
  const p = invokeWithRetry(name, args).then(value => {
    _cache.set(key, { value, ts: Date.now() });
    if (persistTtlMs > 0) writePersisted(key, value);
    evictIfOverCap();
    _inflight.delete(key);
    return value;
  }).catch(e => {
    _inflight.delete(key);
    throw e;
  });
  _inflight.set(key, p);
  return p;
}

// Generic dedup+TTL cache around an arbitrary async fetcher. Same shape as
// `cachedInvoke` but lets us cache results from anything (e.g. a thin native
// run_query wrapper that reshapes rows) under a stable key the existing
// `mutated()` invalidator already targets — without spawning the sidecar.
async function cachedFetch(key, fetcher, ttlMs = DEFAULT_TTL_MS, persistTtlMs = 0) {
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && now - hit.ts < ttlMs) return hit.value;

  if (persistTtlMs > 0) {
    const persisted = readPersisted(key, persistTtlMs);
    if (persisted != null) {
      _cache.set(key, { value: persisted, ts: now });
      if (!_inflight.has(key)) {
        const refresh = Promise.resolve().then(fetcher).then(value => {
          _cache.set(key, { value, ts: Date.now() });
          writePersisted(key, value);
          _inflight.delete(key);
          return value;
        }).catch(e => { _inflight.delete(key); throw e; });
        _inflight.set(key, refresh);
        refresh.catch(() => {});
      }
      return persisted;
    }
  }

  if (_inflight.has(key)) return _inflight.get(key);
  const p = Promise.resolve().then(fetcher).then(value => {
    _cache.set(key, { value, ts: Date.now() });
    if (persistTtlMs > 0) writePersisted(key, value);
    evictIfOverCap();
    _inflight.delete(key);
    return value;
  }).catch(e => {
    _inflight.delete(key);
    throw e;
  });
  _inflight.set(key, p);
  return p;
}

function invalidate(...nameOrPrefixes) {
  // Clear any cache entry whose key equals or starts with the given prefix —
  // BOTH in-memory AND any localStorage SWR mirror, so writes don't leak
  // stale persisted values across sessions.
  for (const np of nameOrPrefixes) {
    for (const k of [..._cache.keys()]) {
      if (k === np || k.startsWith(np + ':')) _cache.delete(k);
    }
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const lk = localStorage.key(i);
        if (!lk || !lk.startsWith(PERSIST_PREFIX)) continue;
        const inner = lk.slice(PERSIST_PREFIX.length);
        if (inner === np || inner.startsWith(np + ':')) {
          localStorage.removeItem(lk);
        }
      }
    } catch {}
  }
}

export function clearApiCache() { _cache.clear(); _inflight.clear(); }

/**
 * Memory snapshot for leak hunting. Call from DevTools console:
 *   await window.__gapmapMemStats()
 *
 * Returns:
 *   - js: webview-side cache + map sizes + heap (when Chrome's
 *         performance.memory is available, which it is in Tauri's
 *         WKWebView wrapper on macOS).
 *   - rust: rust process RSS (MB) + Active* slot states + sidecar pids/RSS.
 *
 * Sample once, run a "bad" workflow (open Map tab 50 times, run enrich on 5
 * topics, etc.), sample again — diff to see which counter grew. The big
 * leak suspects to watch:
 *   - js.api_cache_size — should plateau under 200 (we cap)
 *   - js.map_render_cache_size — bounded per-topic, should equal # topics opened
 *   - rust.slots.graph_inflight_count — should drop to 0 between calls
 *   - rust.sidecars[*].rss_mb — Python sidecar RSS over time
 */
async function memStats() {
  const js = {
    api_cache_size: _cache.size,
    api_inflight_size: _inflight.size,
    cache_keys_sample: [..._cache.keys()].slice(0, 10),
  };
  // Optional caches living in screens/* — read via globals we know exist.
  try {
    const w = typeof window !== 'undefined' ? window : null;
    if (w && w.performance && w.performance.memory) {
      const m = w.performance.memory;
      js.heap_used_mb = Math.round(m.usedJSHeapSize / (1024 * 1024));
      js.heap_total_mb = Math.round(m.totalJSHeapSize / (1024 * 1024));
      js.heap_limit_mb = Math.round(m.jsHeapSizeLimit / (1024 * 1024));
    }
  } catch {}

  let rust = null;
  try {
    rust = await invoke('mem_stats');
  } catch (e) {
    rust = { error: String(e?.message || e) };
  }
  return { ts: Date.now(), js, rust };
}

if (typeof window !== 'undefined') {
  // Expose so devs can call from the console without imports. Always returns
  // a Promise; non-Tauri contexts get js-only stats.
  window.__gapmapMemStats = memStats;
}
export { memStats };

/**
 * Broadcast an in-app mutation so every open screen can refresh.
 *
 * Problem this solves: `invalidate()` clears the cache but doesn't tell
 * listeners anything changed — they keep showing stale data until something
 * else re-fetches. After any write (startCollect, deleteTopic, ingestFile,
 * enrichGraph, byokSet, hypothesis*, productSweep, …) call `mutated(kind)`
 * to invalidate the right cache keys AND dispatch `gapmap:changed` with
 * `{ kind, ts }`. Nav counts refresh. Screens that care (home, topics,
 * dashboard, sidebar counts) subscribe and re-render immediately.
 *
 * `kind` is one of: 'topics' | 'findings' | 'collect' | 'graph' | 'findings'
 * | 'exports' | 'byok' | 'hypothesis' | 'product' | 'schedule' | 'ingest'.
 * Custom strings are fine — listeners can match specific kinds or treat all
 * changes the same. Always broadcast; never skip. Cheap event dispatch.
 */
const INVALIDATE_MAP = {
  topics:     ['list_topics', 'overview_stats', 'recent_activity', 'cli_info', 'run_query', 'list_trash', 'topic_counts_bundle'],
  collect:    ['list_topics', 'overview_stats', 'recent_activity', 'cli_info', 'run_query', 'get_findings', 'topic_saturation', 'topic_coverage_gaps', 'topic_counts_bundle', 'papers_list_native'],
  ingest:     ['list_topics', 'overview_stats', 'recent_activity', 'run_query', 'topic_coverage_gaps', 'topic_counts_bundle', 'papers_list_native'],
  graph:      ['list_topics', 'overview_stats', 'get_findings', 'run_query', 'topic_saturation', 'topic_coverage_gaps', 'topic_counts_bundle', 'topic_insights_cached', 'solutions_data_bundle'],
  findings:   ['list_topics', 'overview_stats', 'get_findings', 'run_query', 'paper_analyses_get', 'topic_saturation', 'topic_coverage_gaps', 'topic_counts_bundle', 'topic_insights_cached', 'solutions_data_bundle'],
  exports:    ['list_exports'],
  byok:       ['byok_status', 'list_provider_models', 'cli_info'],
  hypothesis: ['hypothesis_list', 'hypothesis_list_native', 'hypothesis_stats'],
  product:    ['list_products', 'product_get', 'product_signals', 'product_digest', 'overview_stats'],
  schedule:   ['schedule_status'],
  trash:      ['list_trash', 'list_topics', 'overview_stats'],
  // Task 9.5 — extraction prefs + daily token spend live in Rust-native
  // SQLite + extraction.json; any write mutates both caches.
  extraction_prefs: ['extraction_prefs_get', 'today_token_spend'],
};
export function mutated(kind, extra = {}) {
  const keys = INVALIDATE_MAP[kind] || [];
  invalidate(...keys);
  try {
    window.dispatchEvent(new CustomEvent('gapmap:changed', {
      detail: { kind, ts: Date.now(), ...extra },
    }));
  } catch {}
}

// ---------- DB-freshness poller ----------
//
// Polls `db_mtime` (a cheap stat syscall — no Python spawn) every 5 s while
// the window is visible. If the SQLite file has been touched since the last
// check (meaning something outside this app wrote to it — background collect,
// MCP server, manual CLI run), we clear the cache and dispatch a
// `gapmap:db-changed` event so open screens can re-fetch if they want truly
// live data.
//
// Writes from *within* this app already invalidate via the explicit calls in
// the api surface above — this poller specifically catches *external* writes.
let _lastMtime = 0;
let _pollTimer = null;
let _pollStarted = false;

async function pollOnce() {
  try {
    const mtime = await invoke('db_mtime');
    if (mtime && mtime !== _lastMtime) {
      if (_lastMtime !== 0) {
        // Real change (not the first observation) — clear cache + notify.
        clearApiCache();
        try {
          window.dispatchEvent(new CustomEvent('gapmap:db-changed', { detail: { mtime } }));
        } catch {}
      }
      _lastMtime = mtime;
    }
  } catch {}
}

function startFreshnessPoller() {
  if (_pollStarted || typeof document === 'undefined') return;
  _pollStarted = true;
  const tick = () => {
    if (document.visibilityState === 'visible') pollOnce();
  };
  // Fire once now to prime _lastMtime without triggering an invalidate, then
  // every 5 s while visible.
  pollOnce();
  _pollTimer = setInterval(tick, 5000);
  // Also poll immediately when the tab regains focus so a user Tab-ing back
  // into Gap Map after running the CLI sees fresh data within ~100 ms.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pollOnce();
  });
}

// Kick off on module load. Safe to call from non-Tauri contexts too (invoke
// throws → swallowed; no harm done in tests / SSR previews).
if (typeof window !== 'undefined') {
  // Defer one tick so invoke has a chance to exist.
  setTimeout(startFreshnessPoller, 50);
}

// ---------- api surface ----------
export const api = {
  // ----- idempotent reads (cached) -----
  // TTLs tuned per how often the underlying data realistically changes mid-session:
  //   - cli_info / list_topics: only change after a collect or delete → 30s
  //   - overview_stats: same driver → 15s
  //   - app_data_dir: never changes at runtime → 5 min
  //   - recent_activity: live feed, wants freshness → 2s
  //   - byok_status: changes only when user edits keys (which invalidates) → 30s
  //   - get_findings / run_query: post-collect (invalidated on collect:done) → 10s
  //   - list_exports: changes only after export button click (invalidated there) → 30s
  cliInfo:         ()        => cachedInvoke('cli_info',       null, 30000),
  listTopics:      ()        => cachedInvoke('list_topics',    null, 30000),
  // No cache — when a collect just started or the Rust process restarted
  // mid-session, a stale empty hit makes the manager screen lie about
  // what's running. Always read fresh; the call is < 1ms (in-memory map).
  activeCollects:  ()        => invoke('active_collects'),
  overviewStats:   ()        => cachedInvoke('overview_stats', null, 15000),
  recentActivity:  ()        => cachedInvoke('recent_activity', null, 2000),
  topicGraphSummary: (topic) => cachedInvoke('topic_graph_summary', { topic }, 15000),
  appDataDir:      ()        => cachedInvoke('app_data_dir',   null, 300000),
  healthCheck:     ()        => invoke('health_check'),
  listExports:     ()        => cachedInvoke('list_exports',   null, 30000),
  exportPrefsGet:  ()        => cachedInvoke('export_prefs_get', null, 30000),
  // SWR-persisted: BYOK status only changes when the user edits keys (which
  // calls `mutated('byok')` → invalidates both cache layers). Persisting it
  // for 30 min eliminates the topic-open spawn for the LLM-config readiness
  // check on every page mount.
  byokStatus:      ()        => cachedInvoke('byok_status',    null, 60000, 30 * 60 * 1000),
  deviceSignature: ()        => cachedInvoke('device_signature', null, 60000),
  licenseStatus:   ()        => cachedInvoke('license_status', null, 10000),
  getFindings:     (topic, kind) => cachedInvoke('get_findings', { topic, kind }, 30000, SWR_BUILD_OUTPUT_MS),
  runQuery:        (sql, topic, params) => cachedInvoke('run_query', { sql, topic, params }, 10000),

  // Bundled per-topic counts for every tab freshness badge. One rusqlite
  // round-trip replaces 11 individual `runQuery` calls. Cache for 15 s —
  // counts only change on collect / enrich / ingest, all of which call
  // `mutated('graph'|'collect'|'findings')` and invalidate this key
  // explicitly via the INVALIDATE_MAP entries below.
  topicCountsBundle: (topic) =>
    cachedInvoke('topic_counts_bundle', { topic }, 15000),

  // Solutions tab data — replaces N+1 painpoint × {interventions, papers}
  // fan-out. Bundles all three SELECTs into one Tauri call that returns
  // pre-stitched `{ painpoints: [{ pp, interventions, papers }] }`.
  solutionsDataBundle: (topic) =>
    cachedInvoke('solutions_data_bundle', { topic }, 30000),
  diffFindings:    (topic, windowDays = 7) => cachedInvoke('diff_findings', { topic, windowDays }, 30000),

  // ----- per-paper LLM analysis (Research tab) -----
  analyzePaper:      (topic, postId) => {
    invalidate('paper_analyses_get');
    return invoke('analyze_paper', { topic, postId });
  },
  analyzePapersBulk: (topic, limit = null) => {
    invalidate('paper_analyses_get');
    return invoke('analyze_papers_bulk', { topic, limit });
  },
  paperAnalysesGet:  (topic) => cachedInvoke('paper_analyses_get', { topic }, 30000, SWR_BUILD_OUTPUT_MS),

  // ----- scheduled runs (launchd on macOS, stub elsewhere) -----
  scheduleStatus:    ()              => cachedInvoke('schedule_status', null, 10000),
  scheduleInstall:   (intervalHours) => invoke('schedule_install', { intervalHours }),
  scheduleUninstall: ()              => invoke('schedule_uninstall'),
  scheduleEnableTopic: (topic, enabled) => invoke('schedule_enable_topic', { topic, enabled }),
  scheduleMarkSeen:  (topic)         => invoke('schedule_mark_seen', { topic }),

  // ----- video ingest: yt-dlp + faster-whisper -----
  videoPreview:       (url)                  => invoke('ingest_video_preview', { url }),
  ingestVideo:        (url, topic, model, language) => {
    invalidate('list_topics', 'overview_stats', 'get_findings', 'run_query');
    return invoke('ingest_video', { url, topic, model, language });
  },
  // YouTube search via yt-dlp (no API key). Returns metadata for up to
  // `limit` videos — pair with `ingestVideo(url, topic, …)` to actually
  // pull the transcript into the corpus. Cached 60s; query+limit form
  // the cache key so re-searching the same phrase is instant.
  youtubeSearch:      (query, limit = 10) =>
    cachedInvoke('youtube_search', { query, limit }, 60000),
  whisperList:        ()                     => cachedInvoke('whisper_list',     null, 10000),
  whisperCatalogue:   ()                     => cachedInvoke('whisper_catalogue', null, 10000),
  whisperDownload:    (tier)                 => invoke('whisper_download', { tier }),
  whisperDelete:      (tier) => {
    invalidate('whisper_list', 'whisper_catalogue');
    return invoke('whisper_delete', { tier });
  },
  whisperSetDefault:  (tier) => {
    invalidate('whisper_list', 'whisper_catalogue');
    return invoke('whisper_set_default', { tier });
  },
  ytdlpVersion:       ()                     => cachedInvoke('ytdlp_version',     null, 60000),
  ytdlpUpdate:        (force = false)        => invoke('ytdlp_update', { force }),

  // ----- writes / side-effects (bypass + invalidate) -----
  discoverSubs:    (topic, limit = 10) => invoke('discover_subs', { topic, limit }),
  // Returns { original, canonical, variants, confidence, search_keywords }.
  // search_keywords is an array of { keyword, relevance: 'high'|'medium'|'low' }.
  canonicalizeTopic: (topic)            => invoke('canonicalize_topic', { topic }),
  // startCollect now takes an optional ifBusy policy ('error' | 'queue' |
  // 'cancel_and_start'). The default 'error' returns a structured response
  //   { ok: false, blocked: true, blocked_by: { topic, started_at,
  //     elapsed_secs } }
  // instead of throwing — the UI uses that to show an actionable modal
  // (cancel-and-start vs queue vs open-running-log) instead of the old
  // "another collect is already running. Cancel it first." error string.
  startCollect:    (topic, aggressive = true, sources = null, skipReddit = false,
                    ifBusy = 'error') => {
    const p = invoke('start_collect', {
      topic, aggressive, sources, skipReddit, ifBusy,
    });
    mutated('collect', { topic });
    return p;
  },
  cancelCollect:   ()        => invoke('cancel_collect'),
  // Force-clear a stale single-flight collect lock when the slot is held
  // but no live topic can be identified. Safe no-op when nothing is stuck —
  // returns { ok, was_orphan, slot_held, map_empty, killed } so callers can
  // distinguish "we cleared it" from "you weren't actually stuck".
  clearOrphanCollectLock: () => invoke('clear_orphan_collect_lock'),
  collectStatus:   ()        => invoke('collect_status'),
  // Pending FIFO queue (collects waiting for the running one to finish).
  listCollectQueue:   ()        => invoke('list_collect_queue'),
  cancelQueuedCollect: (topic)  => invoke('cancel_queued_collect', { topic }),
  // Static catalog of external sources the next collect will sweep.
  // Mirrors the source list in `research/collect.py` (aggressive vs quick).
  collectSourceCatalog: (aggressive = true) =>
    invoke('collect_source_catalog', { aggressive }),
  buildGraph:      (topic)   => {
    const p = invoke('build_graph', { topic });
    mutated('graph', { topic });
    return p;
  },
  enrichGraph:     (topic)   => {
    const p = invoke('enrich_graph', { topic });
    mutated('graph', { topic });
    return p;
  },
  /**
   * Streaming enrichment — returns immediately; subscribe to `enrich:progress`
   * (NDJSON lines) and `enrich:stream:done` ({code}) Tauri events via
   * `listen(...)` to observe progress.
   * @param {string} topic
   * @param {object} [opts]
   * @param {string|null} [opts.only] - painpoints|features|complaints|workarounds
   * @param {boolean}     [opts.parallel] - fan extractors out concurrently (cloud only)
   */
  enrichGraphStream: (topic, opts = {}) => {
    const p = invoke('enrich_graph_stream', {
      topic,
      only: opts.only || null,
      parallel: opts.parallel === true,
    });
    mutated('graph', { topic });
    return p;
  },
  relateGraph:     (topic)   => {
    const p = invoke('relate_graph', { topic });
    mutated('graph', { topic });
    return p;
  },
  // Force-clear the graph-op inflight registry. Use when a sticky
  // "Already running" response hangs around after a crashed/cancelled
  // enrich (the Rust side auto-expires after 10 min; this is the manual
  // override). Omit both args to clear everything.
  clearGraphInflight: (topic = null, op = null) => invoke('clear_graph_inflight', { topic, op }),
  // Preempt an in-flight enrich: SIGTERMs the live sidecar child AND clears
  // the per-topic dedup lock in one round-trip. Use when a manual user
  // click should take priority over a background auto-enrich that's still
  // running. Pass null/omit `topic` to preempt every enrich. Returns
  // `{ok, killed:boolean, cleared:string[]}` — `killed:false` means no
  // enrich was actually running, so the follow-up `enrichGraphStream`
  // call will just spawn fresh with no surprise.
  cancelEnrich: (topic = null) => invoke('cancel_enrich_for_topic', { topic }),

  // App reset / clean-install (Settings → Danger Zone). All three are
  // safe to call from the FE without any user-confirmation flag — the
  // confirmation lives in the UI layer (typed-DELETE modal). The Rust
  // commands deliberately do NOT have a "are you sure" guard so the
  // CLI / test harnesses can use them programmatically.
  //
  //   appResetPreview() → read-only summary {data_dir, data_mb,
  //     topic_count, license_email, byok_providers:[]} for the modal.
  //   appHardReset()    → wipes data_dir + BYOK env file; FE must
  //     follow up with localStorage.clear() AND appRelaunch().
  //   appRelaunch()     → calls Tauri's AppHandle::restart() — process
  //     is replaced; the promise never resolves on success.
  appResetPreview: () => invoke('app_reset_preview'),
  appHardReset:    () => invoke('app_hard_reset'),
  appRelaunch:     () => invoke('app_relaunch'),

  exportHtml:      (topic, forceOrOpts = false) => {
    const opts = (typeof forceOrOpts === 'object' && forceOrOpts !== null)
      ? forceOrOpts
      : { force: !!forceOrOpts };
    const p = invoke('export_html', {
      topic,
      force: !!opts.force,
      mode: opts.mode || null,
      maxPostNodes: Number.isFinite(opts.maxPostNodes) ? opts.maxPostNodes : null,
    });
    mutated('exports', { topic });
    return p;
  },
  exportGraphJson: (topic)   => invoke('export_graph_json', { topic }),
  exportReportPro: (topic)   => {
    const p = invoke('export_report_pro', { topic });
    mutated('exports', { topic });
    return p;
  },
  ingestFile:      (path, topic, sourceType) => {
    const p = invoke('ingest_file', { path, topic, sourceType });
    mutated('ingest', { topic });
    return p;
  },
  /**
   * Recursively ingest every supported file in a folder into one topic.
   * @param {object} opts
   * @param {string} opts.path - absolute folder path
   * @param {string} opts.topic
   * @param {string} opts.sourceType - free-form tag (e.g. 'learning_material', 'spec')
   * @param {string} [opts.extensions] - comma-separated overrides (e.g. 'md,txt'). Default md/pdf/csv/json/txt/vtt/srt.
   * @param {number} [opts.maxFiles=500] - safety cap; the Python side aborts if the walker exceeds this.
   */
  ingestFolder: ({ path, topic, sourceType, extensions = null, maxFiles = 500 }) => {
    const p = invoke('ingest_folder', {
      path, topic, sourceType,
      extensions: extensions || null,
      maxFiles: Number.isFinite(maxFiles) ? maxFiles : 500,
    });
    mutated('ingest', { topic });
    return p;
  },
  // Soft-delete (T1.3): 7-day undo window via api.restoreTopic + listTrash.
  deleteTopic:     (topic)   => {
    // Do NOT broadcast optimistically for delete/restore. If we emit before
    // SQLite commit, screens can re-fetch the old row and memoize it for TTL.
    return invoke('delete_topic', { topic }).then((res) => {
      mutated('topics', { topic, action: 'delete' });
      return res;
    });
  },
  restoreTopic:    (topic)   => {
    return invoke('restore_topic', { topic }).then((res) => {
      mutated('topics', { topic, action: 'restore' });
      return res;
    });
  },
  listTrash:       ()        => cachedInvoke('list_trash', null, 10000),
  purgeDeletedTopics: (minAgeDays = 7) => {
    const p = invoke('purge_deleted_topics', { minAgeDays });
    mutated('trash');
    return p;
  },
  revealInFinder:  (path)    => invoke('reveal_in_finder', { path }),
  exportPrefsSet:  (exportDir) => {
    const p = invoke('export_prefs_set', { exportDir });
    mutated('exports');
    invalidate('export_prefs_get', 'list_exports');
    return p;
  },
  openUrl:         (url)     => invoke('open_url', { url }),
  // Force a full byok_status re-fetch on next call, bypassing the 30s
  // memoise. Used after Rust rebuilds or out-of-band .env edits where
  // the cached object still claims a provider is missing even though
  // the fresh binary now reports it (e.g. adding a new provider arm
  // mid-session). Cheap — next caller pays the round-trip.
  byokInvalidate:  () => { invalidate('byok_status', 'list_provider_models', 'cli_info'); },
  byokSet:         (name, value) => {
    // Any key change can unlock or lock a provider's /models endpoint — nuke
    // both caches so the next modal open fetches fresh.
    const p = invoke('byok_set', { name, value });
    mutated('byok');
    return p;
  },
  licenseActivate: (apiBase, email, password, activationKey, onboarding = null) => {
    invalidate('license_status');
    return invoke('license_activate', {
      apiBase,
      email,
      password,
      activationKey,
      onboarding,
    });
  },
  licenseServerCheck: (apiBase) => invoke('license_server_check', { apiBase }),
  licenseDefaultApiBase: () => invoke('license_default_api_base'),
  licenseLogout:    () => {
    invalidate('license_status');
    return invoke('license_logout');
  },
  startChat:       (topic, question, mode, agent = false) => invoke('start_chat', { topic, question, mode, agent }),
  cancelChat:      ()        => invoke('cancel_chat'),
  chatStatus:      ()        => invoke('chat_status'),
  testLlm:         (provider, model) => invoke('test_llm', { provider, model }),
  listOllamaModels: ()       => cachedInvoke('list_ollama_models', null, 10000),
  // Dynamic model list from any configured cloud provider's /models endpoint.
  // Cached for 5 minutes so opening the BYOK modal repeatedly doesn't hammer
  // the provider's API (most enforce a rate limit). Fresh fetch on first open
  // after a new API key is saved — the cache key includes the provider name
  // only, so clearing the cache after a byokSet is how we pick up changes.
  listProviderModels: (provider) => cachedInvoke('list_provider_models', { provider }, 5 * 60 * 1000),
  ollamaStartService: ()     => invoke('ollama_start_service'),
  ollamaStopService:  ()     => invoke('ollama_stop_service'),
  closeSplash:        ()     => invoke('close_splash'),
  // Cheap stat-only call — never cached, used by the freshness poller.
  dbMtime:            ()     => invoke('db_mtime'),
  // Local semantic search via the ChromaDB palace. `topic` + `source` are
  // optional filters. `k` defaults to 10. Results carry {id, score, text,
  // metadata}.
  semanticSearch:     (query, { topic, source, k = 10 } = {}) =>
    invoke('semantic_search', { query, topic, source, k }),
  relatedPosts:       (postId, { k = 10, topic } = {}) =>
    invoke('related_posts', { postId, k, topic }),
  reindexPalace:      ()     => {
    invalidate('palace_stats'); invalidate('palace_model_status');
    return invoke('reindex_palace');
  },
  // 30s in-memory + 5-minute persisted cache. Palace stats only change on
  // explicit reindex (which invalidates both layers via mutated('graph')),
  // so a cross-session warm read here saves the chromadb import on every
  // Settings open. The first warm-up call after boot fills both caches.
  palaceStats:        ()     => cachedInvoke('palace_stats',        null, 30000, 5 * 60 * 1000),
  // Hybrid-download opt-in. `installed` = retrieval extras wheels present,
  // `ready` = ONNX model file cached. UI renders different cards per state.
  // Same caching shape as palaceStats — only changes on Install/Reindex.
  palaceModelStatus:  ()     => cachedInvoke('palace_model_status', null, 30000, 5 * 60 * 1000),
  // Kicks off the ~80 MB ONNX model download; subscribe to
  // `palace:warmup:progress` for {event, bytes, total, pct} events and
  // `palace:warmup:done` for the {code} exit.
  palaceWarmup:       ()     => {
    invalidate('palace_stats'); invalidate('palace_model_status');
    return invoke('palace_warmup');
  },
  // Runtime pre-warm — load chromadb + MiniLM ONNX into the sidecar daemon
  // process by issuing one trivial search. After this, the user's first
  // real semantic search skips the 2-3s cold-start (~36s under load) and
  // lands in ~50-200 ms. Idempotent; safe to call any time.
  palacePrewarm:      ()     => invoke('palace_prewarm'),
  // Re-embed every post into palace. Long-running; UI subscribes to
  // `palace:reindex:progress` for status + `palace:reindex:done` for
  // exit. Use after a chromadb upgrade (auto-heal resets palace) or
  // when the user clicks the explicit "Reindex" button in Settings.
  palaceReindex:      ()     => {
    invalidate('palace_stats'); invalidate('palace_model_status');
    return invoke('palace_reindex');
  },
  onPalaceWarmupProgress: (cb) => listen('palace:warmup:progress', e => cb(e.payload)),
  onPalaceWarmupDone:     (cb) => listen('palace:warmup:done',     e => cb(e.payload)),
  // Phase-1 Insight Engine — one long-context synthesis call across the
  // full multi-source corpus. `cached=true` returns the last persisted
  // report without re-running the LLM (cheap for tab re-renders). First
  // call per topic writes to the `topic_insights` table.
  // Cached read of an insights report is a single SELECT on `topic_insights`
  // — route it through the native rusqlite fast-path. Saves 50–200 ms warm
  // / 500–2000 ms cold per topic open. The non-cached branch (which actually
  // calls the LLM) still goes through the Python sidecar.
  synthesizeInsights: (topic, cached = false) =>
    cached
      ? cachedInvoke('topic_insights_cached', { topic }, 30000)
      : invoke('synthesize_insights', { topic, cached: false }),

  // Map-reduce chunked synth — N small LLM calls instead of one big one.
  // Use when the provider is low on credits (sidesteps 402 errors) or for
  // very large corpora. Returns a report with findings only (hypotheses/
  // exec_summary empty in chunked mode; deterministic merge on the Python
  // side does the cross-chunk dedup).
  //
  //   chunkSize           — rows per chunk; default 40
  //   maxWorkers          — null = auto per provider; 1 = sequential
  //   maxTokensPerChunk   — small (300-800) for low-credit providers
  synthesizeInsightsChunked: (topic, { chunkSize = 40, maxWorkers = null, maxTokensPerChunk = 800 } = {}) =>
    invoke('synthesize_insights_chunked', {
      topic,
      chunkSize,
      maxWorkers,
      maxTokensPerChunk,
    }),

  // Unified end-to-end gap-discovery — chunked LLM synth + palace
  // cross-source evidence + science fetch + solutions (Why + interventions)
  // + experiment proposals. Everything persists; Map/Insights/Research
  // pick up the new nodes automatically.
  runGapDiscovery: (topic, opts = {}) => {
    invalidate('list_topics', 'overview_stats', 'get_findings', 'run_query', 'paper_analyses_get', 'research_links');
    return invoke('run_gap_discovery', {
      topic,
      chunkSize: opts.chunkSize ?? null,
      maxWorkers: opts.maxWorkers ?? null,
      papersPerPainpoint: opts.papersPerPainpoint ?? 5,
      noExperiments: opts.noExperiments ?? false,
    });
  },
  listExperiments: (topic) => cachedInvoke('list_experiments', { topic }, 30000, SWR_BUILD_OUTPUT_MS),
  personaView: (topic, persona) => invoke('persona_view', { topic, persona }),

  // Phase-3 Hypothesis Tracking — tracked bets for user-validated research
  // findings. `cardJson` is the JSON-stringified hypothesis card from the
  // Insight Engine synthesis output. Status values: draft / running /
  // validated / invalidated / paused / archived. See
  // src/gapmap/research/hypothesis_tracker.py for the state machine.
  hypothesisCreate: (topic, cardJson, status = 'draft') => {
    invalidate('hypothesis_list', 'hypothesis_stats');
    return invoke('hypothesis_create', { topic, cardJson, status });
  },
  hypothesisUpdateStatus: (id, status, notes) => {
    invalidate('hypothesis_list', 'hypothesis_stats');
    return invoke('hypothesis_update_status', { id, status, notes });
  },
  // Bets list — native rusqlite path. Was a Python sidecar call
  // (~300–800 ms warm, 1500+ ms cold); now ~1 ms. JSON columns are
  // pre-hydrated by the native command so the frontend doesn't need to
  // parse `evidence_json` etc. itself.
  hypothesisList: (topic, status, includeArchived = false) =>
    cachedInvoke('hypothesis_list_native', { topic, status, includeArchived }, 30000),
  hypothesisDelete: (id) => {
    invalidate('hypothesis_list', 'hypothesis_stats');
    return invoke('hypothesis_delete', { id });
  },
  // Native run_query path — was a sidecar `research hypothesis-stats` spawn
  // (≈300-800 ms warm, 1-2 s cold on bundled DMG) on every topic-page open
  // for the Bets pill. The query is a trivial GROUP BY; running it through
  // `run_query` (read-only SQLite, sub-10 ms) eliminates the spawn. Cache
  // key kept as `hypothesis_stats:…` so `mutated('hypothesis')` still hits
  // it via the existing INVALIDATE_MAP entry. 60 s TTL because bets only
  // change on explicit user action — invalidation handles freshness.
  hypothesisStats: (topic) => {
    const key = `hypothesis_stats:${topic || ''}`;
    return cachedFetch(key, async () => {
      const sql = topic
        ? `SELECT status, count(*) AS n FROM hypothesis_tests
           WHERE topic = :topic AND status != 'archived'
           GROUP BY status`
        : `SELECT status, count(*) AS n FROM hypothesis_tests
           WHERE status != 'archived'
           GROUP BY status`;
      const rows = (await invokeWithRetry('run_query', { sql, topic: topic || null, params: null })) || [];
      const stats = {};
      for (const r of rows) {
        if (r && r.status != null) stats[r.status] = Number(r.n) || 0;
      }
      return { ok: true, topic: topic || null, stats };
    }, 60000, 10 * 60 * 1000);
  },

  // Phase-4 Monitoring — weekly delta tracking. `monitorRunTopic` re-runs
  // synthesize (and optionally collect) for a single topic, recording
  // what changed. `monitorDeltas(null)` returns the cross-topic dashboard
  // view; `monitorDeltas(topic)` returns that topic's run history.
  monitorRunTopic: (topic, skipCollect = true) => {
    invalidate('monitor_deltas', 'list_topics');
    return invoke('monitor_run_topic', { topic, skipCollect });
  },
  monitorTick: (skipCollect = true) => {
    invalidate('monitor_deltas', 'list_topics');
    return invoke('monitor_tick', { skipCollect });
  },
  monitorDeltas: (topic = null, limit = 10, sinceDays = 7) =>
    cachedInvoke('monitor_deltas', { topic, limit, sinceDays }, 30000),

  // Phase-5 — cross-topic queries
  topOpportunities: (limit = 20, minScore = 0) =>
    cachedInvoke('top_opportunities', { limit, minScore }, 30000),
  searchFindingsGlobal: (query, topic = null, limit = 30) =>
    cachedInvoke('search_findings_global', { query, topic, limit }, 15000),
  relatedTopicsFor: (topic, limit = 5) =>
    cachedInvoke('related_topics_for', { topic, limit }, 60000),

  // Phase-7 — export formats. Returns plain string (markdown/text).
  // format ∈ 'markdown' | 'hypotheses' | 'slack'.
  exportBrief: (topic, format = 'markdown') =>
    invoke('export_brief', { topic, format }),

  // Research-paper pipeline (outline/draft/experiments/export with citations)
  paperOutlineGenerate: (topic, provider = null) =>
    invoke('paper_outline_generate', { topic, provider }),
  paperDraftGenerate: (topic, provider = null, style = 'IMRaD') =>
    invoke('paper_draft_generate', { topic, provider, style }),
  experimentPlanGenerate: (topic, provider = null) => {
    // Writes the `experiments` table → drop the persisted list_experiments
    // SWR cache so the Experiments tab doesn't show stale data for 7 days.
    invalidate('list_experiments');
    return invoke('experiment_plan_generate', { topic, provider });
  },
  paperExportWithCitations: (topic, provider = null, format = 'markdown', style = 'IMRaD') =>
    invoke('paper_export_with_citations', { topic, provider, format, style }),

  // Phase-9 — competitor matrix
  competitorMatrix: (topic) =>
    cachedInvoke('competitor_matrix', { topic }, 30000),

  // Phase-10 — research↔finding palace linking
  linkResearch: (topic, k = 3) => {
    invalidate('research_links');
    return invoke('link_research', { topic, k });
  },
  researchLinks: (topic, finding = null) =>
    cachedInvoke('research_links', { topic, finding }, 30000),

  // Pre-check a user-entered topic string against existing corpus. Returns
  // {match: {existing_topic, posts}} if a semantically-identical topic
  // already exists (case/slug variant), else {match: null}. The UI should
  // use this to offer "Open existing · N posts" vs "Fetch new data into it"
  // vs "Create separate topic" instead of silently merging.
  findExistingTopic: (userInput) =>
    invoke('find_existing_topic', { userInput }),

  // Merge LLM-caused duplicate topic rows (retroactive). ONLY merges rows
  // whose duplication is traceable to a topic_canonicalizations / LLM-alias
  // binding — user-created re-searches are left alone.
  mergeDuplicateTopics: (apply = false) => {
    if (apply) invalidate('list_topics', 'overview_stats');
    return invoke('merge_duplicate_topics', { apply });
  },

  // Relevance-gate retroactive cleanup. apply=false → dry-run inspect.
  cleanCorpus: (topic, threshold = 0.30, apply = false, minKeep = 20) => {
    if (apply) {
      invalidate('list_topics', 'overview_stats', 'run_query', 'get_findings');
    }
    return invoke('clean_corpus', { topic, threshold, apply, minKeep });
  },

  // ── Dual-Mode Pivot — Product Mode ─────────────────────────────────
  productCreate: (payload) => {
    invalidate('product_list'); invalidate('product_dashboard');
    return invoke('product_create', payload);
  },
  productList: (activeOnly = true) =>
    cachedInvoke('product_list', { activeOnly }, 10000, SWR_BUILD_OUTPUT_MS),
  productGet: (productId) =>
    cachedInvoke('product_get', { productId }, 10000, SWR_BUILD_OUTPUT_MS),
  productUpdate: (productId, fields) => {
    invalidate('product_list'); invalidate('product_get'); invalidate('product_dashboard');
    return invoke('product_update', { productId, fields });
  },
  productAddCompetitor: (productId, name, urls = {}, category = '') => {
    invalidate('product_get'); invalidate('product_dashboard');
    return invoke('product_add_competitor', { productId, name, urls, category });
  },
  productRemoveCompetitor: (productId, name) => {
    invalidate('product_get'); invalidate('product_dashboard');
    return invoke('product_remove_competitor', { productId, name });
  },
  productDelete: (productId) => {
    invalidate('product_list'); invalidate('product_get'); invalidate('product_dashboard');
    return invoke('product_delete', { productId });
  },
  productSweep: (productId, trigger = 'manual', skipCollect = true) => {
    // product_get aggregates open_signal_count — a sweep changes it, so drop
    // its (now 7-day-persisted) cache too, not just dashboard/signals.
    invalidate('product_dashboard'); invalidate('product_signals');
    invalidate('product_get'); invalidate('product_list');
    return invoke('product_sweep', { productId, trigger, skipCollect });
  },
  productSignals: (productId, sinceDays = 7, includeResolved = false, limit = 100) =>
    cachedInvoke('product_signals', { productId, sinceDays, includeResolved, limit }, 10000),
  productSignalAction: (signalId, action, notes = '', snoozeDays = 7) => {
    // Resolving/snoozing a signal changes product_get.open_signal_count.
    invalidate('product_signals'); invalidate('product_dashboard');
    invalidate('product_get'); invalidate('product_list');
    return invoke('product_signal_action', { signalId, action, notes, snoozeDays });
  },
  productDigest: (productId, days = 7) =>
    invoke('product_digest', { productId, days }),
  productDashboard: (productId, days = 7) =>
    cachedInvoke('product_dashboard', { productId, days }, 15000),
  productConvertTopic: (topic, name = null, oneLiner = '') => {
    invalidate('product_list');
    return invoke('product_convert_topic', { topic, name, oneLiner });
  },

  // Lifecycle pivot — Stage-Gate verdict (Cooper, 2017). status='' clears.
  productGateSet: (productId, status, notes = '') => {
    invalidate('product_get'); invalidate('product_dashboard'); invalidate('product_list');
    return invoke('product_gate_set', { productId, status, notes });
  },
  productGateGet: (productId) =>
    cachedInvoke('product_gate_get', { productId }, 5000),

  // Kano-Model categorization for interventions in a topic.
  runKanoCategorize: (topic) => {
    invalidate('run_query');
    return invoke('run_kano_categorize', { topic });
  },

  // Task Manager — single-call view of every queue/job table. Polled
  // every 2 s by /tasks; the cache window is short so the manual
  // refresh button is responsive while rapid re-renders coalesce.
  runtimeSnapshot: (recentLimit = 25) =>
    cachedInvoke('runtime_snapshot', { recentLimit }, 1500),

  // Page-explainer eye-icon system. Cached for 5 minutes — the
  // explanations only change when the user edits them via Settings,
  // and the screen tolerates stale-while-revalidate easily.
  pageExplanationGet: (slug) =>
    cachedInvoke('page_explanation_get', { slug }, 300000),
  pageExplanationsList: () =>
    cachedInvoke('page_explanations_list', null, 300000),

  // ── Iterate / Autoresearch (2026-05-03 Phase 4) ──────────────────
  // Persistent autoresearch loop. start+execute can be split for
  // background-job semantics; iterateRun is the one-shot helper.
  iterateRun:    (topic, loopKind, { gridJson = null, notes = '' } = {}) => {
    invalidate('iterate_status', 'iterate_list', 'iterate_applied');
    return invoke('iterate_run', { topic, loopKind, gridJson, notes });
  },
  iterateStart:  (topic, loopKind, { gridJson = null, notes = '' } = {}) => {
    invalidate('iterate_list');
    return invoke('iterate_start', { topic, loopKind, gridJson, notes });
  },
  iterateExecute: (runId) => {
    invalidate('iterate_status', 'iterate_list');
    return invoke('iterate_execute', { runId });
  },
  iterateStatus:  (runId) => cachedInvoke('iterate_status', { runId }, 2000),
  iterateList:    (topic = null, limit = 30) =>
    cachedInvoke('iterate_list', { topic, limit }, 5000),
  iterateCancel:  (runId) => {
    invalidate('iterate_status', 'iterate_list');
    return invoke('iterate_cancel', { runId });
  },
  iterateApply:   (runId) => {
    invalidate('iterate_applied', 'iterate_status');
    return invoke('iterate_apply', { runId });
  },
  iterateApplied: (topic) => cachedInvoke('iterate_applied', { topic }, 5000),

  // Pipeline orchestrator: audience → synthesize → deliberate → launch
  pipelineRun:    (topic, { force = false, noLlm = false, provider = null } = {}) => {
    invalidate('pipeline_status', 'launch_brief_get', 'audience_personas_get');
    return invoke('pipeline_run', { topic, force, noLlm, provider });
  },
  pipelineStatus: (topic) => cachedInvoke('pipeline_status', { topic }, 5000),

  // ── Deliberation (2026-05-03 Phase 3) ────────────────────────────
  // 5-persona debate: tag every finding Confirmed/Probable/Minority/
  // Discarded. Optionally grounded in audience clusters.
  deliberate: (topic, { rounds = 1, noLlm = false, provider = null } = {}) =>
    invoke('deliberate', { topic, rounds, noLlm, provider }),

  // ── Audience personas (2026-05-03) ────────────────────────────────
  // Cluster real authors per topic. Build invalidates the GET cache so
  // the screen re-renders with fresh personas after a re-cluster.
  audiencePersonasBuild: (topic, { llm = true, provider = null, minPosts = 3 } = {}) => {
    invalidate('audience_personas_get');
    return invoke('audience_personas_build', {
      topic, llm, provider, minPosts,
    });
  },
  audiencePersonasGet: (topic) =>
    cachedInvoke('audience_personas_get', { topic }, 10000, SWR_BUILD_OUTPUT_MS),

  // ── Launch & GTM (2026-05-02) ─────────────────────────────────────
  // Per-topic Launch Brief: target audience, demographics, where to
  // launch, market requirements. Deterministic + optional LLM.
  launchBrief: (topic, { llm = true, provider = null } = {}) => {
    invalidate('launch_brief_get');
    return invoke('launch_brief', { topic, llm, provider });
  },
  launchBriefGet: (topic) =>
    cachedInvoke('launch_brief_get', { topic }, 10000, SWR_BUILD_OUTPUT_MS),

  // ── Discovery framework expansion (2026-05-01_04) ──────────────────
  // Opportunity Solution Tree (Torres, 2016) — outcome → opportunities
  // → solutions → experiments. ostBuild reads only; the underlying data
  // is whatever the existing pipelines have already produced.
  ostBuild: (topic, productId = null) =>
    cachedInvoke('ost_build', { topic, productId: productId || null }, 10000),
  ostSetOutcome: (productId, outcome) => {
    invalidate('ost_build');
    invalidate('product_get');
    return invoke('ost_set_outcome', { productId, outcome });
  },
  // OST experiments — namespaced separately from gap_discovery's
  // experiments table (which `api.listExperiments` already exposes for a
  // different concept: LLM-proposed paper-grounded experiment designs).
  experimentCreate: (topic, payload) => {
    invalidate('ost_build', 'ost_experiments_list');
    return invoke('ost_experiment_create', {
      topic,
      painpointId: payload.painpoint_id,
      interventionId: payload.intervention_id || '',
      hypothesis: payload.hypothesis,
      method: payload.method || 'custom',
      successCriteria: payload.success_criteria || '',
      sampleSize: payload.sample_size ?? 0,
    });
  },
  ostExperimentsList: (topic, painpointId = null) =>
    cachedInvoke('ost_experiments_list', { topic, painpointId: painpointId || null }, 10000, SWR_BUILD_OUTPUT_MS),
  experimentUpdate: (experimentId, fields) => {
    invalidate('ost_build', 'ost_experiments_list');
    return invoke('ost_experiment_update', {
      experimentId,
      fieldsJson: JSON.stringify(fields || {}),
    });
  },
  experimentDelete: (experimentId) => {
    invalidate('ost_build', 'ost_experiments_list');
    return invoke('ost_experiment_delete', { experimentId });
  },

  // RICE prioritization (Intercom, 2016).
  runRiceScore: (topic, defaultEffort = 3, overwriteEffort = false) => {
    invalidate('run_query', 'ost_build');
    return invoke('run_rice_score', {
      topic, defaultEffort, overwriteEffort,
    });
  },
  riceSet: (interventionId, fields = {}) => {
    invalidate('run_query', 'ost_build');
    return invoke('rice_set', {
      interventionId,
      reach: fields.reach ?? null,
      impact: fields.impact ?? null,
      confidence: fields.confidence ?? null,
      effort: fields.effort ?? null,
    });
  },

  // MoSCoW prioritization (Clegg, 1994).
  runMoscowCategorize: (topic) => {
    invalidate('run_query', 'ost_build');
    return invoke('run_moscow_categorize', { topic });
  },

  // Empathy Maps (Gray, 2010).
  runEmpathyBuild: (topic, persona = 'primary') => {
    invalidate('empathy_get', 'empathy_list');
    return invoke('run_empathy_build', { topic, persona });
  },
  empathyGet: (topic, persona = 'primary') =>
    cachedInvoke('empathy_get', { topic, persona }, 10000, SWR_BUILD_OUTPUT_MS),
  empathyList: (topic) =>
    cachedInvoke('empathy_list', { topic }, 10000, SWR_BUILD_OUTPUT_MS),

  // Cagan's Four Risks (Inspired, 2017).
  fourRisksGet: (productId) =>
    cachedInvoke('four_risks_get', { productId }, 5000, SWR_BUILD_OUTPUT_MS),
  fourRisksSet: (productId, risk, status, notes = '') => {
    invalidate('four_risks_get', 'product_get');
    return invoke('four_risks_set', { productId, risk, status, notes });
  },

  // Blue Ocean Value Curve (Kim & Mauborgne, 2005).
  valueCurveGet: (productId) =>
    cachedInvoke('value_curve_get', { productId }, 10000, SWR_BUILD_OUTPUT_MS),
  valueCurveSet: (productId, payload) => {
    invalidate('value_curve_get', 'product_get');
    return invoke('value_curve_set', {
      productId,
      payloadJson: JSON.stringify(payload || {}),
    });
  },

  // ── TAM / SAM / SOM (Blank & Dorf, 2012) ────────────────────────────
  tamSamSomGet: (productId) =>
    cachedInvoke('tam_sam_som_get', { productId }, 10000, SWR_BUILD_OUTPUT_MS),
  tamSamSomSet: (productId, payload) => {
    invalidate('tam_sam_som_get', 'product_get');
    return invoke('tam_sam_som_set', {
      productId,
      payloadJson: JSON.stringify(payload || {}),
    });
  },

  // ── Porter's Five Forces (Porter, 1979) ─────────────────────────────
  porterGet: (productId) =>
    cachedInvoke('porter_get', { productId }, 10000, SWR_BUILD_OUTPUT_MS),
  porterSet: (productId, force, score, notes = '') => {
    invalidate('porter_get', 'product_get');
    return invoke('porter_set', { productId, force, score, notes });
  },

  // ── 2x2 positioning map (Ries & Trout, 1981) ────────────────────────
  positioningGet: (productId) =>
    cachedInvoke('positioning_get', { productId }, 10000, SWR_BUILD_OUTPUT_MS),
  positioningSet: (productId, payload) => {
    invalidate('positioning_get', 'product_get');
    return invoke('positioning_set', {
      productId,
      payloadJson: JSON.stringify(payload || {}),
    });
  },

  // ── Cost model + pricing tiers ──────────────────────────────────────
  costModelGet: (productId) =>
    cachedInvoke('cost_model_get', { productId }, 10000, SWR_BUILD_OUTPUT_MS),
  costModelSet: (productId, payload) => {
    invalidate('cost_model_get', 'product_get');
    return invoke('cost_model_set', {
      productId,
      payloadJson: JSON.stringify(payload || {}),
    });
  },

  // ── Customer Discovery Interviews (Mom Test, Fitzpatrick 2013) ──────
  interviewCreate: (topic, name, payload = {}, productId = '') => {
    invalidate('interview_list', 'interview_summary');
    return invoke('interview_create', {
      topic, name,
      payloadJson: JSON.stringify(payload || {}),
      productId,
    });
  },
  interviewUpdate: (interviewId, fields = {}) => {
    invalidate('interview_list', 'interview_summary', 'interview_get');
    return invoke('interview_update', {
      interviewId, payloadJson: JSON.stringify(fields || {}),
    });
  },
  interviewDelete: (interviewId) => {
    invalidate('interview_list', 'interview_summary', 'interview_get');
    return invoke('interview_delete', { interviewId });
  },
  interviewGet: (interviewId) =>
    cachedInvoke('interview_get', { interviewId }, 5000, SWR_BUILD_OUTPUT_MS),
  interviewList: (topic = '', productId = '') =>
    cachedInvoke('interview_list', { topic, productId }, 5000, SWR_BUILD_OUTPUT_MS),
  interviewSummary: (topic, productId = '') =>
    cachedInvoke('interview_summary', { topic, productId }, 10000, SWR_BUILD_OUTPUT_MS),

  // ── Sean Ellis PMF survey (Ellis 2010) ──────────────────────────────
  pmfAdd: (topic, payload) => {
    invalidate('pmf_list', 'pmf_score');
    return invoke('pmf_add', { topic, payloadJson: JSON.stringify(payload || {}) });
  },
  pmfList: (topic = '', productId = '') =>
    cachedInvoke('pmf_list', { topic, productId }, 5000, SWR_BUILD_OUTPUT_MS),
  pmfScore: (topic, productId = '') =>
    cachedInvoke('pmf_score', { topic, productId }, 10000, SWR_BUILD_OUTPUT_MS),
  pmfDelete: (responseId) => {
    invalidate('pmf_list', 'pmf_score');
    return invoke('pmf_delete', { responseId });
  },

  // ── Pricing surveys: Van Westendorp / NPS / MaxDiff ─────────────────
  vwAdd: (topic, payload) => {
    invalidate('vw_aggregate', 'survey_list');
    return invoke('vw_add', { topic, payloadJson: JSON.stringify(payload || {}) });
  },
  vwAggregate: (topic, productId = '') =>
    cachedInvoke('vw_aggregate', { topic, productId }, 10000, SWR_BUILD_OUTPUT_MS),
  npsAdd: (topic, payload) => {
    invalidate('nps_score', 'survey_list');
    return invoke('nps_add', { topic, payloadJson: JSON.stringify(payload || {}) });
  },
  npsScore: (topic, productId = '') =>
    cachedInvoke('nps_score', { topic, productId }, 10000, SWR_BUILD_OUTPUT_MS),
  maxdiffAdd: (topic, payload) => {
    invalidate('maxdiff_ranking', 'survey_list');
    return invoke('maxdiff_add', { topic, payloadJson: JSON.stringify(payload || {}) });
  },
  maxdiffRanking: (topic, productId = '') =>
    cachedInvoke('maxdiff_ranking', { topic, productId }, 10000, SWR_BUILD_OUTPUT_MS),
  surveyList: (topic = '', productId = '', kind = '') =>
    cachedInvoke('survey_list', { topic, productId, kind }, 5000, SWR_BUILD_OUTPUT_MS),
  surveyDelete: (responseId) => {
    invalidate('survey_list', 'vw_aggregate', 'nps_score', 'maxdiff_ranking');
    return invoke('survey_delete', { responseId });
  },

  // ── PERT estimation (US Navy 1958, McConnell 2006) ──────────────────
  pertAdd: (productId, label, fields = {}) => {
    invalidate('pert_list', 'pert_rollup');
    return invoke('pert_add', {
      productId, label,
      optimistic: fields.optimistic ?? null,
      mostLikely: fields.most_likely ?? null,
      pessimistic: fields.pessimistic ?? null,
      role: fields.role ?? null,
      notes: fields.notes ?? null,
      tier: fields.tier ?? null,
    });
  },
  pertUpdate: (taskId, fields = {}) => {
    invalidate('pert_list', 'pert_rollup');
    return invoke('pert_update', { taskId, payloadJson: JSON.stringify(fields || {}) });
  },
  pertDelete: (taskId) => {
    invalidate('pert_list', 'pert_rollup');
    return invoke('pert_delete', { taskId });
  },
  pertList: (productId, tier = '') =>
    cachedInvoke('pert_list', { productId, tier }, 5000, SWR_BUILD_OUTPUT_MS),
  pertRollup: (productId, opts = {}) =>
    cachedInvoke('pert_rollup', {
      productId,
      multiplier: opts.multiplier ?? null,
      contingencyPct: opts.contingency_pct ?? null,
      tier: opts.tier ?? null,
    }, 5000),

  // ── PRD export ──────────────────────────────────────────────────────
  prdExport: (productId) => invoke('prd_export', { productId }),

  runSolutionsPipeline: (topic) => invoke('run_solutions_pipeline', { topic }),
  runTemporalGaps:    (topic, force = false) => invoke('run_temporal_gaps', { topic, force }),
  runSentimentBySource: (topic) => invoke('run_sentiment_by_source', { topic }),
  runConcepts:        (topic) => invoke('run_concepts', { topic }),

  // ----- Paper research (BibTeX/RIS/APA/MD export, Unpaywall OA lookup) -----
  // Papers list — native rusqlite path. Was a Python sidecar call
  // (~200–800 ms warm, 1500+ ms cold); now ~1 ms. The fallback to
  // `papers_list` (sidecar) stays so callers that need fields the native
  // path doesn't expose can still opt in.
  papersList:   (topic, limit = 200) =>
    cachedInvoke('papers_list_native', { topic, limit }, 30000),
  papersListSidecar: (topic, limit = 200) =>
    invoke('papers_list', { topic, limit }),
  papersExport: (topic, fmt = 'bibtex', limit = null) => invoke('papers_export', { topic, fmt, limit }),
  oaLookup:     (doi) => invoke('oa_lookup', { doi }),
  // Full paper research pipeline — Papers tab's "Find papers" button.
  // Searches 6 academic sources in parallel, dedupes + ranks, fetches
  // fulltext for the top-cited ones, runs LLM analysis. Long-running
  // (typical 20-90 s for limitPerSource=5). Caller refreshes the cached
  // list via `papersList()` once this resolves.
  paperResearchPipeline: (topic, query = null, opts = {}) =>
    invoke('paper_research_pipeline', {
      topic,
      query: query || null,
      limitPerSource: opts.limitPerSource ?? 5,
      maxFulltext:    opts.maxFulltext    ?? 3,
      yearFrom:       opts.yearFrom       ?? null,
      provider:       opts.provider       || null,
      sources:        opts.sources        || null,
    }),
  // Mirror a remote PDF into the app's local cache so the webview can
  // render it without tripping CORS / X-Frame-Options. Returns
  // { ok, path, size } — feed `path` through convertFileSrc to get an
  // asset:// URL the iframe can load.
  paperPdfFetch: (url, postId = null) => invoke('paper_pdf_fetch', { url, postId }),

  // ----- Intent layer (per-topic deliverable routing) -----
  listIntents:     ()              => cachedInvoke('list_intents', null, 300000),
  topicIntentGet:  (topic)         => invoke('topic_intent_get', { topic }),
  topicIntentSet:  (topic, intent) => { invalidate('topic_intent_get'); return invoke('topic_intent_set', { topic, intent }); },

  // ----- MCP ↔ App integration (multi-client) -----
  mcpClients:   ()        => invoke('mcp_clients'),
  mcpStatus:    (client)  => invoke('mcp_status',    { client: client || null }),
  mcpInstall:   (client)  => invoke('mcp_install',   { client: client || null }),
  mcpUninstall: (client)  => invoke('mcp_uninstall', { client: client || null }),

  // ----- CLI symlink (one-click install gapmap-cli to /usr/local/bin) -----
  // Status: { installed, healthy, path, points_to, expected }
  // Install/Uninstall prompt for admin via osascript.
  // 30s in-memory + 10-minute persisted cache. The symlink only changes
  // when the user explicitly clicks Install/Uninstall in Settings, both
  // of which invalidate this key. A warm read on every Settings open
  // saves a sidecar spawn for a trivial /usr/local/bin stat.
  cliSymlinkStatus:   ()  => cachedInvoke('cli_symlink_status', null, 30000, 10 * 60 * 1000),
  installCliSymlink:  ()  => { invalidate('cli_symlink_status'); return invoke('install_cli_symlink'); },
  uninstallCliSymlink:()  => { invalidate('cli_symlink_status'); return invoke('uninstall_cli_symlink'); },

  // ----- License gate feature flag (read-only — env-driven) -----
  licenseGateStatus:  ()  => invoke('license_gate_status'),

  quickExtractGaps:   (topic) => invoke('quick_extract_gaps', { topic }),

  // ── Unified cross-table search ───────────────────────────────────────
  // Normal mode: SQL LIKE across posts/graph/analyses/papers/hypotheses/
  // feedback. Fast, offline, persisted. Aggressive mode: LLM query
  // expansion (3-4 paraphrases) + palace semantic search. Every run
  // writes a compact summary row to mcp_analyses so older pipelines can
  // consume "recently searched" as LLM prompt context.
  searchAll: (query, { topic = null, aggressive = false } = {}) =>
    invoke('search_all', { query, topic, aggressive }),

  // ── Task 8: saturation v1 + coverage gaps panel ───────────────────
  // Both are pure-SQL reads so a 30s cache is plenty — they auto-refresh
  // anyway when any screen fires `gapmap:changed` (see main.js).
  // SWR-persisted: saturation and coverage-gaps reflect graph state that
  // only moves on collect/enrich/ingest writes — all of which call
  // `mutated()` and invalidate both cache layers. 10-min persist window
  // keeps the topic-page hint chips painting instantly across sessions.
  topicSaturation:    (topic) => cachedInvoke('topic_saturation',    { topic }, 60000, 10 * 60 * 1000),
  topicCoverageGaps:  (topic) => cachedInvoke('topic_coverage_gaps', { topic }, 60000, 10 * 60 * 1000),
  runRedditSearch:    (query, sub, sort, timeFilter, limit) =>
    invoke('run_reddit_search', { query, sub, sort, timeFilter, limit }),
  startStream:        (sub, keywords, watch) => invoke('start_stream', { sub, keywords, watch }),
  cancelStream:       () => invoke('cancel_stream'),
  streamStatus:       () => invoke('stream_status'),

  // ── AG-C: global-competitors (T2.5) + finding feedback (T2.4) ─────
  // Cross-topic competitor dedup. Reads product-kind graph nodes across
  // ALL topics and clusters by label embedding cosine ≥ threshold.
  // `minTopics` default 2 keeps single-topic products out of the grid.
  globalCompetitors: (minTopics = 2, threshold = 0.80) =>
    cachedInvoke('global_competitors', { minTopics, threshold }, 60000),

  // Record 👎 feedback on a finding. Next synthesize call for this topic
  // injects flagged titles into the prompt as negative examples.
  //   verdict ∈ 'wrong' | 'off_topic' | 'spam' | 'ok'
  feedbackRecord: (topic, title, kind = 'painpoint', verdict = 'wrong', note = '') => {
    // Next synth should see the new feedback — invalidate cached insights.
    invalidate('synthesize_insights');
    return invoke('feedback_record', { topic, title, kind, verdict, note });
  },

  // ── AG-E: prompt overrides (T3.7) ───────────────────────────────────
  // Thin wrappers — no caching (Settings reads them on demand and writes
  // should appear immediately on reload).
  promptList:  ()              => invoke('prompt_list'),
  promptGet:   (key)           => invoke('prompt_get',  { key }),
  promptSet:   (key, text)     => invoke('prompt_set',  { key, text: text || '' }),
  promptClear: (key)           => invoke('prompt_clear', { key }),

  // ── AG-E: saved views (T3.1) ────────────────────────────────────────
  // Short TTL so a view saved on one screen appears on another almost
  // immediately. `scope` matches the DB: 'global' | 'topic:<slug>' | 'product:<id>'.
  savedViews:       (scope = null) => cachedInvoke('saved_views', { scope: scope || null }, 5000),
  savedViewCreate:  (scope, name, filterJson = {}, pinned = false) => {
    invalidate('saved_views');
    return invoke('saved_view_create', { scope, name, filterJson, pinned });
  },
  savedViewUpdate:  (id, fields = {}) => {
    invalidate('saved_views');
    const { name = null, scope = null, filterJson = null, pinned = null } = fields;
    return invoke('saved_view_update', { id, name, scope, filterJson, pinned });
  },
  savedViewDelete:  (id) => {
    invalidate('saved_views');
    return invoke('saved_view_delete', { id });
  },

  // ── AG-D: CSV ingest ──
  // Bulk-ingest a structured CSV into a topic corpus. Python expects the
  // columns post_id,title,body,author,url,created_utc,source_type — only
  // `title` is required. Returns {ok, parsed, skipped, tagged, ...}.
  ingestCsv: (topic, path) => {
    invalidate('list_topics', 'overview_stats', 'recent_activity', 'run_query', 'get_findings');
    return invoke('ingest_csv_file', { topic, path });
  },

  // ── Incremental enrichment: extraction-worker supervisor ───────────────
  // `start_extraction_worker` is idempotent on the Rust side — calling it
  // when the worker is already running is a no-op. That makes it safe to
  // wire to `gapmap:changed` kind=collect without guarding state here.
  startExtractionWorker: () => invoke('start_extraction_worker'),
  stopExtractionWorker:  () => invoke('stop_extraction_worker'),
  // Short TTL — Settings / topic-page freshness badge poll this and want
  // to see a just-fired tick reflected quickly.
  extractionWorkerStatus: () => cachedInvoke('extraction_worker_status', null, 2000),
  // Wired to the error-banner "Retry all failed" button. The Rust side is
  // a no-op stub today — real re-queueing logic lands in a follow-up task.
  // Returning `{ok:true}` from Rust keeps this callable without surfacing
  // a blocking error toast while the stub is in place.
  retryAllExtraction: () => invoke('retry_extraction_failures'),

  // ── Task 9.5: Settings → Extraction pane (token controls) ───────────────
  // `extractionPrefsGet` returns the 3-layer resolved prefs: global JSON,
  // per-topic row (null if topic omitted), and the effective merge. The
  // Settings card reads without a topic; the Topic-page override row reads
  // with a topic.
  extractionPrefsGet: (topic = null) =>
    cachedInvoke('extraction_prefs_get', { topic }, 10000),
  // scope is either "global" or "topic:<name>". Partial updates are
  // supported — only the keys you send are written.
  extractionPrefsSet: (scope, prefs) => {
    const p = invoke('extraction_prefs_set', { scope, prefs });
    mutated('extraction_prefs', { scope });
    return p;
  },
  // Running total of today's LLM spend, grouped by (provider, model).
  // Short TTL because the worker writes rows during active extraction and
  // the Settings card wants to feel live.
  todayTokenSpend: () => cachedInvoke('today_token_spend', null, 30000),

  // ----- event listeners -----
  onCollectProgress: (cb) => listen('collect:progress', e => cb(e.payload)),
  onCollectDone:     (cb) => {
    // Invalidate topic-level caches when a collect finishes so the next
    // Dashboard render reflects fresh counts.
    return listen('collect:done', e => {
      invalidate('list_topics', 'overview_stats', 'recent_activity', 'cli_info', 'run_query', 'get_findings');
      cb(e.payload);
    });
  },
  onChatProgress:    (cb) => listen('chat:progress',    e => cb(e.payload)),
  onChatDone:        (cb) => listen('chat:done',        e => cb(e.payload)),
  onStreamHit:       (cb) => listen('stream:hit',       e => cb(e.payload)),
  onStreamDone:      (cb) => listen('stream:done',      e => cb(e.payload)),

  // ── Persona agents (Phase 1 — 2026-05-12) ──
  // Self-contained block. Remove with the persona feature when no longer needed.
  personaList:       ()                 => invoke('persona_agent_list'),
  personaCreate:     (fields)           => invoke('persona_agent_create', fields),
  personaUpdate:     (personaId, patch) => invoke('persona_agent_update', { personaId, ...patch }),
  personaDelete:     (personaId)        => invoke('persona_agent_delete', { personaId }),
  personaMemories:   (personaId, opts = {}) =>
    invoke('persona_agent_memories', { personaId, topic: opts.topic || null, limit: opts.limit || 50 }),
  personaChat:       (personaId, question, k = 8) =>
    invoke('persona_agent_chat', { personaId, question, k }),
  personaIngest:     (opts = {}) =>
    invoke('persona_agent_ingest', {
      personaId: opts.personaId || null,
      topic: opts.topic || null,
      limit: opts.limit || 50,
    }),
  // Phase 5 — surgical teach-from-video (2026-05-12). Same event channel as
  // personaIngest so the existing onPersonaIngestProgress/Done listeners pick
  // up the fetch-phase events (`teach:start`, `teach:fetched`, `teach:error`)
  // and the standard ingest events that follow.
  personaTeachVideo: (personaId, url, opts = {}) =>
    invoke('persona_agent_teach_video', {
      personaId,
      url,
      commentsLimit: opts.commentsLimit || 100,
    }),
  onPersonaIngestProgress: (cb) => listen('persona_ingest:progress', e => cb(e.payload)),
  onPersonaIngestDone:     (cb) => listen('persona_ingest:done',     e => cb(e.payload)),

  // Phase 2b — graph + conclusions
  personaGraph:        (personaId, edgeLimit = 500) =>
    invoke('persona_agent_graph', { personaId, edgeLimit }),
  personaBackfill:     (personaId) => invoke('persona_agent_backfill', { personaId }),
  personaConclude:     (personaId, opts = {}) =>
    invoke('persona_agent_conclude', { personaId, noRefresh: opts.noRefresh || false }),
  personaConclusions:  (personaId, limit = 100) =>
    invoke('persona_agent_conclusions', { personaId, limit }),
  onPersonaConcludeProgress: (cb) => listen('persona_conclude:progress', e => cb(e.payload)),
  onPersonaConcludeDone:     (cb) => listen('persona_conclude:done',     e => cb(e.payload)),

  // Phase 3b — cross-persona memory share
  personaShare: (fromPersonaId, memoryId, toPersonaId) =>
    invoke('persona_agent_share', { fromPersonaId, memoryId, toPersonaId }),

  // Phase 4a — persona-of-personas (ingest peer conclusions through own lens)
  personaIngestPeers: (personaId, limit = 50) =>
    invoke('persona_agent_ingest_peers', { personaId, limit }),

  // Phase 4c — share-rejection log (lens contradictions map)
  personaRejections: (personaId, opts = {}) =>
    invoke('persona_agent_rejections', {
      personaId,
      direction: opts.direction || 'involving',
      limit: opts.limit || 50,
    }),
};

// ---------- tiny DOM helpers ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') el.className = v;
    else if (k === 'onClick') el.addEventListener('click', v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v != null) el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
export function fmtN(n) {
  if (n == null) return '—';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}
export function timeAgo(ts) {
  if (!ts) return '—';
  let d;
  try { d = new Date(ts); } catch { return '—'; }
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs/60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs/3600)}h ago`;
  return `${Math.floor(secs/86400)}d ago`;
}

// ── AG-E: saved views client-side filter (T3.1) ────────────────────────
//
// insights.js drops the saved-views DOM via a single 18-line <!-- AG-E
// saved views mount --> block. That block has no JS wiring of its own —
// this module attaches the behaviour via a MutationObserver so we stay
// out of insights.js's extractor/fetch/render code paths.
//
// Semantics (mirrors research/saved_views.apply_filter):
//   - missing key in filter ⇒ no constraint on that axis
//   - min_opportunity_score / kinds / triangulation_strength_in / classification_in
//
// We derive the finding's attributes from data-* that insights.js already
// emits on each .insight-card (title) plus its meta chips. For attributes
// not present in the DOM (opportunity_score, classification), we fall
// back to text-scraping the card content — best effort; users can always
// "Clear filter" to restore.
function _parseFindingCard(card) {
  // Opportunity score sits in .insight-score <b>
  const opEl = card.querySelector('.insight-score b');
  const op = opEl ? parseFloat(opEl.textContent || '0') : 0;
  // Kind emoji → kind slug
  const kindEl = card.querySelector('.insight-kind');
  const e = (kindEl?.textContent || '').trim();
  const kind = e === '🔥' ? 'painpoint'
             : e === '💡' ? 'feature_wish'
             : e === '🛠' ? 'workaround'
             : '';
  // Triangulation + classification chips live in .insight-meta
  let triang = '';
  let cls = '';
  card.querySelectorAll('.insight-chip').forEach(chip => {
    const t = (chip.textContent || '').trim();
    if (/triang/i.test(t)) {
      if (/strong/i.test(t)) triang = 'strong';
      else if (/moderate/i.test(t)) triang = 'moderate';
      else if (/weak/i.test(t)) triang = 'weak';
    }
    if (chip.classList.contains('chronic')) {
      cls = t.toUpperCase();
    }
  });
  return { op, kind, triang, classification: cls };
}

function _applyFilterToDom(contentEl, spec) {
  const cards = contentEl.querySelectorAll('.insights-findings .insight-card');
  const minOp = spec && spec.min_opportunity_score != null
    ? Number(spec.min_opportunity_score) : null;
  const kinds = new Set(spec?.kinds || []);
  const tri   = new Set(spec?.triangulation_strength_in || []);
  const cls   = new Set(spec?.classification_in || []);
  let shown = 0;
  cards.forEach(card => {
    const f = _parseFindingCard(card);
    let ok = true;
    if (minOp != null && !(f.op >= minOp)) ok = false;
    if (ok && kinds.size && !kinds.has(f.kind)) ok = false;
    if (ok && tri.size && !tri.has(f.triang)) ok = false;
    if (ok && cls.size && !cls.has(f.classification)) ok = false;
    card.style.display = ok ? '' : 'none';
    if (ok) shown++;
  });
  return shown;
}

function _wireSavedViewsBar(bar) {
  if (bar.dataset.agEWired === '1') return;
  bar.dataset.agEWired = '1';
  const contentEl = bar.closest('.insights-tab') || bar.parentElement || document;
  const topic = bar.dataset.topic || '';
  const scope = topic ? `topic:${topic}` : 'global';
  const sel    = bar.querySelector('#ag-e-saved-views-select');
  const status = bar.querySelector('#ag-e-saved-views-status');
  const btnSave  = bar.querySelector('#ag-e-saved-views-save');
  const btnClear = bar.querySelector('#ag-e-saved-views-clear');
  if (!sel) return;

  const state = { views: [] };

  const refresh = async () => {
    try {
      const r = await api.savedViews(scope);
      state.views = (r && r.views) || [];
      const current = sel.value;
      sel.innerHTML = `<option value="">All findings</option>` +
        state.views.map(v =>
          `<option value="${v.id}">${v.pinned ? '★ ' : ''}${esc(v.name)}</option>`
        ).join('');
      if (current && state.views.some(v => String(v.id) === String(current))) {
        sel.value = current;
      }
    } catch (e) {
      if (status) status.textContent = `✗ ${e?.message || e}`;
    }
  };

  sel.addEventListener('change', () => {
    const id = sel.value;
    if (!id) {
      // Clear — show everything
      _applyFilterToDom(contentEl, {});
      if (status) status.textContent = '';
      if (btnClear) btnClear.hidden = true;
      return;
    }
    const v = state.views.find(x => String(x.id) === String(id));
    const spec = (v && v.filter) || {};
    const shown = _applyFilterToDom(contentEl, spec);
    if (status) status.textContent = `showing ${shown} / ${contentEl.querySelectorAll('.insights-findings .insight-card').length}`;
    if (btnClear) btnClear.hidden = false;
  });

  if (btnClear) btnClear.addEventListener('click', () => {
    sel.value = '';
    sel.dispatchEvent(new Event('change'));
  });

  if (btnSave) btnSave.addEventListener('click', async () => {
    const name = window.prompt('Name this saved view:');
    if (!name || !name.trim()) return;
    const minStr = window.prompt('Minimum opportunity score (blank = any):', '10');
    const min = minStr && !Number.isNaN(parseFloat(minStr)) ? parseFloat(minStr) : null;
    const kindsStr = window.prompt(
      'Kinds (comma-sep: painpoint, feature_wish, workaround — blank = any):', ''
    );
    const kinds = (kindsStr || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const spec = {};
    if (min != null) spec.min_opportunity_score = min;
    if (kinds.length) spec.kinds = kinds;
    try {
      await api.savedViewCreate(scope, name.trim(), spec, false);
      await refresh();
      if (status) status.textContent = '✓ saved';
      setTimeout(() => {
        if (status && status.textContent === '✓ saved') status.textContent = '';
      }, 2000);
    } catch (e) {
      if (status) status.textContent = `✗ ${e?.message || e}`;
    }
  });

  refresh();
}

if (typeof window !== 'undefined' && typeof MutationObserver !== 'undefined') {
  const scan = (root) => {
    const els = (root && root.querySelectorAll)
      ? root.querySelectorAll('#ag-e-saved-views-bar')
      : [];
    els.forEach(_wireSavedViewsBar);
    if (root && root.id === 'ag-e-saved-views-bar') _wireSavedViewsBar(root);
  };
  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes && m.addedNodes.forEach(n => {
        if (n && n.nodeType === 1) scan(n);
      });
    }
  });
  const start = () => {
    try {
      mo.observe(document.body, { childList: true, subtree: true });
      scan(document.body);
    } catch {}
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
