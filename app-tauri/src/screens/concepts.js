// Concepts tab — Concept Agent output. Renders 3-5 evidence-backed product
// ideas synthesized from a topic's painpoints. Each concept cites the exact
// painpoint labels it's justified by — clickable citations back to Solutions.
//
// Bare-minimum MVP per docs/superpowers/specs/2026-04-20-monetization-strategy.md
// — no export, no paywall yet. Just the feature.
import { api } from '../api.js';
import { isAutoRunEnabled } from '../lib/tabPipelines.js';
import { hasLlmConfigured } from '../lib/llmStatus.js';
import { readScreenCache, writeScreenCache } from '../lib/screenCache.js';
import { renderAnalyzingState } from '../lib/analyzingLoader.js';

// Domain stages for the Concept Agent's single blocking LLM call (no
// incremental persist — the whole 3-5 concept payload lands at once, so this
// is a hero-only loader, no per-card polling).
const CONCEPT_STAGES = [
  'Reading painpoints & workarounds…',
  'Clustering unmet needs…',
  'Drafting candidate product concepts…',
  'Grounding each concept in evidence…',
  'Scoring confidence & effort…',
  'Almost done — packaging concepts…',
];

const $ = (sel, root = document) => root.querySelector(sel);

// Per-topic in-flight guard so opening the tab, switching away, and returning
// (or a db-changed re-run) doesn't double-fire the blocking Concept Agent call.
// On re-entry we re-show the alive loader (continuing from the real elapsed via
// the shared loader's runKey) instead of kicking a second run.
const _conceptsRunning = new Set();  // topic
const conceptsRunKey = (topic) => `concepts:${topic}`;

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function confidenceBadge(c) {
  const v = (c || '').toLowerCase();
  const cls = v === 'high' ? 'tier-meta' : v === 'medium' ? 'tier-peer' : 'tier-anec';
  return `<span class="tier-badge ${cls}">${escape(c || '?')}</span>`;
}

function effortBadge(e) {
  const v = (e || '').toLowerCase();
  const label = {
    'weekend-project': 'Weekend',
    '1-month': '1 month',
    '3-month': '3 months',
  }[v] || (e || '?');
  return `<span class="chip">${escape(label)}</span>`;
}

async function fetchExistingConcepts(topic) {
  const sql = `
    SELECT n.id, n.label, n.metadata_json
    FROM graph_nodes n
    WHERE n.topic = :topic AND n.kind = 'concept'
    ORDER BY n.label
  `;
  return await api.runQuery(sql, topic) || [];
}

function renderConceptCard(c) {
  const title = c.title || c.label || '—';
  const headline = c.headline || '';
  const target = c.target_user || '';
  const job = c.core_job || '';
  const diff = c.differentiation || '';
  const evidence = (c.evidence_painpoint_labels || [])
    .map(lbl => `<span class="chip">${escape(lbl)}</span>`)
    .join(' ');
  return `
    <details class="solutions-card concept-card">
      <summary>
        <span class="painpoint-title">${escape(title)}</span>
        <span class="emotions">
          ${confidenceBadge(c.confidence)} ${effortBadge(c.effort_tier)}
        </span>
      </summary>
      <div class="card-body">
        ${headline ? `<p class="concept-headline"><b>${escape(headline)}</b></p>` : ''}
        <section>
          <h4>Target user</h4>
          <p>${escape(target) || '—'}</p>
        </section>
        <section>
          <h4>Core job</h4>
          <p>${escape(job) || '—'}</p>
        </section>
        <section>
          <h4>Why this beats alternatives</h4>
          <p>${escape(diff) || '—'}</p>
        </section>
        <section>
          <h4>Evidence painpoints (${(c.evidence_painpoint_labels || []).length})</h4>
          <div class="chips-row">${evidence || '<span class="muted">—</span>'}</div>
        </section>
      </div>
    </details>
  `;
}

function conceptFromGraphRow(row) {
  let meta = {};
  try { meta = JSON.parse(row.metadata_json || '{}'); } catch {}
  return {
    title: row.label,
    headline: meta.headline,
    target_user: meta.target_user,
    core_job: meta.core_job,
    differentiation: meta.differentiation,
    evidence_painpoint_labels: meta.evidence_painpoint_labels || [],
    confidence: meta.confidence,
    effort_tier: meta.effort_tier,
  };
}

function renderEmpty(topic) {
  return `
    <div class="empty-state">
      <h3>Generate product concepts</h3>
      <p>The Concept Agent reads the painpoints, sentiment, and workarounds
      for <b>${escape(topic)}</b> and proposes 3-5 specific product ideas a
      solopreneur could build — each citing the painpoints that justify it.</p>
      <button class="btn primary" id="btn-run-concepts"><i data-lucide="sparkles"></i> Ideate concepts</button>
      <div id="concepts-status" class="muted" style="margin-top:12px"></div>
    </div>
  `;
}

function renderList(concepts) {
  return `
    <div class="concepts-tab">
      <div class="solutions-toolbar">
        <span class="muted">${concepts.length} concepts</span>
        <button class="btn" id="btn-rerun-concepts"><i data-lucide="refresh-cw"></i> Re-run</button>
      </div>
      <div class="solutions-list">${concepts.map(renderConceptCard).join('')}</div>
    </div>
  `;
}

export async function loadConcepts(contentEl, topic) {
  const set = (html) => { if (contentEl.dataset.tab === 'concepts') contentEl.innerHTML = html; };

  // SWR: paint cached concepts immediately, refresh in background. The
  // graph_nodes(kind='concept') row read is fast but still pays a sidecar
  // spawn (~200-800 ms). Cache survives app restart.
  const CACHE_KEY = `concepts.${topic}`;
  const cachedConcepts = readScreenCache(CACHE_KEY);
  let paintedFromCache = false;

  // We need to lazily call renderAndBind — keep a forward-binding ref so
  // both the cache path AND the live-fetch path use the same renderer.
  let renderAndBind;

  if (Array.isArray(cachedConcepts) && cachedConcepts.length > 0) {
    paintedFromCache = true;
    // Defer to after renderAndBind is defined (a few lines down).
    queueMicrotask(() => renderAndBind?.(cachedConcepts));
  } else {
    set('<div class="empty-state">loading…</div>');
  }

  const existing = await fetchExistingConcepts(topic);
  if (contentEl.dataset.tab !== 'concepts') return;

  renderAndBind = async (concepts) => {
    set(renderList(concepts));
    if (contentEl.dataset.tab !== 'concepts') return;
    window.refreshIcons?.();
    $('#btn-rerun-concepts', contentEl)?.addEventListener('click', async () => {
      if (_conceptsRunning.has(topic)) return;
      _conceptsRunning.add(topic);
      const stop = renderAnalyzingState(contentEl, {
        headline: 'Re-running Concept Agent', stages: CONCEPT_STAGES,
        medianRuntimeSec: 40, etaText: 'typically 20–60 seconds', skeletonCount: 3,
        runKey: conceptsRunKey(topic),
      });
      try {
        const result = await api.runConcepts(topic);
        stop({ snapToComplete: true });
        if (contentEl.dataset.tab !== 'concepts') return;
        if (result?.reason && !result.concepts?.length) {
          set(`<div class="empty-big"><h3>No concepts</h3><p>${escape(result.reason)}</p></div>`);
          return;
        }
        await loadConcepts(contentEl, topic);
      } catch (e) {
        stop();
        set(`<div class="empty-big"><h3>Couldn't run</h3><p>${escape(e?.message || e)}</p></div>`);
      } finally {
        _conceptsRunning.delete(topic);
      }
    });
  };

  if (existing.length) {
    const concepts = existing.map(conceptFromGraphRow);
    writeScreenCache(CACHE_KEY, concepts);
    await renderAndBind(concepts);
    return;
  }

  // No live concepts. Keep the cached paint if we have one (better than
  // blanking on what might be a transient sidecar hiccup); otherwise
  // show the empty CTA.
  if (paintedFromCache) return;
  // A run is already in flight (kicked on an earlier tab open). Re-show the
  // alive loader — continuing from the REAL elapsed via runKey — rather than
  // the empty CTA, and do NOT start a second run. The in-flight run repaints
  // via renderAndBind when it lands.
  if (_conceptsRunning.has(topic)) {
    renderAnalyzingState(contentEl, {
      headline: 'Ideating product concepts', stages: CONCEPT_STAGES,
      medianRuntimeSec: 40, etaText: 'typically 20–60 seconds', skeletonCount: 3,
      runKey: conceptsRunKey(topic),
    });
    return;
  }
  set(renderEmpty(topic));
  if (contentEl.dataset.tab !== 'concepts') return;
  window.refreshIcons?.();

  const runBtn = $('#btn-run-concepts', contentEl);
  const runPipeline = async () => {
    if (_conceptsRunning.has(topic)) return;  // already running — don't double-fire
    _conceptsRunning.add(topic);
    if (runBtn) runBtn.disabled = true;
    // Full-bleed alive loader replaces the empty CTA while the single
    // blocking LLM call runs. On any non-render outcome we fall back to the
    // empty CTA + a status line so the user can retry.
    const stop = renderAnalyzingState(contentEl, {
      headline: 'Ideating product concepts', stages: CONCEPT_STAGES,
      medianRuntimeSec: 40, etaText: 'typically 20–60 seconds', skeletonCount: 3,
      runKey: conceptsRunKey(topic),
    });
    const backToEmpty = (msg) => {
      stop();
      if (contentEl.dataset.tab !== 'concepts') return;
      set(renderEmpty(topic));
      window.refreshIcons?.();
      const el = contentEl.querySelector('#concepts-status');
      if (el) el.textContent = msg;
      const b = $('#btn-run-concepts', contentEl);
      if (b) b.addEventListener('click', runPipeline);
    };
    try {
      const result = await api.runConcepts(topic);
      if (contentEl.dataset.tab !== 'concepts') { stop(); return; }
      if (result?.skipped) {
        backToEmpty(`Skipped: ${result.reason || 'unknown'}. Add an LLM key in Settings.`);
        return;
      }
      if (!result?.concepts?.length) {
        backToEmpty(result?.reason || 'No concepts returned. Try re-running.');
        return;
      }
      stop({ snapToComplete: true });
      await renderAndBind(result.concepts);
    } catch (e) {
      backToEmpty(`Error: ${e?.message || e}`);
    } finally {
      _conceptsRunning.delete(topic);
    }
  };
  runBtn?.addEventListener('click', runPipeline);
  if (isAutoRunEnabled() && await hasLlmConfigured()) {
    if (contentEl.dataset.tab === 'concepts') runPipeline();
  }
}
