// Hypotheses tracker tab — a dedicated, table-style surface for every
// hypothesis the user has promoted from Insights ("Save as bet"). Where the
// Bets tab groups cards into a lean-startup board, this screen is the flat
// ledger: one row per hypothesis with its statement, a status pill, dates,
// and inline controls to advance the state machine or delete the row.
//
// The ENTIRE backend already exists. This file only renders + wires:
//   api.hypothesisStats(topic)        -> { ok, topic, stats:{status:count} }
//   api.hypothesisList(topic, status) -> [ { id, topic, card, card_json,
//                                            status, started_at, resolved_at,
//                                            resolution_notes, linked_evidence,
//                                            evidence, created_at, ... } ]
//   api.hypothesisUpdateStatus(id, status, notes)
//   api.hypothesisDelete(id)
//
// Status colors are kept consistent with bets.js (STATE_META).
import { api, esc } from '../api.js';

// Status → display config. Colors mirror bets.js so a hypothesis reads the
// same wherever it appears. Order matches the lean-startup lifecycle.
const STATUS_META = {
  draft:       { icon: '📝', label: 'Draft',       color: '#8A8178' },
  running:     { icon: '🏃', label: 'Running',     color: '#1F5C99' },
  validated:   { icon: '✓',  label: 'Validated',   color: '#1A7A4F' },
  invalidated: { icon: '✗',  label: 'Invalidated', color: '#B84747' },
  paused:      { icon: '⏸',  label: 'Paused',      color: '#C47A14' },
  archived:    { icon: '📦', label: 'Archived',    color: '#8A8178' },
};

// Order the status chips render in the summary strip.
const STATUS_ORDER = ['draft', 'running', 'validated', 'invalidated', 'paused', 'archived'];

// Selectable target statuses in the inline <select>.
const SELECTABLE = ['draft', 'running', 'validated', 'invalidated', 'paused', 'archived'];

function metaFor(status) {
  return STATUS_META[status] || STATUS_META.draft;
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString();
  } catch { return ''; }
}

// Defensively obtain the parsed card. The native command pre-hydrates
// `card`, but we still try/catch-parse `card_json` as a fallback so a
// malformed/absent hydration never throws.
function cardOf(row) {
  if (row && row.card && typeof row.card === 'object') return row.card;
  if (row && typeof row.card_json === 'string' && row.card_json.trim()) {
    try {
      const parsed = JSON.parse(row.card_json);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* fall through to empty card */ }
  }
  return {};
}

// Build a one-line human statement for the hypothesis from its card.
function statementOf(card) {
  if (card.finding_title && String(card.finding_title).trim()) {
    return String(card.finding_title);
  }
  const believe = card.we_believe && String(card.we_believe).trim();
  const experiences = card.experiences && String(card.experiences).trim();
  const audience = card['for'] && String(card['for']).trim();
  if (believe || experiences) {
    const parts = [];
    if (believe) parts.push(`We believe ${believe}`);
    if (experiences) parts.push(`will ${experiences}`);
    if (audience) parts.push(`for ${audience}`);
    return parts.join(' ');
  }
  return '(untitled hypothesis)';
}

// A colored status pill — same visual language as bets.js's .bet-state.
function statusPill(status) {
  const m = metaFor(status);
  return `<span class="bet-state" style="background:${m.color}22;color:${m.color};`
    + `display:inline-flex;align-items:center;gap:4px">`
    + `${m.icon} ${esc(m.label)}</span>`;
}

// Summary strip: one colored chip per non-zero status from stats.
function summaryStrip(stats) {
  const chips = STATUS_ORDER
    .filter((s) => (stats[s] || 0) > 0)
    .map((s) => {
      const m = metaFor(s);
      return `<span class="hyp-chip" style="background:${m.color}22;color:${m.color};`
        + `display:inline-flex;align-items:center;gap:5px;padding:3px 10px;`
        + `border-radius:12px;font-size:12px;font-weight:600">`
        + `${m.icon} ${esc(m.label)} <b>${stats[s]}</b></span>`;
    });
  const total = STATUS_ORDER.reduce((acc, s) => acc + (stats[s] || 0), 0);
  if (!chips.length) return '';
  return `<div class="hyp-summary" style="display:flex;gap:8px;flex-wrap:wrap;`
    + `align-items:center;margin:0 0 14px">`
    + `<span class="muted" style="font-size:12.5px;margin-right:2px">`
    + `${total} hypothes${total === 1 ? 'is' : 'es'} ·</span>`
    + `${chips.join('')}</div>`;
}

function rowHtml(row) {
  const card = cardOf(row);
  const statement = statementOf(card);
  const id = esc(String(row.id ?? ''));

  const dates = [
    row.created_at ? `created ${fmtDate(row.created_at)}` : '',
    row.started_at ? `started ${fmtDate(row.started_at)}` : '',
    row.resolved_at ? `resolved ${fmtDate(row.resolved_at)}` : '',
  ].filter(Boolean).join(' · ');

  const notes = row.resolution_notes
    ? `<div class="hyp-notes muted" style="font-size:12px;margin-top:4px">`
      + `<b>Notes:</b> ${esc(row.resolution_notes)}</div>`
    : '';

  const evCount = Array.isArray(row.evidence)
    ? row.evidence.length
    : (Array.isArray(row.linked_evidence) ? row.linked_evidence.length : 0);
  const evidence = evCount
    ? `<span class="muted" style="font-size:11.5px">· ${evCount} linked finding${evCount === 1 ? '' : 's'}</span>`
    : '';

  const options = SELECTABLE.map((s) => {
    const m = metaFor(s);
    const sel = s === row.status ? ' selected' : '';
    return `<option value="${esc(s)}"${sel}>${m.icon} ${esc(m.label)}</option>`;
  }).join('');

  return `
    <tr class="hyp-row" data-id="${id}" data-status="${esc(String(row.status || 'draft'))}">
      <td class="hyp-statement">
        <div style="font-weight:600">${esc(statement)}</div>
        <div class="hyp-meta muted" style="font-size:11.5px;margin-top:2px">
          ${esc(dates)} ${evidence}
        </div>
        ${notes}
      </td>
      <td class="hyp-status-cell" style="white-space:nowrap">${statusPill(row.status)}</td>
      <td class="hyp-controls" style="white-space:nowrap;text-align:right">
        <select class="hyp-status-select" data-id="${id}" title="Change status"
                style="font-size:12px;padding:3px 6px">${options}</select>
        <button class="btn btn-sm hyp-delete-btn" data-id="${id}"
                title="Delete hypothesis"
                style="margin-left:6px">🗑</button>
      </td>
    </tr>`;
}

export async function loadHypotheses(contentEl, topic) {
  const alive = () => contentEl.dataset.tab === 'hypotheses';

  const renderEmpty = () => {
    if (!alive()) return;
    contentEl.innerHTML = `
      <div class="empty-big">
        <h3>No hypotheses tracked yet</h3>
        <p>Hypotheses are promoted from your research findings. In the
        <b>Insights</b> view, hit <b>Save as bet</b> on any hypothesis card and
        it lands here — with a status machine
        (draft → running → validated / invalidated → archived) and a notes
        journal.</p>
        <p class="muted" style="font-size:12px;margin-top:10px">This is your
        weekly-ritual surface — return to advance statuses as you run
        real-world tests.</p>
        <button class="btn btn-primary btn-sm" id="hyp-go-bets" style="margin-top:6px">
          Go to Bets / Home →
        </button>
      </div>`;
    contentEl.querySelector('#hyp-go-bets')?.addEventListener('click', () => {
      const t = document.querySelector('.tab[data-tab="bets"]')
        || document.querySelector('.tab[data-tab="home"]');
      t?.click();
    });
  };

  const render = (rows, stats) => {
    if (!alive()) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      renderEmpty();
      return;
    }
    contentEl.innerHTML = `
      <div class="hypotheses-tab">
        ${summaryStrip(stats || {})}
        <table class="data-table" style="width:100%">
          <thead><tr>
            <th>Hypothesis</th>
            <th>Status</th>
            <th style="text-align:right">Actions</th>
          </tr></thead>
          <tbody>${rows.map(rowHtml).join('')}</tbody>
        </table>
      </div>`;
    window.refreshIcons?.();
    wire(contentEl, topic);
  };

  // Re-fetch both stats + list, then re-render. Used after every mutation.
  const refresh = async () => {
    if (!alive()) return;
    let rows = [];
    let stats = {};
    try {
      const [statsRes, listRes] = await Promise.all([
        api.hypothesisStats(topic).catch(() => null),
        api.hypothesisList(topic, undefined, false),
      ]);
      // hypothesisStats returns { ok, topic, stats } — but tolerate a bare map.
      stats = (statsRes && statsRes.stats && typeof statsRes.stats === 'object')
        ? statsRes.stats
        : (statsRes && typeof statsRes === 'object' && !('ok' in statsRes) ? statsRes : {});
      rows = Array.isArray(listRes) ? listRes : [];
    } catch (e) {
      if (!alive()) return;
      contentEl.innerHTML = `<div class="empty-big"><h3>Couldn't load hypotheses</h3>`
        + `<p>${esc(e?.message || String(e))}</p></div>`;
      return;
    }
    render(rows, stats);
  };

  contentEl.innerHTML = '<div class="empty-state">Loading hypotheses…</div>';
  await refresh();

  // Expose refresh on the closure for the wired handlers below.
  contentEl._hypRefresh = refresh;
}

function wire(contentEl, topic) {
  const alive = () => contentEl.dataset.tab === 'hypotheses';
  const refresh = contentEl._hypRefresh || (() => loadHypotheses(contentEl, topic));

  // Inline status change — <select> per row.
  contentEl.querySelectorAll('.hyp-status-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.id;
      const nextStatus = sel.value;
      if (!id || !nextStatus) return;
      const row = sel.closest('.hyp-row');
      const prevStatus = row?.dataset.status;
      if (nextStatus === prevStatus) return;

      // Ask for evidence/notes on resolving transitions, matching bets.js.
      let notes;
      if (nextStatus === 'validated' || nextStatus === 'invalidated') {
        notes = prompt(`What's the evidence this is ${nextStatus}?`) || undefined;
      } else if (nextStatus === 'paused') {
        notes = prompt('Why are you pausing this hypothesis?') || undefined;
      }

      sel.disabled = true;
      try {
        await api.hypothesisUpdateStatus(id, nextStatus, notes);
        if (alive()) await refresh();   // optimistic: re-fetch + re-render
      } catch (e) {
        alert(`Update failed: ${e?.message || e}`);
        sel.disabled = false;
        if (row && prevStatus) sel.value = prevStatus;   // revert select
      }
    });
  });

  // Delete (with confirm).
  contentEl.querySelectorAll('.hyp-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!id) return;
      if (!confirm('Delete this hypothesis permanently? This cannot be undone.')) return;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        await api.hypothesisDelete(id);
        if (alive()) await refresh();   // optimistic: re-fetch + re-render
      } catch (e) {
        alert(`Delete failed: ${e?.message || e}`);
        btn.disabled = false;
        btn.textContent = '🗑';
      }
    });
  });
}
