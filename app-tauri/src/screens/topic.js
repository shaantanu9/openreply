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

// Per-topic chat history so switching tabs doesn't wipe the conversation.
// key = topic string, value = [{ role: 'user'|'assistant', mode, text }]
// Hydrated from localStorage on first access per topic (survives page reload).
const chatHistory = new Map();

const CHAT_HISTORY_KEY = (topic) => `gapmap.chat.${topic}`;
function loadChatHistory(topic) {
  if (chatHistory.has(topic)) return chatHistory.get(topic);
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY(topic));
    const arr = raw ? JSON.parse(raw) : [];
    chatHistory.set(topic, Array.isArray(arr) ? arr : []);
  } catch { chatHistory.set(topic, []); }
  return chatHistory.get(topic);
}
function saveChatHistory(topic) {
  try {
    const arr = chatHistory.get(topic) || [];
    // Keep last 50 messages to avoid localStorage bloat on long sessions.
    const trimmed = arr.slice(-50);
    localStorage.setItem(CHAT_HISTORY_KEY(topic), JSON.stringify(trimmed));
  } catch {}
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
      ${detail ? `<div style="color:var(--ink-3);font-size:var(--fs-13)">${esc(detail)}</div>` : ''}
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
  // Curated RSS feed bundles. Each category fans out to ~5-10 feeds, filtered
  // by topic-keyword match in title/summary so unrelated posts are dropped.
  // defaultOn=false — these only run when the user explicitly opts in.
  { id: 'rss_startup',     label: 'RSS: Startup / founder',   group: 'rss', defaultOn: false },
  { id: 'rss_tech_news',   label: 'RSS: Tech news',           group: 'rss', defaultOn: false },
  { id: 'rss_products',    label: 'RSS: Products / launches', group: 'rss', defaultOn: false },
  { id: 'rss_ml',          label: 'RSS: ML / AI research',    group: 'rss', defaultOn: false },
  { id: 'rss_science',     label: 'RSS: Science (general)',   group: 'rss', defaultOn: false },
  { id: 'rss_engineering', label: 'RSS: Engineering blogs',   group: 'rss', defaultOn: false },
  { id: 'rss_learning',    label: 'RSS: Learning / essays',   group: 'rss', defaultOn: false },
  { id: 'rss_design',      label: 'RSS: Design / UX',         group: 'rss', defaultOn: false },
  { id: 'rss_psychology',  label: 'RSS: Psychology',          group: 'rss', defaultOn: false },
  { id: 'rss_neuroscience',label: 'RSS: Neuroscience',        group: 'rss', defaultOn: false },
  { id: 'rss_marketing',   label: 'RSS: Marketing / growth',  group: 'rss', defaultOn: false },
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
  // Default checked = whatever was already used. If nothing was found
  // (shouldn't happen on Rerun, but safety net), fall back to defaults.
  const initialChecked = existing.size > 0
    ? existing
    : new Set(ALL_SOURCES.filter(s => s.defaultOn).map(s => s.id));

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
          <input type="checkbox" id="src-pick-aggressive" />
          <span>Aggressive (max limits + historical archive — slower, deeper)</span>
        </label>
        <div class="src-pick-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="src-pick-cancel">Cancel</button>
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

  host.querySelector('#src-pick-go').onclick = async () => {
    const checked = Array.from(host.querySelectorAll('input[data-src]:checked'))
      .map(cb => cb.dataset.src);
    const includeReddit = checked.includes('reddit');
    const externalSources = checked.filter(s => s !== 'reddit');
    const aggressive = host.querySelector('#src-pick-aggressive').checked;

    if (checked.length === 0) {
      alert('Pick at least one source.');
      return;
    }

    close();
    // Stash the picker state in localStorage so collect.js (which auto-fires
    // startCollect on mount) can pick up our chosen source filter + skip-reddit
    // flag. Otherwise collect.js's 2-arg startCollect call would fire FIRST
    // and ignore the source filter entirely (root cause: bug 2026-04-20 where
    // selecting only playstore still searched Reddit).
    localStorage.setItem('gapmap.collect.last_aggressive', String(aggressive));
    localStorage.setItem(
      'gapmap.collect.last_sources',
      externalSources.length > 0 ? externalSources.join(',') : '',
    );
    localStorage.setItem('gapmap.collect.last_skip_reddit', String(!includeReddit));

    // Navigate to the live progress screen — collect.js will read the
    // localStorage values and fire startCollect with the correct args.
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
    <p class="muted" style="font-size:var(--fs-11);margin:0 0 8px">Preview only — run <b>Build &amp; enrich</b> to persist these into the graph.</p>
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

export async function renderTopic(root, { params }) {
  const topic = decodeURIComponent(params[0] || '');
  // Per-instance tab state (fix: module-level state leaked between topics).
  // Default to 'insights' — the Phase-1 synthesis tab is the new primary UX.
  let activeTab = 'insights';
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
    <header class="topbar">
      <div class="crumbs">
        <a href="#/" style="color:var(--ink-3);text-decoration:none">Workspace</a> /
        <strong>${esc(topic)}</strong>
      </div>
      <div class="topbar-spacer"></div>
      <a href="#/collect/${encodeURIComponent(topic)}" class="topic-active-chip" id="topic-active-chip" hidden title="A collect is running for this topic — click to watch progress">
        <span class="pulse-dot sm"></span> Collecting…
      </a>
      <button class="btn btn-ghost btn-sm btn-bordered" id="btn-cancel-collect" hidden style="color:#B84747;border-color:#E8C8C8" title="Stop the in-flight collect for this topic">Cancel fetch</button>
      <div class="topic-header-stats" id="topic-header-stats"></div>
      <button class="active-llm-pill none" id="topic-llm-pill" title="Click to change provider / model">
        <span class="dot"></span><span id="topic-llm-pill-label">No LLM</span>
      </button>
      <label id="schedule-topic-toggle" style="margin:0;padding:4px 10px;font-size:var(--fs-13);display:inline-flex;align-items:center;gap:6px;cursor:pointer;border:1px solid var(--line);border-radius:8px" title="Include this topic in scheduled re-runs">
        <input type="checkbox" id="cb-schedule-topic" style="margin:0" />
        <span style="font-weight:500">Auto-refresh</span>
      </label>
      <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-rerun"><i data-lucide="rotate-cw"></i> Rerun collect</button>
      <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-compare-topic" title="Compare this topic's insights with another topic side-by-side"><i data-lucide="git-compare"></i> Compare</button>
      <button class="btn btn-ghost btn-sm btn-bordered" id="btn-delete" style="color:#B84747">Delete</button>
    </header>

    <!-- L2 breadcrumbs — Workspace › Topic › Stage › Tab -->
    <nav class="topic-breadcrumbs rg-t-meta" id="topic-breadcrumbs" aria-label="breadcrumb">
      <a href="#/" class="tb-crumb">Workspace</a>
      <span class="tb-sep" aria-hidden="true">›</span>
      <span class="tb-crumb tb-crumb-current" id="tb-topic">${esc(topic)}</span>
      <span class="tb-sep" aria-hidden="true">›</span>
      <span class="tb-crumb" id="tb-stage">—</span>
      <span class="tb-sep" aria-hidden="true">›</span>
      <span class="tb-crumb tb-crumb-strong" id="tb-tab">—</span>
    </nav>

    <div class="section-head">
      <div><h2>${esc(topic)}</h2><p id="topic-sub">Loading topic…</p></div>
      <!-- Phase-3 bet stats pill. Populated by loadBetStatsPill(); hidden when no bets. -->
      <div id="topic-bet-stats" class="topic-bet-stats" hidden></div>
    </div>

    <!-- L2 stage rail — COLLECT → DISCOVER → ACT. Visual workflow cue;
         clicking a stage jumps to that stage's first tab. -->
    <div class="topic-stages rg-reveal" id="topic-stages" role="tablist" aria-label="Workflow stage">
      <button class="stage-pill" data-stage="collect" role="tab" aria-selected="false">
        <span class="stage-index">1</span>
        <span class="stage-body">
          <span class="stage-name">Collect</span>
          <span class="stage-hint rg-t-meta">gather sources</span>
        </span>
      </button>
      <span class="stage-connector" aria-hidden="true"></span>
      <button class="stage-pill" data-stage="discover" role="tab" aria-selected="false">
        <span class="stage-index">2</span>
        <span class="stage-body">
          <span class="stage-name">Discover</span>
          <span class="stage-hint rg-t-meta">explore findings</span>
        </span>
      </button>
      <span class="stage-connector" aria-hidden="true"></span>
      <button class="stage-pill" data-stage="act" role="tab" aria-selected="false">
        <span class="stage-index">3</span>
        <span class="stage-body">
          <span class="stage-name">Act</span>
          <span class="stage-hint rg-t-meta">decide &amp; ship</span>
        </span>
      </button>
    </div>

    <!-- Intent action-ladder card (per-topic deliverable routing).
         Spec: docs/superpowers/specs/2026-04-21-intent-layer.md.
         Shows the user WHAT they're producing + 3-4 steps to get there.
         Lives below the stage rail — stage rail is visual workflow cue,
         intent ladder is the actionable "your deliverable" card. -->
    <div id="intent-ladder-host"></div>

    <!-- Phase-11 tab cleanup: 4 primary tabs always visible, everything
         else in a "More ▾" dropdown. Primaries were picked from actual
         usage (Insights=core output, Bets=weekly ritual,
         Evidence=drilldown, Chat=follow-up) per PRODUCT_GAPS.md §3.1 -->
    <div class="tabs" id="topic-tabs">
      <button class="tab active" data-tab="insights"><i data-lucide="sparkles"></i> Insights</button>
      <button class="tab" data-tab="bets"><i data-lucide="target"></i> Bets</button>
      <button class="tab" data-tab="evidence"><i data-lucide="search"></i> Evidence</button>
      <button class="tab" data-tab="chat"><i data-lucide="message-square"></i> Chat</button>
      <div class="tab-more-wrap">
        <button class="tab tab-more" id="tab-more-toggle" aria-haspopup="true" aria-expanded="false">
          <i data-lucide="more-horizontal"></i> More <i data-lucide="chevron-down"></i>
        </button>
        <div class="tab-more-menu" id="tab-more-menu" hidden>
          <button class="tab-more-item" data-tab="map"><i data-lucide="network"></i> Map</button>
          <button class="tab-more-item" data-tab="report"><i data-lucide="file-text"></i> Report</button>
          <button class="tab-more-item" data-tab="trends"><i data-lucide="trending-up"></i> Trends</button>
          <button class="tab-more-item" data-tab="sentiment"><i data-lucide="smile"></i> Sentiment</button>
          <button class="tab-more-item" data-tab="sources"><i data-lucide="boxes"></i> Sources</button>
          <button class="tab-more-item" data-tab="posts"><i data-lucide="list"></i> Posts</button>
          <button class="tab-more-item" data-tab="research"><i data-lucide="book-open"></i> Research</button>
          <button class="tab-more-item" data-tab="solutions"><i data-lucide="flask-conical"></i> Solutions</button>
          <button class="tab-more-item" data-tab="concepts"><i data-lucide="lightbulb"></i> Concepts</button>
          <button class="tab-more-item" data-tab="papers"><i data-lucide="book-marked"></i> Papers</button>
          <button class="tab-more-item" data-tab="actions"><i data-lucide="zap"></i> Actions</button>
        </div>
      </div>
    </div>

    <div id="tab-content"><div class="empty-state">loading…</div></div>
  `;

  const tabsEl = $('#topic-tabs');
  const contentEl = $('#tab-content');
  window.refreshIcons?.();

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
        const rows = await api.runQuery(
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
        );
        return (Array.isArray(rows) && rows[0]) || {};
      } catch {
        return {};
      }
    })();
    return _topicStatsPromise;
  }

  // Fetch header counts + sub text once — non-blocking.
  (async () => {
    const r = await topicStats();
    const host = $('#topic-header-stats');
    if (!host) return;
    host.innerHTML = `
      <span class="th-chip"><b>${(r.posts || 0).toLocaleString()}</b> posts</span>
      <span class="th-chip"><b>${r.painpoints || 0}</b> pains</span>
      <span class="th-chip"><b>${r.workarounds || 0}</b> DIY</span>
      <span class="th-chip"><b>${r.sources || 0}</b> src</span>`;
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
                          b?.google?.set || b?.ollama_base_url);
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
    // If the currently-visible tab was gated on LLM (chat/evidence), refresh it.
    if (activeTab === 'chat' || activeTab === 'evidence' || activeTab === 'map') {
      loaders[activeTab]?.();
    }
  }));

  // Preload tab data in the background — populates the api.js cache so that
  // clicking Evidence / Sources / Chat paints instantly instead of waiting
  // on a cold Python process spawn. Fire-and-forget; errors are swallowed
  // (the tab-click path re-runs with proper UI feedback on failure).
  const srcSql = `SELECT coalesce(p.source_type,'reddit') AS source, count(*) AS posts,
                         min(p.created_utc) AS earliest, max(p.created_utc) AS latest
                  FROM topic_posts tp JOIN posts p ON p.id=tp.post_id
                  WHERE tp.topic=:topic
                  GROUP BY coalesce(p.source_type,'reddit')
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

  async function runEnrichFromMap() {
    const btn = $('#btn-map-enrich');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2"></i> Enriching…'; window.refreshIcons?.(); }
    let errMsg = '';
    let alreadyRunning = false;
    try {
      const e = await api.enrichGraph(topic);
      if (e?.already_running) {
        alreadyRunning = true;
      } else if (e?.skipped) {
        errMsg = `Enrichment skipped: ${e.reason || 'no LLM configured'}`;
      } else if (e?.ok === false) {
        errMsg = `Enrichment failed: ${e.error || 'unknown'}`;
      }
    } catch (err) {
      errMsg = `Enrichment errored: ${err?.message || err}`;
    }
    // Rust-side dedup guard: another enrich for this topic is already in
    // flight. Friendly info toast, don't reload the Map (that would reset
    // the "Enriching…" spinner and invite a re-click).
    if (alreadyRunning) {
      showToast('Already running', 'Another enrichment for this topic is in progress. Wait for it to finish.', 'warn');
      return;
    }
    if (errMsg) showToast('Enrichment issue', errMsg, 'warn');
    loadMap();
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
      if (e?.skipped)      errMsg = `Extraction skipped: ${e.reason || 'no LLM configured'}`;
      else if (e?.ok === false) errMsg = `Extraction failed: ${e.error || 'unknown'}`;
      else {
        const np = e?.painpoints_added     ?? e?.painpoints     ?? 0;
        const nf = e?.feature_wishes_added ?? e?.feature_wishes ?? 0;
        const nw = e?.workarounds_added    ?? e?.diy_workarounds ?? 0;
        added = np + nf + nw;
        if (added === 0) errMsg = 'Extraction ran but found no painpoints/features — try Re-run collect to gather more posts.';
      }
    } catch (err) {
      errMsg = `Extraction errored: ${err?.message || err}`;
    }
    if (errMsg) showToast('Extraction issue', errMsg, 'warn');
    else if (added > 0) showToast('Extraction complete', `${added} new finding${added === 1 ? '' : 's'}`, 'ok');
    onDone?.();
  }

  async function loadMap(force = false) {
    // Gated write — drop any innerHTML write that would land after the user
    // already clicked away to another tab. Keeps loadMap's slow post-await
    // graph-build render from overwriting, say, loadReport's skeleton.
    const set = (html) => { if (contentEl.dataset.tab === 'map') contentEl.innerHTML = html; };
    // Graph stats strip — fetched before render, shown above the map when graph has nodes.
    let statsStripHtml = '';
    try {
      // Edge count comes from the unified topicStats round-trip; only the
      // per-kind breakdown needs its own sidecar spawn since topicStats
      // only carries the four main finding kinds.
      const [nodeRows, stats] = await Promise.all([
        api.runQuery(
          "SELECT kind, count(*) AS n FROM graph_nodes WHERE topic = :topic AND kind NOT IN ('topic','post') GROUP BY kind ORDER BY n DESC",
          topic,
        ),
        topicStats(),
      ]);
      const nodes = Array.isArray(nodeRows) ? nodeRows : [];
      const edgeCount = Number(stats.n_edges || 0);
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
        statsStripHtml = `<div class="graph-stats-strip">${chips}<span class="graph-stat-edges">· <b>${edgeCount}</b> edges</span></div>`;
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
      }

      // 2. Auto-enrich if we have an LLM key and no findings yet.
      //    Runs IN BACKGROUND — the map renders immediately with structural
      //    data, and the iframe reloads if enrich adds painpoints. Previously
      //    this `await`ed enrich inline, so a slow/stuck Ollama (first-load
      //    cold start, model pinned at 100% CPU on a prior request, etc.)
      //    would block the map tab from ever rendering at all.
      const [findingsBefore, anyReady] = await Promise.all([countFindings(), checkLlmReady()]);
      if (findingsBefore === 0 && anyReady) {
        enrichBanner = `<div class="map-enrich-banner info" id="map-enrich-banner">
          <span class="map-building-spinner" style="width:14px;height:14px;border-width:2px;flex-shrink:0"></span>
          <span>Extracting painpoints in the background via LLM — the map will refresh when findings are ready (20–90s).</span>
        </div>`;
        // Fire-and-forget enrich. When it resolves we re-render the map so
        // the new graph_node counts surface + iframe reloads with the
        // updated gap-map HTML.
        (async () => {
          try {
            const e = await api.enrichGraph(topic);
            if (contentEl.dataset.tab !== 'map') return;
            const banner = document.getElementById('map-enrich-banner');
            if (!banner) return;
            if (e?.skipped) {
              banner.className = 'map-enrich-banner warn';
              banner.innerHTML = `⚠ Enrichment skipped — ${esc(e.reason || 'no LLM configured')}`;
            } else if (e?.ok === false) {
              banner.className = 'map-enrich-banner err';
              banner.innerHTML = `✗ Enrichment failed — ${esc(e.error || 'unknown')}`;
            } else {
              const np = e?.painpoints_added ?? e?.painpoints ?? 0;
              const nf = e?.feature_wishes_added ?? e?.feature_wishes ?? 0;
              const nw = e?.workarounds_added ?? e?.diy_workarounds ?? 0;
              if ((np + nf + nw) === 0) {
                banner.className = 'map-enrich-banner warn';
                banner.innerHTML = `⚠ Enrichment found 0 painpoints. Try <b>Rerun collect</b> to gather more posts.`;
              } else {
                banner.className = 'map-enrich-banner ok';
                banner.innerHTML = `✓ Enrichment added ${np} painpoints, ${nf} feature wishes, ${nw} workarounds — reloading map…`;
                _topicStatsPromise = null;
                // Rebuild export + reload iframe to surface the new findings.
                try {
                  const newPath = await api.exportHtml(topic);
                  const iframe = contentEl.querySelector('iframe.viewer-frame');
                  if (iframe && contentEl.dataset.tab === 'map') {
                    iframe.src = convertFileSrc(newPath) + `?t=${Date.now()}`;
                  }
                } catch {}
              }
            }
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
        api.exportHtml(topic, force),
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
        <div class="map-toolbar">
          <div class="map-toolbar-info">
            <span class="th-chip"><b>${nodeCount.toLocaleString()}</b> nodes</span>
            <span class="th-chip"><b>${edgeCount.toLocaleString()}</b> edges</span>
            ${findingsChip}
          </div>
          <div style="flex:1"></div>
          ${anyReady ? `<button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-map-enrich" title="Re-run LLM extraction"><i data-lucide="sparkles"></i> Enrich</button>` : ''}
          <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-map-rebuild"><i data-lucide="rotate-cw"></i> Rebuild</button>
          <button class="btn btn-ghost btn-sm btn-bordered" id="btn-map-reveal">Reveal</button>
          <button class="btn btn-ghost btn-sm btn-bordered" id="btn-map-open-ext">Open in browser</button>
        </div>
        ${enrichBanner}
        <iframe class="viewer-frame" src="${fileUrl}?t=${Date.now()}" sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"></iframe>`);
      if (contentEl.dataset.tab !== 'map') return;
      window.refreshIcons?.();
      $('#btn-map-rebuild').onclick  = () => loadMap(true);
      $('#btn-map-reveal').onclick   = () => api.revealInFinder(outPath);
      $('#btn-map-open-ext').onclick = () => api.openUrl(`file://${encodeURI(outPath)}`);
      $('#btn-map-enrich')?.addEventListener('click', () => runEnrichFromMap());
      $('#btn-map-add-key')?.addEventListener('click', () => openByokModal(() => loadMap()));
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
    }
  }

  // ─── Report ───────────────────────────────────────────────────────────
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
      set(`
        <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
          <button class="btn btn-ghost icon-btn" style="border:1px solid var(--line)" id="btn-copy-md"><i data-lucide="copy"></i> Copy markdown</button>
          <button class="btn btn-ghost" style="border:1px solid var(--line)" id="btn-reveal-md">Reveal in Finder</button>
          <button class="btn btn-ghost icon-btn" style="border:1px solid var(--line)" id="btn-regen-md"><i data-lucide="rotate-cw"></i> Regenerate</button>
        </div>
        <div class="markdown-view">${renderMarkdown(md)}</div>
      `);
      if (contentEl.dataset.tab !== 'report') return;
      window.refreshIcons?.();
      $('#btn-copy-md').onclick = () => {
        navigator.clipboard.writeText(md);
        const b = $('#btn-copy-md');
        b.innerHTML = '<i data-lucide="check"></i> Copied';
        window.refreshIcons?.();
        setTimeout(() => { b.innerHTML = '<i data-lucide="copy"></i> Copy markdown'; window.refreshIcons?.(); }, 1500);
      };
      $('#btn-reveal-md').onclick = () => api.revealInFinder(path);
      $('#btn-regen-md').onclick  = () => loadReport();
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
    set(skeletonCards(3));
    try {
      // All four kinds in ONE sidecar call (was 4 parallel Python spawns).
      // SQL is hoisted to `combinedFindingsSql` above so this call shares a
      // cache key with the mount-time preload — first click paints instantly.
      const rows = await api.runQuery(combinedFindingsSql, topic);
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
        if (llmReady) {
          emptyHtml = `
            <div class="empty-big">
              <h3>No extraction has run yet on this topic</h3>
              <p>Your LLM provider is configured. Run extraction now to pull painpoints, DIY workarounds, competitor mentions, and feature wishes out of the corpus.</p>
              <button class="btn btn-primary icon-btn" id="btn-ev-enrich"><i data-lucide="sparkles"></i> Run extraction now</button>
            </div>`;
          emptyWire = () => $('#btn-ev-enrich')?.addEventListener('click', () =>
            runEnrichHere('#btn-ev-enrich', () => loadEvidence()));
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
    set(skeletonCards(2));
    try {
      // Parameterized — topic goes in safely via :topic, no string concat.
      const srcSql = `SELECT coalesce(p.source_type,'reddit') AS source, count(*) AS posts,
                             min(p.created_utc) AS earliest, max(p.created_utc) AS latest
                      FROM topic_posts tp JOIN posts p ON p.id=tp.post_id
                      WHERE tp.topic=:topic
                      GROUP BY coalesce(p.source_type,'reddit')
                      ORDER BY posts DESC`;
      // Pull up to 60 subs — frontend paginates with a show-more button.
      const subsSql = `SELECT p.sub AS sub, count(*) AS posts
                       FROM topic_posts tp JOIN posts p ON p.id=tp.post_id
                       WHERE tp.topic=:topic
                         AND p.sub IS NOT NULL AND p.sub <> ''
                       GROUP BY p.sub ORDER BY posts DESC LIMIT 60`;
      const [sources, subs] = await Promise.all([
        api.runQuery(srcSql, topic),
        api.runQuery(subsSql, topic).catch(() => []),
      ]);
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
              <span>${r.posts.toLocaleString()} posts · ${pct}% <span style="color:var(--ink-3);font-weight:500;font-size:var(--fs-11)">· view all →</span></span>
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
        const badge = `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${c.bg};color:${c.fg};font-size:var(--fs-11);font-weight:700;letter-spacing:.03em">${esc(SRC_LABELS[r.source] || r.source)}</span>`;
        const title = esc((r.title || '(untitled)').slice(0, 160));
        const excerpt = esc((r.excerpt || '').trim().slice(0, 260));
        const analysis = analysesByPostId.get(r.id);
        const analysisHtml = analysis ? `
          <div class="paper-analysis" data-post-id="${esc(r.id)}" style="margin-top:10px;padding:10px 12px;background:var(--surface-2);border-radius:var(--radius-sm);border:1px solid var(--line)">
            <div style="font-size:var(--fs-11);color:var(--ink-3);margin-bottom:4px;letter-spacing:.04em;text-transform:uppercase">📘 Summary</div>
            <div style="font-size:var(--fs-13);color:var(--ink);line-height:1.5;margin-bottom:8px">${esc(analysis.summary || '')}</div>
            <div style="font-size:var(--fs-11);color:var(--ink-3);margin-bottom:4px;letter-spacing:.04em;text-transform:uppercase">🎯 Why this matters for "${esc(topic)}"</div>
            <div style="font-size:var(--fs-13);color:var(--ink-2);line-height:1.5;margin-bottom:8px">${esc(analysis.relevance || '')}</div>
            <div style="font-size:var(--fs-11);color:var(--ink-3);margin-bottom:4px;letter-spacing:.04em;text-transform:uppercase">🔨 Builder takeaway</div>
            <div style="font-size:var(--fs-13);color:var(--ink);line-height:1.5;background:var(--gold-soft);padding:6px 10px;border-radius:8px;border-left:3px solid var(--gold)"><b>${esc(analysis.takeaway || '')}</b></div>
          </div>` : `
          <div class="paper-analyze-row" data-post-id="${esc(r.id)}" style="margin-top:10px">
            <button class="btn btn-ghost btn-sm btn-bordered paper-analyze-btn" data-analyze="${esc(r.id)}"><i data-lucide="sparkles"></i> Analyze</button>
          </div>`;
        const url = r.url || r.permalink || '';
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
                <div style="margin-bottom:6px">${badge}<span style="color:var(--ink-3);font-size:var(--fs-11);margin-left:8px">${cites}${esc(date)}${authorStr}</span></div>
                <h4 style="font-size:var(--fs-15);font-weight:700;line-height:1.35;margin-bottom:4px">${title}</h4>
                ${excerpt ? `<p style="font-size:var(--fs-13);color:var(--ink-2);line-height:1.5">${excerpt}…</p>` : ''}
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
          <span style="margin-left:auto;font-size:var(--fs-11);color:var(--ink-3);margin-right:10px">${rows.length} paper${rows.length === 1 ? '' : 's'} total · ${analysesByPostId.size} analyzed</span>
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
                <h3>${esc(SRC_LABELS[src] || src)} <span style="color:var(--ink-3);font-weight:500;font-size:var(--fs-13)">· ${items.length} item${items.length === 1 ? '' : 's'}</span></h3>
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

  async function loadChat() {
    const set = (html) => { if (contentEl.dataset.tab === 'chat') contentEl.innerHTML = html; };
    // Gate 1: need an LLM key.
    let byok = {};
    try { byok = await api.byokStatus(); } catch {}
    if (contentEl.dataset.tab !== 'chat') return;
    const anyReady =
      byok?.anthropic?.set || byok?.openai?.set || byok?.openrouter?.set ||
      byok?.groq?.set || byok?.deepseek?.set || byok?.mistral?.set ||
      byok?.google?.set || !!byok?.ollama_base_url;

    // Gate 2: need a populated graph — chat reads painpoints/features/workarounds
    // from graph_nodes. If count is 0 the LLM gets no data and returns garbage.
    let findingsCount = 0;
    try {
      const rows = await api.runQuery(
        `SELECT count(*) AS n FROM graph_nodes
         WHERE topic=:topic
           AND kind IN ('painpoint','feature_wish','workaround','product')`,
        topic,
      );
      findingsCount = Array.isArray(rows) && rows[0]?.n ? Number(rows[0].n) : 0;
    } catch {}
    if (anyReady && findingsCount === 0) {
      if (contentEl.dataset.tab !== 'chat') return;
      set(`
        <div class="empty-big" style="margin:18px 0">
          <h3>Gap map not built yet</h3>
          <p>Chat needs painpoints, features, and workarounds to ground its answers.
             This topic has no semantic nodes yet — run the extractor against the corpus.</p>
          <div style="display:flex;gap:10px;justify-content:center;margin-top:14px">
            <button class="btn btn-primary" id="btn-chat-build">Build gap map now</button>
            <button class="btn btn-ghost" id="btn-chat-rerun" style="border:1px solid var(--line)">Re-run collect</button>
          </div>
        </div>`);
      $('#btn-chat-build').onclick = async () => {
        const btn = $('#btn-chat-build');
        btn.disabled = true; btn.textContent = 'Building…';
        try {
          await api.buildGraph(topic);
          await api.enrichGraph(topic);
          loadChat();  // re-check gates
        } catch (e) {
          showToast('Build failed', e?.message || String(e), 'err');
          btn.disabled = false; btn.textContent = 'Build gap map now';
        }
      };
      $('#btn-chat-rerun').onclick = () => { location.hash = `#/collect/${encodeURIComponent(topic)}`; };
      return;
    }

    const providerLabel = (byok?.llm_provider || '').toString().toUpperCase() || 'auto-detect';
    const modelLabel = byok?.llm_model || 'default';

    const agentDefault = localStorage.getItem('gapmap.chat.agent') === 'true';
    if (contentEl.dataset.tab !== 'chat') return;

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
      if (byok?.ollama_base_url) configured.push('Ollama');
      const statusLine = configured.length
        ? `<p style="color:var(--ink-2);font-size:var(--fs-13);margin:6px 0 0"><b>${configured.length}</b> provider${configured.length>1?'s':''} configured: ${esc(configured.join(', '))} — but no default picked.</p>`
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

          <div class="chat-messages" id="chat-messages"></div>

          <div class="chat-input-row">
            <textarea id="chat-input" rows="2" placeholder='Ask a question about this topic — e.g. "what do users DIY today?"'></textarea>
            <button class="btn btn-primary btn-sm" id="btn-chat-send">Send</button>
            <button class="btn btn-ghost btn-sm btn-bordered" id="btn-chat-cancel" hidden>Stop</button>
          </div>`;
    }

    set(`
      <div class="chat-wrap">
        <div class="chat-head">
          <div>
            <h3 style="margin:0 0 2px">Chat with this gap map</h3>
            <p style="margin:0;color:var(--ink-3);font-size:var(--fs-13)">
              ${anyReady
                ? `Provider: <b>${esc(providerLabel)}</b> · Model: <b>${esc(modelLabel)}</b>`
                : '<span style="color:#B84747">No LLM key configured yet.</span>'}
            </p>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <label class="mode-toggle" title="Agent mode — LLM can call tools to explore the database (Anthropic only)">
              <input type="checkbox" id="chat-agent" ${agentDefault ? 'checked' : ''} />
              <span>🤖 Agent</span>
            </label>
            <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-chat-keys"><i data-lucide="key-round"></i> Keys</button>
            <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-chat-export" title="Download the conversation as markdown"><i data-lucide="download"></i> Export</button>
            <button class="btn btn-ghost btn-sm btn-bordered" id="btn-chat-clear">Clear</button>
          </div>
        </div>

        ${chatMainHtml}
      </div>
    `);

    // Header actions always available
    $('#btn-chat-keys')?.addEventListener('click', () => openByokModal(() => loadChat()));
    $('#btn-chat-clear')?.addEventListener('click', () => {
      chatHistory.set(topic, []);
      saveChatHistory(topic);
      renderMessages();
    });
    $('#btn-chat-add-key')?.addEventListener('click', () => openByokModal(() => loadChat()));
    $('#chat-agent')?.addEventListener('change', (e) => {
      localStorage.setItem('gapmap.chat.agent', e.target.checked ? 'true' : 'false');
    });

    if (!anyReady) return;

    // Render any prior messages for this topic
    renderMessages();

    // Wire input
    const input = $('#chat-input');
    const sendBtn = $('#btn-chat-send');
    const cancelBtn = $('#btn-chat-cancel');

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
      // Enter = send, Shift+Enter = newline. Cmd/Ctrl+Enter still works.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendFromInput();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        sendFromInput();
      }
    });
    cancelBtn.onclick = async () => {
      try { await api.cancelChat(); } catch {}
    };
    contentEl.querySelectorAll('.chat-preset').forEach(btn => {
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
          md.push(`## 🧑 ${m.mode || 'ask'}${ts ? ` · ${ts}` : ''}`);
          if (m.text) md.push(m.text);
          md.push('');
        } else {
          md.push(`## 🤖 assistant${ts ? ` · ${ts}` : ''}`);
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
        if (Number.isFinite(ts)) el.textContent = timeAgo(ts / 1000);
      });
    }, 30000);
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
    const tsHtml = m.ts ? `<div class="chat-msg-ts" ${tsAttr}>${timeAgo(m.ts / 1000)}</div>` : '';
    if (m.role === 'user') {
      return `<div class="chat-msg chat-msg-user" data-idx="${index}">
        <div class="chat-msg-ic">🧑</div>
        <div class="chat-msg-body"><b>${esc(m.mode || 'ask')}</b>${m.text ? `<div>${esc(m.text)}</div>` : ''}${tsHtml}</div>
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
      <div class="chat-msg-ic">🤖</div>
      <div class="chat-msg-body markdown-view">${assistantInnerHtml(m, isStreaming)}${tsHtml}</div>
    </div>`;
  }

  async function send(mode, question) {
    const agent = document.getElementById('chat-agent')?.checked || false;
    const hist = loadChatHistory(topic);
    const now = Date.now();
    hist.push({ role: 'user', mode: agent ? `agent · ${mode}` : mode, text: question, ts: now });
    hist.push({ role: 'assistant', mode, text: '', toolCalls: [], ts: now });
    chatHistory.set(topic, hist);
    saveChatHistory(topic);
    renderMessages();

    // UI state
    const sendBtn = $('#btn-chat-send');
    const cancelBtn = $('#btn-chat-cancel');
    const presets = contentEl.querySelectorAll('.chat-preset');
    if (sendBtn)   sendBtn.disabled = true;
    if (cancelBtn) cancelBtn.hidden = false;
    presets.forEach(p => p.disabled = true);

    chatStream.active = true;
    chatStream.buffer = '';

    // Subscribe to events BEFORE starting
    chatStream.unlistenProgress = await api.onChatProgress(line => {
      handleChatLine(line);
    });
    chatStream.unlistenDone = await api.onChatDone(async (_payload) => {
      // Cleanup
      try { chatStream.unlistenProgress?.(); } catch {}
      try { chatStream.unlistenDone?.(); } catch {}
      chatStream.unlistenProgress = null;
      chatStream.unlistenDone = null;
      chatStream.active = false;
      if (sendBtn)   sendBtn.disabled = false;
      if (cancelBtn) cancelBtn.hidden = true;
      presets.forEach(p => p.disabled = false);
      // Persist the completed assistant turn to localStorage.
      saveChatHistory(topic);
    });

    try {
      await api.startChat(topic, question, mode, agent);
    } catch (e) {
      const h = chatHistory.get(topic) || [];
      const last = h[h.length - 1];
      if (last && last.role === 'assistant') last.text = `✗ Failed to start chat: ${e?.message || e}`;
      renderMessages();
      try { chatStream.unlistenProgress?.(); } catch {}
      try { chatStream.unlistenDone?.(); } catch {}
      chatStream.active = false;
      if (sendBtn)   sendBtn.disabled = false;
      if (cancelBtn) cancelBtn.hidden = true;
      presets.forEach(p => p.disabled = false);
    }
  }

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
    } else if (ev.event === 'tool_call') {
      last.toolCalls = last.toolCalls || [];
      last.toolCalls.push({ id: ev.id, name: ev.name, input: ev.input, output: null });
      renderAssistantInPlace(last);
    } else if (ev.event === 'tool_result') {
      const tc = (last.toolCalls || []).find(x => x.id === ev.id);
      if (tc) tc.output = ev.output;
      renderAssistantInPlace(last);
    } else if (ev.event === 'error') {
      last.text = (last.text || '') + `\n\n✗ Error: ${ev.error}`;
      renderMessages();
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
      ? `<div class="chat-msg-ts" data-ts="${last.ts}">${timeAgo(last.ts / 1000)}</div>`
      : '';
    bodyEl.innerHTML = assistantInnerHtml(last, chatStream.active) + tsHtml;
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
    contentEl.innerHTML = `
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
          <h4>Export artifacts</h4>
          <p>Generate shareable HTML + citation-rich markdown.</p>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn btn-primary btn-sm" id="btn-export-html">Export HTML</button>
            <button class="btn btn-ghost btn-sm btn-bordered" id="btn-export-md">Export report.md</button>
            <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-export-graph-json"><i data-lucide="braces"></i> Export graph JSON</button>
          </div>
          <div id="export-status" style="margin-top:10px;font-size:var(--fs-13);color:var(--ink-3)"></div>
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
        <p class="muted" style="font-size:var(--fs-13);margin-bottom:10px">
          Preview-only LLM extraction without building the full graph. Use this to sniff-test LLM output before committing to a full <b>Build &amp; enrich</b>.
        </p>
        <button class="btn btn-primary btn-sm icon-btn" id="btn-quick-extract">
          <i data-lucide="zap"></i> Quick extract gaps
        </button>
        <div id="quick-extract-status" class="muted" style="margin-top:8px;font-size:var(--fs-13)"></div>
        <div id="quick-extract-panel" class="quick-extract-panel" hidden></div>
      </div>
    `;
    contentEl.querySelector('.settings-grid').insertAdjacentHTML('afterend', quickHtml);
    contentEl.querySelector('[data-route="collect"]').onclick = () => { location.hash = `#/collect/${encodeURIComponent(topic)}`; };
    contentEl.querySelector('[data-route="ingest"]').onclick  = () => { location.hash = '#/ingest'; };
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
    window.refreshIcons?.();
  }

  // ─── tab switching ────────────────────────────────────────────────────
  const loaders = {
    insights: () => loadInsights(contentEl, topic),
    bets: () => loadBets(contentEl, topic),
    map: loadMap, report: loadReport, evidence: loadEvidence,
    sources: loadSources, research: loadResearch, chat: loadChat, actions: loadActions,
    solutions: () => loadSolutions(contentEl, topic),
    concepts: () => loadConcepts(contentEl, topic),
    papers:   () => loadPapers(contentEl, topic),
    trends: () => loadTrends(contentEl, topic),
    posts: () => loadPosts(contentEl, topic),
    sentiment: () => loadSentiment(contentEl, topic),
  };
  // Tab-generation counter. Every click bumps it. Loaders already close over
  // `activeTab` — they can check `activeTab === 'map'` before innerHTML writes
  // to self-suppress once the user moved on. What this counter adds: the
  // switchTab caller only refreshes icons + applies final style if its gen
  // is still current, so rapid clicks (B before A's async work settles) don't
  // trigger ghost renders.
  let tabGen = 0;

  // L2 — stage grouping. Each existing tab belongs to exactly one stage.
  // Rail state updates live on every switchTab call. Click a stage pill
  // to jump to its first tab.
  const TAB_STAGE_MAP = {
    // Collect — what was fetched
    sources: 'collect',
    posts:   'collect',
    // Discover — explore the corpus
    map:      'discover',
    evidence: 'discover',
    research: 'discover',
    trends:   'discover',
    sentiment:'discover',
    chat:     'discover',
    // Act — the output side
    insights: 'act',
    solutions:'act',
    bets:     'act',
    concepts: 'act',
    actions:  'act',
    report:   'act',
  };
  const STAGE_LABELS = {
    collect:  'Collect',
    discover: 'Discover',
    act:      'Act',
  };
  const STAGE_ORDER = ['collect', 'discover', 'act'];
  const STAGE_FIRST_TAB = {
    collect:  'sources',
    discover: 'map',
    act:      'insights',
  };
  const TAB_LABELS = {
    sources: 'Sources', posts: 'Posts',
    map: 'Map', evidence: 'Evidence', research: 'Research',
    trends: 'Trends', sentiment: 'Sentiment', chat: 'Chat',
    insights: 'Insights', solutions: 'Solutions', bets: 'Bets',
    concepts: 'Concepts', actions: 'Actions', report: 'Report',
  };
  const stagesRoot = $('#topic-stages', root) || document.getElementById('topic-stages');
  const crumbStage = document.getElementById('tb-stage');
  const crumbTab   = document.getElementById('tb-tab');

  function syncTopicStage(tabName) {
    const stage = TAB_STAGE_MAP[tabName] || 'discover';
    if (crumbStage) crumbStage.textContent = STAGE_LABELS[stage] || '—';
    if (crumbTab)   crumbTab.textContent   = TAB_LABELS[tabName] || tabName;
    if (!stagesRoot) return;
    const stageIdx = STAGE_ORDER.indexOf(stage);
    stagesRoot.querySelectorAll('.stage-pill').forEach(p => {
      const pStage = p.dataset.stage;
      const pIdx = STAGE_ORDER.indexOf(pStage);
      p.classList.toggle('stage-pill-active', pStage === stage);
      p.classList.toggle('stage-pill-done',   pIdx >= 0 && pIdx < stageIdx);
      p.setAttribute('aria-selected', pStage === stage ? 'true' : 'false');
    });
    stagesRoot.querySelectorAll('.stage-connector').forEach((c, i) => {
      // i=0 between stages 0-1, i=1 between stages 1-2
      c.classList.toggle('stage-connector-done', stageIdx > i);
    });
  }

  // Wire stage clicks — jump to the stage's first tab.
  stagesRoot?.querySelectorAll('.stage-pill').forEach(p => {
    p.addEventListener('click', () => {
      const s = p.dataset.stage;
      const t = STAGE_FIRST_TAB[s];
      if (t) switchTabViaStage(t);
    });
  });
  function switchTabViaStage(t) {
    // Defer to the real switchTab (defined a few lines below). Use a
    // micro-queue so the function is available by the time this fires.
    queueMicrotask(() => switchTab?.(t));
  }
  const switchTab = async (name) => {
    const myGen = ++tabGen;
    // Clean up chat listeners if we're leaving chat mid-stream
    if (activeTab === 'chat' && name !== 'chat') {
      try { chatStream.unlistenProgress?.(); } catch {}
      try { chatStream.unlistenDone?.(); } catch {}
      if (chatTsInterval) { clearInterval(chatTsInterval); chatTsInterval = null; }
    }
    activeTab = name;
    // Stamp the content container with the current tab name so any loader's
    // deferred DOM write (finished after a rapid tab switch) can self-check
    // `contentEl.dataset.tab === 'map'` before stomping on the new tab's
    // render. See `writeIfTab()` helper further down — the fix for stale
    // tab content was spec'd here on 2026-04-20.
    contentEl.dataset.tab = name;
    // Highlight primary tabs by data-tab match. Also highlight the More
    // button when a non-primary tab is active, so the user can see their
    // current location even for tabs inside the dropdown.
    const primaryTabs = new Set(['insights', 'bets', 'evidence', 'chat']);
    tabsEl.querySelectorAll('.tab:not(.tab-more)').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === name)
    );
    const moreBtn = tabsEl.querySelector('.tab-more');
    if (moreBtn) moreBtn.classList.toggle('active', !primaryTabs.has(name));

    // L2 — keep stage rail + breadcrumbs in sync with the active tab.
    syncTopicStage(name);
    // Synchronous placeholder so the old tab's content disappears the moment
    // the user clicks — before the loader's first await. Without this the
    // screen looks hung if the loader takes more than ~100 ms to produce
    // its first innerHTML write (which map/evidence often do on cold cache).
    contentEl.innerHTML = `
      <div class="empty-state" style="padding:40px;text-align:center">
        <div class="map-building-spinner" style="margin:0 auto 10px"></div>
        <div style="color:var(--ink-3);font-size:var(--fs-13)">Loading ${esc(name)}…</div>
      </div>`;
    try {
      await loaders[name]?.();
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
  tabsEl.querySelectorAll('.tab:not(.tab-more)').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
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
  let defaultTab = 'insights';
  try {
    const intentPayload = await api.topicIntentGet(topic);
    defaultTab = intentPayload?.preset?.default_tab || 'insights';
    const ladderHost = document.getElementById('intent-ladder-host');
    if (ladderHost) {
      mountIntentLadder(ladderHost, topic, {
        goToTab: (name) => switchTab(name),
      });
    }
  } catch {
    // Intent layer is additive — any failure falls back to pre-intent flow.
  }
  await switchTab(defaultTab);
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
    return `<span class="finding-src-badge" data-source="${esc(src)}" title="Click to see ${n} ${esc(cfg.label)} posts backing this finding" style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:10px;background:${cfg.bg};color:${cfg.fg};font-size:var(--fs-11);font-weight:600;margin-right:4px;cursor:pointer;user-select:none"><b>${n}</b> ${esc(cfg.label)}</span>`;
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
  return s
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}
