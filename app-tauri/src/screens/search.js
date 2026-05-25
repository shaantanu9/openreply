// Search — ad-hoc Reddit search via PRAW (gapmap search).
// Top-level route at #/search. Not scoped to any topic.
import { api, $, esc, timeAgo } from '../api.js';

const state = {
  query: '',
  sub: '',
  sort: 'relevance',
  time: 'all',
  limit: 50,
  rows: null,
  loading: false,
  error: null,
};

function renderRow(p) {
  const ts = (p.created_utc && p.created_utc > 0)
    ? timeAgo(new Date(p.created_utc * 1000).toISOString())
    : '—';
  const link = p.permalink
    ? `https://www.reddit.com${p.permalink}`
    : (p.url || '#');
  // Tauri 2 routes `<a target="_blank">` clicks through the shell plugin's
  // `open` command, which requires `shell:allow-open` in capabilities. We
  // intentionally don't grant that — the surface is too broad. Instead,
  // emit a `data-extlink` attribute and route every click through
  // `api.openUrl()` (Rust `open_url` command, which uses
  // `std::process::Command::new("open")` directly — no shell plugin
  // permission required). The delegated handler in renderSearch wires
  // them all in one place.
  const subTag = p.sub
    ? `<button type="button" class="search-sub" data-extlink="https://www.reddit.com/r/${esc(p.sub)}">r/${esc(p.sub)}</button>`
    : '';
  const excerpt = p.selftext
    ? `<div class="search-excerpt">${esc(String(p.selftext).slice(0, 240))}${String(p.selftext).length > 240 ? '…' : ''}</div>`
    : '';
  return `
    <div class="search-row">
      <button type="button" class="search-title" data-extlink="${esc(link)}">${esc(p.title || '(untitled)')}</button>
      ${excerpt}
      <div class="search-meta">
        ${subTag}
        <span title="Score">▲ ${p.score ?? 0}</span>
        <span title="Comments">💬 ${p.num_comments ?? 0}</span>
        <span title="Author">u/${esc(p.author || 'unknown')}</span>
        <span title="Posted">${ts}</span>
      </div>
    </div>
  `;
}

function renderResults() {
  if (state.loading) {
    // Visible spinner + "this may take up to 10 s" hint. PRAW search can be
    // slow on first call (token refresh + rate-limit dance); users hit
    // Search again thinking the UI hung. Two-line copy makes the wait
    // feel intentional.
    return `
      <div class="empty-state" style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px">
        <div class="map-building-spinner"></div>
        <div><b>Searching Reddit…</b></div>
        <div style="font-size:var(--fs-13);color:var(--ink-3)">
          First call can take up to 10 s while PRAW refreshes its token.
        </div>
      </div>`;
  }
  if (state.error) {
    return `<div class="empty-state"><p>Error: ${esc(state.error)}</p></div>`;
  }
  if (state.rows == null) {
    return `<div class="empty-state"><p>Enter a query above to search Reddit.</p><p class="muted">Searches use PRAW — needs working Reddit credentials in Settings → API keys (or runs in public no-auth mode at lower rate limits).</p></div>`;
  }
  if (state.rows.length === 0) {
    return `<div class="empty-state"><p>No results for "<b>${esc(state.query)}</b>"${state.sub ? ` in r/${esc(state.sub)}` : ''}.</p></div>`;
  }
  return `
    <div class="search-results-meta">${state.rows.length} result${state.rows.length === 1 ? '' : 's'} for "<b>${esc(state.query)}</b>"${state.sub ? ` in r/${esc(state.sub)}` : ''}</div>
    <div class="search-list">${state.rows.map(renderRow).join('')}</div>
  `;
}

async function doSearch(root) {
  const q = state.query.trim();
  if (!q) { state.error = 'Enter a search query.'; renderResultsArea(root); return; }
  state.loading = true; state.error = null; state.rows = null;
  renderResultsArea(root);
  try {
    const out = await api.runRedditSearch(q, state.sub.trim() || null, state.sort, state.time, state.limit);
    state.rows = Array.isArray(out) ? out : [];
  } catch (e) {
    state.error = e?.message || String(e);
    state.rows = null;
  } finally {
    state.loading = false;
    renderResultsArea(root);
  }
}

function renderResultsArea(root) {
  const area = root.querySelector('#search-results-area');
  if (area) area.innerHTML = renderResults();
  window.refreshIcons?.();
}

export async function renderSearch(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs"><strong>Search Reddit</strong></div>
    </header>

    <div class="section-head">
      <div><h2>Search Reddit</h2><p>Ad-hoc PRAW search outside the curated topic flow.</p></div>
    </div>

    <div class="search-tab">
      <form class="search-form" id="search-form">
        <input type="text" id="search-q" class="search-input search-input-q" placeholder="search query (e.g. 'note-taking app')" value="${esc(state.query)}" autofocus />
        <input type="text" id="search-sub" class="search-input search-input-sub" placeholder="sub (optional)" value="${esc(state.sub)}" />
        <select id="search-sort" class="search-input">
          <option value="relevance" ${state.sort === 'relevance' ? 'selected' : ''}>Relevance</option>
          <option value="hot"       ${state.sort === 'hot'       ? 'selected' : ''}>Hot</option>
          <option value="new"       ${state.sort === 'new'       ? 'selected' : ''}>New</option>
          <option value="top"       ${state.sort === 'top'       ? 'selected' : ''}>Top</option>
          <option value="comments"  ${state.sort === 'comments'  ? 'selected' : ''}>Comments</option>
        </select>
        <select id="search-time" class="search-input">
          <option value="all"   ${state.time === 'all'   ? 'selected' : ''}>All time</option>
          <option value="year"  ${state.time === 'year'  ? 'selected' : ''}>Year</option>
          <option value="month" ${state.time === 'month' ? 'selected' : ''}>Month</option>
          <option value="week"  ${state.time === 'week'  ? 'selected' : ''}>Week</option>
          <option value="day"   ${state.time === 'day'   ? 'selected' : ''}>Day</option>
          <option value="hour"  ${state.time === 'hour'  ? 'selected' : ''}>Hour</option>
        </select>
        <button type="submit" class="btn btn-primary btn-sm icon-btn" id="search-go">
          <i data-lucide="search"></i> Search
        </button>
      </form>

      <div id="search-results-area">${renderResults()}</div>
    </div>
  `;
  window.refreshIcons?.();

  $('#search-form', root).addEventListener('submit', (e) => {
    e.preventDefault();
    state.query = $('#search-q', root).value;
    state.sub   = $('#search-sub', root).value;
    state.sort  = $('#search-sort', root).value;
    state.time  = $('#search-time', root).value;
    doSearch(root);
  });

  // Delegated external-link handler — every `[data-extlink]` button in
  // the results area opens via `api.openUrl()` instead of letting the
  // webview intercept and route through the shell plugin (which would
  // throw `shell.open not allowed` since we don't grant `shell:allow-
  // open` in capabilities). One listener, survives result-area
  // re-renders. See renderRow comment for context.
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-extlink]');
    if (!btn) return;
    e.preventDefault();
    const url = btn.dataset.extlink;
    if (!url || url === '#') return;
    api.openUrl(url).catch(err => console.warn('[search] openUrl failed:', err));
  });
}
