// Topic detail — 6 tabs: Map · Report · Evidence · Sources · Chat · Actions.
// The chat tab streams tokens from the Python sidecar via `chat:progress`
// events; backend is the `research chat` CLI command.

import { api, $, esc, timeAgo } from '../api.js';
import { convertFileSrc } from '@tauri-apps/api/core';
import { openByokModal } from './byok.js';
import { hasLlmConfigured } from '../lib/llmStatus.js';
import { loadSolutions } from './solutions.js';
import { loadConcepts } from './concepts.js';
import { loadPapers } from './papers.js';
import { mountIntentLadder } from './intent_ladder.js';
import { loadTrends } from './trends.js';
import { loadPosts, setPostsFilter } from './posts.js';
import { loadSentiment } from './sentiment.js';
import { loadInsights } from './insights.js';
import { loadBets } from './bets.js';
import { wireFreshnessBadge } from '../lib/enrichStatus.js';
import { TAB_PIPELINES, TAB_READONLY, runAllForTopic, runTabPipeline, tabHasData, isAutoRunEnabled, setAutoRunEnabled, tabCountFromBundle } from '../lib/tabPipelines.js';
import { readScreenCache, writeScreenCache } from '../lib/screenCache.js';
import { postLink } from '../lib/postLink.js';

const TOPIC_QUERY_TIMEOUT_MS = 25000;
const TAB_LOAD_TIMEOUT_MS = 70000;
async function withTimeout(promise, ms, label = 'request') {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Per-topic chat history so switching tabs doesn't wipe the conversation.
// key = topic string, value = [{ role: 'user'|'assistant', mode, text }]
// This is the IN-MEMORY buffer for the *currently open* conversation. It is
// hydrated from (and persisted to) SQLite per-conversation via the native
// chat_conv_* commands — ChatGPT-style saved threads, durable across restarts.
const chatHistory = new Map();
// topic -> active conversation id (the thread currently shown in the buffer).
const chatActiveConv = new Map();
// convId -> manual title override (set via rename; wins over the auto-title).
const chatConvTitleOverride = new Map();
// Topics whose DB hydration (+ legacy localStorage migration) already ran this
// session, so re-opening the Chat tab keeps the selected thread instead of
// reloading the most-recent one.
const chatHydrated = new Set();
// Topics with a freshly-started "New chat" that hasn't been persisted yet
// (no message sent). The rail shows an active "New chat" placeholder row for
// these so clicking + New gives immediate visual feedback; cleared the moment
// the first message lands (which mints + saves the real conversation).
const pendingNewConv = new Set();

// ─── Per-topic stats cache (instant first-paint) ───────────────────────────
// Persists the last `topicStats()` result to localStorage keyed by topic so
// the header chips ("345 posts · 0 pains · 0 DIY · 8 src") paint INSTANTLY
// when the user re-opens a topic page. Without this, every topic open spawns
// a fresh Python-sidecar sub-query bundle (~300-800 ms warm, 2+ s cold) and
// the header sits blank during that window. Stale-while-revalidate: cache is
// shown immediately, the real fetch then overwrites it with fresh values.
//
// Why localStorage and not sessionStorage: the user-perceived "second app
// open" win comes specifically from cross-session persistence — first paint
// after a fresh app launch should reflect the LAST observed state, not a
// blank skeleton. Quotas are fine — each entry is a single ~200-byte JSON.
//
// Cache is best-effort. Any read/write/parse error silently no-ops.
const TOPIC_STATS_CACHE_PREFIX = 'gapmap.topic.stats.cache.';
function readTopicStatsCache(topic) {
  if (!topic) return null;
  try {
    const raw = localStorage.getItem(TOPIC_STATS_CACHE_PREFIX + topic);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch {
    return null;
  }
}
function writeTopicStatsCache(topic, stats) {
  if (!topic || !stats || typeof stats !== 'object') return;
  try {
    localStorage.setItem(
      TOPIC_STATS_CACHE_PREFIX + topic,
      JSON.stringify({ ...stats, _ts: Date.now() }),
    );
  } catch {}
}

// Per-topic memo of the last enrich attempt — lets empty-state cards on Map /
// Evidence tabs distinguish "never ran" from "ran but LLM produced 0". Without
// this, a weak Ollama model that returns zero findings looks identical to a
// fresh topic with no extraction at all, so the user can't tell they need a
// bigger model or a cloud key. key = topic, value = { ts, provider, model,
// providerChain, added, error, skipped, corpusSize, droppedOffTopic }.
const _lastEnrichResult = new Map();
function recordEnrichResult(topic, res, err) {
  const np = res?.painpoints_added     ?? res?.painpoints     ?? 0;
  const nf = res?.feature_wishes_added ?? res?.feature_wishes ?? 0;
  const nw = res?.workarounds_added    ?? res?.diy_workarounds ?? 0;
  const npr = res?.products_added      ?? res?.products       ?? 0;
  _lastEnrichResult.set(topic, {
    ts: Date.now(),
    provider: res?.provider || '',
    providerChain: res?.provider_chain || [],
    model: res?.model || '',
    added: np + nf + nw + npr,
    painpoints: np,
    feature_wishes: nf,
    workarounds: nw,
    products: npr,
    error: err || res?.error || '',
    skipped: !!res?.skipped,
    corpusSize: res?.corpus_size ?? null,
    droppedOffTopic: res?.dropped_off_topic_findings || null,
  });
}

// Friendly labels for per-extractor banner copy. Keys match the Python
// `kind` field emitted in `extractor:start` / `extractor:done` events.
const _ENRICH_KIND_LABEL = {
  painpoints:  'painpoints',
  features:    'feature wishes',
  workarounds: 'workarounds',
  complaints:  'product complaints',
};

/**
 * Subscribe to the streaming enrich pipeline for a topic and render progress
 * into the `#map-enrich-banner` element. Returns a promise that resolves
 * after `enrich:stream:done` fires, regardless of outcome (parse-error,
 * crash, clean exit). The `onComplete(summary)` callback runs inside the
 * done handler AFTER the banner is updated, so callers (Map tab) can kick
 * off a map-iframe reload without racing the DOM update.
 *
 * Why this helper instead of inlining: the auto-enrich path AND the manual
 * "Run" button both need the same listener wiring + banner updates. Without
 * a shared helper, the two paths drift + leak listeners.
 *
 * Listeners are unregistered on `enrich:stream:done` (one-shot). The Map
 * tab also kills them on navigation-away via `_activeEnrichUnlistens` so a
 * mid-stream tab-switch doesn't leave background handlers writing to a
 * detached DOM.
 */
const _activeEnrichUnlistens = new Set();

// ─── Map-tab cross-navigation cache ────────────────────────────────────────
// Per-topic in-memory cache of the last rendered Map tab. Survives navigation
// away from the topic and back so re-opening a topic doesn't replay
// buildGraph + relate + exportHtml (3 sidecar spawns, ~1-3s warm). The
// per-`renderTopic`-closure `_mapRender` was lost on every nav; this Map
// outlives the closure.
//
// Entries: { html, outPath, mapMode, ts, stale, statsKey }.
//   - statsKey = "<n_nodes>:<n_edges>" sampled at render time. On revisit
//     we re-fetch topicStats; if the new key differs OR a `gapmap:changed`
//     event fired since render time, the entry is marked stale (keeps
//     serving cache + adds the "stale — Rebuild" chip), and the user can
//     manually rebuild OR auto-update will rebuild on the next open.
//   - ts: epoch ms; entries older than MAP_RENDER_CACHE_TTL_MS are evicted.
// In-memory mirror of the localStorage-backed Map render cache. Built
// lazily on each renderTopic() call from the persisted snapshot.
// Module-level so multiple renderTopic instances in the same session
// share state, but the source of truth lives in localStorage so cache
// survives across app restarts (it didn't before — `new Map()` is
// memory-only).
const _mapRenderCache = new Map();
const MAP_RENDER_LS_KEY = 'gapmap.topic.mapRender.';
// 7-day TTL: the only thing that makes a Map cache stale is the user
// running a fresh collect/enrich, and the `gapmap:changed` listener
// already flips `_mapDirtyTopics` on that signal. The TTL is just a
// belt-and-braces eviction so very-old snapshots get rebuilt even on
// dormant topics. Previously 30 min — too aggressive for a local app.
const MAP_RENDER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

function _readMapRenderFromLS(topic) {
  try {
    const raw = localStorage.getItem(MAP_RENDER_LS_KEY + topic);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.html || !parsed.ts) return null;
    if (Date.now() - parsed.ts > MAP_RENDER_CACHE_TTL_MS) return null;
    return parsed;
  } catch { return null; }
}
function _writeMapRenderToLS(topic, entry) {
  try {
    localStorage.setItem(MAP_RENDER_LS_KEY + topic, JSON.stringify(entry));
  } catch {} // ignore quota errors — cache miss is recoverable
}

// Topics whose Map cache has been invalidated by a write since render time.
// Populated by the global `gapmap:changed` listener below — survives nav.
const _mapDirtyTopics = new Set();

// Cross-navigation dirty signal for non-Map tabs.
//   `_dirtyTopicTabs.get(topic)` → Set<tab-id> of tabs whose cached snapshot
//   is stale because of a mutation that happened since the last render.
// Populated from the same `gapmap:changed` listener as `_mapDirtyTopics`,
// but at finer granularity so `switchTab` can decide per-tab whether to
// re-fire the loader. Without this, every tab switch re-fetched even when
// nothing had changed, because `dirtyTabs` (per-renderTopic-closure) was
// blank on every fresh closure after navigation.
const _dirtyTopicTabs = new Map();

// Map mutation kinds → which tab caches they invalidate. Anything not in
// this list keeps its cache (e.g. byok, schedule, exports). Add new
// mappings here when a new mutation kind affects a tab.
const _MUTATION_KIND_TO_DIRTY_TABS = {
  collect:  ['home', 'map', 'evidence', 'posts', 'sources', 'trends', 'sentiment',
             'insights', 'solutions', 'concepts', 'papers', 'bets', 'report', 'ai_analyses'],
  ingest:   ['home', 'map', 'evidence', 'posts', 'sources',
             'insights', 'solutions', 'concepts'],
  graph:    ['home', 'map', 'evidence',
             'insights', 'solutions', 'concepts', 'bets', 'report'],
  findings: ['home', 'map', 'evidence',
             'insights', 'solutions', 'concepts', 'bets', 'report', 'ai_analyses'],
  // Topic create/delete clears EVERY cache for the affected topic.
  topics:   ['home', 'map', 'evidence', 'posts', 'sources', 'trends', 'sentiment',
             'insights', 'solutions', 'concepts', 'papers', 'bets', 'report',
             'ai_analyses', 'chat', 'research', 'actions', 'search'],
};

(function installMapCacheInvalidator() {
  if (typeof window === 'undefined') return;
  if (window.__gapmapMapCacheInvalidatorInstalled) return;
  window.__gapmapMapCacheInvalidatorInstalled = true;
  window.addEventListener('gapmap:changed', (ev) => {
    const detail = ev?.detail || {};
    const kind = detail.kind;
    const topic = detail.topic;
    // Map cache — single-flag "needs rebuild?" semantics, kept for back-compat
    // with the loadMap() short-circuit. Set on graph/collect/ingest/findings.
    if (kind === 'graph' || kind === 'collect' || kind === 'ingest' || kind === 'findings') {
      if (topic) {
        _mapDirtyTopics.add(topic);
      } else {
        for (const k of _mapRenderCache.keys()) _mapDirtyTopics.add(k);
      }
    }
    // Per-tab dirty set. Lookup which tabs this mutation kind affects, mark
    // them all dirty for the affected topic. Mutation without a topic field
    // (rare — e.g. trash purge) marks every cached topic dirty.
    const tabs = _MUTATION_KIND_TO_DIRTY_TABS[kind];
    if (!tabs || !tabs.length) return;
    const targetTopics = topic ? [topic] : [..._dirtyTopicTabs.keys()];
    for (const t of targetTopics) {
      let s = _dirtyTopicTabs.get(t);
      if (!s) { s = new Set(); _dirtyTopicTabs.set(t, s); }
      for (const tab of tabs) s.add(tab);
    }
  });
})();

/** True if `tab` is dirty for `topic` (set by `gapmap:changed` since render). */
function isTabDirtyAcrossNav(topic, tab) {
  return !!(_dirtyTopicTabs.get(topic)?.has(tab));
}

/** Clear the dirty bit for one (topic, tab) — called after a successful loader run. */
function clearTabDirtyAcrossNav(topic, tab) {
  const s = _dirtyTopicTabs.get(topic);
  if (s) {
    s.delete(tab);
    if (s.size === 0) _dirtyTopicTabs.delete(topic);
  }
}
// `opts.manual` (default false) — when true, a hit on the per-topic dedup
//   lock (`already_running:true`) is treated as "preempt the in-flight
//   enrich and run mine instead" rather than the default "subscribe + show
//   piggy-back banner". The Map-tab auto-enrich keeps `manual:false` so
//   re-opening the Map for the same topic doesn't kill its own in-flight
//   first call. Every visible Enrich/Run button in the UI passes
//   `manual:true` so a user click always wins over a background pass.
//
// `opts.fillMissingAfter` (default false) — when true AND `only` is a
//   single category, after this stream finalizes successfully fire a
//   follow-up `runEnrichStreamForTopic(topic, { only: null })` so the
//   remaining 3 categories also get extracted. Matches the user's
//   "auto-queue an all-categories pass after yours finishes" preference
//   so picking 'painpoints only' doesn't strand features/workarounds/
//   complaints empty until the next manual click. The follow-up runs with
//   `manual:false` (no self-preempt) and `fillMissingAfter:false` (no
//   recursion). Cheap re-run of painpoints (~10-20s on Ollama) is the
//   price for one sidecar spawn instead of three.
async function runEnrichStreamForTopic(topic, {
  onComplete,
  only = null,
  parallel = false,
  bannerId = 'map-enrich-banner',
  manual = false,
  fillMissingAfter = false,
} = {}) {
  const mod = await import('@tauri-apps/api/event');
  const bannerSelector = `#${bannerId}`;
  const banner = () => document.querySelector(bannerSelector);
  const statusEl = () => document.getElementById('map-enrich-status');
  const samplesEl = () => document.getElementById('map-enrich-samples');

  const firstSamples = []; // accumulator so we can show "5 painpoints: …, …"
  const counts = { painpoints: 0, features: 0, workarounds: 0, complaints: 0 };
  let lastSummary = null;
  let provider = '';
  let corpusSize = '?';

  const setStatus = (text) => {
    const el = statusEl();
    if (el) el.textContent = text;
  };

  const renderSamples = () => {
    const el = samplesEl();
    if (!el) return;
    if (!firstSamples.length) { el.innerHTML = ''; return; }
    // Show the first 6 finding titles we've seen so the user sees that real
    // content is coming through, even before all 4 extractors finish.
    const chips = firstSamples.slice(0, 6).map(s =>
      `<span class="map-enrich-sample-chip" title="${esc(s.kind)}">${esc(s.text)}</span>`
    ).join('');
    el.innerHTML = chips;
  };

  const handleProgressLine = (line) => {
    if (typeof line !== 'string' || !line.trim()) return;
    let ev;
    try { ev = JSON.parse(line); }
    catch { return; } // Non-JSON stderr from a provider — ignore.
    if (!ev || typeof ev !== 'object') return;
    const name = ev._event;
    if (name === 'enrich:start') {
      provider = ev.provider || '';
      corpusSize = ev.corpus_size ?? '?';
      const mode = ev.parallel ? 'parallel' : 'sequential';
      const extractors = Array.isArray(ev.extractors) ? ev.extractors : [];
      setStatus(`${provider || 'LLM'} extracting over ${corpusSize} posts · ${extractors.length} categor${extractors.length === 1 ? 'y' : 'ies'} · ${mode}`);
    } else if (name === 'extractor:start') {
      const label = _ENRICH_KIND_LABEL[ev.kind] || ev.kind;
      setStatus(`Extracting ${label}…  (provider: ${provider || '?'})`);
    } else if (name === 'extractor:done') {
      const kind = ev.kind;
      const count = Number(ev.count || 0);
      counts[kind] = count;
      const samples = Array.isArray(ev.sample) ? ev.sample : [];
      for (const s of samples) {
        if (firstSamples.length >= 12) break;
        firstSamples.push({ kind, text: s });
      }
      renderSamples();
      const label = _ENRICH_KIND_LABEL[kind] || kind;
      setStatus(`✓ ${count} ${label} · continuing…`);
    } else if (name === 'extractor:error') {
      const label = _ENRICH_KIND_LABEL[ev.kind] || ev.kind;
      setStatus(`⚠ ${label} extractor failed — continuing with others`);
      console.warn(`extractor:error ${ev.kind}:`, ev.error);
    } else if (name === 'enrich:done') {
      lastSummary = ev.summary || null;
    }
  };

  return new Promise(async (resolve) => {
    let finalized = false;
    // Watchdog timer for the piggy-back path. Declared up here so finalize()
    // can clear it when the stream really terminates.
    let piggyWatchdog = null;
    const finalize = async () => {
      if (finalized) return;
      finalized = true;
      if (piggyWatchdog) { clearTimeout(piggyWatchdog); piggyWatchdog = null; }
      // Update banner with final state.
      const b = banner();
      if (b) {
        const total = counts.painpoints + counts.features + counts.workarounds + counts.complaints;
        if (lastSummary?.skipped) {
          b.className = 'map-enrich-banner warn';
          b.innerHTML = `⚠ Enrichment skipped — ${esc(lastSummary.reason || 'no LLM configured')}`;
        } else if (lastSummary?.ok === false) {
          b.className = 'map-enrich-banner err';
          b.innerHTML = `✗ Enrichment failed — ${esc(String(lastSummary.error || 'unknown').slice(0, 180))}
            <button class="btn btn-ghost btn-sm btn-bordered map-banner-btn" id="banner-change-llm" type="button">Change LLM</button>`;
          document.getElementById('banner-change-llm')?.addEventListener('click', () =>
            openByokModal(() => location.reload()));
        } else if (total === 0) {
          b.className = 'map-enrich-banner warn';
          b.innerHTML = `⚠ <code>${esc(provider || 'LLM')}</code> ran over <b>${esc(String(corpusSize))}</b> posts but extracted 0 findings.
            <button class="btn btn-ghost btn-sm btn-bordered map-banner-btn" id="banner-change-llm" type="button">Change LLM</button>
            <button class="btn btn-ghost btn-sm btn-bordered map-banner-btn" id="banner-retry-painpoints" type="button">Retry painpoints only</button>`;
          document.getElementById('banner-change-llm')?.addEventListener('click', () =>
            openByokModal(() => location.reload()));
          document.getElementById('banner-retry-painpoints')?.addEventListener('click', () =>
            runEnrichStreamForTopic(topic, {
              onComplete, only: 'painpoints', manual: true, fillMissingAfter: true,
            }));
        } else {
          b.className = 'map-enrich-banner ok';
          const parts = [];
          if (counts.painpoints)  parts.push(`${counts.painpoints} painpoints`);
          if (counts.features)    parts.push(`${counts.features} feature wishes`);
          if (counts.workarounds) parts.push(`${counts.workarounds} workarounds`);
          if (counts.complaints)  parts.push(`${counts.complaints} complaints`);
          b.innerHTML = `✓ Extracted ${parts.join(', ')} — refreshing map…`;
        }
      }
      recordEnrichResult(topic, lastSummary, lastSummary?.ok === false ? lastSummary?.error : null);
      try { await onComplete?.(lastSummary); }
      catch (e) { console.warn('enrich onComplete errored:', e); }
      // "Auto-queue an all-categories pass" — fires when the caller asked
      // for a single category (e.g. "painpoints only") and we just finished
      // it successfully. Without this, picking painpoints-only strands the
      // other 3 categories empty until the next manual click. Conditions:
      //   1. `fillMissingAfter` was opted in (only the user-facing pickers
      //      set it — the auto-enrich path doesn't, since it already runs
      //      all 4 categories by default).
      //   2. `only` is set (no point filling "missing" when we already ran
      //      every category).
      //   3. The current run finished cleanly — don't pile a follow-up on
      //      top of a skipped/failed enrich, that just confuses the banner.
      // The follow-up runs `manual:false` so a competing manual click can
      // preempt IT in turn (preserves user-action-wins ordering), and
      // `fillMissingAfter:false` so we never recurse here. `parallel:false`
      // keeps Ollama's queue clean — cloud users see a slower follow-up
      // than the parallel manual one, but it's a background fill and the
      // banner makes that explicit.
      const shouldFill = fillMissingAfter
        && typeof only === 'string' && only.length > 0
        && !lastSummary?.skipped && lastSummary?.ok !== false;
      if (shouldFill) {
        // Detach from this promise — the caller's `await` has already been
        // satisfied (resolve below). The follow-up runs as a fire-and-
        // forget background pass and updates the banner via its own
        // stream subscription.
        (async () => {
          try {
            const b = banner();
            if (b) {
              b.className = 'map-enrich-banner info';
              b.innerHTML = `<div class="map-enrich-row">
                <span class="map-building-spinner" style="width:14px;height:14px;border-width:2px;flex-shrink:0"></span>
                <span id="map-enrich-status">Filling remaining categories…</span>
              </div>
              <div id="map-enrich-samples" class="map-enrich-samples"></div>`;
            }
            await runEnrichStreamForTopic(topic, {
              onComplete, only: null, parallel: false, bannerId,
              manual: false, fillMissingAfter: false,
            });
          } catch (e) {
            console.warn('fillMissingAfter follow-up errored:', e);
          }
        })();
      }
      resolve(lastSummary);
    };

    // Subscribe FIRST so we don't miss events from a fast-starting process.
    // Declare the unlisten handles with `let` BEFORE subscribing — the
    // done-event callback references `unlistenDone` inside its own body, and a
    // `const unlistenDone = await mod.listen(..., () => unlistenDone())` leaves
    // the binding in the temporal dead zone until the await resolves. If the
    // done event fires in that window the callback throws
    // "Cannot access 'unlistenDone' before initialization". `let … = null`
    // gives a safe pre-assigned value (the `?.()` calls no-op on null), so the
    // painpoint / manual fetch paths can't hit the TDZ race.
    let unlistenProgress = null;
    let unlistenDone = null;
    unlistenProgress = await mod.listen('enrich:progress', (e) => handleProgressLine(e?.payload));
    unlistenDone = await mod.listen('enrich:stream:done', async (_e) => {
      try { unlistenProgress?.(); } catch {}
      try { unlistenDone?.(); } catch {}
      _activeEnrichUnlistens.delete(unlistenProgress);
      _activeEnrichUnlistens.delete(unlistenDone);
      await finalize();
    });
    _activeEnrichUnlistens.add(unlistenProgress);
    _activeEnrichUnlistens.add(unlistenDone);

    // Kick off the stream. The call returns immediately with metadata about
    // the stream (or `already_running:true` if another is in flight, which
    // we surface with an inline Unstick button + a safety timeout).
    //
    // Why safety timeout: piggy-backing assumes the "other" enrich is
    // genuinely alive and will emit `enrich:stream:done`. If that sidecar
    // crashed between `ActiveGraphOps.insert(key)` and done-event emit
    // (SIGKILL, panic, parent Tauri quit mid-stream), the done event NEVER
    // fires — so this promise would otherwise hang forever. 3 min is
    // longer than any healthy enrich needs (Ollama cold-start + 4
    // extractors ≈ 60-120 s worst case) so a real run will resolve first.
    try {
      const start = await api.enrichGraphStream(topic, { only, parallel });
      if (start?.already_running) {
        const age = Number(start.age_seconds || 0);
        const remaining = Number(start.auto_clears_in_seconds || 0);
        const ageLabel = age > 0 ? ` (started ${age}s ago)` : '';
        // Manual-click preempt: the user's explicit Enrich/Run click should
        // always beat a background auto-enrich for the same topic. Kill the
        // in-flight sidecar, clear the lock, and retry the spawn fresh with
        // the caller's `only` / `parallel` — so picking "painpoints only"
        // doesn't get joined to a slow "all categories sequential" auto pass.
        // Recursion guard: the retry passes `manual:true` so a second-level
        // collision would also preempt, but in practice the lock was just
        // cleared so the recursive call spawns immediately.
        if (manual) {
          try {
            try { unlistenProgress?.(); } catch {}
            try { unlistenDone?.(); } catch {}
            _activeEnrichUnlistens.delete(unlistenProgress);
            _activeEnrichUnlistens.delete(unlistenDone);
            setStatus(`Preempting current run${ageLabel} — starting your request…`);
            await api.cancelEnrich(topic);
            const retry = await runEnrichStreamForTopic(topic, {
              onComplete, only, parallel, bannerId, manual: true, fillMissingAfter,
            });
            resolve(retry);
            return;
          } catch (e) {
            setStatus(`✗ Preempt failed: ${e?.message || e}`);
            lastSummary = { ok: false, error: e?.message || String(e) };
            await finalize();
            return;
          }
        }
        setStatus(`Another enrichment for this topic is already running${ageLabel} — piggy-backing on it…`);
        // Inject an inline Unstick button into the banner so users don't
        // have to dig into dev tools or wait for the Rust-side 10 min
        // stale reclaim. Click → force-clear the lock, unlisten, retry.
        const b = banner();
        if (b) {
          const unstickBtn = document.createElement('button');
          unstickBtn.className = 'btn btn-ghost btn-sm btn-bordered map-banner-btn';
          unstickBtn.type = 'button';
          unstickBtn.id = 'banner-piggyback-unstick';
          unstickBtn.textContent = `Unstick & retry${remaining > 0 ? ` (auto in ${remaining}s)` : ''}`;
          unstickBtn.onclick = async () => {
            try {
              if (piggyWatchdog) { clearTimeout(piggyWatchdog); piggyWatchdog = null; }
              try { unlistenProgress?.(); } catch {}
              try { unlistenDone?.(); } catch {}
              _activeEnrichUnlistens.delete(unlistenProgress);
              _activeEnrichUnlistens.delete(unlistenDone);
              await api.clearGraphInflight(topic, 'enrich');
              setStatus('Inflight lock cleared — restarting enrich…');
              // Kick off a fresh stream. The outer promise is already
              // resolved via finalize() at the end of the retry chain,
              // so we call the helper and resolve this outer promise
              // to its result.
              const retry = await runEnrichStreamForTopic(topic, {
                onComplete, only, parallel, bannerId, manual, fillMissingAfter,
              });
              resolve(retry);
            } catch (e) {
              setStatus(`✗ Unstick failed: ${e?.message || e}`);
              lastSummary = { ok: false, error: e?.message || String(e) };
              await finalize();
            }
          };
          b.appendChild(document.createTextNode(' '));
          b.appendChild(unstickBtn);
        }
        // Watchdog — if NO progress event arrives in 3 min, assume the
        // other enrich is dead and prompt the user via the banner.
        piggyWatchdog = setTimeout(() => {
          if (finalized) return;
          const b2 = banner();
          if (b2) {
            setStatus('No progress in 3 min — the other enrichment may be stuck. Click Unstick & retry.');
            // Re-emphasise the button if it's still there.
            const btn = document.getElementById('banner-piggyback-unstick');
            if (btn) { btn.className = 'btn btn-primary btn-sm map-banner-btn'; }
          }
        }, 180000);
      }
    } catch (err) {
      setStatus(`✗ Failed to start: ${err?.message || err}`);
      lastSummary = { ok: false, error: err?.message || String(err) };
      try { unlistenProgress?.(); } catch {}
      try { unlistenDone?.(); } catch {}
      _activeEnrichUnlistens.delete(unlistenProgress);
      _activeEnrichUnlistens.delete(unlistenDone);
      await finalize();
    }
  });
}

// Legacy single-thread localStorage key (pre-2026-05-31). Read once during
// migration into a real DB conversation, then removed.
const CHAT_HISTORY_KEY = (topic) => `gapmap.chat.${topic}`;
// Remembers which conversation was last open per topic, so re-opening the
// app restores the same thread instead of the most-recent one.
const CHAT_ACTIVE_KEY = (topic) => `gapmap.chat.active.${topic}`;

function loadChatHistory(topic) {
  // In-memory buffer only — DB hydration happens in hydrateChat() before any
  // render. Callers (send/renderMessages) read this synchronously.
  if (!chatHistory.has(topic)) chatHistory.set(topic, []);
  return chatHistory.get(topic);
}

function genConvId() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function deriveConvTitle(topic) {
  const id = chatActiveConv.get(topic);
  if (id && chatConvTitleOverride.has(id)) return chatConvTitleOverride.get(id);
  const msgs = chatHistory.get(topic) || [];
  const firstUser = msgs.find(m => m.role === 'user' && (m.text || '').trim());
  const t = (firstUser?.text || '').trim().replace(/\s+/g, ' ');
  if (!t) return 'New chat';
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}

function getActiveConvId(topic, { create = false } = {}) {
  let id = chatActiveConv.get(topic);
  if (!id && create) {
    id = genConvId();
    chatActiveConv.set(topic, id);
    try { localStorage.setItem(CHAT_ACTIVE_KEY(topic), id); } catch {}
  }
  return id || null;
}

// Durable persist of the active conversation to SQLite. Fire-and-forget —
// callers don't await. A conversation id is minted lazily on the first
// message so empty threads never clutter the saved list.
function persistActiveConv(topic) {
  const msgs = chatHistory.get(topic) || [];
  if (!msgs.length && !chatActiveConv.get(topic)) return Promise.resolve();
  const id = getActiveConvId(topic, { create: msgs.length > 0 });
  if (!id) return Promise.resolve();
  const title = deriveConvTitle(topic);
  return api.chatConvSave(id, topic, title, JSON.stringify(msgs)).catch(() => {});
}

function saveChatHistory(topic) {
  // Fire-and-forget durable write of the active conversation.
  void persistActiveConv(topic);
}

// One-time per session: migrate any legacy localStorage thread into a DB
// conversation, then pick the active conversation (stored → most-recent →
// fresh) and load its messages into the in-memory buffer.
async function hydrateChat(topic) {
  // Deep-link from the global Chats screen — force-open a specific thread even
  // if this topic was already hydrated this session. Honoured before the guard.
  let forceOpen = null;
  try { forceOpen = localStorage.getItem(`gapmap.chat.open.${topic}`); } catch {}
  if (forceOpen) {
    try { localStorage.removeItem(`gapmap.chat.open.${topic}`); } catch {}
    chatHydrated.add(topic);
    chatActiveConv.set(topic, forceOpen);
    try { localStorage.setItem(CHAT_ACTIVE_KEY(topic), forceOpen); } catch {}
    const conv = await api.chatConvGet(forceOpen).catch(() => null);
    chatHistory.set(topic, (conv && Array.isArray(conv.messages)) ? conv.messages : []);
    return;
  }

  if (chatHydrated.has(topic)) return;
  chatHydrated.add(topic);

  // 1. Migrate the old single-thread localStorage blob (once).
  try {
    const legacyRaw = localStorage.getItem(CHAT_HISTORY_KEY(topic));
    if (legacyRaw) {
      let legacy = [];
      try { legacy = JSON.parse(legacyRaw) || []; } catch { legacy = []; }
      if (Array.isArray(legacy) && legacy.length) {
        const existing = await api.chatConvList(topic).catch(() => []);
        if (!existing || !existing.length) {
          const id = genConvId();
          const firstUser = legacy.find(m => m.role === 'user' && (m.text || '').trim());
          const title = firstUser ? `${(firstUser.text || '').trim().slice(0, 47)}` : 'Imported chat';
          await api.chatConvSave(id, topic, title || 'Imported chat', JSON.stringify(legacy)).catch(() => {});
        }
      }
      localStorage.removeItem(CHAT_HISTORY_KEY(topic));
    }
  } catch {}

  // 2. Resolve the active conversation.
  let activeId = null;
  try { activeId = localStorage.getItem(CHAT_ACTIVE_KEY(topic)); } catch {}
  const list = await api.chatConvList(topic).catch(() => []);
  const ids = new Set((list || []).map(c => c.id));
  if (!activeId || !ids.has(activeId)) {
    activeId = (list && list[0]) ? list[0].id : null;
  }
  if (activeId) {
    chatActiveConv.set(topic, activeId);
    try { localStorage.setItem(CHAT_ACTIVE_KEY(topic), activeId); } catch {}
    const conv = await api.chatConvGet(activeId).catch(() => null);
    chatHistory.set(topic, (conv && Array.isArray(conv.messages)) ? conv.messages : []);
  } else if (!chatHistory.has(topic)) {
    chatHistory.set(topic, []);
  }
}

// ─── Toast helper (replaces alert() for non-blocking feedback) ───────────
function ensureToastStack() {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}
// Tracks pending toast auto-remove timers so renderTopic's cleanup can nuke
// them when the user navigates away mid-toast — otherwise zombie setTimeouts
// try to remove DOM nodes belonging to screens that no longer exist.
const _activeToastTimers = new Set();

function showToast(title, detail = '', kind = 'err', ms = 5000) {
  const stack = ensureToastStack();
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  const icMap = { err: 'x-circle', warn: 'alert-triangle', ok: 'check-circle-2' };
  el.innerHTML = `
    <span class="toast-ic"><i data-lucide="${icMap[kind] || 'info'}"></i></span>
    <div class="toast-body">
      <div class="toast-title">${esc(title)}</div>
      ${detail ? `<div style="color:var(--ink-3);font-size:12px">${esc(detail)}</div>` : ''}
    </div>
    <button class="toast-close" aria-label="dismiss">×</button>`;
  stack.appendChild(el);
  let fadeTimer = null;
  const remove = () => {
    el.style.opacity = '0';
    fadeTimer = setTimeout(() => el.remove(), 200);
    _activeToastTimers.add(fadeTimer);
  };
  el.querySelector('.toast-close').onclick = remove;
  if (ms) {
    const autoTimer = setTimeout(remove, ms);
    _activeToastTimers.add(autoTimer);
  }
}

// ─── Skeleton + error-card renderers ─────────────────────────────────────
function skeletonCards(n = 2) {
  const card = `
    <div class="skeleton-card">
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line med"></div>
      <div class="skeleton skeleton-line short"></div>
      <div class="skeleton skeleton-line med"></div>
    </div>`;
  return Array(n).fill(card).join('');
}
function errorCard(title, detail, actions = []) {
  const btns = actions.map((a, i) => {
    const iconHtml = a.icon ? `<i data-lucide="${esc(a.icon)}"></i> ` : '';
    return `<button class="btn ${a.primary ? 'btn-primary' : 'btn-ghost btn-bordered'} btn-sm icon-btn" data-eci="${i}">${iconHtml}${esc(a.label)}</button>`;
  }).join('');
  return `
    <div class="error-card">
      <div class="error-card-ic"><i data-lucide="x-circle"></i></div>
      <div class="error-card-body">
        <div class="error-card-title">${esc(title)}</div>
        <div class="error-card-detail">${esc(detail || '')}</div>
        <div class="error-card-actions">${btns}</div>
      </div>
    </div>`;
}
// ─── Source-picker modal (Rerun collect) ─────────────────────────────────────
const ALL_SOURCES = [
  // External sources from Python CLI's --sources help text. 'reddit' is
  // special: gates the Reddit fetch stages via skipReddit param.
  { id: 'reddit',        label: 'Reddit',          group: 'social',  defaultOn: true },
  { id: 'hn',            label: 'Hacker News',     group: 'social',  defaultOn: true },
  { id: 'lemmy',         label: 'Lemmy',           group: 'social',  defaultOn: false },
  { id: 'mastodon',      label: 'Mastodon',        group: 'social',  defaultOn: false },
  { id: 'devto',         label: 'Dev.to',          group: 'social',  defaultOn: true },
  { id: 'stackoverflow', label: 'Stack Overflow',  group: 'social',  defaultOn: true },
  { id: 'github',        label: 'GitHub trending', group: 'dev',     defaultOn: true },
  { id: 'github_issues', label: 'GitHub issues',   group: 'dev',     defaultOn: false },
  { id: 'arxiv',         label: 'arXiv',           group: 'science', defaultOn: true },
  { id: 'pubmed',        label: 'PubMed',          group: 'science', defaultOn: true },
  { id: 'openalex',      label: 'OpenAlex',        group: 'science', defaultOn: true },
  { id: 'scholar',       label: 'Scholar',         group: 'science', defaultOn: false },
  { id: 'gnews',         label: 'Google News',     group: 'web',     defaultOn: true },
  { id: 'trends',        label: 'Google Trends',   group: 'web',     defaultOn: true },
  { id: 'appstore',      label: 'App Store',       group: 'apps',    defaultOn: true },
  { id: 'playstore',     label: 'Play Store',      group: 'apps',    defaultOn: true },
  { id: 'trustpilot',    label: 'Trustpilot',      group: 'apps',    defaultOn: true },
  { id: 'producthunt',   label: 'Product Hunt',    group: 'apps',    defaultOn: true },
  // Curated RSS feed bundles. Each category fans out to ~5-10 feeds, filtered
  // by topic-keyword match in title/summary so unrelated posts are dropped.
  // Keep two RSS bundles on by default so "other sources" aren't silently
  // excluded on reruns; the rest remain opt-in to control volume/noise.
  { id: 'rss_startup',     label: 'RSS: Startup / founder',   group: 'rss', defaultOn: false },
  { id: 'rss_tech_news',   label: 'RSS: Tech news',           group: 'rss', defaultOn: true },
  { id: 'rss_products',    label: 'RSS: Products / launches', group: 'rss', defaultOn: true },
  { id: 'rss_ml',          label: 'RSS: ML / AI research',    group: 'rss', defaultOn: false },
  { id: 'rss_science',     label: 'RSS: Science (general)',   group: 'rss', defaultOn: false },
  { id: 'rss_engineering', label: 'RSS: Engineering blogs',   group: 'rss', defaultOn: false },
  { id: 'rss_learning',    label: 'RSS: Learning / essays',   group: 'rss', defaultOn: false },
  { id: 'rss_design',      label: 'RSS: Design / UX',         group: 'rss', defaultOn: false },
  { id: 'rss_psychology',  label: 'RSS: Psychology',          group: 'rss', defaultOn: false },
  { id: 'rss_neuroscience',label: 'RSS: Neuroscience',        group: 'rss', defaultOn: false },
  { id: 'rss_marketing',   label: 'RSS: Marketing / growth (15 feeds)', group: 'rss', defaultOn: false },
  { id: 'rss_persuasion',  label: 'RSS: Persuasion / behavioral', group: 'rss', defaultOn: false },
  { id: 'rss_swipe',       label: 'RSS: Ad swipe files',      group: 'rss', defaultOn: false },
];

const GROUP_LABELS = {
  social:  'Social / forums',
  dev:     'Developer',
  science: 'Scientific literature',
  web:     'Web / news / trends',
  apps:    'App stores',
  rss:     'RSS feeds (curated)',
};

// Per-topic cache for the source-picker modal. Re-opening the modal for
// the same topic was re-firing this SQL every time (one sidecar spawn
// per open). 60 s TTL — a fresh collect that just added a new source
// will show up after the modal auto-refreshes on navigation; within a
// modal session the cache is authoritative.
const _existingSourcesCache = new Map(); // topic → { set, ts }
const _EXISTING_SOURCES_TTL_MS = 60_000;

async function detectExistingSources(topic) {
  // Returns Set<sourceId> of sources that already have posts for this topic.
  const cached = _existingSourcesCache.get(topic);
  if (cached && Date.now() - cached.ts < _EXISTING_SOURCES_TTL_MS) {
    return cached.set;
  }
  try {
    const rows = await api.runQuery(
      `SELECT DISTINCT coalesce(p.source_type, 'reddit') AS src
         FROM topic_posts tp JOIN posts p ON p.id = tp.post_id
         WHERE tp.topic = :topic`,
      topic,
    );
    const set = new Set((rows || []).map(r => (r.src || 'reddit').toLowerCase()));
    _existingSourcesCache.set(topic, { set, ts: Date.now() });
    return set;
  } catch (e) {
    console.warn('detectExistingSources failed:', e);
    return new Set();
  }
}

async function openSourcePickerModal(topic) {
  const existing = await detectExistingSources(topic);
  // Default checked = union(existing, defaults). Reruns should keep prior
  // successful sources selected while still including newly-added defaults
  // (e.g. app reviews + RSS bundles) so source coverage expands over time.
  const defaultSet = new Set(ALL_SOURCES.filter(s => s.defaultOn).map(s => s.id));
  // Per-topic saved selection (from "Save (don't fetch yet)") wins over
  // defaults when present — that's the user's explicit choice for this
  // topic. Existing-source detection still gets unioned in so dropped
  // sources from a prior collect don't silently disappear.
  let savedChecked = null;
  let savedAggressive = false;
  try {
    const raw = localStorage.getItem(`gapmap.topic.sources.${topic}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.checked)) {
        savedChecked = new Set(parsed.checked);
        savedAggressive = !!parsed.aggressive;
      }
    }
  } catch {}
  const initialChecked = savedChecked
    ? new Set([...savedChecked, ...existing])
    : new Set([...defaultSet, ...existing]);

  const groups = {};
  for (const src of ALL_SOURCES) {
    if (!groups[src.group]) groups[src.group] = [];
    groups[src.group].push(src);
  }

  const groupHtml = Object.entries(groups).map(([key, list]) => {
    const items = list.map(src => {
      const checked = initialChecked.has(src.id) ? 'checked' : '';
      const wasFetched = existing.has(src.id);
      return `
        <label class="src-pick-row">
          <input type="checkbox" data-src="${esc(src.id)}" ${checked} />
          <span class="src-pick-label">${esc(src.label)}</span>
          ${wasFetched ? '<span class="src-pick-badge">already fetched</span>' : ''}
        </label>
      `;
    }).join('');
    return `
      <div class="src-pick-group">
        <h5>${esc(GROUP_LABELS[key] || key)}</h5>
        <div class="src-pick-rows">${items}</div>
      </div>
    `;
  }).join('');

  const host = document.createElement('div');
  host.className = 'src-pick-backdrop';
  host.innerHTML = `
    <div class="src-pick-dialog">
      <div class="src-pick-head">
        <h3>Rerun collect for <em>${esc(topic)}</em></h3>
        <button class="src-pick-close" aria-label="close"><i data-lucide="x"></i></button>
      </div>
      <p class="src-pick-sub">Pick which sources to fetch from. Sources you've already collected are pre-checked. Uncheck to skip them — Reddit's heavy stages run only if Reddit is checked.</p>
      <div class="src-pick-toolbar">
        <button type="button" class="btn btn-ghost btn-xs btn-bordered" id="src-pick-only-new">Only new (uncheck already-fetched)</button>
        <button type="button" class="btn btn-ghost btn-xs btn-bordered" id="src-pick-all">All</button>
        <button type="button" class="btn btn-ghost btn-xs btn-bordered" id="src-pick-none">None</button>
      </div>
      <div class="src-pick-grid">${groupHtml}</div>
      <div class="src-pick-foot">
        <label class="src-pick-aggressive">
          <input type="checkbox" id="src-pick-aggressive" ${savedAggressive ? 'checked' : ''} />
          <span>Aggressive (max limits + historical archive — slower, deeper)</span>
        </label>
        <div class="src-pick-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="src-pick-cancel">Cancel</button>
          <button type="button" class="btn btn-ghost btn-sm btn-bordered" id="src-pick-save"
                  title="Remember these sources for this topic — don't fetch right now. Next manual collect picks them up.">
            Save (don't fetch yet)
          </button>
          <button type="button" class="btn btn-primary btn-sm icon-btn" id="src-pick-go">
            <i data-lucide="play"></i> Run
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(host);
  window.refreshIcons?.();

  const close = () => host.remove();
  host.querySelector('.src-pick-close').onclick = close;
  host.querySelector('#src-pick-cancel').onclick = close;
  host.addEventListener('click', (e) => { if (e.target === host) close(); });

  // Bulk-toggle helpers
  const setAll = (val) => host.querySelectorAll('input[data-src]').forEach(cb => { cb.checked = val; });
  host.querySelector('#src-pick-all').onclick = () => setAll(true);
  host.querySelector('#src-pick-none').onclick = () => setAll(false);
  host.querySelector('#src-pick-only-new').onclick = () => {
    host.querySelectorAll('input[data-src]').forEach(cb => {
      cb.checked = !existing.has(cb.dataset.src);
    });
  };

  // Common picker-state extractor — reads checked sources, the aggressive
  // flag, and persists them to localStorage. Both "Run" and "Save without
  // fetching" feed off this so the on-disk state is identical and the
  // next collect (whether fired now or later) picks up the same prefs.
  function _persistPickerSelection() {
    const checkedIds = Array.from(host.querySelectorAll('input[data-src]:checked'))
      .map(cb => cb.dataset.src);
    const includeReddit = checkedIds.includes('reddit');
    const externalSources = checkedIds.filter(s => s !== 'reddit');
    const aggressive = host.querySelector('#src-pick-aggressive').checked;
    if (checkedIds.length === 0) return null;
    localStorage.setItem('gapmap.collect.last_aggressive', String(aggressive));
    localStorage.setItem(
      'gapmap.collect.last_sources',
      externalSources.length > 0 ? externalSources.join(',') : '',
    );
    localStorage.setItem('gapmap.collect.last_skip_reddit', String(!includeReddit));
    // Per-topic source preference — survives picker close and is what a
    // future collect should default to (instead of ALL_SOURCES.defaultOn).
    localStorage.setItem(
      `gapmap.topic.sources.${topic}`,
      JSON.stringify({ checked: checkedIds, aggressive, ts: Date.now() }),
    );
    return { checkedIds, includeReddit, externalSources, aggressive };
  }

  host.querySelector('#src-pick-save').onclick = () => {
    const sel = _persistPickerSelection();
    if (!sel) {
      alert('Pick at least one source.');
      return;
    }
    close();
    try {
      window.toast?.(
        `Saved ${sel.checkedIds.length} source(s) for "${topic}". No fetch fired.`,
        'info',
      );
    } catch {}
  };

  host.querySelector('#src-pick-go').onclick = async () => {
    const sel = _persistPickerSelection();
    if (!sel) {
      alert('Pick at least one source.');
      return;
    }
    const { checkedIds: checked, includeReddit, externalSources, aggressive } = sel;

    // _persistPickerSelection already wrote the localStorage keys
    // collect.js reads on mount (last_sources, last_skip_reddit,
    // last_aggressive). Navigate to the live progress screen — collect.js
    // will pick up those values and fire startCollect with the correct
    // args. Without the explicit stash, collect.js's 2-arg startCollect
    // call would fire FIRST and ignore the source filter entirely (root
    // cause: bug 2026-04-20 where selecting only playstore still searched
    // Reddit).
    void includeReddit; void externalSources; void aggressive; void checked;
    // Close immediately so the modal never lingers over the collect screen.
    close();
    location.hash = `#/collect/${encodeURIComponent(topic)}`;
  };
}

function renderQuickExtract(result) {
  if (!result || typeof result !== 'object') {
    return `<div class="muted" style="padding:8px">No result.</div>`;
  }
  if (result.error) {
    return `<div class="error-card-detail" style="padding:8px">${esc(result.error)}</div>`;
  }
  if (result.skipped) {
    return `<div class="muted" style="padding:8px">Skipped: ${esc(result.reason || 'no LLM provider')}. Add a key in Settings.</div>`;
  }
  const sections = [
    { key: 'painpoints',         label: 'Pain points',        labelField: 'painpoint',  ev: 'evidence' },
    { key: 'feature_wishes',     label: 'Feature wishes',     labelField: 'feature',    ev: 'user_quote' },
    { key: 'product_complaints', label: 'Product complaints', labelField: 'product',    ev: 'complaint' },
    { key: 'diy_workarounds',    label: 'DIY workarounds',    labelField: 'workaround', ev: 'user_quote' },
  ];
  const html = sections.map(s => {
    const list = Array.isArray(result[s.key]) ? result[s.key] : [];
    const items = list.length === 0
      ? `<div class="muted" style="padding:6px 0">none extracted</div>`
      : list.map(it => {
          if (it && it._parse_error) {
            return `<div class="quick-extract-item parse-err">parse error — see raw output</div>`;
          }
          const title = esc(it?.[s.labelField] || it?.title || '(unnamed)');
          const ev = it?.[s.ev] ? `<div class="quick-extract-ev">"${esc(it[s.ev])}"</div>` : '';
          const freq = it?.frequency != null ? `<span class="quick-extract-freq">×${it.frequency}</span>` : '';
          return `<div class="quick-extract-item"><div class="quick-extract-title">${title}${freq}</div>${ev}</div>`;
        }).join('');
    return `
      <details class="quick-extract-section" ${list.length > 0 ? 'open' : ''}>
        <summary>${s.label} <span class="muted">(${list.length})</span></summary>
        <div class="quick-extract-body">${items}</div>
      </details>
    `;
  }).join('');
  return `
    <p class="muted" style="font-size:11px;margin:0 0 8px">Preview only — run <b>Build &amp; enrich</b> to persist these into the graph.</p>
    ${html}
  `;
}
function wireErrorCard(containerEl, actions) {
  containerEl.querySelectorAll('[data-eci]').forEach(btn => {
    const idx = parseInt(btn.dataset.eci, 10);
    if (!Number.isFinite(idx)) return;
    btn.onclick = () => actions[idx]?.onClick?.();
  });
  window.refreshIcons?.();
}

function normalizeTopicLabel(value) {
  const s = String(value ?? '');
  return s.replace(/\s+/g, ' ').trim();
}

function topicCompareKey(value) {
  return normalizeTopicLabel(value).toLocaleLowerCase();
}

function safeDecodeTopicSlug(value) {
  const s = String(value ?? '');
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export async function renderTopic(root, { params }) {
  const routeTopic = safeDecodeTopicSlug(params[0] || '');
  let topic = routeTopic;
  try {
    const topics = await api.listTopics();
    const routeKey = topicCompareKey(routeTopic);
    if (routeKey) {
      const matched = (Array.isArray(topics) ? topics : []).find((t) =>
        topicCompareKey(t?.topic) === routeKey
      );
      if (matched?.topic) topic = String(matched.topic);
    }
  } catch {}
  const topicLabel = normalizeTopicLabel(topic) || topic;
  if (topic && routeTopic && topic !== routeTopic) {
    const canonicalHash = `#/topic/${encodeURIComponent(topic)}`;
    if (location.hash !== canonicalHash) {
      history.replaceState(null, '', canonicalHash);
    }
  }
  const TAB_STATE_KEY = `gapmap.topic.tab.${topic}`;
  const TAB_HTML_CACHE_KEY = `gapmap.topic.tab.html.${topic}.`;
  const MAP_MODE_KEY = `gapmap.topic.mapMode.${topic}`;
  const MAP_AUTO_UPDATE_KEY = `gapmap.topic.mapAutoUpdate.${topic}`;
  // Bump whenever the exported graph viewer (export.py) gains a feature the
  // cached HTML file won't have (e.g. left-panel minimize, citation focus).
  // loadMap force-rebuilds any topic whose stored version is older, so the new
  // viewer self-heals on first open — no manual Rebuild needed.
  const MAP_EXPORT_VERSION = 2;
  const MAP_EXPORT_VER_KEY = `gapmap.topic.mapExportVer.${topic}`;
  // This is a LOCAL app reading a LOCAL SQLite — the only thing that
  // makes a cached snapshot stale is the user explicitly running a
  // collect / enrich / ingest. The dirtyTabs / mutation listener above
  // already handles that case (it forces a fresh load via switchTab).
  // So the TTL here is just a belt-and-braces eviction for snapshots
  // older than a week — long enough that "come back tomorrow" never
  // shows a loading spinner on a tab whose data hasn't changed.
  //
  // Previously this was 10 min. User feedback: "this is 2026 why is it
  // loading? why isn't it instant?" — the 10 min cap was an artifact
  // from when the cache was experimental.
  const TAB_HTML_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  // Per-instance tab state (fix: module-level state leaked between topics).
  // Default to topic home (implemented by the insights renderer).
  let activeTab = 'home';
  // Set true once the initial mount's `switchTab(defaultTab)` resolves, so
  // any `gapmap:changed` events queued mid-mount don't fire a second
  // `switchTab(curr)` against a stale `activeTab` and cause the active tab
  // to flicker / change without user input. See the listener guard below.
  let initialMountComplete = false;
  // Keep tab DOM alive between switches so revisits are instant.
  // We move real DOM nodes in/out (not cloned HTML), so event listeners
  // attached by loaders survive round-trips.
  const tabDomCache = new Map(); // tab -> holder element containing cached nodes
  const dirtyTabs = new Set();   // tabs that must reload from source
  // Tabs with live streams/iframes should always mount fresh.
  // Re-parenting cached iframe DOM (Map) can produce blank/stale graph renders.
  const NON_CACHEABLE_TABS = new Set(['chat', 'map']);
  // Map tab does heavy async work (graph build/relate/export + iframe render).
  // Guard against re-entrant loads triggered by rapid events/clicks; those can
  // stack sidecar jobs, balloon memory, and leave the tab "loading..." forever.
  let mapLoadInFlight = false;
  let mapReloadQueued = false;
  let mapReloadQueuedForce = false;
  // In-session Map render cache. Stores the full innerHTML string + the
  // exported HTML file path + the mode it was rendered in. loadMap short-
  // circuits to this cache on repeat opens UNLESS:
  //   * force === true (Rebuild button / mode-toggle / key-change)
  //   * dirtyTabs.has('map') AND auto-update is ON (new collect / enrich just
  //     landed and the user opted in to automatic refresh)
  // When the map is dirty but auto-update is OFF, we still serve from cache
  // and surface a "Data changed — click Rebuild" chip so the user knows they
  // can refresh manually. This collapses the ~3 Python sidecar spawns +
  // iframe re-render per Map open down to 0 spawns on steady-state revisits.
  // Pull from the module-level cache so the Map tab survives nav-away/back.
  // Evict if older than TTL — a 30-min-old map is almost certainly stale by
  // some signal we missed (background daemon write, manual sqlite poke).
  let _mapRender = null;  // { html, outPath, mapMode, ts, stale, statsKey } — single-topic scope.
  {
    // Restore order:
    //   1. In-memory `_mapRenderCache` (fastest; same session)
    //   2. localStorage via `_readMapRenderFromLS` (survives app restart)
    // Either path goes through the same TTL check inside the reader.
    let cached = _mapRenderCache.get(topic);
    if (!cached) {
      const fromLS = _readMapRenderFromLS(topic);
      if (fromLS) {
        cached = fromLS;
        _mapRenderCache.set(topic, fromLS);  // promote to memory cache
      }
    }
    if (cached && (Date.now() - (cached.ts || 0)) < MAP_RENDER_CACHE_TTL_MS) {
      _mapRender = cached;
    } else if (cached) {
      _mapRenderCache.delete(topic);
    }
  }
  const PERSISTED_CACHEABLE_TABS = new Set([
    // Cache every visible topic tab so re-open always paints immediately.
    'home', 'map', 'report', 'trends', 'sentiment', 'sources',
    'posts', 'research', 'solutions', 'concepts', 'papers', 'bets',
    'evidence', 'chat', 'actions', 'ai_analyses',
  ]);

  function getTabHtmlCacheKey(name) {
    return `${TAB_HTML_CACHE_KEY}${name}`;
  }

  function readTabHtmlSnapshot(name) {
    if (!PERSISTED_CACHEABLE_TABS.has(name)) return null;
    try {
      // localStorage, not sessionStorage. sessionStorage is wiped when
      // the Tauri webview reloads (which happens on every app launch),
      // so the previous implementation only ever served cache WITHIN
      // a single session. localStorage persists across launches —
      // open the topic tomorrow, painted instantly from disk.
      const raw = localStorage.getItem(getTabHtmlCacheKey(name));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const ts = Number(parsed.ts || 0);
      const html = String(parsed.html || '');
      if (!html || !Number.isFinite(ts)) return null;
      if (Date.now() - ts > TAB_HTML_CACHE_TTL_MS) return null;
      return { ts, html };
    } catch {
      return null;
    }
  }

  function writeTabHtmlSnapshot(name) {
    if (!PERSISTED_CACHEABLE_TABS.has(name)) return;
    try {
      const html = String(contentEl.innerHTML || '');
      if (!html) return;
      // Avoid persisting transient skeleton / error shells.
      if (
        html.includes('Loading ') ||
        html.includes('loading…') ||
        html.includes('map-building-spinner') ||
        html.includes('Building gap map') ||
        html.includes('empty-state">Error:') ||
        html.includes('error-card')
      ) {
        return;
      }
      // localStorage, not sessionStorage — see readTabHtmlSnapshot above.
      // QuotaExceededError surface area: typical HTML snapshot is
      // 5-50 KB; even 20 tabs × 100 topics fits comfortably in the
      // 5-10 MB localStorage budget. On overflow we drop the write
      // silently (catch below) — better than blowing up the user's
      // app on a corner-case eviction.
      localStorage.setItem(
        getTabHtmlCacheKey(name),
        JSON.stringify({ ts: Date.now(), html })
      );
    } catch {}
  }

  function invalidateTabCache(names) {
    const list = Array.isArray(names) ? names : [names];
    for (const n of list) {
      if (!n) continue;
      dirtyTabs.add(n);
      tabDomCache.delete(n);
    }
  }

  function stashTabDom(name) {
    if (!name || NON_CACHEABLE_TABS.has(name)) return;
    if (contentEl.dataset.tab !== name) return;
    if (!contentEl.hasChildNodes()) return;
    const holder = document.createElement('div');
    while (contentEl.firstChild) holder.appendChild(contentEl.firstChild);
    tabDomCache.set(name, holder);
  }

  function restoreTabDom(name) {
    if (!name || NON_CACHEABLE_TABS.has(name)) return false;
    if (dirtyTabs.has(name)) return false;
    const holder = tabDomCache.get(name);
    if (!holder || !holder.hasChildNodes()) return false;
    while (contentEl.firstChild) contentEl.removeChild(contentEl.firstChild);
    while (holder.firstChild) contentEl.appendChild(holder.firstChild);
    return true;
  }

  function isMapAutoUpdateEnabled() {
    try {
      const raw = localStorage.getItem(MAP_AUTO_UPDATE_KEY);
      return raw !== 'false';
    } catch {
      return true;
    }
  }
  // Per-instance chat stream state.
  // Per-tab interval for live-updating relative timestamps on chat messages.
  let chatTsInterval = null;

  let chatStream = {
    active: false,
    buffer: '',
    currentMsg: null,   // DOM node being filled
    unlistenProgress: null,
    unlistenDone: null,
  };

  root.innerHTML = `
    <!-- Compact 2-row header (UI clean-up 2026-04-21):
         Row 1 = title + status chip + primary stats inline.
         Row 2 = action buttons + provider pill + auto-refresh toggle.
         Breadcrumb folded into the tiny back-link; "Loading topic…"
         subtitle removed (it was redundant with the Collecting chip). -->
    <header class="topic-header-compact">
      <div class="topic-header-row-1">
        <a class="topic-back" href="#/" title="Back to workspace">
          <i data-lucide="arrow-left"></i><span>Workspace</span>
        </a>
        <h1 class="topic-title-inline">${esc(topicLabel)}</h1>
        <a href="#/collect/${encodeURIComponent(topic)}" class="topic-active-chip" id="topic-active-chip" hidden title="A collect is running for this topic — click to watch progress">
          <span class="pulse-dot sm"></span> Collecting…
        </a>
        <div class="topic-header-stats" id="topic-header-stats"></div>
        <!-- Task 8: saturation v1 sparkline + hint. Hidden until first
             read returns — avoids layout flicker on every topic open. -->
        <div class="topic-saturation" id="topic-saturation" hidden
             title="How much new signal the graph is picking up — higher = every new post adds a distinct insight"></div>
        <div id="topic-bet-stats" class="topic-bet-stats" hidden></div>
        <div class="topic-header-spacer"></div>
        <button class="btn btn-ghost btn-sm btn-bordered" id="btn-cancel-collect" hidden style="color:#B84747;border-color:#E8C8C8" title="Stop the in-flight collect for this topic">Cancel fetch</button>
        <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-rerun" title="Rerun collect — pick sources"><i data-lucide="rotate-cw"></i> Rerun</button>
        <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-fetch-more" title="Fetch more — deep 3-year history across ALL subreddits + every source. Thorough but slow (~10-15 min). The first collect was a fast 1-year scan."><i data-lucide="history"></i> Fetch more</button>
        <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-compare-topic" title="Compare this topic's insights with another topic side-by-side"><i data-lucide="git-compare"></i> Compare</button>
        <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-delete" title="Delete topic (soft-delete, 7-day undo)" style="color:#B84747"><i data-lucide="trash-2"></i></button>
      </div>
      <div class="topic-header-row-2">
        <span id="topic-sub" class="topic-meta-line">${esc(topicLabel)}</span>
        <div class="topic-header-spacer"></div>
        <button class="active-llm-pill none" id="topic-llm-pill" title="Click to change provider / model">
          <span class="dot"></span><span id="topic-llm-pill-label">No LLM</span>
        </button>
        <label id="schedule-topic-toggle" class="compact-toggle" title="Include this topic in scheduled re-runs">
          <input type="checkbox" id="cb-schedule-topic" />
          <span>Auto-refresh</span>
        </label>
      </div>
    </header>

    <!-- Topic tabs: always visible, horizontally scrollable.
         Order follows the natural research journey so a user pulled into
         tab N feels the pull toward tab N+1 (Zeigarnik + goal-gradient):

           Phase 1 — Orient & engage:    Home → Map → Chat
             Land on overview, see the graph, then "ask anything" —
             modern LLM-app users expect the conversational hook early.
           Phase 2 — Synthesize:         Report → Sentiment → Trends
             The AI's structured answer, the emotional pulse, the time
             arc.
           Phase 3 — Trust & raw:        Sources → Posts → Evidence
             Where the signal came from, the raw rows, cited quotes.
           Phase 4 — Ideate:             Solutions → Bets
             Adjacent solutions / workarounds, then prioritized bets.
           Phase 5 — Context & science:  Concepts → Research → Papers
             Conceptual frames, the academic corpus, paper analyses.
           Phase 6 — Power tools & act:  AI Analyses → Search → Actions
             LLM run history, full-text re-search, then trigger an action.

         Reordering rationale lives here intentionally — switchTab is
         name-based so DOM order is purely UX. Don't shuffle without a
         user-research reason. -->
    <div class="tabs" id="topic-tabs">
      <button type="button" class="tab active" data-tab="home"><i data-lucide="house"></i> Home<span class="tab-freshness" id="tab-fresh-insights"></span></button>
      <button type="button" class="tab" data-tab="map"><i data-lucide="network"></i> Map<span class="tab-freshness" id="tab-fresh-map"></span></button>
      <button type="button" class="tab" data-tab="chat"><i data-lucide="message-square"></i> Chat</button>
      <button type="button" class="tab" data-tab="report"><i data-lucide="file-text"></i> Report<span class="tab-freshness" id="tab-fresh-report"></span></button>
      <button type="button" class="tab" data-tab="sentiment"><i data-lucide="smile"></i> Sentiment<span class="tab-freshness" id="tab-fresh-sentiment"></span></button>
      <button type="button" class="tab" data-tab="trends"><i data-lucide="trending-up"></i> Trends<span class="tab-freshness" id="tab-fresh-trends"></span></button>
      <button type="button" class="tab" data-tab="sources"><i data-lucide="boxes"></i> Sources<span class="tab-freshness" id="tab-fresh-sources"></span></button>
      <button type="button" class="tab" data-tab="posts"><i data-lucide="list"></i> Posts<span class="tab-freshness" id="tab-fresh-posts"></span></button>
      <button type="button" class="tab" data-tab="evidence"><i data-lucide="search"></i> Evidence<span class="tab-freshness" id="tab-fresh-evidence"></span></button>
      <button type="button" class="tab" data-tab="solutions"><i data-lucide="flask-conical"></i> Solutions<span class="tab-freshness" id="tab-fresh-solutions"></span></button>
      <button type="button" class="tab" data-tab="bets"><i data-lucide="target"></i> Bets<span class="tab-freshness" id="tab-fresh-bets"></span></button>
      <button type="button" class="tab" data-tab="concepts"><i data-lucide="lightbulb"></i> Concepts<span class="tab-freshness" id="tab-fresh-concepts"></span></button>
      <button type="button" class="tab" data-tab="research"><i data-lucide="book-open"></i> Research<span class="tab-freshness" id="tab-fresh-research"></span></button>
      <button type="button" class="tab" data-tab="papers"><i data-lucide="book-marked"></i> Papers<span class="tab-freshness" id="tab-fresh-papers"></span></button>
      <button type="button" class="tab" data-tab="ai_analyses"><i data-lucide="sparkles"></i> AI Analyses<span class="tab-freshness" id="tab-fresh-ai"></span></button>
      <button type="button" class="tab" data-tab="search"><i data-lucide="search-code"></i> Search<span class="tab-freshness" id="tab-fresh-search"></span></button>
      <button type="button" class="tab" data-tab="actions"><i data-lucide="zap"></i> Actions</button>
    </div>

    <!-- Home-tab chrome sits *below* the tab strip so Home reads as:
         pick tab → see overview (ladder + coverage) → scroll into tab body.
         Hidden on non-Home tabs via syncHomeChromeVisibility(). -->
    <div id="topic-home-chrome" data-home-chrome="1">
      <div id="intent-ladder-host"></div>

      <div id="extract-override-row" style="display:flex;align-items:center;gap:8px;padding:6px 10px;margin:6px 0 4px;font-size:12.5px;color:var(--ink-3);border-top:1px dashed var(--line);border-bottom:1px dashed var(--line);display:none" data-role="extract-override"></div>

      <div class="coverage-gaps" id="coverage-gaps" hidden></div>
    </div>

    <div id="tab-content"><div class="empty-state">loading…</div></div>
  `;

  const tabsEl = $('#topic-tabs');
  const contentEl = $('#tab-content');
  window.refreshIcons?.();

  // ── Map-view chat ──────────────────────────────────────────────────────
  // A SECOND, independent chat instance that lives as a right-docked sidebar
  // over the Map tab's graph iframe. Reuses the SAME streaming backend as the
  // Chat tab (api.startChat + chat:progress/chat:done events) but keeps its
  // own ephemeral in-topic history + stream state so it never touches the
  // existing Chat tab. The Chat tab is left fully intact.
  let _mapChatLog = [];                                    // [{role,text,ts}]
  let _mapChatStream = { active: false, unsubP: null, unsubD: null };
  let _mapChatConvId = null;                               // shared DB conversation id

  // Task 9.5 — fire-and-forget render of the extraction prefs override row.
  // Best-effort: any error just hides the row (it's purely informational).
  _renderExtractionOverrideRow(root, topic).catch(() => {});

  // Home-tab chrome visibility. Shows the wrapper (intent ladder + extraction
  // override + coverage gaps) on Home, hides on every other tab. The
  // painters inside still run — we just toggle the container display so the
  // DOM stays warm for instant re-reveal. Called from switchTab() on every
  // tab change and once at mount below so the initial paint is correct.
  function syncHomeChromeVisibility(tabName) {
    const chrome = root.querySelector('#topic-home-chrome');
    if (!chrome) return;
    chrome.style.display = (tabName === 'home') ? '' : 'none';
  }
  // Initial call — activeTab is 'home' at mount unless overridden later.
  syncHomeChromeVisibility(activeTab);

  // ─── Freshness badges (Findings / Map / Gaps / Solutions / …) ────────
  // Performance fix (2026-05-01): every badge used to spawn its own
  // `runQuery` SELECT every 1 s — 11 badges × 1 Hz = 11 sidecar IPC pings
  // per second. Even though `run_query` is now native rusqlite, the IPC
  // framing alone added ~10–30 ms overhead per call and competed with
  // tab-load fetches.
  //
  // New behaviour: ONE bundled native call (`api.topicCountsBundle`) runs
  // every count SQL in a single rusqlite round-trip, cached for 15 s. All
  // badges share that cached bundle through their getCounts() lambda. Each
  // badge ticks at 5 s instead of 1 s — counts only change on enrich /
  // collect, both of which already invalidate the bundle cache. The badges
  // also share a per-topic in-flight promise so a freshly-mounted topic
  // page fires ONE network call total for all 11 badges, not 11.
  let _lastBundle = null;
  const fetchBundle = () => api.topicCountsBundle(topic).then(b => {
    _lastBundle = b || _lastBundle;
    return _lastBundle;
  }).catch(() => _lastBundle || {});
  const FRESH_INTERVAL = 5000;
  const NOUN = {
    home: 'painpoints', insights: 'painpoints',
    map: 'findings', evidence: 'findings',
    solutions: 'workarounds', concepts: 'concepts',
    trends: 'posts', sentiment: 'posts',
    sources: 'sources', posts: 'posts', research: 'posts',
    papers: 'papers', ai_analyses: 'analyses',
  };
  const bundleGetCount = (tabId) => async () => {
    try {
      const bundle = await fetchBundle();
      const n = tabCountFromBundle(tabId, bundle);
      if (!n) return '';
      const noun = NOUN[tabId] || '';
      return noun ? `${n} ${noun}` : `${n}`;
    } catch { return ''; }
  };
  wireFreshnessBadge($('#tab-fresh-evidence'),  topic, { getCounts: bundleGetCount('evidence'),  interval: FRESH_INTERVAL });
  wireFreshnessBadge($('#tab-fresh-map'),       topic, { getCounts: bundleGetCount('map'),       interval: FRESH_INTERVAL });
  wireFreshnessBadge($('#tab-fresh-insights'),  topic, { getCounts: bundleGetCount('home'),      interval: FRESH_INTERVAL });
  wireFreshnessBadge($('#tab-fresh-solutions'), topic, { getCounts: bundleGetCount('solutions'), interval: FRESH_INTERVAL });
  wireFreshnessBadge($('#tab-fresh-trends'),    topic, { getCounts: bundleGetCount('trends'),    interval: FRESH_INTERVAL });
  wireFreshnessBadge($('#tab-fresh-sentiment'), topic, { getCounts: bundleGetCount('sentiment'), interval: FRESH_INTERVAL });
  wireFreshnessBadge($('#tab-fresh-sources'),   topic, { getCounts: bundleGetCount('sources'),   interval: FRESH_INTERVAL });
  wireFreshnessBadge($('#tab-fresh-posts'),     topic, { getCounts: bundleGetCount('posts'),     interval: FRESH_INTERVAL });
  wireFreshnessBadge($('#tab-fresh-research'),  topic, { getCounts: bundleGetCount('research'),  interval: FRESH_INTERVAL });
  wireFreshnessBadge($('#tab-fresh-concepts'),  topic, { getCounts: bundleGetCount('concepts'),  interval: FRESH_INTERVAL });
  wireFreshnessBadge($('#tab-fresh-papers'),    topic, { getCounts: bundleGetCount('papers'),    interval: FRESH_INTERVAL });
  wireFreshnessBadge($('#tab-fresh-ai'),        topic, { getCounts: bundleGetCount('ai_analyses'), interval: FRESH_INTERVAL });
  // Bets: read from hypothesisStats so the badge matches the header pill.
  wireFreshnessBadge($('#tab-fresh-bets'), topic, {
    getCounts: async () => {
      try {
        const r = await api.hypothesisStats(topic);
        const total = Object.values((r && r.stats) || {}).reduce((a, b) => a + (b || 0), 0);
        return total ? `${total} bets` : '';
      } catch { return ''; }
    },
  });
  // Report freshness: "has markdown" is hard to check via run_query — rely
  // on global enrich tick + whatever `export_report_pro` wrote into exports.
  wireFreshnessBadge($('#tab-fresh-report'), topic, { getCounts: async () => '' });
  // Search freshness: how many persisted searches this topic has — a
  // gentle nudge toward re-using saved context instead of re-running.
  wireFreshnessBadge($('#tab-fresh-search'), topic, {
    getCounts: async () => {
      try {
        const rows = await api.runQuery(
          "SELECT count(*) AS n FROM mcp_analyses WHERE topic=:topic AND kind='search'",
          topic,
        );
        const n = Array.isArray(rows) && rows[0]?.n || 0;
        return n ? `${n} saved` : '';
      } catch { return ''; }
    },
  });

  // ─── Unified topic stats (one SQL round-trip, shared across the render) ──
  // Before: 3 separate runQuery calls (header stats, countFindings,
  // node/edge chips). Each spawned its own Python sidecar (~500 ms warm,
  // 2+ min cold). Now one call, awaited once, every consumer reads from
  // the shared promise. Cuts 2 sidecar spawns out of every topic open.
  let _topicStatsPromise = null;
  function topicStats() {
    if (_topicStatsPromise) return _topicStatsPromise;
    _topicStatsPromise = (async () => {
      try {
        const rows = await withTimeout(api.runQuery(
          `SELECT
             (SELECT count(*) FROM topic_posts WHERE topic=:topic) AS posts,
             (SELECT count(*) FROM graph_nodes WHERE topic=:topic AND kind='painpoint') AS painpoints,
             (SELECT count(*) FROM graph_nodes WHERE topic=:topic AND kind='workaround') AS workarounds,
             (SELECT count(*) FROM graph_nodes WHERE topic=:topic AND kind='feature_wish') AS feature_wishes,
             (SELECT count(*) FROM graph_nodes WHERE topic=:topic AND kind='product') AS products,
             (SELECT count(*) FROM graph_nodes WHERE topic=:topic) AS n_nodes,
             (SELECT count(*) FROM graph_edges WHERE topic=:topic) AS n_edges,
             (SELECT max(ts) FROM graph_nodes WHERE topic=:topic) AS latest_node_ts,
             (SELECT count(DISTINCT coalesce(p.source_type,'reddit'))
                FROM topic_posts tp JOIN posts p ON p.id=tp.post_id
                WHERE tp.topic=:topic) AS sources`,
          topic,
        ), TOPIC_QUERY_TIMEOUT_MS, 'topic stats');
        const out = (Array.isArray(rows) && rows[0]) || {};
        // Persist for instant first-paint on next topic open. Write-through
        // covers every successful fetch; failed fetches keep the previous
        // cache unchanged so transient sidecar timeouts don't blank it.
        writeTopicStatsCache(topic, out);
        return out;
      } catch {
        return {};
      }
    })();
    return _topicStatsPromise;
  }

  // Render the header stats. `paint(stats)` is reused by both the cached
  // first paint (synchronous from localStorage) and the fresh fetch path.
  // Stamps `data-cached="1"` on the host while showing stale values so
  // CSS can fade them; cleared once the real fetch lands.
  function paintTopicHeaderStats(stats, { cached = false } = {}) {
    const host = $('#topic-header-stats');
    if (!host || !stats) return;
    host.dataset.cached = cached ? '1' : '';
    host.innerHTML = `
      <span class="th-chip"><b>${(stats.posts || 0).toLocaleString()}</b> posts</span>
      <span class="th-chip"><b>${stats.painpoints || 0}</b> pains</span>
      <span class="th-chip"><b>${stats.workarounds || 0}</b> DIY</span>
      <span class="th-chip"><b>${stats.sources || 0}</b> src</span>`;
  }

  // Synchronous first paint from localStorage — runs BEFORE any await so
  // the user sees real numbers within the same JS task as topic-page
  // mount, not after a 300-800 ms sidecar round-trip.
  const _cachedStats = readTopicStatsCache(topic);
  if (_cachedStats) paintTopicHeaderStats(_cachedStats, { cached: true });

  // Background refresh — overwrites the cached paint with fresh values
  // when the real query lands. Errors keep the cached paint intact.
  (async () => {
    const r = await topicStats();
    paintTopicHeaderStats(r, { cached: false });
  })();

  // Phase-3 per-topic bet stats pill next to the topic name. Hidden on
  // topics with zero tracked bets. Click → Bets tab.
  (async () => {
    const pill = $('#topic-bet-stats');
    if (!pill) return;
    try {
      const r = await api.hypothesisStats(topic);
      const stats = (r && r.stats) || {};
      const total = Object.values(stats).reduce((a, b) => a + (b || 0), 0);
      if (total === 0) { pill.hidden = true; return; }
      const parts = [];
      if (stats.running)     parts.push(`<span class="tbs-chip tbs-running">🏃 ${stats.running}</span>`);
      if (stats.validated)   parts.push(`<span class="tbs-chip tbs-validated">✓ ${stats.validated}</span>`);
      if (stats.invalidated) parts.push(`<span class="tbs-chip tbs-invalidated">✗ ${stats.invalidated}</span>`);
      if (stats.paused)      parts.push(`<span class="tbs-chip tbs-paused">⏸ ${stats.paused}</span>`);
      if (stats.draft)       parts.push(`<span class="tbs-chip tbs-draft">📝 ${stats.draft}</span>`);
      pill.innerHTML = parts.join('');
      pill.title = 'Click to open the Bets tab';
      pill.hidden = false;
      pill.style.cursor = 'pointer';
      pill.addEventListener('click', () => switchTab('bets'));
    } catch { pill.hidden = true; }
  })();

  // ─── Task 8: saturation + coverage-gaps painters ─────────────────────
  // Both read tiny JSON blobs from the Python SQL helpers. Cached 30s in
  // api.js; re-fetched whenever we hear `gapmap:changed`.
  const HINT_COPY = {
    rich:       'Rich signal — keep going',
    converging: 'Converging — new posts add depth',
    saturated:  'Saturated — try a new source for fresh angles',
  };

  async function paintSaturation() {
    const host = $('#topic-saturation');
    if (!host) return;
    try {
      const r = await api.topicSaturation(topic) || {};
      const score = Math.max(0, Math.min(1, Number(r.score) || 0));
      const hint = r.hint || 'saturated';
      const n = Number(r.new_clusters_last_50_posts || 0);
      // Tiny inline sparkline: one 28-wide SVG with a bar whose width
      // reflects the score. Deliberately minimal — no time-series yet.
      const w = Math.max(2, Math.round(score * 28));
      const color = hint === 'rich' ? '#2EA043'
                  : hint === 'converging' ? '#D97706'
                  : '#8B7E74';
      host.innerHTML = `
        <svg width="28" height="10" viewBox="0 0 28 10" aria-hidden="true" style="margin-right:4px">
          <rect x="0" y="3" width="28" height="4" rx="2" fill="#E4E0DB" />
          <rect x="0" y="3" width="${w}" height="4" rx="2" fill="${color}" />
        </svg>
        <span style="color:${color};font-weight:600;font-size:11px">${HINT_COPY[hint] || hint}</span>
        <span class="muted" style="font-size:10.5px;margin-left:6px">${n}/50</span>`;
      host.title = `Saturation score ${score.toFixed(2)} — ${n} distinct clusters across the last 50 posts.`;
      host.hidden = false;
    } catch {
      host.hidden = true;
    }
  }

  async function paintCoverageGaps() {
    const host = $('#coverage-gaps');
    if (!host) return;
    try {
      const r = await api.topicCoverageGaps(topic) || {};
      const gaps = Array.isArray(r.gaps) ? r.gaps : [];
      if (!gaps.length) { host.hidden = true; host.innerHTML = ''; return; }
      const chips = gaps.map(g => {
        const pct = (g.pct === null || g.pct === undefined) ? '' : ` · ${g.pct}%`;
        const btns = (g.suggested_sources || []).map(s => {
          const label = s === 'deepen_products' ? 'Deepen products' : `+ Add ${s}`;
          return `<button class="btn btn-ghost btn-xs btn-bordered cg-btn"
                          data-source="${esc(s)}">${label}</button>`;
        }).join('');
        return `
          <div class="cg-chip">
            <span class="cg-label"><b>${esc(g.label)}</b>
              <span class="muted">· ${g.posts} posts${pct}</span></span>
            <span class="cg-btns">${btns}</span>
          </div>`;
      }).join('');
      host.innerHTML = `
        <div class="cg-head">
          <i data-lucide="compass"></i>
          <span><b>Coverage gaps</b> · one-click enrichments to broaden your corpus</span>
        </div>
        <div class="cg-list">${chips}</div>`;
      host.hidden = false;
      window.refreshIcons?.();

      host.querySelectorAll('.cg-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const src = btn.getAttribute('data-source');
          if (!src) return;
          btn.disabled = true;
          btn.textContent = '…';
          try {
            if (src === 'deepen_products') {
              // Deepen-products isn't a collect source — fire a rebuild-
              // graph / enrich so the LLM re-passes the corpus for more
              // product mentions. Falls back to startCollect if the API
              // doesn't expose enrichGraph (old builds).
              if (typeof api.enrichGraph === 'function') {
                await api.enrichGraph(topic);
              } else {
                await api.startCollect(topic, false, null, true);
              }
            } else {
              // aggressive=false, sources=[src], skipReddit=false.
              await api.startCollect(topic, false, [src], false);
            }
          } catch (e) {
            btn.textContent = `✗ ${(e?.message || e).toString().slice(0, 40)}`;
            setTimeout(() => { btn.disabled = false; btn.textContent = src === 'deepen_products' ? 'Deepen products' : `+ Add ${src}`; }, 2500);
            return;
          }
          btn.textContent = '✓ queued';
          // startCollect already fires gapmap:changed (kind=collect), which
          // re-runs paintCoverageGaps + paintSaturation automatically.
        });
      });
    } catch {
      host.hidden = true;
    }
  }

  paintSaturation();
  paintCoverageGaps();
  let changedRefreshTimer = null;
  const onGapmapChangedTask8 = (ev) => {
    const kind = (ev?.detail?.kind || '').toString();
    const changedTopic = (ev?.detail?.topic || '').toString();
    // Ignore mutation broadcasts for other topics so we keep this topic's
    // tab DOM/session snapshots warm and avoid unnecessary re-fetches.
    if (changedTopic && changedTopic !== topic) return;

    // Incremental cache invalidation by mutation kind. This keeps unaffected
    // tab snapshots intact so reopening the topic is fast, while still
    // forcing fresh loads where underlying data actually changed.
    const tabsByKind = {
      collect:  ['home', 'map', 'report', 'evidence', 'sources', 'research', 'posts', 'trends', 'sentiment', 'actions'],
      ingest:   ['home', 'map', 'report', 'evidence', 'sources', 'research', 'posts', 'trends', 'sentiment', 'actions'],
      findings: ['home', 'map', 'report', 'evidence', 'solutions', 'concepts', 'papers', 'actions', 'bets'],
      graph:    ['home', 'map', 'report', 'evidence', 'solutions', 'concepts', 'papers', 'actions', 'bets'],
      // Export events are emitted by render actions (e.g. report generation).
      // Treating them as broad DB mutations causes report-tab self-reload loops.
      exports:  ['actions'],
      byok:     ['map', 'evidence', 'chat', 'report', 'solutions', 'concepts', 'papers'],
      schedule: ['home'],
      topics:   ['home'],
      trash:    ['home'],
      extraction_prefs: ['home', 'actions', 'bets'],
      // External DB writes (MCP/CLI/freshness poller) land here without a
      // semantic kind; use a broad-but-not-total refresh set.
      db: ['home', 'map', 'report', 'evidence', 'sources', 'research', 'posts', 'solutions', 'concepts', 'papers', 'trends', 'sentiment', 'actions', 'bets'],
    };
    const dirty = tabsByKind[kind] || tabsByKind.db;
    invalidateTabCache(dirty);
    paintSaturation();
    paintCoverageGaps();
    // Keep cache continuously fresh: if the user is currently viewing a tab,
    // rerun that tab loader shortly after the mutation event so the visible
    // UI and persisted snapshot both advance to the latest data.
    if (changedRefreshTimer) clearTimeout(changedRefreshTimer);
    // Gate: if a `gapmap:changed` event lands DURING initial mount (before
    // the user's intended `switchTab(defaultTab)` has resolved), skip the
    // refresh. Without this gate, stale events from the previous topic's
    // listeners (still running until cleanup) fire a `switchTab(activeTab)`
    // against the OLD activeTab value, and the user sees the just-clicked
    // tab silently flip back to something else.
    if (!initialMountComplete) return;
    changedRefreshTimer = setTimeout(() => {
      const curr = normalizeTabName(activeTab);
      if (!curr || !loaders[curr]) return;
      if (!dirty.includes(curr)) return;
      // Prevent report tab from recursively reloading itself when it emits
      // kind=exports while generating markdown.
      if (kind === 'exports' && curr === 'report') return;
      // Avoid self-triggered map reload loops while enrichment/graph updates
      // are streaming events. Map handles its own in-tab refresh path.
      if (curr === 'map') return;
      switchTab(curr);
    }, 250);
  };
  window.addEventListener('gapmap:changed', onGapmapChangedTask8);
  // External DB writers (CLI/MCP) emit this via api freshness poller.
  // Route through the same incremental invalidation path.
  const onDbChangedTask8 = () => onGapmapChangedTask8({ detail: { kind: 'db', topic } });
  window.addEventListener('gapmap:db-changed', onDbChangedTask8);
  // Teardown is in hashCleanup below (gapmap:changed / db-changed must not
  // accumulate — each topic visit used to add two permanent window listeners).

  // Paint the active-LLM pill in the header. Clicking opens the BYOK modal
  // and on close re-paints so the user sees their new choice immediately.
  async function paintLlmPill() {
    const pill = $('#topic-llm-pill');
    const label = $('#topic-llm-pill-label');
    if (!pill || !label) return;
    try {
      const b = await api.byokStatus();
      const prov = (b?.llm_provider || '').toString();
      const model = (b?.llm_model || '').toString();
      const anyReady = !!(b?.anthropic?.set || b?.openai?.set || b?.openrouter?.set ||
                          b?.groq?.set || b?.deepseek?.set || b?.mistral?.set ||
                          b?.google?.set || b?.nvidia?.set || b?.ollama_base_url);
      if (prov && anyReady) {
        pill.classList.remove('none');
        label.textContent = `${prov}${model ? ' · ' + model : ''}`;
        pill.title = `Active LLM — click to change`;
      } else if (anyReady) {
        pill.classList.add('none');
        label.textContent = 'No default set';
        pill.title = 'A provider key is saved but no default picked — click to choose';
      } else {
        pill.classList.add('none');
        label.textContent = 'No LLM';
        pill.title = 'No provider configured — click to add a key';
      }
    } catch {
      pill.classList.add('none');
      label.textContent = 'LLM ?';
    }
  }
  paintLlmPill();
  $('#topic-llm-pill')?.addEventListener('click', () => openByokModal(() => {
    paintLlmPill();
    invalidateTabCache(['map', 'evidence', 'chat', 'report', 'solutions', 'concepts', 'papers']);
    // If the currently-visible tab was gated on LLM (chat/evidence), refresh it.
    if (activeTab === 'chat' || activeTab === 'evidence' || activeTab === 'map') {
      loaders[activeTab]?.();
    }
  }));

  // Preload tab data in the background — populates the api.js cache so that
  // clicking Evidence / Sources / Chat paints instantly instead of waiting
  // on a cold Python process spawn. Fire-and-forget; errors are swallowed
  // (the tab-click path re-runs with proper UI feedback on failure).
  // Normalized source bucket — collapses youtube/youtube_description/
  // youtube_transcript into one "youtube" tile (and any future
  // family-with-subtypes the same way). Keeps the Sources tab readable
  // instead of fragmenting YouTube content across three tiles. Mirrors
  // ``sources/source_families.py::NORMALIZED_SOURCE_SQL`` on the
  // Python side — keep both in sync.
  const NORMALIZED_SOURCE = `CASE
    WHEN lower(coalesce(p.source_type,'')) LIKE 'youtube%' THEN 'youtube'
    WHEN p.source_type IS NULL OR p.source_type='' THEN 'reddit'
    ELSE lower(p.source_type)
  END`;
  const srcSql = `SELECT ${NORMALIZED_SOURCE} AS source, count(*) AS posts,
                         min(p.created_utc) AS earliest, max(p.created_utc) AS latest
                  FROM topic_posts tp JOIN posts p ON p.id=tp.post_id
                  WHERE tp.topic=:topic
                  GROUP BY ${NORMALIZED_SOURCE}
                  ORDER BY posts DESC`;
  const subsSql = `SELECT p.sub AS sub, count(*) AS posts
                   FROM topic_posts tp JOIN posts p ON p.id=tp.post_id
                   WHERE tp.topic=:topic
                     AND p.sub IS NOT NULL AND p.sub <> ''
                   GROUP BY p.sub ORDER BY posts DESC LIMIT 12`;
  // Evidence tab now uses a single combined SQL (was 4 separate getFindings
  // calls, i.e. 4 Python spawns). One spawn, four kinds, top-100 per kind.
  const combinedFindingsSql = `
        WITH enriched AS (
          SELECT n.kind, n.id, n.label, n.metadata_json,
                 (SELECT count(*) FROM graph_edges e
                  WHERE e.topic=n.topic AND (e.src=n.id OR e.dst=n.id)
                    AND e.kind IN ('evidenced_by','wished_in','built_in','solves','about_product'))
                 AS evidence_count
          FROM graph_nodes n
          WHERE n.topic=:topic
            AND n.kind IN ('painpoint','feature_wish','product','workaround')
        )
        SELECT kind, id, label, metadata_json, evidence_count
        FROM (
          SELECT *,
                 ROW_NUMBER() OVER (PARTITION BY kind ORDER BY evidence_count DESC, id) AS rn
          FROM enriched
        )
        WHERE rn <= 100
        ORDER BY kind, evidence_count DESC`;

  // First page of Posts — lets the Posts tab paint instantly on click.
  const postsPageSql = `
    SELECT p.id, p.sub, p.source_type, p.author, p.title,
           substr(p.selftext, 1, 280) AS excerpt,
           p.url, p.permalink, p.score, p.num_comments, p.created_utc
    FROM topic_posts tp JOIN posts p ON p.id = tp.post_id
    WHERE tp.topic = :topic
    ORDER BY p.score DESC
    LIMIT 50 OFFSET 0`;

  // Research papers — same IN-list the Research tab builds, hoisted so the
  // cache is warm by the time the user clicks.
  const researchSql = `
    SELECT p.id, p.title, p.url, p.permalink, p.author,
           p.score, p.num_comments, p.created_utc, p.sub,
           coalesce(p.source_type,'reddit') AS source,
           substr(coalesce(p.selftext,''),1,400) AS excerpt
    FROM posts p JOIN topic_posts tp ON tp.post_id = p.id
    WHERE tp.topic=:topic
      AND coalesce(p.source_type,'reddit') IN ('arxiv','openalex','pubmed','scholar','ingest')
    ORDER BY coalesce(p.score,0) DESC, p.created_utc DESC
    LIMIT 200`;

  // Fire all prefetches in parallel. `cachedInvoke` dedups + TTLs the
  // results, so each loader reads the warm cache instead of spawning a
  // cold Python process. Errors swallowed — loaders will re-fetch with UI
  // feedback on any real failure.
  Promise.all([
    api.runQuery(combinedFindingsSql, topic).catch(() => null),  // Evidence
    api.runQuery(srcSql, topic).catch(() => null),               // Sources (types)
    api.runQuery(subsSql, topic).catch(() => null),              // Sources (subreddits)
    api.runQuery(postsPageSql, topic).catch(() => null),         // Posts page 0
    api.runQuery(researchSql, topic).catch(() => null),          // Research papers
    api.byokStatus().catch(() => null),                          // LLM config
  ]).catch(() => {});

  // ─── Map ──────────────────────────────────────────────────────────────
  // Count semantic nodes (painpoints / features / workarounds / products)
  // in graph_nodes — shared by Map and Chat gates.
  async function countFindings() {
    // Pull from the unified topicStats() round-trip instead of spawning a
    // separate sidecar. Falls back to 0 if stats came back empty.
    const s = await topicStats();
    const total = (s.painpoints || 0) + (s.workarounds || 0)
                + (s.feature_wishes || 0) + (s.products || 0);
    return total;
  }
  // Delegates to the shared helper in lib/llmStatus.js so every tab agrees on
  // "is a provider configured" (local Ollama counts equally with cloud keys).
  const checkLlmReady = hasLlmConfigured;

  // Toolbar Enrich button. Migrated 2026-05-28 from the non-streaming
  // `api.enrichGraph` + confirm() dialog to the streaming path so the user
  // gets:
  //   1. Live progress (extractor names, sample painpoint titles) instead
  //      of a 2-6 minute silent spinner.
  //   2. Preempt-over-piggy-back when their click lands on top of an
  //      in-flight auto-enrich — see `runEnrichStreamForTopic`'s `manual`
  //      opt. The confirm() popup is gone; cancelling the auto pass and
  //      starting fresh is the new default behavior.
  // We mount the streaming banner under the toolbar so it has somewhere
  // to render progress even when `loadMap` didn't already create one
  // (e.g. re-clicking Enrich after findings already exist — the auto
  // path skipped the banner because `findingsBefore > 0`).
  async function runEnrichFromMap() {
    const btn = $('#btn-map-enrich');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2"></i> Enriching…'; window.refreshIcons?.(); }
    // Ensure a banner exists. If the auto-enrich path already mounted one
    // we reuse it; otherwise inject a fresh banner right above the iframe
    // so progress events have a target. Clears any previous error/done
    // styling so the new run reads as in-progress.
    let bannerEl = document.getElementById('map-enrich-banner');
    if (!bannerEl) {
      const toolbar = contentEl.querySelector('.map-toolbar');
      const iframe = contentEl.querySelector('iframe.viewer-frame');
      bannerEl = document.createElement('div');
      bannerEl.id = 'map-enrich-banner';
      bannerEl.className = 'map-enrich-banner info';
      bannerEl.innerHTML = `<div class="map-enrich-row">
        <span class="map-building-spinner" style="width:14px;height:14px;border-width:2px;flex-shrink:0"></span>
        <span id="map-enrich-status">Starting LLM extraction…</span>
      </div>
      <div id="map-enrich-samples" class="map-enrich-samples"></div>`;
      if (iframe?.parentNode) iframe.parentNode.insertBefore(bannerEl, iframe);
      else if (toolbar?.parentNode) toolbar.parentNode.insertBefore(bannerEl, toolbar.nextSibling);
    } else {
      bannerEl.className = 'map-enrich-banner info';
      bannerEl.innerHTML = `<div class="map-enrich-row">
        <span class="map-building-spinner" style="width:14px;height:14px;border-width:2px;flex-shrink:0"></span>
        <span id="map-enrich-status">Starting LLM extraction…</span>
      </div>
      <div id="map-enrich-samples" class="map-enrich-samples"></div>`;
    }
    try {
      await runEnrichStreamForTopic(topic, {
        // Toolbar click → preempt any background auto-enrich for this topic.
        // `fillMissingAfter:false` because the toolbar always runs all 4
        // categories already (no `only`), so there's nothing to fill in.
        manual: true,
        fillMissingAfter: false,
        onComplete: async (summary) => {
          if (summary?.ok === false) {
            recordEnrichResult(topic, summary, summary?.error || 'unknown');
          } else {
            recordEnrichResult(topic, summary || {}, null);
          }
          // Force a fresh rebuild — enrich just landed, the user clicked
          // the button specifically to see new findings. Without force=true
          // the in-session cache would short-circuit back to the pre-enrich
          // render.
          loadMap(true);
        },
      });
    } catch (err) {
      showToast('Enrichment issue', `Enrichment errored: ${err?.message || err}`, 'warn');
      recordEnrichResult(topic, null, err?.message || String(err));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="sparkles"></i> Enrich';
        window.refreshIcons?.();
      }
    }
  }

  // Same shape as runEnrichFromMap but reloads the caller instead of the Map.
  // Used by the Evidence/Report tabs when findings are empty AND the user has
  // an LLM key — so the button says "Run extraction now" (actionable) instead
  // of "Add LLM key" (misleading, key is already there). Builds the graph
  // first so it works even if the user never opened Map.
  async function runEnrichHere(btnSelector, onDone) {
    const btn = btnSelector ? $(btnSelector) : null;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2"></i> Extracting…'; window.refreshIcons?.(); }
    let errMsg = '';
    let added = 0;
    try {
      // buildGraph is idempotent — no-op when the graph already exists.
      await api.buildGraph(topic).catch(() => {});
      const e = await api.enrichGraph(topic);
      if (e?.skipped) {
        errMsg = `Extraction skipped: ${e.reason || 'no LLM configured'}`;
        recordEnrichResult(topic, e, null);
      } else if (e?.ok === false) {
        errMsg = `Extraction failed: ${e.error || 'unknown'}`;
        recordEnrichResult(topic, e, e.error || 'unknown');
      } else {
        recordEnrichResult(topic, e, null);
        const np = e?.painpoints_added     ?? e?.painpoints     ?? 0;
        const nf = e?.feature_wishes_added ?? e?.feature_wishes ?? 0;
        const nw = e?.workarounds_added    ?? e?.diy_workarounds ?? 0;
        added = np + nf + nw;
        if (added === 0) {
          const prov = e?.provider || 'LLM';
          errMsg = `${prov} ran over ${e?.corpus_size ?? '?'} posts but extracted 0 findings. Try a stronger model (e.g. Anthropic / OpenRouter / ollama qwen2.5:7b) or Re-run collect to gather more on-topic posts.`;
        }
      }
    } catch (err) {
      errMsg = `Extraction errored: ${err?.message || err}`;
      recordEnrichResult(topic, null, err?.message || String(err));
    }
    if (errMsg) showToast('Extraction issue', errMsg, 'warn');
    else if (added > 0) showToast('Extraction complete', `${added} new finding${added === 1 ? '' : 's'}`, 'ok');
    onDone?.();
  }

  // Sequentially enrich every topic that has ≥ MIN_POSTS in topic_posts but 0
  // findings. Lets a user unblock many topics in one click — the per-topic
  // Map/Evidence auto-enrich requires opening each topic individually. Runs in
  // sequence because the Python sidecar holds a write lock during enrich;
  // parallel calls just serialize at the lock and waste process spawn cost.
  async function runEnrichAllTopics(onProgress) {
    const MIN_POSTS = 50;
    let targets = [];
    try {
      // run_query binds NAMED params (HashMap<String,String>); inline the
      // numeric threshold since it's static. Filter: topics whose corpus ≥
      // MIN_POSTS and whose graph_nodes has zero semantic-finding rows.
      const rows = await api.runQuery(
        `SELECT tp.topic AS topic, count(*) AS posts,
                (SELECT count(*) FROM graph_nodes n
                  WHERE n.topic = tp.topic
                    AND n.kind IN ('painpoint','feature_wish','product','workaround')) AS findings
           FROM topic_posts tp
          GROUP BY tp.topic
         HAVING posts >= ${MIN_POSTS} AND findings = 0
          ORDER BY posts DESC`,
        null,
      );
      targets = Array.isArray(rows) ? rows.map(r => r.topic).filter(Boolean) : [];
    } catch (err) {
      showToast('Enrich-all failed', `Could not list topics: ${err?.message || err}`, 'err');
      return { ok: false, error: String(err?.message || err), targets: [], results: [] };
    }
    if (targets.length === 0) {
      showToast('Nothing to enrich', 'Every topic with ≥50 posts already has findings.', 'ok');
      return { ok: true, targets: [], results: [] };
    }
    showToast('Enriching all topics', `Starting ${targets.length} topics (sequential, ~20-90s each).`, 'ok', 3000);
    const results = [];
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      onProgress?.({ phase: 'start', index: i, total: targets.length, topic: t });
      try {
        await api.buildGraph(t).catch(() => {});
        const e = await api.enrichGraph(t);
        recordEnrichResult(t, e, e?.ok === false ? (e?.error || 'unknown') : null);
        const added = (e?.painpoints_added ?? 0) + (e?.feature_wishes_added ?? 0)
                    + (e?.workarounds_added ?? 0) + (e?.products_added ?? 0);
        results.push({ topic: t, added, error: e?.ok === false ? (e?.error || 'unknown') : null });
        onProgress?.({ phase: 'done', index: i, total: targets.length, topic: t, added, error: results[results.length-1].error });
      } catch (err) {
        const msg = err?.message || String(err);
        recordEnrichResult(t, null, msg);
        results.push({ topic: t, added: 0, error: msg });
        onProgress?.({ phase: 'done', index: i, total: targets.length, topic: t, added: 0, error: msg });
      }
    }
    const totalAdded = results.reduce((s, r) => s + (r.added || 0), 0);
    const successTopics = results.filter(r => (r.added || 0) > 0).length;
    showToast(
      'Enrich all complete',
      `${successTopics} of ${targets.length} topics produced findings · ${totalAdded} total extracted.`,
      successTopics > 0 ? 'ok' : 'warn',
      6000,
    );
    return { ok: true, targets, results, totalAdded, successTopics };
  }
  // Expose to main.js + console for cross-screen triggering.
  try { window.runEnrichAllTopics = runEnrichAllTopics; } catch {}

  // ── Map-view chat: render, send (streaming), wire ─────────────────────
  function _mapChatBotHtml(m) {
    const text = m.text || '';
    if (!text.trim() && _mapChatStream.active) {
      return '<span class="mapchat-typing"><i></i><i></i><i></i></span>';
    }
    // Split a trailing "Sources" / citations block off the answer so it can be
    // shown as a collapsible accordion (matches the approved prototype).
    const lines = text.split('\n');
    let cut = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*#{1,6}\s*sources\b/i.test(lines[i]) || /^\s*\*{0,2}sources\*{0,2}\s*:?\s*$/i.test(lines[i])) { cut = i; break; }
    }
    let bodyMd = text, srcMd = '';
    if (cut >= 0) { bodyMd = lines.slice(0, cut).join('\n'); srcMd = lines.slice(cut + 1).join('\n'); }
    let html = renderMarkdown(bodyMd) || '';
    if (srcMd.trim()) {
      const cardsHtml = _renderMapCitations(srcMd);
      const n = (cardsHtml.match(/class="cite-card"/g) || []).length;
      html += `<div class="cite-block">`
        + `<button type="button" class="cite-acc-head"><span>📎 ${n || ''} citations · click “Show in graph”</span><span class="acc-caret">▾</span></button>`
        + `<div class="cite-acc-body">${cardsHtml}</div></div>`;
    }
    return html;
  }
  // Parse the backend "Sources" markdown into clickable citation cards. Each
  // card keeps the external link AND a "Show in graph" action that highlights
  // the matching node + its relations in the map iframe (via postMessage).
  function _renderMapCitations(srcMd) {
    const rows = [];
    srcMd.split('\n').forEach(line => {
      const t = line.trim();
      if (!t || t === '---' || /^#{1,6}\s/.test(t)) return;
      let m = t.match(/^\[(\d+)\]\s*\*\*(.+?)\*\*\s*[—–-]+\s*\[(.+?)\]\((.+?)\)\s*$/);
      if (m) { rows.push({ n: m[1], prefix: m[2], title: m[3], url: m[4] }); return; }
      m = t.match(/^\[(\d+)\]\s*\*\*(.+?)\*\*\s*[—–-]+\s*(.+?)\s*$/);
      if (m) { rows.push({ n: m[1], prefix: m[2], title: m[3], url: '' }); return; }
      m = t.match(/\[(.+?)\]\((.+?)\)/);
      if (m) { rows.push({ n: '', prefix: '', title: m[1], url: m[2] }); return; }
    });
    if (!rows.length) return renderMarkdown(srcMd) || '';
    return rows.map(r => {
      const link = r.url ? `<a class="cc-link" href="${esc(r.url)}" target="_blank" rel="noopener" title="Open source">↗</a>` : '';
      const pre = r.prefix ? `<span class="cc-kind">${esc(r.prefix)}</span>` : '';
      const num = r.n ? `<span class="cc-n">${esc(r.n)}</span>` : '';
      return `<div class="cite-card" data-url="${esc(r.url)}" data-title="${esc(r.title)}">`
        + `<div class="cc-head">${num}${pre}<span class="cc-title">${esc(r.title)}</span></div>`
        + `<div class="cc-actions"><button type="button" class="cc-graph"><i data-lucide="target"></i> Show in graph</button>${link}</div>`
        + `</div>`;
    }).join('');
  }
  function _renderMapChatLog() {
    const log = document.getElementById('mapchat-log');
    if (!log) return;
    if (!_mapChatLog.length) {
      log.innerHTML = `<div class="mapchat-empty">Ask anything about <b>${esc(topic)}</b> — answers are grounded on this topic's data and cite their sources.</div>`;
      return;
    }
    log.innerHTML = _mapChatLog.map(m => m.role === 'user'
      ? `<div class="mapchat-msg user">${esc(m.text)}</div>`
      : `<div class="mapchat-msg bot">${_mapChatBotHtml(m)}</div>`).join('');
    log.scrollTop = log.scrollHeight;
    window.refreshIcons?.();
  }
  function _setMapChatBusy(busy, msg) {
    const s = document.getElementById('mapchat-status');
    const btn = document.getElementById('mapchat-send');
    if (btn) btn.disabled = busy;
    if (s) s.textContent = busy ? 'myind AI is thinking…' : (msg || '');
  }
  // Persist the map-chat thread into the SAME conversation store the Chat tab
  // reads, so map-view chats show up under the Chat section too. Mirrors the
  // thread into the shared chat state and makes it the active conversation.
  function _persistMapChat() {
    if (!_mapChatLog.length) return;
    if (!_mapChatConvId) _mapChatConvId = genConvId();
    const msgs = _mapChatLog.map(m => ({ role: m.role, text: m.text || '', mode: 'ask', ts: m.ts || Date.now() }));
    const firstUser = msgs.find(m => m.role === 'user' && (m.text || '').trim());
    let title = (firstUser ? firstUser.text : 'Map chat').trim().replace(/\s+/g, ' ');
    if (title.length > 48) title = title.slice(0, 47) + '…';
    try {
      chatHistory.set(topic, msgs.map(m => ({ ...m })));
      chatActiveConv.set(topic, _mapChatConvId);
      chatHydrated.add(topic);
      pendingNewConv.delete(topic);
      localStorage.setItem(CHAT_ACTIVE_KEY(topic), _mapChatConvId);
    } catch {}
    api.chatConvSave(_mapChatConvId, topic, title, JSON.stringify(msgs)).catch(() => {});
  }
  async function _mapChatSend() {
    const inp = document.getElementById('mapchat-input');
    const q = (inp?.value || '').trim();
    if (!q || _mapChatStream.active) return;
    inp.value = ''; inp.style.height = 'auto';
    _mapChatLog.push({ role: 'user', text: q, ts: Date.now() });
    const bot = { role: 'assistant', text: '', ts: Date.now() };
    _mapChatLog.push(bot);
    _renderMapChatLog();
    _setMapChatBusy(true);
    _mapChatStream.active = true;
    let done = false;
    const finish = (statusMsg) => {
      if (done) return; done = true;
      _mapChatStream.active = false;
      try { _mapChatStream.unsubP?.(); } catch {}
      try { _mapChatStream.unsubD?.(); } catch {}
      _mapChatStream.unsubP = _mapChatStream.unsubD = null;
      _setMapChatBusy(false, statusMsg);
      _renderMapChatLog();
      _persistMapChat();   // make this thread visible in the Chat tab
    };
    try {
      _mapChatStream.unsubP = await api.onChatProgress(line => {
        let ev; try { ev = JSON.parse(line); } catch { return; }
        if (ev.event === 'token' || ev.event === 'text') {
          if (typeof ev.text === 'string') { bot.text += ev.text; _renderMapChatLog(); }
        } else if (ev.event === 'error') {
          bot.text += `\n\n✗ Error: ${ev.error || 'unknown'}`;
          finish('Error — see message above.');
        }
      });
      _mapChatStream.unsubD = await api.onChatDone(payload => {
        const code = (payload && typeof payload === 'object' && 'code' in payload) ? Number(payload.code) : 0;
        if (code !== 0 && !bot.text.trim()) {
          bot.text = `✗ Provider exited with code ${code}. Check your LLM key/model in Settings.`;
        }
        finish(code === 0 ? '' : 'Provider exited early; partial response shown.');
      });
      await api.startChat(topic, q, 'ask', false);
    } catch (e) {
      bot.text = `✗ Failed to start chat: ${e?.message || e}`;
      finish('Failed to start. Check your LLM key/provider in Settings.');
    }
  }
  // Idempotent — uses .onclick (replaces, never stacks) so the shared
  // _wireMapToolbarButtons can call it on every map show (fresh + cached).
  function wireMapChat() {
    const drawer = document.getElementById('mapchat-drawer');
    if (!drawer) return;
    const pill = document.getElementById('btn-map-chat');
    // Non-modal sidebar: opening does NOT add a click-catching scrim, so the
    // graph stays fully interactive and clicking it never closes the chat.
    const open = () => { drawer.classList.add('open'); if (pill) pill.style.display = 'none'; document.getElementById('mapchat-input')?.focus(); };
    const close = () => { drawer.classList.remove('open'); if (pill) pill.style.display = ''; };
    if (pill) pill.onclick = open;
    // Top-toolbar "Ask this map" mirrors the floating pill — opens the same drawer.
    const topAsk = document.getElementById('btn-map-chat-top'); if (topAsk) topAsk.onclick = open;
    const x = document.getElementById('mapchat-close'); if (x) x.onclick = close;
    const sendBtn = document.getElementById('mapchat-send'); if (sendBtn) sendBtn.onclick = _mapChatSend;
    const inp = document.getElementById('mapchat-input');
    if (inp) {
      inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _mapChatSend(); } };
      inp.oninput = () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 120) + 'px'; };
    }
    const log = document.getElementById('mapchat-log');
    if (log) log.onclick = (e) => {
      // "Show in graph" → tell the map iframe to highlight this citation's node
      const g = e.target.closest && e.target.closest('.cc-graph');
      if (g) {
        e.preventDefault();
        const card = g.closest('.cite-card');
        const url = card ? card.getAttribute('data-url') : '';
        const title = card ? card.getAttribute('data-title') : '';
        const frame = document.querySelector('.mapchat-host iframe.viewer-frame');
        if (frame && frame.contentWindow) frame.contentWindow.postMessage({ type: 'gapmap:focus', url, title }, '*');
        return;
      }
      const h = e.target.closest && e.target.closest('.cite-acc-head'); if (!h) return;
      const body = h.parentElement.querySelector('.cite-acc-body');
      h.classList.toggle('collapsed'); body && body.classList.toggle('collapsed');
    };
    _renderMapChatLog();
  }

  // Shared button wiring. Called from BOTH the full-render path and the
  // cache-restore path so click handlers hang off whichever iframe /
  // toolbar is currently in the DOM. outPath comes from the cache or the
  // fresh export; mapMode / mapAutoUpdate from their respective getters.
  function _wireMapToolbarButtons(outPath, mapMode, mapAutoUpdate) {
    window.refreshIcons?.();
    wireMapChat();
    const modeBtn = $('#btn-map-mode');
    if (modeBtn) modeBtn.onclick = () => {
      const next = mapMode === 'full' ? 'skeleton' : 'full';
      localStorage.setItem(MAP_MODE_KEY, next);
      loadMap(true);
    };
    const autoBtn = $('#btn-map-auto');
    if (autoBtn) autoBtn.onclick = () => {
      const next = !mapAutoUpdate;
      localStorage.setItem(MAP_AUTO_UPDATE_KEY, next ? 'true' : 'false');
      showToast(
        'Map auto-update',
        next
          ? 'Enabled: map refreshes automatically when new data arrives.'
          : 'Disabled: new data will show a rebuild notice; refresh manually.',
        'ok', 2600,
      );
      loadMap(false);
    };
    const rebuildBtn = $('#btn-map-rebuild');
    if (rebuildBtn) rebuildBtn.onclick = () => loadMap(true);
    // Reveal button only exists when the `gapmap.flags.reveal` flag is on
    // (default off) — wiring no-ops when absent.
    const revealBtn = $('#btn-map-reveal');
    if (revealBtn && outPath) revealBtn.onclick = () => api.revealInFinder(outPath);
    const openExtBtn = $('#btn-map-open-ext');
    // open_url refuses non-web (file://) URLs by design, so reveal the exported
    // HTML in Finder instead of throwing "refused to open non-web URL".
    if (openExtBtn && outPath) openExtBtn.onclick = () => {
      Promise.resolve(api.revealInFinder(outPath)).catch((e) => showToast('Reveal failed', String(e?.message || e), 'err', 2600));
    };
    $('#btn-map-enrich')?.addEventListener('click', () => runEnrichFromMap());
    $('#btn-map-enrich-all')?.addEventListener('click', async () => {
      const btn = $('#btn-map-enrich-all');
      if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2"></i> Enriching all…'; window.refreshIcons?.(); }
      await runEnrichAllTopics(({ phase, index, total, topic: t, added }) => {
        if (phase === 'done' && btn) {
          btn.innerHTML = `<i data-lucide="loader-2"></i> ${index + 1}/${total} · +${added}`;
          window.refreshIcons?.();
        }
      });
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="layers"></i> Enrich all'; window.refreshIcons?.(); }
      loadMap(true);
    });
    $('#btn-map-add-key')?.addEventListener('click', () => openByokModal(() => loadMap()));
    $('#btn-map-rebuild-stale')?.addEventListener('click', () => loadMap(true));
  }

  async function loadMap(force = false) {
    if (mapLoadInFlight) {
      mapReloadQueued = true;
      mapReloadQueuedForce = mapReloadQueuedForce || !!force;
      return;
    }
    // ─── Export-version self-heal ─────────────────────────────────────────
    // If this topic's cached graph was generated by an older viewer, force a
    // one-time rebuild so the new features (left-panel minimize, citation
    // "Show in graph") appear without the user clicking Rebuild.
    if (!force) {
      let _ver = null;
      try { _ver = localStorage.getItem(MAP_EXPORT_VER_KEY); } catch {}
      if (_ver !== String(MAP_EXPORT_VERSION)) force = true;
    }
    // ─── Cache short-circuit ──────────────────────────────────────────────
    // If we have a rendered map in memory AND the caller didn't force, serve
    // it instantly without any sidecar work. The ONLY paths that invalidate:
    //   * force === true — Rebuild button, mode toggle, or an explicit
    //     loadMap(true) from downstream code (enrich completion, etc.)
    //   * dirtyTabs.has('map') AND isMapAutoUpdateEnabled() — new data
    //     landed AND user wants auto-refresh.
    // When dirty but auto-off: still serve cache, flip _mapRender.stale
    // true so the header shows a "data changed — click Rebuild" chip.
    //
    // Use `activeTab === 'map'` (the closure variable set by switchTab),
    // NOT `contentEl.dataset.tab === 'map'`. The dataset attribute is
    // never assigned, so the original check ALWAYS failed and forced a
    // full rebuild every visit — user saw "loading…" on every click even
    // when an in-memory render was available.
    if (!force && _mapRender && activeTab === 'map') {
      // Two dirty signals feed in:
      //   1. `dirtyTabs` — same-session writes (collect/enrich completed
      //      while the topic page was open).
      //   2. `_mapDirtyTopics` — cross-navigation writes (user collected on
      //      topic A, navigated to topic B, came back to A — A's map is
      //      stale even though dirtyTabs is fresh).
      // Either one trips dirty.
      const dirty = dirtyTabs.has('map') || _mapDirtyTopics.has(topic);
      // ALWAYS serve cache when one exists. The previous logic forced a
      // full rebuild whenever `dirty && autoUpdate` — and autoUpdate
      // defaults to true, so any background enrich / collect / ingest /
      // findings event made the next Map visit show a loading screen
      // EVEN THOUGH a perfectly good cached render was already in memory.
      // User reported: "graph is built, why does the tab keep loading?".
      // Now we serve the cache instantly, flip `.stale = true` so the
      // toolbar shows a "data changed — click Rebuild" chip, and let
      // the user trigger the refresh explicitly via the Rebuild button.
      // (The button calls loadMap(true) which bypasses this short-circuit.)
      if (dirty) _mapRender.stale = true;
      contentEl.innerHTML = _mapRender.html;
      // Inject / swap the stale chip if needed without redoing the whole
      // toolbar, so we don't lose the iframe's scroll+layout state.
      if (_mapRender.stale) {
        const toolbar = contentEl.querySelector('.map-toolbar-info');
        if (toolbar && !toolbar.querySelector('[data-stale-chip]')) {
          const chip = document.createElement('span');
          chip.className = 'th-chip';
          chip.dataset.staleChip = '1';
          chip.style.color = 'var(--warn, #d97706)';
          chip.title = 'New data has landed since this map was built. Click Rebuild to refresh.';
          chip.innerHTML = '⚠ stale';
          toolbar.appendChild(chip);
        }
      }
      _wireMapToolbarButtons(_mapRender.outPath, _mapRender.mapMode, isMapAutoUpdateEnabled());
      return;
    }
    mapLoadInFlight = true;
    // Clear the in-session cache at the start of a real rebuild so a mid-
    // rebuild tab switch doesn't serve a stale snapshot on re-entry.
    _mapRender = null;
    // Clear any stashed DOM holder (we manage our own iframe cache above).
    invalidateTabCache('map');
    // Gated write — drop any innerHTML write that would land after the user
    // already clicked away to another tab. Keeps loadMap's slow post-await
    // graph-build render from overwriting, say, loadReport's skeleton.
    // Uses `activeTab` (the closure variable updated by switchTab) — the
    // DOM dataset attribute was never set so the original check let every
    // write land regardless of the active tab.
    const set = (html) => { if (activeTab === 'map') contentEl.innerHTML = html; };
    const mapMode = (localStorage.getItem(MAP_MODE_KEY) || 'skeleton').toLowerCase() === 'full'
      ? 'full'
      : 'skeleton';
    const mapAutoUpdate = isMapAutoUpdateEnabled();
    // Graph stats strip — fetched before render, shown above the map when graph has nodes.
    let statsStripHtml = '';
    let sourceEvidenceEdgeCount = 0;
    let topicSourceTypeCount = 0;
    try {
      // Edge count comes from the unified topicStats round-trip; only the
      // per-kind breakdown needs its own sidecar spawn since topicStats
      // only carries the four main finding kinds.
      const [nodeRows, stats, relRows, srcRows] = await Promise.all([
        withTimeout(api.runQuery(
          "SELECT kind, count(*) AS n FROM graph_nodes WHERE topic = :topic AND kind NOT IN ('topic','post') GROUP BY kind ORDER BY n DESC",
          topic,
        ), TOPIC_QUERY_TIMEOUT_MS, 'map graph stats'),
        topicStats(),
        withTimeout(api.runQuery(
          "SELECT kind, count(*) AS n FROM graph_edges WHERE topic = :topic AND kind IN ('source_evidence','relates_to','potentially_solves','could_address','co_evidenced') GROUP BY kind",
          topic,
        ), TOPIC_QUERY_TIMEOUT_MS, 'map relation stats'),
        // Per-source contribution to this topic — fuels the "📡 N sources"
        // chip so users can see at a glance that the graph is multi-source,
        // not just reddit. Tooltip lists source → post count breakdown.
        withTimeout(api.runQuery(
          "SELECT coalesce(p.source_type,'reddit') AS source, count(*) AS posts FROM topic_posts tp JOIN posts p ON p.id=tp.post_id WHERE tp.topic=:topic GROUP BY coalesce(p.source_type,'reddit') ORDER BY posts DESC",
          topic,
        ), TOPIC_QUERY_TIMEOUT_MS, 'map source breakdown'),
      ]);
      const nodes = Array.isArray(nodeRows) ? nodeRows : [];
      const edgeCount = Number(stats.n_edges || 0);
      topicSourceTypeCount = Number(stats.sources || 0);
      const rel = Array.isArray(relRows) ? relRows : [];
      const relCount = (k) => Number((rel.find(r => r.kind === k) || {}).n || 0);
      sourceEvidenceEdgeCount = relCount('source_evidence');
      const relatesTo = relCount('relates_to');
      const potentiallySolves = relCount('potentially_solves');
      const couldAddress = relCount('could_address');
      const coEvidenced = relCount('co_evidenced');
      const denseRelTotal = relatesTo + potentiallySolves + couldAddress + coEvidenced;
      if (nodes.length > 0) {
        const labelMap = {
          painpoint: 'painpoints',
          feature_wish: 'feature wishes',
          workaround: 'workarounds',
          product: 'products',
          mechanism: 'mechanisms',
          intervention: 'interventions',
          evidence_paper: 'papers',
        };
        const chips = nodes.map(r => {
          const label = labelMap[r.kind] || r.kind;
          return `<span class="graph-stat-chip"><b>${r.n}</b> ${esc(label)}</span>`;
        }).join('');
        // Dense relation chip(s) — shown only when the relations pass produced edges.
        // Tooltip enumerates per-kind counts so users can see the 4 kinds.
        let relChipHtml = '';
        if (denseRelTotal > 0) {
          const parts = [];
          if (relatesTo) parts.push(`${relatesTo} relates_to`);
          if (potentiallySolves) parts.push(`${potentiallySolves} potentially_solves`);
          if (couldAddress) parts.push(`${couldAddress} could_address`);
          if (coEvidenced) parts.push(`${coEvidenced} co_evidenced`);
          const tip = `Cross-finding semantic relations (ChromaDB MiniLM + shared-evidence):\n· ${parts.join('\n· ')}`;
          relChipHtml = `<span class="graph-stat-chip graph-stat-relations" title="${esc(tip)}">🔗 <b>${denseRelTotal}</b> relations</span>`;
        } else {
          // Zero-state hint: if chromadb isn't installed the relations pass silently skips.
          relChipHtml = `<span class="graph-stat-chip graph-stat-relations-empty" title="No semantic relation edges. If you expected them, run 'Rebuild' or check that chromadb is installed on the Python sidecar.">0 relations</span>`;
        }
        // Source-coverage chip — count of distinct sources feeding this topic,
        // with a tooltip enumerating src → post count. Gives the user instant
        // confidence the graph is drawing on all configured sources, not just
        // reddit. If a source with an API key didn't contribute, it won't
        // appear here → the user knows something went wrong upstream.
        let srcChipHtml = '';
        const srcList = Array.isArray(srcRows) ? srcRows : [];
        if (srcList.length > 0) {
          const sourceLabel = {
            hn: 'Hacker News', appstore: 'App Store', playstore: 'Play Store',
            arxiv: 'arXiv', openalex: 'OpenAlex', pubmed: 'PubMed',
            gnews: 'Google News', devto: 'Dev.to', stackoverflow: 'Stack Overflow',
            github: 'GitHub', github_issues: 'GitHub Issues',
            trends: 'Google Trends', scholar: 'Scholar',
            lemmy: 'Lemmy', mastodon: 'Mastodon', youtube: 'YouTube',
            trustpilot: 'Trustpilot', producthunt: 'Product Hunt',
            alternativeto: 'AlternativeTo', reddit: 'Reddit',
          };
          const tipLines = srcList.map(r =>
            `${sourceLabel[r.source] || r.source}: ${r.posts} post${r.posts === 1 ? '' : 's'}`
          );
          const tip = `Evidence fed into this graph from ${srcList.length} source${srcList.length === 1 ? '' : 's'}:\n· ${tipLines.join('\n· ')}`;
          srcChipHtml = `<span class="graph-stat-chip graph-stat-sources" title="${esc(tip)}">📡 <b>${srcList.length}</b> sources</span>`;
        }
        statsStripHtml = `<div class="graph-stats-strip">${chips}${srcChipHtml}${relChipHtml}<span class="graph-stat-edges">· <b>${edgeCount}</b> edges</span></div>`;
      }
    } catch (e) {
      // Don't block the map render if stats fail.
      console.warn('graph-stats query failed:', e);
    }

    set(`
      <div class="map-building">
        <div class="map-building-spinner"></div>
        <div>
          <b id="map-stage">Building gap map…</b>
          <p id="map-detail">Running graph build on the corpus.</p>
        </div>
      </div>`);
    if (contentEl.dataset.tab !== 'map') return;
    const sub = $('#topic-sub');
    if (sub) sub.textContent = 'Building gap map…';
    let outPath = null;
    let enrichBanner = '';
    let forceExport = !!force;
    try {
      // Fast path — if the graph already exists for this topic, skip
      // buildGraph + enrich + exportHtml. Rebuild button forces a fresh
      // pass. Shaves 3 sidecar spawns (~1-3 s warm, 6+ s cold) off every
      // repeat Map-tab open.
      const preStats = await topicStats();
      const graphAlreadyBuilt =
        Number(preStats.n_nodes || 0) > 0 && Number(preStats.n_edges || 0) > 0;
      if (!graphAlreadyBuilt) {
        // 1. Structural graph — surface errors, don't swallow.
        $('#map-stage').textContent = 'Building structural graph…';
        if (sub) sub.textContent = 'Building structural graph…';
        await api.buildGraph(topic);
        _topicStatsPromise = null;  // invalidate — graph just changed
        forceExport = true;
      }

      // Always run a fast relation pass before export so older topics that
      // predate dense edges get proper finding-to-finding/source linkage.
      // Idempotent in DB (edge upsert), so safe on repeated Map opens.
      try {
        await withTimeout(api.relateGraph(topic), TOPIC_QUERY_TIMEOUT_MS, 'map relate graph');
        _topicStatsPromise = null;
        forceExport = true;
      } catch (relErr) {
        // Best-effort: relation pass can skip when embeddings aren't installed.
        console.warn('graph relation pass skipped/failed:', relErr);
      }

      // 2. Auto-enrich if we have an LLM key and no findings yet.
      //    Runs IN BACKGROUND — the map renders immediately with structural
      //    data, and the iframe reloads if enrich adds painpoints. Previously
      //    this `await`ed enrich inline, so a slow/stuck Ollama (first-load
      //    cold start, model pinned at 100% CPU on a prior request, etc.)
      //    would block the map tab from ever rendering at all.
      const [findingsBefore, anyReady] = await Promise.all([countFindings(), checkLlmReady()]);
      if (findingsBefore === 0 && anyReady) {
        // Progressive streaming banner. The old path awaited the full 4-LLM-call
        // `enrichGraph` — on Ollama that's 2-6 minutes of dead silence. Now we
        // subscribe to `enrich:progress` NDJSON events and update the banner
        // as each extractor finishes, so the user sees painpoint titles while
        // features/workarounds are still running.
        enrichBanner = `<div class="map-enrich-banner info" id="map-enrich-banner" data-stream="1">
          <div class="map-enrich-row">
            <span class="map-building-spinner" style="width:14px;height:14px;border-width:2px;flex-shrink:0"></span>
            <span id="map-enrich-status">Starting LLM extraction…</span>
          </div>
          <div id="map-enrich-samples" class="map-enrich-samples"></div>
          <div class="map-enrich-actions">
            <label class="map-enrich-picker">Extract:
              <select id="map-enrich-source" class="btn btn-ghost btn-sm btn-bordered">
                <option value="">All categories (sequential)</option>
                <option value="painpoints">Painpoints only (fastest)</option>
                <option value="features">Feature wishes only</option>
                <option value="workarounds">Workarounds only</option>
                <option value="complaints">Product complaints only</option>
                <option value="__parallel">All categories (parallel — cloud)</option>
              </select>
            </label>
            <button class="btn btn-ghost btn-sm btn-bordered" id="banner-rerun-enrich" type="button">Run</button>
          </div>
        </div>`;
        // Fire-and-forget stream. `enrich:progress` lines update the banner;
        // `enrich:stream:done` triggers the map reload. The listeners
        // auto-unbind on stream completion so we don't leak handlers across
        // repeated Map-tab opens.
        (async () => {
          try {
            await runEnrichStreamForTopic(topic, {
              onComplete: async () => {
                _topicStatsPromise = null;
                // Post-stream, rebuild the relation pass + map export so the
                // iframe picks up the new semantic nodes. Skipped when the
                // user navigates away from the Map tab mid-stream.
                if (contentEl.dataset.tab !== 'map') return;
                try {
                  await api.relateGraph(topic);
                } catch (relErr) { console.warn('post-enrich relate skipped:', relErr); }
                try {
                  const newPath = await api.exportHtml(topic, {
                    force: true, mode: mapMode, maxPostNodes: 120,
                  });
                  const iframe = contentEl.querySelector('iframe.viewer-frame');
                  if (iframe && contentEl.dataset.tab === 'map') {
                    iframe.src = convertFileSrc(newPath) + `?t=${Date.now()}`;
                  }
                } catch {}
              },
            });
          } catch (err) {
            const banner = document.getElementById('map-enrich-banner');
            if (banner) {
              banner.className = 'map-enrich-banner err';
              banner.innerHTML = `✗ Enrichment errored — ${esc(err?.message || err)}`;
            }
          }
        })();
      } else if (findingsBefore === 0 && !anyReady) {
        enrichBanner = `<div class="map-enrich-banner warn">
          ⚠ No LLM key — painpoints and feature wishes won't appear on the map.
          <button class="btn btn-primary map-banner-btn" id="btn-map-add-key">Add key</button>
        </div>`;
      }

      // 3. Export viewer.
      const s2 = $('#map-stage'); if (s2) s2.textContent = 'Exporting viewer…';
      if (sub) sub.textContent = 'Exporting viewer…';
      // Reuse the existing exported HTML if it's still on disk (skips a
      // sidecar spawn). Rebuild button passes force=true to regenerate.
      // 60s timeout — if the sidecar hangs (DB lock, Python import crash,
      // Gatekeeper pause), surface an actionable error card instead of a
      // forever "Exporting viewer…" spinner. The Promise.race throws a
      // tagged Error that the catch block below turns into a retry UI.
      outPath = await Promise.race([
        withTimeout(api.exportHtml(topic, {
          force: forceExport,
          mode: mapMode,
          maxPostNodes: 120,
        }), 60000, 'map export'),
        new Promise((_, reject) => setTimeout(
          () => reject(Object.assign(new Error('Exporting the viewer timed out after 60s. Python sidecar is stuck — usually a DB lock from a still-running enrich.'), { __timeout: true })),
          60000
        )),
      ]);
      const fileUrl = convertFileSrc(outPath);

      // Node + edge counts come from the unified topicStats() call — no
      // extra sidecar spawn needed. Invalidate first since enrichment may
      // have just added rows.
      _topicStatsPromise = null;
      const postStats = await topicStats();
      const nodeCount = Number(postStats.n_nodes || 0);
      const edgeCount = Number(postStats.n_edges || 0);

      const updatedAgo = timeAgo(Date.now());
      $('#topic-sub').textContent =
        `${nodeCount.toLocaleString()} nodes · ${edgeCount.toLocaleString()} edges · updated ${updatedAgo}`;

      const findingsAfter = await countFindings();
      const findingsChip = findingsAfter > 0
        ? `<span class="th-chip"><b>${findingsAfter}</b> findings</span>`
        : `<span class="th-chip" style="color:var(--ink-3)">0 findings</span>`;
      const relationHealthChip = `<span class="th-chip" title="Finding-to-source relationship edges used for cross-source conclusions"><b>${sourceEvidenceEdgeCount}</b> source-links</span>`;

      // If findings exist AND we have data from multiple sources AND no
      // finding->source edges have been built yet, surface a direct
      // explanation. Gated on findings > 0 because saying "connect findings
      // across sources" when there are 0 findings is nonsensical — that
      // case is already covered by the auto-enrich banner below. Reading
      // `findingsAfter` so the banner reflects post-enrich state on a
      // re-render, with fallback to pre-enrich count.
      const findingsForRelate = (typeof findingsAfter === 'number' ? findingsAfter : findingsBefore) || 0;
      const relationBanner = (findingsForRelate > 0 && topicSourceTypeCount > 1 && sourceEvidenceEdgeCount === 0)
        ? `<div class="map-enrich-banner warn">
            ⚠ Multi-source data found (<b>${topicSourceTypeCount}</b> sources) but cross-source finding links are not built yet.
            Run <b>Enrich</b> then <b>Rebuild</b> to connect findings across sources.
          </div>`
        : '';

      // NEUTRALIZED 2026-04-20 — diffFindings added a sidecar spawn on
      // every Map-tab open; suspected of stacking onto an already-busy
      // pipeline and contributing to app-wide hang. Re-enable once the
      // root cause is found. Until then the banner is empty and the Map
      // tab renders without waiting on this call.
      const diffBanner = '';

      if (contentEl.dataset.tab !== 'map') return;
      set(`
        ${statsStripHtml}
        ${diffBanner}
        ${relationBanner}
        <div class="map-toolbar">
          <div class="map-toolbar-info">
            <span class="th-chip"><b>${nodeCount.toLocaleString()}</b> nodes</span>
            <span class="th-chip"><b>${edgeCount.toLocaleString()}</b> edges</span>
            ${findingsChip}
            ${relationHealthChip}
            <span class="th-chip" title="skeleton is faster; full shows every node and relationship">mode: <b>${mapMode}</b></span>
            <span class="th-chip" title="When off, map stays cached until you click Rebuild">auto-update: <b>${mapAutoUpdate ? 'on' : 'off'}</b></span>
          </div>
          <!-- Right-side action group. Wrapping keeps buttons together
               when narrowing reflows them onto a new row (instead of
               breaking text char-by-char). margin-left:auto right-
               aligns when there is horizontal room AND lets the whole
               group drop to its own line predictably on small widths.
               Replaces a former flex:1 spacer div that produced a
               zero-width shim and confused the wrap. See the
               .map-toolbar rule in style.css. -->
          <div class="map-toolbar-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-left:auto;align-items:center">
            <button class="btn btn-primary btn-sm icon-btn" id="btn-map-chat-top" title="Ask myind AI about this map — grounded on this topic's data"><i data-lucide="message-circle"></i> Ask this map</button>
            ${anyReady ? `<button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-map-enrich" title="Re-run LLM extraction for this topic"><i data-lucide="sparkles"></i> Enrich</button>` : ''}
            ${anyReady ? `<button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-map-enrich-all" title="Enrich every topic with ≥50 posts and 0 findings"><i data-lucide="layers"></i> Enrich all</button>` : ''}
            <button class="btn btn-ghost btn-sm btn-bordered" id="btn-map-mode" title="Toggle graph density (skeleton/full)">Mode: ${mapMode === 'full' ? 'Full' : 'Skeleton'}</button>
            <button class="btn btn-ghost btn-sm btn-bordered" id="btn-map-auto" title="Toggle automatic incremental map refresh">Auto: ${mapAutoUpdate ? 'On' : 'Off'}</button>
            <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-map-rebuild"><i data-lucide="rotate-cw"></i> Rebuild</button>
            ${localStorage.getItem('gapmap.flags.reveal') === 'true' ? `<button class="btn btn-ghost btn-sm btn-bordered" id="btn-map-reveal">Reveal</button>` : ''}
            ${localStorage.getItem('gapmap.flags.openExt') === 'true' ? `<button class="btn btn-ghost btn-sm btn-bordered" id="btn-map-open-ext">Reveal HTML</button>` : ''}
          </div>
        </div>
        ${enrichBanner}
        <div class="mapchat-host">
          <iframe class="viewer-frame" src="${fileUrl}?t=${Date.now()}" sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"></iframe>
          <!-- floating bottom-center summon pill (matches v2-focus-canvas prototype) -->
          <button class="mapchat-pill" id="btn-map-chat" title="Ask myind AI about this map — grounded on this topic's data"><i data-lucide="message-circle"></i> Ask this map</button>
          <div class="mapchat-scrim" id="mapchat-scrim"></div>
          <aside class="mapchat-drawer" id="mapchat-drawer">
            <div class="mapchat-head"><b><i data-lucide="message-circle"></i> Ask this map</b>
              <button class="mapchat-x" id="mapchat-close" title="Close">&times;</button></div>
            <div class="mapchat-log" id="mapchat-log"></div>
            <div class="mapchat-status" id="mapchat-status"></div>
            <div class="mapchat-composer">
              <textarea id="mapchat-input" rows="1" placeholder="Ask about this topic…"></textarea>
              <button class="mapchat-send" id="mapchat-send" title="Send"><i data-lucide="arrow-up"></i></button>
            </div>
          </aside>
        </div>`);
      if (contentEl.dataset.tab !== 'map') return;
      // Populate the in-session Map cache — next Map-tab open (on this
      // topic, in this session) short-circuits here without any sidecar
      // calls. Cleared on: force rebuild, auto-update dirty revisit, or
      // topic-page unmount (scope is the outer renderTopic closure).
      _mapRender = {
        html: contentEl.innerHTML,
        outPath,
        mapMode,
        ts: Date.now(),
        stale: false,
        statsKey: `${nodeCount}:${edgeCount}`,
      };
      // Persist to BOTH the in-memory cache (same-session re-entry)
      // AND localStorage (survives app restart). Without the LS leg,
      // every cold app launch sees "Building gap map…" on first Map
      // open even though the topic's data hasn't moved an inch.
      _mapRenderCache.set(topic, _mapRender);
      _writeMapRenderToLS(topic, _mapRender);
      // Stamp the viewer version so the self-heal force-rebuild only fires once.
      try { localStorage.setItem(MAP_EXPORT_VER_KEY, String(MAP_EXPORT_VERSION)); } catch {}
      // Any dirty flag that landed during the rebuild is now resolved.
      dirtyTabs.delete('map');
      _mapDirtyTopics.delete(topic);
      _wireMapToolbarButtons(outPath, mapMode, mapAutoUpdate);
      // Wire the streaming-banner Run button (source selector). The banner
      // only exists when the auto-enrich path created it — otherwise these
      // lookups no-op. The button re-kicks a streaming enrich with whatever
      // category the user picked from the dropdown.
      const runBtn = document.getElementById('banner-rerun-enrich');
      const picker = document.getElementById('map-enrich-source');
      if (runBtn && picker) {
        runBtn.addEventListener('click', async () => {
          const sel = picker.value || '';
          const parallel = sel === '__parallel';
          const only = parallel ? null : (sel || null);
          const banner = document.getElementById('map-enrich-banner');
          if (banner) {
            banner.className = 'map-enrich-banner info';
            banner.innerHTML = `<div class="map-enrich-row">
              <span class="map-building-spinner" style="width:14px;height:14px;border-width:2px;flex-shrink:0"></span>
              <span id="map-enrich-status">Starting…</span>
            </div>
            <div id="map-enrich-samples" class="map-enrich-samples"></div>`;
          }
          await runEnrichStreamForTopic(topic, {
            only, parallel,
            // User clicked Run in the banner picker — preempt any background
            // auto-enrich for this topic. `fillMissingAfter` only kicks in
            // when `only` is set (single category), so picking "All
            // categories" is a no-op for the follow-up logic.
            manual: true,
            fillMissingAfter: true,
            onComplete: async () => {
              _topicStatsPromise = null;
              try { await api.relateGraph(topic); } catch {}
              try {
                const newPath = await api.exportHtml(topic, {
                  force: true, mode: mapMode, maxPostNodes: 120,
                });
                const iframe = contentEl.querySelector('iframe.viewer-frame');
                if (iframe && contentEl.dataset.tab === 'map') {
                  iframe.src = convertFileSrc(newPath) + `?t=${Date.now()}`;
                }
              } catch {}
            },
          });
        });
      }
    } catch (e) {
      const msg = (e?.message || e || '').toString();
      const hasNoPosts = msg.includes('no posts') || msg.includes('0 nodes');
      const isTimeout = !!e?.__timeout;
      // Timeout gets its own copy + a "Skip to findings" escape hatch so
      // users aren't stuck staring at the Map tab when the graph export is
      // wedged on DB lock or an Ollama pileup.
      const title = isTimeout
        ? 'Map export is stuck'
        : (hasNoPosts ? 'No data for this topic yet' : "Couldn't render the gap map");
      const extraBtn = isTimeout
        ? `<button class="btn btn-ghost btn-bordered" id="btn-map-skip-findings"><i data-lucide="search"></i> Skip to findings</button>`
        : '';
      set(`
        <div class="empty-big">
          <h3>${title}</h3>
          <p>${esc(msg)}</p>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap">
            <button class="btn btn-primary" id="btn-map-run-collect">Run collect</button>
            <button class="btn btn-ghost icon-btn" id="btn-map-retry" style="border:1px solid var(--line)"><i data-lucide="rotate-cw"></i> Retry</button>
            ${extraBtn}
          </div>
        </div>`);
      if (contentEl.dataset.tab !== 'map') return;
      window.refreshIcons?.();
      $('#btn-map-run-collect').onclick = () => { location.hash = `#/collect/${encodeURIComponent(topic)}`; };
      $('#btn-map-retry').onclick = () => loadMap();
      $('#btn-map-skip-findings')?.addEventListener('click', () => switchTab('evidence'));
    } finally {
      mapLoadInFlight = false;
      if (mapReloadQueued && contentEl.dataset.tab === 'map') {
        const nextForce = mapReloadQueuedForce;
        mapReloadQueued = false;
        mapReloadQueuedForce = false;
        queueMicrotask(() => loadMap(nextForce));
      }
    }
  }

  // ─── Report ───────────────────────────────────────────────────────────
  function showPaperResultModal(title, content) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.hidden = false;
    backdrop.innerHTML = `
      <div class="modal" style="max-width:920px;max-height:85vh;overflow:auto">
        <h3 style="margin-top:0">${esc(title)}</h3>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:10px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="paper-modal-copy"><i data-lucide="copy"></i> Copy</button>
          <button class="btn btn-ghost btn-sm btn-bordered" id="paper-modal-close">Close</button>
        </div>
        <div class="markdown-view">${renderMarkdown(content || '')}</div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector('#paper-modal-close')?.addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#paper-modal-copy')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(content || ''); } catch {}
    });
    window.refreshIcons?.();
  }

  async function runPaperPipelineAction(actionBtn, actionKind) {
    const prevHtml = actionBtn.innerHTML;
    actionBtn.disabled = true;
    actionBtn.innerHTML = '<i data-lucide="loader"></i> Running…';
    window.refreshIcons?.();
    try {
      if (actionKind === 'outline') {
        const out = await api.paperOutlineGenerate(topic);
        const outline = out?.outline || {};
        const md = [
          `# ${outline.title || `Research outline — ${topic}`}`,
          '',
          '## Sections',
          ...((outline.sections || []).map((s, i) => `${i + 1}. **${s.heading || s.id || 'Section'}** — ${s.notes || ''}`)),
          '',
          '## Key Findings',
          ...((outline.key_findings || []).map((f, i) =>
            `${i + 1}. ${f.title || '(untitled)'} · score: ${f.opportunity_score ?? '—'} · triangulation: ${f.triangulation_strength || '—'}`)),
        ].join('\n');
        showPaperResultModal('Paper Outline', md);
      } else if (actionKind === 'draft') {
        const out = await api.paperDraftGenerate(topic, null, 'IMRaD');
        showPaperResultModal('Paper Draft (IMRaD)', out?.markdown || '');
      } else if (actionKind === 'experiments') {
        const out = await api.experimentPlanGenerate(topic);
        const rows = Array.isArray(out?.experiments) ? out.experiments : [];
        const md = [
          `# Experiment Plan — ${topic}`,
          '',
          ...rows.map((e, i) => [
            `## ${i + 1}. ${e.hypothesis || '(untitled)'}`,
            `- Test: ${e.test_design || ''}`,
            `- Success metric: ${e.success_metric || ''}`,
            `- Failure criteria: ${Array.isArray(e.failure_criteria) ? e.failure_criteria.join('; ') : ''}`,
            `- Time box: ${e.time_box_days ?? '—'} days`,
            `- Budget: $${e.budget_usd ?? '—'}`,
            '',
          ].join('\n')).join('\n'),
        ].join('\n');
        showPaperResultModal('Experiment Plan', md);
      } else if (actionKind === 'export') {
        const out = await api.paperExportWithCitations(topic, null, 'markdown', 'IMRaD');
        showPaperResultModal('Paper Export with Citations', out?.content || '');
      }
    } catch (e) {
      const toast = document.createElement('div');
      toast.className = 'toast toast-error';
      toast.textContent = `Paper action failed: ${e?.message || String(e)}`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 4200);
    } finally {
      actionBtn.disabled = false;
      actionBtn.innerHTML = prevHtml;
      window.refreshIcons?.();
    }
  }

  async function loadReport() {
    // Gated write — see note in loadMap.
    const set = (html) => { if (contentEl.dataset.tab === 'report') contentEl.innerHTML = html; };
    set(`
      <div class="skeleton-card">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line med"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
      </div>
      ${skeletonCards(2)}`);
    try {
      const path = await api.exportReportPro(topic);
      if (contentEl.dataset.tab !== 'report') return;
      $('#topic-sub').textContent = path;
      const fileUrl = convertFileSrc(path);
      const resp = await fetch(fileUrl);
      const md = await resp.text();
      if (contentEl.dataset.tab !== 'report') return;

      // Build a quick TOC from h2/h3 headings so long reports stay navigable.
      // Slug each heading and inject matching ids into the rendered HTML.
      const headings = [];
      const lines = md.split('\n');
      const inFence = (() => { let f = false; return (l) => { if (/^```/.test(l)) f = !f; return f; }; })();
      for (const ln of lines) {
        if (inFence(ln)) continue;
        const m = /^(#{2,3})\s+(.+?)\s*$/.exec(ln);
        if (m) {
          const depth = m[1].length;
          const text = m[2].replace(/[*`]/g, '').trim();
          const slug = text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80);
          headings.push({ depth, text, slug });
        }
      }
      // Inject ids on the rendered headings. renderMarkdown emits plain
      // <h2>/<h3> without ids, AND inlineMd may turn the text into
      // `<h2><strong>Risk</strong> Analysis</h2>`. The previous regex
      // (`[^<]*?`) couldn't match across those inner tags — TOC anchors
      // jumped nowhere. Walk all h2/h3 in order and pair them positionally
      // with the parsed `headings` list (built in source order above).
      let renderedMd = renderMarkdown(md);
      let hIdx = 0;
      renderedMd = renderedMd.replace(/<(h[23])>([\s\S]*?)<\/\1>/g, (full, tag, inner) => {
        const h = headings[hIdx++];
        if (!h || `h${h.depth}` !== tag) return full;
        return `<${tag} id="${h.slug}">${inner}</${tag}>`;
      });
      const tocHtml = headings.length >= 3 ? `
        <nav class="report-toc" aria-label="Table of contents">
          <div class="report-toc-title">Contents</div>
          <ul>
            ${headings.map(h =>
              `<li class="toc-depth-${h.depth}"><a href="#${esc(h.slug)}">${esc(h.text)}</a></li>`
            ).join('')}
          </ul>
        </nav>` : '';

      const sizeKb = (md.length / 1024).toFixed(1);
      const wordCount = (md.match(/\S+/g) || []).length;
      const fileName = path.split('/').pop() || 'report.md';

      set(`
        <div class="report-page">
          <div class="report-toolbar" role="toolbar" aria-label="Report actions">
            <div class="report-info">
              <span title="${esc(path)}">📄 <b>${esc(fileName)}</b></span>
              <span>·</span>
              <span><b>${wordCount.toLocaleString()}</b> words</span>
              <span>·</span>
              <span><b>${sizeKb}</b> KB</span>
            </div>
            <button class="btn btn-ghost btn-sm icon-btn" id="btn-copy-md">
              <i data-lucide="copy"></i> Copy
            </button>
            <button class="btn btn-ghost btn-sm icon-btn" id="btn-download-md">
              <i data-lucide="download"></i> Download
            </button>
            ${localStorage.getItem('gapmap.flags.reveal') === 'true' ? `<button class="btn btn-ghost btn-sm" id="btn-reveal-md">Reveal in Finder</button>` : ''}
            <button class="btn btn-ghost btn-sm icon-btn" id="btn-regen-md">
              <i data-lucide="rotate-cw"></i> Regenerate
            </button>
            <button class="btn btn-ghost btn-sm icon-btn" id="btn-paper-outline">
              <i data-lucide="list-tree"></i> Outline
            </button>
            <button class="btn btn-ghost btn-sm icon-btn" id="btn-paper-draft">
              <i data-lucide="file-pen-line"></i> Draft
            </button>
            <button class="btn btn-ghost btn-sm icon-btn" id="btn-paper-experiments">
              <i data-lucide="flask-conical"></i> Experiments
            </button>
            <button class="btn btn-ghost btn-sm icon-btn" id="btn-paper-export">
              <i data-lucide="book-copy"></i> Export+citations
            </button>
          </div>
          <article class="report-view">
            ${tocHtml}
            ${renderedMd}
          </article>
        </div>
      `);
      if (contentEl.dataset.tab !== 'report') return;
      window.refreshIcons?.();
      $('#btn-copy-md').onclick = () => {
        navigator.clipboard.writeText(md);
        const b = $('#btn-copy-md');
        b.innerHTML = '<i data-lucide="check"></i> Copied';
        window.refreshIcons?.();
        setTimeout(() => { b.innerHTML = '<i data-lucide="copy"></i> Copy'; window.refreshIcons?.(); }, 1500);
      };
      $('#btn-download-md').onclick = () => {
        // Browser-native download — stays in the webview, no Rust round-trip.
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      // Reveal-in-Finder only present when the `gapmap.flags.reveal` flag is on.
      const _revMd = $('#btn-reveal-md'); if (_revMd) _revMd.onclick = () => api.revealInFinder(path);
      $('#btn-regen-md').onclick  = () => loadReport();
      $('#btn-paper-outline').onclick = (e) => runPaperPipelineAction(e.currentTarget, 'outline');
      $('#btn-paper-draft').onclick = (e) => runPaperPipelineAction(e.currentTarget, 'draft');
      $('#btn-paper-experiments').onclick = (e) => runPaperPipelineAction(e.currentTarget, 'experiments');
      $('#btn-paper-export').onclick = (e) => runPaperPipelineAction(e.currentTarget, 'export');
    } catch (e) {
      const ready = await hasLlmConfigured().catch(() => false);
      const actions = [
        { label: 'Retry',         icon: 'refresh-cw', primary: true,  onClick: () => loadReport() },
        { label: 'Build gap map', primary: false, onClick: () => switchTab('map') },
        ready
          ? { label: 'Run extraction', onClick: () => runEnrichHere(null, () => loadReport()) }
          : { label: 'Add LLM key',    onClick: () => openByokModal(() => loadReport()) },
      ];
      set(errorCard('Could not generate the report', e?.message || String(e), actions));
      if (contentEl.dataset.tab !== 'report') return;
      wireErrorCard(contentEl, actions);
    }
  }

  // ─── Evidence ─────────────────────────────────────────────────────────
  // In-memory state so "show more" survives re-renders within the same tab view.
  const evidenceVisible = { painpoint: 20, feature_wish: 20, product: 20, workaround: 20 };
  const PAGE = 20;

  // Client-side filter applied across all four kinds on the Evidence tab.
  // Persists for the life of the tab instance (not across route changes).
  let evidenceFilter = '';

  async function loadEvidence() {
    const set = (html) => { if (contentEl.dataset.tab === 'evidence') contentEl.innerHTML = html; };

    // SWR: paint cached rows synchronously before any await so the tab
    // feels instant on revisit. The four-kind findings query is fast
    // warm but pays a sidecar spawn (~200-800 ms) and the localStorage
    // cache survives full app restarts. Mutation listener in main.js
    // (kind='findings') drops the cache when extraction re-runs.
    const CACHE_KEY = `evidence.${topic}`;
    const cachedRows = readScreenCache(CACHE_KEY);
    let paintedFromCache = false;
    if (Array.isArray(cachedRows) && cachedRows.length > 0) {
      try {
        renderEvidenceFromRows(cachedRows);
        paintedFromCache = true;
      } catch (_) { /* fall through to skeleton */ }
    }
    if (!paintedFromCache) set(skeletonCards(3));

    try {
      // All four kinds in ONE sidecar call (was 4 parallel Python spawns).
      // SQL is hoisted to `combinedFindingsSql` above so this call shares a
      // cache key with the mount-time preload — first click paints instantly.
      const rows = await withTimeout(
        api.runQuery(combinedFindingsSql, topic),
        TOPIC_QUERY_TIMEOUT_MS,
        'evidence query'
      );
      if (Array.isArray(rows) && rows.length > 0) writeScreenCache(CACHE_KEY, rows);
      renderEvidenceFromRows(rows);
      return;
    } catch (e) {
      // If we already painted from cache, keep it on transient sidecar
      // failures — better than blanking. Otherwise fall through to the
      // existing error card.
      if (paintedFromCache) return;
      // Error-path actions also branch on whether a key is actually present,
      // so the retry path doesn't tell users to re-add a key they already have.
      const ready = await hasLlmConfigured().catch(() => false);
      const actions = [
        { label: 'Retry', icon: 'refresh-cw', primary: true, onClick: () => loadEvidence() },
        ready
          ? { label: 'Run extraction', onClick: () => runEnrichHere(null, () => loadEvidence()) }
          : { label: 'Add LLM key',    onClick: () => openByokModal(() => loadEvidence()) },
      ];
      set(errorCard('Could not load evidence', e?.message || String(e), actions));
      if (contentEl.dataset.tab !== 'evidence') return;
      wireErrorCard(contentEl, actions);
      return;
    }
  }

  // Pure-sync render of the evidence rows array → DOM. Pulled out of
  // loadEvidence so the SWR cache path can paint from localStorage
  // without re-running async empty-state checks (those only fire on
  // truly empty rows, which we don't cache).
  async function renderEvidenceFromRows(rows) {
    const set = (html) => { if (contentEl.dataset.tab === 'evidence') contentEl.innerHTML = html; };
    try {
      const byKind = { painpoint: [], feature_wish: [], product: [], workaround: [] };
      for (const r of rows || []) {
        if (byKind[r.kind]) byKind[r.kind].push(r);
      }
      // Apply search filter — case-insensitive, matches finding label.
      const filter = evidenceFilter.trim().toLowerCase();
      const filterRows = (arr) => filter
        ? arr.filter(r => (r.label || '').toLowerCase().includes(filter))
        : arr;
      const painpoints  = filterRows(byKind.painpoint);
      const features    = filterRows(byKind.feature_wish);
      const products    = filterRows(byKind.product);
      const workarounds = filterRows(byKind.workaround);
      const totalAfter  = painpoints.length + features.length + products.length + workarounds.length;
      const totalBefore = byKind.painpoint.length + byKind.feature_wish.length + byKind.product.length + byKind.workaround.length;

      const filterBar = `
        <div class="evidence-filter-row">
          <input id="evidence-filter" type="search" placeholder="Filter findings by label…" value="${esc(evidenceFilter)}" autocomplete="off" />
          <span class="evidence-filter-count">${filter ? `${totalAfter} of ${totalBefore}` : `${totalBefore} findings`}</span>
        </div>`;
      const section = (label, items, cls, kind) => {
        if (!Array.isArray(items) || !items.length) return '';
        const visible = Math.min(evidenceVisible[kind] || PAGE, items.length);
        const more = items.length - visible;
        return `
          <div class="card" style="margin-bottom:14px" data-ev-kind="${esc(kind)}">
            <div class="card-head"><div><h3>${esc(label)}</h3><p>${items.length} items${more > 0 ? ` · showing ${visible}` : ''}</p></div></div>
            <div class="findings-rail">
              ${items.slice(0, visible).map((it, i) => `
                <div class="finding">
                  <div class="finding-bullet ${cls}">${i + 1}</div>
                  <div class="finding-body">
                    <h4>${esc(it.label || '')}</h4>
                    <div class="finding-meta">
                      ${it.evidence_count ? `<span>📎 ${it.evidence_count} evidence</span>` : ''}
                      ${it.metadata_json ? renderMetaPills(it.metadata_json) : ''}
                      <button class="finding-find-similar" data-q="${esc(it.label || '')}" title="Find semantically-similar posts across the whole corpus">🔎 Find similar</button>
                    </div>
                  </div>
                </div>
              `).join('')}
              ${more > 0 ? `<button class="show-more-btn" data-more="${esc(kind)}">Show ${Math.min(more, PAGE)} more · ${more} hidden</button>` : ''}
            </div>
          </div>
        `;
      };
      const sectionsHtml = [
        section('🔥 Painpoints',              painpoints,  'chronic',  'painpoint'),
        section('🛠 DIY workarounds',         workarounds, 'emerging', 'workaround'),
        section('😡 Products complained about', products,  'chronic',  'product'),
        section('💡 Feature wishes',          features,    'emerging', 'feature_wish'),
      ].filter(Boolean).join('');

      // When a filter is active but matches nothing, show a cleaner state.
      const filteredEmpty = filter && sectionsHtml === ''
        ? `<div class="empty-state">No findings match "${esc(filter)}". Clear the filter to see all ${totalBefore}.</div>`
        : '';
      // Only render the filter bar if there are actual findings to filter.
      const html = totalBefore > 0
        ? (filterBar + (sectionsHtml || filteredEmpty))
        : '';
      if (contentEl.dataset.tab !== 'evidence') return;
      // Empty-state branches on WHY findings are missing:
      //   • key configured → user just needs to run extraction (not add a key).
      //   • key missing    → current copy stands.
      // Prior version hard-coded "Add LLM key" regardless, so users who had
      // already saved a key saw a dead loop (save key → still empty → same
      // modal). See docs/research-applications.md / bug discussion 2026-04-20.
      let emptyHtml = '';
      let emptyWire = null;
      if (!html) {
        const llmReady = await hasLlmConfigured();
        const last = _lastEnrichResult.get(topic);
        // Four distinct empty-state branches, picked by what actually happened:
        //   1. Never ran + LLM ready    → "Run extraction now"
        //   2. Never ran + LLM missing  → "Add LLM key"
        //   3. Ran but 0 findings       → model-weak guidance + retry + switch provider
        //   4. Ran and errored          → surface provider + error + retry
        if (last && last.error) {
          const prov = last.provider || 'LLM';
          emptyHtml = `
            <div class="empty-big">
              <h3>Extraction failed on this topic</h3>
              <p>Provider: <code>${esc(prov)}</code>${last.model ? ` · Model: <code>${esc(last.model)}</code>` : ''}</p>
              <p style="color:var(--ink-3); font-size:13px; word-break:break-word; max-width:600px">${esc(String(last.error).slice(0, 400))}</p>
              <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap">
                <button class="btn btn-primary icon-btn" id="btn-ev-enrich"><i data-lucide="rotate-cw"></i> Retry</button>
                <button class="btn btn-ghost btn-bordered icon-btn" id="btn-ev-keys"><i data-lucide="key-round"></i> Change LLM</button>
                <button class="btn btn-ghost btn-bordered icon-btn" id="btn-ev-all"><i data-lucide="sparkles"></i> Enrich all topics</button>
              </div>
            </div>`;
          emptyWire = () => {
            $('#btn-ev-enrich')?.addEventListener('click', () => runEnrichHere('#btn-ev-enrich', () => loadEvidence()));
            $('#btn-ev-keys')?.addEventListener('click', () => openByokModal(() => loadEvidence()));
            $('#btn-ev-all')?.addEventListener('click', () => runEnrichAllTopics().then(() => loadEvidence()));
          };
        } else if (last && last.added === 0) {
          const prov = last.provider || 'LLM';
          const drop = last.droppedOffTopic;
          const dropTotal = drop ? (drop.painpoints + drop.feature_wishes + drop.product_complaints + drop.diy_workarounds) : 0;
          const dropLine = dropTotal > 0
            ? `<p style="color:var(--ink-3); font-size:12px">${dropTotal} findings were dropped as off-topic (similarity < 0.45).</p>`
            : '';
          emptyHtml = `
            <div class="empty-big">
              <h3>Extraction ran — LLM returned 0 findings</h3>
              <p>Provider: <code>${esc(prov)}</code>${last.model ? ` · Model: <code>${esc(last.model)}</code>` : ''} · Corpus sampled: <b>${last.corpusSize ?? '?'}</b> posts</p>
              <p style="max-width:600px">Small local models (llama3.2:3b, gemma4:e2b) often can't extract structured findings. Try a stronger model — Anthropic Claude, OpenRouter, or <code>ollama pull qwen2.5:7b</code> — or <b>Re-run collect</b> to gather more on-topic posts.</p>
              ${dropLine}
              <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap">
                <button class="btn btn-primary icon-btn" id="btn-ev-enrich"><i data-lucide="rotate-cw"></i> Retry extraction</button>
                <button class="btn btn-ghost btn-bordered icon-btn" id="btn-ev-keys"><i data-lucide="key-round"></i> Change LLM</button>
                <button class="btn btn-ghost btn-bordered icon-btn" id="btn-ev-all"><i data-lucide="sparkles"></i> Enrich all topics</button>
              </div>
            </div>`;
          emptyWire = () => {
            $('#btn-ev-enrich')?.addEventListener('click', () => runEnrichHere('#btn-ev-enrich', () => loadEvidence()));
            $('#btn-ev-keys')?.addEventListener('click', () => openByokModal(() => loadEvidence()));
            $('#btn-ev-all')?.addEventListener('click', () => runEnrichAllTopics().then(() => loadEvidence()));
          };
        } else if (llmReady) {
          emptyHtml = `
            <div class="empty-big">
              <h3>No extraction has run yet on this topic</h3>
              <p>Your LLM provider is configured. Run extraction now to pull painpoints, DIY workarounds, competitor mentions, and feature wishes out of the corpus.</p>
              <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap">
                <button class="btn btn-primary icon-btn" id="btn-ev-enrich"><i data-lucide="sparkles"></i> Run extraction now</button>
                <button class="btn btn-ghost btn-bordered icon-btn" id="btn-ev-all"><i data-lucide="layers"></i> Enrich all topics</button>
              </div>
            </div>`;
          emptyWire = () => {
            $('#btn-ev-enrich')?.addEventListener('click', () => runEnrichHere('#btn-ev-enrich', () => loadEvidence()));
            $('#btn-ev-all')?.addEventListener('click', () => runEnrichAllTopics().then(() => loadEvidence()));
          };
        } else {
          emptyHtml = `
            <div class="empty-big">
              <h3>No semantic extraction yet</h3>
              <p>Add a cloud LLM key (Anthropic / OpenAI / OpenRouter / Groq / DeepSeek / Mistral / Gemini) <em>or</em> point to a local Ollama instance so painpoints, DIY workarounds, and feature wishes can be extracted from the corpus.</p>
              <button class="btn btn-primary icon-btn" id="btn-ev-keys"><i data-lucide="key-round"></i> Add LLM key</button>
            </div>`;
          emptyWire = () => $('#btn-ev-keys')?.addEventListener('click', () => openByokModal(() => loadEvidence()));
        }
      }
      set(html || emptyHtml);
      // "Show more" delegates — bumps the per-kind visible counter and re-renders.
      contentEl.querySelectorAll('.show-more-btn').forEach(btn => {
        btn.onclick = () => {
          const k = btn.dataset.more;
          evidenceVisible[k] = (evidenceVisible[k] || PAGE) + PAGE;
          loadEvidence();
        };
      });

      // Source-breakdown badges — clicking "7 reddit" or "3 arXiv" drills
      // into Posts tab with a source filter applied. Stop-propagates so the
      // card's own click handler (which opens the details modal) doesn't
      // also fire. Same behaviour as the Sources-tab source rows — one
      // consistent cross-tab drill gesture.
      contentEl.querySelectorAll('.finding-src-badge').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const src = el.dataset.source;
          if (!src) return;
          setPostsFilter(topic, { source: src });
          switchTab('posts');
        });
      });

      // "Find similar" chips — route to the /find screen pre-filled with
      // the finding label + scoped to this topic. find.js consumes the
      // window globals on mount and auto-runs the search.
      contentEl.querySelectorAll('.finding-find-similar').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const q = btn.dataset.q || '';
          if (!q) return;
          window.gapmapFindQuery = q;
          window.gapmapFindTopic = topic;
          location.hash = '#/find';
        };
      });

      // Live filter: narrow findings by label. Debounced to 180 ms so each
      // keystroke doesn't re-render the whole DOM on typed-in-fast input.
      const filterInput = contentEl.querySelector('#evidence-filter');
      if (filterInput) {
        let debounceTimer = null;
        filterInput.addEventListener('input', (e) => {
          const v = e.target.value;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            evidenceFilter = v;
            const pos = filterInput.selectionStart;
            loadEvidence();
            // Restore focus + caret position after re-render (fast path — element is recreated).
            setTimeout(() => {
              const fresh = contentEl.querySelector('#evidence-filter');
              if (fresh) {
                fresh.focus();
                try { fresh.setSelectionRange(pos, pos); } catch {}
              }
            }, 0);
          }, 180);
        });
      }

      // Empty-state button wiring — runs only on the 0-findings branch and
      // attaches the right handler (Run extraction vs Add LLM key).
      emptyWire?.();
      window.refreshIcons?.();
    } catch (e) {
      // Error-path actions also branch on whether a key is actually present,
      // so the retry path doesn't tell users to re-add a key they already have.
      const ready = await hasLlmConfigured().catch(() => false);
      const actions = [
        { label: 'Retry', icon: 'refresh-cw', primary: true, onClick: () => loadEvidence() },
        ready
          ? { label: 'Run extraction', onClick: () => runEnrichHere(null, () => loadEvidence()) }
          : { label: 'Add LLM key',    onClick: () => openByokModal(() => loadEvidence()) },
      ];
      set(errorCard('Could not load evidence', e?.message || String(e), actions));
      if (contentEl.dataset.tab !== 'evidence') return;
      wireErrorCard(contentEl, actions);
    }
  }

  // ─── Sources ──────────────────────────────────────────────────────────
  let subsVisible = 12;
  async function loadSources() {
    const set = (html) => { if (contentEl.dataset.tab === 'sources') contentEl.innerHTML = html; };

    // SWR: paint cached sources+subs synchronously before any await.
    // Cache survives full app restart — see docs/perf-audit.md.
    const CACHE_KEY = `sources.${topic}`;
    const cached = readScreenCache(CACHE_KEY);
    let paintedFromCache = false;
    if (cached && Array.isArray(cached.sources) && cached.sources.length > 0) {
      try {
        renderSourcesFromData(cached.sources, cached.subs || []);
        paintedFromCache = true;
      } catch (_) { /* fall through to skeleton */ }
    }
    if (!paintedFromCache) set(skeletonCards(2));

    try {
      // Parameterized — topic goes in safely via :topic, no string concat.
      const srcSql = `SELECT coalesce(p.source_type,'reddit') AS source, count(*) AS posts,
                             min(p.created_utc) AS earliest, max(p.created_utc) AS latest
                      FROM topic_posts tp JOIN posts p ON p.id=tp.post_id
                      WHERE tp.topic=:topic
                      GROUP BY coalesce(p.source_type,'reddit')
                      ORDER BY posts DESC`;
      // Pull up to 60 subs — frontend paginates with a show-more button.
      // Scope to reddit/lemmy: for every other adapter `p.sub` is a
      // free-form bucket (gnews=feed name, hn=site domain, github=repo,
      // arxiv=venue, rss=feed slug, …) — long, often URL-shaped strings
      // that don't belong under an `r/...` label and visually overflow
      // the tile grid.
      const subsSql = `SELECT p.sub AS sub, count(*) AS posts
                       FROM topic_posts tp JOIN posts p ON p.id=tp.post_id
                       WHERE tp.topic=:topic
                         AND p.sub IS NOT NULL AND p.sub <> ''
                         AND coalesce(p.source_type,'reddit') IN ('reddit','lemmy')
                       GROUP BY p.sub ORDER BY posts DESC LIMIT 60`;
      const [sources, subs] = await Promise.all([
        api.runQuery(srcSql, topic),
        api.runQuery(subsSql, topic).catch(() => []),
      ]);
      if (Array.isArray(sources) && sources.length > 0) {
        writeScreenCache(CACHE_KEY, { sources, subs: subs || [] });
      }
      renderSourcesFromData(sources || [], subs || []);
    } catch (e) {
      if (paintedFromCache) return;   // keep stale-but-valid render
      const actions = [{ label: 'Retry', icon: 'refresh-cw', primary: true, onClick: () => loadSources() }];
      set(errorCard('Could not load sources', e?.message || String(e), actions));
      if (contentEl.dataset.tab !== 'sources') return;
      wireErrorCard(contentEl, actions);
    }
  }

  // Pure-sync DOM render of sources + subs lists. Pulled out of
  // loadSources so the SWR cache path can paint without re-fetching.
  function renderSourcesFromData(sources, subs) {
    const set = (html) => { if (contentEl.dataset.tab === 'sources') contentEl.innerHTML = html; };
    try {
      const total = (sources || []).reduce((a, r) => a + (r.posts || 0), 0);
      const sourceRow = (r) => {
        const pct = total ? Math.round((r.posts / total) * 100) : 0;
        const earliestS = r.earliest ? new Date(r.earliest * 1000).toISOString().slice(0, 10) : '—';
        const latestS   = r.latest   ? new Date(r.latest   * 1000).toISOString().slice(0, 10) : '—';
        // Clickable row — drills into Posts tab filtered to this source.
        // Keyboard-accessible via role/tabindex so Enter / Space work.
        return `
          <div class="source-row source-row-clickable" data-source="${esc(r.source)}" role="button" tabindex="0" title="Click to see all ${esc(r.source)} posts for this topic">
            <div class="source-row-head">
              <b>${esc(r.source)}</b>
              <span>${r.posts.toLocaleString()} posts · ${pct}% <span style="color:var(--ink-3);font-weight:500;font-size:11px">· view all →</span></span>
            </div>
            <div class="source-bar"><div class="source-bar-fill" style="width:${pct}%"></div></div>
            <div class="source-row-meta">First: ${earliestS} · Latest: ${latestS}</div>
          </div>`;
      };
      const subTile = (r) => `
        <div class="sub-tile">
          <h5>r/${esc(r.sub)}</h5>
          <span>${r.posts.toLocaleString()} posts</span>
        </div>`;
      if (contentEl.dataset.tab !== 'sources') return;
      set(`
        <div class="card" style="margin-bottom:14px">
          <div class="card-head"><div><h3>Sources</h3><p>${total.toLocaleString()} posts across ${(sources || []).length} source types</p></div></div>
          <div class="sources-list">
            ${(sources || []).length ? (sources || []).map(sourceRow).join('') : `<div class="empty-state">no posts tagged to this topic yet</div>`}
          </div>
        </div>
        ${(subs || []).length ? (() => {
          const visible = Math.min(subsVisible, subs.length);
          const more = subs.length - visible;
          return `
          <div class="card">
            <div class="card-head"><div><h3>Top subreddits</h3><p>${subs.length} subs contributing${more > 0 ? ` · showing ${visible}` : ''}</p></div></div>
            <div class="sub-grid">${subs.slice(0, visible).map(subTile).join('')}</div>
            ${more > 0 ? `<div style="padding:0 20px 16px"><button class="show-more-btn" id="btn-subs-more">Show ${Math.min(more, 12)} more · ${more} hidden</button></div>` : ''}
          </div>`;
        })() : ''}
      `);
      $('#btn-subs-more')?.addEventListener('click', () => {
        subsVisible += 12;
        loadSources();
      });

      // Click / Enter / Space on a source row → filter Posts tab by that
      // source and switch tabs. Same gesture works for every source
      // (Reddit, App Store, HN, arXiv, …) since Posts renders any shape.
      const drillIntoSource = (src) => {
        if (!src) return;
        setPostsFilter(topic, { source: src });
        switchTab('posts');
      };
      contentEl.querySelectorAll('.source-row-clickable').forEach(el => {
        el.addEventListener('click', () => drillIntoSource(el.dataset.source));
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            drillIntoSource(el.dataset.source);
          }
        });
      });
    } catch (e) {
      const actions = [{ label: 'Retry', icon: 'refresh-cw', primary: true, onClick: () => loadSources() }];
      set(errorCard('Could not load sources', e?.message || String(e), actions));
      if (contentEl.dataset.tab !== 'sources') return;
      wireErrorCard(contentEl, actions);
    }
  }

  // ─── Research (academic papers + ingested PDFs) ───────────────────────
  // Shows arxiv / openalex / pubmed / scholar / ingest rows as first-class
  // cards with title + abstract preview + citation count + open-link button.
  // Only these sources surface here — Reddit lives in its own tabs.
  const ACADEMIC_SOURCES = ['arxiv', 'openalex', 'pubmed', 'scholar', 'ingest'];
  const SRC_LABELS = {
    arxiv: 'arXiv', openalex: 'OpenAlex', pubmed: 'PubMed',
    scholar: 'Semantic Scholar', ingest: 'Ingested docs',
  };
  const SRC_BADGE_COLORS = {
    arxiv:    { bg: '#FBE3E6', fg: '#B84747' },
    openalex: { bg: '#EFE7FB', fg: '#6E4DB3' },
    pubmed:   { bg: '#E4F0FA', fg: '#1F5C99' },
    scholar:  { bg: '#E1F2EA', fg: '#2E7D5B' },
    ingest:   { bg: '#FBF1D4', fg: '#8A5A1A' },
  };
  let researchVisible = {};  // per-source visible count
  // Sort mode for the Research tab. 'cites' = most-cited first (score DESC);
  // 'newest' = newest first (created_utc DESC). Persisted for the life of
  // the topic instance; resets when the user navigates away.
  let researchSort = 'cites';

  async function loadResearch() {
    const set = (html) => { if (contentEl.dataset.tab === 'research') contentEl.innerHTML = html; };
    set(skeletonCards(3));
    try {
      const placeholders = ACADEMIC_SOURCES.map(() => '?').join(',');
      const rows = await api.runQuery(
        `SELECT p.id, p.title, p.url, p.permalink, p.author,
                p.score, p.num_comments, p.created_utc, p.sub,
                coalesce(p.source_type,'reddit') AS source,
                substr(coalesce(p.selftext,''),1,400) AS excerpt
         FROM posts p JOIN topic_posts tp ON tp.post_id = p.id
         WHERE tp.topic=:topic AND coalesce(p.source_type,'reddit') IN (${placeholders})
         ORDER BY coalesce(p.score,0) DESC, p.created_utc DESC`,
        topic,
        Object.fromEntries(ACADEMIC_SOURCES.map((s, i) => [`__${i}`, s])),
      ).catch(async () => {
        // api.runQuery can't bind IN-list via named params in all drivers.
        // Retry with a client-side filter — slower but always works.
        const all = await api.runQuery(
          `SELECT p.id, p.title, p.url, p.permalink, p.author,
                  p.score, p.num_comments, p.created_utc, p.sub,
                  coalesce(p.source_type,'reddit') AS source,
                  substr(coalesce(p.selftext,''),1,400) AS excerpt
           FROM posts p JOIN topic_posts tp ON tp.post_id = p.id
           WHERE tp.topic=:topic AND coalesce(p.source_type,'reddit') != 'reddit'
           ORDER BY coalesce(p.score,0) DESC, p.created_utc DESC`,
          topic,
        );
        return (all || []).filter(r => ACADEMIC_SOURCES.includes(r.source));
      });

      if (!rows || !rows.length) {
        if (contentEl.dataset.tab !== 'research') return;
        set(`
          <div class="empty-big">
            <h3>No research yet</h3>
            <p>Collect a topic with academic sources to populate this tab — arXiv, OpenAlex, PubMed, or Semantic Scholar. You can also drag a PDF into the Ingest screen to add your own papers and reports.</p>
            <div style="display:flex;gap:10px;justify-content:center;margin-top:14px">
              <button class="btn btn-primary" id="btn-research-collect">Rerun collect with --sources arxiv</button>
              <button class="btn btn-ghost btn-bordered" id="btn-research-ingest">Ingest a PDF</button>
            </div>
          </div>`);
        $('#btn-research-collect')?.addEventListener('click', () => {
          location.hash = `#/collect/${encodeURIComponent(topic)}`;
        });
        $('#btn-research-ingest')?.addEventListener('click', () => {
          location.hash = '#/ingest';
        });
        return;
      }

      // Group by source. Within each group, resort by the active toggle:
      //   - 'cites' → score DESC (citation count for scholar/openalex; 0 for others, then date)
      //   - 'newest' → created_utc DESC (newest-first; useful for arxiv where dates matter)
      const grouped = {};
      for (const r of rows) {
        (grouped[r.source] = grouped[r.source] || []).push(r);
      }
      Object.values(grouped).forEach(arr => {
        if (researchSort === 'newest') {
          arr.sort((a, b) => (b.created_utc || 0) - (a.created_utc || 0));
        } else {
          arr.sort((a, b) =>
            (b.score || 0) - (a.score || 0) ||
            (b.created_utc || 0) - (a.created_utc || 0));
        }
      });

      // Load existing paper analyses in parallel with the papers query so
      // the cards can show summaries/relevance/takeaways the moment they
      // render. Failure is non-fatal — cards just fall back to the
      // un-analyzed view with an "Analyze" button.
      const analysesRows = await api.paperAnalysesGet(topic).catch(() => []);
      const analysesByPostId = new Map();
      for (const a of (Array.isArray(analysesRows) ? analysesRows : [])) {
        if (a && a.post_id) analysesByPostId.set(a.post_id, a);
      }
      const unanalyzedCount = rows.filter(r => !analysesByPostId.has(r.id)).length;

      const paperCard = (r) => {
        const c = SRC_BADGE_COLORS[r.source] || { bg: 'var(--surface-2)', fg: 'var(--ink-2)' };
        const badge = `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${c.bg};color:${c.fg};font-size:10px;font-weight:700;letter-spacing:.03em">${esc(SRC_LABELS[r.source] || r.source)}</span>`;
        const title = esc((r.title || '(untitled)').slice(0, 160));
        const excerpt = esc((r.excerpt || '').trim().slice(0, 260));
        const analysis = analysesByPostId.get(r.id);
        const analysisHtml = analysis ? `
          <div class="paper-analysis" data-post-id="${esc(r.id)}" style="margin-top:10px;padding:10px 12px;background:var(--surface-2);border-radius:var(--radius-sm);border:1px solid var(--line)">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;letter-spacing:.04em;text-transform:uppercase">📘 Summary</div>
            <div style="font-size:12.5px;color:var(--ink);line-height:1.5;margin-bottom:8px">${esc(analysis.summary || '')}</div>
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;letter-spacing:.04em;text-transform:uppercase">🎯 Why this matters for "${esc(topic)}"</div>
            <div style="font-size:12.5px;color:var(--ink-2);line-height:1.5;margin-bottom:8px">${esc(analysis.relevance || '')}</div>
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;letter-spacing:.04em;text-transform:uppercase">🔨 Builder takeaway</div>
            <div style="font-size:12.5px;color:var(--ink);line-height:1.5;background:var(--gold-soft);padding:6px 10px;border-radius:8px;border-left:3px solid var(--gold)"><b>${esc(analysis.takeaway || '')}</b></div>
          </div>` : `
          <div class="paper-analyze-row" data-post-id="${esc(r.id)}" style="margin-top:10px">
            <button class="btn btn-ghost btn-sm btn-bordered paper-analyze-btn" data-analyze="${esc(r.id)}"><i data-lucide="sparkles"></i> Analyze</button>
          </div>`;
        const url = postLink(r);
        const cites = r.source === 'scholar' || r.source === 'openalex'
          ? (r.score ? `${r.score.toLocaleString()} cites · ` : '')
          : '';
        const date = r.created_utc
          ? new Date(r.created_utc * 1000).toISOString().slice(0, 10)
          : '';
        const author = (r.author || '').trim();
        const authorStr = (author && author !== '[deleted]' && author !== '[pdf]' && author !== '[local]')
          ? `<span style="color:var(--ink-3)"> · ${esc(author.slice(0, 60))}</span>`
          : '';
        const openBtn = url
          ? `<button class="btn btn-ghost btn-sm btn-bordered icon-btn" data-open="${esc(url)}" title="Open source"><i data-lucide="external-link"></i> Open</button>`
          : '';
        // Copy-citation payload: markdown-formatted reference the user can
        // paste into notes, PR descriptions, or a write-up. Includes title,
        // source, date, citation count (when it applies), and the URL/DOI.
        const srcLabelReadable = SRC_LABELS[r.source] || r.source;
        const citeParts = [];
        if (r.title) citeParts.push(`**${(r.title || '').trim()}**`);
        if (author && author !== '[deleted]' && author !== '[pdf]' && author !== '[local]') {
          citeParts.push(author);
        }
        const citeMeta = [srcLabelReadable];
        if (date) citeMeta.push(date);
        if ((r.source === 'scholar' || r.source === 'openalex') && r.score) {
          citeMeta.push(`${r.score} cites`);
        }
        citeParts.push(`_${citeMeta.join(' · ')}_`);
        if (url) citeParts.push(url);
        const citation = citeParts.join(' — ');
        const citeBtn = `<button class="paper-cite-btn" data-cite="${esc(citation)}" title="Copy citation markdown"><i data-lucide="quote"></i> Cite</button>`;
        return `
          <div class="card" style="margin-bottom:10px;padding:14px 18px">
            <div style="display:flex;gap:10px;align-items:flex-start">
              <div style="flex:1;min-width:0">
                <div style="margin-bottom:6px">${badge}<span style="color:var(--ink-3);font-size:11px;margin-left:8px">${cites}${esc(date)}${authorStr}</span></div>
                <h4 style="font-size:14px;font-weight:700;line-height:1.35;margin-bottom:4px">${title}</h4>
                ${excerpt ? `<p style="font-size:12px;color:var(--ink-2);line-height:1.5">${excerpt}…</p>` : ''}
                ${analysisHtml}
              </div>
              <div style="flex-shrink:0;display:flex;gap:6px;align-items:flex-start">${citeBtn}${openBtn}</div>
            </div>
          </div>`;
      };

      const analyzeAllBtn = unanalyzedCount > 0
        ? `<button class="btn btn-primary btn-sm icon-btn" id="btn-analyze-all"><i data-lucide="sparkles"></i> Analyze all (${unanalyzedCount})</button>`
        : '';
      const sortToggle = `
        <div class="research-sort-row">
          <span>Sort:</span>
          <button class="research-sort-btn ${researchSort === 'cites' ? 'active' : ''}" data-sort="cites">Most cited</button>
          <button class="research-sort-btn ${researchSort === 'newest' ? 'active' : ''}" data-sort="newest">Newest</button>
          <span style="margin-left:auto;font-size:11px;color:var(--ink-3);margin-right:10px">${rows.length} paper${rows.length === 1 ? '' : 's'} total · ${analysesByPostId.size} analyzed</span>
          ${analyzeAllBtn}
        </div>`;

      const html = ACADEMIC_SOURCES.filter(s => grouped[s]).map(src => {
        const items = grouped[src];
        const cap = researchVisible[src] || 10;
        const visible = Math.min(cap, items.length);
        const more = items.length - visible;
        return `
          <div class="card" style="margin-bottom:14px;padding:0">
            <div class="card-head">
              <div>
                <h3>${esc(SRC_LABELS[src] || src)} <span style="color:var(--ink-3);font-weight:500;font-size:12px">· ${items.length} item${items.length === 1 ? '' : 's'}</span></h3>
                <p>Click any card's Open button to read the full source.</p>
              </div>
            </div>
            <div style="padding:14px 18px 4px">
              ${items.slice(0, visible).map(paperCard).join('')}
              ${more > 0 ? `<button class="show-more-btn" data-more-src="${esc(src)}">Show ${Math.min(more, 10)} more · ${more} hidden</button>` : ''}
            </div>
          </div>`;
      }).join('');

      if (contentEl.dataset.tab !== 'research') return;
      set(sortToggle + html);

      contentEl.querySelectorAll('[data-open]').forEach(btn => {
        btn.onclick = () => {
          const url = btn.dataset.open;
          if (url) api.openUrl(url);
        };
      });
      contentEl.querySelectorAll('[data-more-src]').forEach(btn => {
        btn.onclick = () => {
          const s = btn.dataset.moreSrc;
          researchVisible[s] = (researchVisible[s] || 10) + 10;
          loadResearch();
        };
      });
      // Per-card "Analyze" → one LLM call, replace the button with the
      // rendered analysis in place. Other cards unaffected.
      contentEl.querySelectorAll('[data-analyze]').forEach(btn => {
        btn.onclick = async () => {
          const pid = btn.dataset.analyze;
          if (!pid) return;
          const row = btn.closest('.paper-analyze-row');
          if (!row) return;
          btn.disabled = true;
          const origHtml = btn.innerHTML;
          btn.innerHTML = '<i data-lucide="loader-2"></i> Analyzing…';
          window.refreshIcons?.();
          try {
            const r = await api.analyzePaper(topic, pid);
            if (r && r.ok) {
              // Easy path: re-render the whole Research tab so the card
              // picks up the new analysis plus the count updates.
              loadResearch();
              return;
            }
            const msg = r?.reason || r?.error || 'failed';
            btn.disabled = false;
            btn.innerHTML = origHtml;
            alert(`Analyze failed: ${msg}`);
          } catch (e) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
            alert(`Analyze errored: ${e?.message || e}`);
          }
        };
      });
      // "Analyze all (N)" → bulk command, re-render when done.
      const analyzeAllEl = contentEl.querySelector('#btn-analyze-all');
      if (analyzeAllEl) {
        analyzeAllEl.onclick = async () => {
          analyzeAllEl.disabled = true;
          const origHtml = analyzeAllEl.innerHTML;
          analyzeAllEl.innerHTML = '<i data-lucide="loader-2"></i> Analyzing…';
          window.refreshIcons?.();
          try {
            const r = await api.analyzePapersBulk(topic);
            loadResearch();
            if (r && r.skipped && r.skipped.length === r.total && r.total > 0) {
              alert(`All ${r.total} skipped — ${r.skipped[0]?.reason || 'no LLM configured'}. Add a key in Settings.`);
            }
          } catch (e) {
            analyzeAllEl.disabled = false;
            analyzeAllEl.innerHTML = origHtml;
            alert(`Analyze-all errored: ${e?.message || e}`);
          }
        };
      }
      // Sort toggle → flip mode + re-render.
      contentEl.querySelectorAll('.research-sort-btn').forEach(btn => {
        btn.onclick = () => {
          const next = btn.dataset.sort;
          if (next && next !== researchSort) {
            researchSort = next;
            loadResearch();
          }
        };
      });
      // Copy citation → markdown to clipboard + transient "Copied!" state.
      contentEl.querySelectorAll('.paper-cite-btn').forEach(btn => {
        btn.onclick = async () => {
          const cite = btn.dataset.cite || '';
          try {
            await navigator.clipboard.writeText(cite);
            btn.classList.add('copied');
            const origHtml = btn.innerHTML;
            btn.innerHTML = '<i data-lucide="check"></i> Copied';
            window.refreshIcons?.();
            setTimeout(() => {
              btn.classList.remove('copied');
              btn.innerHTML = origHtml;
              window.refreshIcons?.();
            }, 1400);
          } catch (err) {
            showToast('Copy failed', err?.message || String(err), 'err');
          }
        };
      });
      window.refreshIcons?.();
    } catch (e) {
      const actions = [{ label: 'Retry', primary: true, onClick: () => loadResearch() }];
      set(errorCard('Could not load research', e?.message || String(e), actions));
      if (contentEl.dataset.tab !== 'research') return;
      wireErrorCard(contentEl, actions);
    }
  }

  // ─── Chat ─────────────────────────────────────────────────────────────
  const PRESETS = [
    { mode: 'ask',      icon: 'help-circle',   label: 'Ask anything',    desc: 'Free-form question about this topic' },
    { mode: 'plan',     icon: 'clipboard-list',label: '1-week plan',     desc: 'Concrete validation plan with who to talk to' },
    { mode: 'features', icon: 'target',        label: 'Features to build', desc: 'Top 5 features sorted by pain × gap' },
    { mode: 'sources',  icon: 'search',        label: 'Source-wise',     desc: 'What each data source uniquely says' },
    { mode: 'bullets',  icon: 'list',          label: 'Bullet learnings', desc: 'Key takeaways only — no intro/outro' },
  ];

  // Toggle busy/idle state on the chat composer. Hoisted to renderTopic
  // scope so BOTH `loadChat()` (which uses it inline while wiring the UI)
  // AND the sibling-scope `send()` function (which fires it on every
  // chat:start, chat:done, chat:error) can call it. Re-queries the DOM
  // each call rather than capturing element references at definition
  // time — that lets it survive a chat-tab re-render between calls.
  function setBusyUi(busy, msg = null) {
    const chatWrap = contentEl.querySelector('.chat-wrap');
    const statusText = contentEl.querySelector('#chat-status-text');
    const sendBtn = contentEl.querySelector('#btn-chat-send');
    const cancelBtn = contentEl.querySelector('#btn-chat-cancel');
    const input = contentEl.querySelector('#chat-input');
    const presetBtns = contentEl.querySelectorAll('.chat-preset');
    if (chatWrap) chatWrap.classList.toggle('chat-busy', !!busy);
    if (statusText && msg) statusText.textContent = msg;
    if (sendBtn) {
      sendBtn.disabled = !!busy;
      sendBtn.textContent = busy ? 'Working…' : 'Send';
      sendBtn.hidden = !!busy;
    }
    if (cancelBtn) {
      cancelBtn.hidden = !busy;
      cancelBtn.disabled = !busy;
    }
    presetBtns.forEach(p => p.disabled = !!busy);
    if (input) {
      // Keep input focusable so Enter behavior is consistent before/after
      // a run; we still gate duplicate sends via `chatStream.active`.
      input.readOnly = !!busy;
      if (busy) input.setAttribute('aria-busy', 'true');
      else input.removeAttribute('aria-busy');
    }
  }

  async function loadChat() {
    const set = (html) => { if (contentEl.dataset.tab === 'chat') contentEl.innerHTML = html; };
    // Gate 1: need an LLM key.
    let byok = {};
    try { byok = await api.byokStatus(); } catch {}
    if (contentEl.dataset.tab !== 'chat') return;
    const anyReady =
      byok?.anthropic?.set || byok?.openai?.set || byok?.openrouter?.set ||
      byok?.groq?.set || byok?.deepseek?.set || byok?.mistral?.set ||
      byok?.google?.set || byok?.nvidia?.set || !!byok?.ollama_base_url;

    // Two evidence sources back chat answers:
    //   1) Palace retrieval (ChromaDB MiniLM-L6-v2 ONNX + BM25) over every
    //      indexed post — the primary, always-available grounding.
    //   2) Pre-extracted findings (graph_nodes painpoints / features /
    //      workarounds / products) — secondary; layered onto the prompt
    //      when present.
    //
    // Old code blocked chat when (2) was empty. That was wrong: palace
    // ALONE produces grounded answers from raw posts (`_semantic_evidence`
    // in research/chat.py:87 fires before any findings lookup). The only
    // genuine empty state is "no posts at all" — we still block that.
    // When findings=0 but posts exist, surface a soft inline notice so
    // the user knows enrichment would tighten answers, but let the chat
    // proceed normally via palace.
    let postCount = 0;
    let findingsCount = 0;
    try {
      const rows = await api.runQuery(
        `SELECT
           (SELECT count(*) FROM topic_posts WHERE topic=:topic) AS posts,
           (SELECT count(*) FROM graph_nodes
              WHERE topic=:topic
                AND kind IN ('painpoint','feature_wish','workaround','product')) AS findings`,
        topic,
      );
      const r = (Array.isArray(rows) && rows[0]) || {};
      postCount     = Number(r.posts || 0);
      findingsCount = Number(r.findings || 0);
    } catch {}
    if (anyReady && postCount === 0) {
      if (contentEl.dataset.tab !== 'chat') return;
      set(`
        <div class="empty-big" style="margin:18px 0">
          <h3>No corpus yet</h3>
          <p>Chat retrieves evidence from indexed posts in this topic, but no posts have been collected.
             Run a collect first — palace (ChromaDB + MiniLM ONNX) will index them automatically and
             chat will work even without LLM-extracted findings.</p>
          <div style="display:flex;gap:10px;justify-content:center;margin-top:14px">
            <button class="btn btn-primary" id="btn-chat-rerun">Run collect</button>
          </div>
        </div>`);
      $('#btn-chat-rerun').onclick = () => { location.hash = `#/collect/${encodeURIComponent(topic)}`; };
      return;
    }
    // findingsCount === 0 but postCount > 0 → fall through. We expose a
    // soft chip in the chat UI (rendered below by mounting #chat-no-findings-hint)
    // so the user can opt to enrich without being forced to.

    const providerLabel = (byok?.llm_provider || '').toString().toUpperCase() || 'auto-detect';
    const modelLabel = byok?.llm_model || 'default';

    const agentDefault = localStorage.getItem('gapmap.chat.agent') === 'true';
    if (contentEl.dataset.tab !== 'chat') return;

    // Hydrate the active conversation from SQLite (+ one-time legacy
    // migration) before first paint so renderMessages shows the right thread.
    if (anyReady) {
      try { await hydrateChat(topic); } catch {}
      if (contentEl.dataset.tab !== 'chat') return;
    }

    // Build chat body outside the outer template — nested ternary + IIFE inside a template
    // literal breaks Vite import-analysis (parse error near closing backtick + brace).
    let chatMainHtml;
    if (!anyReady) {
      const configured = [];
      if (byok?.anthropic?.set)  configured.push('Anthropic');
      if (byok?.openai?.set)     configured.push('OpenAI');
      if (byok?.openrouter?.set) configured.push('OpenRouter');
      if (byok?.groq?.set)       configured.push('Groq');
      if (byok?.deepseek?.set)   configured.push('DeepSeek');
      if (byok?.mistral?.set)    configured.push('Mistral');
      if (byok?.google?.set)     configured.push('Google');
      if (byok?.nvidia?.set)     configured.push('NVIDIA');
      if (byok?.ollama_base_url) configured.push('Ollama');
      const statusLine = configured.length
        ? `<p style="color:var(--ink-2);font-size:13px;margin:6px 0 0"><b>${configured.length}</b> provider${configured.length>1?'s':''} configured: ${esc(configured.join(', '))} — but no default picked.</p>`
        : '';
      chatMainHtml = `
          <div class="empty-big" style="margin:18px 0">
            <h3>${configured.length ? 'Pick a default model' : 'No LLM key yet'}</h3>
            <p>${configured.length
        ? 'Open the key manager and click a model chip to set a default. Chat will grant access immediately.'
        : "Add Anthropic, OpenAI, OpenRouter, Groq, DeepSeek, Gemini, or local Ollama — chat streams grounded answers from this topic's data."}</p>
            ${statusLine}
            <button class="btn btn-primary icon-btn" id="btn-chat-add-key" style="margin-top:14px"><i data-lucide="key-round"></i> ${configured.length ? 'Pick default' : 'Add a key'}</button>
          </div>`;
    } else {
      chatMainHtml = `
          <div class="chat-presets-pill">
            ${PRESETS.map(p => `
              <button class="chat-preset-pill chat-preset" data-mode="${p.mode}" title="${esc(p.desc)}">
                <i data-lucide="${p.icon}"></i>${esc(p.label)}
              </button>`).join('')}
          </div>
          ${findingsCount === 0 ? `
            <div class="map-enrich-banner info" id="chat-no-findings-hint" style="margin:6px 0 0">
              <span>💡 Chat is using <b>${postCount.toLocaleString()}</b> indexed posts via palace (ChromaDB + MiniLM ONNX). Answers will be sharper after extraction adds painpoints / features.</span>
              <button class="btn btn-ghost btn-sm btn-bordered map-banner-btn" id="btn-chat-enrich-soft" type="button">Enrich now</button>
            </div>` : ''}
          <div class="chat-status" id="chat-status">
            <span class="chat-status-dot"></span>
            <span id="chat-status-text">Ready — ask a question.</span>
          </div>

          <div class="chat-messages" id="chat-messages"></div>

          <div class="chat-input-row">
            <div class="chat-composer">
              <textarea id="chat-input" rows="2" placeholder='Ask about user pain, trends, gaps, evidence, or "what should we build next?"'></textarea>
              <div class="chat-composer-foot">
                <span class="chat-composer-hint">Enter to send · Shift+Enter for newline</span>
                <div class="chat-composer-actions">
                  <button class="btn btn-primary btn-sm icon-btn" id="btn-chat-send"><i data-lucide="send-horizontal"></i> Send</button>
                  <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-chat-cancel" hidden><i data-lucide="square"></i> Stop</button>
                </div>
              </div>
            </div>
          </div>`;
    }

    const railHtml = anyReady ? `
      <aside class="chat-conv-rail">
        <div class="chat-conv-rail-head">
          <span>Chats</span>
          <button class="btn btn-primary btn-sm icon-btn" id="btn-chat-new" title="Start a new chat (current one stays saved)"><i data-lucide="plus"></i> New</button>
        </div>
        <div class="chat-conv-list" id="chat-conv-list"><div class="muted" style="font-size:11px;padding:10px">Loading…</div></div>
      </aside>` : '';

    set(`
      <div class="chat-layout${anyReady ? '' : ' no-rail'}">
        ${railHtml}
        <div class="chat-main-col">
          <div class="chat-wrap">
            <div class="chat-head">
              <div class="chat-head-main">
                <h3 style="margin:0 0 2px">Topic AI Chat</h3>
                <p class="chat-head-sub">
                  ${anyReady
                    ? `Provider: <b>${esc(providerLabel)}</b> · Model: <b>${esc(modelLabel)}</b>`
                    : '<span style="color:#B84747">No LLM key configured yet.</span>'}
                </p>
              </div>
              <div class="chat-head-actions">
                <label class="mode-toggle" title="Agent mode — LLM can call tools to explore the database (Anthropic only)">
                  <input type="checkbox" id="chat-agent" ${agentDefault ? 'checked' : ''} />
                  <span><i data-lucide="bot"></i> myind AI Agent</span>
                </label>
                <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-chat-fetch-papers" title="Search arXiv · PubMed · OpenAlex · Semantic Scholar · Crossref · Scholar for new papers on this topic and add them to the corpus. Works in Ask mode too."><i data-lucide="book-plus"></i> Fetch papers</button>
                <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-chat-keys"><i data-lucide="key-round"></i> Keys</button>
                <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-chat-export" title="Download the conversation as markdown"><i data-lucide="download"></i> Export</button>
                <button class="btn btn-ghost btn-sm btn-bordered" id="btn-chat-clear" title="Delete the current chat and start fresh">Clear</button>
              </div>
            </div>

            ${chatMainHtml}
          </div>
        </div>
      </div>
    `);

    // Header actions always available
    $('#btn-chat-keys')?.addEventListener('click', () => openByokModal(() => loadChat()));
    $('#btn-chat-new')?.addEventListener('click', () => newConversation(topic));
    $('#btn-chat-clear')?.addEventListener('click', async () => {
      // "Clear" deletes the current thread (others stay saved) and starts fresh.
      const id = chatActiveConv.get(topic);
      if (id) { try { await api.chatConvDelete(id); } catch {} }
      newConversation(topic);
    });
    if (anyReady) refreshConvRail(topic);
    $('#btn-chat-add-key')?.addEventListener('click', () => openByokModal(() => loadChat()));
    // Soft "Enrich now" inside the no-findings hint chip. Fires
    // build+enrich in the background, replaces the hint with a status
    // line, and reloads chat once findings land so the prompt picks
    // them up. Non-blocking — chat keeps working via palace meanwhile.
    $('#btn-chat-enrich-soft')?.addEventListener('click', async () => {
      const hint = $('#chat-no-findings-hint');
      const btn = $('#btn-chat-enrich-soft');
      if (btn) { btn.disabled = true; btn.textContent = 'Enriching…'; }
      try {
        await api.buildGraph(topic).catch(() => {});
        const e = await api.enrichGraph(topic);
        recordEnrichResult(topic, e, e?.ok === false ? (e?.error || 'unknown') : null);
        if (hint) hint.remove();
        loadChat();
      } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Enrich now'; }
        showToast('Enrich failed', err?.message || String(err), 'err');
      }
    });
    $('#chat-agent')?.addEventListener('change', (e) => {
      localStorage.setItem('gapmap.chat.agent', e.target.checked ? 'true' : 'false');
    });

    // "Fetch papers" — one-click corpus enlargement that works in plain Ask
    // mode (no Agent toggle needed). Runs the multi-source paper pipeline
    // (search → store → fulltext → analyze) for this topic, scoped to the
    // composer text / last question when present, then reloads chat so the
    // next answer is grounded on the freshly-pulled papers.
    $('#btn-chat-fetch-papers')?.addEventListener('click', async () => {
      const btn = $('#btn-chat-fetch-papers');
      const st = $('#chat-status-text');
      if (btn?.dataset.busy === '1') return;
      // Query: prefer what's typed, else the most recent user question, else topic.
      let q = ($('#chat-input')?.value || '').trim();
      if (!q) {
        const hist = chatHistory.get(topic) || [];
        for (let i = hist.length - 1; i >= 0; i--) {
          if (hist[i]?.role === 'user' && (hist[i].text || '').trim()) { q = hist[i].text.trim(); break; }
        }
      }
      const origHtml = btn ? btn.innerHTML : '';
      if (btn) { btn.dataset.busy = '1'; btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Fetching…'; }
      window.refreshIcons?.();
      const prevStatus = st ? st.textContent : '';
      if (st) st.textContent = '📚 Searching arXiv · PubMed · OpenAlex · Semantic Scholar · Crossref · Scholar…';
      try {
        const res = await api.paperResearchPipeline(topic, q || null, { limitPerSource: 5, maxFulltext: 3 });
        const n = Number(res?.search_total || 0);
        const analyzed = Number(res?.analyzed || 0);
        if (res?.ok === false) {
          showToast('Fetch papers failed', res?.error || 'Pipeline returned an error.', 'err');
          if (st) st.textContent = '✗ Fetch failed — see toast.';
        } else if (n === 0) {
          showToast('No new papers', 'The academic sources returned nothing for this query. Try a more specific question in the composer, then Fetch papers again.', 'warn');
          if (st) st.textContent = prevStatus || 'Ready — ask a question.';
        } else {
          showToast('Papers added', `Pulled ${n} paper${n === 1 ? '' : 's'} into the corpus${analyzed ? ` · analyzed ${analyzed}` : ''}. Your next answer will use them.`, 'ok');
          if (st) st.textContent = `✓ Added ${n} paper${n === 1 ? '' : 's'} — ask away, answers now include them.`;
          // Reload chat so corpus-size + palace counts refresh; history is preserved.
          loadChat();
        }
      } catch (e) {
        showToast('Fetch papers failed', e?.message || String(e), 'err');
        if (st) st.textContent = '✗ Fetch failed — see toast.';
      } finally {
        if (btn) { btn.dataset.busy = ''; btn.disabled = false; btn.innerHTML = origHtml; }
        window.refreshIcons?.();
      }
    });

    if (!anyReady) return;

    // Render any prior messages for this topic.
    // ISOLATED: a throw in message rendering (bad history data, a markdown
    // edge case, a missing helper) must NEVER abort the composer wiring below
    // — otherwise Send/Enter silently do nothing and chat looks "broken" with
    // no clue why. The global error overlay (main.js) surfaces the actual
    // cause; this guard keeps the input usable regardless.
    try {
      renderMessages();
    } catch (e) {
      console.error('[chat] renderMessages failed (composer still wired):', e);
    }

    // Wire input
    const input = $('#chat-input');
    const sendBtn = $('#btn-chat-send');
    const cancelBtn = $('#btn-chat-cancel');
    const presetBtns = contentEl.querySelectorAll('.chat-preset');
    const chatWrap = contentEl.querySelector('.chat-wrap');
    const statusText = $('#chat-status-text');

    // Defined at renderTopic-scope (see `setBusyUi` declaration outside
    // loadChat) so the sibling-scope `send()` can also drive busy-state.
    // The wrapper here forwards to that shared implementation, captured
    // here only so the local `loadChat` callsites still read naturally.
    // (Previously `setBusyUi` was a const inside loadChat; `send()` is
    // declared at renderTopic-scope and got `ReferenceError: Can't find
    // variable: setBusyUi` the moment chat actually streamed.)
    /* setBusyUi is declared at renderTopic scope — see below. */

    const sendFromInput = () => {
      const q = input.value.trim();
      if (!q || chatStream.active) return;
      input.value = '';
      autoGrow();
      send('ask', q);
    };
    sendBtn.onclick = sendFromInput;

    // Auto-grow textarea — resize as the user types, max 180px (CSS-enforced).
    const autoGrow = () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 180) + 'px';
    };
    input.addEventListener('input', autoGrow);
    autoGrow();

    input.addEventListener('keydown', e => {
      if (e.isComposing) return;
      // Enter = send, Shift+Enter = newline. Cmd/Ctrl+Enter still works.
      if ((e.key === 'Enter' || e.code === 'NumpadEnter') && !e.shiftKey) {
        e.preventDefault();
        sendFromInput();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'Enter' || e.code === 'NumpadEnter')) {
        e.preventDefault();
        sendFromInput();
      }
    });
    cancelBtn.onclick = async () => {
      if (statusText) statusText.textContent = 'Stopping generation…';
      try { await api.cancelChat(); } catch {}
      // Belt-and-braces: SIGTERM should kill the Python child, the exit
      // waiter in cli.rs should emit chat:done, and the JS listener
      // should clear busy state. If any of those steps stalls (already
      // observed when Python is blocked on a hung HTTPS read to a flaky
      // provider — SIGTERM gets queued behind the syscall), the UI sits
      // on "Stopping generation…" forever. After 4 s, force-clear:
      // unlisten, mark inactive, flip busy off. The Python process may
      // still die a second later, but the UI is no longer hostage.
      setTimeout(() => {
        if (chatStream.active) {
          try { chatStream.unlistenProgress?.(); } catch {}
          try { chatStream.unlistenDone?.(); } catch {}
          chatStream.unlistenProgress = null;
          chatStream.unlistenDone = null;
          chatStream.active = false;
          setBusyUi(false, 'Stopped. (Sidecar may take a moment to release.)');
        }
      }, 4000);
    };
    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (chatStream.active) return;
        send(btn.dataset.mode, '');
      });
    });

    // Export conversation as markdown — one-click download of the whole thread
    // including source-aware citations the LLM produced.
    $('#btn-chat-export')?.addEventListener('click', () => {
      const hist = chatHistory.get(topic) || [];
      if (!hist.length) {
        showToast('Nothing to export', 'Start a conversation first.', 'warn');
        return;
      }
      const md = [
        `# Gap Map chat — ${topic}`,
        `Exported: ${new Date().toISOString()}`,
        '',
      ];
      for (const m of hist) {
        const ts = m.ts ? new Date(m.ts).toISOString() : '';
        if (m.role === 'user') {
          md.push(`## User · ${m.mode || 'ask'}${ts ? ` · ${ts}` : ''}`);
          if (m.text) md.push(m.text);
          md.push('');
        } else {
          md.push(`## myind AI${ts ? ` · ${ts}` : ''}`);
          if (m.toolCalls && m.toolCalls.length) {
            md.push('<details><summary>Tool calls</summary>\n');
            for (const tc of m.toolCalls) {
              md.push(`- **${tc.name}** \`${JSON.stringify(tc.input || {}).slice(0, 200)}\``);
            }
            md.push('\n</details>\n');
          }
          md.push(m.text || '_(empty reply)_');
          md.push('');
        }
      }
      const blob = new Blob([md.join('\n')], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const slug = (topic || 'gap-map').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      a.download = `gapmap-chat-${slug}-${Date.now()}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Exported', `${hist.length} messages saved as ${a.download}`, 'ok');
    });

    // Live-refresh relative timestamps every 30s while the Chat tab is active.
    if (chatTsInterval) clearInterval(chatTsInterval);
    chatTsInterval = setInterval(() => {
      const box = $('#chat-messages');
      if (!box) { clearInterval(chatTsInterval); chatTsInterval = null; return; }
      box.querySelectorAll('.chat-msg-ts[data-ts]').forEach(el => {
        const ts = parseInt(el.dataset.ts, 10);
        if (Number.isFinite(ts)) el.textContent = timeAgo(ts);
      });
    }, 30000);

    // Viewport-fit the chat panel so the PAGE never scrolls — only the
    // message list does. We set the layout's height to exactly the distance
    // from its top to the viewport bottom (minus a small gap). CSS has a
    // calc() fallback, but measuring is exact regardless of how tall the
    // topbar/tab-strip wrapped. Re-measure on window resize; the handler
    // self-removes once the chat layout is gone (tab switch / navigation).
    const fitChatHeight = () => {
      const layout = contentEl.querySelector('.chat-layout');
      if (!layout || !layout.isConnected || contentEl.dataset.tab !== 'chat') {
        window.removeEventListener('resize', fitChatHeight);
        if (contentEl._chatFit === fitChatHeight) contentEl._chatFit = null;
        return;
      }
      const top = layout.getBoundingClientRect().top;
      const avail = Math.max(360, Math.round(window.innerHeight - top - 16));
      layout.style.setProperty('--chat-h', avail + 'px');
    };
    // Replace any prior listener from an earlier loadChat render.
    if (contentEl._chatFit) window.removeEventListener('resize', contentEl._chatFit);
    contentEl._chatFit = fitChatHeight;
    window.addEventListener('resize', fitChatHeight);
    fitChatHeight();
    // Re-measure on the next frame too — fonts/icons can shift the top a hair.
    requestAnimationFrame(fitChatHeight);
  }

  // ── Conversation rail (ChatGPT-style saved threads) ──────────────────
  async function refreshConvRail(topic) {
    const listEl = $('#chat-conv-list');
    if (!listEl) return;
    let list = [];
    try { list = (await api.chatConvList(topic)) || []; } catch {}
    const activeId = chatActiveConv.get(topic);
    const pending = pendingNewConv.has(topic);

    // Empty state — only when there are no saved chats AND no draft.
    if (!list.length && !pending) {
      listEl.innerHTML = `
        <div class="chat-conv-empty">
          <i data-lucide="messages-square"></i>
          <p>No saved chats yet</p>
          <span>Hit <b>+ New</b> or ask a question — every thread is saved here.</span>
        </div>`;
      window.refreshIcons?.();
      return;
    }

    // Draft "New chat" row — shown the instant + New is clicked, before any
    // message is sent. Pinned to the top and marked active.
    const draftRow = pending ? `
      <div class="chat-conv-item is-draft active" data-pending="1" title="New chat (draft)">
        <i data-lucide="pencil-line" class="chat-conv-ic"></i>
        <span class="chat-conv-body">
          <span class="chat-conv-title">New chat</span>
          <span class="chat-conv-sub">Draft · type below to begin</span>
        </span>
      </div>` : '';

    const savedRows = list.map(c => {
      const isActive = !pending && c.id === activeId;
      const n = c.msg_count || 0;
      const when = c.updated_at ? timeAgo(c.updated_at) : '';
      const sub = [n ? `${n} msg${n === 1 ? '' : 's'}` : '', when].filter(Boolean).join(' · ');
      return `
      <div class="chat-conv-item${isActive ? ' active' : ''}" data-conv="${esc(c.id)}" title="${esc(c.title || 'Untitled')}">
        <i data-lucide="message-square" class="chat-conv-ic"></i>
        <span class="chat-conv-body">
          <span class="chat-conv-title">${esc(c.title || 'Untitled')}</span>
          <span class="chat-conv-sub">${esc(sub || 'No messages yet')}</span>
        </span>
        <button class="chat-conv-del" data-conv="${esc(c.id)}" title="Delete chat"><i data-lucide="trash-2"></i></button>
      </div>`;
    }).join('');

    listEl.innerHTML = draftRow + savedRows;
    window.refreshIcons?.();
    listEl.querySelectorAll('.chat-conv-item[data-conv]').forEach(it => {
      it.addEventListener('click', (e) => {
        if (e.target.closest('.chat-conv-del')) return;
        const id = it.dataset.conv;
        if (id && id !== chatActiveConv.get(topic)) selectConversation(topic, id);
      });
      it.addEventListener('dblclick', (e) => {
        if (e.target.closest('.chat-conv-del')) return;
        renameConversation(topic, it.dataset.conv);
      });
    });
    listEl.querySelectorAll('.chat-conv-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteConversation(topic, btn.dataset.conv);
      });
    });
  }

  async function selectConversation(topic, id) {
    if (chatStream.active) { showToast('Busy', 'Wait for the current reply to finish.', 'warn'); return; }
    pendingNewConv.delete(topic);
    chatActiveConv.set(topic, id);
    try { localStorage.setItem(CHAT_ACTIVE_KEY(topic), id); } catch {}
    let conv = null;
    try { conv = await api.chatConvGet(id); } catch {}
    chatHistory.set(topic, (conv && Array.isArray(conv.messages)) ? conv.messages : []);
    renderMessages();
    refreshConvRail(topic);
  }

  function newConversation(topic) {
    if (chatStream.active) { showToast('Busy', 'Wait for the current reply to finish.', 'warn'); return; }
    chatActiveConv.delete(topic);
    try { localStorage.removeItem(CHAT_ACTIVE_KEY(topic)); } catch {}
    chatHistory.set(topic, []);
    // Show an active "New chat" row in the rail right away (it becomes a real
    // saved row the moment the first message is sent). Without this, clicking
    // New just blanks the panel with no list feedback.
    pendingNewConv.add(topic);
    renderMessages();
    refreshConvRail(topic);
    $('#chat-input')?.focus();
  }

  async function renameConversation(topic, id) {
    if (!id) return;
    const item = $(`.chat-conv-item[data-conv="${(window.CSS && CSS.escape) ? CSS.escape(id) : id}"]`);
    const cur = item?.querySelector('.chat-conv-title')?.textContent || '';
    const next = (window.prompt('Rename chat', cur) || '').trim();
    if (!next || next === cur) return;
    chatConvTitleOverride.set(id, next);
    try { await api.chatConvRename(id, next); } catch {}
    refreshConvRail(topic);
  }

  async function deleteConversation(topic, id) {
    if (!id) return;
    if (!window.confirm('Delete this chat? This cannot be undone.')) return;
    try { await api.chatConvDelete(id); } catch {}
    if (chatActiveConv.get(topic) === id) {
      chatActiveConv.delete(topic);
      try { localStorage.removeItem(CHAT_ACTIVE_KEY(topic)); } catch {}
      const list = await api.chatConvList(topic).catch(() => []);
      if (list && list[0]) { await selectConversation(topic, list[0].id); }
      else { chatHistory.set(topic, []); renderMessages(); refreshConvRail(topic); }
    } else {
      refreshConvRail(topic);
    }
  }

  function renderMessages() {
    const box = $('#chat-messages');
    if (!box) return;
    const hist = loadChatHistory(topic);
    if (!hist.length) {
      box.innerHTML = `<div class="empty-state" style="padding:28px">Try a preset above, or type a question below.</div>`;
      return;
    }
    box.innerHTML = hist.map((m, i) => chatBubble(m, i)).join('');
    box.scrollTop = box.scrollHeight;
    window.refreshIcons?.();
    wireChatMessageActions(box);
  }

  // Per-message hover actions: copy assistant reply, regenerate last.
  function wireChatMessageActions(box) {
    box.querySelectorAll('.chat-msg-action').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const bubble = btn.closest('.chat-msg');
        const idx = parseInt(bubble?.dataset?.idx || '-1', 10);
        const hist = chatHistory.get(topic) || [];
        const msg = hist[idx];
        if (!msg) return;
        const action = btn.dataset.action;
        if (action === 'copy') {
          try {
            await navigator.clipboard.writeText(msg.text || '');
            btn.classList.add('copied');
            const orig = btn.innerHTML;
            btn.innerHTML = '<i data-lucide="check"></i>';
            window.refreshIcons?.();
            setTimeout(() => {
              btn.classList.remove('copied');
              btn.innerHTML = orig;
              window.refreshIcons?.();
            }, 1400);
          } catch (err) {
            showToast('Copy failed', err?.message || String(err), 'err');
          }
        } else if (action === 'regen') {
          // Find the preceding user message and re-run it.
          let userMsg = null;
          for (let i = idx - 1; i >= 0; i--) {
            if (hist[i]?.role === 'user') { userMsg = hist[i]; break; }
          }
          if (!userMsg) {
            showToast('Nothing to regenerate', 'Could not find the preceding question.', 'warn');
            return;
          }
          // Drop the current assistant message so send() appends a fresh one.
          hist.splice(idx, 1);
          saveChatHistory(topic);
          const mode = (userMsg.mode || 'ask').replace(/^agent · /, '');
          await send(mode, userMsg.text || '');
        }
      };
    });
  }

  function chatBubble(m, index) {
    const tsAttr = m.ts ? `data-ts="${m.ts}"` : '';
    const tsHtml = m.ts ? `<div class="chat-msg-ts" ${tsAttr}>${timeAgo(m.ts)}</div>` : '';
    if (m.role === 'user') {
      return `<div class="chat-msg chat-msg-user" data-idx="${index}">
        <div class="chat-msg-ic" title="User"><i data-lucide="user-round"></i></div>
        <div class="chat-msg-body"><b>${esc(m.mode || 'ask')}</b>${m.text ? `<div class="chat-msg-text">${esc(m.text)}</div>` : ''}${tsHtml}</div>
      </div>`;
    }
    const isStreaming = chatStream.active && index === (chatHistory.get(topic) || []).length - 1;
    // Per-assistant actions: copy the reply + regenerate (only on the last one + not while streaming).
    const isLast = index === (chatHistory.get(topic) || []).length - 1;
    const actions = `
      <div class="chat-msg-actions">
        <button class="chat-msg-action" data-action="copy" title="Copy reply"><i data-lucide="copy"></i></button>
        ${isLast && !isStreaming ? '<button class="chat-msg-action" data-action="regen" title="Re-ask the last question"><i data-lucide="refresh-cw"></i></button>' : ''}
      </div>`;
    return `<div class="chat-msg chat-msg-asst" data-idx="${index}">
      ${actions}
      <div class="chat-msg-ic" title="myind AI"><i data-lucide="bot"></i></div>
      <div class="chat-msg-body markdown-view">${assistantInnerHtml(m, isStreaming)}${tsHtml}</div>
    </div>`;
  }

  async function send(mode, question) {
    const agent = document.getElementById('chat-agent')?.checked || false;
    const hist = loadChatHistory(topic);
    const now = Date.now();
    // A message is being sent — this is now a real conversation, so drop the
    // "New chat" placeholder; persistActiveConv mints the saved row.
    pendingNewConv.delete(topic);
    hist.push({ role: 'user', mode: agent ? `agent · ${mode}` : mode, text: question, ts: now });
    hist.push({ role: 'assistant', mode, text: '', toolCalls: [], ts: now });
    chatHistory.set(topic, hist);
    renderMessages();
    // Persist (mints the conversation id on first message) then surface it in
    // the rail. Await so the rail query sees the freshly-written row.
    persistActiveConv(topic).then(() => refreshConvRail(topic));

    // UI state
    const sendBtn = $('#btn-chat-send');
    const cancelBtn = $('#btn-chat-cancel');
    setBusyUi(true, 'myind AI is thinking… grounding answer on your topic data.');

    chatStream.active = true;
    chatStream.buffer = '';

    // Fail-safe timers. Without these, a hung Python LLM call (NVIDIA
    // socket stalls, ollama runner crashed mid-load, etc.) leaves the
    // UI stuck on "Working…" forever. Two thresholds:
    //   * `firstTokenTimer` (60 s): no progress event at all → assume the
    //     sidecar wedged before printing anything; surface a hint and
    //     keep the spinner so the user can click Stop without losing it.
    //   * `hardTimer` (5 min): no `chat:done` after a long run → force-
    //     clear busy state and mark the assistant turn as timed out so
    //     the user can retry. We still leave the Python process to
    //     either finish or be killed by Stop — the UI just stops
    //     blocking.
    let sawProgress = false;
    let firstTokenTimer = setTimeout(() => {
      if (!sawProgress && chatStream.active) {
        const st = $('#chat-status-text');
        if (st) st.textContent = '⚠ No reply yet — Python sidecar may be hung. Click Stop to abort.';
      }
    }, 60000);
    let hardTimer = setTimeout(() => {
      if (chatStream.active) {
        const h = chatHistory.get(topic) || [];
        const last = h[h.length - 1];
        if (last && last.role === 'assistant' && !(last.text || '').trim()) {
          last.text = '✗ Timed out after 5 min with no response. Provider may be unreachable — try Stop, then check the LLM provider in Settings.';
          saveChatHistory(topic);
        }
        renderMessages();
        try { chatStream.unlistenProgress?.(); } catch {}
        try { chatStream.unlistenDone?.(); } catch {}
        chatStream.unlistenProgress = null;
        chatStream.unlistenDone = null;
        chatStream.active = false;
        setBusyUi(false, '✗ Timed out — see message above.');
      }
    }, 300000);

    const finishStream = (msg) => {
      try { chatStream.unlistenProgress?.(); } catch {}
      try { chatStream.unlistenDone?.(); } catch {}
      chatStream.unlistenProgress = null;
      chatStream.unlistenDone = null;
      chatStream.active = false;
      clearTimeout(firstTokenTimer);
      clearTimeout(hardTimer);
      setBusyUi(false, msg);
    };

    // Subscribe to events BEFORE starting
    chatStream.unlistenProgress = await api.onChatProgress(line => {
      sawProgress = true;
      handleChatLine(line);
    });
    chatStream.unlistenDone = await api.onChatDone(async (payload) => {
      // Distinguish clean exit vs error code so the status line is
      // honest. payload shape: { code: number } where 0 = success.
      const code = (payload && typeof payload === 'object' && 'code' in payload) ? Number(payload.code) : 0;
      const h = chatHistory.get(topic) || [];
      const last = h[h.length - 1];
      const hasContent = !!(last && last.role === 'assistant' && (last.text || '').trim());
      if (code !== 0 && !hasContent) {
        if (last && last.role === 'assistant') last.text = `✗ Provider exited with code ${code}. Check the LLM key/model in Settings.`;
        renderMessages();
        finishStream('✗ Provider error — see message above.');
      } else {
        finishStream(code === 0 ? 'Done — response ready.' : '⚠ Provider exited early; partial response shown.');
      }
      // Persist the completed turn durably, then refresh the rail so the
      // conversation's title (first message) + ordering reflect the result.
      persistActiveConv(topic).then(() => refreshConvRail(topic));
    });

    try {
      await api.startChat(topic, question, mode, agent);
    } catch (e) {
      const h = chatHistory.get(topic) || [];
      const last = h[h.length - 1];
      if (last && last.role === 'assistant') last.text = `✗ Failed to start chat: ${e?.message || e}`;
      renderMessages();
      finishStream('Failed to start. Check keys/provider and retry.');
    }
  }

  // Throttle durable conversation writes to SQLite during a stream —
  // without this, a navigation-away or app-reload mid-response would lose
  // every token that hadn't yet reached `chat:done`. 2s cadence; each
  // write is a single upsert of the active conversation's message array.
  let _chatSaveTimer = null;
  const scheduleChatSave = () => {
    if (_chatSaveTimer) return;
    _chatSaveTimer = setTimeout(() => {
      _chatSaveTimer = null;
      saveChatHistory(topic);
    }, 2000);
  };

  function handleChatLine(line) {
    // CLI with --json emits one JSON event per line.
    //   RAG mode:   {event: 'start'|'token'|'done'|'error', ...}
    //   Agent mode: {event: 'start'|'text'|'tool_call'|'tool_result'|'done'|'error', ...}
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    const hist = chatHistory.get(topic) || [];
    const last = hist[hist.length - 1];
    if (!last || last.role !== 'assistant') return;

    if (ev.event === 'token' || ev.event === 'text') {
      const t = ev.text || '';
      if (typeof t !== 'string') return;
      last.text = (last.text || '') + t;
      renderAssistantInPlace(last);
      scheduleChatSave();
    } else if (ev.event === 'tool_call') {
      if (statusText) statusText.textContent = `myind AI is using ${ev.name || 'a tool'}…`;
      last.toolCalls = last.toolCalls || [];
      last.toolCalls.push({ id: ev.id, name: ev.name, input: ev.input, output: null });
      renderAssistantInPlace(last);
    } else if (ev.event === 'tool_result') {
      if (statusText) statusText.textContent = 'myind AI is analyzing tool results…';
      const tc = (last.toolCalls || []).find(x => x.id === ev.id);
      if (tc) tc.output = ev.output;
      renderAssistantInPlace(last);
    } else if (ev.event === 'error') {
      // Append the error text to the assistant turn AND release the
      // busy UI immediately. Python may still emit a `done` event a
      // moment later — the `chatStream.active` guard in finishStream
      // (set false here) makes that done a no-op.
      const st = contentEl.querySelector('#chat-status-text');
      if (st) st.textContent = '✗ Error while generating response.';
      last.text = (last.text || '') + `\n\n✗ Error: ${ev.error || 'unknown'}`;
      renderMessages();
      try { chatStream.unlistenProgress?.(); } catch {}
      try { chatStream.unlistenDone?.(); } catch {}
      chatStream.unlistenProgress = null;
      chatStream.unlistenDone = null;
      chatStream.active = false;
      setBusyUi(false, '✗ Error — see message above.');
    }
  }

  function renderAssistantInPlace(last) {
    const box = $('#chat-messages');
    if (!box) return;
    const bubbles = box.querySelectorAll('.chat-msg');
    const target = bubbles[bubbles.length - 1];
    if (!target) return;
    const bodyEl = target.querySelector('.chat-msg-body');
    const tsHtml = last.ts
      ? `<div class="chat-msg-ts" data-ts="${last.ts}">${timeAgo(last.ts)}</div>`
      : '';
    bodyEl.innerHTML = assistantInnerHtml(last, chatStream.active) + tsHtml;
    // The assistant bubble is now a capped-height scroll box — keep it pinned
    // to the newest tokens while streaming, then pin the panel too.
    if (chatStream.active) bodyEl.scrollTop = bodyEl.scrollHeight;
    box.scrollTop = box.scrollHeight;
    window.refreshIcons?.();
  }

  function assistantInnerHtml(m, isStreaming = false) {
    let html = '';
    if (m.toolCalls && m.toolCalls.length) {
      html += '<div class="tool-calls">';
      m.toolCalls.forEach(tc => {
        const inputPreview = esc(JSON.stringify(tc.input || {}).slice(0, 120));
        const resolved = tc.output != null;
        const outPreview = resolved
          ? esc(JSON.stringify(tc.output).slice(0, 180))
          : '<span class="chat-typing-dots"><span></span><span></span><span></span></span>';
        html += `
          <details class="tool-call ${resolved ? 'done' : 'pending'}">
            <summary>
              <span class="tc-badge">⚙</span>
              <b>${esc(tc.name)}</b>
              <code class="tc-input">${inputPreview}</code>
              <span class="tc-state">${resolved ? '✓' : '…'}</span>
            </summary>
            <pre class="tc-output">${typeof outPreview === 'string' ? outPreview : ''}</pre>
          </details>`;
      });
      html += '</div>';
    }
    const rendered = renderMarkdown(m.text || '');
    if (rendered) {
      html += rendered;
    } else if (isStreaming) {
      // Animated 3-dot indicator instead of a plain "thinking…" word.
      html += '<div class="chat-typing-dots" aria-label="assistant is typing"><span></span><span></span><span></span></div>';
    }
    return html;
  }

  // ─── Actions ──────────────────────────────────────────────────────────
  function loadActions() {
    const autoOn = isAutoRunEnabled();
    contentEl.innerHTML = `
      <div class="settings-card run-all-card" style="margin-bottom:14px;border:1px solid var(--accent, #4B6FE4);background:linear-gradient(180deg,#F6F9FF,#FFF)">
        <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:280px">
            <h4 style="margin:0 0 4px"><i data-lucide="sparkles"></i> Run all analyses</h4>
            <p style="margin:0;color:var(--ink-3);font-size:13px">
              One click to populate every tab: builds the graph, enriches painpoints,
              synthesizes insights, generates solutions + concepts, computes trends +
              sentiment, and renders the final report.
              <span class="muted">Takes 3-8 minutes on a typical topic. Each step is logged separately.</span>
            </p>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;min-width:180px">
            <button class="btn btn-primary icon-btn" id="btn-run-all"><i data-lucide="play"></i> Run all</button>
            <label class="compact-toggle" style="font-size:12px;color:var(--ink-3)">
              <input type="checkbox" id="cb-autorun" ${autoOn ? 'checked' : ''}/>
              <span>Auto-run pipelines when a tab is opened with no data</span>
            </label>
          </div>
        </div>
        <div id="run-all-status" class="muted" style="margin-top:10px;font-size:12.5px;min-height:16px"></div>
        <ol id="run-all-steps" class="run-all-steps" style="margin:10px 0 0;padding-left:20px;font-size:12.5px;color:var(--ink-2);display:none"></ol>
      </div>
      <div class="settings-grid">
        <div class="settings-card">
          <h4>Re-run collect</h4>
          <p>Pull fresh data. Existing posts are kept (deduped).</p>
          <button class="btn btn-primary btn-sm" data-route="collect">Re-run</button>
        </div>
        <div class="settings-card">
          <h4>Ingest local file</h4>
          <p>Drop your interview CSV, Slack export, or call transcript into this topic.</p>
          <button class="btn btn-primary btn-sm" data-route="ingest">Open ingest</button>
        </div>
        <div class="settings-card">
          <h4>Ingest a video</h4>
          <p>Paste any YouTube / Vimeo / podcast URL — audio stays local, Whisper transcribes on-device, chunks land in this topic's corpus.</p>
          <button class="btn btn-primary btn-sm icon-btn" data-route="ingest-video"><i data-lucide="video"></i> Paste video URL</button>
        </div>
        <div class="settings-card">
          <h4>Export artifacts</h4>
          <p>Generate shareable HTML + citation-rich markdown.</p>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn btn-primary btn-sm" id="btn-export-html">Export HTML</button>
            <button class="btn btn-ghost btn-sm btn-bordered" id="btn-export-md">Export report.md</button>
            <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-export-graph-json"><i data-lucide="braces"></i> Export graph JSON</button>
          </div>
          <div id="export-status" style="margin-top:10px;font-size:12px;color:var(--ink-3)"></div>
        </div>
        <div class="settings-card" style="border-color:var(--rose)">
          <h4 style="color:#B84747">Danger zone</h4>
          <p>Delete this topic's tags and graph. Underlying posts in SQLite are kept (may be reused by other topics).</p>
          <button class="btn btn-danger btn-sm" id="btn-delete-topic">Delete topic</button>
        </div>
      </div>
    `;
    const quickHtml = `
      <div class="settings-card" style="margin-top:14px">
        <h4><i data-lucide="zap"></i> Quick tools</h4>
        <p class="muted" style="font-size:12px;margin-bottom:10px">
          Preview-only LLM extraction without building the full graph. Use this to sniff-test LLM output before committing to a full <b>Build &amp; enrich</b>.
        </p>
        <button class="btn btn-primary btn-sm icon-btn" id="btn-quick-extract">
          <i data-lucide="zap"></i> Quick extract gaps
        </button>
        <div id="quick-extract-status" class="muted" style="margin-top:8px;font-size:12px"></div>
        <div id="quick-extract-panel" class="quick-extract-panel" hidden></div>
      </div>
    `;
    contentEl.querySelector('.settings-grid').insertAdjacentHTML('afterend', quickHtml);
    contentEl.querySelector('[data-route="collect"]').onclick = () => { location.hash = `#/collect/${encodeURIComponent(topic)}`; };
    contentEl.querySelector('[data-route="ingest"]').onclick  = () => { location.hash = '#/ingest'; };
    contentEl.querySelector('[data-route="ingest-video"]').onclick = () => {
      // Pre-select the current topic so the video screen lands with topic filled.
      location.hash = `#/ingest-video?topic=${encodeURIComponent(topic)}`;
    };
    $('#btn-export-html').onclick = async () => {
      $('#export-status').textContent = 'exporting HTML…';
      try { const p = await api.exportHtml(topic); $('#export-status').innerHTML = `✓ ${esc(p)}`; }
      catch (e) { $('#export-status').textContent = `✗ ${e?.message || e}`; }
    };
    $('#btn-export-graph-json').onclick = async () => {
      $('#export-status').textContent = 'exporting graph JSON…';
      try { const p = await api.exportGraphJson(topic); $('#export-status').innerHTML = `✓ ${esc(p)}`; }
      catch (e) { $('#export-status').textContent = `✗ ${e?.message || e}`; }
    };
    $('#btn-export-md').onclick = async () => {
      $('#export-status').textContent = 'generating report…';
      try { const p = await api.exportReportPro(topic); $('#export-status').innerHTML = `✓ ${esc(p)}`; }
      catch (e) { $('#export-status').textContent = `✗ ${e?.message || e}`; }
    };
    $('#btn-delete-topic').onclick = async () => {
      const { confirmDestructiveAction } = await import('../lib/deleteConfirm.js');
      const ok = await confirmDestructiveAction({
        title: `Delete topic "${topic}"?`,
        body: 'Soft-deleted — hidden from the dashboard but recoverable for 7 days from Settings → Trash.',
        matchText: topic,
        confirmLabel: 'Delete topic',
        confirmDanger: true,
        hint: `type the topic name to confirm`,
      });
      if (!ok) return;
      try {
        await api.deleteTopic(topic);
        // T1.3: undo toast with 10-second window. Clicking Undo flips the
        // deleted_at back to empty string and the topic reappears.
        const t = document.createElement('div');
        t.className = 'toast toast-success';
        t.style.display = 'flex';
        t.style.alignItems = 'center';
        t.style.gap = '12px';
        t.innerHTML = `🗑 Moved "${esc(topic)}" to trash · recoverable 7 days <button class="btn btn-xs btn-primary" id="undo-del-${CSS.escape(topic)}">Undo</button>`;
        document.body.appendChild(t);
        const undoBtn = t.querySelector(`#undo-del-${CSS.escape(topic)}`);
        let undone = false;
        undoBtn.onclick = async () => {
          undone = true;
          try {
            await api.restoreTopic(topic);
            t.innerHTML = `✓ Restored "${esc(topic)}"`;
            setTimeout(() => t.remove(), 1500);
            location.hash = `#/topic/${encodeURIComponent(topic)}`;
          } catch {
            t.innerHTML = `✗ Restore failed`;
            setTimeout(() => t.remove(), 2000);
          }
        };
        setTimeout(() => { if (!undone) t.remove(); }, 10000);
        if (!undone) location.hash = '#/';
      } catch (e) { showToast('Delete failed', e?.message || String(e), 'err'); }
    };
    $('#btn-quick-extract', contentEl)?.addEventListener('click', async () => {
      const status = $('#quick-extract-status', contentEl);
      const panel  = $('#quick-extract-panel', contentEl);
      status.textContent = 'Extracting… 30-90 seconds.';
      panel.hidden = true;
      try {
        const result = await api.quickExtractGaps(topic);
        status.textContent = '';
        panel.hidden = false;
        panel.innerHTML = renderQuickExtract(result);
        window.refreshIcons?.();
      } catch (e) {
        status.textContent = `Error: ${e?.message || e}`;
      }
    });

    // ─── Run all analyses ────────────────────────────────────────────────
    $('#cb-autorun', contentEl)?.addEventListener('change', (e) => {
      setAutoRunEnabled(!!e.target.checked);
      const status = $('#run-all-status', contentEl);
      if (status) {
        status.textContent = e.target.checked
          ? 'Auto-run enabled — opening an empty tab will trigger its pipeline.'
          : 'Auto-run disabled — tabs show a manual "Run" button instead.';
        setTimeout(() => { if (status) status.textContent = ''; }, 3000);
      }
    });
    $('#btn-run-all', contentEl)?.addEventListener('click', async () => {
      const btn    = $('#btn-run-all', contentEl);
      const status = $('#run-all-status', contentEl);
      const list   = $('#run-all-steps', contentEl);
      if (!btn || !status || !list) return;
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Running…';
      list.style.display = 'block';
      list.innerHTML = '';
      window.refreshIcons?.();
      const startTs = Date.now();
      const onStep = (e) => {
        const key = `run-step-${e.id}`;
        let li = list.querySelector(`[data-k="${key}"]`);
        if (!li) {
          li = document.createElement('li');
          li.dataset.k = key;
          list.appendChild(li);
        }
        const icon = e.status === 'running' ? '⏳'
                   : e.status === 'done'    ? '✓'
                   : e.status === 'error'   ? '✗'
                   : e.status === 'skipped' ? '·'
                   : '•';
        const note = e.error ? ` <span style="color:#B84747">(${esc(String(e.error?.message || e.error).slice(0, 120))})</span>` : '';
        li.innerHTML = `${icon} <b>${esc(e.label)}</b> <span class="muted">step ${e.i + 1} / ${e.total}</span>${note}`;
        status.textContent = e.status === 'running'
          ? `Running ${e.label}… (${e.i + 1} / ${e.total})`
          : status.textContent;
      };
      try {
        const { ran, failed, skipped } = await runAllForTopic(topic, onStep);
        const secs = Math.round((Date.now() - startTs) / 1000);
        const skippedForKey = skipped.length && skipped.some(s => s.error?.code === 'no_llm_key');
        if (skippedForKey) {
          status.innerHTML = `No LLM key — nothing ran. <a href="#/settings">Open Settings → API keys</a> and try again.`;
        } else {
          status.innerHTML = `Done in ${secs}s · ran ${ran.length} · failed ${failed.length}${skipped.length ? ` · skipped ${skipped.length}` : ''}.`;
        }
        // Mark affected tabs dirty so the next switch re-renders fresh data.
        for (const r of ran) dirtyTabs.add(r.id);
        // Nudge the rest of the app that data changed.
        window.dispatchEvent(new CustomEvent('gapmap:changed', {
          detail: { kind: 'findings', topic, ts: Date.now() },
        }));
      } catch (e) {
        status.textContent = `Error: ${e?.message || e}`;
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="play"></i> Run all';
        window.refreshIcons?.();
      }
    });
    window.refreshIcons?.();
  }

  // ─── Search (unified cross-table) ─────────────────────────────────────
  // Single input → normal / aggressive mode → grouped results across
  // posts, graph findings, analyses, papers, hypotheses, feedback.
  // Every run persists to mcp_analyses so downstream pipelines can reuse
  // the query context.
  function loadSearch() {
    contentEl.innerHTML = `
      <div class="settings-card" style="margin-bottom:14px">
        <h4><i data-lucide="search-code"></i> Search everything in this topic</h4>
        <p class="muted" style="margin:4px 0 10px;font-size:12.5px">
          Fans a single query across posts, findings (painpoints/products/workarounds/concepts),
          AI analyses, papers, hypotheses, and feedback. Aggressive mode adds an LLM
          paraphrase pass plus local semantic search. Every run is logged to AI Analyses.
        </p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="search-all-input" type="text"
                 placeholder="e.g. slow upload, forgotten password, pricing confusion"
                 style="flex:1;min-width:260px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px" />
          <label class="compact-toggle" style="font-size:12px;color:var(--ink-3)">
            <input type="checkbox" id="search-all-aggressive" />
            <span>Aggressive (LLM + semantic)</span>
          </label>
          <button class="btn btn-primary icon-btn" id="btn-search-all"><i data-lucide="search"></i> Search</button>
        </div>
        <div id="search-all-status" class="muted" style="margin-top:8px;font-size:12px;min-height:14px"></div>
      </div>
      <div id="search-all-results"></div>
    `;
    window.refreshIcons?.();

    const input = $('#search-all-input', contentEl);
    const aggr  = $('#search-all-aggressive', contentEl);
    const btn   = $('#btn-search-all', contentEl);
    const status = $('#search-all-status', contentEl);
    const out   = $('#search-all-results', contentEl);

    const renderSection = (title, icon, rows, renderRow) => {
      if (!rows || !rows.length) return '';
      return `
        <section class="settings-card" style="margin-bottom:10px">
          <h4 style="margin:0 0 8px"><i data-lucide="${icon}"></i> ${esc(title)} <span class="muted" style="font-weight:normal;font-size:12px">(${rows.length})</span></h4>
          <div>${rows.map(renderRow).join('')}</div>
        </section>`;
    };

    const row = (html) => `<div style="padding:6px 0;border-bottom:1px solid var(--line);font-size:13px">${html}</div>`;

    const run = async () => {
      const query = (input.value || '').trim();
      if (!query) { status.textContent = 'Enter a query first.'; return; }
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2"></i> Searching…';
      status.textContent = aggr.checked ? 'Aggressive mode: expanding query + semantic search…' : 'Searching…';
      out.innerHTML = '';
      window.refreshIcons?.();
      try {
        const r = await api.searchAll(query, { topic, aggressive: aggr.checked });
        if (!r || !r.ok) {
          status.textContent = `Error: ${r?.error || 'unknown'}`;
          return;
        }
        const b = r.buckets || {};
        const exp = (r.expansions || []).length
          ? `<p class="muted" style="margin:0 0 10px;font-size:12px">Expanded to: ${(r.expansions || []).map(e => `<code>${esc(e)}</code>`).join(' · ')}</p>`
          : '';
        const html = exp + [
          renderSection('Posts', 'file-text', b.posts, p => row(
            `<a href="${esc(postLink(p) || '#')}" target="_blank" rel="noopener"><b>${esc(p.title || '(untitled)')}</b></a>
             <span class="muted"> · ${esc(p.source || 'reddit')} · score ${p.score || 0}</span>
             ${p.excerpt ? `<div class="muted" style="font-size:12px;margin-top:2px">${esc(p.excerpt)}…</div>` : ''}`)),
          renderSection('Findings', 'lightbulb', b.graph_nodes, n => row(
            `<b>${esc(n.label || '')}</b> <span class="muted">· ${esc(n.kind || '')}</span>`)),
          renderSection('Semantic matches', 'brain', b.semantic, m => row(
            `<b>${esc((m.text || '').slice(0, 120))}</b> <span class="muted">· sim ${Number(m.score || 0).toFixed(2)}</span>`)),
          renderSection('AI Analyses', 'sparkles', b.analyses, a => row(
            `<b>${esc(a.kind || '')}</b>/<span class="muted">${esc(a.tool || '')}</span>
             <span class="muted"> · ${esc(a.source || 'app')}</span>
             <div class="muted" style="font-size:12px;margin-top:2px">${esc((a.excerpt || '').slice(0, 300))}…</div>`)),
          renderSection('Paper analyses', 'book-marked', b.paper_analyses, pa => row(
            `<b>${esc((pa.takeaway || '').slice(0, 140))}</b>
             <span class="muted"> · rel ${Number(pa.relevance || 0).toFixed(2)}</span>`)),
          renderSection('Hypotheses', 'target', b.hypotheses, h => row(
            `<b>${esc(h.status || '')}</b> <span class="muted">· ${esc(String(h.card_json || '').slice(0, 180))}…</span>`)),
          renderSection('Flagged feedback', 'thumbs-down', b.feedback, f => row(
            `<b>${esc(f.finding_title || '')}</b> <span class="muted">· ${esc(f.verdict || '')}</span>
             ${f.note ? `<div class="muted" style="font-size:12px">${esc(f.note)}</div>` : ''}`)),
        ].join('');
        out.innerHTML = html || `<div class="empty-state"><p>No matches for <b>${esc(query)}</b>.</p></div>`;
        status.textContent = `Found ${r.counts?.total || 0} matches across ${Object.keys(b).filter(k => (b[k] || []).length).length} tables${r.persisted ? ' · saved to AI Analyses' : ''}.`;
        window.refreshIcons?.();
      } catch (e) {
        status.textContent = `Error: ${e?.message || e}`;
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="search"></i> Search';
        window.refreshIcons?.();
      }
    };
    btn.addEventListener('click', run);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    input.focus();
  }

  // ─── AI Analyses ──────────────────────────────────────────────────────
  // Reads the mcp_analyses table — the unified log of LLM-driven intelligence
  // across MCP tools (source='mcp') and the app's own enrichment pipelines
  // (source='app'). Shows newest first so users see what the client LLM (or
  // the app) concluded on this topic regardless of which tool produced it.
  async function loadAiAnalyses() {
    contentEl.innerHTML = `<div class="empty-state">loading…</div>`;
    let rows = [];
    try {
      rows = await api.runQuery(
        `SELECT id, kind, source, tool, content, content_type, provider, model,
                tokens_in, tokens_out, created_at
         FROM mcp_analyses
         WHERE topic = :topic
         ORDER BY created_at DESC, id DESC
         LIMIT 200`,
        topic,
      );
    } catch (e) {
      contentEl.innerHTML = `<div class="empty-state">Error loading analyses: ${esc(e?.message || String(e))}</div>`;
      return;
    }
    if (contentEl.dataset.tab !== 'ai_analyses') return;
    if (!Array.isArray(rows) || rows.length === 0) {
      contentEl.innerHTML = `
        <div class="ai-empty">
          <div class="ai-empty-icon"><i data-lucide="sparkles"></i></div>
          <h3>No AI analyses yet</h3>
          <p>Every LLM call the app or an MCP client makes on this topic
            (insights, concepts, solutions, sentiment, chat, search, report,
            paper analysis, …) shows up here — unified, newest-first.</p>
          <button class="btn btn-primary icon-btn" id="btn-ai-go-actions">
            <i data-lucide="zap"></i> Run all analyses
          </button>
        </div>`;
      window.refreshIcons?.();
      $('#btn-ai-go-actions', contentEl)?.addEventListener('click', () => switchTab('actions'));
      return;
    }

    // Distribution counts drive the filter chips.
    const byKind = {};
    const bySrc = {};
    for (const r of rows) {
      byKind[r.kind || 'other'] = (byKind[r.kind || 'other'] || 0) + 1;
      bySrc[r.source || 'app']  = (bySrc[r.source || 'app']  || 0) + 1;
    }
    const kindOrder   = Object.keys(byKind).sort((a, b) => byKind[b] - byKind[a]);
    const sourceOrder = Object.keys(bySrc).sort();

    // Stash the prepared body string on each row so search filtering can
    // run against the rendered text without re-escaping every keystroke.
    // The rendered/raw payloads are kept in a JS Map keyed by card index —
    // putting 100 KB into a `data-` attribute breaks DOM perf and was the
    // cause of the AI-Analyses tab freezing on long outputs.
    const cardPayloads = new Map();   // idx → { rendered, raw }
    const cards = rows.map((r, idx) => {
      const ts   = r.created_at ? new Date(r.created_at).toLocaleString() : '';
      const kind = r.kind || 'other';
      const src  = r.source || 'app';
      const srcClass = src === 'mcp' ? 'ai-source-mcp' : 'ai-source-app';
      const srcLabel = src === 'mcp' ? 'MCP' : 'app';

      const metaBits = [];
      if (r.tool)     metaBits.push(`<code>${esc(r.tool)}</code>`);
      if (r.provider) metaBits.push(`<code>${esc(r.provider)}</code>`);
      if (r.model)    metaBits.push(`<code>${esc(r.model)}</code>`);

      const raw = String(r.content || '');

      // Decide rendered + raw representations. We track both so the card can
      // flip without a re-fetch. The "type" string also drives the stats line.
      let renderedHtml, rawText, viewerKind;
      if (r.content_type === 'json') {
        viewerKind = 'json';
        // Pretty-print when valid; fall back to original text otherwise so
        // we never *hide* malformed payloads — they're often the most
        // interesting cases to debug.
        try {
          rawText = JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
          rawText = raw;
        }
        renderedHtml = `<pre class="ai-json">${esc(rawText)}</pre>`;
      } else {
        // Heuristic: if the text shows any markdown structure, render it.
        // Otherwise treat as plain text — preserves whitespace from logs,
        // stack traces, etc.
        const looksLikeMarkdown = /(^|\n)(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```)/.test(raw)
                               || /\*\*[^*]+\*\*/.test(raw)
                               || /\[[^\]]+\]\([^)]+\)/.test(raw);
        if (looksLikeMarkdown) {
          viewerKind = 'markdown';
          renderedHtml = `<div class="markdown-body">${renderMarkdown(raw)}</div>`;
        } else {
          viewerKind = 'text';
          renderedHtml = `<pre class="ai-text">${esc(raw)}</pre>`;
        }
        rawText = raw;
      }

      // Long-content collapse threshold. We render full content into the DOM
      // (so search-in-page works) but cap visible height with a fade until
      // the user expands. ~6 KB is a good cutoff: shorter than a typical
      // report section, longer than a typical chat reply.
      const overflowThreshold = 6000;
      const overflows = raw.length > overflowThreshold;

      const stats = [
        `${raw.length.toLocaleString()} chars`,
        (r.tokens_in || r.tokens_out)
          ? `${(r.tokens_in || 0)}↑ ${(r.tokens_out || 0)}↓ tokens`
          : null,
      ].filter(Boolean).join(' · ');

      const tools = `
        <div class="ai-card-tools">
          ${overflows ? `
            <button class="ai-toggle" data-act="expand">
              <i data-lucide="chevron-down"></i> Show all
            </button>` : ''}
          <button class="ai-toggle" data-act="raw" title="Toggle raw / rendered">
            <i data-lucide="code"></i> Raw
          </button>
          <span class="ai-stats">${esc(stats)}</span>
        </div>
      `;

      // Searchable haystack — kind/source/tool/provider/model + raw content.
      const haystack = [kind, src, r.tool, r.provider, r.model, raw]
        .filter(Boolean).join(' ').toLowerCase();

      cardPayloads.set(idx, { rendered: renderedHtml, raw: rawText });

      return `
        <article class="ai-card"
                 data-idx="${idx}"
                 data-kind="${esc(kind)}"
                 data-source="${esc(src)}"
                 data-viewer="${viewerKind}"
                 data-search="${esc(haystack)}">
          <header class="ai-card-head">
            <span class="ai-chip ${srcClass}">${srcLabel}</span>
            <span class="ai-chip ai-kind">${esc(kind)}</span>
            <span class="ai-time">${esc(ts)}</span>
            <span class="ai-meta">
              ${metaBits.join('')}
              <button class="ai-copy" data-copy="${esc(r.id ?? '')}" title="Copy raw content">
                <i data-lucide="copy"></i>
              </button>
            </span>
          </header>
          <div class="ai-collapsible ${overflows ? 'has-overflow' : ''}">
            <div class="ai-card-body" data-mode="rendered">
              ${renderedHtml}
            </div>
          </div>
          ${tools}
        </article>`;
    }).join('');

    const kindChips = kindOrder.map(k =>
      `<button class="ai-chip" data-filter-kind="${esc(k)}">
        ${esc(k)} <b>${byKind[k]}</b>
      </button>`).join('');
    const sourceChips = sourceOrder.map(s =>
      `<button class="ai-chip" data-filter-source="${esc(s)}">
        ${esc(s === 'mcp' ? 'MCP' : s)} <b>${bySrc[s]}</b>
      </button>`).join('');

    contentEl.innerHTML = `
      <div class="ai-analyses-page">
        <div class="ai-analyses-head">
          <h3>
            <i data-lucide="sparkles"></i>
            AI Analyses
            <span class="ai-count">(${rows.length})</span>
          </h3>
          <span class="ai-sub">Unified log — every LLM call, newest first.</span>
        </div>
        <div class="ai-toolbar" role="toolbar" aria-label="AI Analyses filters">
          <input type="search"
                 class="ai-search"
                 id="ai-search"
                 placeholder="Search content, tool, provider, model…"
                 autocomplete="off"
                 spellcheck="false">
          <span class="ai-toolbar-label">kind</span>
          ${kindChips}
          <span class="ai-toolbar-label">source</span>
          ${sourceChips}
          <button class="ai-clear" data-filter-clear="1">Clear filters</button>
        </div>
        <div id="ai-analyses-list">${cards}</div>
      </div>`;
    window.refreshIcons?.();

    // Filter wiring — chips toggle, search narrows further, all stack together.
    const activeKind = new Set();
    const activeSrc  = new Set();
    let   query      = '';
    const list       = $('#ai-analyses-list', contentEl);

    const applyFilter = () => {
      let visible = 0;
      contentEl.querySelectorAll('.ai-card').forEach(c => {
        const k = c.dataset.kind, s = c.dataset.source, h = c.dataset.search || '';
        const matchK = activeKind.size === 0 || activeKind.has(k);
        const matchS = activeSrc.size  === 0 || activeSrc.has(s);
        const matchQ = !query || h.includes(query);
        const ok = matchK && matchS && matchQ;
        c.style.display = ok ? '' : 'none';
        if (ok) visible++;
      });
      contentEl.querySelectorAll('.ai-chip[data-filter-kind], .ai-chip[data-filter-source]').forEach(ch => {
        const k = ch.dataset.filterKind, s = ch.dataset.filterSource;
        const on = (k && activeKind.has(k)) || (s && activeSrc.has(s));
        ch.classList.toggle('is-active', on);
      });
      // No-match hint replaces the list when every card is filtered out.
      let hint = list.querySelector('.ai-no-match');
      if (visible === 0) {
        if (!hint) {
          hint = document.createElement('div');
          hint.className = 'ai-no-match';
          hint.textContent = 'No analyses match the current filters.';
          list.appendChild(hint);
        }
      } else if (hint) {
        hint.remove();
      }
    };

    contentEl.querySelectorAll('.ai-chip[data-filter-kind], .ai-chip[data-filter-source], [data-filter-clear]').forEach(ch => {
      ch.addEventListener('click', () => {
        if (ch.dataset.filterClear) {
          activeKind.clear(); activeSrc.clear();
          const search = $('#ai-search', contentEl);
          if (search) { search.value = ''; query = ''; }
        } else if (ch.dataset.filterKind) {
          const k = ch.dataset.filterKind;
          activeKind.has(k) ? activeKind.delete(k) : activeKind.add(k);
        } else if (ch.dataset.filterSource) {
          const s = ch.dataset.filterSource;
          activeSrc.has(s) ? activeSrc.delete(s) : activeSrc.add(s);
        }
        applyFilter();
      });
    });

    $('#ai-search', contentEl)?.addEventListener('input', (e) => {
      query = (e.target.value || '').trim().toLowerCase();
      applyFilter();
    });

    // Per-card "copy" — grabs the raw content from the row map. Avoids
    // re-fetching by id; we already have everything from the initial query.
    const rowById = new Map(rows.map(r => [String(r.id ?? ''), r]));
    contentEl.querySelectorAll('.ai-copy').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const r = rowById.get(btn.dataset.copy || '');
        if (!r) return;
        try {
          await navigator.clipboard.writeText(String(r.content || ''));
          const orig = btn.innerHTML;
          btn.innerHTML = '<i data-lucide="check"></i>';
          window.refreshIcons?.();
          setTimeout(() => { btn.innerHTML = orig; window.refreshIcons?.(); }, 1200);
        } catch {
          // Clipboard API can be denied on some webview policies — silent.
        }
      });
    });

    // Per-card "Show all" — drops the height cap on long content.
    // Per-card "Raw" — flips between rendered (markdown/JSON) and source view.
    contentEl.querySelectorAll('.ai-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.ai-card');
        if (!card) return;
        const idx = Number(card.dataset.idx);
        const payload = cardPayloads.get(idx);
        const act = btn.dataset.act;
        if (act === 'expand') {
          const wrap = card.querySelector('.ai-collapsible');
          const open = wrap?.classList.toggle('is-open');
          btn.innerHTML = open
            ? '<i data-lucide="chevron-up"></i> Show less'
            : '<i data-lucide="chevron-down"></i> Show all';
          window.refreshIcons?.();
        } else if (act === 'raw' && payload) {
          const body = card.querySelector('.ai-card-body');
          if (!body) return;
          const mode = body.dataset.mode === 'rendered' ? 'raw' : 'rendered';
          body.dataset.mode = mode;
          if (mode === 'raw') {
            body.innerHTML = `<pre class="ai-text">${esc(payload.raw)}</pre>`;
            btn.innerHTML = '<i data-lucide="eye"></i> Rendered';
          } else {
            body.innerHTML = payload.rendered;
            btn.innerHTML = '<i data-lucide="code"></i> Raw';
          }
          window.refreshIcons?.();
        }
      });
    });
  }

  // ─── tab switching ────────────────────────────────────────────────────
  const loaders = {
    home: () => loadInsights(contentEl, topic),
    insights: () => loadInsights(contentEl, topic), // backward-compatible alias
    bets: () => loadBets(contentEl, topic),
    map: loadMap, report: loadReport, evidence: loadEvidence,
    sources: loadSources, research: loadResearch, chat: loadChat, actions: loadActions,
    search: loadSearch,
    solutions: () => loadSolutions(contentEl, topic),
    concepts: () => loadConcepts(contentEl, topic),
    papers:   () => loadPapers(contentEl, topic),
    trends: () => loadTrends(contentEl, topic),
    posts: () => loadPosts(contentEl, topic),
    sentiment: () => loadSentiment(contentEl, topic),
    ai_analyses: () => loadAiAnalyses(contentEl, topic),
  };
  // Tab-generation counter. Every click bumps it. Loaders already close over
  // `activeTab` — they can check `activeTab === 'map'` before innerHTML writes
  // to self-suppress once the user moved on. What this counter adds: the
  // switchTab caller only refreshes icons + applies final style if its gen
  // is still current, so rapid clicks (B before A's async work settles) don't
  // trigger ghost renders.
  let tabGen = 0;
  const normalizeTabName = (name) => {
    if (name === 'insights') return 'home';
    if (!name || !loaders[name]) return 'home';
    return name;
  };
  const switchTab = async (name) => {
    name = normalizeTabName(name);
    const myGen = ++tabGen;
    const prevTab = activeTab;
    // Clean up chat listeners if we're leaving chat mid-stream
    if (activeTab === 'chat' && name !== 'chat') {
      try { chatStream.unlistenProgress?.(); } catch {}
      try { chatStream.unlistenDone?.(); } catch {}
      if (chatTsInterval) { clearInterval(chatTsInterval); chatTsInterval = null; }
    }
    // If we're moving away from a tab, preserve its DOM for instant revisit.
    if (prevTab && prevTab !== name) stashTabDom(prevTab);
    activeTab = name;
    try { sessionStorage.setItem(TAB_STATE_KEY, name); } catch {}
    // Stamp the content container with the current tab name so any loader's
    // deferred DOM write (finished after a rapid tab switch) can self-check
    // `contentEl.dataset.tab === 'map'` before stomping on the new tab's
    // render. See `writeIfTab()` helper further down — the fix for stale
    // tab content was spec'd here on 2026-04-20.
    contentEl.dataset.tab = name;
    // Home chrome (intent ladder + Gap Map coverage + extraction override +
    // coverage gaps) lives below the tab strip; show only on Home so other
    // tabs stay focused. DOM stays mounted — we only toggle display.
    syncHomeChromeVisibility(name);
    // Highlight primary tabs by data-tab match. Also highlight the More
    // button when a non-primary tab is active, so the user can see their
    // current location even for tabs inside the dropdown.
    const primaryTabs = new Set([
      'home', 'map', 'report', 'trends', 'sentiment', 'sources', 'posts',
      'research', 'solutions', 'concepts', 'papers', 'bets', 'evidence',
      'chat', 'search', 'actions', 'ai_analyses'
    ]);
    tabsEl.querySelectorAll('.tab:not(.tab-more)').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === name)
    );
    const moreBtn = tabsEl.querySelector('.tab-more');
    if (moreBtn) moreBtn.classList.toggle('active', !primaryTabs.has(name));
    // Fast path: if this tab has a clean cached DOM, restore it and skip reload.
    if (restoreTabDom(name)) {
      if (tabGen === myGen) window.refreshIcons?.();
      return;
    }
    // If we have a persisted HTML snapshot from a previous visit, paint it
    // immediately. Whether to ALSO run the loader in background depends on
    // whether the underlying data changed since the snapshot was written.
    // Default behaviour was always-refresh, which made every tab switch
    // feel like a re-fetch even when nothing had changed — exactly what
    // the user reported. Now: skip the loader when both same-session
    // (`dirtyTabs`) and cross-nav (`_dirtyTopicTabs`) report clean.
    const snapshot = readTabHtmlSnapshot(name);
    const tabIsDirty = dirtyTabs.has(name) || isTabDirtyAcrossNav(topic, name);
    if (snapshot) {
      contentEl.innerHTML = tabIsDirty
        ? `<div style="display:flex;justify-content:flex-end;padding:8px 12px 0">
             <span class="th-chip" title="Showing cached tab while refreshing latest data">
               cached · updating
             </span>
           </div>
           ${snapshot.html}`
        : snapshot.html;
      // Map re-open UX: if we already have a fresh snapshot and the tab
      // wasn't marked dirty by a data mutation, don't kick a full map reload
      // (build/relate/export) on every tab switch.
      if (name === 'map') {
        const mapDirty = dirtyTabs.has('map') || _mapDirtyTopics.has(topic);
        const autoUpdate = isMapAutoUpdateEnabled();
        if (!mapDirty) {
          if (tabGen === myGen) window.refreshIcons?.();
          return;
        }
        if (!autoUpdate) {
          const banner = document.createElement('div');
          banner.className = 'map-enrich-banner warn';
          banner.style.margin = '8px 12px 0';
          banner.innerHTML = `
            <span>New data was added since your last map build. Click <b>Rebuild</b> to include latest sources, links, and findings.</span>
            <button class="btn btn-primary map-banner-btn" id="btn-map-stale-rebuild">Rebuild</button>
          `;
          contentEl.insertBefore(banner, contentEl.firstChild);
          banner.querySelector('#btn-map-stale-rebuild')?.addEventListener('click', () => loadMap(true));
          if (tabGen === myGen) window.refreshIcons?.();
          return;
        }
      }
      // Snapshot-served + clean? Don't run the loader — user said they
      // didn't ask to refresh. Loader fires only when the tab is dirty
      // (mutation since render) OR the user explicitly hits a Rebuild
      // button on a particular tab.
      if (!tabIsDirty) {
        if (tabGen === myGen) window.refreshIcons?.();
        return;
      }
    } else {
      // Synchronous placeholder so the old tab's content disappears the moment
      // the user clicks — before the loader's first await.
      contentEl.innerHTML = `
        <div class="empty-state" style="padding:40px;text-align:center">
          <div class="map-building-spinner" style="margin:0 auto 10px"></div>
          <div style="color:var(--ink-3);font-size:13px">Loading ${esc(name)}…</div>
        </div>`;
    }
    try {
      await withTimeout(
        loaders[name]?.(),
        TAB_LOAD_TIMEOUT_MS,
        `${name} tab load`
      );
      dirtyTabs.delete(name);
      clearTabDirtyAcrossNav(topic, name);
      if (tabGen === myGen && contentEl.dataset.tab === name) {
        writeTabHtmlSnapshot(name);
      }
    } catch (e) {
      if (tabGen === myGen && contentEl.dataset.tab === name) {
        contentEl.innerHTML = `<div class="empty-state">Error: ${esc(e?.message || String(e))}</div>`;
      }
    }
    if (tabGen === myGen) window.refreshIcons?.();
  };

  // Gated DOM write — loaders use this to render into contentEl only if the
  // user is still looking at their tab. If the user already clicked another
  // tab, the write is silently dropped so we don't stomp the new render.
  // Prevents the "click tab B, see tab A's content flash in" race when
  // loaders await slow sidecar calls in parallel.
  const writeIfTab = (expected, html) => {
    if (contentEl.dataset.tab === expected) contentEl.innerHTML = html;
  };

  // Primary tab buttons (Insights / Bets / Evidence / Chat + the More toggle)
  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab[data-tab]');
    if (!btn || !tabsEl.contains(btn)) return;
    const name = btn.dataset.tab;
    if (!name) return;
    e.preventDefault();
    switchTab(name);
  });

  // More ▾ dropdown — toggles on click, closes on outside-click + Escape,
  // items switch tabs AND close the menu.
  const moreToggle = $('#tab-more-toggle');
  const moreMenu = $('#tab-more-menu');
  const closeMoreMenu = () => {
    if (!moreMenu || moreMenu.hidden) return;
    moreMenu.hidden = true;
    moreToggle?.setAttribute('aria-expanded', 'false');
    moreToggle?.classList.remove('active');
  };
  moreToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = moreMenu.hidden;
    moreMenu.hidden = !open;
    moreToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    moreToggle.classList.toggle('active', open);
  });
  moreMenu?.querySelectorAll('.tab-more-item').forEach(item => {
    item.addEventListener('click', () => {
      const name = item.dataset.tab;
      closeMoreMenu();
      switchTab(name);
    });
  });
  document.addEventListener('click', (e) => {
    if (!moreMenu || moreMenu.hidden) return;
    if (!e.target.closest('.tab-more-wrap')) closeMoreMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMoreMenu();
  });

  $('#btn-rerun').onclick = () => openSourcePickerModal(topic);
  // "Fetch more" — explicit DEEP collect (3yr × all subs × every source). The
  // first collect is a fast 1-year scan; this is the opt-in thorough pass.
  $('#btn-fetch-more')?.addEventListener('click', () => {
    const ok = confirm(
      'Deep fetch pulls 3 years of Reddit history across ALL discovered '
      + 'subreddits, plus every source — thorough but slow (~10-15 min).\n\n'
      + 'Your first collect was a fast 1-year scan. New posts stream into the '
      + 'topic as they land; you don\'t have to wait for it to finish.\n\nContinue?'
    );
    if (!ok) return;
    localStorage.setItem('gapmap.collect.last_aggressive', 'true');
    localStorage.setItem('gapmap.collect.last_deep', 'true');
    location.hash = `#/collect/${encodeURIComponent(topic)}`;
  });

  // ── AG-D: compare view ── picks a second topic via a minimal modal, then
  // navigates to #/compare/<this>/<other>. Uses the existing list_topics cache.
  $('#btn-compare-topic').onclick = async () => {
    let others = [];
    try {
      const all = await api.listTopics();
      others = (Array.isArray(all) ? all : [])
        .map(t => (typeof t === 'string' ? t : t?.topic))
        .filter(t => t && t !== topic);
    } catch {}
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.hidden = false;
    backdrop.innerHTML = `
      <div class="modal" style="max-width:440px">
        <h3 style="margin-top:0">Compare <b>${esc(topic)}</b> with…</h3>
        <p class="muted" style="margin-top:0">Pick another topic to see both synthesis reports side-by-side.</p>
        ${others.length === 0
          ? `<p class="muted">No other topics yet. Create another topic first.</p>`
          : `<select id="cmp-other-topic" style="width:100%;padding:8px">
               ${others.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
             </select>`}
        <div class="modal-actions" style="justify-content:flex-end;margin-top:14px;display:flex;gap:8px">
          <button class="btn btn-ghost btn-bordered" id="cmp-cancel">Cancel</button>
          <button class="btn btn-primary" id="cmp-go" ${others.length === 0 ? 'disabled' : ''}>Compare</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector('#cmp-cancel').onclick = close;
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#cmp-go')?.addEventListener('click', () => {
      const other = backdrop.querySelector('#cmp-other-topic')?.value;
      if (!other) return;
      close();
      location.hash = `#/compare/${encodeURIComponent(topic)}/${encodeURIComponent(other)}`;
    });
  };

  // Scheduled-refresh toggle per topic. Reads the current flag from
  // topic_prefs and wires the checkbox to flip it via the Rust command.
  (async () => {
    const cb = $('#cb-schedule-topic');
    if (!cb) return;
    try {
      const rows = await api.runQuery(
        "SELECT scheduled FROM topic_prefs WHERE topic = :topic",
        topic,
      );
      cb.checked = !!(Array.isArray(rows) && rows[0] && rows[0].scheduled);
    } catch {}
    cb.addEventListener('change', async e => {
      try {
        await api.scheduleEnableTopic(topic, !!e.target.checked);
      } catch (err) {
        e.target.checked = !e.target.checked;  // revert on failure
        alert(`schedule toggle failed: ${err?.message || err}`);
      }
    });
  })();

  // NEUTRALIZED 2026-04-20 — scheduleMarkSeen spawned a sidecar on every
  // topic open. Fire-and-forget still uses the Tauri handler queue;
  // suspected of contributing to app-wide hang.
  // api.scheduleMarkSeen(topic).catch(() => {});
  $('#btn-delete').onclick = async () => {
    const { confirmDestructiveAction } = await import('../lib/deleteConfirm.js');
    const ok = await confirmDestructiveAction({
      title: `Delete topic "${topic}"?`,
      body: 'Soft-deleted — recoverable for 7 days from Settings → Trash.',
      matchText: topic,
      confirmLabel: 'Delete topic',
      confirmDanger: true,
      hint: `type the topic name to confirm`,
    });
    if (!ok) return;
    try {
      await api.deleteTopic(topic);
      // T1.3 undo toast (10s). Clicking Undo restores and re-opens the topic.
      const t = document.createElement('div');
      t.className = 'toast toast-success';
      t.style.display = 'flex'; t.style.alignItems = 'center'; t.style.gap = '12px';
      t.innerHTML = `🗑 Moved "${esc(topic)}" to trash · recoverable 7 days <button class="btn btn-xs btn-primary" id="undo-del-pri">Undo</button>`;
      document.body.appendChild(t);
      let undone = false;
      t.querySelector('#undo-del-pri').onclick = async () => {
        undone = true;
        try {
          await api.restoreTopic(topic);
          location.hash = `#/topic/${encodeURIComponent(topic)}`;
          t.remove();
        } catch { t.innerHTML = '✗ Restore failed'; setTimeout(() => t.remove(), 2000); }
      };
      setTimeout(() => { if (!undone) t.remove(); }, 10000);
      if (!undone) location.hash = '#/';
    } catch (e) {
      alert(`Delete failed: ${e?.message || e}`);
    }
  };

  // Poll for an in-flight collect for THIS topic — show the header chip +
  // Cancel button if ended_at IS NULL and params_json references this topic.
  const chip = $('#topic-active-chip');
  const cancelBtn = $('#btn-cancel-collect');
  let wasRunning = false;
  const pollActive = async () => {
    if (!document.body.contains(chip)) return;
    try {
      const rows = await api.runQuery(
        `SELECT 1 FROM fetches \
         WHERE ended_at IS NULL \
           AND params_json LIKE :needle \
         LIMIT 1`,
        undefined,
        { needle: `%"topic":"${topic.replace(/"/g, '\\"')}"%` },
      );
      const running = Array.isArray(rows) && rows.length > 0;
      chip.hidden = !running;
      if (cancelBtn) cancelBtn.hidden = !running;
      if (wasRunning && !running) {
        // Collect finished — refresh header stats + current tab.
        refreshHeaderStats();
        if (activeTab === 'map' || activeTab === 'evidence' || activeTab === 'sources') {
          loaders[activeTab]?.();
        }
      }
      wasRunning = running;
    } catch {}
  };

  // Cancel-fetch button — kills the currently-tracked ActiveJob in Rust
  // (which is this topic's collect because the button only shows when
  // pollActive detected a live fetch with this topic in params_json).
  // Both prod (CommandChild::kill) and dev (SIGTERM on the venv-python
  // pid) paths are tried by cancel_active_job on the Rust side.
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      if (!confirm(`Stop the in-flight fetch for "${topic}"? Partial results stay in the corpus — you can Rerun anytime.`)) return;
      cancelBtn.disabled = true;
      const origText = cancelBtn.textContent;
      cancelBtn.textContent = 'Cancelling…';
      try {
        const killed = await api.cancelCollect();
        showToast(
          killed ? 'Fetch cancelled' : 'No active fetch found',
          killed ? 'The sidecar process was terminated. Partial rows are still in the DB.'
                 : 'The fetch may have already finished — refresh to see the latest state.',
          killed ? 'ok' : 'warn',
          3500,
        );
        // Hide optimistically; the pollActive tick will confirm shortly.
        chip.hidden = true;
        cancelBtn.hidden = true;
      } catch (e) {
        showToast('Cancel failed', e?.message || String(e), 'err', 5000);
      } finally {
        cancelBtn.disabled = false;
        cancelBtn.textContent = origText;
      }
    });
  }
  // Extracted so we can call it after a collect finishes.
  async function refreshHeaderStats() {
    try {
      const rows = await api.runQuery(
        `SELECT
           (SELECT count(*) FROM topic_posts WHERE topic=:topic) AS posts,
           (SELECT count(*) FROM graph_nodes WHERE topic=:topic AND kind='painpoint') AS painpoints,
           (SELECT count(*) FROM graph_nodes WHERE topic=:topic AND kind='workaround')  AS workarounds,
           (SELECT count(DISTINCT coalesce(p.source_type,'reddit'))
              FROM topic_posts tp JOIN posts p ON p.id=tp.post_id
              WHERE tp.topic=:topic) AS sources`,
        topic,
      );
      if (Array.isArray(rows) && rows[0]) {
        const r = rows[0];
        const el = $('#topic-header-stats');
        if (el) el.innerHTML = `
          <span class="th-chip"><b>${(r.posts || 0).toLocaleString()}</b> posts</span>
          <span class="th-chip"><b>${r.painpoints || 0}</b> pains</span>
          <span class="th-chip"><b>${r.workarounds || 0}</b> DIY</span>
          <span class="th-chip"><b>${r.sources || 0}</b> src</span>`;
      }
    } catch {}
  }
  pollActive();
  const activeChipInterval = setInterval(pollActive, 4000);

  // Clean up on navigate away (hashchange) — otherwise a streaming chat
  // would keep pushing into a removed DOM node.
  const hashCleanup = () => {
    try { chatStream.unlistenProgress?.(); } catch {}
    try { chatStream.unlistenDone?.(); } catch {}
    clearInterval(activeChipInterval);
    if (chatTsInterval) { clearInterval(chatTsInterval); chatTsInterval = null; }
    if (changedRefreshTimer) clearTimeout(changedRefreshTimer);
    window.removeEventListener('gapmap:changed', onGapmapChangedTask8);
    window.removeEventListener('gapmap:db-changed', onDbChangedTask8);
    for (const off of _activeEnrichUnlistens) {
      try { off(); } catch {}
    }
    _activeEnrichUnlistens.clear();
    // Nuke any in-flight toast auto-remove timers — they'd otherwise try to
    // remove() DOM nodes that belong to this (now-unmounted) screen.
    for (const t of _activeToastTimers) clearTimeout(t);
    _activeToastTimers.clear();
    window.removeEventListener('hashchange', hashCleanup);
  };
  window.addEventListener('hashchange', hashCleanup);

  // Intent-driven default tab + action-ladder mount. Falls back cleanly to
  // 'insights' on any failure so pre-migration topics + first-run installs
  // stay on their current landing.
  let defaultTab = 'home';
  try {
    const remembered = sessionStorage.getItem(TAB_STATE_KEY);
    if (remembered) defaultTab = normalizeTabName(remembered);
  } catch {}
  try {
    const intentPayload = await api.topicIntentGet(topic);
    if (!defaultTab || defaultTab === 'home') {
      defaultTab = normalizeTabName(intentPayload?.preset?.default_tab || 'home');
    }
    const ladderHost = document.getElementById('intent-ladder-host');
    if (ladderHost) {
      mountIntentLadder(ladderHost, topic, {
        goToTab: (name) => switchTab(name),
      });
    }
  } catch {
    // Intent layer is additive — any failure falls back to pre-intent flow.
  }
  await switchTab(normalizeTabName(defaultTab));
  // Mark mount complete so the gapmap:changed listener can fire normal
  // tab refreshes from here on. Without this gate, stale events queued
  // mid-mount silently switch tabs on the user.
  initialMountComplete = true;
}

// Badge colors per source type — matches the source badge palette used on
// the Research tab so users get a consistent visual vocabulary across tabs.
const SRC_BADGE = {
  reddit:   { bg: '#FFE4D4', fg: '#8A3A12', label: 'reddit'   },
  hn:       { bg: '#FFECDA', fg: '#8A4512', label: 'HN'       },
  arxiv:    { bg: '#FBE3E6', fg: '#B84747', label: 'arXiv'    },
  openalex: { bg: '#EFE7FB', fg: '#6E4DB3', label: 'OpenAlex' },
  pubmed:   { bg: '#E4F0FA', fg: '#1F5C99', label: 'PubMed'   },
  scholar:  { bg: '#E1F2EA', fg: '#2E7D5B', label: 'Scholar'  },
  appstore: { bg: '#F0E8FA', fg: '#5B2C91', label: 'AppStore' },
  playstore:{ bg: '#E0F2D9', fg: '#2F6B1F', label: 'PlayStore'},
  devto:    { bg: '#E8E8E8', fg: '#222',    label: 'Dev.to'   },
  stackoverflow:{ bg: '#FEE8D6', fg: '#C76114', label: 'SO'   },
  github:   { bg: '#E8E8E8', fg: '#222',    label: 'GitHub'   },
  ingest:   { bg: '#FBF1D4', fg: '#8A5A1A', label: 'Ingest'   },
  gnews:    { bg: '#E1EEFC', fg: '#1F4E9A', label: 'Google News' },
  trends:   { bg: '#E1F2EA', fg: '#2E7D5B', label: 'Trends'   },
  trustpilot:    { bg: '#E0F2EA', fg: '#0F5E37', label: 'Trustpilot'    },
  producthunt:   { bg: '#FFE0CC', fg: '#B44500', label: 'Product Hunt'  },
  alternativeto: { bg: '#E8E0F2', fg: '#4B2C8A', label: 'AlternativeTo' },
};

function renderSourceBadges(breakdown) {
  // breakdown = {reddit: 7, arxiv: 3, appstore: 2}. Sort by count desc.
  // Each badge carries data-source so the click handler below can drill
  // into the Posts tab filtered to that source type.
  if (!breakdown || typeof breakdown !== 'object') return '';
  const entries = Object.entries(breakdown).filter(([_, n]) => n > 0);
  if (entries.length === 0) return '';
  entries.sort((a, b) => b[1] - a[1]);
  const badges = entries.map(([src, n]) => {
    const cfg = SRC_BADGE[src] || { bg: '#E8E8E8', fg: '#222', label: src };
    return `<span class="finding-src-badge" data-source="${esc(src)}" title="Click to see ${n} ${esc(cfg.label)} posts backing this finding" style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:10px;background:${cfg.bg};color:${cfg.fg};font-size:11px;font-weight:600;margin-right:4px;cursor:pointer;user-select:none"><b>${n}</b> ${esc(cfg.label)}</span>`;
  }).join('');
  return badges;
}

function renderMetaPills(metaJson) {
  try {
    const m = JSON.parse(metaJson || '{}');
    const pills = [];
    if (m.classification && m.classification !== 'UNCLASSIFIED') pills.push(`<span style="color:var(--chronic);font-weight:700">${esc(m.classification)}</span>`);
    if (m.severity) pills.push(`severity: ${esc(m.severity)}`);
    if (m.frequency) pills.push(`freq: ${m.frequency}`);
    // Source diversity — "3 sources · saturated" signals cross-source evidence.
    // Painpoints that appear in Reddit + arXiv + App Store are much stronger
    // signals than Reddit-only ones. The color code nudges users toward the
    // multi-source findings without requiring them to scan breakdown counts.
    const diversity = m.source_diversity || 0;
    if (diversity >= 3)       pills.push(`<span style="color:#1A7A4F;font-weight:700">★ ${diversity} sources</span>`);
    else if (diversity === 2) pills.push(`<span style="color:#4A6FB3;font-weight:600">◆ ${diversity} sources</span>`);
    const pillsHtml = pills.map(p => `<span>${p}</span>`).join('');
    const badges = renderSourceBadges(m.source_breakdown);
    return badges ? `${pillsHtml}<div style="margin-top:6px">${badges}</div>` : pillsHtml;
  } catch { return ''; }
}

/**
 * Tiny markdown renderer — headers, lists, bold, italic, code, blockquote, hr, link.
 */
function renderMarkdown(md) {
  if (!md) return '';
  const lines = md.split('\n');
  const out = [];
  let inList = false;
  let inQuote = false;
  let inCode = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (!inCode) { out.push('<pre><code>'); inCode = true; }
      else { out.push('</code></pre>'); inCode = false; }
      continue;
    }
    if (inCode) { out.push(esc(line)); continue; }
    if (line.startsWith('# '))        out.push(`<h1>${inlineMd(line.slice(2))}</h1>`);
    else if (line.startsWith('## '))  out.push(`<h2>${inlineMd(line.slice(3))}</h2>`);
    else if (line.startsWith('### ')) out.push(`<h3>${inlineMd(line.slice(4))}</h3>`);
    else if (line.startsWith('> '))   { if (!inQuote) { out.push('<blockquote>'); inQuote = true; } out.push(inlineMd(line.slice(2))); }
    else if (line.trim() === '---')   out.push('<hr/>');
    else if (line.match(/^[-*]\s/))   { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inlineMd(line.replace(/^[-*]\s/, ''))}</li>`); }
    else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (inQuote) { out.push('</blockquote>'); inQuote = false; }
      if (line.trim() === '') out.push('');
      else out.push(`<p>${inlineMd(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  if (inQuote) out.push('</blockquote>');
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}
function inlineMd(s) {
  // SECURITY: this renders untrusted text (LLM output + collected posts/papers)
  // as HTML. Escape raw HTML FIRST so markdown source can't inject tags/attrs,
  // and allow only safe link schemes — otherwise `[x](javascript:…)` / a stray
  // `<img onerror>` would execute. (esc imported from api.js; same guard as the
  // post-link anchors elsewhere in this file.)
  return esc(s)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => {
      const h = href.trim().toLowerCase();
      const safe = h.startsWith('https://') || h.startsWith('http://')
        || h.startsWith('asset://') || h.startsWith('mailto:');
      // href is already HTML-escaped by esc() above → attribute-safe.
      return safe ? `<a href="${href}" target="_blank" rel="noopener">${text}</a>` : text;
    })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

// ── Task 9.5: Topic-level extraction overrides ─────────────────────────
// Reads the resolved prefs for this topic, renders a one-liner summary,
// and (on Override click) swaps in an inline popover with the 3 core
// sliders (mode / threshold / batch). Saving writes with scope=topic:<slug>
// and re-renders the summary. Clear reverts the row to global defaults.
async function _renderExtractionOverrideRow(root, topic) {
  const host = root.querySelector('[data-role="extract-override"]');
  if (!host || !topic) return;
  let data;
  try { data = await api.extractionPrefsGet(topic); }
  catch { return; }  // silently skip on transient failure — row stays hidden
  if (!data) return;

  const eff = data.effective || {};
  const topicOverride = data.topic || null;
  const hasOverride = !!topicOverride;

  const mode = (eff.mode || 'auto');
  const threshold = Number(eff.threshold) || 100;
  const batch = Number(eff.batch_size) || 5;

  const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1);
  host.style.display = 'flex';
  host.innerHTML = `
    <span>This topic uses: <b>${esc(modeLabel)}</b> · <b>${threshold}</b> posts · batch <b>${batch}</b></span>
    ${hasOverride ? '<span style="color:var(--accent,#FF8C42);font-weight:500">· override active</span>' : ''}
    <span style="flex:1"></span>
    <button class="btn btn-ghost btn-xs btn-bordered" id="extract-override-btn">Override</button>
    ${hasOverride ? '<button class="btn btn-ghost btn-xs" id="extract-override-clear">Reset</button>' : ''}
  `;

  host.querySelector('#extract-override-btn')?.addEventListener('click', () => {
    _openExtractionOverridePopover(host, topic, data);
  });
  host.querySelector('#extract-override-clear')?.addEventListener('click', async () => {
    try {
      await api.extractionPrefsSet(`topic:${topic}`, {
        mode: null, threshold: null, batch_size: null,
        window_start: null, window_end: null,
        daily_token_cap: null, release_llm_idle: null,
      });
      await _renderExtractionOverrideRow(root, topic);
    } catch (e) { alert(`Reset failed: ${e?.message || e}`); }
  });
}

function _openExtractionOverridePopover(host, topic, data) {
  const eff = data?.effective || {};
  const mode = (eff.mode || 'auto');
  const threshold = Number(eff.threshold) || 100;
  const batch = Number(eff.batch_size) || 5;

  host.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;width:100%">
      <span style="flex-basis:100%;font-weight:500">Override for "${esc(topic)}"</span>
      <label style="display:flex;gap:4px;align-items:center">
        <span>Mode</span>
        <select id="ovr-mode" class="select-sm">
          ${['auto','manual','scheduled'].map(m =>
            `<option value="${m}" ${mode === m ? 'selected' : ''}>${m}</option>`
          ).join('')}
        </select>
      </label>
      <label style="display:flex;gap:4px;align-items:center">
        <span>Threshold</span>
        <input type="range" id="ovr-threshold" min="50" max="500" step="10" value="${threshold}" style="width:120px" />
        <b id="ovr-threshold-val">${threshold}</b>
      </label>
      <label style="display:flex;gap:4px;align-items:center">
        <span>Batch</span>
        <input type="range" id="ovr-batch" min="1" max="20" step="1" value="${batch}" style="width:80px" />
        <b id="ovr-batch-val">${batch}</b>
      </label>
      <button class="btn btn-primary btn-xs" id="ovr-save">Save</button>
      <button class="btn btn-ghost btn-xs btn-bordered" id="ovr-cancel">Cancel</button>
    </div>
  `;
  const thrIn = host.querySelector('#ovr-threshold');
  const thrV = host.querySelector('#ovr-threshold-val');
  thrIn?.addEventListener('input', e => thrV.textContent = e.target.value);
  const bIn = host.querySelector('#ovr-batch');
  const bV = host.querySelector('#ovr-batch-val');
  bIn?.addEventListener('input', e => bV.textContent = e.target.value);

  host.querySelector('#ovr-cancel')?.addEventListener('click', () => {
    const root = host.closest('#main-content, [data-view], body') || document.body;
    _renderExtractionOverrideRow(root, topic);
  });
  host.querySelector('#ovr-save')?.addEventListener('click', async () => {
    const modeVal = host.querySelector('#ovr-mode')?.value || 'auto';
    const thr = Number(thrIn?.value) || 100;
    const bs = Number(bIn?.value) || 5;
    try {
      await api.extractionPrefsSet(`topic:${topic}`, {
        mode: modeVal,
        threshold: thr,
        batch_size: bs,
      });
      const root = host.closest('#main-content, [data-view], body') || document.body;
      await _renderExtractionOverrideRow(root, topic);
    } catch (e) { alert(`Save failed: ${e?.message || e}`); }
  });
}
