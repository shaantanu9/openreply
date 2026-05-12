import { api, $, $$, esc, clearApiCache } from './api.js';
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
import { renderReports } from './screens/reports.js';
import { renderWelcome, isOnboardingComplete } from './screens/welcome.js';
import { renderActivity } from './screens/activity.js';
import { renderDatabase } from './screens/database.js';
import { renderScience } from './screens/science.js';
import { renderSearch } from './screens/search.js';
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
  if (h.startsWith('/estimate'))      return 'estimate';
  if (h.startsWith('/prd'))           return 'prd';
  if (h.startsWith('/settings'))      return 'settings';
  return '';
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
import { runHealthCheck, healthIsBlocking } from './lib/healthCheck.js';
import { tabStore, renderTabStrip, titleForHash, iconForHash } from './lib/tabs.js';
// ── AG-D: compare view ──
import { renderCompare } from './screens/compare.js';
// ── AG-C: global competitors (T2.5) ──
import { renderGlobalCompetitors } from './screens/global_competitors.js';
// ── Global collect status bar (running + queue) ──
import { mountCollectStatusBar } from './components/CollectStatusBar.js';
// ── Persona agents (Phase 1 — 2026-05-12) ──
import { renderPersonas, renderPersona } from './screens/personas.js';

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
  { match: /^\/ingest\/?$/,         render: renderIngest },
  { match: /^\/ingest-video(?:\?.*)?\/?$/, render: renderIngestVideo },
  { match: /^\/reports\/?$/,        render: renderReports },
  { match: /^\/activity\/?$/,       render: renderActivity },
  { match: /^\/database\/?$/,       render: renderDatabase },
  { match: /^\/science\/?$/,        render: renderScience },
  { match: /^\/search\/?$/,         render: renderSearch },
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
  { match: /^\/estimate\/([^/?]+).*$/,      render: renderEstimate },
  { match: /^\/prd\/([^/?]+).*$/,           render: renderPrd },
  // ── Persona agents (Phase 1 — 2026-05-12) ──
  { match: /^\/personas\/?$/,               render: renderPersonas },
  { match: /^\/persona\/([0-9]+)\/?$/,      render: renderPersona },
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

function mustStayInOnboarding() {
  return !isOnboardingComplete() || !isLicenseActivatedLocally();
}

async function route() {
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
  } catch {}
})();

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
    if (!isOnboardingComplete() || !isLicenseActivatedLocally()) {
      location.hash = '#/welcome';
    } else {
      location.hash = '#/';
    }
  }

  // Hard gate: every boot must have a valid local activation marker, and if
  // Rust state disagrees we force the user back to activation.
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
      // If license server/sidecar is unavailable, keep existing session locked
      // to last known activation marker and continue.
    }
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
      // Avoid remounting the in-flight collect screen. Re-rendering the same
      // route mid-collect can duplicate listeners and cause action-footer
      // button state to appear inconsistent until a manual refresh.
      const onCollectRoute = /^#\/collect\/[^/]+/.test(location.hash || '');
      // Topic screen manages its own reactive refreshes per tab; forcing a full
      // route() remount here resets tab state back to default and feels like
      // "Map click bounced to Home". Let topic.js own in-place updates.
      const onTopicRoute = /^#\/topic\/[^/?]+/.test(location.hash || '');
      if (onCollectRoute || onTopicRoute) return;
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
    if (kind === 'collect') {
      api.startExtractionWorker().catch(() => {});
    }
  });

  // External-writer bridge: when the DB-mtime poller in api.js sees that
  // reddit.db changed outside this process (MCP server, CLI, another Tauri
  // window, background collect from a scheduled task), translate that into
  // a `gapmap:changed` event so the same re-render path fires.
  //
  // Without this, MCP tools like `reddit_start_collect` successfully write
  // topics/posts to the shared SQLite but the GUI renders stale cached data
  // until the user manually navigates.
  window.addEventListener('gapmap:db-changed', () => {
    refreshNavCounts();
    // Skip remount on collect/topic routes — they own their own reactive
    // refreshes and a route() rerun would nuke in-place tab state.
    const onCollectRoute = /^#\/collect\/[^/]+/.test(location.hash || '');
    const onTopicRoute = /^#\/topic\/[^/?]+/.test(location.hash || '');
    if (onCollectRoute || onTopicRoute) return;
    try { localStorage.removeItem('gapmap.dashboard.cache.v1'); } catch {}
    route();
    // Poke the extraction worker in case the external write pushed a topic
    // past the enrichment threshold — idempotent.
    api.startExtractionWorker().catch(() => {});
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
    if (!isOnboardingComplete() || !isLicenseActivatedLocally()) return;
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
    if (!hostEl) {
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
  const focusableSelector =
    'input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])';
  const open  = () => {
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
    if (!presets.length) {
      // Graceful degradation if the Python side isn't available — hide the
      // picker and let the user create a topic like before (defaults apply).
      $('#new-topic-intent-wrap')?.setAttribute('hidden', '');
      return;
    }
    const picked = localStorage.getItem('gapmap.new_topic.intent') || 'product-new';
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
      });
    });
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
    const aggressive = $('#new-topic-aggressive').checked;

    // P0-3 — if no LLM is configured, painpoints won't be extracted. Warn the
    // user up front rather than letting them reach a blank gap-map later.
    if (aggressive && !(await hasLlmConfigured())) {
      const go = confirm(
        'No LLM key is configured. Collect will fetch posts but won\'t extract '
        + 'painpoints, features, or workarounds — the gap map will show sources only.\n\n'
        + 'Continue without AI? (Cancel to add a key first in Settings.)'
      );
      if (!go) {
        close();
        location.hash = '#/settings';
        return;
      }
    }

    localStorage.setItem('gapmap.collect.last_aggressive', aggressive ? 'true' : 'false');
    localStorage.setItem('gapmap.pref.aggressive',          aggressive ? 'true' : 'false');

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
        const msg = `A topic "${existing}" with ${existingPosts} posts already exists.\n\n`
          + `Click OK to open the existing topic (recommended).\n`
          + `Click Cancel to create a separate new topic anyway.\n\n`
          + `(To add more data to the existing one, open it then click "Re-collect".)`;
        const useExisting = confirm(msg);
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
    const pickedIntent = localStorage.getItem('gapmap.new_topic.intent') || 'product-new';
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
