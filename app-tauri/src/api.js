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

async function invokeWithRetry(name, args) {
  try {
    return throwIfParseError(name, await invoke(name, args));
  } catch (e) {
    if (!isTransient(e)) throw e;
    // Back off once, then try again. If it still fails, surface the error.
    await new Promise(r => setTimeout(r, 500));
    return throwIfParseError(name, await invoke(name, args));
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
  topics:     ['list_topics', 'overview_stats', 'recent_activity', 'cli_info', 'run_query', 'list_trash'],
  collect:    ['list_topics', 'overview_stats', 'recent_activity', 'cli_info', 'run_query', 'get_findings'],
  ingest:     ['list_topics', 'overview_stats', 'recent_activity', 'run_query'],
  graph:      ['list_topics', 'overview_stats', 'get_findings', 'run_query'],
  findings:   ['list_topics', 'overview_stats', 'get_findings', 'run_query', 'paper_analyses_get'],
  exports:    ['list_exports'],
  byok:       ['byok_status', 'list_provider_models', 'cli_info'],
  hypothesis: ['hypothesis_list', 'hypothesis_stats'],
  product:    ['list_products', 'product_get', 'product_signals', 'product_digest', 'overview_stats'],
  schedule:   ['schedule_status'],
  trash:      ['list_trash', 'list_topics', 'overview_stats'],
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
  // Short TTL — banner polls this, and a just-completed collect should
  // disappear from it within a couple seconds.
  activeCollects:  ()        => cachedInvoke('active_collects', null, 1500),
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
    const p = invoke('start_collect', { topic, aggressive, sources, skipReddit });
    mutated('collect', { topic });
    return p;
  },
  cancelCollect:   ()        => invoke('cancel_collect'),
  collectStatus:   ()        => invoke('collect_status'),
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
  exportHtml:      (topic, force = false) => {
    const p = invoke('export_html', { topic, force });
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
  // Soft-delete (T1.3): 7-day undo window via api.restoreTopic + listTrash.
  deleteTopic:     (topic)   => {
    const p = invoke('delete_topic', { topic });
    mutated('topics', { topic, action: 'delete' });
    return p;
  },
  restoreTopic:    (topic)   => {
    const p = invoke('restore_topic', { topic });
    mutated('topics', { topic, action: 'restore' });
    return p;
  },
  listTrash:       ()        => cachedInvoke('list_trash', null, 10000),
  purgeDeletedTopics: (minAgeDays = 7) => {
    const p = invoke('purge_deleted_topics', { minAgeDays });
    mutated('trash');
    return p;
  },
  revealInFinder:  (path)    => invoke('reveal_in_finder', { path }),
  openUrl:         (url)     => invoke('open_url', { url }),
  byokSet:         (name, value) => {
    // Any key change can unlock or lock a provider's /models endpoint — nuke
    // both caches so the next modal open fetches fresh.
    const p = invoke('byok_set', { name, value });
    mutated('byok');
    return p;
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
  listExperiments: (topic) => cachedInvoke('list_experiments', { topic }, 30000),
  personaView: (topic, persona) => invoke('persona_view', { topic, persona }),

  // Phase-3 Hypothesis Tracking — tracked bets for user-validated research
  // findings. `cardJson` is the JSON-stringified hypothesis card from the
  // Insight Engine synthesis output. Status values: draft / running /
  // validated / invalidated / paused / archived. See
  // src/reddit_research/research/hypothesis_tracker.py for the state machine.
  hypothesisCreate: (topic, cardJson, status = 'draft') => {
    invalidate('hypothesis_list', 'hypothesis_stats');
    return invoke('hypothesis_create', { topic, cardJson, status });
  },
  hypothesisUpdateStatus: (id, status, notes) => {
    invalidate('hypothesis_list', 'hypothesis_stats');
    return invoke('hypothesis_update_status', { id, status, notes });
  },
  hypothesisList: (topic, status, includeArchived = false) =>
    cachedInvoke('hypothesis_list', { topic, status, includeArchived }, 5000),
  hypothesisDelete: (id) => {
    invalidate('hypothesis_list', 'hypothesis_stats');
    return invoke('hypothesis_delete', { id });
  },
  hypothesisStats: (topic) =>
    cachedInvoke('hypothesis_stats', { topic }, 5000),

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
    cachedInvoke('product_list', { activeOnly }, 10000),
  productGet: (productId) =>
    cachedInvoke('product_get', { productId }, 10000),
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
    invalidate('product_dashboard'); invalidate('product_signals');
    return invoke('product_sweep', { productId, trigger, skipCollect });
  },
  productSignals: (productId, sinceDays = 7, includeResolved = false, limit = 100) =>
    cachedInvoke('product_signals', { productId, sinceDays, includeResolved, limit }, 10000),
  productSignalAction: (signalId, action, notes = '', snoozeDays = 7) => {
    invalidate('product_signals'); invalidate('product_dashboard');
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

  runSolutionsPipeline: (topic) => invoke('run_solutions_pipeline', { topic }),
  runTemporalGaps:    (topic, force = false) => invoke('run_temporal_gaps', { topic, force }),
  runSentimentBySource: (topic) => invoke('run_sentiment_by_source', { topic }),
  runConcepts:        (topic) => invoke('run_concepts', { topic }),

  // ----- MCP ↔ App integration (multi-client) -----
  mcpClients:   ()        => invoke('mcp_clients'),
  mcpStatus:    (client)  => invoke('mcp_status',    { client: client || null }),
  mcpInstall:   (client)  => invoke('mcp_install',   { client: client || null }),
  mcpUninstall: (client)  => invoke('mcp_uninstall', { client: client || null }),
  quickExtractGaps:   (topic) => invoke('quick_extract_gaps', { topic }),
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
