import { api, $, $$, esc, clearApiCache } from './api.js';
import { confirmModal } from './lib/confirmModal.js';
import { markRedditPending, wireRedditEnrich } from './lib/redditEnrich.js';
import { wireUpdateGate } from './lib/updateGate.js';

// Two-phase collect orchestration (fast sources → background Reddit). Idempotent.
wireRedditEnrich();
import { refreshIcons } from './icons.js';
import { hasLlmConfigured } from './lib/llmStatus.js';
import { renderHome, renderTopicsList } from './screens/home.js';
import { renderTopic } from './screens/topic.js';
import { renderCollect } from './screens/collect.js';
// Central "Collects Manager" — running + queue + this-session history.
import { renderCollects } from './screens/collects.js';
import { renderSettings } from './screens/settings.js';
import { renderIngest } from './screens/ingest.js';
import { renderIngestVideo } from './screens/ingest_video.js';
import { renderResearchWorkspace } from './screens/research_workspace.js';
import { renderResearchHome } from './screens/research_home.js';
import { renderReader } from './screens/reader.js';
import { renderLitMatrix } from './screens/lit_matrix.js';
import { renderWrite } from './screens/write.js';
import { renderLibrary } from './screens/library.js';
import { applyAppModeToDocument, getAppMode } from './labels.js';
import { renderReports } from './screens/reports.js';
import { renderWelcome, isOnboardingComplete } from './screens/welcome.js';
import { renderActivity } from './screens/activity.js';
import { renderDatabase } from './screens/database.js';
import { renderScience } from './screens/science.js';
import { renderSearch } from './screens/search.js';
import { renderPaperMap } from './screens/paperMap.js';
import { renderWatch } from './screens/watch.js';
import { renderFind } from './screens/find.js';
import { renderProductsList, renderProductDashboard, renderProductSetup } from './screens/product.js';
// Lifecycle pivot — Playbook surfaces the 10-phase product-development lifecycle
// (Design Thinking, Lean Startup, Stage-Gate, Kano, JTBD, ...) on top of the
// existing screens, so users see WHERE in the cycle they are.
import { renderPlaybook } from './screens/playbook.js';
// Task Manager — single-screen view of every running/queued/recent
// operation (collects, MCP jobs, extraction queue, sweeps, streams) +
// LLM token usage. Auto-refreshes every 2 s.
import { renderTasks } from './screens/tasks.js';
// Page-explainer system — eye-icon on every page links to /why/<slug>
// which renders the WHY / SCIENCE / HOW-WE-FETCH-YOUR-DATA explainer
// for that specific screen. Trust-building, not technical.
import { renderWhy, whyButtonHTML } from './screens/why.js';

// Maps the current location.hash to the page-explainer slug. Returning
// '' means "don't show the eye icon on this route" — useful for the
// Why screen itself, the welcome / onboarding screens, and any modal-
// shaped routes where the explainer would be redundant.
function explainerSlugForHash(hash) {
  const h = (hash || '').replace(/^#/, '') || '/';
  if (h.startsWith('/why')) return '';        // self
  if (h.startsWith('/welcome')) return '';    // onboarding
  if (h === '/' || h === '')          return 'home';
  if (h.startsWith('/topics'))        return 'topics';
  if (h.startsWith('/topic/'))        return 'topic';
  if (h.startsWith('/collect/'))      return 'collect';
  if (h.startsWith('/collects'))      return 'tasks';   // collects manager → task manager explainer
  if (h.startsWith('/tasks'))         return 'tasks';
  if (h.startsWith('/products'))      return 'products';
  if (h.startsWith('/product/'))      return 'product';
  if (h.startsWith('/competitors'))   return 'competitors';
  if (h.startsWith('/ingest-video'))  return 'ingest-video';
  if (h.startsWith('/ingest'))        return 'ingest';
  if (h.startsWith('/reports'))       return 'reports';
  if (h.startsWith('/activity'))      return 'activity';
  if (h.startsWith('/search'))        return 'search';
  if (h.startsWith('/find'))          return 'find';
  if (h.startsWith('/watch'))         return 'watch';
  if (h.startsWith('/database'))      return 'database';
  if (h.startsWith('/science'))       return 'science';
  if (h.startsWith('/playbook'))      return 'playbook';
  if (h.startsWith('/ost'))           return 'ost';
  if (h.startsWith('/empathy'))       return 'empathy';
  if (h.startsWith('/interviews'))    return 'interviews';
  if (h.startsWith('/pmf'))           return 'pmf';
  if (h.startsWith('/pricing'))       return 'pricing';
  if (h.startsWith('/launch'))        return 'launch';
  if (h.startsWith('/audience'))      return 'audience';
  if (h.startsWith('/iterate'))       return 'iterate';
  if (h.startsWith('/improve'))       return 'improve';
  if (h.startsWith('/estimate'))      return 'estimate';
  if (h.startsWith('/prd'))           return 'prd';
  if (h.startsWith('/settings'))      return 'settings';
  if (h.startsWith('/activate'))      return 'settings';
  return '';
}

// `#/activate` → render the Settings screen, then bring the Licence &
// activation card into focus (scroll + open its form). The card mounts
// asynchronously (it waits on license_status), so poll briefly for it.
async function renderActivate(main, ctx) {
  await renderSettings(main, ctx);
  const deadline = Date.now() + 4000;
  (function focusCard() {
    const card = main.querySelector('#card-licence');
    const form = card && card.querySelector('#lic-form');
    if (card && form) {
      try { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
      if (form.style.display === 'none') form.style.display = 'grid';
      const keyInput = form.querySelector('#lic2-key');
      if (keyInput) { try { keyInput.focus(); } catch {} }
      return;
    }
    if (Date.now() < deadline) setTimeout(focusCard, 150);
  })();
}

// Audience-first nudge — when the user lands on a topic detail page
// and the topic has no audience-personas built yet, show a single
// dismissible banner pointing at /audience and /improve. This is the
// visible expression of "personas-from-real-users come first." Cheap:
// one async call, gated by hash + per-topic localStorage dismiss flag.
function _topicSlugFromHash(hash) {
  const m = (hash || '').match(/^\/topic\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function mountAudienceNudge(rootEl, hash) {
  const topic = _topicSlugFromHash(hash);
  if (!topic) return;
  if (rootEl.querySelector('.audience-nudge')) return;
  let dismissed = {};
  try { dismissed = JSON.parse(localStorage.getItem('gapmap.audience.nudge.dismissed.v1') || '{}'); }
  catch { dismissed = {}; }
  if (dismissed[topic]) return;
  let resp;
  try { resp = await api.audiencePersonasGet(topic); } catch { return; }
  const built = resp?.ok && (resp.personas || []).length > 0;
  if (built) return;
  const banner = document.createElement('div');
  banner.className = 'audience-nudge';
  banner.style.cssText = [
    'display:flex', 'align-items:center', 'gap:12px',
    'padding:10px 16px', 'margin-bottom:14px',
    'background:linear-gradient(120deg, var(--lavender-soft, #EFE7FB), var(--mint-soft, #E1F2EA))',
    'border:1px solid var(--line)', 'border-radius:10px',
    'font-size:13px', 'color:var(--ink, #1A1614)',
  ].join(';');
  banner.innerHTML = `
    <span style="font-size:18px">🧭</span>
    <span style="flex:1">
      <strong>Build personas from your real users first.</strong>
      Every other screen gets stronger when grounded on real authors —
      audience clusters power Insights, Deliberation, and Launch.
    </span>
    <a href="#/audience/${encodeURIComponent(topic)}" class="btn btn-primary btn-xs" style="white-space:nowrap">Build now</a>
    <a href="#/improve/${encodeURIComponent(topic)}" class="btn btn-ghost btn-xs btn-bordered" style="white-space:nowrap">Run pipeline</a>
    <button class="btn btn-ghost btn-xs btn-bordered" data-aud-dismiss aria-label="Dismiss" style="white-space:nowrap">×</button>
  `;
  rootEl.insertBefore(banner, rootEl.firstChild);
  banner.querySelector('[data-aud-dismiss]')?.addEventListener('click', () => {
    try {
      const cur = JSON.parse(localStorage.getItem('gapmap.audience.nudge.dismissed.v1') || '{}');
      cur[topic] = Date.now();
      localStorage.setItem('gapmap.audience.nudge.dismissed.v1', JSON.stringify(cur));
    } catch {}
    banner.remove();
  });
}

// Auto-inject the eye-icon button into the topbar of any rendered
// screen. Called after every successful route render so we never
// touch each screen's render function. Safely no-ops if the screen
// has no .topbar or already mounted its own eye button.
function mountWhyEyeIcon(rootEl, hash) {
  const slug = explainerSlugForHash(hash);
  if (!slug) return;
  const topbar = rootEl.querySelector('.topbar');
  if (!topbar) return;
  if (topbar.querySelector('.why-eye-btn')) return;  // already mounted
  // Append after the spacer (or at end) so it sits at the topbar's
  // right edge alongside any existing actions.
  const wrap = document.createElement('span');
  wrap.className = 'why-eye-mount';
  wrap.innerHTML = whyButtonHTML(slug, { label: 'Why this page', size: 'sm' });
  const spacer = topbar.querySelector('.topbar-spacer');
  if (spacer && spacer.nextSibling) {
    topbar.insertBefore(wrap, spacer.nextSibling);
  } else {
    topbar.appendChild(wrap);
  }
}
// Discovery framework expansion (2026-05-01_04) — Opportunity Solution Tree
// (Torres, 2016): Outcome → Opportunities → Solutions → Experiments.
import { renderOst } from './screens/ost.js';
// Discovery framework expansion v2 (2026-05-01_05) — Empathy Map (Gray 2010),
// Customer Discovery Interviews (Mom Test, Fitzpatrick 2013), Sean Ellis PMF
// survey (2010), Pricing surveys (Van Westendorp 1976 / NPS 2003 / MaxDiff),
// PERT estimation (US Navy 1958), PRD generator.
import { renderEmpathy } from './screens/empathy.js';
import { renderInterviews } from './screens/interviews.js';
import { renderPmf } from './screens/pmf.js';
import { renderPricing } from './screens/pricing.js';
import { renderEstimate } from './screens/estimate.js';
import { renderPrd } from './screens/prd.js';
// Launch & GTM (2026-05-02) — per-topic go-to-market brief that
// synthesizes audience + demographics + channels + MVP + pricing.
import { renderLaunch } from './screens/launch.js';
// Global Chats (2026-05-31) — every saved topic-AI conversation in one list.
import { renderChats } from './screens/chats.js';
// Audience (2026-05-03) — clusters of REAL authors per topic.
// Replaces every LLM-imagined-persona surface with citation-backed clusters.
import { renderAudience } from './screens/audience.js';
// Iterate (2026-05-03 Phase 4) — Karpathy-style autoresearch loop UI.
// Sweeps a small config grid for the deliberate / audience pipelines.
import { renderIterate } from './screens/iterate.js';
// Improve (2026-05-03 Phase 4) — guided "one button" pipeline runner
// that chains audience → synthesize → deliberate → launch.
import { renderImprove } from './screens/improve.js';
import { runHealthCheck, healthIsBlocking } from './lib/healthCheck.js';
import { tabStore, renderTabStrip, titleForHash, iconForHash } from './lib/tabs.js';
// ── AG-D: compare view ──
import { renderCompare } from './screens/compare.js';
// ── AG-C: global competitors (T2.5) ──
import { renderGlobalCompetitors } from './screens/global_competitors.js';
// ── Global collect status bar (running + queue) ──
import { mountCollectStatusBar } from './components/CollectStatusBar.js';
// ── Persona agents (Phase 1 — 2026-05-12) ──
import { renderPersonas, renderPersona, renderAgentsDashboard, setupPersonaAutoIngest } from './screens/personas.js';

// ─── Global JS error surfacing ─────────────────────────────────────────────
// The app had NO global error handler, so any uncaught exception or rejected
// promise (e.g. a throw mid-way through wiring a screen) failed SILENTLY — the
// UI just looked "dead" (buttons that do nothing, chat that never sends) with
// no clue why. This turns every such failure into a visible, dismissable
// banner so problems are diagnosable instead of invisible. Self-contained
// (no imports) so it works even if a module failed to load.
(function installGlobalErrorOverlay() {
  if (typeof window === 'undefined' || window.__gmErrOverlay) return;
  window.__gmErrOverlay = true;
  const show = (label, detail) => {
    try {
      let host = document.getElementById('gm-err-overlay');
      if (!host) {
        host = document.createElement('div');
        host.id = 'gm-err-overlay';
        host.style.cssText =
          'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;display:flex;' +
          'flex-direction:column;gap:8px;pointer-events:none;font:12px/1.4 ui-monospace,monospace';
        (document.body || document.documentElement).appendChild(host);
      }
      const card = document.createElement('div');
      card.style.cssText =
        'pointer-events:auto;background:#3A1416;color:#FFD9D9;border:1px solid #B84747;' +
        'border-radius:8px;padding:10px 12px;box-shadow:0 8px 28px rgba(0,0,0,.35);' +
        'max-height:160px;overflow:auto;white-space:pre-wrap;word-break:break-word';
      const msg = (detail && (detail.stack || detail.message || detail)) || 'unknown error';
      card.textContent = `⚠ ${label}: ${String(msg).slice(0, 600)}`;
      const close = document.createElement('button');
      close.textContent = '✕';
      close.style.cssText = 'float:right;background:transparent;border:0;color:#FFD9D9;cursor:pointer;font-size:14px;margin-left:8px';
      close.onclick = () => card.remove();
      card.prepend(close);
      host.appendChild(card);
      // eslint-disable-next-line no-console
      console.error(`[gm-error] ${label}:`, detail);
    } catch { /* never let the error handler throw */ }
  };
  window.addEventListener('error', (e) => show('Uncaught error', e?.error || e?.message || e));
  window.addEventListener('unhandledrejection', (e) => show('Unhandled promise rejection', e?.reason));
})();

const routes = [
  { match: /^\/?$/,                 render: renderHome },
  { match: /^\/welcome\/?$/,        render: renderWelcome },
  { match: /^\/topics\/?$/,         render: renderTopicsList },
  { match: /^\/topic\/([^/]+)$/,    render: renderTopic },
  { match: /^\/collect\/([^/]+)$/,  render: renderCollect },
  // Central "Collects Manager" — running + queued + this-session history.
  // Linked from the global CollectStatusBar.
  { match: /^\/collects\/?$/,       render: renderCollects },
  { match: /^\/settings\/?$/,       render: renderSettings },
  // Licence activation destination. The MCP gate + LicenceCard link here
  // ("Activate this device"); the licence UI itself lives in Settings, so
  // render Settings and scroll/expand the licence card into focus.
  { match: /^\/activate\/?$/,       render: renderActivate },
  { match: /^\/research\/?$/,       render: renderResearchWorkspace },
  { match: /^\/research-home\/?$/,  render: renderResearchHome },
  { match: /^\/reader\/([^/?]+).*$/, render: renderReader },
  { match: /^\/lit-matrix\/([^/?]+).*$/, render: renderLitMatrix },
  { match: /^\/write\/([^/?]+).*$/, render: renderWrite },
  { match: /^\/library\/?$/, render: renderLibrary },
  { match: /^\/ingest\/?$/,         render: renderIngest },
  { match: /^\/ingest-video(?:\?.*)?\/?$/, render: renderIngestVideo },
  { match: /^\/reports\/?$/,        render: renderReports },
  { match: /^\/chats\/?$/,          render: renderChats },
  { match: /^\/activity\/?$/,       render: renderActivity },
  { match: /^\/database\/?$/,       render: renderDatabase },
  { match: /^\/science\/?$/,        render: renderScience },
  { match: /^\/search\/?$/,         render: renderSearch },
  // Paper Map — relationship graph of a topic's academic papers.
  { match: /^\/paper-map\/([^/?]+).*$/, render: renderPaperMap },
  { match: /^\/find\/?$/,           render: renderFind },
  { match: /^\/watch\/?$/,          render: renderWatch },
  // Dual-Mode Pivot — Product Mode routes
  { match: /^\/products\/?$/,               render: renderProductsList },
  { match: /^\/product\/([^/]+)\/setup$/,   render: renderProductSetup },
  { match: /^\/product\/([^/]+)$/,          render: renderProductDashboard },
  // ── AG-D: compare view ──
  { match: /^\/compare\/([^/]+)\/([^/]+)$/, render: renderCompare },
  // ── AG-C: global competitors (T2.5) ──
  { match: /^\/competitors\/?$/,            render: renderGlobalCompetitors },
  // Lifecycle pivot — Playbook screen: 10-phase product-development lifecycle.
  { match: /^\/playbook\/?$/,               render: renderPlaybook },
  // Task Manager — Windows Task Manager analog for runtime state.
  { match: /^\/tasks\/?$/,                  render: renderTasks },
  // Page-explainer: trust-building "why this page" view per screen.
  { match: /^\/why\/?$/,                    render: renderWhy },
  { match: /^\/why\/([^/?]+)$/,             render: renderWhy },
  // Discovery framework expansion — OST picker + per-topic tree.
  { match: /^\/ost\/?$/,                    render: renderOst },
  { match: /^\/ost\/([^/?]+)$/,             render: renderOst },
  // Discovery v2 — Empathy maps, Customer Discovery Interviews, PMF survey,
  // Pricing surveys, PERT estimate, PRD export.
  { match: /^\/empathy\/?$/,                render: renderEmpathy },
  { match: /^\/empathy\/([^/?]+).*$/,       render: renderEmpathy },
  { match: /^\/interviews\/?$/,             render: renderInterviews },
  { match: /^\/interviews\/([^/?]+).*$/,    render: renderInterviews },
  { match: /^\/pmf\/?$/,                    render: renderPmf },
  { match: /^\/pmf\/([^/?]+).*$/,           render: renderPmf },
  { match: /^\/pricing\/?$/,                render: renderPricing },
  { match: /^\/pricing\/([^/?]+).*$/,       render: renderPricing },
  // Launch & GTM (2026-05-02) — audience, demographics, channels, MVP,
  // pricing, sequence — all per topic.
  { match: /^\/launch\/?$/,                 render: renderLaunch },
  { match: /^\/launch\/([^/?]+).*$/,        render: renderLaunch },
  // Audience personas (2026-05-03) — citation-backed clusters of real
  // authors per topic.
  { match: /^\/audience\/?$/,               render: renderAudience },
  { match: /^\/audience\/([^/?]+).*$/,      render: renderAudience },
  // Iterate / Autoresearch (2026-05-03) — config-grid sweeper UI.
  // The /run/<id> path is also handled by renderIterate (see internals).
  { match: /^\/iterate\/?$/,                render: renderIterate },
  { match: /^\/iterate\/run\/([^/?]+)$/,    render: renderIterate },
  { match: /^\/iterate\/([^/?]+).*$/,       render: renderIterate },
  // Improve (2026-05-03) — guided pipeline runner.
  { match: /^\/improve\/?$/,                render: renderImprove },
  { match: /^\/improve\/([^/?]+).*$/,       render: renderImprove },
  { match: /^\/estimate\/([^/?]+).*$/,      render: renderEstimate },
  { match: /^\/prd\/([^/?]+).*$/,           render: renderPrd },
  // ── Persona agents (Phase 1 — 2026-05-12) ──
  { match: /^\/personas\/?$/,               render: renderPersonas },
  { match: /^\/persona\/([0-9]+)\/?$/,      render: renderPersona },
  // ── Agents orchestra (Phase 4b — 2026-05-12) ──
  { match: /^\/agents\/?$/,                 render: renderAgentsDashboard },
];

// Route generation counter — bumped on every navigation so screens can tell
// whether an in-flight async task (DB query, fetch) still applies to the
// currently-visible screen. Without this, a stale catch block from the
// previous screen would query for its own DOM id (now absent) and blow up,
// taking out the current screen via route()'s error handler.
let routeGen = 0;
export function currentRouteGen() { return routeGen; }

let _lastHash = null;
function normalizeTopicInput(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isLicenseActivatedLocally() {
  return localStorage.getItem('gapmap.license.activated') === 'true';
}

// Resolved at boot via api.licenseGateStatus(). When the gate is OFF
// (the default for DMG distribution), the router treats every user as
// effectively activated — `mustStayInOnboarding()` returns true only if
// onboarding itself is incomplete. Flip GAPMAP_LICENSE_GATE_ENABLED to
// re-introduce the activation requirement.
let _licenseGateEnabled = false;
let _licenseGateChecked = false;
async function resolveLicenseGate() {
  if (_licenseGateChecked) return;
  try {
    const g = await api.licenseGateStatus();
    _licenseGateEnabled = !!g?.enabled;
  } catch {
    _licenseGateEnabled = false;  // default-OFF on any error
  }
  _licenseGateChecked = true;
}
function isActivationRequired() {
  return _licenseGateEnabled;
}

function mustStayInOnboarding() {
  if (!isOnboardingComplete()) return true;
  // When the gate is OFF, no local activation needed — let users in.
  if (!isActivationRequired()) return false;
  return !isLicenseActivatedLocally();
}

// Reflect the onboarding-gate state onto <body> so CSS can visibly DIM and
// disable the sidebar nav while the gate is active. Without this, a
// first-run user clicks a sidebar link, gets silently bounced back to
// #/welcome, and reports "no sidebar buttons are clickable on new install".
// The dim + "Finish setup to unlock" label makes the WHY obvious instead of
// looking broken. Cleared the moment the gate opens.
function syncOnboardingBodyFlag() {
  document.body.setAttribute(
    'data-onboarding',
    mustStayInOnboarding() ? 'incomplete' : 'complete',
  );
}

async function route() {
  // Keep the <body data-onboarding> flag in sync on every navigation so the
  // sidebar nav dims/undims as the gate opens/closes (see CSS).
  syncOnboardingBodyFlag();
  // Full hash (with leading `#`) for tab-store ops; stripped hash for regex match.
  const fullHash = location.hash || '#/';
  const hash = fullHash.replace(/^#/, '');
  if (mustStayInOnboarding() && !/^\/welcome\/?$/.test(hash)) {
    location.hash = '#/welcome';
    return;
  }
  const main = $('#main-content');

  // Save scroll of the outgoing tab before we re-render.
  if (_lastHash) {
    const prev = tabStore.getActive();
    if (prev) tabStore.saveScroll(prev.id, main.scrollTop);
  }

  // Reconcile: the hash we're landing on must belong to the active tab.
  // If user clicked a sidebar link (which changed the hash directly), open
  // it in the current tab by rewriting the active tab's hash. If another
  // tab already owns this hash, focus that tab instead.
  const active = tabStore.getActive();
  if (active && active.hash !== fullHash) {
    const owner = tabStore.getAll().find(t => t.hash === fullHash);
    if (owner) {
      tabStore.focus(owner.id);
    } else {
      // Replace current tab's hash in-place (Chrome-like default).
      // replaceHash() updates hash+title+icon AND notifies — without
      // the notify the strip would show the old title until the user
      // clicked a tab (focus() being the next notify trigger).
      tabStore.replaceHash(active.id, fullHash);
    }
  }

  _lastHash = fullHash;
  const myGen = ++routeGen;
  for (const r of routes) {
    const m = hash.match(r.match);
    if (m) {
      main.dataset.routeGen = String(myGen);
      $$('.nav a').forEach(a => {
        const dr = a.dataset.route;
        a.classList.toggle('active', dr && hash.startsWith(dr) && !(dr === '/' && hash !== '/' && hash !== ''));
      });
      try {
        await r.render(main, { params: m.slice(1) });
      } catch (e) {
        // Only show the error if THIS route is still the active one — a stale
        // render from the prior screen can reject long after the user moved on.
        if (routeGen === myGen) {
          main.innerHTML = `<div class="empty-state">Error: ${e?.message || e}</div>`;
        } else {
          console.warn('[route] suppressed stale render error:', e);
        }
      }
      if (routeGen === myGen) {
        // Auto-inject the eye-icon "why this page" button into the
        // active screen's topbar. Runs after the screen has rendered
        // its own DOM so we know .topbar exists. The icon refresh
        // below picks up the lucide <i> tag we just added.
        mountWhyEyeIcon(main, hash);
        // Audience-first nudge — fires on /topic/<T> only; cheap async,
        // self-dismisses when audience clusters exist or the user X's it.
        mountAudienceNudge(main, hash).catch((e) =>
          console.warn('[gapmap] audience nudge skipped:', e),
        );
        refreshIcons();
      }
      // After render succeeds, update tab title + restore scroll for this tab.
      if (routeGen === myGen) {
        const cur = tabStore.getActive();
        if (cur) {
          tabStore.setTitle(cur.id, titleForHash(cur.hash));
          requestAnimationFrame(() => { main.scrollTop = cur.scroll || 0; });
        }
      }
      return;
    }
  }
  main.innerHTML = `<div class="empty-state">404 — not found</div>`;
}

window.addEventListener('hashchange', route);
// Phase-11 polish prefs — applied before any render so the very first paint
// uses the correct palette/density (no dark→light flash on boot).
(function applyEarlyPrefs() {
  try {
    if (localStorage.getItem('gapmap.pref.dark_mode') === 'true') {
      document.documentElement.classList.add('dark');
    }
    if (localStorage.getItem('gapmap.pref.dense_cards') === 'true') {
      document.documentElement.classList.add('dense-cards');
    }
    applyAppModeToDocument();   // <html data-app-mode="product|research">
  } catch {}
})();

// App-mode nav visibility. Nav items tagged `data-nav-mode="research"` (or
// "product") only show in that mode; untagged items show in both. Research
// Mode also reveals the Research-home front door. Re-runs on boot and whenever
// the mode changes from Settings.
function syncNavToAppMode() {
  try {
    const mode = getAppMode();
    document.querySelectorAll('[data-nav-mode]').forEach((el) => {
      el.style.display = (el.dataset.navMode === mode) ? '' : 'none';
    });
  } catch {}
}
syncNavToAppMode();
window.addEventListener('appmodechange', syncNavToAppMode);

// Activation state heal: license_state.json (written by the Rust
// `license_activate` command) is the source of truth on disk, but the
// onboarding gate reads a synchronous localStorage flag. If the JSON
// exists + is valid but the localStorage flag is missing (e.g. a
// successful activation from a different build, a cleared localStorage,
// or HMR refresh before the flag landed), heal it at boot so the user
// isn't bounced back to the welcome wizard for an already-licensed
// machine.
async function healActivationFlagsFromBackend() {
  try {
    // Re-check the licence with the server so a renewal (new expiry) or a
    // cancellation syncs even for an already-activated machine. Best-effort
    // and non-blocking — the Rust timer also does this on a 6 h cadence.
    api.licenseRevalidate?.().catch(() => {});
    if (localStorage.getItem('gapmap.license.activated') === 'true') return;
    const status = await api.licenseStatus();
    if (status?.activated && status?.license_id) {
      localStorage.setItem('gapmap.license.activated', 'true');
      localStorage.setItem('gapmap.onboarding.completed', 'true');
      if (status.email) localStorage.setItem('gapmap.license.email', status.email);
      if (status.api_base) localStorage.setItem('gapmap.license.api_base', status.api_base);
      // Tell screens that were already mounted (if any) to re-render now that
      // we're past the onboarding gate.
      window.dispatchEvent(new CustomEvent('gapmap:changed', { detail: { kind: 'topics' } }));
    }
  } catch {
    /* best effort — fall through to the sync localStorage path */
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  // Wire modal + keyboard FIRST so Cancel / Escape work even before any data loads.
  // (The Python sidecar can take 5–10s to spin up the first time.)
  wireModal();
  wireKeyboard();
  // Sticky status bar showing running collect + queued collects on every screen.
  mountCollectStatusBar().catch((e) =>
    console.warn('[main] collect-status-bar mount failed:', e),
  );

  // Phase 2d — auto-ingest hook. Listens for collect:done globally and
  // fires persona ingest for every active persona on the new topic. Gated
  // by a localStorage flag the user can toggle on the Personas screen.
  setupPersonaAutoIngest();

  // Force-update gate — non-blocking boot check (+ 6h re-check). If the server
  // marks the installed build below MIN_APP_VERSION, it overlays a blocking
  // "Update required" screen. Never blocks on a failed/offline check.
  wireUpdateGate();

  // Resolve the license-gate flag BEFORE any guard. When OFF (default),
  // the rest of the boot path treats the user as effectively activated.
  await resolveLicenseGate();

  // Run the activation-flag heal BEFORE the first route() so the guard
  // below sees the correct state. Swallow errors — the sync check is the
  // last line of defence.
  await healActivationFlagsFromBackend();

  // Mount tab strip. Hide during onboarding — the welcome flow should feel
  // like a clean first-run, not a multi-tab browser.
  const strip = document.getElementById('tab-strip');
  if (strip) {
    strip.style.display = (!mustStayInOnboarding()) ? '' : 'none';
    renderTabStrip(strip);
  }

  // Subscribe router to active-tab changes. When user focuses a different tab
  // (click/keyboard), sync location.hash and re-run route() once.
  tabStore.subscribe(() => {
    const active = tabStore.getActive();
    if (!active) return;
    if (location.hash !== active.hash) {
      history.replaceState(null, '', active.hash);
      route();
    }
  });

  // Explicit safety: ensure the modal is hidden on boot no matter what.
  const bd = $('#modal-backdrop');
  if (bd) bd.hidden = true;

  // If the user has completed onboarding, land on dashboard while data fetches.
  // If not, route straight to welcome — dashboard never renders until they finish.
  if (!location.hash || location.hash === '#/' || location.hash === '#') {
    // Fast, synchronous localStorage check — does not block on sidecar.
    if (mustStayInOnboarding()) {
      location.hash = '#/welcome';
    } else {
      location.hash = '#/';
    }
  }

  // Hard gate: when activation is required (gate ON), enforce both
  // onboarding-complete AND a valid local activation marker, then re-confirm
  // against the Rust side. When activation is NOT required (gate OFF —
  // the default), only enforce onboarding completion.
  if (isActivationRequired()) {
    if (!isOnboardingComplete() || !isLicenseActivatedLocally()) {
      location.hash = '#/welcome';
    } else {
      try {
        const lic = await api.licenseStatus();
        if (!lic?.activated) {
          localStorage.removeItem('gapmap.license.activated');
          location.hash = '#/welcome';
        }
      } catch {
        // If license server/sidecar is unavailable, keep existing session
        // locked to last known activation marker and continue.
      }
    }
  } else if (!isOnboardingComplete()) {
    location.hash = '#/welcome';
  }

  // Delegated link interceptors for cmd-click / middle-click / right-click on
  // any route link (sidebar <a>, in-screen <a>, or topic tiles with
  // data-topic-href). Default clicks still fall through to hashchange so the
  // existing router keeps working untouched.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#/"]');
    if (!a) return;
    const href = a.getAttribute('href');
    const middle = e.button === 1;
    const meta = e.metaKey || e.ctrlKey;
    if (!middle && !meta) return;     // default click handled by hashchange
    e.preventDefault();
    tabStore.open({
      hash: href,
      foreground: e.shiftKey || middle ? !middle : true,
    });
  });

  document.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;       // middle click only
    const a = e.target.closest('a[href^="#/"]');
    if (!a) return;
    e.preventDefault();
    tabStore.open({ hash: a.getAttribute('href'), foreground: false });
  });

  // Right-click on any route link → "Open / Open in new tab" menu.
  // Also targets [data-topic-href] so non-<a> topic tiles get the menu.
  document.addEventListener('contextmenu', (e) => {
    const a = e.target.closest('a[href^="#/"], [data-topic-href]');
    if (!a) return;
    const hash = a.getAttribute('href') || a.getAttribute('data-topic-href');
    if (!hash) return;
    e.preventDefault();
    import('./lib/contextMenu.js').then(({ openContextMenu }) => {
      openContextMenu(e.clientX, e.clientY, [
        { label: 'Open',            icon: 'arrow-right', onClick: () => { location.hash = hash; } },
        { label: 'Open in new tab', icon: 'plus-square', onClick: () => tabStore.open({ hash, foreground: false }) },
      ]);
    });
  });

  // Fire closeSplash on a parallel timer that's independent of route() — so
  // a throw/hang during the first render never leaves the splash stuck on
  // screen and the main window hidden. Rust also has a 6 s hard safety
  // net (see src-tauri/src/main.rs setup()), this belt-and-braces approach
  // gives the happy path near-instant reveal.
  setTimeout(() => { api.closeSplash().catch(() => {}); }, 0);

  await route();

  // First route rendered — tell Rust to close splash + show main window.
  // Failure is non-fatal (non-Tauri dev preview etc.).
  try { await api.closeSplash(); } catch {}

  // ─── Post-boot warm-up of cachedInvoke ────────────────────────────────
  // Background-fire the 8 calls Settings needs so the in-memory cache is
  // hot before the user ever clicks Settings. Each call has its own TTL
  // (30-300s in api.js), so the result is instantly served from memory
  // on first Settings open — no daemon round-trips needed at click time.
  //
  // Fire after splash closes so this never blocks first paint. Errors
  // are swallowed — a warm-up failure becomes a real fetch later, no
  // user-visible impact. Sequenced into 3 groups by importance so the
  // ones a user is most likely to hit first warm up first.
  setTimeout(() => {
    const warm = (fn, label) => {
      try {
        Promise.resolve(fn()).catch(() => {});
        // No need to await — cachedInvoke writes to in-memory cache as
        // soon as the daemon responds. Subsequent calls hit cache.
      } catch (e) {
        console.debug(`[warmup] ${label} skipped:`, e?.message || e);
      }
    };
    // Group 0 — LLM prewarm FIRST (longest-running, highest value). The first
    // collect's topic canonicalize is a 30-60s cold-model call that blocks the
    // whole collect before any posts arrive ("feels hung"). Firing a 1-token
    // warmup here, with maximum lead time, absorbs that cold start so the
    // user's real first collect canonicalizes in a few seconds. Fail-soft.
    warm(() => api.warmLlm(),         'llm_prewarm');
    // Group A — cheap, no SQL: 3 file/keychain reads
    warm(() => api.cliInfo(),         'cli_info');
    warm(() => api.byokStatus(),      'byok_status');
    warm(() => api.exportPrefsGet(),  'export_prefs');
    // Group B — light SQL: queue count + token spend
    setTimeout(() => {
      warm(() => api.todayTokenSpend(),    'today_token_spend');
      warm(() => api.whisperCatalogue(),   'whisper_catalogue');
    }, 1500);
    // Group C — heaviest (chromadb import + filesystem walk):
    // defer further so they don't compete with the dashboard's own
    // background loads.
    setTimeout(() => {
      warm(() => api.palaceModelStatus(),  'palace_model_status');
      warm(() => api.palaceStats(),        'palace_stats');
      warm(() => api.ytdlpVersion(),       'ytdlp_version');
    }, 3000);
    // Group D — palace runtime prewarm (chromadb + ONNX MiniLM load via
    // one throwaway query). Defer further so the dashboard + groups A-C
    // finish first. This eliminates the 2-3 s (longer under load) cold
    // start on the user's first semantic search / Insights / Map open —
    // the cost is paid here, in the background, instead of when the
    // user is staring at a spinner. Skipped silently if the ONNX
    // model isn't downloaded yet (palace_prewarm returns ok:false in
    // that case). Cheap on repeat calls (no-op if already warm).
    setTimeout(() => {
      warm(() => api.palacePrewarm(),      'palace_prewarm');
    }, 6000);
  }, 800);

  // Sidebar counters — populate on boot AND refresh on every `gapmap:changed`
  // mutation so adding/deleting a topic updates the count immediately.
  async function refreshNavCounts() {
    try {
      const topics = await api.listTopics();
      if (Array.isArray(topics)) {
        const n = topics.length;
        const a = $('#nav-topics-count'); if (a) a.textContent = n;
        const b = $('#nav-dash-count');   if (b) b.textContent = n;
      }
    } catch {}
    try {
      const resp = await api.productList(true);
      const products = resp?.products || [];
      const el = $('#nav-products-count');
      if (el) el.textContent = products.length;
    } catch {}
  }
  refreshNavCounts();

  // Drop any localStorage screen-cache entry whose key contains the
  // mutation kind, so the next visit refetches fresh data. Example:
  // saving a new finding fires `gapmap:changed{kind:findings}` →
  // every key matching `*findings*` is dropped → the topic Home /
  // Insights tab reloads from sidecar instead of serving stale data.
  // Unrelated cached screens keep their fast paint. See
  // `lib/screenCache.js`.
  import('./lib/screenCache.js').then(({ clearScreenCacheBy }) => {
    window.addEventListener('gapmap:changed', (e) => {
      const kind = e?.detail?.kind;
      if (!kind) return;
      // Map mutation kinds to cache-tag substrings. `kind === 'graph'`
      // means findings + concepts + relations changed → drop every
      // topic-scoped cache.
      const tagsByKind = {
        topics:    ['insights.', 'home.'],
        collect:   ['insights.', 'home.', 'sources.', 'posts.'],
        ingest:    ['insights.', 'home.', 'sources.', 'posts.'],
        // Graph mutations rebuild concept + intervention + relation
        // nodes — drop every cache derived from graph_nodes/edges.
        graph:     ['insights.', 'solutions.', 'concepts.', 'papers.'],
        // Findings drive insights, evidence, and the painpoint cards on
        // solutions. Re-extraction means all three need fresh paint.
        findings:  ['insights.', 'evidence.', 'solutions.'],
        trash:     ['insights.', 'home.', 'evidence.', 'sources.', 'posts.'],
        byok:      [],   // no screen cache depends on the key itself
        hypothesis:['bets.'],
        product:   ['insights.'],
      };
      for (const tag of (tagsByKind[kind] || [])) clearScreenCacheBy(tag);
    });
  }).catch(() => {});

  // Shared skip list: which routes should NOT be auto-remounted by either
  // `gapmap:db-changed` (external SQLite writes) or `gapmap:changed`
  // (in-app mutations). Two reasons a route belongs here:
  //   (a) it owns its own reactive refreshes — remounting would nuke
  //       in-place tab/scroll state (collect, topic)
  //   (b) it reads from FS / keychain / config, not SQLite — remounting
  //       is pure UI thrash with no data benefit (settings, welcome,
  //       activate, license)
  // Without the (b) routes in this list, the bundled MCP daemon writing
  // to gapmap.db (every Claude Code tool call → enrichment writes) makes
  // Settings flicker / remount every few seconds, which the user
  // experiences as "the app keeps refreshing".
  const NO_REMOUNT_ROUTES = [
    /^#\/collect\/[^/]+/,    // collect — owns its own refresh (live progress polling)
    /^#\/topic\/[^/?]+/,     // topic — owns its own refresh (tab-level loaders)
    /^#\/settings\b/,        // settings — FS / keychain driven, no SQLite content
    /^#\/welcome\b/,         // welcome — no SQLite content
    /^#\/activate\b/,        // activation — keychain / HTTP only
    /^#\/license\b/,         // license — keychain only
    // ---- 2026-05-28: stop the "app keeps refreshing" feel during enrichment ----
    // Screens that have their own internal refresh / polling / interactive
    // state. Remounting them on every external DB write blows away in-place
    // tab state, scroll position, modal open state, etc. — and they already
    // surface fresh data via their own renderers.
    /^#\/audience\/[^/]+/,   // audience detail — buildAndRender owns live polling
    /^#\/personas\b/,        // personas — own ingest progress event stream
    /^#\/tasks\b/,           // Task Manager — own refresh
    /^#\/collects\b/,        // Active Collects — own refresh
    /^#\/activity\b/,        // Activity — own 4s db-mtime poller
    /^#\/database\b/,        // Database console — query-driven, no auto-render
    /^#\/find\b/,            // Find — interactive query input
    /^#\/search\b/,          // Search — interactive query input
    /^#\/watch\b/,           // Watch — own refresh
    /^#\/iterate\b/,         // Iterate — long-running auto-research session
    /^#\/improve\b/,         // Improve — multi-step pipeline UX
    // (Home `/`, /topics, /products, /competitors, /reports, /ingest,
    //  /ingest-video, /science, /playbook, /ost, /empathy, /interviews,
    //  /pmf, /pricing, /launch DO still remount — they show
    //  "list-of-everything" views where fresh data matters and they
    //  don't own a polling loop. The new debounce below keeps the
    //  remount cadence sane during a write burst.)
  ];
  const shouldSkipRemount = () => {
    const hash = location.hash || '';
    return NO_REMOUNT_ROUTES.some((rx) => rx.test(hash));
  };

  // Reactive re-render: any in-app mutation fires `gapmap:changed`. We refresh
  // the sidebar counters AND ask the currently-visible screen to re-render
  // itself (by re-running route() — cached reads are already invalidated
  // inside `mutated()`, so screens get fresh data without a full page swap).
  window.addEventListener('gapmap:changed', (e) => {
    const kind = e?.detail?.kind;
    refreshNavCounts();
    // Topic/collect/ingest/graph changes affect the currently-visible screen's
    // data set (Home's topic grid, Topics list, Activity feed, Topic page
    // findings, etc.). Re-running route() triggers the screen's renderer,
    // which reads through the (now-invalidated) cache and pulls fresh data.
    if (['topics', 'collect', 'ingest', 'graph', 'findings', 'trash'].includes(kind)) {
      if (shouldSkipRemount()) return;
      // Also wipe home's stale-while-revalidate localStorage cache so a
      // deleted topic doesn't flash before the fresh fetch returns.
      try { localStorage.removeItem('gapmap.dashboard.cache.v1'); } catch {}
      route();
    }
    // Incremental enrichment: when a collect finishes, the topic may have
    // just crossed the 100-post threshold. Poke the Rust supervisor — it's
    // idempotent, so starting an already-running worker is a no-op, and
    // below-threshold topics will be filtered naturally by the worker's
    // drain query (empty extraction_queue → immediate idle).
    // Clear the audience-auto-build marker when a topic is trashed —
    // a future re-collect on the same name should retrigger the build.
    if (kind === 'trash' || kind === 'topics') {
      try {
        const s = JSON.parse(localStorage.getItem('gapmap.audience.autobuilt.v1') || '{}');
        const dismissed = JSON.parse(localStorage.getItem('gapmap.audience.nudge.dismissed.v1') || '{}');
        const detailTopic = e?.detail?.topic;
        if (detailTopic) {
          delete s[detailTopic];
          delete dismissed[detailTopic];
          localStorage.setItem('gapmap.audience.autobuilt.v1', JSON.stringify(s));
          localStorage.setItem('gapmap.audience.nudge.dismissed.v1', JSON.stringify(dismissed));
        }
      } catch {}
    }
    if (kind === 'collect') {
      api.startExtractionWorker().catch(() => {});
      // Auto-trigger audience clustering (deterministic only — no LLM
      // call) right after a collect completes. Personas-from-real-users
      // is the starting point of every other discovery surface, so
      // building them eagerly means the Audience / Improve / Launch
      // screens have data the moment the user clicks them. Fully best-
      // effort: any failure (no embedder, too few authors, sidecar
      // hiccup) is silenced. The user can also re-run from the
      // Audience screen with LLM augmentation later.
      const detail = e?.detail || {};
      const topicName = detail.topic;
      const lastSession = (() => {
        try { return JSON.parse(localStorage.getItem('gapmap.audience.autobuilt.v1') || '{}'); }
        catch { return {}; }
      })();
      if (topicName && !lastSession[topicName]) {
        lastSession[topicName] = Date.now();
        try { localStorage.setItem('gapmap.audience.autobuilt.v1', JSON.stringify(lastSession)); } catch {}
        api.audiencePersonasBuild(topicName, { llm: false })
          .then((r) => {
            if (r?.ok) {
              console.log(`[gapmap] auto-built ${(r.personas || []).length} audience clusters for ${topicName}`);
            }
          })
          .catch((err) => {
            console.warn('[gapmap] audience auto-build skipped:', err);
            // On failure, drop the cache marker so the user's next
            // collect on this topic retries.
            try {
              const s = JSON.parse(localStorage.getItem('gapmap.audience.autobuilt.v1') || '{}');
              delete s[topicName];
              localStorage.setItem('gapmap.audience.autobuilt.v1', JSON.stringify(s));
            } catch {}
          });
      }
    }
  });

  // External-writer bridge: when the DB-mtime poller in api.js sees that
  // gapmap.db changed outside this process (MCP server, CLI, another Tauri
  // window, background collect from a scheduled task), translate that into
  // a `gapmap:changed` event so the same re-render path fires.
  //
  // Without this, MCP tools like `gapmap_start_collect` successfully write
  // topics/posts to the shared SQLite but the GUI renders stale cached data
  // until the user manually navigates.
  // Coalesce a burst of DB writes into ONE remount after a 2s quiet period.
  // Without this, the bundled MCP daemon + enrichment worker writing every
  // few seconds during a long collect causes a fresh remount on every tick
  // of the 5s db-mtime poller — the user experiences this as "the app keeps
  // refreshing." Sidebar counters still update immediately on every event
  // (cheap, no DOM remount); only the full screen remount is debounced.
  // LLM key added / removed / default changed anywhere (the BYOK modal now
  // always fires `gapmap:llm-changed` on close). Re-render the current top-level
  // screen so its "Add a key" empty-states flip to the unlocked UI instantly —
  // no app restart. Topic/Settings/Welcome are in NO_REMOUNT_ROUTES and refresh
  // themselves (topic via its per-tab listener, settings via its own re-render).
  window.addEventListener('gapmap:llm-changed', () => {
    try { clearApiCache?.(); } catch {}
    refreshNavCounts();
    if (shouldSkipRemount()) return;
    route();
  });

  let _dbChangedTimer = null;
  let _dbChangedPokedWorker = false;
  window.addEventListener('gapmap:db-changed', () => {
    refreshNavCounts();
    if (shouldSkipRemount()) return;
    // Poke the extraction worker once per debounce window — idempotent on
    // the Rust side, but no point firing on every poll tick.
    if (!_dbChangedPokedWorker) {
      _dbChangedPokedWorker = true;
      api.startExtractionWorker().catch(() => {});
    }
    if (_dbChangedTimer) return; // already scheduled
    _dbChangedTimer = setTimeout(() => {
      _dbChangedTimer = null;
      _dbChangedPokedWorker = false;
      // Re-check the skip flag at fire time — user may have navigated to a
      // skip-list route during the debounce window.
      if (shouldSkipRemount()) return;
      try { localStorage.removeItem('gapmap.dashboard.cache.v1'); } catch {}
      route();
    }, 2000);
  });

  // Boot-time health probe: on every launch, confirm the sidecar spawns and
  // the DB/data-dir are writable. If a blocker is detected (sidecar can't
  // start, DB corrupted, etc.) inject a red topbar with a "Run setup again"
  // link. Warnings (LLM not configured) stay silent — welcome step 3 and
  // settings surface those.
  runStartupHealthProbe();

  // MCP auto-bootstrap on app open.
  // Goal: when the app is already activated, proactively verify MCP client
  // wiring (Cursor / Claude Code / Claude Desktop) and self-heal missing
  // installs so users don't have to click Connect every boot.
  //
  // Notes:
  // - This only writes client config entries (mcp install/re-sync). External
  //   MCP clients still need their own process restart to reload config.
  // - Backend commands are activation-gated; if activation is invalid this
  //   gracefully no-ops.
  // - Shared helper at ./lib/mcp_bootstrap.js — same path is called from
  //   welcome.js on first-time activation so MCP connects the moment the
  //   user completes onboarding, not only on next launch.
  // - forceResync=true here because users expect app-open to heal client
  //   config drift every time, even when status was previously "connected".
  (async () => {
    // When activation is required, hold MCP bootstrap until the user is
    // both onboarded AND activated (avoids spawning licensed-only paths
    // for unactivated users). When the gate is OFF, only onboarding
    // matters — bootstrap as soon as the wizard finishes.
    if (!isOnboardingComplete()) return;
    if (isActivationRequired() && !isLicenseActivatedLocally()) return;
    // SKIP MCP install when the .app is running from an ephemeral mount
    // (e.g. /Volumes/Gap Map/…). Writing that path into ~/.claude.json
    // would brick MCP the moment the DMG ejects. Probe via mcp_status
    // which now returns an `ephemeral_app_path` flag; if true, log a
    // clear note and let the user fix it (move to /Applications + relaunch).
    try {
      // Bounded — a wedged daemon used to leave this probe (and thus the whole
      // app-open MCP bootstrap) hanging forever, so MCP never connected and the
      // Settings card sat on "checking…". The Rust daemon now self-heals, but
      // this timeout is a cheap belt-and-braces guard.
      const probe = await Promise.race([
        api.mcpStatus(),
        new Promise((_, rej) => setTimeout(
          () => rej(new Error('mcp status probe timed out after 12s')), 12000)),
      ]);
      if (probe?.ephemeral_app_path) {
        console.warn(
          '[mcp:auto-bootstrap] skipped — app is on an ephemeral path. ' +
          (probe.ephemeral_app_path_hint || 'Move Gap Map.app to /Applications first.'),
        );
        return;
      }
    } catch (e) {
      // If status probe itself fails, fall through — the bootstrap will
      // surface the same error and we get one log line either way.
      console.warn('[mcp:auto-bootstrap] status probe failed', e);
    }
    try {
      const { bootstrapMcpClients } = await import('./lib/mcp_bootstrap.js');
      await bootstrapMcpClients({ tag: 'mcp:auto-bootstrap', forceResync: true });
    } catch (e) {
      console.warn('[mcp:auto-bootstrap] skipped', e);
    }
  })();

  // ── Incremental enrichment: Tauri worker events → reactive pipeline ──
  //
  // Each `enrich:tick` means the Python enrich-worker drained a batch — any
  // topic whose posts were in that batch now has fresh findings in
  // graph_nodes. We bridge to `mutated('findings', …)` so every open screen
  // (findings cache invalidated, gapmap:changed dispatched) re-renders
  // through the existing reactive listener above — no duplicate re-render
  // logic here.
  //
  // `enrich:idle`, `enrich:error`, `enrich:cap-reached`, `enrich:supervisor-
  // gave-up` are dispatched as custom DOM events so specific screens
  // (topic page, settings) can react without listening to the raw Tauri
  // channel. The error / supervisor-gave-up events also drive the
  // dismissible red banner wired up below.
  (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      await listen('enrich:tick', (ev) => {
        import('./api.js').then(({ mutated }) => mutated('findings', ev.payload));
      });
      await listen('enrich:idle', (ev) => {
        window.dispatchEvent(new CustomEvent('gapmap:enrich-idle', { detail: ev.payload }));
      });
      await listen('enrich:error', (ev) => {
        window.dispatchEvent(new CustomEvent('gapmap:enrich-error', { detail: ev.payload }));
        console.warn('[enrich] error:', ev.payload);
      });
      await listen('enrich:cap-reached', (ev) => {
        window.dispatchEvent(new CustomEvent('gapmap:enrich-cap', { detail: ev.payload }));
      });
      await listen('enrich:supervisor-gave-up', (ev) => {
        window.dispatchEvent(new CustomEvent('gapmap:enrich-dead', { detail: ev.payload }));
      });
    } catch (e) {
      // Non-Tauri dev preview or import failure — reactive pipeline will
      // still work for same-process mutations, just not for worker ticks.
      console.warn('[enrich] listener setup failed:', e);
    }
  })();

  // ── Incremental enrichment: dismissible worker-error topbar ──
  //
  // Renders a red banner at the top of #main-content when the worker emits
  // `enrich:error` or the supervisor has given up after MAX restarts. Reuses
  // the `.hc-topbar` style from Phase 16 of the sidecar skill so we don't
  // fork a second red-banner class. "Retry all failed" invokes the (stubbed)
  // `retry_extraction_failures` Rust command; real requeue logic lands in a
  // follow-up task.
  wireEnrichErrorBanner();
});

// ── Enrichment worker error banner ───────────────────────────────────────
//
// Reuses the red `.hc-topbar` CSS. One banner at a time: if the worker
// errors repeatedly the message is updated in place rather than stacking.
// Dismissing removes the banner until the next error event — it will
// re-appear on the next `gapmap:enrich-error` / `gapmap:enrich-dead`.
function wireEnrichErrorBanner() {
  let hostEl = null;
  const render = (msg, { dead = false } = {}) => {
    const main = document.getElementById('main-content');
    if (!main) return;
    // Re-create when missing OR detached: the router replaces #main-content's
    // innerHTML on every tab switch, which orphans a previously-inserted
    // banner. Without the isConnected check we'd write the message into a
    // detached node and the banner would silently never appear on the new tab.
    if (!hostEl || !hostEl.isConnected) {
      hostEl = document.createElement('div');
      hostEl.className = 'hc-topbar enrich-err-topbar';
      main.insertBefore(hostEl, main.firstChild);
    }
    const label = dead
      ? 'Extraction worker stopped after repeated crashes.'
      : 'Extraction error — some posts failed to process.';
    const detail = msg ? ` ${esc(msg)}` : '';
    hostEl.innerHTML = `
      <span>⚠ ${esc(label)}${detail}</span>
      <button id="enrich-err-retry">Retry all failed</button>
      <button id="enrich-err-dismiss" aria-label="Dismiss">Dismiss</button>
    `;
    hostEl.querySelector('#enrich-err-retry').onclick = async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = 'Retrying…';
      try {
        const res = await api.retryAllExtraction();
        // Surface counts so the user knows what happened. The Rust impl
        // returns `{ok, rows_reset, worker_restart_error}` after my fix;
        // older builds return `{ok:true, stub:true}` and we fall through
        // to a generic "queued" message.
        if (res?.stub) {
          btn.textContent = 'Stub — rebuild app';
        } else if (res?.ok) {
          btn.textContent = `✓ Retrying ${res.rows_reset ?? '?'} rows`;
          setTimeout(clearBanner, 1500);
        } else {
          btn.textContent = '✗ Retry failed — see console';
          console.warn('[enrich] retry result:', res);
        }
      } catch (e) {
        btn.textContent = '✗ Retry errored';
        console.warn('[enrich] retry failed:', e);
      } finally {
        setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
      }
    };
    hostEl.querySelector('#enrich-err-dismiss').onclick = clearBanner;
  };
  const clearBanner = () => {
    if (hostEl && hostEl.parentNode) hostEl.parentNode.removeChild(hostEl);
    hostEl = null;
  };

  window.addEventListener('gapmap:enrich-error', (e) => {
    const msg = e?.detail?.message || e?.detail?.detail || '';
    render(msg, { dead: false });
  });
  window.addEventListener('gapmap:enrich-dead', (e) => {
    const msg = e?.detail?.message
      || `Gave up after ${e?.detail?.restarts ?? 3} restarts in ${(e?.detail?.window_secs ?? 300)}s.`;
    render(msg, { dead: true });
  });
  // A successful idle or tick means the worker is healthy — auto-clear.
  window.addEventListener('gapmap:enrich-idle', clearBanner);

  // Task 9.5 — daily token-cap banner. Separate from the enrich-error
  // banner because the recovery path is different: cap-reached means the
  // user needs to raise the cap or wait for midnight; no "retry" button.
  let capEl = null;
  const _capShown = new Set();
  window.addEventListener('gapmap:enrich-cap', (e) => {
    const d = e?.detail || {};
    const topic = d.topic || 'a topic';
    const cap = Number(d.cap || 0).toLocaleString();
    const key = `${d.topic || '*'}@${d.day || ''}`;
    if (_capShown.has(key)) return;
    _capShown.add(key);
    const mainEl = document.getElementById('main-content');
    if (!mainEl) return;
    if (!capEl) {
      capEl = document.createElement('div');
      capEl.className = 'hc-topbar enrich-cap-topbar';
      mainEl.insertBefore(capEl, mainEl.firstChild);
    }
    capEl.innerHTML = `
      <span>⚠ Daily token cap reached for <b>${esc(topic)}</b>${cap ? ` (${esc(cap)} tokens).` : '.'} Extraction paused for this topic.</span>
      <button id="cap-raise">Raise cap</button>
      <button id="cap-pause">Pause until tomorrow</button>
      <button id="cap-dismiss" aria-label="Dismiss">Dismiss</button>
    `;
    capEl.querySelector('#cap-raise').onclick = () => {
      location.hash = '#/settings';
    };
    capEl.querySelector('#cap-pause').onclick = async () => {
      try {
        const until = new Date();
        until.setHours(24, 0, 0, 0);  // next local midnight
        await api.extractionPrefsSet('global', { paused_until: until.toISOString() });
      } catch (err) {
        console.warn('[cap] pause failed:', err);
      }
      capEl?.remove(); capEl = null;
    };
    capEl.querySelector('#cap-dismiss').onclick = () => {
      capEl?.remove(); capEl = null;
    };
  });
}

async function runStartupHealthProbe() {
  let payload;
  try { payload = await runHealthCheck(); }
  catch (e) { payload = { ok: false, sidecar_ok: false, checks: [{ id: 'sidecar', ok: false, detail: String(e) }] }; }
  if (!healthIsBlocking(payload)) return;
  const blocker = (payload.checks || []).find(c => !c.ok && c.level !== 'warn' && c.level !== 'info');
  const detail = blocker?.detail || 'The Python engine did not start. The app cannot fetch or query.';
  const host = document.createElement('div');
  host.className = 'hc-topbar';
  host.innerHTML = `
    <span>⚠ ${esc(detail)}</span>
    <button id="hc-run-setup">Run setup check</button>
  `;
  document.body.insertBefore(host, document.body.firstChild);
  host.querySelector('#hc-run-setup').onclick = () => {
    location.hash = '#/welcome';
    localStorage.setItem('gapmap.onboarding.step', '3');
  };
}

// `hasLlmConfigured` now lives in ./lib/llmStatus.js — imported above so
// every consumer (main, topic, welcome, home) reads the same status shape.

function wireModal() {
  const bd = $('#modal-backdrop');
  // Save which element had focus before opening so we can restore it on close.
  let returnFocusTo = null;
  // Cached intent presets (from api.listIntents) so the start handler + pill
  // clicks can read the picked goal's `collect` profile without a refetch.
  let intentPresets = [];

  // Reflect the selected goal's collect profile in the modal. A goal that pins
  // its own fetch (e.g. thesis → academic sources, fast) hides the Aggressive
  // row and shows a hint; goals without a profile restore the Aggressive row.
  const applyIntentCollectProfile = (key) => {
    const prof = intentPresets.find(p => p.key === key)?.collect || null;
    const aggRow = $('#new-topic-aggressive-row');
    const hint   = $('#new-topic-collect-hint');
    if (prof) {
      if (aggRow) aggRow.hidden = true;
      if (hint) {
        hint.hidden = false;
        hint.innerHTML = `<i data-lucide="sparkles"></i> Fetches ${prof.summary || 'a focused source set'}${prof.eta ? ` · ${prof.eta}` : ''}`;
        window.refreshIcons?.();
      }
    } else {
      if (aggRow) aggRow.hidden = false;
      if (hint) { hint.hidden = true; hint.innerHTML = ''; }
    }
  };
  const focusableSelector =
    'input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])';
  const open  = () => {
    // Warm the LLM the moment the New-topic modal opens — the user spends a few
    // seconds typing + picking an intent, which is free lead time to load the
    // model so the first collect's canonicalize is hot (not a 30-60s cold
    // start). Complements the app-launch prewarm; fire-and-forget, fail-soft.
    try { api.warmLlm?.(); } catch {}
    // Honour the user's "aggressive by default" preference from Settings.
    const aggPref = localStorage.getItem('gapmap.pref.aggressive') !== 'false';
    const cb = $('#new-topic-aggressive');
    if (cb) cb.checked = aggPref;
    returnFocusTo = document.activeElement;
    bd.hidden = false;
    // Populate intent picker on every open so new presets appear without
    // refresh. Idempotent — api.listIntents() is TTL-cached.
    renderIntentPills();
    setTimeout(() => $('#new-topic-input')?.focus(), 50);
  };

  // Intent pill renderer — single source of truth lives in Python's
  // `research/intents.py`, surfaced here via api.listIntents(). Selected
  // intent is stored in localStorage so consecutive new-topics default to
  // the user's most recent choice.
  async function renderIntentPills() {
    const host = $('#new-topic-intent-pills');
    if (!host) return;
    let presets = [];
    try { presets = await api.listIntents(); } catch { presets = []; }
    intentPresets = presets;
    if (!presets.length) {
      // Graceful degradation if the Python side isn't available — hide the
      // picker and let the user create a topic like before (defaults apply).
      $('#new-topic-intent-wrap')?.setAttribute('hidden', '');
      return;
    }
    const picked = localStorage.getItem('gapmap.new_topic.intent') || 'market-report';
    host.innerHTML = presets.map(p => `
      <button type="button" class="intent-pill ${p.key === picked ? 'is-selected' : ''}"
              data-intent="${p.key}"
              title="${(p.tagline || '').replace(/"/g, '&quot;')}">
        <i data-lucide="${p.icon || 'target'}"></i>
        <span>${p.label}</span>
      </button>
    `).join('');
    window.refreshIcons?.();
    host.querySelectorAll('.intent-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        host.querySelectorAll('.intent-pill').forEach(b => b.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        localStorage.setItem('gapmap.new_topic.intent', btn.dataset.intent);
        applyIntentCollectProfile(btn.dataset.intent);
      });
    });
    // Reflect the initially-selected goal's profile on (re)render.
    applyIntentCollectProfile(picked);
  }
  const close = () => {
    bd.hidden = true;
    $('#new-topic-input').value = '';
    if (returnFocusTo && typeof returnFocusTo.focus === 'function') {
      returnFocusTo.focus();
      returnFocusTo = null;
    }
  };
  $('#modal-cancel').onclick = close;
  // Backdrop click closes (if clicked directly, not a child)
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  // Escape closes; Tab is trapped inside the modal while it's open.
  document.addEventListener('keydown', e => {
    if (bd.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Enter' && document.activeElement === $('#new-topic-input')) {
      $('#modal-start').click();
      return;
    }
    if (e.key === 'Tab') {
      const focusables = [...bd.querySelectorAll(focusableSelector)]
        .filter(el => !el.disabled && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  });
  $('#modal-start').onclick = async () => {
    const startBtn = $('#modal-start');
    const cancelBtn = $('#modal-cancel');
    const input = $('#new-topic-input');
    const topic = normalizeTopicInput(input.value);
    input.value = topic;
    if (!topic) {
      input.focus();
      return;
    }
    // P1-5 — reject topic names that'll break downstream SQL/URLs.
    if (!/^[a-zA-Z0-9 _\-]{2,60}$/.test(topic)) {
      alert('Topic name must be 2-60 chars, letters/numbers/spaces/hyphens/underscores only.');
      input.focus();
      return;
    }
    const aggressiveChecked = $('#new-topic-aggressive').checked;
    // The picked goal may pin its own collect profile (e.g. thesis → academic
    // sources, skip-reddit, non-aggressive). When present it OVERRIDES the
    // Aggressive checkbox — this is the fix for "picking 'research paper' still
    // ran the full all-sources + historical sweep".
    const pickedIntent = localStorage.getItem('gapmap.new_topic.intent') || 'market-report';
    const collectProf  = intentPresets.find(p => p.key === pickedIntent)?.collect || null;
    const aggressive   = collectProf ? !!collectProf.aggressive : aggressiveChecked;

    // P0-3 — if no LLM is configured, painpoints won't be extracted. Warn the
    // user up front rather than letting them reach a blank gap-map later.
    if (aggressive && !(await hasLlmConfigured())) {
      const go = await confirmModal({
        title: 'No LLM key configured',
        body: 'Collect will fetch posts but won\'t extract painpoints, features, or '
          + 'workarounds — the gap map will show sources only. Continue without AI?',
        confirmLabel: 'Continue without AI',
        cancelLabel: 'Add a key first',
      });
      if (!go) {
        close();
        location.hash = '#/settings';
        return;
      }
    }

    // One-shot collect params for collect.js (it reads + clears these on mount).
    localStorage.setItem('gapmap.collect.last_aggressive', aggressive ? 'true' : 'false');
    if (collectProf) {
      const wantsReddit = !collectProf.skip_reddit;
      const hasExternal = !!(collectProf.sources && collectProf.sources.trim());
      if (wantsReddit && hasExternal) {
        // TWO-PHASE: Phase 1 runs the fast external sources with Reddit SKIPPED
        // so the graph + AI conclusions appear in ~2-3 min. redditEnrich then
        // kicks a background Reddit-only pass on Phase-1 collect:done, and the
        // enrich worker folds those posts into the graph incrementally.
        localStorage.setItem('gapmap.collect.last_sources', collectProf.sources);
        localStorage.setItem('gapmap.collect.last_skip_reddit', 'true');
        markRedditPending(effectiveTopic, { aggressive });
      } else {
        localStorage.setItem('gapmap.collect.last_sources',     collectProf.sources || '');
        localStorage.setItem('gapmap.collect.last_skip_reddit', collectProf.skip_reddit ? 'true' : 'false');
      }
    } else {
      // No goal profile → don't pin sources; remember the user's aggressive pref.
      localStorage.removeItem('gapmap.collect.last_sources');
      localStorage.removeItem('gapmap.collect.last_skip_reddit');
      localStorage.setItem('gapmap.pref.aggressive', aggressive ? 'true' : 'false');
    }

    // Pre-check: does a semantically-identical topic (same loose / slug
    // normalization) already exist? If yes, ASK the user — we never
    // silently merge. They get three choices: open the existing one,
    // augment it with more data, or create a separate topic anyway.
    let effectiveTopic = topic;
    try {
      const chk = await api.findExistingTopic(topic);
      const existing = chk?.match?.existing_topic;
      const existingPosts = chk?.match?.posts || 0;
      if (existing) {
        const useExisting = await confirmModal({
          title: `Topic "${existing}" already exists`,
          body: `It has ${existingPosts} posts. Open the existing topic (recommended), or `
            + `create a separate new topic anyway. (To add more data to the existing one, `
            + `open it then click "Re-collect".)`,
          confirmLabel: 'Open existing',
          cancelLabel: 'Create new',
        });
        if (useExisting) {
          close();
          location.hash = `#/topic/${encodeURIComponent(existing)}`;
          return;
        }
        // else: user explicitly wants a separate topic — use their typed form
        effectiveTopic = topic;
      }
    } catch {
      // Pre-check best-effort — don't block the collect on a sidecar hiccup
    }

    // Persist the picked intent BEFORE the collect kicks off so the topic
    // opens to the right default tab the first time the user visits it.
    // (pickedIntent was resolved above to drive the collect profile.)
    try {
      await api.topicIntentSet(effectiveTopic, pickedIntent);
    } catch {
      // Non-fatal — default is 'product-new' when missing, matching current behaviour.
    }

    close();
    const slug = encodeURIComponent(effectiveTopic);
    location.hash = `#/collect/${slug}`;
    setTimeout(() =>
      window.dispatchEvent(new CustomEvent('gapmap:start-collect', { detail: { topic: effectiveTopic, aggressive } })),
      100,
    );
  };
  window.gapmapOpenNewTopic = open;
}

function wireKeyboard() {
  const focusAdjacentTab = (dir) => {
    const tabs = tabStore.getAll();
    const active = tabStore.getActive();
    if (!tabs.length || !active) return false;
    const idx = tabs.findIndex(t => t.id === active.id);
    if (idx < 0) return false;
    const nextIdx = dir < 0
      ? (idx - 1 + tabs.length) % tabs.length
      : (idx + 1) % tabs.length;
    const target = tabs[nextIdx];
    if (!target || target.id === active.id) return false;
    tabStore.focus(target.id);
    return true;
  };
  // Temporary key-event debugger for shortcut mapping issues.
  // Enable with localStorage.setItem('gapmap.debug.keys','true') in DevTools.
  const keyDebugEnabled = localStorage.getItem('gapmap.debug.keys') === 'true';
  let keyDebugEl = null;
  const showKeyDebug = (e) => {
    if (!keyDebugEnabled) return;
    if (!keyDebugEl) {
      keyDebugEl = document.createElement('div');
      keyDebugEl.style.cssText = [
        'position:fixed', 'right:12px', 'bottom:12px', 'z-index:99999',
        'background:rgba(20,20,20,.92)', 'color:#fff', 'padding:10px 12px',
        'border-radius:10px', 'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
        'max-width:520px', 'box-shadow:0 8px 24px rgba(0,0,0,.3)',
      ].join(';');
      document.body.appendChild(keyDebugEl);
    }
    keyDebugEl.textContent =
      `key=${e.key} code=${e.code} keyCode=${e.keyCode} ` +
      `meta=${!!e.metaKey} ctrl=${!!e.ctrlKey} alt=${!!e.altKey} shift=${!!e.shiftKey}`;
  };
  document.addEventListener('keydown', e => {
    showKeyDebug(e);
    // Bail on any shortcut when the user is actively editing text — avoids
    // hijacking ? / n while they're typing in a form.
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    // Cmd/Ctrl+N → new topic
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      window.gapmapOpenNewTopic?.();
      return;
    }
    // Cmd/Ctrl+, → settings
    if ((e.metaKey || e.ctrlKey) && e.key === ',') {
      e.preventDefault();
      location.hash = '#/settings';
      return;
    }
    // Cmd/Ctrl+K → global search (Phase 5 surface) — routes to /find, which
    // is the existing global-search screen.
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      location.hash = '#/find';
      return;
    }
    // Cmd/Ctrl+Shift+V → paste video URL screen.
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      location.hash = '#/ingest-video';
      return;
    }
    // ? (shift+/) → shortcuts help, unless the user is typing.
    if (!typing && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
      e.preventDefault();
      openShortcutsHelp();
    }
    // J/K — navigate expanded hypothesis cards on Insights tab.
    if (!typing && (e.key === 'j' || e.key === 'k')) {
      const cards = Array.from(document.querySelectorAll('.hyp-card'));
      if (!cards.length) return;
      const openIdx = cards.findIndex(c => c.hasAttribute('open'));
      let nextIdx = e.key === 'j'
        ? Math.min(cards.length - 1, (openIdx < 0 ? -1 : openIdx) + 1)
        : Math.max(0, (openIdx < 0 ? cards.length : openIdx) - 1);
      cards.forEach((c, i) => { if (i === nextIdx) c.setAttribute('open', ''); else c.removeAttribute('open'); });
      cards[nextIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      e.preventDefault();
    }
  });

  // Chrome-like shortcuts (⌘T / ⌘W / ⌘⇧T / ⌘1..⌘9 / ⌘R / ⌘⇧R + tab nav) live in
  // their own listener because
  // they're window-level operations that should fire even while the user is
  // typing — unlike the editor-style shortcuts above (?, j/k) which must
  // respect the typing guard. preventDefault() runs BEFORE tabStore ops so
  // the browser/macOS never gets a chance to handle ⌘W as "close window".
  document.addEventListener('keydown', e => {
    showKeyDebug(e);
    const meta = e.metaKey || e.ctrlKey;
    const isCmd = !!e.metaKey;
    const isCtrlOnly = !!e.ctrlKey && !e.metaKey;
    if (!meta && !isCtrlOnly) return;

    if (e.key === 't' && !e.shiftKey) {
      e.preventDefault();
      tabStore.open({ hash: '#/' });
      return;
    }
    if (e.key === 'w') {
      e.preventDefault();
      const a = tabStore.getActive();
      if (a) tabStore.close(a.id);
      return;
    }
    // Sidebar minimize cycle: full → rail → hidden → full. Lives in the
    // same Chrome-style listener (fires while typing in inputs, no guard)
    // so it's consistent with ⌘W / ⌘R. Browsers don't use ⌘B as a global
    // shortcut and the app has no bold-text editor surface to compete
    // with, so the override is safe. See `cycleSidebar` in initSidebarMinimize.
    if (e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      window.__cycleSidebar?.();
      return;
    }
    // Chrome-like refresh of the current route.
    if ((e.key === 'r' || e.key === 'R') && !e.shiftKey) {
      e.preventDefault();
      route();
      return;
    }
    // Chrome-like hard refresh: drop API cache + dashboard cache, then re-render.
    if ((e.key === 'r' || e.key === 'R') && e.shiftKey) {
      e.preventDefault();
      clearApiCache();
      try { localStorage.removeItem('gapmap.dashboard.cache.v1'); } catch {}
      route();
      return;
    }
    // Chrome-style previous/next tab navigation (Cmd+Shift+[ / ]).
    if (e.shiftKey && (e.key === '[' || e.key === '{')) {
      e.preventDefault();
      const tabs = tabStore.getAll();
      const active = tabStore.getActive();
      if (!tabs.length || !active) return;
      const idx = tabs.findIndex(t => t.id === active.id);
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
      if (prev) tabStore.focus(prev.id);
      return;
    }
    if (e.shiftKey && (e.key === ']' || e.key === '}')) {
      e.preventDefault();
      const tabs = tabStore.getAll();
      const active = tabStore.getActive();
      if (!tabs.length || !active) return;
      const idx = tabs.findIndex(t => t.id === active.id);
      const next = tabs[(idx + 1) % tabs.length];
      if (next) tabStore.focus(next.id);
      return;
    }
    // Chrome-style tab cycling: Ctrl+Tab / Ctrl+Shift+Tab.
    // (Cmd+Tab is OS-level app switch and should not be hijacked.)
    if (isCtrlOnly && e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const tabs = tabStore.getAll();
      const active = tabStore.getActive();
      if (!tabs.length || !active) return;
      const idx = tabs.findIndex(t => t.id === active.id);
      const next = tabs[(idx + 1) % tabs.length];
      if (next) tabStore.focus(next.id);
      return;
    }
    if (isCtrlOnly && e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
    // Chrome on macOS also supports Cmd+Option+Left/Right to move across tabs.
    // Tauri/WebView can vary between `key` and `code` reporting, so we accept both.
    const isNavLeft = e.key === 'ArrowLeft' || e.code === 'ArrowLeft' || e.keyCode === 37;
    const isNavRight = e.key === 'ArrowRight' || e.code === 'ArrowRight' || e.keyCode === 39;
    // WebKit/Tauri can report arrows as legacy keyIdentifier/keyCode.
    const isLegacyLeft = e.keyIdentifier === 'Left' || e.which === 37 || e.keyCode === 63234;
    const isLegacyRight = e.keyIdentifier === 'Right' || e.which === 39 || e.keyCode === 63235;
    const navLeft = isNavLeft || isLegacyLeft;
    const navRight = isNavRight || isLegacyRight;

    if ((isCmd || isCtrlOnly) && e.altKey && navLeft) {
      e.preventDefault();
      focusAdjacentTab(-1);
      return;
    }
    if ((isCmd || isCtrlOnly) && e.altKey && navRight) {
      e.preventDefault();
      focusAdjacentTab(1);
      return;
    }
    // Additional fallback path in case Option-modified arrows are swallowed by
    // the platform: Cmd+Shift+Arrow cycles tabs too.
    if (isCmd && e.shiftKey && navLeft) {
      e.preventDefault();
      focusAdjacentTab(-1);
      return;
    }
    if (isCmd && e.shiftKey && navRight) {
      e.preventDefault();
      focusAdjacentTab(1);
      return;
    }
    // Chrome-style history navigation.
    if (isCmd && !e.shiftKey && (e.key === '[' || e.key === ']')) {
      e.preventDefault();
      if (e.key === '[') history.back();
      else history.forward();
      return;
    }
      const tabs = tabStore.getAll();
      const active = tabStore.getActive();
      if (!tabs.length || !active) return;
      const idx = tabs.findIndex(t => t.id === active.id);
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
      if (prev) tabStore.focus(prev.id);
      return;
    }
    // Address-bar-like action: open New Topic and focus input.
    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      window.gapmapOpenNewTopic?.();
      return;
    }
    // Find-in-page style focus: first visible search input in current screen.
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      const candidates = Array.from(document.querySelectorAll(
        'input[type="search"], input[id*="filter"], input[placeholder*="Filter"], input[placeholder*="Search"]'
      ));
      const target = candidates.find(el => el.offsetParent !== null && !el.disabled);
      if (target) {
        target.focus();
        target.select?.();
      }
      return;
    }
    if (e.shiftKey && (e.key === 'T' || e.key === 't')) {
      e.preventDefault();
      tabStore.reopenLastClosed();
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      const all = tabStore.getAll();
      const idx = e.key === '9' ? all.length - 1 : (parseInt(e.key, 10) - 1);
      const tab = all[idx];
      if (tab) tabStore.focus(tab.id);
    }
  });
}

function openShortcutsHelp() {
  if (document.querySelector('#shortcuts-help')) return;
  const host = document.createElement('div');
  host.id = 'shortcuts-help';
  host.className = 'modal-backdrop';
  host.hidden = false;
  host.innerHTML = `
    <div class="modal" style="max-width:460px">
      <h3>Keyboard shortcuts</h3>
      <p class="modal-sub">The basics — more coming soon.</p>
      <div class="shortcuts-list">
        <div class="shortcut-row"><kbd>⌘ N</kbd> <span>New topic</span></div>
        <div class="shortcut-row"><kbd>⌘ ⇧ V</kbd> <span>Paste video URL to ingest</span></div>
        <div class="shortcut-row"><kbd>⌘ K</kbd> <span>Global search / find anything</span></div>
        <div class="shortcut-row"><kbd>⌘ L</kbd> <span>Open quick topic input</span></div>
        <div class="shortcut-row"><kbd>⌘ F</kbd> <span>Focus current screen filter/search</span></div>
        <div class="shortcut-row"><kbd>⌘ R</kbd> <span>Refresh current tab</span></div>
        <div class="shortcut-row"><kbd>⌘ ⇧ R</kbd> <span>Hard refresh (clear cache + refresh)</span></div>
        <div class="shortcut-row"><kbd>⌘ ⇧ [</kbd> / <kbd>⌘ ⇧ ]</kbd> <span>Previous / next tab</span></div>
        <div class="shortcut-row"><kbd>⌘ ⌥ ←</kbd> / <kbd>⌘ ⌥ →</kbd> <span>Previous / next tab</span></div>
        <div class="shortcut-row"><kbd>Ctrl Tab</kbd> / <kbd>Ctrl ⇧ Tab</kbd> <span>Cycle tabs</span></div>
        <div class="shortcut-row"><kbd>⌘ [</kbd> / <kbd>⌘ ]</kbd> <span>Back / forward</span></div>
        <div class="shortcut-row"><kbd>⌘ 1…9</kbd> <span>Jump to tab (9 = last)</span></div>
        <div class="shortcut-row"><kbd>⌘ ,</kbd> <span>Open Settings</span></div>
        <div class="shortcut-row"><kbd>⌘ /</kbd> <span>Toggle chat sidebar on Insights</span></div>
        <div class="shortcut-row"><kbd>J</kbd> / <kbd>K</kbd> <span>Next / previous hypothesis card</span></div>
        <div class="shortcut-row"><kbd>?</kbd> <span>Open this panel</span></div>
        <div class="shortcut-row"><kbd>Esc</kbd> <span>Close any open dialog</span></div>
        <div class="shortcut-row"><kbd>Enter</kbd> <span>Submit the focused form</span></div>
        <div class="shortcut-row"><kbd>Tab</kbd> / <kbd>⇧ Tab</kbd> <span>Cycle focus within a modal</span></div>
      </div>
      <div class="modal-actions" style="justify-content:flex-end">
        <button class="btn btn-primary btn-sm" id="shortcuts-close">Got it</button>
      </div>
    </div>
  `;
  document.body.appendChild(host);
  const returnFocusTo = document.activeElement;
  const close = () => {
    host.remove();
    document.removeEventListener('keydown', escHandler);
    if (returnFocusTo?.focus) returnFocusTo.focus();
  };
  function escHandler(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
  document.addEventListener('keydown', escHandler);
  host.addEventListener('click', e => { if (e.target === host) close(); });
  host.querySelector('#shortcuts-close').onclick = close;
  setTimeout(() => host.querySelector('#shortcuts-close')?.focus(), 10);
}

/* ────────────────────────────────────────────────────────────────────────
   Sidebar minimize — full ⇄ rail toggle (header button never fully HIDES
   the sidebar — that was the "icon click hides the whole sidebar with no
   way back" bug). A third "hidden" state still exists for completeness and
   is restorable via the always-visible floating reveal button
   (#sidebar-reveal-strip), but the header toggle + ⌘B only swing between
   full and rail so the sidebar can never vanish without an obvious control
   to bring it back.
   Persisted to localStorage so the choice survives reload + new tabs.
   Triggered:
     1. Click the toggle button in the sidebar header (#sidebar-toggle) → full⇄rail.
     2. ⌘B / Ctrl+B (Chrome-style keydown listener → window.__cycleSidebar) → full⇄rail.
     3. Click the floating reveal button (#sidebar-reveal-strip), visible only
        in the "hidden" state, always jumps back to "full".
   ──────────────────────────────────────────────────────────────────── */
// States the header toggle / ⌘B cycle through. "hidden" is intentionally
// NOT here so the sidebar never disappears from a header click.
const SIDEBAR_TOGGLE_STATES = ['full', 'rail'];
// All valid states applySidebarState will accept (hidden is set on restore
// or by legacy persisted values; the floating button brings it back).
const SIDEBAR_VALID_STATES = ['full', 'rail', 'hidden'];
const SIDEBAR_LS_KEY = 'gapmap.sidebarState.v1';

// Per-state metadata: which lucide icon the toggle button shows AND what
// the title attribute reads. Both describe the NEXT state the click will
// produce (so users know what they're about to do). `panel-left-close`
// reads "click to close" in lucide conventions, `panel-left-open` is the
// expand-back arrow.
const SIDEBAR_NEXT_META = {
  full:   { icon: 'panel-left-close',  label: 'Collapse to icons' },
  rail:   { icon: 'panel-left-open',   label: 'Expand sidebar' },
  hidden: { icon: 'panel-left-open',   label: 'Show sidebar' },
};

function applySidebarState(state) {
  if (!SIDEBAR_VALID_STATES.includes(state)) state = 'full';
  document.body.setAttribute('data-sidebar', state);
  try { localStorage.setItem(SIDEBAR_LS_KEY, state); } catch {}
  const btn = document.getElementById('sidebar-toggle');
  if (btn) {
    const meta = SIDEBAR_NEXT_META[state] || SIDEBAR_NEXT_META.full;
    btn.title = `${meta.label} (⌘B)`;
    btn.setAttribute('aria-label', meta.label);
    const i = btn.querySelector('i[data-lucide]');
    if (i) {
      i.setAttribute('data-lucide', meta.icon);
      // refreshIcons is the wrapper around lucide.createIcons used
      // everywhere else when re-rendering icons dynamically.
      window.refreshIcons?.();
    }
  }
  // Synchronous reflow after grid track / grid-column changes (hidden ↔ full).
  void document.body.offsetWidth;
  const mainCol = document.querySelector('.app > .main-col');
  if (mainCol) void mainCol.offsetWidth;
}

function cycleSidebar() {
  // Header toggle / ⌘B only swing full ⇄ rail. If we're somehow in "hidden"
  // (restored from a legacy persisted value), treat this as "show" → full.
  const cur = document.body.getAttribute('data-sidebar') || 'full';
  if (cur === 'hidden') { applySidebarState('full'); return; }
  const idx = SIDEBAR_TOGGLE_STATES.indexOf(cur);
  const next = SIDEBAR_TOGGLE_STATES[(idx + 1) % SIDEBAR_TOGGLE_STATES.length];
  applySidebarState(next);
}

function initSidebarMinimize() {
  // Restore last state (or default to "full" for first-time users / when
  // localStorage is blocked, e.g. webview with cookies disabled).
  let saved = 'full';
  try {
    const s = localStorage.getItem(SIDEBAR_LS_KEY);
    if (s && SIDEBAR_VALID_STATES.includes(s)) saved = s;
  } catch {}
  applySidebarState(saved);

  document.getElementById('sidebar-toggle')?.addEventListener('click', cycleSidebar);
  wireSidebarSearch();
  // Reveal strip always jumps back to "full" — see the comment block at
  // the top of this section for the rationale (cycling to "rail" first
  // is a confusing UX when the user just clicked "show me the sidebar").
  document.getElementById('sidebar-reveal-strip')?.addEventListener('click', () => {
    applySidebarState('full');
  });

  // Expose for the ⌘B handler in the Chrome-style keydown listener.
  // Using a window-scoped function (rather than direct import) keeps the
  // listener registration site short and avoids reshuffling the existing
  // shortcut block.
  window.__cycleSidebar = cycleSidebar;
}

// Apple-style live filter over the sidebar nav. Hides non-matching links and
// any section label whose items all hid; Esc clears.
function wireSidebarSearch() {
  const input = document.getElementById('sidebar-search');
  const sidebar = document.querySelector('.sidebar');
  if (!input || !sidebar) return;
  const items = Array.from(sidebar.querySelectorAll('a[data-route]'));
  const labels = Array.from(sidebar.querySelectorAll('.nav-section-label'));
  const apply = () => {
    const q = input.value.trim().toLowerCase();
    items.forEach((a) => {
      const txt = (a.textContent || '').toLowerCase();
      a.style.display = (!q || txt.includes(q)) ? '' : 'none';
    });
    labels.forEach((label) => {
      if (!q) { label.style.display = ''; return; }
      let nav = label.nextElementSibling;
      while (nav && !nav.classList.contains('nav')) nav = nav.nextElementSibling;
      const visible = nav
        ? Array.from(nav.querySelectorAll('a[data-route]')).some((a) => a.style.display !== 'none')
        : false;
      label.style.display = visible ? '' : 'none';
    });
  };
  input.addEventListener('input', apply);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; apply(); } });
}

// Kick off after DOMContentLoaded so the sidebar markup definitely exists.
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initSidebarMinimize, { once: true });
} else {
  initSidebarMinimize();
}
