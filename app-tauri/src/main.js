// OpenReply — SPA router for the Tauri app.
// Wired screens (agents/agent/opportunities/compose) render LIVE data via the Rust
// command bridge (or/dynamic.js → or/api.js → commands.rs → gapmap reply/agent/content).
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

// Screens that own the whole window (no sidebar): the activation gate and the
// post-activation onboarding wizard.
const FULL_SCREENS = new Set(["activate", "welcome"]);

// Hard license gate. Resolves the route the user is actually allowed to see.
// Fails CLOSED — any error checking the licence forces the activation screen.
// In a plain browser (no Tauri) there is no gate, so the static prototype still
// renders for design work.
async function gateCheck(reqKey) {
  if (!api.isTauri()) return reqKey;
  // Fetch both gate signals in parallel (SWR-cached → instant after first load).
  const [gate, st] = await Promise.all([
    api.licenseGateStatus().catch(() => null),
    api.licenseStatus().catch(() => null),
  ]);
  if (gate && gate.enabled === false) return reqKey; // gate disabled via env
  if (!st || !st.activated) return "activate";
  if (!localStorage.getItem("or-onboarded")) return "welcome";
  if (reqKey === "activate" || reqKey === "welcome") return "agents";
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
    ]);
  }, 400);
}

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", render);
if (document.readyState !== "loading") render();
prewarm();
