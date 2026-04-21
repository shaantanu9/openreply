// Find — local semantic search over the collected posts corpus.
// Offline, <30 ms. Uses the opt-in ChromaDB palace (api.semanticSearch).
// Top-level route at #/find. If the model isn't ready, shows a prompt
// that links to Settings → Semantic search to enable it.

import { api, $, esc, timeAgo } from '../api.js';

const state = {
  query: '',
  topic: '',
  source: '',
  k: 10,
  rows: null,
  loading: false,
  error: null,
  topicsList: [],
  sourceList: [],
  modelStatus: null,
};

function sourceLabel(s) {
  const map = {
    reddit: 'Reddit', hn: 'Hacker News', appstore: 'App Store',
    playstore: 'Play Store', arxiv: 'arXiv', openalex: 'OpenAlex',
    pubmed: 'PubMed', gnews: 'News', devto: 'Dev.to',
    stackoverflow: 'Stack Overflow', github: 'GitHub', github_issue: 'GitHub Issue',
    scholar: 'Scholar', trends: 'Trends', local_file: 'Local',
  };
  return map[s] || s || 'unknown';
}

function renderResult(hit) {
  const meta = hit.metadata || {};
  const scorePct = Math.round((hit.score || 0) * 100);
  const srcTag = meta.source_type
    ? `<span class="find-src-tag">${esc(sourceLabel(meta.source_type))}</span>`
    : '';
  const subTag = meta.sub
    ? `<span class="find-sub-tag">r/${esc(meta.sub)}</span>`
    : '';
  const topicTag = meta.topic
    ? `<a class="find-topic-tag" href="#/topic/${encodeURIComponent(meta.topic)}">${esc(meta.topic)}</a>`
    : '';
  const when = meta.created_utc && Number(meta.created_utc) > 0
    ? timeAgo(new Date(Number(meta.created_utc) * 1000).toISOString())
    : '—';
  const url = meta.url
    ? `<a class="find-link" href="${esc(meta.url)}" target="_blank" rel="noopener">open →</a>`
    : '';
  return `
    <div class="find-row">
      <div class="find-head">
        <span class="find-score" title="vector ${hit.vector_score} · bm25 ${hit.bm25_score}">${scorePct}%</span>
        ${srcTag}${subTag}${topicTag}
        <span class="find-when">${when}</span>
        <div style="flex:1"></div>
        ${url}
      </div>
      <div class="find-text">${esc((hit.text || '').slice(0, 420))}${(hit.text || '').length > 420 ? '…' : ''}</div>
    </div>
  `;
}

function renderResults() {
  if (state.loading) return `<div class="empty-state">Searching corpus…</div>`;
  if (state.error)   return `<div class="empty-state" style="color:#B84747">✗ ${esc(state.error)}</div>`;
  if (state.rows == null) {
    return `<div class="empty-big">
      <h3>Semantic search across your corpus</h3>
      <p>Type a question or concept above — results come back in ~20 ms, ranked by meaning + keyword match.</p>
    </div>`;
  }
  if (!state.rows.length) {
    return `<div class="empty-state">No semantic matches. Try a different phrasing, or broaden the topic filter.</div>`;
  }
  return `<div class="find-list">${state.rows.map(renderResult).join('')}</div>`;
}

function renderNotReady(root, ms) {
  const installed = !!ms?.installed;
  const archiveMB = ms?.archive_bytes ? (ms.archive_bytes / 1024 / 1024).toFixed(1) : '0';
  const cta = installed
    ? `<button class="btn btn-primary" id="find-goto-settings">Enable in Settings →</button>`
    : `<p style="color:var(--ink-3);font-size:var(--fs-13)">This build shipped without the retrieval extras (chromadb). Rebuild the sidecar with the <code>retrieval</code> extras group to unlock semantic search.</p>`;
  const resume = ms?.archive_bytes > 1_000_000
    ? `<p style="color:var(--ink-3);font-size:var(--fs-13)">Partial download detected: ${archiveMB} MB of ~80 MB. Settings will pick up where it left off.</p>`
    : '';
  root.querySelector('#find-body').innerHTML = `
    <div class="empty-big">
      <h3>Semantic search isn't set up yet</h3>
      <p>This is a one-time ~80 MB download of an offline embedding model. Zero network calls afterwards — fully local, fully private.</p>
      ${resume}
      <div style="display:flex;gap:10px;justify-content:center;margin-top:14px">${cta}</div>
    </div>
  `;
  root.querySelector('#find-goto-settings')?.addEventListener('click', () => {
    location.hash = '#/settings';
  });
}

async function runSearch(root) {
  if (!state.query.trim()) {
    state.rows = null;
    state.error = null;
    $('#find-body').innerHTML = renderResults();
    return;
  }
  state.loading = true;
  state.error = null;
  $('#find-body').innerHTML = renderResults();
  try {
    const r = await api.semanticSearch(state.query, {
      topic: state.topic || undefined,
      source: state.source || undefined,
      k: state.k,
    });
    if (r?.skipped) {
      // Palace not installed / not ready after all — re-render the prompt.
      const ms = await api.palaceModelStatus().catch(() => ({ installed: false, ready: false }));
      state.modelStatus = ms;
      renderNotReady(root, ms);
      return;
    }
    state.rows = Array.isArray(r?.results) ? r.results : [];
  } catch (e) {
    state.error = e?.message || String(e);
    state.rows = [];
  } finally {
    state.loading = false;
    $('#find-body').innerHTML = renderResults();
  }
}

// Pre-fill path: other screens (Topic → Evidence "Find similar" chip)
// set `window.gapmapFindQuery = "some concept"` + optional topic filter
// before navigating to `#/find`. We consume + clear it on mount so a later
// navigation without a pre-fill starts clean.
function consumePrefill() {
  if (typeof window === 'undefined') return null;
  const pre = window.gapmapFindQuery;
  try { delete window.gapmapFindQuery; } catch {}
  const topic = window.gapmapFindTopic;
  try { delete window.gapmapFindTopic; } catch {}
  if (!pre) return null;
  return { query: String(pre), topic: topic ? String(topic) : '' };
}

export async function renderFind(root) {
  state.query = '';
  state.rows = null;
  state.error = null;
  state.loading = false;

  const prefill = consumePrefill();

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Find</strong></div>
      <div class="topbar-spacer"></div>
    </header>

    <div class="section-head">
      <div>
        <h2>Semantic search</h2>
        <p id="find-sub">Offline, ~20 ms. Embedded with all-MiniLM-L6-v2, reranked with BM25.</p>
      </div>
    </div>

    <div class="find-toolbar">
      <input type="text" id="find-q" class="find-input" placeholder='Try: "users losing data on upgrade" or "frustration with sync"' autocomplete="off" />
      <select id="find-topic" class="find-select" aria-label="Topic filter"><option value="">All topics</option></select>
      <select id="find-source" class="find-select" aria-label="Source filter">
        <option value="">All sources</option>
        <option value="reddit">Reddit</option>
        <option value="hn">Hacker News</option>
        <option value="appstore">App Store</option>
        <option value="playstore">Play Store</option>
        <option value="arxiv">arXiv</option>
        <option value="openalex">OpenAlex</option>
        <option value="pubmed">PubMed</option>
        <option value="gnews">News</option>
        <option value="devto">Dev.to</option>
        <option value="stackoverflow">Stack Overflow</option>
        <option value="github">GitHub</option>
      </select>
      <select id="find-k" class="find-select" aria-label="Result count">
        <option value="10">10 hits</option>
        <option value="20">20 hits</option>
        <option value="50">50 hits</option>
      </select>
      <button class="btn btn-primary btn-sm" id="find-btn">Search</button>
    </div>

    <div id="find-body"><div class="empty-state">Checking model status…</div></div>
  `;

  // Check model readiness first. If not ready, render the prompt + exit.
  const ms = await api.palaceModelStatus().catch(() => ({ installed: false, ready: false }));
  state.modelStatus = ms;
  if (!ms?.ready) {
    renderNotReady(root, ms);
    return;
  }

  // Populate topic dropdown so users can scope the search.
  try {
    const topics = await api.listTopics();
    if (Array.isArray(topics)) {
      const sel = root.querySelector('#find-topic');
      topics.forEach(t => {
        const o = document.createElement('option');
        o.value = t.topic; o.textContent = t.topic;
        sel.appendChild(o);
      });
    }
  } catch {}

  // Wire input + submit.
  const qEl = root.querySelector('#find-q');
  const topicSel = root.querySelector('#find-topic');
  const srcSel = root.querySelector('#find-source');
  const kSel = root.querySelector('#find-k');
  const go = () => {
    state.query = qEl.value;
    state.topic = topicSel.value;
    state.source = srcSel.value;
    state.k = Number(kSel.value) || 10;
    runSearch(root);
  };
  root.querySelector('#find-btn').onclick = go;
  qEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
  });

  // Pre-filled query from another screen (Topic → Evidence "Find similar").
  // Populate the form + auto-run so the user sees results immediately.
  if (prefill?.query) {
    qEl.value = prefill.query;
    if (prefill.topic) {
      // Select the topic if we pre-loaded its option; otherwise add + select.
      const has = [...topicSel.options].some(o => o.value === prefill.topic);
      if (!has) {
        const o = document.createElement('option');
        o.value = prefill.topic; o.textContent = prefill.topic;
        topicSel.appendChild(o);
      }
      topicSel.value = prefill.topic;
    }
    // Run on the next tick so the form is in the DOM before we touch it.
    setTimeout(go, 0);
  } else {
    // No prefill — focus input for fast querying.
    setTimeout(() => qEl.focus(), 30);
  }

  // Paint initial empty state.
  $('#find-body').innerHTML = renderResults();
}
