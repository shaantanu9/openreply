// Solutions tab — shows the Problem -> Why -> Science -> Solution loop
// per painpoint. Reads from graph_nodes/graph_edges via api.runQuery.
import { api } from '../api.js';
import { isAutoRunEnabled } from '../lib/tabPipelines.js';
import { hasLlmConfigured } from '../lib/llmStatus.js';

const $ = (sel, root = document) => root.querySelector(sel);

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function tierBadge(tier) {
  const cls = {
    'meta-analysis': 'tier-meta',
    'peer-reviewed': 'tier-peer',
    'expert': 'tier-expert',
    'anecdote': 'tier-anec',
  }[tier] || 'tier-unknown';
  return `<span class="tier-badge ${cls}">${escape(tier || 'unknown')}</span>`;
}

async function fetchSolutionsData(topic) {
  // One painpoint per row: includes why metadata + counts of linked
  // mechanism/intervention/evidence_paper nodes.
  const sql = `
    SELECT
      n.id AS painpoint_id,
      n.label AS painpoint_label,
      n.metadata_json
    FROM graph_nodes n
    WHERE n.topic = :topic AND n.kind = 'painpoint'
    ORDER BY n.label
  `;
  const painpoints = await api.runQuery(sql, topic);
  return painpoints || [];
}

async function fetchInterventionsForPainpoint(topic, painpointId) {
  // mechanism --addressed_by--> intervention; mechanism is keyed off painpoint
  const sql = `
    SELECT iv.id, iv.label, iv.metadata_json
    FROM graph_edges e1
    JOIN graph_nodes m ON m.id = e1.dst AND m.kind = 'mechanism'
    JOIN graph_edges e2 ON e2.src = m.id AND e2.kind = 'addressed_by'
    JOIN graph_nodes iv ON iv.id = e2.dst AND iv.kind = 'intervention'
    WHERE e1.src = :pid AND e1.kind = 'explained_by'
  `;
  return await api.runQuery(sql, topic, { pid: painpointId }) || [];
}

async function fetchPapersForPainpoint(topic, painpointId) {
  const sql = `
    SELECT p.id, p.label, p.metadata_json
    FROM graph_edges e
    JOIN graph_nodes p ON p.id = e.dst AND p.kind = 'evidence_paper'
    WHERE e.src = :pid AND e.kind = 'has_evidence'
  `;
  return await api.runQuery(sql, topic, { pid: painpointId }) || [];
}

function renderEmpty(topic) {
  return `
    <div class="empty-state">
      <p>No solutions yet for <b>${escape(topic)}</b>.</p>
      <p>Run the pipeline to generate science-backed interventions for each painpoint.</p>
      <button class="btn primary" id="btn-run-solutions"><i data-lucide="play"></i> Run solutions pipeline</button>
      <div id="solutions-status" class="muted"></div>
    </div>
  `;
}

function renderPainpointCard(pp, interventions, papers) {
  const meta = (() => { try { return JSON.parse(pp.metadata_json || '{}'); } catch { return {}; } })();
  const why = meta.why || {};
  const emotions = (why.emotions || []).map(e => `<span class="chip">${escape(e)}</span>`).join(' ');
  const jtbd = why.jtbd || {};

  const intvHtml = interventions.length === 0
    ? '<p class="muted">No interventions yet.</p>'
    : interventions.map(iv => {
        const m = (() => { try { return JSON.parse(iv.metadata_json || '{}'); } catch { return {}; } })();
        return `
          <li class="intervention">
            <div class="intervention-label">${escape(iv.label)}</div>
            <div class="intervention-meta">
              ${tierBadge(m.confidence_tier)}
              <span class="effort">effort: ${escape(m.effort || '?')}</span>
            </div>
            ${m.rationale ? `<div class="rationale">${escape(m.rationale)}</div>` : ''}
          </li>
        `;
      }).join('');

  const papersHtml = papers.length === 0
    ? '<p class="muted">No papers linked.</p>'
    : `<ul class="papers">${papers.map(p => {
        const m = (() => { try { return JSON.parse(p.metadata_json || '{}'); } catch { return {}; } })();
        const url = m.url || '#';
        return `<li>${tierBadge(m.tier)} <a href="${escape(url)}" target="_blank" rel="noopener">${escape(p.label)}</a></li>`;
      }).join('')}</ul>`;

  return `
    <details class="solutions-card">
      <summary>
        <span class="painpoint-title">${escape(pp.painpoint_label)}</span>
        <span class="emotions">${emotions}</span>
      </summary>
      <div class="card-body">
        <section>
          <h4>Why people feel this way</h4>
          <p><b>Struggling moment:</b> ${escape(jtbd.struggling_moment || '—')}</p>
          <p><b>Anxiety:</b> ${escape(jtbd.anxiety || '—')}</p>
          <p><b>Desired outcome:</b> ${escape(jtbd.desired_outcome || '—')}</p>
        </section>
        <section>
          <h4>What science says (${papers.length})</h4>
          ${papersHtml}
        </section>
        <section>
          <h4>Try this (${interventions.length})</h4>
          <ol class="interventions">${intvHtml}</ol>
        </section>
      </div>
    </details>
  `;
}

export async function loadSolutions(contentEl, topic) {
  // Gated writes — drop renders that would land after a rapid tab switch.
  const set = (html) => { if (contentEl.dataset.tab === 'solutions') contentEl.innerHTML = html; };
  set('<div class="empty-state">loading…</div>');
  const painpoints = await fetchSolutionsData(topic);
  if (contentEl.dataset.tab !== 'solutions') return;

  if (!painpoints.length) {
    set(`<div class="empty-state"><p>No painpoints found for <b>${escape(topic)}</b>. Build the gap map first.</p></div>`);
    return;
  }

  // Check whether any solutions exist — if not, show "run pipeline" CTA.
  const anySolutions = await api.runQuery(
    "SELECT count(*) AS c FROM graph_nodes WHERE topic = :topic AND kind = 'intervention'",
    topic,
  );
  if (contentEl.dataset.tab !== 'solutions') return;
  const haveSolutions = (anySolutions?.[0]?.c || 0) > 0;

  if (!haveSolutions) {
    set(renderEmpty(topic));
    if (contentEl.dataset.tab !== 'solutions') return;
    window.refreshIcons?.();
    const runBtn = $('#btn-run-solutions', contentEl);
    // Re-query #solutions-status on every assignment so a tab re-render
    // mid-run doesn't strand the captured ref. Without this, a captured
    // `status` goes null after `set(renderEmpty(...))` runs again or
    // when the user switches tabs and back, and the next assignment
    // throws `TypeError: null is not an object`. setStatus no-ops if
    // the host is gone — matches the pattern in concepts.js / chat.
    const setStatus = (msg) => {
      const el = contentEl.querySelector('#solutions-status');
      if (el) el.textContent = msg;
    };
    const runPipeline = async () => {
      if (runBtn) runBtn.disabled = true;
      setStatus('Running… this may take 1-3 minutes.');
      try {
        const result = await api.runSolutionsPipeline(topic);
        if (result?.skipped) {
          setStatus(`Skipped: ${result.reason || 'unknown'}. Add an LLM key in Settings.`);
          if (runBtn) runBtn.disabled = false;
          return;
        }
        await loadSolutions(contentEl, topic);
      } catch (e) {
        setStatus(`Error: ${e?.message || e}`);
        if (runBtn) runBtn.disabled = false;
      }
    };
    runBtn?.addEventListener('click', runPipeline);
    // Auto-run on open when the user has opted in AND an LLM is configured.
    // Falls back to the manual CTA when either condition fails so we never
    // silently consume credits against the user's will.
    if (isAutoRunEnabled() && await hasLlmConfigured()) {
      if (contentEl.dataset.tab === 'solutions') runPipeline();
    }
    return;
  }

  // Render painpoint cards
  const cards = await Promise.all(painpoints.map(async pp => {
    const [interventions, papers] = await Promise.all([
      fetchInterventionsForPainpoint(topic, pp.painpoint_id),
      fetchPapersForPainpoint(topic, pp.painpoint_id),
    ]);
    return renderPainpointCard(pp, interventions, papers);
  }));
  if (contentEl.dataset.tab !== 'solutions') return;

  set(`
    <div class="solutions-tab">
      <div class="solutions-toolbar">
        <button class="btn" id="btn-rerun-solutions"><i data-lucide="refresh-cw"></i> Re-run pipeline</button>
      </div>
      <div class="solutions-list">${cards.join('')}</div>
    </div>
  `);
  if (contentEl.dataset.tab !== 'solutions') return;
  window.refreshIcons?.();

  $('#btn-rerun-solutions', contentEl)?.addEventListener('click', async () => {
    set('<div class="empty-state">Re-running…</div>');
    let err = null;
    try {
      await api.runSolutionsPipeline(topic);
    } catch (e) {
      err = e;
      console.error('solutions pipeline failed:', e);
    }
    if (err) {
      set(
        `<div class="empty-big"><h3>Couldn't re-run solutions</h3>
          <p>${(err && (err.message || String(err))) || 'unknown error'}</p>
          <p style="margin-top:10px;color:var(--ink-3);font-size:12px">
            Check your LLM key in Settings → API keys, or retry in a moment.
          </p>
        </div>`);
      return;
    }
    await loadSolutions(contentEl, topic);
  });
}
