// Bets tab (Phase 3) — hypothesis tracking / decision journal.
// Lists every hypothesis the user has promoted from Insights into a
// trackable bet, grouped by state. Users update state + attach notes
// as they run tests in the real world. This is the weekly-return surface.
//
// See docs/ROADMAP.md §"Phase 3" for the full state machine.
import { api, esc } from '../api.js';
import { readScreenCache, writeScreenCache } from '../lib/screenCache.js';
import { skelGrid } from '../lib/skeleton.js';

const $ = (sel, root = document) => root.querySelector(sel);

// State → display config. Order matches lean-startup lifecycle.
const STATE_META = {
  draft:       { icon: '📝', label: 'Draft',       color: '#8A8178', next: ['running', 'archived'] },
  running:     { icon: '🏃', label: 'Running',     color: '#1F5C99', next: ['validated', 'invalidated', 'paused'] },
  validated:   { icon: '✓',  label: 'Validated',   color: '#1A7A4F', next: ['running', 'archived'] },
  invalidated: { icon: '✗',  label: 'Invalidated', color: '#B84747', next: ['running', 'archived'] },
  paused:      { icon: '⏸',  label: 'Paused',      color: '#C47A14', next: ['running', 'archived'] },
  archived:    { icon: '📦', label: 'Archived',    color: '#8A8178', next: ['draft'] },
};

const STATE_ORDER = ['running', 'validated', 'invalidated', 'paused', 'draft', 'archived'];

// Statuses shown in the top summary strip (lifecycle order). Archived is
// intentionally omitted from the strip — it's not an "active" outcome.
const SUMMARY_STATES = ['draft', 'running', 'validated', 'invalidated', 'paused'];

function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(); } catch { return ''; }
}

// Defensively parse the hypothesis card. Prefer an already-parsed `row.card`,
// then fall back to a raw `row.card_json` string. Never throw on bad JSON.
function parseCard(row) {
  if (row && row.card && typeof row.card === 'object') return row.card;
  const raw = row && row.card_json;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}

// Compact statement of the bet, parsed defensively from the card.
function betStatement(card) {
  if (card.we_believe || card.experiences) {
    const parts = [];
    if (card.we_believe) parts.push(`We believe ${card.we_believe}`);
    if (card.experiences) parts.push(`experiences ${card.experiences}`);
    return parts.join(', ');
  }
  return card.finding_title || card.statement || '(untitled bet)';
}

// Top-of-screen counts-per-status strip. Colored chips reuse STATE_META colors.
function renderSummaryStrip(groups) {
  const chips = SUMMARY_STATES.map(s => {
    const meta = STATE_META[s];
    const count = (groups[s] || []).length;
    const dim = count === 0 ? ' bet-summary-chip-empty' : '';
    return `
      <span class="bet-summary-chip${dim}"
            style="background:${meta.color}22;color:${meta.color};border-color:${meta.color}55"
            title="${esc(count)} ${esc(meta.label)}">
        <span>${meta.icon}</span>
        <b>${esc(count)}</b>
        <span>${esc(meta.label)}</span>
      </span>`;
  }).join('');
  return `<div class="bet-summary-strip">${chips}</div>`;
}

function renderBetCard(row) {
  const card = parseCard(row);
  const meta = STATE_META[row.status] || STATE_META.draft;
  const falsifiers = (card.falsifiers || []).map(f => `<li>${esc(f)}</li>`).join('');
  const nextActions = meta.next.map(s => {
    const m = STATE_META[s];
    return `<button class="bet-action-btn" data-id="${esc(row.id)}" data-next-status="${esc(s)}"
             title="Move to ${esc(m.label)}">${m.icon} ${esc(m.label)}</button>`;
  }).join('');

  const dates = [
    row.created_at ? `created ${fmtDate(row.created_at)}` : '',
    row.started_at ? `started ${fmtDate(row.started_at)}` : '',
    row.resolved_at ? `resolved ${fmtDate(row.resolved_at)}` : '',
  ].filter(Boolean).join(' · ');

  const notes = row.resolution_notes
    ? `<div class="bet-notes"><b>Journal:</b><pre>${esc(row.resolution_notes)}</pre></div>`
    : '';

  // One-line resolution-notes preview shown in the card header area when present.
  const notesPreviewText = (row.resolution_notes || '').replace(/\s+/g, ' ').trim();
  const notesPreview = notesPreviewText
    ? `<div class="bet-notes-preview muted" title="${esc(notesPreviewText)}">💬 ${esc(notesPreviewText.slice(0, 120))}${notesPreviewText.length > 120 ? '…' : ''}</div>`
    : '';

  const cheapest = card.cheapest_test
    ? `<div class="bet-test"><b>Cheapest test:</b> ${esc(card.cheapest_test)}
         <span class="muted">· ${card.time_box_days || 14}d · $${card.budget_usd || 100}</span></div>`
    : '';

  return `
    <div class="bet-card bet-state-${esc(row.status)}" data-id="${esc(row.id)}">
      <div class="bet-head">
        <div class="bet-state" style="background:${meta.color}22;color:${meta.color}">
          ${meta.icon} ${esc(meta.label)}
        </div>
        <div class="bet-title">
          ${esc(betStatement(card))}
        </div>
      </div>
      <div class="bet-meta">${esc(dates)}</div>
      ${notesPreview}

      <div class="bet-body">
        <div class="bet-row"><b>WE BELIEVE</b><span>${esc(card.we_believe || '')}</span></div>
        <div class="bet-row"><b>EXPERIENCES</b><span>${esc(card.experiences || '')}</span></div>
        ${card.because ? `<div class="bet-row"><b>BECAUSE</b><span>${esc(card.because)}</span></div>` : ''}
        <div class="bet-row"><b>FOR</b><span>${esc(card['for'] || '')}</span></div>
        <div class="bet-falsifiers">
          <b>We'll know we're wrong if:</b>
          <ul>${falsifiers || '<li class="muted">(no falsifiers)</li>'}</ul>
        </div>
        ${cheapest}
      </div>

      ${notes}

      <div class="bet-actions">
        ${nextActions}
        <button class="bet-action-btn bet-note-btn" data-id="${esc(row.id)}">
          💬 Add note
        </button>
      </div>
    </div>
  `;
}

function renderGroup(state, rows) {
  const meta = STATE_META[state];
  if (!rows.length) return '';
  return `
    <section class="bet-group">
      <h3 class="bet-group-head" style="color:${meta.color}">
        <span>${meta.icon}</span>
        <span>${meta.label}</span>
        <span class="muted">(${rows.length})</span>
      </h3>
      <div class="bet-group-body">${rows.map(renderBetCard).join('')}</div>
    </section>
  `;
}

export async function loadBets(contentEl, topic) {
  const set = (html) => { if (contentEl.dataset.tab === 'bets') contentEl.innerHTML = html; };

  // SWR: paint cached bets immediately, refresh in background. See
  // docs/perf-audit.md for the universal pattern. Cache survives full
  // app restart so re-opening any topic's Bets tab paints in <10 ms.
  // Mutation listener in main.js (kind='hypothesis') drops the cache
  // when the user updates a bet's state, so the next visit refetches.
  const CACHE_KEY = `bets.${topic}`;
  const cachedRows = readScreenCache(CACHE_KEY);
  let paintedFromCache = false;

  const renderRows = (rows) => {
    if (!rows || rows.length === 0) {
      set(`
        <div class="empty-big">
          <h3>No tracked bets yet</h3>
          <p>Bets are promoted from your <b>Insights</b> tab. When a hypothesis card looks worth testing in the real world, hit <b>“Save as bet”</b> on it — it lands here as a <b>draft</b> you can move through the state machine (draft → running → validated / invalidated / paused) and journal against.</p>
          <p class="muted" style="font-size:12px;margin-top:10px">This is your weekly-ritual surface — come back to update states and add notes as you run real-world tests.</p>
          <div style="margin-top:16px">
            <a class="btn" href="#/topic/${esc(encodeURIComponent(topic || ''))}" data-insights="1">→ Go to Insights and save a bet</a>
          </div>
        </div>
      `);
      return;
    }
    const groups = {};
    for (const state of STATE_ORDER) groups[state] = [];
    for (const r of rows) (groups[r.status] || groups.draft).push(r);
    set(`
      <div class="bets-tab">
        <div class="bets-toolbar">
          ${renderSummaryStrip(groups)}
          <div class="bets-summary muted">
            ${esc(rows.length)} bet${rows.length === 1 ? '' : 's'} tracked
          </div>
        </div>
        ${STATE_ORDER.map(s => renderGroup(s, groups[s])).join('')}
      </div>
    `);
    window.refreshIcons?.();
    wireBetActions(contentEl, topic);
  };

  if (Array.isArray(cachedRows) && cachedRows.length > 0) {
    renderRows(cachedRows);
    paintedFromCache = true;
  } else {
    set(skelGrid(4, { lines: 4 }));
  }

  let rows = [];
  try {
    rows = await api.hypothesisList(topic, null, false);
  } catch (e) {
    if (contentEl.dataset.tab !== 'bets') return;
    if (paintedFromCache) return;   // keep stale-but-valid render
    set(`<div class="empty-state"><p>Error loading bets: ${esc(e?.message || String(e))}</p></div>`);
    return;
  }
  if (contentEl.dataset.tab !== 'bets') return;

  if (Array.isArray(rows)) writeScreenCache(CACHE_KEY, rows);
  renderRows(rows);
  return;
  // Below this line is the legacy first-paint code path, kept only as
  // a no-op safety net — the early `return` above should always trip.
  if (!rows || rows.length === 0) {
    set(`
      <div class="empty-big">
        <h3>No tracked bets yet</h3>
        <p>Promote any hypothesis card from the <b>Insights</b> tab to track it here. Each bet has a state machine (draft → running → validated / invalidated) and a journal for notes.</p>
        <p class="muted" style="font-size:var(--fs-13);margin-top:10px">This is your weekly-ritual surface — come back to update states as you run real-world tests.</p>
      </div>
    `);
    return;
  }

  // Group by state
  const groups = {};
  for (const state of STATE_ORDER) groups[state] = [];
  for (const r of rows) (groups[r.status] || groups.draft).push(r);

  set(`
    <div class="bets-tab">
      <div class="bets-toolbar">
        <div class="bets-summary muted">
          ${rows.length} bet${rows.length === 1 ? '' : 's'} ·
          ${groups.running.length} running ·
          ${groups.validated.length} validated ·
          ${groups.invalidated.length} invalidated
        </div>
      </div>
      ${STATE_ORDER.map(s => renderGroup(s, groups[s])).join('')}
    </div>
  `);
  window.refreshIcons?.();
  wireBetActions(contentEl, topic);
}

function wireBetActions(contentEl, topic) {
  // State transitions — click a pill next to any bet
  contentEl.querySelectorAll('.bet-action-btn:not(.bet-note-btn)').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const nextStatus = btn.dataset.nextStatus;
      if (!id || !nextStatus) return;
      let notes = null;
      if (nextStatus === 'validated' || nextStatus === 'invalidated') {
        notes = prompt(`What's the evidence this is ${nextStatus}?`) || null;
      } else if (nextStatus === 'paused') {
        notes = prompt('Why are you pausing this bet?') || null;
      }
      btn.disabled = true;
      btn.textContent = '…';
      try {
        await api.hypothesisUpdateStatus(id, nextStatus, notes || undefined);
        await loadBets(contentEl, topic);
      } catch (e) {
        alert(`Update failed: ${e?.message || e}`);
        btn.disabled = false;
      }
    });
  });

  // Add-note button
  contentEl.querySelectorAll('.bet-note-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!id) return;
      const note = prompt('Add a note to the journal:');
      if (!note || !note.trim()) return;
      const card = contentEl.querySelector(`.bet-card[data-id="${id}"]`);
      const currentStatus = [...(card?.classList || [])]
        .find(c => c.startsWith('bet-state-'))?.replace('bet-state-', '') || 'draft';
      try {
        await api.hypothesisUpdateStatus(id, currentStatus, note);
        await loadBets(contentEl, topic);
      } catch (e) {
        alert(`Failed: ${e?.message || e}`);
      }
    });
  });
}

// Helper used from insights.js — prompts the user, creates the bet, toasts.
export async function saveBetFromCard(topic, card) {
  try {
    const row = await api.hypothesisCreate(topic, JSON.stringify(card), 'draft');
    // Lightweight toast (no deps; uses existing .modal-backdrop pattern)
    const t = document.createElement('div');
    t.className = 'toast toast-success';
    t.innerHTML = `✓ Saved as draft bet. <a href="#/topic/${encodeURIComponent(topic)}" data-bets="1">Open Bets tab →</a>`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
    return row;
  } catch (e) {
    alert(`Couldn't save bet: ${e?.message || e}`);
    throw e;
  }
}
