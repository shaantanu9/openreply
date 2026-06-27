// OpenReply — SPA router for the Tauri app.
// Wired screens (agents/agent/opportunities/compose) render LIVE data via the Rust
// command bridge (or/dynamic.js → or/api.js → commands.rs → gapmap reply/agent/content).
// The rest render the static prototype views (or/views.js). In a plain browser (no Tauri)
// everything falls back to the static views.
import { VIEWS } from "./or/views.js";
import { mountShell, drawIcons } from "./or/shell.js";
import { api } from "./or/api.js";
import { DYN } from "./or/dynamic.js";

function currentKey() {
  const h = (location.hash || "").replace(/^#\/?/, "").split(/[?#]/)[0];
  return h || "agents";
}

async function render() {
  const reqKey = currentKey();
  const useDyn = api.isTauri() && DYN[reqKey];
  const key = useDyn ? reqKey : (VIEWS[reqKey] ? reqKey : "agents");
  const view = document.getElementById("main-content");

  if (useDyn) {
    mountShell(key, false);
    view.innerHTML = `<div class="text-zinc-500">Loading…</div>`;
    try { await DYN[key](view); } catch (e) { console.error("[dyn]", key, e); view.innerHTML = `<div class="m-8 rounded-xl border border-rose-500/40 bg-rose-500/5 p-4 text-rose-500">${String(e)}</div>`; }
  } else {
    const v = VIEWS[key];
    view.className = v.main || "w-full max-w-6xl flex-1 px-8 py-7";
    view.innerHTML = v.html;
    mountShell(key, !!v.full);
    try { if (v.init) v.init(); } catch (e) { console.error("[view init]", key, e); }
  }
  drawIcons();
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", render);
if (document.readyState !== "loading") render();
