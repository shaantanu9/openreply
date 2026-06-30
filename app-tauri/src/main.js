// OpenReply — SPA router for the Tauri app.
// Wired screens (agents/agent/opportunities/compose) render LIVE data via the Rust
// command bridge (or/dynamic.js → or/api.js → commands.rs → openreply reply/agent/content).
// The rest render the static prototype views (or/views.js). In a plain browser (no Tauri)
// everything falls back to the static views.

// Bundled styling + icons. Previously Tailwind and Lucide loaded from public
// CDNs (cdn.tailwindcss.com / unpkg.com) at runtime — that left the packaged
// app completely unstyled (no CSS, no icons) on any machine where the webview
// couldn't reach those CDNs. Both are now bundled locally so the app renders
// identically offline and in the signed build.
import "./styles.css";
import { createIcons, icons } from "lucide";
// Re-expose the global the existing call sites (shell.js drawIcons, dynamic.js)
// already use, so no other file needs to change how it requests icons.
window.lucide = { createIcons: (opts = {}) => createIcons({ icons, ...opts }) };

import { VIEWS } from "./or/views.js";
import { mountShell, drawIcons } from "./or/shell.js";
import { api, esc } from "./or/api.js";
import { DYN, ensureBotPoller } from "./or/dynamic.js";
import { skeletonFor } from "./or/skeleton.js";
import { tabStore, titleForHash, renderTabStrip } from "./lib/tabs.js";
import * as contextMenu from "./lib/contextMenu.js";

const HOME_HASH = '#/agents';

function currentKey() {
  const h = (location.hash || "").replace(/^#\/?/, "").split(/[?#]/)[0];
  return h || "agents";
}

// Screens that own the whole window (no sidebar): the onboarding wizard.
const FULL_SCREENS = new Set(["welcome"]);

// Open-source builds have no license gate. On first launch the onboarding
// wizard is shown; otherwise the requested route is used as-is.
async function gateCheck(reqKey) {
  if (!api.isTauri()) return reqKey;
  if (reqKey === "activate") return "agents";
  if (!localStorage.getItem("or-onboarded")) return "welcome";
  if (reqKey === "welcome") return "agents";
  return reqKey;
}

// Per-tab render bookkeeping. Each tab gets its own persistent portal element
// inside #main-content; switching tabs shows/hides portals instead of destroying
// DOM, so background work (commands, polling, timers) keeps running.
const tabRenderQueue = new Map();

function getTabPortal(tabId) {
  const host = document.getElementById("main-content");
  if (!host) return null;
  let el = host.querySelector(`div[data-tab-id="${CSS.escape(tabId)}"]`);
  if (!el) {
    el = document.createElement("div");
    el.className = "tab-view w-full max-w-6xl flex-1 px-8 py-7";
    el.dataset.tabId = tabId;
    host.appendChild(el);
  }
  return el;
}

function cleanupTabPortal(tabId) {
  const host = document.getElementById("main-content");
  const el = host?.querySelector(`div[data-tab-id="${CSS.escape(tabId)}"]`);
  if (el) {
    if (el.__orCleanup) { try { el.__orCleanup(); } catch (e) { console.error("[cleanup]", e); } }
    el.remove();
  }
  tabRenderQueue.delete(tabId);
}

async function render() {
  const hash = location.hash || HOME_HASH;
  const active = tabStore.getActive();
  if (!active) return;

  // Reconcile: the hash we're landing on must belong to the active tab.
  // If the user clicked a sidebar link (which changed the hash directly),
  // replace the current tab's hash in-place (Chrome-like default). If another
  // tab already owns this hash, focus it instead.
  if (active.hash !== hash) {
    const owner = tabStore.getAll().find((t) => t.hash === hash);
    if (owner) {
      tabStore.focus(owner.id);
      return; // focus subscription will re-run render for the focused tab
    }
    tabStore.setActiveHash(hash);
    // Keep the URL in sync so the subscriber below doesn't double-render.
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  const tabId = active.id;
  const portal = getTabPortal(tabId);
  if (!portal) return;

  // Serialize renders per tab so two rapid navigations on the same tab don't
  // interleave and leave stale DOM. Renders for different tabs run in parallel.
  const previous = tabRenderQueue.get(tabId) || Promise.resolve();
  const current = previous.then(async () => {
    const key = await gateCheck(currentKey());
    const full = FULL_SCREENS.has(key);
    const useDyn = api.isTauri() && DYN[key];
    const effKey = useDyn ? key : (VIEWS[key] ? key : "agents");

    const stillActive = tabStore.getActive()?.id === tabId;

    // Only update the shared shell / visible portal if this tab is still the
    // active one. Background tabs continue rendering but must not steal the UI.
    if (stillActive) {
      mountShell(effKey, full);

      // Show this tab's portal, hide the others.
      const host = document.getElementById("main-content");
      host.querySelectorAll("div[data-tab-id]").forEach((el) => {
        el.style.display = el.dataset.tabId === tabId ? "" : "none";
      });
    }

    const needsRender = !portal.dataset.loaded || portal.dataset.hash !== hash || String(active.reloadTs || "") !== (portal.dataset.reloadTs || "");

    if (needsRender) {
      // Tear down live hooks for the old content before replacing it.
      if (portal.__orCleanup) { try { portal.__orCleanup(); } catch (e) { console.error("[cleanup]", e); } portal.__orCleanup = null; }
      portal.innerHTML = "";
      delete portal.dataset.loaded;
      portal.dataset.hash = hash;
      portal.dataset.reloadTs = String(active.reloadTs || "");

      if (useDyn) {
        portal.className = "tab-view w-full max-w-6xl flex-1 px-8 py-7";
        portal.innerHTML = skeletonFor(key);
        try { await DYN[key](portal); } catch (e) { console.error("[dyn]", key, e); portal.innerHTML = `<div class="m-8 rounded-xl border border-rose-500/40 bg-rose-500/5 p-4 text-rose-500">${String(e)}</div>`; }
        // Dynamic screens overwrite className; restore the scroll container class.
        portal.classList.add("tab-view");
      } else {
        const v = VIEWS[effKey];
        portal.className = `tab-view ${v.main || "w-full max-w-6xl flex-1 px-8 py-7"}`;
        portal.innerHTML = v.html;
        try { if (v.init) v.init(); } catch (e) { console.error("[view init]", effKey, e); }
      }
      drawIcons();
      portal.dataset.loaded = "true";
    }

    // After render (or after showing an existing portal), update the tab title.
    tabStore.setTitle(tabId, titleForHash(hash));
  });

  tabRenderQueue.set(tabId, current);
  try { await current; } finally {
    if (tabRenderQueue.get(tabId) === current) tabRenderQueue.delete(tabId);
  }
}

// Warm the SWR cache for the screens the user is most likely to open next, so
// even their first visit is instant. Fires in the background after the landing
// screen paints; the sidecar daemon serializes these while the user reads.
function prewarm() {
  if (!api.isTauri()) return;
  setTimeout(() => {
    Promise.allSettled([
      api.agentGet(), api.agentKnowledge(),
      api.replyList("saved", 0, 30), api.replyList(null, 0, 100),
      api.contentList(), api.byokStatus(),
      api.analyticsSummary(30), api.geoList(), api.agentBrain(),
      // Newly SWR-cached full-screen reads — warm them so the first visit to
      // Connections / Tasks / Library / X Account is instant, not a cold spawn.
      api.credsList(), api.taskList(), api.agentCorpus(), api.xAccountList(),
    ]);
  }, 400);
}

// One-time startup health probe. The full path (health command → health_check
// Rust cmd → api.healthCheck) existed but was never called, so a dead sidecar,
// missing tables, or unconfigured LLM only surfaced later as cryptic per-feature
// errors. Surface them up-front as a dismissible banner instead.
function showHealthBanner(level, msg) {
  let el = document.getElementById("or-health-banner");
  if (!el) { el = document.createElement("div"); el.id = "or-health-banner"; document.body.prepend(el); }
  const color = level === "error" ? "bg-rose-600 text-white" : "bg-amber-500 text-zinc-900";
  el.className = `fixed inset-x-0 top-0 z-[60] flex items-center justify-between gap-3 px-4 py-2 text-sm font-medium shadow ${color}`;
  el.innerHTML = `<span>${esc(msg)}</span>` +
    `<button id="or-health-x" class="shrink-0 rounded px-2 py-0.5 text-xs font-semibold underline-offset-2 hover:underline">Dismiss</button>`;
  const x = document.getElementById("or-health-x");
  if (x) x.onclick = () => el.remove();
}

async function healthBanner() {
  if (!api.isTauri()) return;
  let h;
  try { h = await api.healthCheck(); } catch (e) { return; } // a failing probe itself is non-fatal
  if (!h || typeof h !== "object") return;
  const checks = Array.isArray(h.checks) ? h.checks : [];
  const blockers = checks.filter((c) => c && c.ok === false && c.level !== "warn" && c.level !== "info");
  if (h.sidecar_ok === false || blockers.length) {
    const which = h.sidecar_ok === false ? "the engine (sidecar)"
      : blockers.map((c) => c.id).join(", ");
    showHealthBanner("error",
      `OpenReply can't reach ${which}. Some features won't work — try relaunching the app.`);
    return;
  }
  // LLM-not-configured is only worth flaging once the user has onboarded — before
  // that, the welcome wizard is the right place to add a key.
  const llm = checks.find((c) => c && c.id === "llm");
  if (llm && llm.ok === false && localStorage.getItem("or-onboarded")) {
    showHealthBanner("warn",
      "No LLM provider is configured — drafting and analysis are disabled. Add a key in Settings.");
  }
}

function isOnboarding() {
  return api.isTauri() && !localStorage.getItem("or-onboarded");
}

let tabsInitialized = false;
let keyboardWired = false;
let linksWired = false;

function initTabs() {
  if (tabsInitialized) return;
  const strip = document.getElementById("tab-strip");
  if (!strip) return;
  tabsInitialized = true;
  strip.style.display = isOnboarding() ? "none" : "";
  renderTabStrip(strip, contextMenu);

  // When the active tab changes (focus, close, open, etc.), silently update the
  // URL and re-render the corresponding screen.
  let knownTabIds = new Set(tabStore.getAll().map((t) => t.id));
  tabStore.subscribe(() => {
    const active = tabStore.getActive();
    if (!active) return;
    if (location.hash !== active.hash) {
      history.replaceState(null, "", active.hash);
      render();
    }
    // Clean up portals for tabs that have been closed.
    const currentIds = new Set(tabStore.getAll().map((t) => t.id));
    for (const id of knownTabIds) {
      if (!currentIds.has(id)) cleanupTabPortal(id);
    }
    knownTabIds = currentIds;
  });
}

// Keyboard shortcuts for tabs. ⌘W must work even while typing, so it sits
// outside the "input guard" used for other shortcuts.
function wireTabKeyboard() {
  if (keyboardWired) return;
  keyboardWired = true;
  document.addEventListener("keydown", (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;

    // ⌘T — new tab at Home
    if (e.key === "t" && !e.shiftKey) {
      e.preventDefault();
      tabStore.open({ hash: HOME_HASH });
      return;
    }
    // ⌘W — close active tab
    if (e.key === "w") {
      e.preventDefault();
      const a = tabStore.getActive();
      if (a) tabStore.close(a.id);
      return;
    }
    // ⌘⇧T — reopen last closed
    if (e.shiftKey && (e.key === "T" || e.key === "t")) {
      e.preventDefault();
      tabStore.reopenLastClosed();
      return;
    }
    // ⌘1..⌘9 focus tab N
    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      const idx = parseInt(e.key, 10) - 1;
      const tab = tabStore.getAll()[idx];
      if (tab) tabStore.focus(tab.id);
    }
  });
}

// Intercept cmd/middle/right-click on any internal route link so users can open
// screens in new tabs just like a browser.
function wireLinkInterception() {
  if (linksWired) return;
  linksWired = true;
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#/"]');
    if (!a) return;
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return; // plain click handled by hashchange
    e.preventDefault();
    const href = a.getAttribute("href");
    const foreground = e.shiftKey ? true : false;
    tabStore.open({ hash: href, foreground });
  });

  document.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return; // middle click only
    const a = e.target.closest('a[href^="#/"]');
    if (!a) return;
    e.preventDefault();
    tabStore.open({ hash: a.getAttribute("href"), foreground: false });
  });

  document.addEventListener("contextmenu", (e) => {
    const a = e.target.closest('a[href^="#/"]');
    if (!a) return;
    e.preventDefault();
    const hash = a.getAttribute("href");
    contextMenu.openContextMenu(e.clientX, e.clientY, [
      { label: "Open", icon: "arrow-right", onClick: () => { location.hash = hash; } },
      { label: "Open in new tab", icon: "plus-square", onClick: () => tabStore.open({ hash, foreground: false }) },
    ]);
  });
}

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", () => {
  initTabs();
  wireTabKeyboard();
  wireLinkInterception();
  render();
});
if (document.readyState !== "loading") {
  initTabs();
  wireTabKeyboard();
  wireLinkInterception();
  render();
}
prewarm();
if (api.isTauri()) setTimeout(() => { healthBanner().catch(() => {}); }, 800);

// Two-way Telegram bot: poll for inline-button taps only while the app is open.
// ensureBotPoller() self-gates on enabled+two_way+token and is a no-op otherwise.
if (api.isTauri()) setTimeout(() => { ensureBotPoller().catch(() => {}); }, 1200);
