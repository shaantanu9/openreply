// Concepts tab — Concept Agent output. Renders 3-5 evidence-backed product
// ideas synthesized from a topic's painpoints. Each concept cites the exact
// painpoint labels it's justified by — clickable citations back to Solutions.
//
// Bare-minimum MVP per docs/superpowers/specs/2026-04-20-monetization-strategy.md
// — no export, no paywall yet. Just the feature.
import { api } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);

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
  set('<div class="empty-state">loading…</div>');

  const existing = await fetchExistingConcepts(topic);
  if (contentEl.dataset.tab !== 'concepts') return;

  const renderAndBind = async (concepts) => {
    set(renderList(concepts));
    if (contentEl.dataset.tab !== 'concepts') return;
    window.refreshIcons?.();
    $('#btn-rerun-concepts', contentEl)?.addEventListener('click', async () => {
      set('<div class="empty-state">Re-running Concept Agent…</div>');
      try {
        const result = await api.runConcepts(topic);
        if (result?.reason && !result.concepts?.length) {
          set(`<div class="empty-big"><h3>No concepts</h3><p>${escape(result.reason)}</p></div>`);
          return;
        }
        await loadConcepts(contentEl, topic);
      } catch (e) {
        set(`<div class="empty-big"><h3>Couldn't run</h3><p>${escape(e?.message || e)}</p></div>`);
      }
    });
  };

  if (existing.length) {
    await renderAndBind(existing.map(conceptFromGraphRow));
    return;
  }

  set(renderEmpty(topic));
  if (contentEl.dataset.tab !== 'concepts') return;
  window.refreshIcons?.();

  $('#btn-run-concepts', contentEl)?.addEventListener('click', async () => {
    const status = $('#concepts-status', contentEl);
    status.textContent = 'Running… this may take 20-60 seconds.';
    try {
      const result = await api.runConcepts(topic);
      if (contentEl.dataset.tab !== 'concepts') return;
      if (result?.skipped) {
        status.textContent = `Skipped: ${result.reason || 'unknown'}. Add an LLM key in Settings.`;
        return;
      }
      if (!result?.concepts?.length) {
        status.textContent = result?.reason || 'No concepts returned. Try re-running.';
        return;
      }
      await renderAndBind(result.concepts);
    } catch (e) {
      status.textContent = `Error: ${e?.message || e}`;
    }
  });
}
