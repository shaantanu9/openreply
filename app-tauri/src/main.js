// OpenReply — SPA router for the Tauri app.
// UI-only port of the prototype (functions wired later). Views live in or/views.js,
// the sidebar/theme/helpers in or/shell.js.
import { VIEWS } from './or/views.js';
import { mountShell, drawIcons } from './or/shell.js';

function currentKey() {
  const h = (location.hash || '').replace(/^#\/?/, '').split(/[?#]/)[0];
  return h || 'agents';
}

function render() {
  const reqKey = currentKey();
  const key = VIEWS[reqKey] ? reqKey : 'agents';
  const v = VIEWS[key];
  const view = document.getElementById('main-content');
  view.className = v.main || 'w-full max-w-6xl flex-1 px-8 py-7';
  view.innerHTML = v.html;
  mountShell(key, !!v.full);
  try { if (v.init) v.init(); } catch (e) { console.error('[view init]', key, e); }
  drawIcons();
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);
if (document.readyState !== 'loading') render();
