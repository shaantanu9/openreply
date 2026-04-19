// Topic detail — 6 tabs: Map · Report · Evidence · Sources · Chat · Actions.
// The chat tab streams tokens from the Python sidecar via `chat:progress`
// events; backend is the `research chat` CLI command.

import { api, $, esc, timeAgo } from '../api.js';
import { convertFileSrc } from '@tauri-apps/api/core';
import { openByokModal } from './byok.js';
import { loadSolutions } from './solutions.js';

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
      <div class="topic-header-stats" id="topic-header-stats"></div>
      <button class="active-llm-pill none" id="topic-llm-pill" title="Click to change provider / model">
        <span class="dot"></span><span id="topic-llm-pill-label">No LLM</span>
      </button>
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
      <button class="tab" data-tab="sources"><i data-lucide="boxes"></i> Sources</button>
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
      $('#topic-sub').textContent = outPath;

      const findingsAfter = await countFindings();
      const findingsChip = findingsAfter > 0
        ? `<span class="th-chip"><b>${findingsAfter}</b> findings</span>`
        : `<span class="th-chip" style="color:var(--ink-3)">0 findings</span>`;

      contentEl.innerHTML = `
        <div class="map-toolbar">
          <div class="map-toolbar-info">
            <span class="th-chip" title="Path on disk">${esc(outPath.split('/').pop())}</span>
            ${findingsChip}
          </div>
          <div style="flex:1"></div>
          ${anyReady ? `<button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-map-enrich" title="Re-run LLM extraction"><i data-lucide="sparkles"></i> Enrich</button>` : ''}
          <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-map-rebuild"><i data-lucide="rotate-cw"></i> Rebuild</button>
          <button class="btn btn-ghost btn-sm btn-bordered" id="btn-map-reveal">Reveal</button>
          <button class="btn btn-ghost btn-sm btn-bordered" id="btn-map-open-ext">Open externally</button>
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
      const painpoints = byKind.painpoint;
      const features = byKind.feature_wish;
      const products = byKind.product;
      const workarounds = byKind.workaround;
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
                    </div>
                  </div>
                </div>
              `).join('')}
              ${more > 0 ? `<button class="show-more-btn" data-more="${esc(kind)}">Show ${Math.min(more, PAGE)} more · ${more} hidden</button>` : ''}
            </div>
          </div>
        `;
      };
      const html = [
        section('🔥 Painpoints',              painpoints,  'chronic',  'painpoint'),
        section('🛠 DIY workarounds',         workarounds, 'emerging', 'workaround'),
        section('😡 Products complained about', products,  'chronic',  'product'),
        section('💡 Feature wishes',          features,    'emerging', 'feature_wish'),
      ].filter(Boolean).join('');
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
          <div class="chat-presets">
            ${PRESETS.map(p => `
              <button class="chat-preset" data-mode="${p.mode}" title="${esc(p.desc)}">
                <span class="chat-preset-ic"><i data-lucide="${p.icon}"></i></span>
                <div class="chat-preset-body">
                  <b>${esc(p.label)}</b>
                  <small>${esc(p.desc)}</small>
                </div>
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
      send('ask', q);
    };
    sendBtn.onclick = sendFromInput;
    input.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendFromInput(); }
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
  }

  function renderMessages() {
    const box = $('#chat-messages');
    if (!box) return;
    const hist = loadChatHistory(topic);
    if (!hist.length) {
      box.innerHTML = `<div class="empty-state" style="padding:28px">Try a preset above, or type a question below.</div>`;
      return;
    }
    box.innerHTML = hist.map(m => chatBubble(m)).join('');
    box.scrollTop = box.scrollHeight;
  }

  function chatBubble(m) {
    if (m.role === 'user') {
      return `<div class="chat-msg chat-msg-user">
        <div class="chat-msg-ic">🧑</div>
        <div class="chat-msg-body"><b>${esc(m.mode || 'ask')}</b>${m.text ? `<div>${esc(m.text)}</div>` : ''}</div>
      </div>`;
    }
    return `<div class="chat-msg chat-msg-asst">
      <div class="chat-msg-ic">🤖</div>
      <div class="chat-msg-body markdown-view">${assistantInnerHtml(m)}</div>
    </div>`;
  }

  async function send(mode, question) {
    const agent = document.getElementById('chat-agent')?.checked || false;
    const hist = loadChatHistory(topic);
    hist.push({ role: 'user', mode: agent ? `agent · ${mode}` : mode, text: question });
    hist.push({ role: 'assistant', mode, text: '', toolCalls: [] });
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
    target.querySelector('.chat-msg-body').innerHTML = assistantInnerHtml(last);
    box.scrollTop = box.scrollHeight;
  }

  function assistantInnerHtml(m) {
    let html = '';
    if (m.toolCalls && m.toolCalls.length) {
      html += '<div class="tool-calls">';
      m.toolCalls.forEach(tc => {
        const inputPreview = esc(JSON.stringify(tc.input || {}).slice(0, 120));
        const resolved = tc.output != null;
        const outPreview = resolved
          ? esc(JSON.stringify(tc.output).slice(0, 180))
          : '<span class="chat-typing">running…</span>';
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
    html += renderMarkdown(m.text || '') || '<span class="chat-typing">thinking…</span>';
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
    contentEl.querySelector('[data-route="collect"]').onclick = () => { location.hash = `#/collect/${encodeURIComponent(topic)}`; };
    contentEl.querySelector('[data-route="ingest"]').onclick  = () => { location.hash = '#/ingest'; };
    $('#btn-export-html').onclick = async () => {
      $('#export-status').textContent = 'exporting HTML…';
      try { const p = await api.exportHtml(topic); $('#export-status').innerHTML = `✓ ${esc(p)}`; }
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
  }

  // ─── tab switching ────────────────────────────────────────────────────
  const loaders = {
    map: loadMap, report: loadReport, evidence: loadEvidence,
    sources: loadSources, chat: loadChat, actions: loadActions,
    solutions: () => loadSolutions(contentEl, topic),
  };
  const switchTab = async (name) => {
    // Clean up chat listeners if we're leaving chat mid-stream
    if (activeTab === 'chat' && name !== 'chat') {
      try { chatStream.unlistenProgress?.(); } catch {}
      try { chatStream.unlistenDone?.(); } catch {}
    }
    activeTab = name;
    tabsEl.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    await loaders[name]?.();
    window.refreshIcons?.();
  };

  tabsEl.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });

  $('#btn-rerun').onclick = () => { location.hash = `#/collect/${encodeURIComponent(topic)}`; };
  $('#btn-delete').onclick = async () => {
    const confirmPref = localStorage.getItem('gapmap.pref.confirm_delete') !== 'false';
    if (confirmPref && !confirm(`Delete topic "${topic}"?`)) return;
    await api.deleteTopic(topic);
    location.hash = '#/';
  };

  // Poll for an in-flight collect for THIS topic — show the header chip if
  // ended_at IS NULL and params_json references the current topic.
  const chip = $('#topic-active-chip');
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
