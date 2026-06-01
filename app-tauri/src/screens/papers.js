// Papers tab — every academic-source paper tagged to a topic, with
// one-click bibliography export (BibTeX / RIS / APA / Markdown) and
// Unpaywall lookup for finding free PDFs of paywalled DOIs.
//
// Works for any audience: students citing evidence for an essay,
// UX researchers building a research doc, solopreneurs backing a
// landing-page claim. Same feature set — different framing.
import { api } from '../api.js';
import { readScreenCache, writeScreenCache } from '../lib/screenCache.js';
import { convertFileSrc } from '@tauri-apps/api/core';
import { skelRows } from '../lib/skeleton.js';
import { withButtonBusy } from '../lib/busyButton.js';

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

// Search header — rendered at the top of both the list view AND the
// empty state so users can always trigger a fresh research run from
// the Papers tab. Wires up to `paperResearchPipeline` via the JS
// wrapper in api.js, which dispatches to the Python sidecar's
// `research papers` command — same pipeline the MCP tool uses.
function renderSearchHeader(topic) {
  return `
    <div class="papers-search-bar" style="display:flex;gap:8px;margin-bottom:14px;padding:10px 12px;background:var(--surface-2);border:1px solid var(--line);border-radius:10px;align-items:center;flex-wrap:wrap">
      <input type="search" id="papers-search-q"
             placeholder="Search query (defaults to topic)"
             value="${escape(topic)}"
             style="flex:1 1 240px;min-width:0;padding:7px 10px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink);font-size:13px">
      <button class="btn btn-primary btn-sm" id="papers-search-btn" type="button">
        <i data-lucide="search"></i> Find papers
      </button>
      <span id="papers-search-status" class="muted" style="font-size:11px;flex:1 1 220px;min-width:0"></span>
    </div>
  `;
}

function renderEmpty(topic) {
  return `
    ${renderSearchHeader(topic)}
    <div class="empty-state">
      <h3>No papers yet for <b>${escape(topic)}</b></h3>
      <p>Type a search above and click <b>Find papers</b> — Gap Map will
      query 6 academic sources in parallel (arXiv, OpenAlex, Semantic
      Scholar, Crossref, PubMed, Google Scholar), dedupe, and rank by
      citation count. Or trigger it from Claude / Cursor via MCP:</p>
      <ul style="text-align:left;max-width:560px;margin:12px auto">
        <li><code>mcp__gapmap__gapmap_paper_research_pipeline(topic, query)</code></li>
        <li><code>mcp__gapmap__gapmap_papers_for_topic(topic)</code> &nbsp;<span class="muted">cached read-back</span></li>
        <li><code>mcp__gapmap__gapmap_paper_citations(paper_id)</code></li>
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
  const landingUrl = p.url || '';
  const pdfUrl = p.pdf_url || '';
  const hasFulltext = !!p.has_fulltext;

  // Data column: green check when we already have cached parsed text;
  // dash when the paper exists in the index but no body has been fetched.
  const dataCell = hasFulltext
    ? `<span class="src-badge" style="background:#3D8B5E" title="Full text cached locally — analyses can quote it">data</span>`
    : `<span class="muted" title="No body cached yet — run paper-fulltext to download">—</span>`;

  // PDF column priority:
  //   1. Direct PDF URL (deterministic for arXiv) → "View PDF" button.
  //   2. DOI present → Unpaywall lookup ("OA").
  //   3. Nothing usable → dash.
  let pdfCell = '<span class="muted">—</span>';
  if (pdfUrl) {
    pdfCell = `<button class="btn btn-sm btn-ghost btn-pdf"
                       data-pdf="${escape(pdfUrl)}"
                       data-title="${title}"
                       title="Open PDF">
                 <i data-lucide="file-text"></i> View PDF
               </button>`;
  } else if (doi) {
    pdfCell = `<button class="btn btn-sm btn-ghost btn-oa"
                       data-doi="${escape(doi)}"
                       title="Find free PDF (Unpaywall)">
                 <i data-lucide="download"></i> OA
               </button>`;
  }

  return `
    <tr data-post-id="${escape(p.id)}">
      <td><span class="src-badge" style="background:${colour}">${escape(label)}</span></td>
      <td class="paper-title">
        <a href="${escape(landingUrl || '#')}" target="_blank" rel="noopener">${title}</a>
        <div class="paper-authors">${authors}</div>
      </td>
      <td class="num">${escape(year)}</td>
      <td class="num">${cites}</td>
      <td>${dataCell}</td>
      <td>${pdfCell}</td>
    </tr>
  `;
}

function renderList(topic, posts) {
  const byCites = [...posts].sort((a, b) => (b.score || 0) - (a.score || 0));
  return `
    <div class="papers-tab">
      ${renderSearchHeader(topic)}
      <div class="papers-toolbar">
        <div class="muted">${posts.length} papers for <b>${escape(topic)}</b></div>
        <div class="papers-actions">
          <button class="btn btn-sm btn-bordered" id="btn-paper-map" title="Relationship map of these papers"><i data-lucide="git-fork"></i> View map</button>
          <button class="btn btn-sm btn-bordered" id="btn-export-bibtex"><i data-lucide="file-text"></i> BibTeX</button>
          <button class="btn btn-sm btn-bordered" id="btn-export-ris"><i data-lucide="file-down"></i> RIS (Zotero)</button>
          <button class="btn btn-sm btn-bordered" id="btn-export-apa"><i data-lucide="quote"></i> APA</button>
          <button class="btn btn-sm btn-bordered" id="btn-export-md"><i data-lucide="list"></i> Markdown</button>
        </div>
      </div>
      <table class="papers-table">
        <thead>
          <tr><th>Src</th><th>Title</th><th>Year</th><th>Cites</th><th>Data</th><th>PDF</th></tr>
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

// Wires the #papers-search-btn (rendered by renderSearchHeader) to fire
// the full paper research pipeline and refresh the list. Re-binds the
// onclick on every render — there's only ever one button in the DOM
// (renderSearchHeader is the only place that creates it), and we
// always look it up fresh inside contentEl, so stale handlers from a
// previous render don't accumulate.
function wireSearchButton(contentEl, topic) {
  const btn    = $('#papers-search-btn', contentEl);
  const input  = $('#papers-search-q', contentEl);
  const status = $('#papers-search-status', contentEl);
  if (!btn || !input) return;
  btn.onclick = async () => {
    const q = (input.value || '').trim() || topic;
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2"></i> searching…';
    window.refreshIcons?.();
    if (status) status.textContent = 'Querying 6 academic sources in parallel…';
    try {
      const r = await api.paperResearchPipeline(topic, q, {
        limitPerSource: 5,
        maxFulltext:    3,
      });
      if (status) {
        if (r?.ok) {
          const total     = r.search_total    ?? 0;
          const fulltextN = r.fulltext_ok     ?? 0;
          const analyzed  = r.analyzed        ?? 0;
          status.textContent =
            `✓ ${total} found · ${fulltextN} fulltext · ${analyzed} analyzed`;
        } else {
          status.textContent = `✗ ${r?.reason || 'pipeline failed'}`;
        }
      }
      // Re-render the list with the freshly-discovered papers. The
      // cached `papersList` call inside loadPapers gets its 30s cache
      // bypassed because we just wrote new rows server-side; the
      // cachedInvoke layer will refetch on miss-or-stale anyway, but
      // we re-run loadPapers explicitly to be sure the user sees the
      // new data without having to switch tabs and come back.
      await loadPapers(contentEl, topic);
    } catch (e) {
      if (status) status.textContent = `✗ ${e?.message || e}`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
      window.refreshIcons?.();
    }
  };
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
    wireSearchButton(contentEl, topic);
    paintedFromCache = true;
  } else {
    set(skelRows(8));
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
    wireSearchButton(contentEl, topic);
    return;
  }

  writeScreenCache(CACHE_KEY, posts);
  set(renderList(topic, posts));
  if (contentEl.dataset.tab !== 'papers') return;
  contentEl.dataset.cached = '';
  window.refreshIcons?.();

  // Wire the "Find papers" search button — visible in both list-view
  // and empty-state renders. On click: pipe topic + user query to the
  // backend pipeline, surface progress text, then re-fetch the cached
  // list. Re-bind every render path so a previously-clicked button
  // doesn't end up with a stale handler after an SWR refresh.
  wireSearchButton(contentEl, topic);

  const doExport = async (fmt) => {
    try {
      const r = await api.papersExport(topic, fmt, null);
      if (!r?.ok) throw new Error(r?.reason || 'export failed');
      showExportModal(topic, fmt, r.text, r.count);
    } catch (e) {
      alert(`Export failed: ${e?.message || e}`);
    } finally {
      window.refreshIcons?.();
    }
  };

  $('#btn-paper-map', contentEl)?.addEventListener('click', () => {
    location.hash = `#/paper-map/${encodeURIComponent(topic)}`;
  });

  $('#btn-export-bibtex', contentEl)?.addEventListener('click', (e) => withButtonBusy(e.currentTarget, () => doExport('bibtex'), { busyLabel: 'Exporting…' }));
  $('#btn-export-ris',    contentEl)?.addEventListener('click', (e) => withButtonBusy(e.currentTarget, () => doExport('ris'),    { busyLabel: 'Exporting…' }));
  $('#btn-export-apa',    contentEl)?.addEventListener('click', (e) => withButtonBusy(e.currentTarget, () => doExport('apa'),    { busyLabel: 'Exporting…' }));
  $('#btn-export-md',     contentEl)?.addEventListener('click', (e) => withButtonBusy(e.currentTarget, () => doExport('md'),     { busyLabel: 'Exporting…' }));

  // Unpaywall — resolve a free-PDF URL for one DOI, then open inline.
  contentEl.querySelectorAll('.btn-oa').forEach(btn => {
    btn.addEventListener('click', async () => {
      const doi = btn.dataset.doi;
      if (!doi) return;
      const orig = btn.innerHTML;
      btn.disabled = true; btn.textContent = '…';
      try {
        const r = await api.oaLookup(doi);
        if (r?.best_oa_url) {
          // Pull the real paper title from the row we live inside, falling
          // back to the DOI string only if there's no title cell to read.
          // The previous code passed `doi` as `title`, so the PDF modal
          // header read "10.1234/..." instead of the paper name.
          const row = btn.closest('tr');
          const titleEl = row?.querySelector('.paper-title a');
          const realTitle = (titleEl?.textContent || '').trim() || doi;
          const postId = row?.dataset.postId || null;
          await openPdfViewer(r.best_oa_url, realTitle, postId);
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

  // Direct PDF — deterministic per source (arXiv etc).
  contentEl.querySelectorAll('.btn-pdf').forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.pdf;
      if (!url) return;
      const postId = btn.closest('tr')?.dataset.postId || null;
      await openPdfViewer(url, btn.dataset.title || 'PDF', postId);
    });
  });
}

// In-app PDF viewer.
//
// Strategy: ask Rust to mirror the URL into the app's local data dir, then
// load the local file via `convertFileSrc()` (asset:// protocol). This
// dodges three otherwise-fatal browser policies on remote PDFs:
//   1. CORS blocks `fetch(..., {responseType: 'blob'})` from arbitrary origins.
//   2. Publishers send `X-Frame-Options: deny`, killing iframe rendering.
//   3. Our CSP `frame-src` only allows `'self'` + `asset:`.
// Local files via asset:// satisfy all three.
//
// "Open externally" is kept as an escape hatch — useful when the publisher
// returns an HTML wall instead of a PDF (Rust catches the wrong content-type
// and surfaces an error toast).
async function openPdfViewer(remoteUrl, title, postId) {
  const wrap = document.createElement('div');
  wrap.className = 'papers-modal-backdrop';
  wrap.innerHTML = `
    <div class="papers-modal" style="width:min(1100px,95vw);height:min(92vh,1200px);display:flex;flex-direction:column">
      <div class="papers-modal-head">
        <h3 style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escape(title || 'PDF')}</h3>
        <div style="display:flex;gap:8px;align-items:center">
          <a class="btn btn-sm btn-bordered" href="${escape(remoteUrl)}" target="_blank" rel="noopener">
            <i data-lucide="external-link"></i> Open externally
          </a>
          <button class="btn btn-ghost btn-sm" id="pdf-modal-close" aria-label="Close"><i data-lucide="x"></i></button>
        </div>
      </div>
      <div id="pdf-modal-body" style="flex:1;display:flex;align-items:center;justify-content:center;background:#1b1b1b;border-radius:0 0 12px 12px;color:#aaa;font-size:13px">
        <span>Downloading PDF…</span>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  window.refreshIcons?.();

  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', escHandler);
  };
  const escHandler = (ev) => { if (ev.key === 'Escape') close(); };
  $('#pdf-modal-close', wrap)?.addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', escHandler);

  const body = $('#pdf-modal-body', wrap);
  try {
    const r = await api.paperPdfFetch(remoteUrl, postId);
    if (!r?.ok || !r.path) throw new Error(r?.reason || 'fetch failed');
    const localUrl = convertFileSrc(r.path);
    body.style.padding = '0';
    body.innerHTML = `
      <iframe src="${escape(localUrl)}"
              style="flex:1;width:100%;height:100%;border:0;background:#222"
              title="${escape(title || 'PDF')}"></iframe>
    `;
  } catch (e) {
    body.innerHTML = `
      <div style="text-align:center;padding:32px;max-width:480px">
        <div style="color:#e88;font-weight:600;margin-bottom:8px">Couldn't fetch PDF</div>
        <div style="color:#aaa;font-size:12px;margin-bottom:16px">${escape(e?.message || e)}</div>
        <a class="btn btn-sm primary" href="${escape(remoteUrl)}" target="_blank" rel="noopener">
          <i data-lucide="external-link"></i> Open in browser
        </a>
      </div>
    `;
    window.refreshIcons?.();
  }
}
