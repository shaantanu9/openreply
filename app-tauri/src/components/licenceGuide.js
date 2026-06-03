// Shared "How to get your activation key" guide.
//
// Single source of truth for the help shown wherever a user enters a licence
// key — onboarding Step 6 (welcome.js) and Settings → Licence (LicenceCard.js).
// Before this, the only key-acquisition hints lived in the onboarding step's
// gate-OFF branch, so a user on the (now-default) required-activation screen
// saw three blank inputs and no idea where a key comes from.
//
// The destinations all exist on the activation server:
//   /sign-in          → sign in / create a free account (free key auto-issued + emailed)
//   /dashboard        → view your existing key if you lost it
//   /redeem           → redeem a coupon for a free key
//   /pricing          → buy a paid plan
//   /activation-help  → full troubleshooting (Lemon Squeezy purchase email / portal)

import { api, esc } from '../api.js';

function normBase(base) {
  return String(base || 'https://gapmap.myind.ai').trim().replace(/\/+$/, '');
}

// Routes keyed by the data-kg attribute on each button.
const KG_ROUTES = {
  signin: '/sign-in',
  dashboard: '/dashboard',
  redeem: '/redeem',
  pricing: '/pricing',
  help: '/activation-help',
};

/**
 * HTML for the collapsible "How to get your key" guide.
 * @param {string} base  resolved licence server (e.g. https://gapmap.myind.ai)
 * @param {{open?: boolean, compact?: boolean}} [opts]
 *   open    — render the <details> expanded (use when activation is required)
 *   compact — slightly tighter padding for the Settings card
 */
export function keyGuideHtml(base, opts = {}) {
  const b = normBase(base);
  const host = b.replace(/^https?:\/\//, '');
  const open = opts.open ? ' open' : '';
  const pad = opts.compact ? '10px 12px' : '12px 14px';
  return `
  <details class="key-guide"${open} style="margin-top:14px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);padding:0">
    <summary style="cursor:pointer;list-style:none;padding:${pad};font-weight:600;font-size:var(--fs-14);display:flex;align-items:center;gap:8px">
      <span aria-hidden="true">🔑</span>
      <span>Don't have a key? Here's how to get one</span>
      <span style="margin-left:auto;color:var(--ink-3);font-size:var(--fs-12);font-weight:500">~2 min</span>
    </summary>
    <div style="padding:0 14px 14px">
      <ol style="margin:2px 0 12px;padding-left:18px;color:var(--ink-2);font-size:var(--fs-13);line-height:1.75">
        <li><b>Sign in</b> — or create a free account — at <code>${esc(host)}</code> with your work email. A free licence key is issued automatically.</li>
        <li><b>Copy your key.</b> It's shown on screen right after sign-up and emailed to you (subject: <em>"Your Gap Map licence key"</em>). Format: <code>XXXX-XXXX-XXXX-XXXX</code>.</li>
        <li><b>Come back here</b>, enter that <b>same email + key</b> above, and click <b>Activate</b>. The key binds to this device.</li>
      </ol>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-primary btn-sm" data-kg="signin">Get my key — sign in / sign up ↗</button>
        <button type="button" class="btn btn-ghost btn-sm btn-bordered" data-kg="redeem">Redeem a coupon ↗</button>
        <button type="button" class="btn btn-ghost btn-sm btn-bordered" data-kg="pricing">See pricing ↗</button>
      </div>
      <p style="margin:10px 0 0;color:var(--ink-3);font-size:var(--fs-12);line-height:1.6">
        Lost a key you already have? Open your
        <button type="button" class="kg-link" data-kg="dashboard">dashboard</button>
        to view it. Bought a plan or stuck? See
        <button type="button" class="kg-link" data-kg="help">activation help</button>.
      </p>
    </div>
  </details>`;
}

/**
 * Wire every guide button found inside `scope` to open its page in the browser.
 * Safe to call repeatedly; no-ops if `scope` is missing or has no guide markup.
 * @param {ParentNode} scope  element containing the guide markup
 * @param {string} base       resolved licence server
 */
export function wireKeyGuide(scope, base) {
  if (!scope || typeof scope.querySelectorAll !== 'function') return;
  const b = normBase(base);
  scope.querySelectorAll('[data-kg]').forEach((el) => {
    const route = KG_ROUTES[el.getAttribute('data-kg')];
    if (!route) return;
    el.onclick = (e) => {
      e.preventDefault();
      api.openUrl(`${b}${route}`).catch(() => {});
    };
  });
}
