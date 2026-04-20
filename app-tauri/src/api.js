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
const _cache = new Map();     // key → { value, ts }
const _inflight = new Map();  // key → Promise
// Default TTL for idempotent reads. 5s is short enough that data feels
// live (Dashboard won't miss a collect that just finished) but long enough
// that sidebar pogo-sticking doesn't re-fetch.
const DEFAULT_TTL_MS = 5000;

function cacheKey(name, args) {
  return args == null ? name : `${name}:${JSON.stringify(args)}`;
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

async function invokeWithRetry(name, args) {
  try {
    return await invoke(name, args);
  } catch (e) {
    if (!isTransient(e)) throw e;
    // Back off once, then try again. If it still fails, surface the error.
    await new Promise(r => setTimeout(r, 500));
    return await invoke(name, args);
  }
}

async function cachedInvoke(name, args, ttlMs = DEFAULT_TTL_MS) {
  const key = cacheKey(name, args);
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && now - hit.ts < ttlMs) return hit.value;
  // In-flight dedup: multiple callers get the same promise
  if (_inflight.has(key)) return _inflight.get(key);
  const p = invokeWithRetry(name, args).then(value => {
    _cache.set(key, { value, ts: Date.now() });
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
  // Clear any cache entry whose key equals or starts with the given prefix.
  for (const np of nameOrPrefixes) {
    for (const k of [..._cache.keys()]) {
      if (k === np || k.startsWith(np + ':')) _cache.delete(k);
    }
  }
}

export function clearApiCache() { _cache.clear(); _inflight.clear(); }

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
  overviewStats:   ()        => cachedInvoke('overview_stats', null, 15000),
  recentActivity:  ()        => cachedInvoke('recent_activity', null, 2000),
  appDataDir:      ()        => cachedInvoke('app_data_dir',   null, 300000),
  healthCheck:     ()        => invoke('health_check'),
  listExports:     ()        => cachedInvoke('list_exports',   null, 30000),
  byokStatus:      ()        => cachedInvoke('byok_status',    null, 30000),
  getFindings:     (topic, kind) => cachedInvoke('get_findings', { topic, kind }, 10000),
  runQuery:        (sql, topic, params) => cachedInvoke('run_query', { sql, topic, params }, 10000),
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
  paperAnalysesGet:  (topic) => cachedInvoke('paper_analyses_get', { topic }, 30000),

  // ----- scheduled runs (launchd on macOS, stub elsewhere) -----
  scheduleStatus:    ()              => cachedInvoke('schedule_status', null, 10000),
  scheduleInstall:   (intervalHours) => invoke('schedule_install', { intervalHours }),
  scheduleUninstall: ()              => invoke('schedule_uninstall'),
  scheduleEnableTopic: (topic, enabled) => invoke('schedule_enable_topic', { topic, enabled }),
  scheduleMarkSeen:  (topic)         => invoke('schedule_mark_seen', { topic }),

  // ----- writes / side-effects (bypass + invalidate) -----
  discoverSubs:    (topic, limit = 10) => invoke('discover_subs', { topic, limit }),
  startCollect:    (topic, aggressive = true, sources = null, skipReddit = false) => {
    invalidate('list_topics', 'overview_stats', 'recent_activity', 'cli_info', 'run_query');
    return invoke('start_collect', { topic, aggressive, sources, skipReddit });
  },
  cancelCollect:   ()        => invoke('cancel_collect'),
  collectStatus:   ()        => invoke('collect_status'),
  buildGraph:      (topic)   => {
    invalidate('list_topics', 'overview_stats', 'get_findings', 'run_query');
    return invoke('build_graph', { topic });
  },
  enrichGraph:     (topic)   => {
    invalidate('list_topics', 'overview_stats', 'get_findings', 'run_query');
    return invoke('enrich_graph', { topic });
  },
  exportHtml:      (topic, force = false) => {
    invalidate('list_exports');
    return invoke('export_html', { topic, force });
  },
  exportGraphJson: (topic)   => invoke('export_graph_json', { topic }),
  exportReportPro: (topic)   => {
    invalidate('list_exports');
    return invoke('export_report_pro', { topic });
  },
  ingestFile:      (path, topic, sourceType) => {
    invalidate('list_topics', 'overview_stats', 'recent_activity', 'run_query');
    return invoke('ingest_file', { path, topic, sourceType });
  },
  deleteTopic:     (topic)   => {
    invalidate('list_topics', 'overview_stats', 'get_findings', 'run_query');
    return invoke('delete_topic', { topic });
  },
  revealInFinder:  (path)    => invoke('reveal_in_finder', { path }),
  openUrl:         (url)     => invoke('open_url', { url }),
  byokSet:         (name, value) => {
    // Any key change can unlock or lock a provider's /models endpoint — nuke
    // both caches so the next modal open fetches fresh.
    invalidate('byok_status', 'list_provider_models');
    return invoke('byok_set', { name, value });
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
  reindexPalace:      ()     => invoke('reindex_palace'),
  palaceStats:        ()     => invoke('palace_stats'),
  // Hybrid-download opt-in. `installed` = retrieval extras wheels present,
  // `ready` = ONNX model file cached. UI renders different cards per state.
  palaceModelStatus:  ()     => invoke('palace_model_status'),
  // Kicks off the ~80 MB ONNX model download; subscribe to
  // `palace:warmup:progress` for {event, bytes, total, pct} events and
  // `palace:warmup:done` for the {code} exit.
  palaceWarmup:       ()     => invoke('palace_warmup'),
  onPalaceWarmupProgress: (cb) => listen('palace:warmup:progress', e => cb(e.payload)),
  onPalaceWarmupDone:     (cb) => listen('palace:warmup:done',     e => cb(e.payload)),
  // Phase-1 Insight Engine — one long-context synthesis call across the
  // full multi-source corpus. `cached=true` returns the last persisted
  // report without re-running the LLM (cheap for tab re-renders). First
  // call per topic writes to the `topic_insights` table.
  synthesizeInsights: (topic, cached = false) => invoke('synthesize_insights', { topic, cached }),
  runSolutionsPipeline: (topic) => invoke('run_solutions_pipeline', { topic }),
  runTemporalGaps:    (topic, force = false) => invoke('run_temporal_gaps', { topic, force }),
  runSentimentBySource: (topic) => invoke('run_sentiment_by_source', { topic }),
  quickExtractGaps:   (topic) => invoke('quick_extract_gaps', { topic }),
  runRedditSearch:    (query, sub, sort, timeFilter, limit) =>
    invoke('run_reddit_search', { query, sub, sort, timeFilter, limit }),
  startStream:        (sub, keywords, watch) => invoke('start_stream', { sub, keywords, watch }),
  cancelStream:       () => invoke('cancel_stream'),
  streamStatus:       () => invoke('stream_status'),

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
