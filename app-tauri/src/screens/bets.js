// Bets tab (Phase 3) — hypothesis tracking / decision journal.
// Lists every hypothesis the user has promoted from Insights into a
// trackable bet, grouped by state. Users update state + attach notes
// as they run tests in the real world. This is the weekly-return surface.
//
// See docs/ROADMAP.md §"Phase 3" for the full state machine.
import { api, esc } from '../api.js';

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

function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(); } catch { return ''; }
}

function renderBetCard(row) {
  const card = row.card || {};
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
          ${esc(card.finding_title || card.experiences || '(untitled bet)')}
        </div>
      </div>
      <div class="bet-meta">${esc(dates)}</div>

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
  set(`
    <div class="empty-state" style="padding:40px;text-align:center">
      <div class="map-building-spinner" style="margin:0 auto 10px"></div>
      <div style="color:var(--ink-3);font-size:var(--fs-13)">Loading your bets…</div>
    </div>
  `);

  let rows = [];
  try {
    rows = await api.hypothesisList(topic, null, false);
  } catch (e) {
    if (contentEl.dataset.tab !== 'bets') return;
    set(`<div class="empty-state"><p>Error loading bets: ${esc(e?.message || String(e))}</p></div>`);
    return;
  }
  if (contentEl.dataset.tab !== 'bets') return;

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
