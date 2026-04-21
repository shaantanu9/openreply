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
    </section>
  `;
  window.refreshIcons?.();

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
