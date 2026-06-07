// People to reach — the real humans voicing a topic's gaps.
//
// Topic-wide outreach board: author · engagement · gaps voiced · persona ·
// a clickable permalink to the post you'd reply to. Reached via #/people/<topic>.
// Build rolls up evidence authors from the scored gaps (needs pain scores first).
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Reddit permalinks are stored as a path ("/r/x/comments/…"); make absolute.
const fullUrl = (pl) => {
  const s = String(pl || '');
  if (!s) return '';
  if (/^https?:\/\//.test(s)) return s;
  return 'https://www.reddit.com' + (s.startsWith('/') ? s : '/' + s);
};

export async function renderGapAudience(main, topicRaw) {
  const topic = decodeURIComponent(topicRaw || '');
  let filter = '';
  let rows = [];

  main.innerHTML = `
    <div class="screen" style="max-width:1040px;margin:0 auto;padding:16px 20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <button id="ga-back" class="btn btn-ghost btn-sm" type="button"><i data-lucide="arrow-left"></i></button>
        <i data-lucide="users" style="color:var(--accent,#5B8DB8)"></i>
        <h2 style="margin:0;font-size:18px">People to reach</h2>
        <span class="muted" style="font-size:12.5px">${esc(topic)}</span>
      </div>
      <p class="muted" style="font-size:12.5px;margin:4px 0 12px">
        The actual people voicing this topic's gaps right now — open a permalink and reply, or export the list for outreach.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        <input id="ga-filter" type="search" placeholder="Filter people…" style="flex:1 1 240px;min-width:0;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:inherit;font-size:13px" />
        <button class="btn btn-primary btn-sm" id="ga-build" type="button"><i data-lucide="refresh-cw"></i> Build / refresh</button>
        <button class="btn btn-sm btn-bordered" id="ga-csv" type="button"><i data-lucide="download"></i> Export CSV</button>
      </div>
      <div id="ga-status" class="muted" style="font-size:12px;margin-bottom:8px"></div>
      <div id="ga-slot"><div class="muted" style="font-size:12.5px">Loading…</div></div>
    </div>`;
  window.refreshIcons?.();

  const slot = main.querySelector('#ga-slot');
  const statusEl = main.querySelector('#ga-status');
  main.querySelector('#ga-back')?.addEventListener('click', () => history.back());

  const renderTable = () => {
    let view = rows;
    if (filter) {
      const f = filter.toLowerCase();
      view = rows.filter(r => (r.author + ' ' + (r.persona_label || '') + ' ' + (r.post_title || '')).toLowerCase().includes(f));
    }
    if (!rows.length) {
      slot.innerHTML = `<div class="empty-big" style="padding:24px;text-align:center">
        <h3>No people yet</h3>
        <p class="muted" style="font-size:13px">Build pain scores first, then click <b>Build / refresh</b> to roll up the people behind each gap.</p></div>`;
      return;
    }
    slot.innerHTML = `
      <div style="overflow:auto;border:1px solid var(--line);border-radius:10px">
      <table style="border-collapse:collapse;width:100%;font-size:12.5px">
        <thead><tr>
          <th style="padding:7px 9px;border-bottom:2px solid var(--line);font-size:11.5px;width:32px">#</th>
          <th style="text-align:left;padding:7px 9px;border-bottom:2px solid var(--line);font-size:11.5px;text-transform:uppercase;letter-spacing:.03em">Person</th>
          <th style="text-align:left;padding:7px 9px;border-bottom:2px solid var(--line);font-size:11.5px;text-transform:uppercase;letter-spacing:.03em">Persona</th>
          <th style="text-align:right;padding:7px 9px;border-bottom:2px solid var(--line);font-size:11.5px;text-transform:uppercase;letter-spacing:.03em">Engage</th>
          <th style="text-align:right;padding:7px 9px;border-bottom:2px solid var(--line);font-size:11.5px;text-transform:uppercase;letter-spacing:.03em">Gaps</th>
          <th style="text-align:left;padding:7px 9px;border-bottom:2px solid var(--line);font-size:11.5px;text-transform:uppercase;letter-spacing:.03em">Reach</th>
        </tr></thead>
        <tbody>
          ${view.map((r, i) => `<tr style="border-bottom:1px solid var(--line)">
            <td style="padding:7px 9px;color:var(--muted);font-size:11.5px">${i + 1}</td>
            <td style="padding:7px 9px;vertical-align:top">
              <div style="font-weight:600">u/${esc(r.author)}</div>
              ${r.post_title ? `<div class="muted" style="font-size:11px;margin-top:2px">${esc(String(r.post_title).slice(0, 90))}</div>` : ''}
            </td>
            <td style="padding:7px 9px;vertical-align:top">${r.persona_label ? `<span style="padding:2px 7px;border-radius:999px;background:var(--accent,#5B8DB8)1a;color:var(--accent,#5B8DB8);font-size:11px">${esc(r.persona_label)}</span>` : '<span class="muted" style="font-size:11px">—</span>'}</td>
            <td style="padding:7px 9px;text-align:right;vertical-align:top">${esc(r.engagement)}</td>
            <td style="padding:7px 9px;text-align:right;vertical-align:top">${esc(r.gap_count ?? (r.gaps ? r.gaps.length : 1))}</td>
            <td style="padding:7px 9px;vertical-align:top">${r.permalink ? `<a href="${esc(fullUrl(r.permalink))}" target="_blank" rel="noopener" style="color:var(--accent,#5B8DB8);text-decoration:none">open ↗</a>` : '<span class="muted">—</span>'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="muted" style="font-size:11.5px;margin-top:6px">${view.length} of ${rows.length} people${filter ? ' (filtered)' : ''}</div>`;
  };

  const load = async () => {
    try {
      const r = await api.gapAudience(topic, {});
      rows = (r && r.rows) || [];
    } catch (e) {
      slot.innerHTML = `<div class="muted" style="font-size:12.5px;color:#B84747">${esc(e?.message || e)}</div>`;
      return;
    }
    renderTable();
    window.refreshIcons?.();
  };

  main.querySelector('#ga-filter')?.addEventListener('input', (e) => { filter = e.target.value; renderTable(); });

  main.querySelector('#ga-build')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2"></i> building…';
    window.refreshIcons?.();
    try {
      const r = await api.gapAudienceBuild(topic);
      statusEl.textContent = r?.ok
        ? `Done — ${r.people} people across ${r.gaps} gaps.`
        : `Build failed: ${r?.error || 'unknown'} (build pain scores first).`;
      await load();
    } catch (err) {
      statusEl.textContent = `Build failed: ${err?.message || err}`;
    } finally {
      btn.disabled = false; btn.innerHTML = orig; window.refreshIcons?.();
    }
  });

  main.querySelector('#ga-csv')?.addEventListener('click', async () => {
    try {
      if (!rows.length) { statusEl.textContent = 'Nothing to export yet — build the list first.'; return; }
      const header = 'author,permalink,engagement,gap_count,persona,post_title';
      const lines = rows.map(r => [r.author, fullUrl(r.permalink), r.engagement,
        r.gap_count ?? (r.gaps ? r.gaps.length : 1), `"${String(r.persona_label || '').replace(/"/g, '""')}"`,
        `"${String(r.post_title || '').replace(/"/g, '""')}"`].join(','));
      await navigator.clipboard?.writeText([header, ...lines].join('\n')).catch(() => {});
      statusEl.textContent = `CSV copied to clipboard (${rows.length} people).`;
    } catch (e) {
      statusEl.textContent = `Export failed: ${e?.message || e}`;
    }
  });

  await load();
}
