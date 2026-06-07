// Paper Reader — read one paper's full text by section, highlight passages,
// take notes, set reading status, and ask the paper questions (cited).
//
// Reached via #/reader/<post_id>. Backed by api.paperRead (composite payload)
// + paperReadingStatus / paperHighlight / paperAsk. Highlights are anchored by
// quoted text (re-marked on render via string match) — robust to re-parsing
// and good enough for v1 without DOM-range bookkeeping.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const STATUS = [
  { id: 'to_read', label: 'To read', icon: 'circle' },
  { id: 'reading', label: 'Reading', icon: 'book-open' },
  { id: 'read',    label: 'Read',    icon: 'check-circle-2' },
];
const HL_COLORS = { yellow: '#FBE7A1', green: '#BBE7C6', blue: '#BFD9F2', pink: '#F4C2D7' };

// Wrap every occurrence of each highlight's quote in <mark> so saved highlights
// reappear on load. Escaped first, then marks injected on the escaped text.
function markHighlights(escapedText, highlights) {
  let html = escapedText;
  for (const h of highlights) {
    const q = esc((h.quote || '').trim());
    if (q.length < 4) continue;
    const color = HL_COLORS[h.color] || HL_COLORS.yellow;
    const title = h.note ? ` title="${esc(h.note)}"` : '';
    // Replace first occurrence only — avoids over-marking repeated short phrases.
    const idx = html.indexOf(q);
    if (idx >= 0) {
      html = html.slice(0, idx)
        + `<mark data-hl="${esc(h.id)}" style="background:${color};padding:0 1px;border-radius:2px"${title}>${q}</mark>`
        + html.slice(idx + q.length);
    }
  }
  return html;
}

function statusBar(current) {
  return STATUS.map(s => `
    <button type="button" class="reader-status-btn" data-status="${s.id}"
      style="display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border:1px solid var(--line);border-radius:999px;cursor:pointer;font-size:12px;background:${s.id === current ? 'var(--accent,#5B8DB8)' : 'var(--surface)'};color:${s.id === current ? '#fff' : 'inherit'}">
      <i data-lucide="${s.icon}"></i> ${s.label}
    </button>`).join(' ');
}

function highlightRow(h) {
  const color = HL_COLORS[h.color] || HL_COLORS.yellow;
  return `
    <div class="reader-hl" data-id="${esc(h.id)}" style="border:1px solid var(--line);border-left:3px solid ${color};border-radius:6px;padding:8px 10px;margin-bottom:8px">
      <div style="font-size:11px;color:var(--muted,#8A8178);display:flex;align-items:center;gap:6px">
        <span>§${esc(h.section || 'body')}</span>
        <button type="button" class="reader-hl-del" title="Delete" style="margin-left:auto;border:0;background:none;cursor:pointer;color:var(--muted,#8A8178)"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>
      </div>
      <div style="font-size:12.5px;margin:4px 0">${esc((h.quote || '').slice(0, 240))}</div>
      <input class="reader-hl-note" value="${esc(h.note || '')}" placeholder="add a note…"
        style="width:100%;border:0;border-top:1px solid var(--line);padding:5px 0 0;background:none;color:inherit;font-size:12px" />
    </div>`;
}

export async function renderReader(main, postId) {
  const pid = decodeURIComponent(postId || '');
  main.innerHTML = `<div class="screen" style="padding:20px"><div class="muted">Loading paper…</div></div>`;

  let data;
  try {
    data = await api.paperRead(pid);
  } catch (e) {
    main.innerHTML = `<div class="screen" style="padding:20px"><div class="muted" style="color:#B84747">Couldn't load paper: ${esc(e?.message || e)}</div></div>`;
    return;
  }
  if (!data || !data.ok) {
    main.innerHTML = `<div class="screen" style="padding:20px"><div class="muted">${esc(data?.error || 'Paper not found.')}</div></div>`;
    return;
  }

  const hls = data.highlights || [];
  const sectionNav = (data.sections || []).map((s, i) =>
    `<a href="#sec-${i}" class="reader-secnav" style="display:block;padding:3px 0;font-size:12px;text-decoration:none;color:var(--muted,#8A8178);text-transform:capitalize">${esc(s.name)}</a>`).join('');
  const sectionHtml = (data.sections || []).map((s, i) => `
    <section id="sec-${i}" data-section="${esc(s.name)}" style="margin-bottom:22px">
      <h3 style="font-size:14px;text-transform:capitalize;border-bottom:1px solid var(--line);padding-bottom:5px;margin:0 0 8px">${esc(s.name)}</h3>
      <div class="reader-section-text" style="font-size:13.5px;line-height:1.65;white-space:pre-wrap">${markHighlights(esc(s.text || ''), hls)}</div>
    </section>`).join('');

  main.innerHTML = `
    <div class="screen reader" style="max-width:1180px;margin:0 auto;padding:16px 20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <button id="reader-back" class="btn btn-ghost btn-sm" type="button"><i data-lucide="arrow-left"></i></button>
        <span class="muted" style="font-size:12px">${esc(data.source_type || 'paper')}${data.tier === 'abstract' ? ' · abstract only' : ' · full text'}</span>
        ${data.url ? `<a href="${esc(data.url)}" target="_blank" rel="noopener" class="muted" style="font-size:12px;margin-left:auto">Open source ↗</a>` : ''}
      </div>
      <h2 style="margin:0 0 4px;font-size:19px;line-height:1.3">${esc(data.title)}</h2>
      <div class="muted" style="font-size:12.5px">${esc(data.author || '')}</div>
      <div id="reader-status" style="display:flex;gap:6px;margin:12px 0 16px;flex-wrap:wrap">${statusBar(data.status)}</div>

      <div style="display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:20px;align-items:start">
        <div style="min-width:0">
          <div id="reader-selbar" style="position:sticky;top:0;z-index:5;display:none;gap:6px;padding:8px;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;margin-bottom:10px">
            <span class="muted" style="font-size:12px;align-self:center">Highlight selection:</span>
            ${Object.keys(HL_COLORS).map(c => `<button type="button" class="reader-hlcolor" data-color="${c}" title="${c}" style="width:20px;height:20px;border-radius:50%;border:1px solid var(--line);cursor:pointer;background:${HL_COLORS[c]}"></button>`).join('')}
          </div>
          ${sectionHtml}
        </div>
        <aside style="position:sticky;top:12px">
          <div style="font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#8A8178);margin-bottom:6px">Sections</div>
          <nav style="margin-bottom:16px">${sectionNav}</nav>

          <div style="font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#8A8178);margin-bottom:6px">Highlights &amp; notes</div>
          <div id="reader-highlights">${hls.length ? hls.map(highlightRow).join('') : '<div class="muted" style="font-size:12px">Select text in the paper to highlight it.</div>'}</div>

          <div style="margin-top:18px;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#8A8178);margin-bottom:6px">Ask this paper</div>
          <div style="display:flex;gap:6px">
            <input id="reader-ask" type="text" placeholder="e.g. what was the method?" style="flex:1;min-width:0;padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:inherit;font-size:12.5px" />
            <button id="reader-ask-go" class="btn btn-primary btn-sm" type="button"><i data-lucide="send"></i></button>
          </div>
          <div id="reader-ask-out" style="margin-top:8px"></div>
        </aside>
      </div>
    </div>`;
  window.refreshIcons?.();

  main.querySelector('#reader-back')?.addEventListener('click', () => history.back());

  // Reading status
  main.querySelectorAll('.reader-status-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const status = btn.dataset.status;
      try { await api.paperReadingStatus(pid, status); } catch { /* ignore */ }
      main.querySelector('#reader-status').innerHTML = statusBar(status);
      window.refreshIcons?.();
      rewireStatus();
    });
  });
  function rewireStatus() {
    main.querySelectorAll('.reader-status-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const status = btn.dataset.status;
        try { await api.paperReadingStatus(pid, status); } catch { /* ignore */ }
        main.querySelector('#reader-status').innerHTML = statusBar(status);
        window.refreshIcons?.(); rewireStatus();
      });
    });
  }

  // Selection → highlight. Show the colour bar when a non-trivial selection
  // lands inside a section; clicking a colour saves the highlight.
  const selbar = main.querySelector('#reader-selbar');
  let pendingSel = null;
  const onSelect = () => {
    const sel = window.getSelection();
    const text = (sel?.toString() || '').trim();
    if (!text || text.length < 4) { selbar.style.display = 'none'; pendingSel = null; return; }
    let node = sel.anchorNode;
    let sectionEl = null;
    while (node && node !== main) { if (node.dataset && node.dataset.section) { sectionEl = node; break; } node = node.parentNode; }
    if (!sectionEl) { selbar.style.display = 'none'; return; }
    const sectionName = sectionEl.dataset.section;
    const secText = (data.sections.find(s => s.name === sectionName)?.text) || '';
    const start = secText.indexOf(text);
    pendingSel = { sectionName, quote: text, start: start >= 0 ? start : 0, end: (start >= 0 ? start : 0) + text.length };
    selbar.style.display = 'flex';
  };
  main.addEventListener('mouseup', () => setTimeout(onSelect, 0));

  selbar.querySelectorAll('.reader-hlcolor').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!pendingSel) return;
      try {
        const r = await api.paperHighlight('add', {
          postId: pid, section: pendingSel.sectionName,
          charStart: pendingSel.start, charEnd: pendingSel.end,
          quote: pendingSel.quote, color: btn.dataset.color,
        });
        if (r?.ok) { data.highlights.push(r.highlight); rerenderHighlights(); }
      } catch { /* ignore */ }
      selbar.style.display = 'none';
      window.getSelection()?.removeAllRanges();
      pendingSel = null;
    });
  });

  function rerenderHighlights() {
    const host = main.querySelector('#reader-highlights');
    host.innerHTML = data.highlights.length
      ? data.highlights.map(highlightRow).join('')
      : '<div class="muted" style="font-size:12px">Select text in the paper to highlight it.</div>';
    wireHighlightRows();
    window.refreshIcons?.();
  }
  function wireHighlightRows() {
    main.querySelectorAll('.reader-hl').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('.reader-hl-del')?.addEventListener('click', async () => {
        try { await api.paperHighlight('delete', { highlightId: id }); } catch { /* ignore */ }
        data.highlights = data.highlights.filter(h => h.id !== id);
        rerenderHighlights();
      });
      const noteInput = row.querySelector('.reader-hl-note');
      noteInput?.addEventListener('change', async () => {
        try { await api.paperHighlight('update', { highlightId: id, note: noteInput.value }); } catch { /* ignore */ }
        const h = data.highlights.find(x => x.id === id); if (h) h.note = noteInput.value;
      });
    });
  }
  wireHighlightRows();

  // Ask this paper (cited, scoped to post_id)
  const askIn = main.querySelector('#reader-ask');
  const askOut = main.querySelector('#reader-ask-out');
  const askGo = async () => {
    const q = (askIn.value || '').trim();
    if (!q) return;
    askOut.innerHTML = '<div class="muted" style="font-size:12px">Reading the paper…</div>';
    try {
      const r = await api.paperAsk(q, { postId: pid });
      const body = esc(r?.answer || '').replace(/\n/g, '<br>');
      askOut.innerHTML = `<div style="border:1px solid var(--line);border-radius:8px;padding:9px 11px;font-size:12.5px;line-height:1.5">${body}</div>`;
    } catch (e) {
      askOut.innerHTML = `<div class="muted" style="font-size:12px;color:#B84747">${esc(e?.message || e)}</div>`;
    }
  };
  main.querySelector('#reader-ask-go')?.addEventListener('click', askGo);
  askIn?.addEventListener('keydown', (e) => { if (e.key === 'Enter') askGo(); });
}
