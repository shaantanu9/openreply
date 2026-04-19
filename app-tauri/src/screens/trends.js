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
  return `
    <div class="empty-state">
      <p>No trends analysis yet for <b>${esc(topic)}</b>.</p>
      <p class="muted">Classifies your painpoints as CHRONIC, EMERGING, or FADING using the May-2025 pullpush cutoff as a natural experiment.</p>
      <button class="btn primary icon-btn" id="btn-run-trends"><i data-lucide="trending-up"></i> Run trends analysis</button>
      <div id="trends-status" class="muted" style="margin-top:8px"></div>
    </div>
  `;
}

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

async function runAndRender(contentEl, topic) {
  contentEl.innerHTML = `<div class="empty-state">Running temporal-gaps analysis… this may take 30-90 seconds.</div>`;
  try {
    const result = await api.runTemporalGaps(topic);
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      // Error / parse-error / skipped
      if (result.skipped) {
        contentEl.innerHTML = `<div class="empty-state"><p>Skipped: ${esc(result.reason || 'no LLM provider')}.</p><p>Add a key in Settings → API keys.</p></div>`;
        return;
      }
      if (result._error) {
        contentEl.innerHTML = renderErrorState(topic, result._error);
        $('#btn-trends-retry', contentEl)?.addEventListener('click', () => runAndRender(contentEl, topic));
        window.refreshIcons?.();
        return;
      }
      if (result._parse_error) {
        contentEl.innerHTML = `<div class="empty-state"><p>The LLM response could not be parsed as JSON. Try re-running.</p></div>`;
        return;
      }
    }
    const items = Array.isArray(result) ? result : [];
    if (items.length === 0) {
      contentEl.innerHTML = renderEmptyCta(topic);
      $('#btn-run-trends', contentEl)?.addEventListener('click', () => runAndRender(contentEl, topic));
      window.refreshIcons?.();
      return;
    }
    contentEl.innerHTML = renderResults(topic, items);
    window.refreshIcons?.();
    $('#btn-rerun-trends', contentEl)?.addEventListener('click', () => runAndRender(contentEl, topic));
  } catch (e) {
    contentEl.innerHTML = `<div class="empty-state"><p>Error: ${esc(e?.message || String(e))}</p></div>`;
  }
}

export async function loadTrends(contentEl, topic) {
  contentEl.innerHTML = `<div class="empty-state">loading…</div>`;
  contentEl.innerHTML = renderEmptyCta(topic);
  $('#btn-run-trends', contentEl)?.addEventListener('click', () => runAndRender(contentEl, topic));
  window.refreshIcons?.();
}
