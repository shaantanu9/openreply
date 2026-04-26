// Papers tab — every academic-source paper tagged to a topic, with
// one-click bibliography export (BibTeX / RIS / APA / Markdown) and
// Unpaywall lookup for finding free PDFs of paywalled DOIs.
//
// Works for any audience: students citing evidence for an essay,
// UX researchers building a research doc, solopreneurs backing a
// landing-page claim. Same feature set — different framing.
import { api } from '../api.js';
import { readScreenCache, writeScreenCache } from '../lib/screenCache.js';

const $ = (sel, root = document) => root.querySelector(sel);

const SOURCE_LABELS = {
  arxiv: 'arXiv', pubmed: 'PubMed', openalex: 'OpenAlex',
  semantic_scholar: 'Sem.Scholar', crossref: 'Crossref', scholar: 'Scholar',
};

const SOURCE_COLOURS = {
  arxiv: '#B084CC', pubmed: '#C87070', openalex: '#5B8DB8',
  semantic_scholar: '#FF8C42', crossref: '#7BA88C', scholar: '#D4A574',
};

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function fmtYear(tsSec) {
  if (!tsSec) return '—';
  try { return String(new Date(Number(tsSec) * 1000).getUTCFullYear()); }
  catch { return '—'; }
}

function extractDoi(url) {
  const u = url || '';
  if (u.includes('doi.org/')) return u.split('doi.org/')[1].replace(/\/$/, '');
  if (u.startsWith('10.')) return u;
  return '';
}

function renderEmpty(topic) {
  return `
    <div class="empty-state">
      <h3>No papers yet for <b>${escape(topic)}</b></h3>
      <p>Papers arrive when the Solutions Agent fetches evidence for painpoints,
      or when you run <code>reddit_research_papers</code> via MCP. Start by
      running the Solutions pipeline or use the MCP tools directly:</p>
      <ul style="text-align:left;max-width:500px;margin:12px auto">
        <li><code>mcp__reddit-myind__reddit_research_papers(query, topic)</code></li>
        <li><code>mcp__reddit-myind__reddit_paper_citations(paper_id)</code></li>
      </ul>
    </div>
  `;
}

function renderRow(p) {
  const src = p.source_type || '';
  const label = SOURCE_LABELS[src] || src;
  const colour = SOURCE_COLOURS[src] || '#999';
  const doi = extractDoi(p.url);
  const year = fmtYear(p.created_utc);
  const cites = Number(p.score || 0).toLocaleString();
  const title = escape(p.title || '[untitled]');
  const authors = escape(p.author || '');
  return `
    <tr data-post-id="${escape(p.id)}">
      <td><span class="src-badge" style="background:${colour}">${escape(label)}</span></td>
      <td class="paper-title"><a href="${escape(p.url || '#')}" target="_blank" rel="noopener">${title}</a>
          <div class="paper-authors">${authors}</div></td>
      <td class="num">${escape(year)}</td>
      <td class="num">${cites}</td>
      <td>
        ${doi ? `<button class="btn btn-sm btn-ghost btn-oa" data-doi="${escape(doi)}" title="Find free PDF (Unpaywall)"><i data-lucide="download"></i> OA</button>` : ''}
      </td>
    </tr>
  `;
}

function renderList(topic, posts) {
  const byCites = [...posts].sort((a, b) => (b.score || 0) - (a.score || 0));
  return `
    <div class="papers-tab">
      <div class="papers-toolbar">
        <div class="muted">${posts.length} papers for <b>${escape(topic)}</b></div>
        <div class="papers-actions">
          <button class="btn btn-sm btn-bordered" id="btn-export-bibtex"><i data-lucide="file-text"></i> BibTeX</button>
          <button class="btn btn-sm btn-bordered" id="btn-export-ris"><i data-lucide="file-down"></i> RIS (Zotero)</button>
          <button class="btn btn-sm btn-bordered" id="btn-export-apa"><i data-lucide="quote"></i> APA</button>
          <button class="btn btn-sm btn-bordered" id="btn-export-md"><i data-lucide="list"></i> Markdown</button>
        </div>
      </div>
      <table class="papers-table">
        <thead>
          <tr><th>Src</th><th>Title</th><th>Year</th><th>Cites</th><th>PDF</th></tr>
        </thead>
        <tbody>${byCites.map(renderRow).join('')}</tbody>
      </table>
    </div>
  `;
}

function showExportModal(topic, fmt, text, count) {
  const fmtLabels = { bibtex: 'BibTeX', ris: 'RIS (Zotero/Mendeley)', apa: 'APA', md: 'Markdown' };
  const wrap = document.createElement('div');
  wrap.className = 'papers-modal-backdrop';
  wrap.innerHTML = `
    <div class="papers-modal">
      <div class="papers-modal-head">
        <h3>${escape(fmtLabels[fmt] || fmt)} · ${count} papers · ${escape(topic)}</h3>
        <button class="btn btn-ghost btn-sm" id="papers-modal-close" aria-label="Close"><i data-lucide="x"></i></button>
      </div>
      <textarea class="papers-modal-text" readonly>${escape(text || '')}</textarea>
      <div class="papers-modal-actions">
        <button class="btn primary btn-sm" id="papers-modal-copy"><i data-lucide="clipboard"></i> Copy to clipboard</button>
        <button class="btn btn-sm btn-bordered" id="papers-modal-close-2">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  window.refreshIcons?.();
  const close = () => wrap.remove();
  $('#papers-modal-close', wrap)?.addEventListener('click', close);
  $('#papers-modal-close-2', wrap)?.addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  $('#papers-modal-copy', wrap)?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text || '');
      const btn = $('#papers-modal-copy', wrap);
      if (btn) { btn.innerHTML = '<i data-lucide="check"></i> Copied'; window.refreshIcons?.(); }
    } catch {
      // Fallback: select the textarea so user can Cmd-C manually.
      const ta = $('.papers-modal-text', wrap);
      ta?.select();
    }
  });
}

export async function loadPapers(contentEl, topic) {
  const set = (html) => { if (contentEl.dataset.tab === 'papers') contentEl.innerHTML = html; };

  // SWR: paint cached papers list immediately, refresh in background.
  // Cache survives app restart — see docs/perf-audit.md.
  const CACHE_KEY = `papers.${topic}`;
  const cachedPosts = readScreenCache(CACHE_KEY);
  let paintedFromCache = false;
  if (Array.isArray(cachedPosts) && cachedPosts.length > 0) {
    set(renderList(topic, cachedPosts));
    if (contentEl.dataset.tab === 'papers') {
      contentEl.dataset.cached = '1';
      window.refreshIcons?.();
    }
    paintedFromCache = true;
  } else {
    set('<div class="empty-state">loading papers…</div>');
  }

  let posts = [];
  try {
    posts = await api.papersList(topic, 500);
  } catch (e) {
    if (paintedFromCache) return;   // keep stale-but-valid render
    set(`<div class="empty-big"><h3>Couldn't load papers</h3><p>${escape(e?.message || e)}</p></div>`);
    return;
  }
  if (contentEl.dataset.tab !== 'papers') return;

  if (!posts || posts.length === 0) {
    if (paintedFromCache) return;
    set(renderEmpty(topic));
    window.refreshIcons?.();
    return;
  }

  writeScreenCache(CACHE_KEY, posts);
  set(renderList(topic, posts));
  if (contentEl.dataset.tab !== 'papers') return;
  contentEl.dataset.cached = '';
  window.refreshIcons?.();

  const doExport = async (fmt) => {
    const btn = $(`#btn-export-${fmt}`, contentEl);
    const orig = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.textContent = 'exporting…'; }
    try {
      const r = await api.papersExport(topic, fmt, null);
      if (!r?.ok) throw new Error(r?.reason || 'export failed');
      showExportModal(topic, fmt, r.text, r.count);
    } catch (e) {
      alert(`Export failed: ${e?.message || e}`);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = orig; window.refreshIcons?.(); }
    }
  };

  $('#btn-export-bibtex', contentEl)?.addEventListener('click', () => doExport('bibtex'));
  $('#btn-export-ris',    contentEl)?.addEventListener('click', () => doExport('ris'));
  $('#btn-export-apa',    contentEl)?.addEventListener('click', () => doExport('apa'));
  $('#btn-export-md',     contentEl)?.addEventListener('click', () => doExport('md'));

  // Unpaywall — fetch a legal free PDF URL for one DOI
  contentEl.querySelectorAll('.btn-oa').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const doi = btn.dataset.doi;
      if (!doi) return;
      const orig = btn.innerHTML;
      btn.disabled = true; btn.textContent = '…';
      try {
        const r = await api.oaLookup(doi);
        if (r?.best_oa_url) {
          window.open(r.best_oa_url, '_blank', 'noopener');
          btn.innerHTML = '<i data-lucide="check"></i> OA';
        } else {
          btn.innerHTML = '<i data-lucide="lock"></i> —';
          btn.title = 'No free PDF found via Unpaywall';
        }
      } catch {
        btn.innerHTML = orig;
      } finally {
        btn.disabled = false;
        window.refreshIcons?.();
      }
    });
  });
}
