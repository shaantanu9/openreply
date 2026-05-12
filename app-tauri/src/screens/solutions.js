// Solutions tab — shows the Problem -> Why -> Science -> Solution loop
// per painpoint. Reads from graph_nodes/graph_edges via api.runQuery.
import { api } from '../api.js';
import { isAutoRunEnabled } from '../lib/tabPipelines.js';
import { hasLlmConfigured } from '../lib/llmStatus.js';
import { readScreenCache, writeScreenCache } from '../lib/screenCache.js';

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

// Kano-Model badge. Stored in metadata_json.kano on each intervention by
// research/kano.py. Five categories from Noriaki Kano (1984): must_be /
// performance / attractive / indifferent / reverse. We surface them as
// colored chips so users can scan a painpoint card and see where to
// invest engineering effort first.
const KANO_LABEL = {
  must_be: 'Must-Be',
  performance: 'Performance',
  attractive: 'Attractive',
  indifferent: 'Indifferent',
  reverse: 'Reverse',
};
function kanoBadge(kano, confidence, reasoning) {
  if (!kano || !KANO_LABEL[kano]) return '';
  const conf = confidence ? ` · ${escape(confidence)}` : '';
  const tip = reasoning ? ` title="${escape(reasoning)}"` : '';
  return `<span class="kano-badge kano-${kano}"${tip}>${KANO_LABEL[kano]}${conf}</span>`;
}

// MoSCoW (Clegg, 1994) — Must / Should / Could / Won't. Sibling axis to
// Kano: stored in metadata_json.moscow on each intervention by
// research/moscow.py. Renders as a colored pill so the Solutions tab
// shows BOTH the satisfaction (Kano) and scope-discipline (MoSCoW)
// dimensions on the same card.
const MOSCOW_LABEL = {
  must: 'Must', should: 'Should', could: 'Could', wont: "Won't",
};
function moscowBadge(moscow, confidence, reasoning) {
  if (!moscow || !MOSCOW_LABEL[moscow]) return '';
  const conf = confidence ? ` · ${escape(confidence)}` : '';
  const tip = reasoning ? ` title="${escape(reasoning)}"` : '';
  return `<span class="moscow-badge moscow-${moscow}"${tip}>${MOSCOW_LABEL[moscow]}${conf}</span>`;
}

// RICE (Sean McBride / Intercom, 2016). research/rice.py auto-fills
// reach + impact + confidence from the corpus and defaults effort to 3;
// a manual override (api.riceSet) flips auto=false. Tooltip shows the
// component values so users can see why the number is what it is.
function riceBadge(rice) {
  if (!rice) return '';
  const score = (typeof rice.score === 'number') ? rice.score : 0;
  const auto = rice.auto ? '' : ' · manual';
  const tip = `Reach=${rice.reach || 0} · Impact=${rice.impact || 0} · ` +
              `Confidence=${rice.confidence || 0}% · Effort=${rice.effort || 0}${auto}`;
  return `<span class="rice-badge" title="${escape(tip)}">RICE ${score.toFixed(1)}</span>`;
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
  const jtbdStatement = (why.jtbd_statement || '').trim();

  const intvHtml = interventions.length === 0
    ? '<p class="muted">No interventions yet.</p>'
    : interventions.map(iv => {
        const m = (() => { try { return JSON.parse(iv.metadata_json || '{}'); } catch { return {}; } })();
        const kanoCls = m.kano ? ` data-kano="${escape(m.kano)}"` : '';
        const moscowAttr = m.moscow ? ` data-moscow="${escape(m.moscow)}"` : '';
        return `
          <li class="intervention"${kanoCls}${moscowAttr}>
            <div class="intervention-label">${escape(iv.label)}</div>
            <div class="intervention-meta">
              ${riceBadge(m.rice)}
              ${kanoBadge(m.kano, m.kano_confidence, m.kano_reasoning)}
              ${moscowBadge(m.moscow, m.moscow_confidence, m.moscow_reasoning)}
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
          ${jtbdStatement ? `<p class="jtbd-statement"><b>JTBD:</b> <em>${escape(jtbdStatement)}</em></p>` : ''}
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

  // SWR: paint cached cards immediately, refresh in background. The
  // painpoints + per-card interventions/papers fan-out costs ~3-6
  // sidecar spawns; cache survives app restart so re-opening Solutions
  // paints in <10 ms. Mutation listener in main.js (kind='findings' /
  // 'graph') drops the cache when the user re-runs the pipeline.
  const CACHE_KEY = `solutions.${topic}`;
  const cachedCards = readScreenCache(CACHE_KEY);
  let paintedFromCache = false;

  const renderCards = (cards) => {
    set(`
      <div class="solutions-tab">
        <div class="solutions-toolbar">
          <button class="btn" id="btn-rerun-solutions"><i data-lucide="refresh-cw"></i> Re-run pipeline</button>
          <button class="btn" id="btn-rerun-rice" title="Compute deterministic RICE scores from corpus data"><i data-lucide="trending-up"></i> Re-run RICE</button>
          <button class="btn" id="btn-rerun-kano" title="Re-categorize all interventions by Kano (no science fetch)"><i data-lucide="layers"></i> Re-run Kano</button>
          <button class="btn" id="btn-rerun-moscow" title="LLM-tag every intervention as Must / Should / Could / Won't (Clegg, 1994)"><i data-lucide="list-checks"></i> Re-run MoSCoW</button>
          <div class="kano-filter" role="group" aria-label="Filter by Kano category">
            <button class="chip kano-chip is-on" data-kano-filter="all">All</button>
            <button class="chip kano-chip kano-must_be" data-kano-filter="must_be">Must-Be</button>
            <button class="chip kano-chip kano-performance" data-kano-filter="performance">Performance</button>
            <button class="chip kano-chip kano-attractive" data-kano-filter="attractive">Attractive</button>
            <button class="chip kano-chip kano-indifferent" data-kano-filter="indifferent">Indifferent</button>
          </div>
          <div class="moscow-filter" role="group" aria-label="Filter by MoSCoW">
            <button class="chip moscow-chip is-on" data-moscow-filter="all">All</button>
            <button class="chip moscow-chip moscow-must"   data-moscow-filter="must">Must</button>
            <button class="chip moscow-chip moscow-should" data-moscow-filter="should">Should</button>
            <button class="chip moscow-chip moscow-could"  data-moscow-filter="could">Could</button>
            <button class="chip moscow-chip moscow-wont"   data-moscow-filter="wont">Won't</button>
          </div>
        </div>
        <div class="solutions-list">${cards.map(c => renderPainpointCard(c.pp, c.interventions, c.papers)).join('')}</div>
      </div>
    `);
    if (contentEl.dataset.tab !== 'solutions') return;
    window.refreshIcons?.();

    // Filter wiring — Kano AND MoSCoW filters intersect (a row hides if
    // it fails either active filter). Both axes default to 'all' so the
    // combined filter is a no-op until the user clicks a chip.
    const kanoChips = contentEl.querySelectorAll('.kano-chip');
    const moscowChips = contentEl.querySelectorAll('.moscow-chip');

    const applyFilters = () => {
      const wantKano = contentEl.querySelector('.kano-chip.is-on')?.dataset.kanoFilter || 'all';
      const wantMos  = contentEl.querySelector('.moscow-chip.is-on')?.dataset.moscowFilter || 'all';
      contentEl.querySelectorAll('.intervention').forEach(li => {
        const k = li.dataset.kano || '';
        const m = li.dataset.moscow || '';
        const okK = wantKano === 'all' || wantKano === k;
        const okM = wantMos  === 'all' || wantMos  === m;
        li.style.display = (okK && okM) ? '' : 'none';
      });
    };
    kanoChips.forEach(chip => {
      chip.addEventListener('click', () => {
        kanoChips.forEach(c => c.classList.toggle('is-on', c === chip));
        applyFilters();
      });
    });
    moscowChips.forEach(chip => {
      chip.addEventListener('click', () => {
        moscowChips.forEach(c => c.classList.toggle('is-on', c === chip));
        applyFilters();
      });
    });

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
          <p style="margin-top:10px;color:var(--ink-3);font-size:var(--fs-13)">
              Check your LLM key in Settings → API keys, or retry in a moment.
            </p>
          </div>`);
        return;
      }
      await loadSolutions(contentEl, topic);
    });

    $('#btn-rerun-kano', contentEl)?.addEventListener('click', async () => {
      const btn = $('#btn-rerun-kano', contentEl);
      if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Categorizing…'; window.refreshIcons?.(); }
      try {
        await api.runKanoCategorize(topic);
        await loadSolutions(contentEl, topic);
      } catch (e) {
        console.error('kano categorize failed:', e);
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="layers"></i> Re-run Kano'; window.refreshIcons?.(); }
        alert(`Kano failed: ${e?.message || e}`);
      }
    });

    $('#btn-rerun-moscow', contentEl)?.addEventListener('click', async () => {
      const btn = $('#btn-rerun-moscow', contentEl);
      if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Tagging…'; window.refreshIcons?.(); }
      try {
        const r = await api.runMoscowCategorize(topic);
        if (r?.skipped) {
          alert(`MoSCoW skipped: ${r.reason || 'no LLM provider'}. Add an LLM key in Settings.`);
          if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="list-checks"></i> Re-run MoSCoW'; window.refreshIcons?.(); }
          return;
        }
        await loadSolutions(contentEl, topic);
      } catch (e) {
        console.error('moscow categorize failed:', e);
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="list-checks"></i> Re-run MoSCoW'; window.refreshIcons?.(); }
        alert(`MoSCoW failed: ${e?.message || e}`);
      }
    });

    $('#btn-rerun-rice', contentEl)?.addEventListener('click', async () => {
      const btn = $('#btn-rerun-rice', contentEl);
      if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Scoring…'; window.refreshIcons?.(); }
      try {
        await api.runRiceScore(topic, 3, false);
        await loadSolutions(contentEl, topic);
      } catch (e) {
        console.error('rice score failed:', e);
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="trending-up"></i> Re-run RICE'; window.refreshIcons?.(); }
        alert(`RICE failed: ${e?.message || e}`);
      }
    });
  };

  if (Array.isArray(cachedCards) && cachedCards.length > 0) {
    renderCards(cachedCards);
    paintedFromCache = true;
  } else {
    set('<div class="empty-state">loading…</div>');
  }

  // Bundled fetch — was 1 + 2*N round-trips (one per painpoint × interventions
  // × papers). Now a single Tauri call that returns pre-stitched cards.
  let bundle;
  try {
    bundle = await api.solutionsDataBundle(topic);
  } catch (e) {
    if (paintedFromCache) return;
    set(`<div class="empty-big"><h3>Couldn't load solutions</h3><p>${escape(e?.message || e)}</p></div>`);
    return;
  }
  if (contentEl.dataset.tab !== 'solutions') return;
  const bundledPainpoints = bundle?.painpoints || [];

  if (!bundledPainpoints.length) {
    if (paintedFromCache) return;   // keep stale-but-valid paint
    set(`<div class="empty-state"><p>No painpoints found for <b>${escape(topic)}</b>. Build the gap map first.</p></div>`);
    return;
  }

  // Any interventions across all painpoints? Cheap check on the bundle —
  // no extra round-trip needed (was a separate run_query before).
  const haveSolutions = bundledPainpoints.some(c => (c.interventions || []).length > 0);

  if (!haveSolutions) {
    if (paintedFromCache) return;   // keep stale-but-valid paint
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

  // Persist + render the bundle. The bundle's shape already matches what
  // renderCards wants (`{ pp, interventions, papers }`), so no per-painpoint
  // fan-out — it's just a write + render.
  if (bundledPainpoints.length > 0) writeScreenCache(CACHE_KEY, bundledPainpoints);
  renderCards(bundledPainpoints);
}
