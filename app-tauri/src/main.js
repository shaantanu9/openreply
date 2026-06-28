// OpenReply — SPA router for the Tauri app.
// Wired screens (agents/agent/opportunities/compose) render LIVE data via the Rust
// command bridge (or/dynamic.js → or/api.js → commands.rs → openreply reply/agent/content).
// The rest render the static prototype views (or/views.js). In a plain browser (no Tauri)
// everything falls back to the static views.
import { VIEWS } from "./or/views.js";
import { mountShell, drawIcons } from "./or/shell.js";
import { api } from "./or/api.js";
import { DYN } from "./or/dynamic.js";
import { skeletonFor } from "./or/skeleton.js";

function currentKey() {
  const h = (location.hash || "").replace(/^#\/?/, "").split(/[?#]/)[0];
  return h || "agents";
}

// Screens that own the whole window (no sidebar): the onboarding wizard.
const FULL_SCREENS = new Set(["welcome"]);

// Open-source builds have no license gate. On first launch the onboarding
// wizard is shown; otherwise the requested route is used as-is.
// DEV BYPASS: for local GUI testing we auto-mark onboarding complete so the
// app boots straight into the dashboard. Remove this when shipping the real
// first-run experience.
async function gateCheck(reqKey) {
  if (!api.isTauri()) return reqKey;
  if (reqKey === "activate") return "agents";
  if (!localStorage.getItem("or-onboarded")) {
    localStorage.setItem("or-onboarded", "1");
    localStorage.setItem("or-user-name", "Dev User");
  }
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

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", render);
if (document.readyState !== "loading") render();
prewarm();
