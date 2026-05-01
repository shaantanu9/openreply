// Intent action-ladder card — shown at the top of every topic page.
// Reads the topic's intent preset, checks completion state for each step
// via topic_intent_get, and renders a 3-4 step ladder where each step is:
//   ✓ done      (green, no button)
//   · available (primary button — click invokes the step's command)
//   🔒 locked    (disabled — waiting on an earlier step)
//
// Each "available" step click maps to an existing command the user could
// otherwise reach via a tab. Intent ladder is orchestration, not new logic.
import { api } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// step.key → { runLabel, onClick(ctx) }.
// `ctx` is { topic, goToTab(name), reloadLadder(), doneToast(msg) }.
// Most steps just switch to the relevant tab so the user runs the command
// from there — the tab already has the polished UI + streaming logs. A few
// (collect, brief) trigger the action directly.
const STEP_HANDLERS = {
  // --- product-new ladder ---
  collect:   { label: 'Run',    onClick: ({ topic }) => {
    // Start a new collect from the topic page without forcing the user to
    // go through the new-topic modal again. Reuses the Collect tab flow.
    window.gapmapOpenNewTopic?.(topic);
  }},
  solutions: { label: 'Open',   onClick: ({ goToTab }) => goToTab('solutions') },
  concepts:  { label: 'Open',   onClick: ({ goToTab }) => goToTab('concepts') },
  brief:     { label: 'Export', onClick: ({ topic, doneToast }) => {
    // Export brief uses the existing `export_brief` Tauri command.
    api.exportBrief?.(topic).then(() => doneToast('Brief exported'))
      .catch(e => doneToast(`Export failed: ${e?.message || e}`));
  }},

  // --- product-improve ladder ---
  attach:    { label: 'Attach', onClick: ({ goToTab }) => goToTab('product') },
  sweep:     { label: 'Run',    onClick: ({ goToTab }) => goToTab('product') },
  digest:    { label: 'Generate', onClick: ({ goToTab }) => goToTab('product') },

  // --- thesis ladder ---
  analyze_papers: { label: 'Run', onClick: ({ goToTab }) => goToTab('papers') },
  bibtex:         { label: 'Export', onClick: ({ goToTab }) => goToTab('papers') },

  // --- ux-research ladder ---
  sentiment: { label: 'Run',    onClick: ({ goToTab }) => goToTab('sentiment') },
  insights:  { label: 'Open',   onClick: ({ goToTab }) => goToTab('insights') },

  // --- market-report ladder ---
  trends:      { label: 'Open',   onClick: ({ goToTab }) => goToTab('trends') },
  competitors: { label: 'Build',  onClick: ({ goToTab }) => goToTab('research') },
  report_pro:  { label: 'Export', onClick: ({ goToTab }) => goToTab('report') },
};

function stepState(step, completion, prevDone) {
  if (completion[step.check]) return 'done';
  if (!prevDone)              return 'locked';
  return 'available';
}

function renderStep(step, i, state) {
  const handler = STEP_HANDLERS[step.key];
  const actionLabel = handler?.label || 'Open';
  const btn = state === 'available'
    ? `<button class="btn btn-sm primary intent-step-btn" data-step-key="${escape(step.key)}"><i data-lucide="play"></i> ${escape(actionLabel)}</button>`
    : state === 'locked'
      ? `<span class="intent-step-locked" title="Waiting on a previous step"><i data-lucide="lock"></i> locked</span>`
      : `<span class="intent-step-done"><i data-lucide="check-circle-2"></i> done</span>`;
  return `
    <li class="intent-step intent-step-${state}" data-step-key="${escape(step.key)}">
      <span class="intent-step-num">${i + 1}</span>
      <span class="intent-step-label">${escape(step.label)}</span>
      <span class="intent-step-action">${btn}</span>
    </li>
  `;
}

/**
 * Mount the action-ladder card into `hostEl`. Re-renders in place when
 * `reloadLadder()` is called (e.g. after a step completes).
 *
 * @param {HTMLElement} hostEl - container (cleared on each render)
 * @param {string} topic
 * @param {object} opts - { goToTab(name), onIntentChange?(key) }
 */
export async function mountIntentLadder(hostEl, topic, opts = {}) {
  const goToTab = opts.goToTab || (() => {});
  const doneToast = (msg) => {
    const t = document.createElement('div');
    t.className = 'intent-toast'; t.textContent = msg;
    hostEl.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  };

  let intentPayload = null;
  try {
    intentPayload = await api.topicIntentGet(topic);
  } catch (e) {
    hostEl.innerHTML = `<div class="intent-ladder-error">Couldn't load deliverable ladder: ${escape(e?.message || e)}</div>`;
    return;
  }

  const preset = intentPayload?.preset || {};
  const completion = intentPayload?.completion || {};
  const ladder = preset.action_ladder || [];
  const deliverable = preset.deliverable || 'Deliverable';
  const tagline = preset.tagline || '';

  // Compute each step's state. A step is available if the PRIOR step is
  // done (or it's the first step). Chaining like this keeps users from
  // jumping ahead before the input data exists.
  let prevDone = true;
  const states = ladder.map(s => {
    const st = stepState(s, completion, prevDone);
    if (st === 'done') { /* prevDone stays true */ }
    else { prevDone = false; }
    return st;
  });
  const doneCount = states.filter(s => s === 'done').length;

  const currentKey = intentPayload?.intent || 'product-new';
  const currentLabel = preset.label || currentKey;

  hostEl.innerHTML = `
    <section class="intent-ladder">
      <header class="intent-ladder-head">
        <div class="intent-ladder-title">
          <span class="intent-ladder-badge" id="intent-swap-btn" title="Change what you want from this research">
            <i data-lucide="${escape(preset.icon || 'target')}"></i>
            ${escape(currentLabel)}
            <i data-lucide="chevron-down" class="intent-swap-caret"></i>
          </span>
          <span class="intent-ladder-deliverable">→ ${escape(deliverable)}</span>
        </div>
        <div class="intent-ladder-progress">${doneCount} / ${ladder.length}</div>
      </header>
      ${tagline ? `<p class="intent-ladder-tagline">${escape(tagline)}</p>` : ''}
      <ol class="intent-ladder-steps">
        ${ladder.map((s, i) => renderStep(s, i, states[i])).join('')}
      </ol>
      <div class="intent-coverage" id="intent-coverage-host">
        <div class="intent-coverage-loading">loading gap map coverage…</div>
      </div>
    </section>
  `;
  window.refreshIcons?.();

  // Async-mount the gap-map coverage card so the primary ladder renders
  // instantly and coverage fills in when the SQL returns.
  mountCoverage(hostEl.querySelector('#intent-coverage-host'), topic);

  const reloadLadder = () => mountIntentLadder(hostEl, topic, opts);

  // Wire step buttons
  hostEl.querySelectorAll('.intent-step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.stepKey;
      const handler = STEP_HANDLERS[key];
      if (handler?.onClick) {
        handler.onClick({ topic, goToTab, reloadLadder, doneToast });
      }
    });
  });

  // Intent swap popup
  $('#intent-swap-btn', hostEl)?.addEventListener('click', async () => {
    const allIntents = await api.listIntents().catch(() => []);
    showIntentSwap(hostEl, topic, currentKey, allIntents, async (newKey) => {
      try {
        await api.topicIntentSet(topic, newKey);
        opts.onIntentChange?.(newKey);
        await reloadLadder();
      } catch (e) {
        doneToast(`Couldn't change intent: ${e?.message || e}`);
      }
    });
  });
}

function showIntentSwap(hostEl, topic, currentKey, presets, onPick) {
  const existing = document.querySelector('.intent-swap-popup');
  if (existing) { existing.remove(); return; }
  const pop = document.createElement('div');
  pop.className = 'intent-swap-popup';
  pop.innerHTML = `
    <div class="intent-swap-head">What do you want from this research?</div>
    <ul>
      ${(presets || []).map(p => `
        <li class="intent-swap-opt ${p.key === currentKey ? 'is-current' : ''}" data-key="${escape(p.key)}">
          <i data-lucide="${escape(p.icon || 'target')}"></i>
          <span class="opt-main">
            <b>${escape(p.label)}</b>
            <small>${escape(p.tagline || '')}</small>
          </span>
          ${p.key === currentKey ? '<i data-lucide="check" class="opt-check"></i>' : ''}
        </li>
      `).join('')}
    </ul>
  `;
  document.body.appendChild(pop);
  window.refreshIcons?.();
  // Position under the badge
  const badge = $('#intent-swap-btn', hostEl);
  if (badge) {
    const r = badge.getBoundingClientRect();
    pop.style.top  = `${r.bottom + 6}px`;
    pop.style.left = `${r.left}px`;
  }
  const close = () => pop.remove();
  setTimeout(() => document.addEventListener('click', function fn(e) {
    if (!pop.contains(e.target)) { close(); document.removeEventListener('click', fn); }
  }), 0);
  pop.querySelectorAll('.intent-swap-opt').forEach(li => {
    li.addEventListener('click', () => {
      const key = li.dataset.key;
      close();
      if (key && key !== currentKey) onPick(key);
    });
  });
}


// ── Gap Map coverage card ────────────────────────────────────────────────────
//
// Renders the live node-kind + edge-kind + source_type breakdown for a topic
// so users see the FULL pipeline output at a glance:
//   posts → painpoints → mechanisms → interventions → evidence_papers → concepts
// and every relation that connects them. Data comes from the Tauri
// `topic_graph_summary` command (3 cheap GROUP BY queries, cached 15s).

const NODE_GROUPS = {
  corpus:   { label: 'Corpus',    kinds: ['post', 'comment', 'user', 'subreddit', 'source'] },
  semantic: { label: 'Extracted', kinds: ['painpoint', 'workaround', 'feature_wish', 'product', 'mechanism', 'intervention', 'evidence_paper', 'source_sentiment', 'insight', 'concept', 'temporal_gap'] },
};

const NODE_META = {
  post:             { label: 'Posts',           icon: 'file-text' },
  comment:          { label: 'Comments',        icon: 'message-circle' },
  user:             { label: 'Users',           icon: 'user' },
  subreddit:        { label: 'Subs',            icon: 'hash' },
  source:           { label: 'Sources',         icon: 'database' },
  painpoint:        { label: 'Painpoints',      icon: 'zap-off' },
  workaround:       { label: 'Workarounds',     icon: 'wrench' },
  feature_wish:     { label: 'Feature wishes',  icon: 'sparkles' },
  product:          { label: 'Products',        icon: 'package' },
  mechanism:        { label: 'Mechanisms',      icon: 'atom' },
  intervention:     { label: 'Interventions',   icon: 'flask-conical' },
  evidence_paper:   { label: 'Evidence papers', icon: 'book-marked' },
  source_sentiment: { label: 'Sentiment cards', icon: 'smile' },
  insight:          { label: 'Insights',        icon: 'lightbulb' },
  concept:          { label: 'Concepts',        icon: 'rocket' },
  temporal_gap:     { label: 'Temporal gaps',   icon: 'trending-up' },
};

async function mountCoverage(host, topic) {
  if (!host) return;
  let data = null;
  try {
    data = await api.topicGraphSummary(topic);
  } catch (e) {
    host.innerHTML = `<div class="intent-coverage-loading">coverage unavailable</div>`;
    return;
  }
  if (!data) { host.innerHTML = ''; return; }
  const nodes   = Array.isArray(data.nodes)   ? data.nodes   : [];
  const edges   = Array.isArray(data.edges)   ? data.edges   : [];
  const sources = Array.isArray(data.sources) ? data.sources : [];
  if (nodes.length === 0 && edges.length === 0 && sources.length === 0) {
    host.innerHTML = `<div class="intent-coverage-loading">no gap-map data yet — run collect</div>`;
    return;
  }

  const nodeMap = Object.fromEntries(nodes.map(r => [r.kind, r.c]));
  const edgeMap = Object.fromEntries(edges.map(r => [r.kind, r.c]));

  const pill = (kind, count) => {
    const meta = NODE_META[kind] || { label: kind, icon: 'circle' };
    const dim = count === 0 ? ' is-empty' : '';
    return `
      <span class="intent-cov-pill${dim}" title="${escape(meta.label)}: ${count}">
        <i data-lucide="${escape(meta.icon)}"></i>
        <b>${count.toLocaleString()}</b>
        <span>${escape(meta.label)}</span>
      </span>
    `;
  };

  const renderGroup = (group) => {
    const pills = group.kinds
      .map(k => pill(k, nodeMap[k] || 0))
      .filter(Boolean)
      .join('');
    return `
      <div class="intent-cov-group">
        <div class="intent-cov-group-title">${escape(group.label)}</div>
        <div class="intent-cov-pills">${pills}</div>
      </div>
    `;
  };

  // Source-type row (posts broken down by where they came from)
  const srcRow = sources.length
    ? `<div class="intent-cov-sources">
         ${sources.map(s => `<span class="intent-cov-src" title="${escape(s.source_type)}: ${s.c}">
           <span class="intent-cov-src-name">${escape(s.source_type)}</span>
           <span class="intent-cov-src-n">${Number(s.c).toLocaleString()}</span>
         </span>`).join('')}
       </div>`
    : '';

  // Edge summary — only show kinds with >0, kept compact
  const edgeRow = edges.filter(e => e.c > 0).length
    ? `<div class="intent-cov-edges">
         <span class="intent-cov-edges-label">Relations:</span>
         ${edges.filter(e => e.c > 0).map(e =>
           `<span class="intent-cov-edge" title="${escape(e.kind)}: ${e.c}">${escape(e.kind)} <b>${Number(e.c).toLocaleString()}</b></span>`
         ).join('')}
       </div>`
    : '';

  host.innerHTML = `
    <div class="intent-coverage-card">
      <div class="intent-coverage-head">
        <b>Gap Map coverage</b>
        <span class="intent-coverage-sub">what the pipeline has extracted from your corpus</span>
      </div>
      ${renderGroup(NODE_GROUPS.corpus)}
      ${renderGroup(NODE_GROUPS.semantic)}
      ${srcRow}
      ${edgeRow}
    </div>
  `;
  window.refreshIcons?.();
}
