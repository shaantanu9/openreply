// "Next step" guidance rail. Renders a single, dismissible banner with the
// best next action for the user's current state — so a 70-screen app always
// has one obvious thing to do next. Mounted by the router after each render
// (main.js) on home + topic screens.
//
// Design: lib/nextStep.js in 2026-06-08-in-app-guidance-design.md.

import { api } from '../api.js';
import { isTourDone } from './tour.js';
import { GETTING_STARTED_ID, replayGettingStarted } from './tours.js';

const DISMISS_PREFIX = 'gapmap.nextstep.dismiss.';

function _dismissed(id) {
  try { return localStorage.getItem(DISMISS_PREFIX + id) === 'true'; }
  catch { return false; }
}
function _dismiss(id) {
  try { localStorage.setItem(DISMISS_PREFIX + id, 'true'); } catch { /* ignore */ }
}

function _openNewTopic() {
  const rh = document.querySelector('#rh-new');
  if (rh) { rh.focus(); return; }
  if (typeof window.gapmapOpenNewTopic === 'function') { window.gapmapOpenNewTopic(); return; }
  location.hash = '#/collect';
}

// Decide the single next step for the current route + state. Returns a step
// object or null. Each step: { id, icon, title, body, ctaLabel, run() }.
async function _computeStep(hash) {
  const isHome = hash === '' || hash === '/' || hash.startsWith('/research-home');
  if (isHome) {
    let topics = [];
    try { topics = await api.listTopics(); } catch { topics = []; }
    const n = Array.isArray(topics) ? topics.length : (topics?.topics?.length || 0);
    if (n === 0) {
      return {
        id: 'first-topic', icon: '🔍',
        title: 'Research your first topic',
        body: 'Name a market, product, problem, or research question — Gap Map gathers the real signal for you.',
        ctaLabel: 'Start',
        run: _openNewTopic,
      };
    }
    if (!isTourDone(GETTING_STARTED_ID)) {
      return {
        id: 'take-tour', icon: '🧭',
        title: 'New here? Take the 30-second tour',
        body: 'A quick walkthrough of how Gap Map turns a topic into insight, synthesis, and a write-up.',
        ctaLabel: 'Start tour',
        run: replayGettingStarted,
      };
    }
    return null;
  }

  const topicMatch = hash.match(/^\/topic\/([^/?]+)/);
  if (topicMatch) {
    const slug = decodeURIComponent(topicMatch[1]);
    let b = {};
    try { b = await api.topicCountsBundle(slug) || {}; } catch { b = {}; }
    const posts = Number(b.posts || 0);
    const insights = Number(b.painpoints || 0) + Number(b.features || 0)
                   + Number(b.workarounds || 0) + Number(b.complaints || 0);
    if (posts > 0 && insights === 0) {
      return {
        id: `insights:${slug}`, icon: '✨',
        title: 'Your corpus is ready — extract the insights',
        body: 'Run Insights to pull the real pains, feature wishes and complaints from the corpus, each with citations.',
        ctaLabel: 'Open Insights',
        run: () => { location.hash = `#/topic/${encodeURIComponent(slug)}`; },
      };
    }
    return null;
  }
  return null;
}

function _renderRail(step) {
  // Remove any existing rail first (router re-mounts on every navigation).
  document.querySelectorAll('.nextstep-rail').forEach((el) => el.remove());
  if (!step || _dismissed(step.id)) return;

  const host = document.querySelector('#main-content .screen')
            || document.querySelector('#main-content');
  if (!host) return;

  const rail = document.createElement('div');
  rail.className = 'nextstep-rail';
  rail.innerHTML = `
    <span class="nextstep-icon">${step.icon || '➡️'}</span>
    <div class="nextstep-text">
      <b></b><span></span>
    </div>
    <button class="btn btn-primary btn-sm nextstep-cta" type="button"></button>
    <button class="nextstep-x" type="button" title="Dismiss" aria-label="Dismiss">✕</button>
  `;
  rail.querySelector('.nextstep-text b').textContent = step.title;
  rail.querySelector('.nextstep-text span').textContent = step.body;
  const cta = rail.querySelector('.nextstep-cta');
  cta.textContent = step.ctaLabel || 'Go';
  cta.addEventListener('click', () => { try { step.run(); } catch { /* ignore */ } });
  rail.querySelector('.nextstep-x').addEventListener('click', () => {
    _dismiss(step.id); rail.remove();
  });

  host.insertBefore(rail, host.firstChild);
}

// Public: called by the router after a screen renders.
export async function mountNextStepRail(main, hash) {
  try {
    const step = await _computeStep(hash);
    _renderRail(step);
  } catch (e) {
    console.warn('[nextStep] skipped:', e);
  }
}
