// Per-page first-open tutorials + replay coordinator.
//
// On the first open of any page (a top-level route OR a topic-detail tab) this
// auto-runs a short spotlight tour demoing the page. Coverage is universal:
//   1. a hand-authored multi-step tour (PAGE_TOURS) if one exists, else
//   2. an auto-built tour from the backend page-explanation
//      (api.pageExplanationGet — the same content the eye-icon popover shows),
//      else
//   3. nothing (no crash; the "Tour this page" menu item reports it).
//
// Page identity ("key"):
//   - top-level routes  → the screen's why-explainer slug (read from the
//     mounted `.why-eye-btn`, e.g. "papers", "settings"); see
//     main.js::explainerSlugForHash which puts it there.
//   - topic-detail tabs → "tab:<dataTab>" (e.g. "tab:papers"), since every tab
//     of /topic/<t> shares the single "topic" eye-slug.
//
// Tour ids live in the "page.<key>" namespace, so the engine's done-flag is
// localStorage['gapmap.tour.page.<key>.done']. All functions are best-effort
// and never throw into their callers (route() / switchTab()).

import { api } from '../api.js';
import { startTour, isTourDone, isTourActive, resetTour } from './tour.js';

const AUTO_PREF_KEY = 'gapmap.pref.auto_tours';
const ONBOARDING_KEY = 'gapmap.onboarding.completed';
const GS_PENDING_KEY = 'gapmap.tour.getting_started.pending';
const SETTLE_MS = 500;   // let the screen's async slots paint before spotlighting

// Map a topic tab name → the explanation slug used for the auto fallback.
// Most tab names double as their own slug; a few need redirecting. Tabs absent
// here fall back to the tab name (which may have no explanation → no auto-tour).
const TAB_SLUG = {
  home: 'topic', map: 'map', report: 'report', sentiment: 'sentiment',
  trends: 'trends', sources: 'sources', posts: 'posts', evidence: 'evidence',
  solutions: 'solutions', papers: 'papers', academic: 'academic',
  research: 'research', chat: 'chat', audience: 'audience', concepts: 'concepts',
  bets: 'hypotheses', insights: 'insights',
};

// ── Hand-authored core tours (the ~10 most-used pages) ──────────────────────
// Bodies are plain text (escaped by the engine). Selectors are comma-lists so
// the first present element wins; a step whose target is absent auto-skips, so
// these degrade gracefully across modes/empty states.
export const PAGE_TOURS = {
  'tab:home': [
    { title: 'Topic overview',
      body: 'This is the home of a topic — a live summary of everything Gap Map gathered: the dominant intents, coverage gaps, and where to dig next.' },
    { selector: '.topic-tabs, [role="tablist"], .tab-strip',
      title: 'Every analysis is a tab',
      body: 'Each tab is a different lens on the same corpus — Map, Sentiment, Papers, Solutions and more. They all draw from the posts you collected.' },
    { selector: '.nextstep-rail',
      title: 'Your next best step',
      body: 'This rail always points at the single highest-value thing to do next for this topic.' },
    { selector: '.why-eye-btn',
      title: 'Replay this anytime',
      body: 'Press ? on any page for a menu with “Tour this page”, or click the eye icon for what the page does.' },
  ],
  'tab:map': [
    { title: 'Knowledge graph',
      body: 'The Map clusters the topic into concepts, pains, and solutions and draws the relationships between them — a bird’s-eye view of the whole corpus.' },
    { selector: '#map-canvas, canvas, .map-wrap',
      title: 'Explore the graph',
      body: 'Drag to pan, scroll to zoom, click a node to inspect its evidence. Denser clusters = more discussed themes.' },
    { selector: '[data-map-mode], .map-controls, #map-rebuild',
      title: 'Rebuild & modes',
      body: 'Switch layout modes or rebuild the graph after collecting more data.' },
  ],
  'tab:papers': [
    { title: 'Academic papers',
      body: 'Papers pulls real scholarly work for this topic from arXiv, OpenAlex, Crossref, Semantic Scholar and more — deduped and ranked by citations.' },
    { selector: '#papers-find, [data-action="find-papers"], .papers-toolbar',
      title: 'Find papers',
      body: 'Search the academic sources and commit the results to this topic’s corpus.' },
    { selector: '.paper-row, .paper-card, .papers-list',
      title: 'Read & analyze',
      body: 'Open a paper to fetch its full text, then analyze it into a grounded summary you can cite.' },
  ],
  'tab:academic': [
    { title: 'Academic Mode',
      body: 'Turns this topic into a grounded, cited research brief through a multi-agent pipeline: research → synthesize → peer-review panel → integrity & citation gates.' },
    { selector: '#acad-run, .academic-controls',
      title: 'Run a brief',
      body: 'Pick a governance level (L1 suggest / L2 gated / L3 auto) and run. The timeline shows each stage live.' },
    { selector: '.academic-verdicts, .academic-gate',
      title: 'Verdict chips',
      body: 'After finalize you’ll see the editorial decision, integrity verdict, citation check, and a hash-chained provenance passport.' },
  ],
  'tab:research': [
    { title: 'Research spine',
      body: 'The research workflow in order: Gather → Read → Synthesize → Write. Each stage hands grounded artifacts to the next.' },
    { selector: '.research-stage, .stage-spine, [data-stage]',
      title: 'Work the stages',
      body: 'Move through the stages as the corpus matures — earlier stages stay available to refresh.' },
  ],
  settings: [
    { title: 'Settings',
      body: 'Connect LLM providers, manage your licence, tune behaviour, and re-run onboarding or page tours from here.' },
    { selector: '#card-llm, [id^="card-"]',
      title: 'Connect an LLM',
      body: 'Add an API key (or point at local Ollama). Most analyses need a model configured here.' },
    { selector: '#card-onboarding',
      title: 'Tours & help',
      body: 'Toggle auto-tours, replay the welcome wizard, or reset page tours so they show again.' },
  ],
  reports: [
    { title: 'Reports',
      body: 'Generated synthesis reports across your topics — exportable write-ups grounded in the collected evidence.' },
  ],
  chats: [
    { title: 'Chats',
      body: 'Every saved topic-AI conversation in one place. Re-open a thread to keep asking questions grounded in that topic’s corpus.' },
  ],
  collect: [
    { selector: '#sources-grid, .sources-grid, .cm-start-toggle',
      title: 'Where the data comes from',
      body: 'A collect pulls from many sources in parallel. Toggle the full sweep for depth, or leave it off for a fast quick pass.' },
    { selector: '.phase-bar, #phase-bar-count',
      title: 'Watch it work',
      body: 'Each source flips pending → done live. One flaky source never blocks the rest.' },
  ],
};

// ── Page-key resolution ─────────────────────────────────────────────────────

export function currentPageKey() {
  let h = '';
  try { h = (location.hash || '').replace(/^#/, '') || '/'; } catch { h = '/'; }
  if (h.startsWith('/topic/')) {
    let tab = 'home';
    try {
      tab = document.querySelector('.topic-tabs .tab.active, .tab.active[data-tab]')
        ?.dataset?.tab || 'home';
    } catch { /* ignore */ }
    return `tab:${tab}`;
  }
  // Top-level: read the why-slug the eye button was mounted with.
  try {
    const btn = document.querySelector('.why-eye-btn');
    const m = (btn?.getAttribute('href') || '').match(/#\/why\/([^/?]+)/);
    if (m) return decodeURIComponent(m[1]);
  } catch { /* ignore */ }
  return '';
}

function slugForKey(key) {
  if (!key) return '';
  if (key.startsWith('tab:')) { const t = key.slice(4); return TAB_SLUG[t] || t; }
  return key;
}

// ── Tour resolution: hand-authored → explanation-built → null ───────────────

export async function resolvePageTour(key) {
  if (!key) return null;
  const authored = PAGE_TOURS[key];
  if (Array.isArray(authored) && authored.length) return authored;

  let exp = null;
  try { exp = await api.pageExplanationGet(slugForKey(key)); } catch { exp = null; }
  const title = exp?.title;
  const simple = exp?.simple || exp?.purpose;
  if (!title && !simple) return null;

  const steps = [{ title: title || 'About this page', body: simple || '' }];
  const dos = Array.isArray(exp?.do) ? exp.do.filter(Boolean) : [];
  if (dos.length) {
    steps.push({ title: 'What you can do here', body: dos.join('  ·  ') });
  }
  return steps;
}

// ── Auto-run on first open ──────────────────────────────────────────────────

export function autoToursEnabled() {
  try { return localStorage.getItem(AUTO_PREF_KEY) !== 'false'; } catch { return true; }
}

function onboardingComplete() {
  try { return localStorage.getItem(ONBOARDING_KEY) === 'true'; } catch { return false; }
}

export async function maybeAutoRunPageTour(keyArg) {
  try {
    if (!autoToursEnabled()) return;
    if (!onboardingComplete()) return;            // welcome flow owns the screen
    let h = '';
    try { h = (location.hash || '').replace(/^#/, ''); } catch { /* ignore */ }
    if (/^\/(welcome|activate|license)/.test(h)) return;

    const key = keyArg || currentPageKey();
    if (!key) return;
    // Home is covered by the getting-started tour — never double up there.
    if (key === 'home') return;
    let gsPending = false;
    try { gsPending = localStorage.getItem(GS_PENDING_KEY) === 'true'; } catch { /* ignore */ }
    if (gsPending) return;                          // let first-run tour go first

    const tourId = `page.${key}`;
    if (isTourDone(tourId) || isTourActive()) return;

    const steps = await resolvePageTour(key);
    if (!steps || !steps.length) return;            // leave unmarked: a future authored tour can still run

    // Settle, then re-verify nothing changed before spotlighting.
    setTimeout(() => {
      try {
        if (isTourActive() || isTourDone(tourId)) return;
        if (currentPageKey() !== key) return;       // user navigated away
        startTour(tourId, steps, {});
      } catch { /* best-effort */ }
    }, SETTLE_MS);
  } catch { /* best-effort */ }
}

// ── Explicit replay (the "?" menu item + eye-icon "Show me around") ─────────

export async function runPageTour(key, { force = true } = {}) {
  const k = key || currentPageKey();
  const steps = await resolvePageTour(k);
  if (!steps || !steps.length) return false;
  if (force) { try { resetTour(`page.${k}`); } catch { /* ignore */ } }
  startTour(`page.${k}`, steps, { force });
  return true;
}

// Clear every per-page "seen" flag so first-open tours show again.
export function resetAllPageTours() {
  try {
    const kill = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('gapmap.tour.page.')) kill.push(k);
    }
    kill.forEach((k) => localStorage.removeItem(k));
    return kill.length;
  } catch { return 0; }
}
