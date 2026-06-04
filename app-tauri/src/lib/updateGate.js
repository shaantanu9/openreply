// Force-update gate.
//
// On boot (and on a slow timer) the desktop asks the licence server's
// /v1/health for `min_app_version` / `latest_app_version` / `app_download_url`
// (all env-driven on the server, so a release is made mandatory by flipping a
// Vercel env var — no app redeploy). Rust `check_app_version` compares those to
// the built CARGO_PKG_VERSION and returns:
//   update_required  → installed < min_app_version → HARD BLOCK (this overlay,
//                      no dismiss) with a Download button.
//   update_available → installed < latest_app_version → soft, dismissible toast.
//
// Fail-safe: the Rust side returns ok:false on any network/parse error and
// NEVER sets update_required, so an unreachable server can't lock a good build.

import { api } from '../api.js';

const DISMISS_KEY = 'gapmap.update.softDismissed';   // value = the version we nudged about
let _blockEl = null;
let _wired = false;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

async function resolveBase() {
  try {
    const r = await api.licenseDefaultApiBase();
    const b = String(r?.api_base || '').trim().replace(/\/+$/, '');
    if (b) return b;
  } catch {}
  return 'https://gapmap.myind.ai';
}

function showBlockingUpdate(info) {
  if (_blockEl) return;                 // already blocking
  const dl = info.download_url || 'https://gapmap.myind.ai/download';
  const el = document.createElement('div');
  el.className = 'update-gate-backdrop';
  el.innerHTML = `
    <div class="update-gate" role="dialog" aria-modal="true" aria-label="Update required">
      <div class="update-gate-badge">⏫ Update required</div>
      <h2>A new version of Gap Map is required</h2>
      <p>You're on <b>v${esc(info.current || '?')}</b>${info.min ? ` · minimum supported is <b>v${esc(info.min)}</b>` : ''}. Download the latest build to keep using the app — your local data is untouched.</p>
      <div class="update-gate-actions">
        <button type="button" class="btn btn-primary" id="update-gate-download">Download the update ↗</button>
        <button type="button" class="btn btn-ghost btn-bordered" id="update-gate-recheck">I've updated — re-check</button>
      </div>
      <p class="update-gate-foot">Installed it already? Quit this old copy and open the new one, then re-check.</p>
    </div>`;
  document.body.appendChild(el);
  _blockEl = el;
  document.body.setAttribute('data-update-gate', 'blocked');
  el.querySelector('#update-gate-download').onclick = () => api.openUrl(dl).catch(() => {});
  el.querySelector('#update-gate-recheck').onclick = () => { clearBlocking(); checkAndGateUpdate(); };
}

function clearBlocking() {
  if (_blockEl) { _blockEl.remove(); _blockEl = null; }
  document.body.removeAttribute('data-update-gate');
}

function showSoftUpdate(info) {
  // Don't re-nudge for a version the user already dismissed.
  try { if (localStorage.getItem(DISMISS_KEY) === info.latest) return; } catch {}
  if (document.getElementById('update-soft-banner')) return;
  const dl = info.download_url || 'https://gapmap.myind.ai/download';
  const el = document.createElement('div');
  el.id = 'update-soft-banner';
  el.className = 'update-soft-banner';
  el.innerHTML = `
    <span>⬆️ <b>v${esc(info.latest)}</b> is available (you're on v${esc(info.current)}).</span>
    <button type="button" class="btn btn-primary btn-sm" id="update-soft-get">Update</button>
    <button type="button" class="update-soft-x" title="Later">✕</button>`;
  document.body.appendChild(el);
  el.querySelector('#update-soft-get').onclick = () => api.openUrl(dl).catch(() => {});
  el.querySelector('.update-soft-x').onclick = () => {
    try { localStorage.setItem(DISMISS_KEY, info.latest); } catch {}
    el.remove();
  };
}

/**
 * Check the server version gate and act on it. Safe to call repeatedly.
 * @returns {Promise<boolean>} true if the app is hard-blocked (update required).
 */
export async function checkAndGateUpdate() {
  let info;
  try {
    const base = await resolveBase();
    info = await api.checkAppVersion(base);
  } catch {
    return false;   // never block on a failed check
  }
  if (!info || info.ok === false) return false;
  if (info.update_required) { showBlockingUpdate(info); return true; }
  clearBlocking();                       // a re-check after updating clears it
  if (info.update_available && info.latest) showSoftUpdate(info);
  return false;
}

/**
 * Wire the gate: check on boot, and re-check every 6h for long-running sessions
 * (so a mid-session mandatory release locks the app without a restart).
 * Idempotent.
 */
export function wireUpdateGate() {
  if (_wired) return;
  _wired = true;
  checkAndGateUpdate();
  setInterval(() => { checkAndGateUpdate(); }, 6 * 60 * 60 * 1000);
}
