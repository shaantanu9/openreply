// Library — the cross-project paper universe. Browse every academic paper in
// the corpus regardless of topic, filter by collection / reading status / title,
// organise into named collections, and jump into the Reader.
//
// Reached via #/library. Backed by api.paperLibrary + api.paperCollections.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const STATUS_META = {
  to_read: ['To read', '#8A8178'], reading: ['Reading', '#1F5C99'], read: ['Read', '#1A7A4F'],
};

export async function renderLibrary(main) {
  let collections = [];
  let papers = [];
  let activeCollection = null;   // null = all
  let activeStatus = null;
  let query = '';

  main.innerHTML = `
    <div class="screen" style="max-width:1180px;margin:0 auto;padding:16px 20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <i data-lucide="library" style="color:var(--accent,#5B8DB8)"></i>
        <h2 style="margin:0;font-size:18px">Library</h2>
        <span class="muted" id="lib-count" style="font-size:12.5px;margin-left:auto"></span>
      </div>
      <div style="display:grid;grid-template-columns:230px minmax(0,1fr);gap:18px;align-items:start">
        <aside>
          <div style="font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#8A8178);margin-bottom:6px">Collections</div>
          <div id="lib-collections"></div>
          <div style="display:flex;gap:5px;margin-top:8px">
            <input id="lib-new-col" type="text" placeholder="New collection…" style="flex:1;min-width:0;padding:5px 8px;border:1px solid var(--line);border-radius:7px;background:var(--surface);color:inherit;font-size:12px" />
            <button class="btn btn-sm btn-bordered" id="lib-add-col" type="button"><i data-lucide="plus"></i></button>
          </div>
          <div style="font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#8A8178);margin:16px 0 6px">Reading status</div>
          <div id="lib-status-filters"></div>
        </aside>
        <div style="min-width:0">
          <input id="lib-search" type="search" placeholder="Search titles…" style="width:100%;padding:8px 11px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:inherit;font-size:13px;margin-bottom:10px" />
          <div id="lib-papers"><div class="muted" style="font-size:12.5px">Loading…</div></div>
        </div>
      </div>
    </div>`;
  window.refreshIcons?.();

  const colHost = main.querySelector('#lib-collections');
  const statusHost = main.querySelector('#lib-status-filters');
  const papersHost = main.querySelector('#lib-papers');
  const countEl = main.querySelector('#lib-count');

  const renderCollections = () => {
    const item = (id, label, count, active) => `
      <div class="lib-col" data-col="${id == null ? '' : esc(id)}" style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:7px;cursor:pointer;font-size:12.5px;background:${active ? 'var(--surface-2)' : 'transparent'}">
        <i data-lucide="${id == null ? 'layers' : 'folder'}" style="width:14px;height:14px"></i>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label)}</span>
        <span class="muted" style="font-size:11px">${count ?? ''}</span>
        ${id == null ? '' : `<button class="lib-col-del" data-id="${esc(id)}" title="Delete" style="border:0;background:none;cursor:pointer;color:var(--muted,#8A8178)"><i data-lucide="x" style="width:12px;height:12px"></i></button>`}
      </div>`;
    colHost.innerHTML = item(null, 'All papers', null, activeCollection == null)
      + collections.map(c => item(c.id, c.name, c.count, activeCollection === c.id)).join('');
    colHost.querySelectorAll('.lib-col').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.lib-col-del')) return;
        activeCollection = el.dataset.col || null;
        load();
      });
    });
    colHost.querySelectorAll('.lib-col-del').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { await api.paperCollections('delete', { collectionId: b.dataset.id }); } catch { /* ignore */ }
        if (activeCollection === b.dataset.id) activeCollection = null;
        await loadCollections(); load();
      });
    });
    window.refreshIcons?.();
  };

  const renderStatusFilters = () => {
    statusHost.innerHTML = ['to_read', 'reading', 'read'].map(s => {
      const [label, color] = STATUS_META[s];
      const active = activeStatus === s;
      return `<div class="lib-status" data-status="${s}" style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:7px;cursor:pointer;font-size:12.5px;background:${active ? 'var(--surface-2)' : 'transparent'}">
        <span style="width:9px;height:9px;border-radius:50%;background:${color}"></span>${label}</div>`;
    }).join('');
    statusHost.querySelectorAll('.lib-status').forEach(el => {
      el.addEventListener('click', () => { activeStatus = activeStatus === el.dataset.status ? null : el.dataset.status; renderStatusFilters(); load(); });
    });
  };

  const renderPapers = () => {
    if (!papers.length) {
      papersHost.innerHTML = '<div class="muted" style="font-size:12.5px;padding:16px">No papers match. Gather an academic project, or clear filters.</div>';
      return;
    }
    const colOptions = collections.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    papersHost.innerHTML = papers.map(p => {
      const [label, color] = STATUS_META[p.status] || STATUS_META.to_read;
      return `<div class="lib-paper" data-pid="${esc(p.post_id)}" style="border:1px solid var(--line);border-radius:9px;padding:9px 11px;margin-bottom:7px;display:flex;align-items:center;gap:10px">
        <span style="width:9px;height:9px;border-radius:50%;background:${color}" title="${label}"></span>
        <a href="#/reader/${encodeURIComponent(p.post_id)}" style="flex:1;min-width:0;text-decoration:none;color:inherit;font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.title || 'Untitled')}</a>
        <span class="muted" style="font-size:11px">${esc(p.source_type || '')}</span>
        ${colOptions ? `<select class="lib-addcol" title="Add to collection" style="font-size:11px;padding:3px 5px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:inherit"><option value="">+ collection</option>${colOptions}</select>` : ''}
      </div>`;
    }).join('');
    papersHost.querySelectorAll('.lib-addcol').forEach(sel => {
      sel.addEventListener('change', async () => {
        const pid = sel.closest('.lib-paper')?.dataset.pid;
        if (!sel.value || !pid) return;
        try { await api.paperCollections('add', { collectionId: sel.value, postId: pid }); } catch { /* ignore */ }
        sel.selectedIndex = 0;
        await loadCollections(); renderCollections();
      });
    });
    window.refreshIcons?.();
  };

  const loadCollections = async () => {
    try { collections = (await api.paperCollections('list'))?.collections || []; } catch { collections = []; }
  };

  const load = async () => {
    renderCollections();
    try {
      const r = await api.paperLibrary({ collection: activeCollection, status: activeStatus, q: query || null });
      papers = r?.papers || [];
      countEl.textContent = `${r?.count ?? 0} papers`;
    } catch (e) {
      papersHost.innerHTML = `<div class="muted" style="font-size:12.5px;color:#B84747">${esc(e?.message || e)}</div>`;
      return;
    }
    renderPapers();
  };

  main.querySelector('#lib-add-col')?.addEventListener('click', async () => {
    const input = main.querySelector('#lib-new-col');
    const name = (input.value || '').trim();
    if (!name) return;
    try { await api.paperCollections('create', { name }); } catch { /* ignore */ }
    input.value = '';
    await loadCollections(); renderCollections();
  });
  let searchTimer = null;
  main.querySelector('#lib-search')?.addEventListener('input', (e) => {
    query = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 250);
  });

  renderStatusFilters();
  await loadCollections();
  await load();
}
