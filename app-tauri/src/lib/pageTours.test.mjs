// Unit tests for the per-page tour coordinator. Pure logic only — we stub the
// browser globals (localStorage / location / document) and mock
// api.pageExplanationGet, so no DOM/Tauri is needed.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

// ── minimal browser-global stubs ────────────────────────────────────────────
function makeLocalStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    _map: map,
  };
}
// Fake document whose querySelector returns configured stubs per selector.
function makeDocument({ activeTab = null, eyeHref = null } = {}) {
  return {
    querySelector(sel) {
      if (sel.includes('.tab.active')) {
        return activeTab ? { dataset: { tab: activeTab } } : null;
      }
      if (sel.includes('.why-eye-btn')) {
        return eyeHref ? { getAttribute: () => eyeHref } : null;
      }
      return null;
    },
  };
}

globalThis.localStorage = makeLocalStorage();
globalThis.location = { hash: '#/' };
globalThis.document = makeDocument();

const mod = await import('./pageTours.js');
const { api } = await import('../api.js');

beforeEach(() => {
  globalThis.localStorage = makeLocalStorage();
  globalThis.location = { hash: '#/' };
  globalThis.document = makeDocument();
});

// ── currentPageKey ──────────────────────────────────────────────────────────
test('currentPageKey: topic page → tab:<activeTab>', () => {
  globalThis.location = { hash: '#/topic/note-apps' };
  globalThis.document = makeDocument({ activeTab: 'papers' });
  assert.equal(mod.currentPageKey(), 'tab:papers');
});

test('currentPageKey: topic page with no active tab defaults to tab:home', () => {
  globalThis.location = { hash: '#/topic/note-apps' };
  globalThis.document = makeDocument({ activeTab: null });
  assert.equal(mod.currentPageKey(), 'tab:home');
});

test('currentPageKey: top-level page → eye-button slug', () => {
  globalThis.location = { hash: '#/settings' };
  globalThis.document = makeDocument({ eyeHref: '#/why/settings' });
  assert.equal(mod.currentPageKey(), 'settings');
});

test('currentPageKey: top-level page with no eye button → empty string', () => {
  globalThis.location = { hash: '#/something' };
  globalThis.document = makeDocument({});
  assert.equal(mod.currentPageKey(), '');
});

// ── resolvePageTour precedence ──────────────────────────────────────────────
test('resolvePageTour: hand-authored tour wins', async () => {
  const steps = await mod.resolvePageTour('tab:papers');
  assert.ok(Array.isArray(steps) && steps.length >= 1);
  assert.equal(steps, mod.PAGE_TOURS['tab:papers']);   // same reference, not a built tour
});

test('resolvePageTour: falls back to a built tour from the page explanation', async () => {
  const orig = api.pageExplanationGet;
  api.pageExplanationGet = async () => ({ title: 'Activity', simple: 'What happened recently.', do: ['Scan runs', 'Open a topic'] });
  try {
    const steps = await mod.resolvePageTour('activity');
    assert.equal(steps.length, 2);                       // intro + "what you can do"
    assert.equal(steps[0].title, 'Activity');
    assert.match(steps[1].body, /Scan runs/);
  } finally { api.pageExplanationGet = orig; }
});

test('resolvePageTour: empty explanation → null', async () => {
  const orig = api.pageExplanationGet;
  api.pageExplanationGet = async () => ({});
  try {
    assert.equal(await mod.resolvePageTour('nope'), null);
  } finally { api.pageExplanationGet = orig; }
});

test('resolvePageTour: explanation throws → null (degrades, never throws)', async () => {
  const orig = api.pageExplanationGet;
  api.pageExplanationGet = async () => { throw new Error('offline'); };
  try {
    assert.equal(await mod.resolvePageTour('nope'), null);
  } finally { api.pageExplanationGet = orig; }
});

// ── autoToursEnabled ────────────────────────────────────────────────────────
test('autoToursEnabled: default on; only "false" disables', () => {
  assert.equal(mod.autoToursEnabled(), true);
  globalThis.localStorage.setItem('gapmap.pref.auto_tours', 'false');
  assert.equal(mod.autoToursEnabled(), false);
  globalThis.localStorage.setItem('gapmap.pref.auto_tours', 'true');
  assert.equal(mod.autoToursEnabled(), true);
});

// ── maybeAutoRunPageTour guards (negative: never starts a tour) ──────────────
test('maybeAutoRunPageTour: no-throw + does not synchronously start when disabled', async () => {
  globalThis.localStorage.setItem('gapmap.pref.auto_tours', 'false');
  globalThis.localStorage.setItem('gapmap.onboarding.completed', 'true');
  const { isTourActive } = await import('./tour.js');
  await mod.maybeAutoRunPageTour('tab:papers');
  assert.equal(isTourActive(), false);
});

test('maybeAutoRunPageTour: skipped when onboarding incomplete', async () => {
  // onboarding flag absent → guard returns before scheduling
  const { isTourActive } = await import('./tour.js');
  await mod.maybeAutoRunPageTour('tab:papers');
  assert.equal(isTourActive(), false);
});

test('maybeAutoRunPageTour: skipped when already seen (done flag)', async () => {
  globalThis.localStorage.setItem('gapmap.onboarding.completed', 'true');
  globalThis.localStorage.setItem('gapmap.tour.page.tab:papers.done', 'true');
  const { isTourActive } = await import('./tour.js');
  await mod.maybeAutoRunPageTour('tab:papers');
  assert.equal(isTourActive(), false);
});

// ── resetAllPageTours ───────────────────────────────────────────────────────
test('resetAllPageTours: removes only page.* tour flags', () => {
  const ls = globalThis.localStorage;
  ls.setItem('gapmap.tour.page.tab:papers.done', 'true');
  ls.setItem('gapmap.tour.page.settings.done', 'true');
  ls.setItem('gapmap.tour.getting_started.done', 'true');   // must survive
  ls.setItem('gapmap.pref.dark_mode', 'true');              // must survive
  const n = mod.resetAllPageTours();
  assert.equal(n, 2);
  assert.equal(ls.getItem('gapmap.tour.page.tab:papers.done'), null);
  assert.equal(ls.getItem('gapmap.tour.getting_started.done'), 'true');
  assert.equal(ls.getItem('gapmap.pref.dark_mode'), 'true');
});
