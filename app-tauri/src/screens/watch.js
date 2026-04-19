// Watch — live Reddit stream. Top-level route at #/watch.
// Foreground only: when the user navigates away, the stream is cancelled.
import { api, $, esc, timeAgo } from '../api.js';

const state = {
  sub: '',
  keywords: '',
  watch: 'both',
  mode: 'filter',  // 'filter' (use keywords) or 'firehose' (no filter — keywords sent as empty)
  hits: [],          // live in-memory feed (newest first)
  history: [],       // from stream_hits SQLite table (newest first)
  showHistory: false,
  active: false,
  unlistenHit: null,
  unlistenDone: null,
};

const MAX_LIVE_HITS = 200;  // ring buffer cap

function fmtTs(unixSec) {
  if (!unixSec || unixSec <= 0) return '—';
  return timeAgo(new Date(unixSec * 1000).toISOString());
}

function renderHit(hit) {
  // Each hit shape (per stream.py): {kind: 'post'|'comment', sub, sub_name, title?, body?, author, score, created_utc, permalink, keywords: [...]}
  const link = hit.permalink ? `https://www.reddit.com${hit.permalink}` : '#';
  const subLabel = hit.sub || hit.sub_name || '';
  const text = (hit.kind === 'post')
    ? (hit.title || '(untitled post)')
    : (hit.body || '(empty comment)').slice(0, 280);
  const tags = (hit.keywords && hit.keywords.length)
    ? hit.keywords.map(k => `<span class="watch-kw">${esc(k)}</span>`).join(' ')
    : '<span class="watch-kw watch-kw-firehose">firehose</span>';
  return `
    <div class="watch-hit watch-hit-${esc(hit.kind || 'post')}">
      <div class="watch-hit-head">
        <span class="watch-hit-kind">${esc((hit.kind || '').toUpperCase())}</span>
        ${subLabel ? `<a class="watch-hit-sub" href="https://www.reddit.com/r/${esc(subLabel)}" target="_blank" rel="noopener">r/${esc(subLabel)}</a>` : ''}
        <span class="watch-hit-author">u/${esc(hit.author || 'unknown')}</span>
        <span class="watch-hit-time">${fmtTs(hit.created_utc)}</span>
      </div>
      <a class="watch-hit-text" href="${esc(link)}" target="_blank" rel="noopener">${esc(text)}</a>
      <div class="watch-hit-meta">${tags}</div>
    </div>
  `;
}

function renderToolbar() {
  return `
    <form class="watch-form" id="watch-form">
      <input type="text" id="watch-sub" class="watch-input" placeholder="sub (e.g. python)" value="${esc(state.sub)}" required ${state.active ? 'disabled' : ''} />
      <input type="text" id="watch-keywords" class="watch-input watch-input-keywords"
        placeholder="${state.mode === 'firehose' ? '(firehose: no keywords)' : 'keywords (comma-separated regex)'}"
        value="${esc(state.keywords)}" ${state.active || state.mode === 'firehose' ? 'disabled' : ''} />
      <select id="watch-mode" class="watch-input" ${state.active ? 'disabled' : ''}>
        <option value="filter"   ${state.mode === 'filter' ? 'selected' : ''}>Keyword filter</option>
        <option value="firehose" ${state.mode === 'firehose' ? 'selected' : ''}>Firehose (everything)</option>
      </select>
      <select id="watch-which" class="watch-input" ${state.active ? 'disabled' : ''}>
        <option value="both"     ${state.watch === 'both'     ? 'selected' : ''}>Posts + comments</option>
        <option value="posts"    ${state.watch === 'posts'    ? 'selected' : ''}>Posts only</option>
        <option value="comments" ${state.watch === 'comments' ? 'selected' : ''}>Comments only</option>
      </select>
      ${state.active
        ? `<button type="button" class="btn btn-danger btn-sm icon-btn" id="watch-stop"><i data-lucide="circle-stop"></i> Stop</button>`
        : `<button type="submit" class="btn btn-primary btn-sm icon-btn" id="watch-start"><i data-lucide="play"></i> Start</button>`}
    </form>
  `;
}

function renderLive() {
  if (!state.hits.length) {
    return state.active
      ? `<div class="empty-state"><p>Watching r/${esc(state.sub)}… new hits will appear here.</p></div>`
      : `<div class="empty-state"><p>Pick a sub + mode and click <b>Start</b> to begin streaming.</p><p class="muted">Foreground only — the stream stops when you navigate away from this screen.</p></div>`;
  }
  return `<div class="watch-feed">${state.hits.map(renderHit).join('')}</div>`;
}

function renderHistory() {
  if (!state.history.length) {
    return `<div class="empty-state"><p>No prior stream hits in the database.</p></div>`;
  }
  return `<div class="watch-feed">${state.history.map(renderHit).join('')}</div>`;
}

function renderResultsArea(root) {
  const area = root.querySelector('#watch-results');
  if (!area) return;
  area.innerHTML = state.showHistory ? renderHistory() : renderLive();
  window.refreshIcons?.();
}

function renderToolbarOnly(root) {
  const tb = root.querySelector('#watch-toolbar');
  if (tb) tb.innerHTML = renderToolbar();
  window.refreshIcons?.();
  wireForm(root);
}

async function loadHistory() {
  try {
    // Last 200 hits across all streams. The stream_hits schema has columns:
    // id, stream_id, kind, sub, sub_name, title, body, author, score, created_utc, permalink, keywords_json, fetched_at
    const sql = `
      SELECT kind, sub, sub_name, title, body, author, score, created_utc, permalink, keywords_json
      FROM stream_hits
      ORDER BY id DESC
      LIMIT 200
    `;
    const rows = await api.runQuery(sql, '');
    state.history = (Array.isArray(rows) ? rows : []).map(r => ({
      ...r,
      keywords: (() => { try { return JSON.parse(r.keywords_json || '[]'); } catch { return []; } })(),
    }));
  } catch (e) {
    console.warn('history load failed:', e);
    state.history = [];
  }
}

async function startStreaming(root) {
  const sub = state.sub.trim();
  if (!sub) return;
  const kws = state.mode === 'firehose' ? '' : state.keywords.trim();
  state.hits = [];
  state.active = true;
  renderToolbarOnly(root);
  renderResultsArea(root);

  // Wire event listeners BEFORE invoking start_stream so we don't miss the first hit.
  state.unlistenHit  = await api.onStreamHit(payload => {
    // payload is a raw NDJSON string from Python; parse it.
    let hit = payload;
    if (typeof payload === 'string') {
      try { hit = JSON.parse(payload); } catch { return; }
    }
    state.hits.unshift(hit || {});
    if (state.hits.length > MAX_LIVE_HITS) state.hits.length = MAX_LIVE_HITS;
    if (!state.showHistory) renderResultsArea(root);
  });
  state.unlistenDone = await api.onStreamDone(payload => {
    // payload may include {code, error_class, hint} on error, or {} on clean exit
    state.active = false;
    if (payload && payload.code !== 0 && payload.hint) {
      // Append a synthetic "ended" pseudo-hit so the user notices.
      state.hits.unshift({ kind: 'system', title: `Stream ended: ${payload.hint}`, created_utc: Math.floor(Date.now()/1000) });
    }
    cleanupListeners();
    renderToolbarOnly(root);
    renderResultsArea(root);
  });

  try {
    await api.startStream(sub, kws, state.watch);
  } catch (e) {
    state.active = false;
    state.hits.unshift({ kind: 'system', title: `Failed to start: ${e?.message || e}`, created_utc: Math.floor(Date.now()/1000) });
    cleanupListeners();
    renderToolbarOnly(root);
    renderResultsArea(root);
  }
}

async function stopStreaming(root) {
  try { await api.cancelStream(); } catch {}
  // The done event will fire and clean up, but be defensive.
  setTimeout(() => {
    if (state.active) {
      state.active = false;
      cleanupListeners();
      renderToolbarOnly(root);
      renderResultsArea(root);
    }
  }, 500);
}

function cleanupListeners() {
  try { state.unlistenHit?.(); } catch {}
  try { state.unlistenDone?.(); } catch {}
  state.unlistenHit = null;
  state.unlistenDone = null;
}

function wireForm(root) {
  const form = root.querySelector('#watch-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    state.sub      = root.querySelector('#watch-sub')?.value || '';
    state.keywords = root.querySelector('#watch-keywords')?.value || '';
    state.mode     = root.querySelector('#watch-mode')?.value || 'filter';
    state.watch    = root.querySelector('#watch-which')?.value || 'both';
    startStreaming(root);
  });
  root.querySelector('#watch-stop')?.addEventListener('click', () => stopStreaming(root));
  root.querySelector('#watch-mode')?.addEventListener('change', (e) => {
    state.mode = e.target.value;
    renderToolbarOnly(root);
  });
}

export async function renderWatch(root) {
  // If a previous stream is still active when entering — surface it.
  try { state.active = await api.streamStatus(); } catch { state.active = false; }
  await loadHistory();

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs"><strong>Watch</strong></div>
    </header>

    <div class="section-head">
      <div><h2>Live Reddit watcher</h2><p>Stream new posts + comments from a sub in real time. Foreground only — stops when you navigate away.</p></div>
    </div>

    <div class="watch-tab">
      <div id="watch-toolbar">${renderToolbar()}</div>

      <div class="watch-mode-tabs">
        <button class="watch-mode-tab ${state.showHistory ? '' : 'active'}" data-tab="live">Live feed</button>
        <button class="watch-mode-tab ${state.showHistory ? 'active' : ''}" data-tab="history">History (${state.history.length})</button>
      </div>

      <div id="watch-results">${state.showHistory ? renderHistory() : renderLive()}</div>
    </div>
  `;
  window.refreshIcons?.();

  wireForm(root);

  root.querySelectorAll('.watch-mode-tab').forEach(t => {
    t.addEventListener('click', () => {
      state.showHistory = t.dataset.tab === 'history';
      root.querySelectorAll('.watch-mode-tab').forEach(x => x.classList.toggle('active', x === t));
      renderResultsArea(root);
    });
  });

  // Foreground-only: cancel stream on navigation away.
  // The router bumps `routeGen` on navigation; we listen for hashchange.
  const onHash = () => {
    if (location.hash !== '#/watch' && location.hash !== '') {
      cleanupListeners();
      // Best-effort cancel — don't await, navigation already happened.
      api.cancelStream().catch(() => {});
      window.removeEventListener('hashchange', onHash);
    }
  };
  window.addEventListener('hashchange', onHash);
}
