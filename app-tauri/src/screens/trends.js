// Trends tab — chronic / emerging / fading painpoint classification.
// Calls reddit-cli research temporal-gaps via the Tauri sidecar.
import { api, esc } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);

const CATEGORIES = [
  { key: 'CHRONIC',  label: 'Chronic',  icon: 'flame',         hint: 'Present in BOTH pre-May-2025 AND post-May-2025 corpora — well-established pain.' },
  { key: 'EMERGING', label: 'Emerging', icon: 'sparkles',      hint: 'Only post-May-2025 — genuinely new pain. High-signal opportunity.' },
  { key: 'FADING',   label: 'Fading',   icon: 'trending-down', hint: 'Only pre-May-2025 — already solved or abandoned.' },
];

function renderCard(item) {
  const sev = item.severity || '';
  const sevClass = `sev-${sev.toLowerCase()}` || '';
  const pre  = item.pre_2025_freq ?? 0;
  const post = item.post_2025_freq ?? 0;
  const evidence = item.evidence ? `<div class="trends-evidence">"${esc(item.evidence)}"</div>` : '';
  return `
    <div class="trends-card">
      <div class="trends-card-head">
        <span class="trends-painpoint">${esc(item.painpoint || item.title || 'Untitled')}</span>
        ${sev ? `<span class="trends-sev ${sevClass}">${esc(sev)}</span>` : ''}
      </div>
      ${evidence}
      <div class="trends-freq">
        <span title="Pre-May-2025 frequency">pre: <b>${pre}</b></span>
        <span title="Post-May-2025 frequency">post: <b>${post}</b></span>
      </div>
    </div>
  `;
}

function renderEmptyForCategory(cat) {
  return `<div class="trends-empty muted">No ${cat.label.toLowerCase()} painpoints found.</div>`;
}

function renderErrorState(topic, message) {
  return `
    <div class="empty-state">
      <p><b>Trends needs both pre- and post-May-2025 data.</b></p>
      <p class="muted">${esc(message)}</p>
      <p>Run <code>collect --aggressive</code> (which includes historical pullpush data) before retrying.</p>
      <button class="btn primary icon-btn" id="btn-trends-retry"><i data-lucide="refresh-cw"></i> Retry</button>
    </div>
  `;
}

function renderEmptyCta(topic) {
  // Kept for the "no results returned" post-run path only. First-view now
  // auto-runs (see loadTrends) so users no longer need to click a CTA.
  return `
    <div class="empty-state">
      <p>No trend patterns detected for <b>${esc(topic)}</b>.</p>
      <p class="muted">This usually means the corpus needs more historical data. Run <code>collect --aggressive</code> to pull pre-May-2025 posts.</p>
      <button class="btn primary icon-btn" id="btn-run-trends"><i data-lucide="refresh-cw"></i> Re-run analysis</button>
    </div>
  `;
}

// Per-topic in-memory cache of the last trends result. Lives on the module
// scope so switching between tabs doesn't re-spawn the LLM call on every
// re-render of the Trends tab. Cleared when the user explicitly re-runs.
const _trendsCache = new Map();   // topic → items[]
const _trendsRunning = new Set(); // topic → bool (dedup concurrent auto-runs)

function renderResults(topic, items) {
  const groups = { CHRONIC: [], EMERGING: [], FADING: [] };
  for (const it of items) {
    const cls = (it.classification || '').toUpperCase();
    if (groups[cls]) groups[cls].push(it);
  }
  const cols = CATEGORIES.map(cat => {
    const list = groups[cat.key];
    const body = list.length === 0
      ? renderEmptyForCategory(cat)
      : list.map(renderCard).join('');
    return `
      <div class="trends-col" data-cat="${cat.key}">
        <div class="trends-col-head">
          <i data-lucide="${cat.icon}"></i>
          <h4>${cat.label} <span class="muted">(${list.length})</span></h4>
        </div>
        <p class="trends-col-hint muted">${esc(cat.hint)}</p>
        <div class="trends-col-body">${body}</div>
      </div>
    `;
  }).join('');
  return `
    <div class="trends-tab">
      <div class="trends-toolbar">
        <button class="btn icon-btn" id="btn-rerun-trends"><i data-lucide="refresh-cw"></i> Re-run analysis</button>
      </div>
      <div class="trends-grid">${cols}</div>
    </div>
  `;
}

async function runAndRender(contentEl, topic, force = false) {
  const set = (html) => { if (contentEl.dataset.tab === 'trends') contentEl.innerHTML = html; };
  set(`<div class="empty-state">${force ? 'Re-running' : 'Running'} temporal-gaps analysis… this may take 30-90 seconds.</div>`);
  try {
    // force=true bypasses the graph_nodes cache (kind='temporal_gap') on the
    // Python side and re-calls the LLM. Default cache-hit returns in <100ms.
    const result = await api.runTemporalGaps(topic, force);
    if (contentEl.dataset.tab !== 'trends') return;
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      // Error / parse-error / skipped
      if (result.skipped) {
        set(`<div class="empty-state"><p>Skipped: ${esc(result.reason || 'no LLM provider')}.</p><p>Add a key in Settings → API keys.</p></div>`);
        return;
      }
      if (result._error) {
        set(renderErrorState(topic, result._error));
        if (contentEl.dataset.tab !== 'trends') return;
        $('#btn-trends-retry', contentEl)?.addEventListener('click', () => runAndRender(contentEl, topic));
        window.refreshIcons?.();
        return;
      }
      if (result._parse_error) {
        set(`<div class="empty-state"><p>The LLM response could not be parsed as JSON. Try re-running.</p></div>`);
        return;
      }
    }
    const items = Array.isArray(result) ? result : [];
    _trendsCache.set(topic, items);
    if (items.length === 0) {
      set(renderEmptyCta(topic));
      if (contentEl.dataset.tab !== 'trends') return;
      $('#btn-run-trends', contentEl)?.addEventListener('click', () => {
        _trendsCache.delete(topic);
        runAndRender(contentEl, topic, /* force */ true);
      });
      window.refreshIcons?.();
      return;
    }
    set(renderResults(topic, items));
    if (contentEl.dataset.tab !== 'trends') return;
    window.refreshIcons?.();
    $('#btn-rerun-trends', contentEl)?.addEventListener('click', () => {
      _trendsCache.delete(topic);
      runAndRender(contentEl, topic, /* force */ true);
    });
  } catch (e) {
    set(`<div class="empty-state"><p>Error: ${esc(e?.message || String(e))}</p></div>`);
  }
}

export async function loadTrends(contentEl, topic) {
  if (contentEl.dataset.tab !== 'trends') return;
  // Auto-run on first view — cached in module scope so flipping tabs
  // doesn't re-spawn the 30-90s LLM call. User can explicitly re-run via
  // the toolbar button once results are painted.
  const cached = _trendsCache.get(topic);
  if (cached) {
    if (cached.length === 0) {
      contentEl.innerHTML = renderEmptyCta(topic);
      $('#btn-run-trends', contentEl)?.addEventListener('click', () => {
        _trendsCache.delete(topic);
        runAndRender(contentEl, topic, /* force */ true);
      });
      window.refreshIcons?.();
      return;
    }
    contentEl.innerHTML = renderResults(topic, cached);
    window.refreshIcons?.();
    $('#btn-rerun-trends', contentEl)?.addEventListener('click', () => {
      _trendsCache.delete(topic);
      runAndRender(contentEl, topic, /* force */ true);
    });
    return;
  }
  // No cache → auto-run. Dedup in case user flips tabs during the 30-90s
  // LLM call (second call would queue behind Ollama and stall the UI).
  if (_trendsRunning.has(topic)) {
    contentEl.innerHTML = `<div class="empty-state">Running temporal-gaps analysis… 30–90 seconds. Tab will auto-populate.</div>`;
    return;
  }
  _trendsRunning.add(topic);
  try {
    await runAndRender(contentEl, topic);
  } finally {
    _trendsRunning.delete(topic);
  }
}
