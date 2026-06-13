// Tour definitions + first-run trigger. The engine lives in lib/tour.js;
// this module holds the step content and the per-screen mini-tour registry.
//
// Selectors use comma-lists so one step matches whichever element exists
// on the current screen/mode (querySelector returns the first match). Any
// step whose target is absent auto-skips — see lib/tour.js _renderStep.

import { startTour, isTourDone, resetTour } from './tour.js';

export const GETTING_STARTED_ID = 'getting_started';
const PENDING_KEY = 'gapmap.tour.getting_started.pending';

// ── First-run "Getting Started" tour ────────────────────────────────────
function gettingStartedSteps() {
  return [
    {
      title: 'Welcome to Gap Map 👋',
      body: 'In ~30 seconds: Gap Map turns a topic into real-world signal, then '
          + 'helps you read it, synthesize it, and write it up. Here are the 4 things '
          + 'you need to know.',
    },
    {
      selector: '#rh-go, #rh-new, #btn-new-topic, #topics-new, #empty-new-topic, #topics-quick-create',
      title: 'Start with a topic',
      body: 'Name a market, product, problem, or research question here. Gap Map '
          + 'gathers real posts, reviews, papers and web results from many sources '
          + 'into one corpus.',
    },
    {
      selector: '.why-eye-btn, [href="#/help"], #nav-help',
      title: 'Help is always one click away',
      body: 'On any screen, the Help / eye icon explains what the page does, the '
          + 'science behind it, and can walk you through it step by step.',
    },
    {
      selector: '.nextstep-rail',
      title: 'Your next step, always visible',
      body: 'This rail tells you the single best thing to do next based on where '
          + 'you are — so you never have to hunt through every screen.',
    },
    {
      title: "You're set ✅",
      body: 'Explore freely — and replay this tour anytime from Help → “Take the tour”. '
          + 'Happy researching!',
    },
  ];
}

// Call after the onboarding wizard finishes (welcome.js).
export function flagFirstRunTour() {
  try { localStorage.setItem(PENDING_KEY, 'true'); } catch { /* ignore */ }
}

// Called from the router after a home screen renders. Starts the first-run
// tour once (pending flag set AND not already completed).
export function maybeStartFirstRunTour() {
  let pending = false;
  try { pending = localStorage.getItem(PENDING_KEY) === 'true'; } catch { /* ignore */ }
  if (!pending || isTourDone(GETTING_STARTED_ID)) return;
  try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
  // Small delay so the home screen's async slots have painted.
  setTimeout(() => startTour(GETTING_STARTED_ID, gettingStartedSteps()), 350);
}

// Replay entry point (Help hub button).
export function replayGettingStarted() {
  resetTour(GETTING_STARTED_ID);
  startTour(GETTING_STARTED_ID, gettingStartedSteps(), { force: true });
}

// ── Per-screen mini-tours ───────────────────────────────────────────────
// Keyed by the why-explainer slug for the screen. The help popover shows a
// "Show me around" button only when a mini-tour exists for that slug.
const MINI_TOURS = {
  topic: [
    { selector: '.topic-tabs, [role="tablist"], .tab-strip',
      title: 'Everything about this topic',
      body: 'These tabs are the analyses for this topic — insights, sentiment, '
          + 'audience, solutions and more. Each is generated from the corpus.' },
    { selector: '[data-tab="insights"], a[href*="insights"]',
      title: 'Start with Insights',
      body: 'Insights extracts the real pains, feature wishes and complaints from '
          + 'the corpus, with citations you can click through.' },
    { selector: '.why-eye-btn',
      title: 'Why this tab?',
      body: 'Open the eye icon on any tab to see what it does and the science behind it.' },
  ],
  collect: [
    { selector: '#sources-grid, .sources-grid, .cm-start-toggle',
      title: 'Where the data comes from',
      body: 'A collect pulls from many sources in parallel. Toggle the full sweep '
          + 'for depth, or leave it off for a fast quick pass.' },
    { selector: '.phase-bar, #phase-bar-count',
      title: 'Watch it work',
      body: 'You can watch each source flip from pending → done live. One flaky '
          + 'source never blocks the rest.' },
  ],
  sentiment: [
    { selector: '.sentiment-source, .src-card, [data-source]',
      title: 'Sentiment per source',
      body: 'See how people feel about this topic on each platform — hopeful, '
          + 'frustrated, or neutral — grouped by where they posted.' },
  ],
};

export function hasMiniTour(slug) {
  return Array.isArray(MINI_TOURS[slug]) && MINI_TOURS[slug].length > 0;
}

export function startMiniTour(slug) {
  const steps = MINI_TOURS[slug];
  if (!Array.isArray(steps) || !steps.length) return;
  // Mini-tours are replayable on demand — always force.
  startTour(`screen.${slug}`, steps, { force: true });
}

export const TOUR_REGISTRY = MINI_TOURS;
