// Gap alerts — saved monitoring for a topic's gaps.
//
// Create watches (spike / new / score threshold), run a check now, and see the
// fired-event history. Reached via #/alerts/<topic>.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export async function renderGapAlerts(main, topicRaw) {
  const topic = decodeURIComponent(topicRaw || '');
  let alerts = [];
  let events = [];

  main.innerHTML = `
    <div class="screen" style="max-width:900px;margin:0 auto;padding:16px 20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <button id="al-back" class="btn btn-ghost btn-sm" type="button"><i data-lucide="arrow-left"></i></button>
        <i data-lucide="bell" style="color:var(--accent,#5B8DB8)"></i>
        <h2 style="margin:0;font-size:18px">Gap alerts</h2>
        <span class="muted" style="font-size:12.5px">${esc(topic)}</span>
      </div>
      <p class="muted" style="font-size:12.5px;margin:4px 0 12px">
        Get notified when a gap spikes, goes new, or crosses a pain-score threshold. Run a check now or schedule it (see docs/manual-todo).
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
        <select id="al-type" style="padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:inherit;font-size:13px">
          <option value="spike">Spike (rising fast)</option>
          <option value="new">New gap appears</option>
          <option value="score_threshold">Pain score ≥ threshold</option>
        </select>
        <input id="al-threshold" type="number" placeholder="threshold" style="width:110px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:inherit;font-size:13px" />
        <button class="btn btn-primary btn-sm" id="al-create" type="button"><i data-lucide="plus"></i> Add alert</button>
        <button class="btn btn-sm btn-bordered" id="al-check" type="button"><i data-lucide="play"></i> Check now</button>
      </div>
      <div id="al-status" class="muted" style="font-size:12px;margin-bottom:10px"></div>
      <h3 style="font-size:13.5px;margin:8px 0 6px">Active alerts</h3>
      <div id="al-list"><div class="muted" style="font-size:12.5px">Loading…</div></div>
      <h3 style="font-size:13.5px;margin:18px 0 6px">Recent events</h3>
      <div id="al-events"><div class="muted" style="font-size:12.5px">—</div></div>
    </div>`;
  window.refreshIcons?.();

  const statusEl = main.querySelector('#al-status');
  main.querySelector('#al-back')?.addEventListener('click', () => history.back());

  const renderList = () => {
    const slot = main.querySelector('#al-list');
    if (!alerts.length) {
      slot.innerHTML = `<div class="muted" style="font-size:12.5px">No alerts yet — add one above.</div>`;
      return;
    }
    slot.innerHTML = alerts.map(a => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid var(--line);border-radius:9px;margin-bottom:7px">
        <span style="padding:2px 8px;border-radius:999px;background:var(--accent,#5B8DB8)1a;color:var(--accent,#5B8DB8);font-size:11px;font-weight:600">${esc(a.alert_type)}</span>
        <span style="font-size:12.5px">threshold ${esc(a.threshold)}${a.gap_id ? ` · gap ${esc(a.gap_id)}` : ' · whole topic'}</span>
        <span class="muted" style="font-size:11px;margin-left:auto">${a.last_triggered_at ? 'last fired ' + esc(a.last_triggered_at.slice(0, 10)) : 'never fired'}</span>
        <button class="btn btn-ghost btn-sm" data-del="${esc(a.alert_id)}" type="button"><i data-lucide="trash-2"></i></button>
      </div>`).join('');
    slot.querySelectorAll('button[data-del]').forEach(b => {
      b.addEventListener('click', async () => {
        await api.gapAlertDelete(b.dataset.del);
        await loadAlerts();
      });
    });
    window.refreshIcons?.();
  };

  const renderEvents = () => {
    const slot = main.querySelector('#al-events');
    if (!events.length) { slot.innerHTML = `<div class="muted" style="font-size:12.5px">No events yet.</div>`; return; }
    slot.innerHTML = events.map(e => `
      <div style="padding:7px 11px;border-left:3px solid var(--accent,#5B8DB8);background:var(--surface);border-radius:0 8px 8px 0;margin-bottom:6px">
        <div style="font-size:12.5px"><b>${esc(e.kind)}</b> — ${esc(e.detail)}</div>
        <div class="muted" style="font-size:11px">${esc((e.created_at || '').slice(0, 16).replace('T', ' '))}</div>
      </div>`).join('');
  };

  const loadAlerts = async () => {
    try { alerts = (await api.gapAlertsList(topic))?.rows || []; } catch { alerts = []; }
    renderList();
  };
  const loadEvents = async () => {
    try { events = (await api.gapAlertEvents(topic))?.rows || []; } catch { events = []; }
    renderEvents();
  };

  main.querySelector('#al-create')?.addEventListener('click', async () => {
    const type = main.querySelector('#al-type').value;
    const thrRaw = main.querySelector('#al-threshold').value;
    const threshold = thrRaw === '' ? null : Number(thrRaw);
    try {
      const r = await api.gapAlertCreate(topic, type, { threshold });
      statusEl.textContent = r?.ok ? 'Alert added.' : `Failed: ${r?.error || 'unknown'}`;
      await loadAlerts();
    } catch (e) { statusEl.textContent = `Failed: ${e?.message || e}`; }
  });

  main.querySelector('#al-check')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2"></i> checking…'; window.refreshIcons?.();
    try {
      const r = await api.gapAlertsCheck(topic);
      statusEl.textContent = r?.ok ? `Checked ${r.checked} — ${r.fired} fired.` : 'Check failed.';
      await loadAlerts(); await loadEvents();
    } catch (err) { statusEl.textContent = `Check failed: ${err?.message || err}`; }
    finally { btn.disabled = false; btn.innerHTML = orig; window.refreshIcons?.(); }
  });

  await loadAlerts();
  await loadEvents();
}
