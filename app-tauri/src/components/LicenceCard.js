// Settings → Licence & activation card.
//
// Until now the only place to enter a licence key was the onboarding flow
// (welcome.js). The MCP activation gate and the onboarding copy both pointed
// users at "Settings → Licence" / "#/activate", but neither existed. This card
// is that destination: it shows the current licence status and lets the user
// activate a key, re-check/renew it, or sign the licence out — all after
// onboarding, from Settings.

import { api, esc } from '../api.js';
import { keyGuideHtml, wireKeyGuide } from './licenceGuide.js';
import { confirmModal } from '../lib/confirmModal.js';

// localStorage keys that main.js reads to decide the activation gate.
const LICENSE_OK_KEY = 'gapmap.license.activated';
const API_BASE_KEY = 'gapmap.license.api_base';
const EMAIL_KEY = 'gapmap.license.email';
const DEFAULT_API_BASE = 'https://gapmap.myind.ai';

// Skeleton inserted synchronously into the settings grid; mountLicenceCard()
// fills it once license_status resolves. `order:15` sits it right after the
// profile card, inside the "Profile & preferences" band.
export const LICENCE_CARD_SKELETON = `
  <div class="settings-card" id="card-licence" style="order:15;grid-column:1/-1">
    <h4>Licence &amp; activation <span style="color:var(--ink-3);font-size:var(--fs-13);font-weight:500">loading…</span></h4>
    <p style="color:var(--ink-3)">Checking this device's licence…</p>
    <div class="skel skel-line" style="width:70%;margin-top:10px"></div>
    <div class="skel skel-line" style="width:55%"></div>
  </div>`;

function normalizeApiBase(value) {
  let v = String(value || '').trim();
  if (!v) return DEFAULT_API_BASE;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  return v.replace(/\/+$/, '');
}

function fmtDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return String(iso);
  }
}

function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (isNaN(d)) return null;
  return Math.ceil((d - Date.now()) / 86400000);
}

// reason_code → badge colour + label. Mirrors commands.rs::compute_activation_reason.
function statusVisual(status) {
  if (status?.activated) {
    const dleft = daysUntil(status.expires_at);
    if (dleft != null && dleft <= 14) {
      return { color: '#B5821E', bg: 'rgba(224,170,60,0.12)', label: dleft <= 0 ? 'Expiring' : `Renews in ${dleft}d` };
    }
    return { color: '#2D7A3E', bg: 'rgba(45,122,62,0.12)', label: 'Active' };
  }
  const code = status?.reason_code || 'not_activated';
  if (code === 'expired') return { color: '#B84747', bg: 'rgba(184,71,71,0.1)', label: 'Expired' };
  if (code === 'revoked') return { color: '#B84747', bg: 'rgba(184,71,71,0.1)', label: 'Revoked' };
  if (code === 'device_mismatch' || code === 'fingerprint_mismatch')
    return { color: '#B5821E', bg: 'rgba(224,170,60,0.12)', label: 'Other device' };
  return { color: '#8A8A8A', bg: 'rgba(138,138,138,0.12)', label: 'Not activated' };
}

function field(label, value, mono = false) {
  return `<div class="kv-row"><b>${esc(label)}</b><span${mono ? ' style="font-variant-numeric:tabular-nums"' : ''}>${esc(value)}</span></div>`;
}

/**
 * Fill (and re-fill on action) the licence card.
 * @param {HTMLElement} root  the settings root (for alive() + querySelector)
 * @param {() => boolean} alive  returns false once the user navigated away
 */
export async function mountLicenceCard(root, alive = () => true) {
  const card = root.querySelector('#card-licence');
  if (!card) return;

  // Resolve the server base the SAME way the Rust layer does: honour the
  // GAPMAP_LICENSE_API_BASE / LICENSE_API_BASE env (dev/local testing) and
  // fall back to the production constant. Without this the card hardcodes
  // prod, so a dev build can't activate against a local server.
  let resolvedDefaultBase = DEFAULT_API_BASE;
  try {
    const r = await api.licenseDefaultApiBase();
    if (r?.api_base) resolvedDefaultBase = normalizeApiBase(r.api_base);
  } catch {
    /* fall back to the prod constant */
  }

  async function refresh() {
    if (!alive()) return;
    let status;
    try {
      status = await api.licenseStatus();
    } catch (e) {
      card.innerHTML = `
        <h4>Licence &amp; activation</h4>
        <p style="color:#B84747">Could not read licence status: ${esc(e?.message || e)}</p>
        <button class="btn btn-ghost btn-sm btn-bordered" id="lic-retry">Retry</button>`;
      const r = card.querySelector('#lic-retry');
      if (r) r.onclick = refresh;
      return;
    }
    if (!alive()) return;
    render(status);
  }

  function render(status) {
    const v = statusVisual(status);
    const activated = !!status?.activated;
    const apiBase = status?.api_base || localStorage.getItem(API_BASE_KEY) || resolvedDefaultBase;
    const email = status?.email || localStorage.getItem(EMAIL_KEY) || '';
    const isTrial = !!status?.is_trial;
    const expiryIso = isTrial ? (status?.trial_ends_at || status?.expires_at) : status?.expires_at;
    const expiry = fmtDate(expiryIso);
    const dleft = daysUntil(expiryIso);
    const verified = fmtDate(status?.last_verified_at);
    const sigShort = (status?.device_signature || '').slice(0, 16);

    const detailRows = activated
      ? [
          email ? field('Account', email) : '',
          status?.license_id ? field('Licence', status.license_id, true) : '',
          expiryIso
            ? field(isTrial ? 'Trial ends' : 'Renews / expires', expiry)
            : field('Term', isTrial ? '—' : 'Perpetual (no expiry)'),
          verified ? field('Last checked', verified) : '',
          sigShort ? field('This device', `${sigShort}…`, true) : '',
        ].join('')
      : status?.reason
        ? `<p style="color:var(--ink-3);font-size:var(--fs-13);margin:6px 0 0">${esc(status.reason)}</p>`
        : '';

    // Prominent expiry / trial banner + renew CTA (id lic-renew-cta wired below).
    let banner = '';
    if (activated) {
      if (dleft != null && dleft <= 0) {
        banner = `<div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:rgba(184,71,71,.1);border:1px solid rgba(184,71,71,.25);color:#B84747;font-size:var(--fs-13)">⚠️ ${isTrial ? 'Your trial ended' : 'Your licence expired'} on ${esc(expiry)}. Renew to keep using Gap Map. <button class="btn btn-sm" id="lic-renew-cta" style="margin-left:6px;background:#B84747;color:#fff">Renew →</button></div>`;
      } else if (isTrial && dleft != null) {
        banner = `<div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:rgba(224,123,60,.1);border:1px solid rgba(224,123,60,.25);color:#B5821E;font-size:var(--fs-13)">⏳ Pro trial — <strong>${dleft} day${dleft === 1 ? '' : 's'} left</strong> (ends ${esc(expiry)}). Upgrade before it ends to keep Pro. <button class="btn btn-sm" id="lic-renew-cta" style="margin-left:6px;background:#E07B3C;color:#fff">Upgrade to Pro →</button></div>`;
      } else if (dleft != null && dleft <= 30) {
        banner = `<div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:rgba(224,170,60,.1);border:1px solid rgba(224,170,60,.25);color:#B5821E;font-size:var(--fs-13)">Licence renews / expires in <strong>${dleft} days</strong> (${esc(expiry)}). <button class="btn btn-sm btn-bordered" id="lic-renew-cta" style="margin-left:6px">Manage / renew →</button></div>`;
      } else if (!expiryIso && !isTrial) {
        banner = `<div style="margin-top:10px;padding:8px 12px;border-radius:10px;background:rgba(45,122,62,.08);color:#2D7A3E;font-size:var(--fs-13)">✓ Perpetual licence — no renewal needed.</div>`;
      }
    }

    // Activation form — shown when not active, OR collapsed under a toggle when
    // active (so an active user can still switch to a different key).
    const formHtml = `
      <div class="settings-profile-fields" id="lic-form" style="max-width:620px;margin-top:14px${activated ? ';display:none' : ''}">
        <label><span>Account email</span><input id="lic2-email" type="email" placeholder="you@company.com" value="${esc(email)}" /></label>
        <label><span>Activation key</span><input id="lic2-key" type="text" placeholder="XXXX-XXXX-XXXX-XXXX" autocapitalize="characters" spellcheck="false" /></label>
        <label><span>Password <span style="color:var(--ink-3);font-weight:400">(optional)</span></span><input id="lic2-password" type="password" placeholder="Only if your account uses one" /></label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px">
          <button class="btn btn-ghost btn-sm btn-bordered" id="lic2-test">Test connection</button>
          <button class="btn btn-primary btn-sm" id="lic2-activate">${activated ? 'Switch key' : 'Activate this device'}</button>
        </div>
        ${keyGuideHtml(apiBase, { compact: true })}
      </div>`;

    card.innerHTML = `
      <h4 style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        Licence &amp; activation
        <span style="font-size:11px;font-weight:600;color:${v.color};background:${v.bg};padding:2px 8px;border-radius:999px">${esc(v.label)}</span>
      </h4>
      ${detailRows}
      ${banner}
      <div id="lic-status" style="margin-top:10px;color:var(--ink-3);font-size:var(--fs-13);min-height:16px"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
        ${activated ? `
          <button class="btn btn-primary btn-sm" id="lic2-renew">Re-check / renew</button>
          <button class="btn btn-ghost btn-sm btn-bordered" id="lic2-portal">Manage / renew on website ↗</button>
          <button class="btn btn-ghost btn-sm" id="lic2-switch">Use a different key</button>
          <button class="btn btn-ghost btn-sm" id="lic2-logout" style="color:#B84747">Sign out of licence</button>
        ` : `
          <button class="btn btn-ghost btn-sm btn-bordered" id="lic2-portal">Open website ↗</button>
        `}
      </div>
      ${formHtml}`;

    wire(status, apiBase);
  }

  function wire(status, apiBase) {
    const statusEl = card.querySelector('#lic-status');
    const setStatus = (msg, kind = 'info') => {
      if (!statusEl) return;
      statusEl.style.color = kind === 'error' ? '#B84747' : kind === 'ok' ? '#2D7A3E' : 'var(--ink-3)';
      statusEl.textContent = msg;
    };
    const portalBase = normalizeApiBase(apiBase);

    const portal = card.querySelector('#lic2-portal');
    if (portal) portal.onclick = () => api.openUrl(`${portalBase}/activate`).catch(() => {});
    const renewCta = card.querySelector('#lic-renew-cta');
    if (renewCta) renewCta.onclick = () => api.openUrl(`${portalBase}/activate`).catch(() => {});
    // "How to get a key" guide — replaces the old bare get-key / redeem links.
    wireKeyGuide(card, portalBase);

    const switchBtn = card.querySelector('#lic2-switch');
    if (switchBtn) switchBtn.onclick = () => {
      const form = card.querySelector('#lic-form');
      if (form) form.style.display = form.style.display === 'none' ? 'grid' : 'none';
    };

    const renew = card.querySelector('#lic2-renew');
    if (renew) renew.onclick = async () => {
      renew.disabled = true;
      const old = renew.textContent;
      renew.textContent = 'Checking…';
      setStatus('Re-checking your licence with the server…');
      try {
        await api.licenseRevalidate();
        setStatus('Licence re-checked.', 'ok');
        await refresh();
      } catch (e) {
        setStatus(`Re-check failed: ${e?.message || e}. You stay on your last known state.`, 'error');
        renew.disabled = false;
        renew.textContent = old;
      }
    };

    const logout = card.querySelector('#lic2-logout');
    if (logout) logout.onclick = async () => {
      // In-app modal — NOT window.confirm(): Tauri routes window.confirm() to the
      // dialog plugin's `confirm` command whose ACL is flaky across builds, which
      // threw "dialog.confirm not allowed" and made Sign-out silently fail.
      const ok = await confirmModal({
        title: 'Sign out of this licence?',
        body: 'This device will lock until you re-activate. Your local data is kept.',
        confirmLabel: 'Sign out',
        danger: true,
      });
      if (!ok) return;
      logout.disabled = true;
      setStatus('Signing licence out…');
      try {
        await api.licenseLogout();
        localStorage.removeItem(LICENSE_OK_KEY);
        setStatus('Licence signed out.', 'ok');
        await refresh();
      } catch (e) {
        setStatus(`Sign out failed: ${e?.message || e}`, 'error');
        logout.disabled = false;
      }
    };

    const test = card.querySelector('#lic2-test');
    if (test) test.onclick = async () => {
      const base = normalizeApiBase(apiBase);   // resolved server, no input
      setStatus('Testing server reachability…');
      try {
        const res = await api.licenseServerCheck(base);
        setStatus(`Server reachable (${res?.status || 200}).`, 'ok');
      } catch (e) {
        setStatus(`Server unreachable: ${e?.message || e}`, 'error');
      }
    };

    const activate = card.querySelector('#lic2-activate');
    if (activate) activate.onclick = async () => {
      const base = normalizeApiBase(apiBase);   // resolved server, no input
      const email = (card.querySelector('#lic2-email')?.value || '').trim();
      // Password is optional: the server authenticates on (email, activation
      // key) and ignores the password value, but its presence check requires a
      // non-empty string — so send a harmless placeholder when left blank.
      const password = (card.querySelector('#lic2-password')?.value || '') || 'desktop-activation';
      const key = (card.querySelector('#lic2-key')?.value || '').trim();
      if (!base || !email || !key) {
        setStatus('Enter your email and activation key.', 'error');
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        setStatus('Enter a valid email address.', 'error');
        return;
      }
      if (key.length < 8) {
        setStatus('That activation key looks too short.', 'error');
        return;
      }
      activate.disabled = true;
      const old = activate.textContent;
      activate.textContent = 'Activating…';
      setStatus('Contacting licence server…');
      try {
        await api.licenseActivate(base, email, password, key, null);
        localStorage.setItem(API_BASE_KEY, base);
        localStorage.setItem(EMAIL_KEY, email);
        localStorage.setItem(LICENSE_OK_KEY, 'true');
        setStatus('Activated on this device 🎉', 'ok');
        // Wire up MCP clients now that the gate is cleared (best-effort).
        try {
          const { bootstrapMcpClients } = await import('../lib/mcp_bootstrap.js');
          bootstrapMcpClients({ tag: 'mcp:settings-activate' }).catch(() => {});
        } catch {}
        await refresh();
      } catch (e) {
        setStatus(humanizeError(e), 'error');
        activate.disabled = false;
        activate.textContent = old;
      }
    };
  }

  await refresh();
}

function humanizeError(e) {
  const raw = String(e?.message || e || '').toLowerCase();
  if (raw.includes('device limit') || raw.includes('max devices')) return 'Device limit reached for this licence. Deactivate another device or upgrade your plan.';
  if (raw.includes('activation key') || raw.includes('invalid key') || raw.includes('not found')) return 'Activation key is invalid or already used. Check the key and retry.';
  if (raw.includes('401') || raw.includes('unauthorized') || raw.includes('password')) return 'Email or password is incorrect.';
  if (raw.includes('network') || raw.includes('fetch') || raw.includes('timeout') || raw.includes('connect')) return 'Could not reach the licence server. Check your connection and the API base URL.';
  return `Activation failed: ${e?.message || e}`;
}
