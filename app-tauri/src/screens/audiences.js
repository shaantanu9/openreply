// Audiences — import from GummySearch + curated discovery presets.
//
// The migration wedge: GummySearch shuts down Nov 2026, so let refugees bring
// their saved subreddit audiences in, and seed new users with preset bundles.
// Reached via #/audiences.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export async function renderAudiences(main) {
  let audiences = [];
  let presets = [];

  main.innerHTML = `
    <div class="screen" style="max-width:900px;margin:0 auto;padding:16px 20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <button id="au-back" class="btn btn-ghost btn-sm" type="button"><i data-lucide="arrow-left"></i></button>
        <i data-lucide="users-round" style="color:var(--accent,#5B8DB8)"></i>
        <h2 style="margin:0;font-size:18px">Audiences</h2>
      </div>
      <p class="muted" style="font-size:12.5px;margin:4px 0 14px">
        Coming from GummySearch? Import your saved audiences before it shuts down (Nov 2026). Or start instantly from a curated preset.
      </p>

      <div style="border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:16px">
        <h3 style="font-size:13.5px;margin:0 0 8px"><i data-lucide="download" style="width:14px;height:14px;vertical-align:-2px"></i> Switch from GummySearch</h3>
        <p class="muted" style="font-size:12px;margin:0 0 8px">Export your audiences from GummySearch (JSON or CSV), then paste the file path below.</p>
        <div style="display:flex;gap:8px">
          <input id="au-path" type="text" placeholder="/path/to/gummysearch-export.json" style="flex:1;padding:8px 11px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:inherit;font-size:13px" />
          <button class="btn btn-primary btn-sm" id="au-import" type="button"><i data-lucide="upload"></i> Import</button>
        </div>
        <div id="au-import-status" class="muted" style="font-size:12px;margin-top:8px"></div>
      </div>

      <h3 style="font-size:13.5px;margin:0 0 8px">Start from a preset</h3>
      <div id="au-presets" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px"><span class="muted" style="font-size:12.5px">Loading…</span></div>

      <h3 style="font-size:13.5px;margin:0 0 8px">Your audiences</h3>
      <div id="au-list"><div class="muted" style="font-size:12.5px">Loading…</div></div>
    </div>`;
  window.refreshIcons?.();

  main.querySelector('#au-back')?.addEventListener('click', () => history.back());

  const renderPresets = () => {
    const slot = main.querySelector('#au-presets');
    if (!presets.length) { slot.innerHTML = '<span class="muted" style="font-size:12.5px">No presets.</span>'; return; }
    slot.innerHTML = presets.map(p => `
      <button class="btn btn-sm btn-bordered" data-preset="${esc(p.key)}" type="button" style="text-transform:capitalize">
        ${esc(p.key.replace(/_/g, ' '))} <span class="muted" style="font-size:11px">(${p.count})</span>
      </button>`).join('');
    slot.querySelectorAll('button[data-preset]').forEach(b => {
      b.addEventListener('click', async () => {
        await api.audienceAddPreset(b.dataset.preset);
        await loadAudiences();
      });
    });
  };

  const renderList = () => {
    const slot = main.querySelector('#au-list');
    if (!audiences.length) {
      slot.innerHTML = '<div class="muted" style="font-size:12.5px">No audiences yet — import from GummySearch or add a preset.</div>';
      return;
    }
    slot.innerHTML = audiences.map(a => `
      <div style="border:1px solid var(--line);border-radius:9px;padding:10px 12px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <b style="font-size:13px">${esc(a.name)}</b>
          <span class="muted" style="font-size:11px">${a.count} subs · ${esc(a.source)}</span>
        </div>
        <div style="font-size:12px;margin-top:5px;color:var(--muted)">${(a.subreddits || []).slice(0, 12).map(s => `r/${esc(s)}`).join(', ')}${(a.subreddits || []).length > 12 ? '…' : ''}</div>
      </div>`).join('');
  };

  async function loadAudiences() {
    try { audiences = (await api.audiencesList())?.rows || []; } catch { audiences = []; }
    renderList();
  }
  async function loadPresets() {
    try { presets = (await api.audiencePresets())?.presets || []; } catch { presets = []; }
    renderPresets();
  }

  main.querySelector('#au-import')?.addEventListener('click', async (e) => {
    const path = main.querySelector('#au-path').value.trim();
    const statusEl = main.querySelector('#au-import-status');
    if (!path) { statusEl.textContent = 'Paste the export file path first.'; return; }
    const btn = e.currentTarget; const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2"></i> importing…'; window.refreshIcons?.();
    try {
      const r = await api.importGummysearch(path);
      statusEl.textContent = r?.ok
        ? `Imported ${r.imported} audience(s).`
        : `Import failed: ${r?.error || 'unknown'}`;
      await loadAudiences();
    } catch (err) { statusEl.textContent = `Import failed: ${err?.message || err}`; }
    finally { btn.disabled = false; btn.innerHTML = orig; window.refreshIcons?.(); }
  });

  await loadPresets();
  await loadAudiences();
}
