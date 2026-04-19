// Topic detail — 6 tabs: Map · Report · Evidence · Sources · Chat · Actions.
// The chat tab streams tokens from the Python sidecar via `chat:progress`
// events; backend is the `research chat` CLI command.

import { api, $, esc, timeAgo } from '../api.js';
import { convertFileSrc } from '@tauri-apps/api/core';
import { openByokModal } from './byok.js';
import { loadSolutions } from './solutions.js';
import { loadTrends } from './trends.js';
import { loadPosts } from './posts.js';

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
  const remove = () => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); };
  el.querySelector('.toast-close').onclick = remove;
  if (ms) setTimeout(remove, ms);
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
];

const GROUP_LABELS = {
  social:  'Social / forums',
  dev:     'Developer',
  science: 'Scientific literature',
  web:     'Web / news / trends',
  apps:    'App stores',
};

async function detectExistingSources(topic) {
  // Returns Set<sourceId> of sources that already have posts for this topic.
  try {
    const rows = await api.runQuery(
      `SELECT DISTINCT coalesce(p.source_type, 'reddit') AS src
         FROM topic_posts tp JOIN posts p ON p.id = tp.post_id
         WHERE tp.topic = :topic`,
      topic,
    );
    return new Set((rows || []).map(r => (r.src || 'reddit').toLowerCase()));
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
    // Navigate to the live progress screen FIRST so its event listeners attach
    // before the sidecar emits its first event.
    location.hash = `#/collect/${encodeURIComponent(topic)}`;
    // Give the route + listeners a tick to mount, then fire collect.
    setTimeout(() => {
      api.startCollect(
        topic,
        aggressive,
        externalSources.length > 0 ? externalSources.join(',') : null,
        !includeReddit,
      ).catch(err => {
        showToast('Failed to start collect', err?.message || String(err), 'err');
      });
    }, 50);
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

export async function renderTopic(root, { params }) {
  const topic = decodeURIComponent(params[0] || '');
  // Per-instance tab state (fix: module-level state leaked between topics).
  let activeTab = 'map';
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
      <label id="schedule-topic-toggle" style="margin:0;padding:4px 10px;font-size:12px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;border:1px solid var(--line);border-radius:8px" title="Include this topic in scheduled re-runs">
        <input type="checkbox" id="cb-schedule-topic" style="margin:0" />
        <span style="font-weight:500">Auto-refresh</span>
      </label>
      <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-rerun"><i data-lucide="rotate-cw"></i> Rerun collect</button>
      <button class="btn btn-ghost btn-sm btn-bordered" id="btn-delete" style="color:#B84747">Delete</button>
    </header>

    <div class="section-head">
      <div><h2>${esc(topic)}</h2><p id="topic-sub">Loading topic…</p></div>
    </div>

    <div class="tabs" id="topic-tabs">
      <button class="tab active" data-tab="map"><i data-lucide="network"></i> Map</button>
      <button class="tab" data-tab="report"><i data-lucide="file-text"></i> Report</button>
      <button class="tab" data-tab="evidence"><i data-lucide="search"></i> Evidence</button>
      <button class="tab" data-tab="trends"><i data-lucide="trending-up"></i> Trends</button>
      <button class="tab" data-tab="sources"><i data-lucide="boxes"></i> Sources</button>
      <button class="tab" data-tab="posts"><i data-lucide="list"></i> Posts</button>
      <button class="tab" data-tab="research"><i data-lucide="book-open"></i> Research</button>
      <button class="tab" data-tab="chat"><i data-lucide="message-square"></i> Chat</button>
      <button class="tab" data-tab="solutions"><i data-lucide="flask-conical"></i> Solutions</button>
      <button class="tab" data-tab="actions"><i data-lucide="zap"></i> Actions</button>
    </div>

    <div id="tab-content"><div class="empty-state">loading…</div></div>
  `;

  const tabsEl = $('#topic-tabs');
  const contentEl = $('#tab-content');
  window.refreshIcons?.();

  // Fetch header counts + sub text once — non-blocking.
  (async () => {
    try {
      // Parameterized — topic string is bound safely as :topic, can't escape into SQL.
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
        $('#topic-header-stats').innerHTML = `
          <span class="th-chip"><b>${(r.posts || 0).toLocaleString()}</b> posts</span>
          <span class="th-chip"><b>${r.painpoints || 0}</b> pains</span>
          <span class="th-chip"><b>${r.workarounds || 0}</b> DIY</span>
          <span class="th-chip"><b>${r.sources || 0}</b> src</span>`;
      }
    } catch {}
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
  Promise.all([
    api.runQuery(combinedFindingsSql, topic).catch(() => null),
    api.runQuery(srcSql, topic).catch(() => null),
    api.runQuery(subsSql, topic).catch(() => null),
    api.byokStatus().catch(() => null),
  ]).catch(() => {});

  // ─── Map ──────────────────────────────────────────────────────────────
  // Count semantic nodes (painpoints / features / workarounds / products)
  // in graph_nodes — shared by Map and Chat gates.
  async function countFindings() {
    try {
      const rows = await api.runQuery(
        `SELECT count(*) AS n FROM graph_nodes
         WHERE topic=:topic
           AND kind IN ('painpoint','feature_wish','workaround','product')`,
        topic,
      );
      return Array.isArray(rows) && rows[0]?.n ? Number(rows[0].n) : 0;
    } catch { return 0; }
  }
  async function checkLlmReady() {
    try {
      const b = await api.byokStatus();
      return !!(b?.anthropic?.set || b?.openai?.set || b?.openrouter?.set ||
                b?.groq?.set || b?.deepseek?.set || b?.mistral?.set ||
                b?.google?.set || b?.ollama_base_url);
    } catch { return false; }
  }

  async function runEnrichFromMap() {
    const btn = $('#btn-map-enrich');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2"></i> Enriching…'; window.refreshIcons?.(); }
    let errMsg = '';
    try {
      const e = await api.enrichGraph(topic);
      if (e?.skipped) errMsg = `Enrichment skipped: ${e.reason || 'no LLM configured'}`;
      else if (e?.ok === false) errMsg = `Enrichment failed: ${e.error || 'unknown'}`;
    } catch (err) {
      errMsg = `Enrichment errored: ${err?.message || err}`;
    }
    if (errMsg) showToast('Enrichment issue', errMsg, 'warn');
    loadMap();
  }

  async function loadMap() {
    // Graph stats strip — fetched before render, shown above the map when graph has nodes.
    let statsStripHtml = '';
    try {
      const [nodeRows, edgeRows] = await Promise.all([
        api.runQuery(
          "SELECT kind, count(*) AS n FROM graph_nodes WHERE topic = :topic AND kind NOT IN ('topic','post') GROUP BY kind ORDER BY n DESC",
          topic,
        ),
        api.runQuery(
          "SELECT count(*) AS n FROM graph_edges WHERE topic = :topic",
          topic,
        ),
      ]);
      const nodes = Array.isArray(nodeRows) ? nodeRows : [];
      const edgeCount = (edgeRows?.[0]?.n) || 0;
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

    contentEl.innerHTML = `
      <div class="map-building">
        <div class="map-building-spinner"></div>
        <div>
          <b id="map-stage">Building gap map…</b>
          <p id="map-detail">Running graph build on the corpus.</p>
        </div>
      </div>`;
    const sub = $('#topic-sub');
    if (sub) sub.textContent = 'Building gap map…';
    let outPath = null;
    let enrichBanner = '';
    try {
      // 1. Structural graph — surface errors, don't swallow.
      $('#map-stage').textContent = 'Building structural graph…';
      if (sub) sub.textContent = 'Building structural graph…';
      await api.buildGraph(topic);

      // 2. Auto-enrich if we have an LLM key and no findings yet.
      const [findingsBefore, anyReady] = await Promise.all([countFindings(), checkLlmReady()]);
      if (findingsBefore === 0 && anyReady) {
        const s = $('#map-stage'); if (s) s.textContent = 'Extracting painpoints (LLM)…';
        const d = $('#map-detail'); if (d) d.textContent = 'First-run enrichment — 20–90s depending on corpus size.';
        if (sub) sub.textContent = 'Extracting painpoints (LLM) — 20–90s…';
        try {
          const e = await api.enrichGraph(topic);
          if (e?.skipped) {
            enrichBanner = `<div class="map-enrich-banner warn">⚠ Enrichment skipped — ${esc(e.reason || 'no LLM configured')}</div>`;
          } else if (e?.ok === false) {
            enrichBanner = `<div class="map-enrich-banner err">✗ Enrichment failed — ${esc(e.error || 'unknown')}</div>`;
          } else {
            const np = e?.painpoints_added ?? e?.painpoints ?? 0;
            const nf = e?.feature_wishes_added ?? e?.feature_wishes ?? 0;
            const nw = e?.workarounds_added ?? e?.diy_workarounds ?? 0;
            if ((np + nf + nw) === 0) {
              enrichBanner = `<div class="map-enrich-banner warn">⚠ Enrichment ran but found no painpoints / features. Try <b>Rerun collect</b> to gather more posts.</div>`;
            }
          }
        } catch (err) {
          enrichBanner = `<div class="map-enrich-banner err">✗ Enrichment errored — ${esc(err?.message || err)}</div>`;
        }
      } else if (findingsBefore === 0 && !anyReady) {
        enrichBanner = `<div class="map-enrich-banner warn">
          ⚠ No LLM key — painpoints and feature wishes won't appear on the map.
          <button class="btn btn-primary map-banner-btn" id="btn-map-add-key">Add key</button>
        </div>`;
      }

      // 3. Export viewer.
      const s2 = $('#map-stage'); if (s2) s2.textContent = 'Exporting viewer…';
      if (sub) sub.textContent = 'Exporting viewer…';
      outPath = await api.exportHtml(topic);
      const fileUrl = convertFileSrc(outPath);

      // Node + edge counts, for the clean summary + chips below.
      let nodeCount = 0;
      let edgeCount = 0;
      try {
        const rows = await api.runQuery(
          `SELECT
             (SELECT count(*) FROM graph_nodes WHERE topic=:topic) AS n_nodes,
             (SELECT count(*) FROM graph_edges WHERE topic=:topic) AS n_edges`,
          topic,
        );
        if (Array.isArray(rows) && rows[0]) {
          nodeCount = Number(rows[0].n_nodes || 0);
          edgeCount = Number(rows[0].n_edges || 0);
        }
      } catch {}

      const updatedAgo = timeAgo(Date.now());
      $('#topic-sub').textContent =
        `${nodeCount.toLocaleString()} nodes · ${edgeCount.toLocaleString()} edges · updated ${updatedAgo}`;

      const findingsAfter = await countFindings();
      const findingsChip = findingsAfter > 0
        ? `<span class="th-chip"><b>${findingsAfter}</b> findings</span>`
        : `<span class="th-chip" style="color:var(--ink-3)">0 findings</span>`;

      // Time-windowed diff — "what's new since last week". Best-effort.
      let diffBanner = '';
      try {
        const d = await api.diffFindings(topic, 7);
        const s = (d && d.summary) || {};
        const total = (s.new_painpoints || 0) + (s.new_workarounds || 0)
                    + (s.new_products || 0) + (s.new_feature_wishes || 0);
        if (total > 0) {
          const parts = [];
          if (s.new_painpoints)     parts.push(`<b>${s.new_painpoints}</b> new painpoint${s.new_painpoints === 1 ? '' : 's'}`);
          if (s.new_workarounds)    parts.push(`<b>${s.new_workarounds}</b> new DIY`);
          if (s.new_products)       parts.push(`<b>${s.new_products}</b> new product${s.new_products === 1 ? '' : 's'}`);
          if (s.new_feature_wishes) parts.push(`<b>${s.new_feature_wishes}</b> new feature wish${s.new_feature_wishes === 1 ? '' : 'es'}`);
          diffBanner = `<div class="diff-banner">✨ Since last week — ${parts.join(' · ')}</div>`;
        }
      } catch {}

      contentEl.innerHTML = `
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
        <iframe class="viewer-frame" src="${fileUrl}" sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"></iframe>`;
      window.refreshIcons?.();
      $('#btn-map-rebuild').onclick  = () => loadMap();
      $('#btn-map-reveal').onclick   = () => api.revealInFinder(outPath);
      $('#btn-map-open-ext').onclick = () => api.openUrl(`file://${encodeURI(outPath)}`);
      $('#btn-map-enrich')?.addEventListener('click', () => runEnrichFromMap());
      $('#btn-map-add-key')?.addEventListener('click', () => openByokModal(() => loadMap()));
    } catch (e) {
      const msg = (e?.message || e || '').toString();
      const hasNoPosts = msg.includes('no posts') || msg.includes('0 nodes');
      contentEl.innerHTML = `
        <div class="empty-big">
          <h3>${hasNoPosts ? 'No data for this topic yet' : "Couldn't render the gap map"}</h3>
          <p>${esc(msg)}</p>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:14px">
            <button class="btn btn-primary" id="btn-map-run-collect">Run collect</button>
            <button class="btn btn-ghost icon-btn" id="btn-map-retry" style="border:1px solid var(--line)"><i data-lucide="rotate-cw"></i> Retry</button>
          </div>
        </div>`;
      window.refreshIcons?.();
      $('#btn-map-run-collect').onclick = () => { location.hash = `#/collect/${encodeURIComponent(topic)}`; };
      $('#btn-map-retry').onclick = () => loadMap();
    }
  }

  // ─── Report ───────────────────────────────────────────────────────────
  async function loadReport() {
    contentEl.innerHTML = `
      <div class="skeleton-card">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line med"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
      </div>
      ${skeletonCards(2)}`;
    try {
      const path = await api.exportReportPro(topic);
      $('#topic-sub').textContent = path;
      const fileUrl = convertFileSrc(path);
      const resp = await fetch(fileUrl);
      const md = await resp.text();
      contentEl.innerHTML = `
        <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
          <button class="btn btn-ghost icon-btn" style="border:1px solid var(--line)" id="btn-copy-md"><i data-lucide="copy"></i> Copy markdown</button>
          <button class="btn btn-ghost" style="border:1px solid var(--line)" id="btn-reveal-md">Reveal in Finder</button>
          <button class="btn btn-ghost icon-btn" style="border:1px solid var(--line)" id="btn-regen-md"><i data-lucide="rotate-cw"></i> Regenerate</button>
        </div>
        <div class="markdown-view">${renderMarkdown(md)}</div>
      `;
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
      const actions = [
        { label: 'Retry',         icon: 'refresh-cw', primary: true,  onClick: () => loadReport() },
        { label: 'Build gap map', primary: false, onClick: () => switchTab('map') },
        { label: 'Add LLM key',   primary: false, onClick: () => openByokModal(() => loadReport()) },
      ];
      contentEl.innerHTML = errorCard('Could not generate the report', e?.message || String(e), actions);
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
    contentEl.innerHTML = skeletonCards(3);
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
      contentEl.innerHTML = html || `
        <div class="empty-big">
          <h3>No semantic extraction yet</h3>
          <p>Add an LLM key to pull painpoints / products / DIY workarounds from the corpus.</p>
          <button class="btn btn-primary icon-btn" id="btn-ev-keys"><i data-lucide="key-round"></i> Add LLM key</button>
        </div>`;
      // "Show more" delegates — bumps the per-kind visible counter and re-renders.
      contentEl.querySelectorAll('.show-more-btn').forEach(btn => {
        btn.onclick = () => {
          const k = btn.dataset.more;
          evidenceVisible[k] = (evidenceVisible[k] || PAGE) + PAGE;
          loadEvidence();
        };
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

      // After the user saves a key, re-run the Evidence tab so the "add key"
      // empty-state is replaced with the newly-extracted findings.
      $('#btn-ev-keys')?.addEventListener('click', () => openByokModal(() => loadEvidence()));
    } catch (e) {
      const actions = [
        { label: 'Retry',       icon: 'refresh-cw', primary: true, onClick: () => loadEvidence() },
        { label: 'Add LLM key',              onClick: () => openByokModal(() => loadEvidence()) },
      ];
      contentEl.innerHTML = errorCard('Could not load evidence', e?.message || String(e), actions);
      wireErrorCard(contentEl, actions);
    }
  }

  // ─── Sources ──────────────────────────────────────────────────────────
  let subsVisible = 12;
  async function loadSources() {
    contentEl.innerHTML = skeletonCards(2);
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
        return `
          <div class="source-row">
            <div class="source-row-head">
              <b>${esc(r.source)}</b>
              <span>${r.posts.toLocaleString()} posts · ${pct}%</span>
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
      contentEl.innerHTML = `
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
      `;
      $('#btn-subs-more')?.addEventListener('click', () => {
        subsVisible += 12;
        loadSources();
      });
    } catch (e) {
      const actions = [{ label: 'Retry', icon: 'refresh-cw', primary: true, onClick: () => loadSources() }];
      contentEl.innerHTML = errorCard('Could not load sources', e?.message || String(e), actions);
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
    contentEl.innerHTML = skeletonCards(3);
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
        contentEl.innerHTML = `
          <div class="empty-big">
            <h3>No research yet</h3>
            <p>Collect a topic with academic sources to populate this tab — arXiv, OpenAlex, PubMed, or Semantic Scholar. You can also drag a PDF into the Ingest screen to add your own papers and reports.</p>
            <div style="display:flex;gap:10px;justify-content:center;margin-top:14px">
              <button class="btn btn-primary" id="btn-research-collect">Rerun collect with --sources arxiv</button>
              <button class="btn btn-ghost btn-bordered" id="btn-research-ingest">Ingest a PDF</button>
            </div>
          </div>`;
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

      const paperCard = (r) => {
        const c = SRC_BADGE_COLORS[r.source] || { bg: 'var(--surface-2)', fg: 'var(--ink-2)' };
        const badge = `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${c.bg};color:${c.fg};font-size:10px;font-weight:700;letter-spacing:.03em">${esc(SRC_LABELS[r.source] || r.source)}</span>`;
        const title = esc((r.title || '(untitled)').slice(0, 160));
        const excerpt = esc((r.excerpt || '').trim().slice(0, 260));
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
                <div style="margin-bottom:6px">${badge}<span style="color:var(--ink-3);font-size:11px;margin-left:8px">${cites}${esc(date)}${authorStr}</span></div>
                <h4 style="font-size:14px;font-weight:700;line-height:1.35;margin-bottom:4px">${title}</h4>
                ${excerpt ? `<p style="font-size:12px;color:var(--ink-2);line-height:1.5">${excerpt}…</p>` : ''}
              </div>
              <div style="flex-shrink:0;display:flex;gap:6px;align-items:flex-start">${citeBtn}${openBtn}</div>
            </div>
          </div>`;
      };

      const sortToggle = `
        <div class="research-sort-row">
          <span>Sort:</span>
          <button class="research-sort-btn ${researchSort === 'cites' ? 'active' : ''}" data-sort="cites">Most cited</button>
          <button class="research-sort-btn ${researchSort === 'newest' ? 'active' : ''}" data-sort="newest">Newest</button>
          <span style="margin-left:auto;font-size:11px;color:var(--ink-3)">${rows.length} paper${rows.length === 1 ? '' : 's'} total</span>
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

      contentEl.innerHTML = sortToggle + html;

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
      contentEl.innerHTML = errorCard('Could not load research', e?.message || String(e), actions);
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
    // Gate 1: need an LLM key.
    let byok = {};
    try { byok = await api.byokStatus(); } catch {}
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
      contentEl.innerHTML = `
        <div class="empty-big" style="margin:18px 0">
          <h3>Gap map not built yet</h3>
          <p>Chat needs painpoints, features, and workarounds to ground its answers.
             This topic has no semantic nodes yet — run the extractor against the corpus.</p>
          <div style="display:flex;gap:10px;justify-content:center;margin-top:14px">
            <button class="btn btn-primary" id="btn-chat-build">Build gap map now</button>
            <button class="btn btn-ghost" id="btn-chat-rerun" style="border:1px solid var(--line)">Re-run collect</button>
          </div>
        </div>`;
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
    contentEl.innerHTML = `
      <div class="chat-wrap">
        <div class="chat-head">
          <div>
            <h3 style="margin:0 0 2px">Chat with this gap map</h3>
            <p style="margin:0;color:var(--ink-3);font-size:12px">
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

        ${!anyReady ? (() => {
          // List which keys ARE saved (even if default isn't picked yet).
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
            ? `<p style="color:var(--ink-2);font-size:13px;margin:6px 0 0"><b>${configured.length}</b> provider${configured.length>1?'s':''} configured: ${esc(configured.join(', '))} — but no default picked.</p>`
            : '';
          return `
          <div class="empty-big" style="margin:18px 0">
            <h3>${configured.length ? 'Pick a default model' : 'No LLM key yet'}</h3>
            <p>${configured.length
              ? 'Open the key manager and click a model chip to set a default. Chat will grant access immediately.'
              : "Add Anthropic, OpenAI, OpenRouter, Groq, DeepSeek, Gemini, or local Ollama — chat streams grounded answers from this topic's data."}</p>
            ${statusLine}
            <button class="btn btn-primary icon-btn" id="btn-chat-add-key" style="margin-top:14px"><i data-lucide="key-round"></i> ${configured.length ? 'Pick default' : 'Add a key'}</button>
          </div>`;
        })() : `
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
          </div>
        `}
      </div>
    `;

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
      const confirmPref = localStorage.getItem('gapmap.pref.confirm_delete') !== 'false';
      if (confirmPref && !confirm(`Delete topic "${topic}"? Graph + tags removed; underlying posts kept.`)) return;
      try {
        await api.deleteTopic(topic);
        location.hash = '#/';
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
    map: loadMap, report: loadReport, evidence: loadEvidence,
    sources: loadSources, research: loadResearch, chat: loadChat, actions: loadActions,
    solutions: () => loadSolutions(contentEl, topic),
    trends: () => loadTrends(contentEl, topic),
    posts: () => loadPosts(contentEl, topic),
  };
  const switchTab = async (name) => {
    // Clean up chat listeners if we're leaving chat mid-stream
    if (activeTab === 'chat' && name !== 'chat') {
      try { chatStream.unlistenProgress?.(); } catch {}
      try { chatStream.unlistenDone?.(); } catch {}
      if (chatTsInterval) { clearInterval(chatTsInterval); chatTsInterval = null; }
    }
    activeTab = name;
    tabsEl.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    await loaders[name]?.();
    window.refreshIcons?.();
  };

  tabsEl.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });

  $('#btn-rerun').onclick = () => openSourcePickerModal(topic);

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

  // Mark this visit so the "new since last viewed" banner can diff against
  // it next time. Fire-and-forget; failure is non-fatal.
  api.scheduleMarkSeen(topic).catch(() => {});
  $('#btn-delete').onclick = async () => {
    const confirmPref = localStorage.getItem('gapmap.pref.confirm_delete') !== 'false';
    if (confirmPref && !confirm(`Delete topic "${topic}"?`)) return;
    await api.deleteTopic(topic);
    location.hash = '#/';
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
    window.removeEventListener('hashchange', hashCleanup);
  };
  window.addEventListener('hashchange', hashCleanup);

  // Initial load
  await switchTab('map');
}

function renderMetaPills(metaJson) {
  try {
    const m = JSON.parse(metaJson || '{}');
    const pills = [];
    if (m.classification && m.classification !== 'UNCLASSIFIED') pills.push(`<span style="color:var(--chronic);font-weight:700">${esc(m.classification)}</span>`);
    if (m.severity) pills.push(`severity: ${esc(m.severity)}`);
    if (m.frequency) pills.push(`freq: ${m.frequency}`);
    return pills.map(p => `<span>${p}</span>`).join('');
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
