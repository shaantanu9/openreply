// Simple Mode — collapse the ~30-item sidebar to ~8 plain essentials so new
// and non-technical users aren't overwhelmed. Everything else moves under an
// "Advanced tools" expander. A toggle (default ON) lets power users switch to
// the full nav. Design: 2026-06-08-in-app-guidance-design.md (Lever 2).
//
// Implementation note: we don't rewrite the static nav HTML (risky — active
// states, counts, research-mode gating are all wired to it). Instead we tag
// advanced links by route at boot and hide them with CSS in Simple Mode.

const KEY = 'gapmap.simpleMode';
const ADV_OPEN_KEY = 'gapmap.simpleMode.advOpen';

// Routes that stay visible in Simple Mode = the core flow. Everything else
// is "advanced" and hidden behind the expander.
const ESSENTIAL_ROUTES = new Set([
  '/', '/research-home', '/topics', '/find', '/library',
  '/audience', '/reports', '/help', '/settings',
]);

export function isSimpleMode() {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? true : v === 'true';   // default ON
  } catch { return true; }
}

function _advOpen() {
  try { return localStorage.getItem(ADV_OPEN_KEY) === 'true'; } catch { return false; }
}

function _apply() {
  const simple = isSimpleMode();
  document.body.classList.toggle('simple-mode', simple);
  document.body.classList.toggle('adv-open', simple && _advOpen());
}

export function setSimpleMode(on) {
  try { localStorage.setItem(KEY, on ? 'true' : 'false'); } catch { /* ignore */ }
  if (!on) { try { localStorage.removeItem(ADV_OPEN_KEY); } catch { /* ignore */ } }
  _apply();
  _syncToggleLabel();
}

function _toggleAdvanced() {
  const next = !_advOpen();
  try { localStorage.setItem(ADV_OPEN_KEY, next ? 'true' : 'false'); } catch { /* ignore */ }
  document.body.classList.toggle('adv-open', next);
  const btn = document.getElementById('nav-advanced-toggle');
  if (btn) {
    btn.setAttribute('aria-expanded', next ? 'true' : 'false');
    btn.querySelector('.nav-adv-label')?.replaceChildren(
      document.createTextNode(next ? 'Hide advanced tools' : 'Advanced tools'),
    );
  }
  if (window.lucide?.createIcons) { try { window.lucide.createIcons(); } catch { /* ignore */ } }
}

// Tag advanced nav links + the section labels that contain only advanced items.
function _tagNav() {
  const links = document.querySelectorAll('aside .nav a[data-route]');
  links.forEach((a) => {
    const route = a.getAttribute('data-route');
    if (route && !ESSENTIAL_ROUTES.has(route)) a.dataset.tier = 'advanced';
  });
  // External links (Help & docs) — leave visible (they're in Account).
  // A section label whose following <nav> has no essential link is advanced.
  document.querySelectorAll('aside .nav-section-label').forEach((label) => {
    let el = label.nextElementSibling;
    while (el && !el.classList.contains('nav')) el = el.nextElementSibling;
    if (!el) return;
    const hasEssential = [...el.querySelectorAll('a[data-route]')].some(
      (a) => ESSENTIAL_ROUTES.has(a.getAttribute('data-route')),
    );
    const hasExternal = [...el.querySelectorAll('a')].some((a) => !a.dataset.route);
    if (!hasEssential && !hasExternal && el.querySelector('a')) {
      label.dataset.tier = 'advanced';
    }
  });
}

function _injectAdvancedToggle() {
  if (document.getElementById('nav-advanced-toggle')) return;
  const workspace = document.getElementById('nav-workspace');
  if (!workspace) return;
  const btn = document.createElement('button');
  btn.id = 'nav-advanced-toggle';
  btn.type = 'button';
  btn.className = 'nav-advanced-toggle';
  btn.setAttribute('aria-expanded', _advOpen() ? 'true' : 'false');
  btn.innerHTML = `<span class="nav-ic"><i data-lucide="settings-2"></i></span>`
    + `<span class="nav-adv-label">${_advOpen() ? 'Hide advanced tools' : 'Advanced tools'}</span>`;
  btn.addEventListener('click', _toggleAdvanced);
  // Place it right after the first (essentials) nav block.
  workspace.parentNode.insertBefore(btn, workspace.nextSibling);
}

function _injectSimpleToggle() {
  if (document.getElementById('simple-mode-toggle')) return;
  // Put it in the Account nav (last .nav in the sidebar).
  const navs = document.querySelectorAll('aside .nav');
  const account = navs[navs.length - 1];
  if (!account) return;
  const a = document.createElement('a');
  a.id = 'simple-mode-toggle';
  a.href = '#';
  a.className = 'simple-mode-toggle';
  a.title = 'Simple Mode hides advanced tools so the app is easier to learn. Turn off to see everything.';
  a.innerHTML = `<span class="nav-ic"><i data-lucide="wand-2"></i></span><span class="smt-label"></span>`;
  a.addEventListener('click', (e) => { e.preventDefault(); setSimpleMode(!isSimpleMode()); });
  account.insertBefore(a, account.firstChild);
}

function _syncToggleLabel() {
  const lbl = document.querySelector('#simple-mode-toggle .smt-label');
  if (lbl) lbl.textContent = isSimpleMode() ? 'Simple mode: On' : 'Simple mode: Off';
  if (window.lucide?.createIcons) { try { window.lucide.createIcons(); } catch { /* ignore */ } }
}

export function initSimpleMode() {
  _tagNav();
  _injectAdvancedToggle();
  _injectSimpleToggle();
  _apply();
  _syncToggleLabel();
}
