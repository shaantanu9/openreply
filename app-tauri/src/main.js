// OpenReply — SPA router for the Tauri app.
// Wired screens (agents/agent/opportunities/compose) render LIVE data via the Rust
// command bridge (or/dynamic.js → or/api.js → commands.rs → openreply reply/agent/content).
// The rest render the static prototype views (or/views.js). In a plain browser (no Tauri)
// everything falls back to the static views.
import { VIEWS } from "./or/views.js";
import { mountShell, drawIcons } from "./or/shell.js";
import { api, esc } from "./or/api.js";
import { DYN, ensureBotPoller } from "./or/dynamic.js";
import { skeletonFor } from "./or/skeleton.js";

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

async function render() {
  const reqKey = currentKey();
  const key = await gateCheck(reqKey);
  const full = FULL_SCREENS.has(key);
  const useDyn = api.isTauri() && DYN[key];
  const effKey = useDyn ? key : (VIEWS[key] ? key : "agents");
  const view = document.getElementById("main-content");

  if (useDyn) {
    mountShell(effKey, full);
    view.innerHTML = skeletonFor(key);
    try { await DYN[key](view); } catch (e) { console.error("[dyn]", key, e); view.innerHTML = `<div class="m-8 rounded-xl border border-rose-500/40 bg-rose-500/5 p-4 text-rose-500">${String(e)}</div>`; }
  } else {
    const v = VIEWS[effKey];
    view.className = v.main || "w-full max-w-6xl flex-1 px-8 py-7";
    view.innerHTML = v.html;
    mountShell(effKey, full || !!v.full);
    try { if (v.init) v.init(); } catch (e) { console.error("[view init]", effKey, e); }
  }
  drawIcons();
  window.scrollTo(0, 0);
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
  // LLM-not-configured is only worth flagging once the user has onboarded — before
  // that, the welcome wizard is the right place to add a key.
  const llm = checks.find((c) => c && c.id === "llm");
  if (llm && llm.ok === false && localStorage.getItem("or-onboarded")) {
    showHealthBanner("warn",
      "No LLM provider is configured — drafting and analysis are disabled. Add a key in Settings.");
  }
}

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", render);
if (document.readyState !== "loading") render();
prewarm();
if (api.isTauri()) setTimeout(() => { healthBanner().catch(() => {}); }, 800);

// Two-way Telegram bot: poll for inline-button taps only while the app is open.
// ensureBotPoller() self-gates on enabled+two_way+token and is a no-op otherwise.
if (api.isTauri()) setTimeout(() => { ensureBotPoller().catch(() => {}); }, 1200);
