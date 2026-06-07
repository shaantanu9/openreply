// Write — the paper-writing surface: outline → draft → citations/export.
//
// Ties together the existing generation backend (paperOutlineGenerate,
// paperDraftGenerate, experimentPlanGenerate) and the 4-format citation export
// (papersExport: BibTeX/RIS/APA/Markdown). Reached via #/write/<topic>.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Render an outline value that may be a markdown string, a list, or a nested
// object — defensively, without assuming the backend's exact shape.
function renderOutlineValue(outline) {
  if (outline == null) return '<span class="muted">No outline.</span>';
  if (typeof outline === 'string') return `<div style="white-space:pre-wrap;font-size:13px;line-height:1.6">${esc(outline)}</div>`;
  const walk = (node, depth = 0) => {
    if (node == null) return '';
    if (typeof node === 'string') return `<li style="font-size:13px">${esc(node)}</li>`;
    if (Array.isArray(node)) return `<ul style="margin:2px 0 2px ${depth ? 14 : 0}px">${node.map(n => walk(n, depth + 1)).join('')}</ul>`;
    if (typeof node === 'object') {
      return Object.entries(node).map(([k, v]) => {
        const title = `<div style="font-weight:600;font-size:13px;margin-top:6px">${esc(k)}</div>`;
        return title + (typeof v === 'object' ? walk(v, depth + 1) : `<div style="font-size:13px;margin-left:12px">${esc(String(v))}</div>`);
      }).join('');
    }
    return esc(String(node));
  };
  return walk(outline);
}

const COPY = (id) => `<button class="btn btn-sm btn-bordered" data-copy="${id}" type="button"><i data-lucide="clipboard"></i> Copy</button>`;

export async function renderWrite(main, topicRaw) {
  const topic = decodeURIComponent(topicRaw || '');
  main.innerHTML = `
    <div class="screen" style="max-width:920px;margin:0 auto;padding:16px 20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <button id="wr-back" class="btn btn-ghost btn-sm" type="button"><i data-lucide="arrow-left"></i></button>
        <i data-lucide="pen-line" style="color:var(--accent,#5B8DB8)"></i>
        <h2 style="margin:0;font-size:18px">Write</h2>
        <span class="muted" style="font-size:12.5px">${esc(topic)}</span>
      </div>
      <p class="muted" style="font-size:12.5px;margin:4px 0 16px">Generate a grounded outline and draft from your corpus, then export the bibliography. Requires built paper knowledge (gaps + insights).</p>

      <section style="border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:8px"><div style="font-weight:650;font-size:14px;flex:1"><i data-lucide="list-tree"></i> Outline</div>
          <button class="btn btn-primary btn-sm" id="wr-outline-go" type="button"><i data-lucide="sparkles"></i> Generate outline</button></div>
        <div id="wr-outline" style="margin-top:10px"></div>
      </section>

      <section style="border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><div style="font-weight:650;font-size:14px;flex:1 1 160px"><i data-lucide="file-text"></i> Draft</div>
          <select id="wr-style" style="padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:inherit;font-size:12.5px">
            <option value="IMRaD">IMRaD</option><option value="review">Literature review</option><option value="thesis">Thesis chapter</option>
          </select>
          <button class="btn btn-primary btn-sm" id="wr-draft-go" type="button"><i data-lucide="sparkles"></i> Generate draft</button>
          ${COPY('wr-draft-raw')}</div>
        <div id="wr-draft" style="margin-top:10px"></div>
        <textarea id="wr-draft-raw" style="display:none"></textarea>
      </section>

      <section style="border:1px solid var(--line);border-radius:12px;padding:14px 16px">
        <div style="font-weight:650;font-size:14px;margin-bottom:8px"><i data-lucide="quote"></i> Citations &amp; bibliography</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-bordered wr-cite" data-fmt="bibtex" type="button">BibTeX</button>
          <button class="btn btn-sm btn-bordered wr-cite" data-fmt="ris" type="button">RIS (Zotero)</button>
          <button class="btn btn-sm btn-bordered wr-cite" data-fmt="apa" type="button">APA</button>
          <button class="btn btn-sm btn-bordered wr-cite" data-fmt="md" type="button">Markdown</button>
        </div>
        <div id="wr-cite-out" style="margin-top:10px"></div>
      </section>
    </div>`;
  window.refreshIcons?.();
  main.querySelector('#wr-back')?.addEventListener('click', () => history.back());

  const busy = (btn, label, fn) => async () => {
    const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<i data-lucide="loader-2"></i> ${label}`; window.refreshIcons?.();
    try { await fn(); } finally { btn.disabled = false; btn.innerHTML = orig; window.refreshIcons?.(); }
  };
  const fail = (host, e) => { host.innerHTML = `<div class="muted" style="font-size:12.5px;color:#B84747">${esc(e?.message || e)}</div>`; };

  // Outline
  const outlineBtn = main.querySelector('#wr-outline-go');
  const outlineHost = main.querySelector('#wr-outline');
  outlineBtn.addEventListener('click', busy(outlineBtn, 'thinking…', async () => {
    outlineHost.innerHTML = '<div class="muted" style="font-size:12.5px">Generating outline from your corpus…</div>';
    try {
      const r = await api.paperOutlineGenerate(topic);
      if (!r?.ok) return fail(outlineHost, r?.error || 'outline failed (build paper knowledge first)');
      outlineHost.innerHTML = renderOutlineValue(r.outline);
    } catch (e) { fail(outlineHost, e); }
  }));

  // Draft
  const draftBtn = main.querySelector('#wr-draft-go');
  const draftHost = main.querySelector('#wr-draft');
  const draftRaw = main.querySelector('#wr-draft-raw');
  draftBtn.addEventListener('click', busy(draftBtn, 'writing…', async () => {
    draftHost.innerHTML = '<div class="muted" style="font-size:12.5px">Writing a grounded draft… this can take a minute.</div>';
    try {
      const style = main.querySelector('#wr-style').value;
      const r = await api.paperDraftGenerate(topic, null, style);
      if (!r?.ok) return fail(draftHost, r?.error || 'draft failed (build paper knowledge first)');
      const md = r.markdown || r.content || r.text || '';
      draftRaw.value = md;
      draftHost.innerHTML = `<div style="white-space:pre-wrap;font-size:13px;line-height:1.6;max-height:520px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:12px;background:var(--surface)">${esc(md)}</div>`;
    } catch (e) { fail(draftHost, e); }
  }));

  // Citations export
  const citeOut = main.querySelector('#wr-cite-out');
  main.querySelectorAll('.wr-cite').forEach(btn => {
    btn.addEventListener('click', busy(btn, '…', async () => {
      try {
        const r = await api.papersExport(topic, btn.dataset.fmt, null);
        if (!r?.ok) return fail(citeOut, r?.reason || 'export failed');
        citeOut.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span class="muted" style="font-size:12px">${esc(btn.dataset.fmt.toUpperCase())} · ${r.count || 0} papers</span>${COPY('wr-cite-raw')}</div>
          <textarea id="wr-cite-raw" readonly style="width:100%;height:200px;border:1px solid var(--line);border-radius:8px;padding:10px;background:var(--surface);color:inherit;font-size:12px;font-family:monospace">${esc(r.text || '')}</textarea>`;
        window.refreshIcons?.();
        wireCopy();
      } catch (e) { fail(citeOut, e); }
    }));
  });

  // Copy buttons (delegate; textarea/raw fields hold the source).
  function wireCopy() {
    main.querySelectorAll('[data-copy]').forEach(b => {
      b.onclick = async () => {
        const el = main.querySelector('#' + b.dataset.copy);
        const text = el ? (el.value ?? el.textContent ?? '') : '';
        try { await navigator.clipboard?.writeText(text); b.innerHTML = '<i data-lucide="check"></i> Copied'; window.refreshIcons?.(); setTimeout(() => { b.innerHTML = '<i data-lucide="clipboard"></i> Copy'; window.refreshIcons?.(); }, 1500); } catch { /* ignore */ }
      };
    });
  }
  wireCopy();
}
