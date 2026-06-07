// App Mode — single source of truth for "product" vs "research" framing.
//
// Research Mode reconfigures the app into a literature workspace: it relabels
// "Topic" → "Project", promotes research surfaces in the nav, and routes the
// front door to Research Home. The mode is a frontend preference (localStorage)
// so switching is instant and needs no backend/rebuild; the Python side can
// read APP_MODE from config later when a backend behaviour needs it.
//
// Usage:
//   import { getAppMode, setAppMode, isResearch, labels } from './labels.js';
//   const L = labels();           // { topic:'project', Topic:'Project', ... }
//   if (isResearch()) { ... }
//
// On change, `setAppMode` stamps <html data-app-mode> (so CSS can branch) and
// fires a window 'appmodechange' event so live screens/nav can re-sync.

const APP_MODE_KEY = 'gapmap.settings.appMode';
const VALID = ['product', 'research'];

export function getAppMode() {
  const m = localStorage.getItem(APP_MODE_KEY);
  return VALID.includes(m) ? m : 'product';
}

export function isResearch() {
  return getAppMode() === 'research';
}

export function setAppMode(mode) {
  if (!VALID.includes(mode)) return getAppMode();
  localStorage.setItem(APP_MODE_KEY, mode);
  applyAppModeToDocument();
  try {
    window.dispatchEvent(new CustomEvent('appmodechange', { detail: { mode } }));
  } catch { /* non-DOM context */ }
  return mode;
}

// Stamp the current mode onto <html data-app-mode="…"> so CSS and nav-sync can
// branch on it. Safe to call repeatedly; called once on boot from main.js.
export function applyAppModeToDocument() {
  try {
    document.documentElement.dataset.appMode = getAppMode();
  } catch { /* no document */ }
}

// Mode-aware vocabulary. One place to relabel so we never scatter ternaries.
export function labels() {
  const research = isResearch();
  return {
    topic:  research ? 'project'  : 'topic',
    topics: research ? 'projects' : 'topics',
    Topic:  research ? 'Project'  : 'Topic',
    Topics: research ? 'Projects' : 'Topics',
    // What the corpus is made of, for copy like "12 papers" vs "120 posts".
    corpusItem:  research ? 'paper'  : 'post',
    corpusItems: research ? 'papers' : 'posts',
  };
}

// Default source set when STARTING a new corpus in each mode. Research mode is
// academic-only (matches research_workspace.js ACADEMIC_SOURCES).
export const RESEARCH_SOURCES = [
  'arxiv', 'pubmed', 'openalex', 'semantic_scholar',
  'crossref', 'europepmc', 'dblp', 'scholar',
];
