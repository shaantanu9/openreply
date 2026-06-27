// OpenReply dynamic screens — real data via the Rust command bridge (or/api.js).
// Tailwind markup mirrors the prototype; content + handlers are live.
import { api, esc } from "./api.js";

const icons = () => window.lucide && window.lucide.createIcons();
const toast = (m) => window.orToast && window.orToast(m);
const card = "rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5";
const btn = "rounded-full border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold hover:border-zinc-400";
const btnP = "rounded-full bg-reddit px-4 py-2 text-sm font-semibold text-white hover:bg-reddit-hi";
const chip = "rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-0.5 text-xs text-zinc-500";
const head = (t, sub, actions = "") =>
  `<div class="mb-6 flex items-start justify-between gap-4"><div>
     <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">${esc(t)}</h1>
     <p class="text-zinc-500 dark:text-zinc-400">${sub}</p></div>
     <div class="flex flex-wrap gap-2">${actions}</div></div>`;
const scoreCls = (s) => (s >= 0.7 ? "text-emerald-500" : s >= 0.45 ? "text-amber-500" : "text-reddit");

// ── Agents dashboard ──────────────────────────────────────────────────────
export async function renderAgents(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = head("Agents",
    "Each agent is a brand/niche persona with its own knowledge &amp; voice.",
    `<button id="ag-new" class="${btnP}">+ New agent</button>`) +
    `<div id="ag-form" class="hidden mb-5 ${card}"></div>
     <div id="ag-grid" class="grid gap-5 sm:grid-cols-2"><div class="text-zinc-500">Loading agents…</div></div>`;

  let platforms = [];
  try { platforms = (await api.replyPlatforms())?.platforms || []; } catch (e) {}

  document.getElementById("ag-new").onclick = () => {
    const f = document.getElementById("ag-form");
    f.classList.toggle("hidden");
    if (!f.innerHTML) {
      f.innerHTML = `
        <h3 class="mb-3 font-semibold text-zinc-900 dark:text-white">New agent</h3>
        <div class="grid gap-3 sm:grid-cols-2">
          ${field("ag-name", "Name", "Acme Notes")}
          ${field("ag-niche", "Niche", "AI note-taking for students")}
          ${field("ag-persona", "Voice / persona", "ex-teacher, founder")}
          ${field("ag-keywords", "Keywords (comma-sep)", "note taking app, obsidian alternative")}
        </div>
        <div class="mt-3 text-sm text-zinc-500">Platforms</div>
        <div class="mt-1 grid grid-cols-3 gap-2 text-sm">${platforms.filter(p => p.can_reply).map(p =>
          `<label class="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 px-2 py-1.5">
             <input type="checkbox" value="${esc(p.key)}" ${p.key === "reddit_free" ? "checked" : ""}> ${esc(p.label)}</label>`).join("")}</div>
        <button id="ag-create" class="mt-4 ${btnP}">Create agent</button> <span id="ag-msg" class="text-sm text-zinc-500"></span>`;
      document.getElementById("ag-create").onclick = createAgent;
    }
  };

  async function createAgent() {
    const name = document.getElementById("ag-name").value.trim();
    const msg = document.getElementById("ag-msg");
    if (!name) { msg.textContent = "Name required."; return; }
    const pfs = [...document.querySelectorAll("#ag-form input[type=checkbox]:checked")].map(c => c.value);
    msg.textContent = "Creating…";
    try {
      await api.agentCreate({
        name,
        niche: document.getElementById("ag-niche").value.trim(),
        persona: document.getElementById("ag-persona").value.trim(),
        keywords: document.getElementById("ag-keywords").value.trim(),
        platforms: pfs.join(","),
      });
      toast("Agent created");
      document.getElementById("ag-form").classList.add("hidden");
      load();
    } catch (e) { msg.textContent = "Failed: " + e; }
  }

  async function load() {
    const grid = document.getElementById("ag-grid");
    try {
      const res = await api.agentList();
      const agents = res?.agents || [];
      grid.innerHTML = agents.length ? agents.map(agentCard).join("") +
        `<a href="#/onboarding" class="flex min-h-[170px] items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:border-reddit hover:text-reddit"><div class="text-center"><div class="text-3xl text-reddit">＋</div>New agent</div></a>`
        : `<div class="${card} text-zinc-500">No agents yet — click “+ New agent”.</div>`;
      grid.querySelectorAll("[data-use]").forEach(b => b.onclick = async () => {
        await api.agentUse(b.getAttribute("data-use")); toast("Switched agent"); load();
      });
      icons();
    } catch (e) { grid.innerHTML = `<div class="rounded-xl border border-rose-500/40 bg-rose-500/5 p-4 text-rose-500">${esc(e)}</div>`; }
  }
  load();
}

function field(id, label, ph) {
  return `<label class="block text-sm"><span class="text-zinc-500 dark:text-zinc-400">${label}</span>
    <input id="${id}" placeholder="${esc(ph)}" class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>`;
}
function agentCard(a) {
  const kws = (a.keywords || []).slice(0, 5).map(k => `<span class="${chip}">${esc(k)}</span>`).join("");
  const pfs = (a.platforms || []).map(p => `<span class="${chip}">${esc(p)}</span>`).join("");
  return `<div class="${card}">
    <div class="flex items-center gap-2"><b class="text-lg text-zinc-900 dark:text-white">${esc(a.name)}</b>
      ${a.active ? '<span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">active</span>' : ""}</div>
    <p class="text-sm text-zinc-500 dark:text-zinc-400">${esc(a.niche || a.brand || "")}</p>
    <div class="mt-3 flex flex-wrap gap-1.5">${kws}</div>
    <div class="mt-2 flex flex-wrap gap-1.5">${pfs}</div>
    <div class="my-4 border-t border-zinc-200 dark:border-zinc-800"></div>
    <div class="flex flex-wrap gap-2">
      ${a.active ? "" : `<button data-use="${esc(a.id)}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Make active</button>`}
      <a href="#/opportunities" class="rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white">Find replies</a>
      <a href="#/compose" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Create content</a></div>
  </div>`;
}

// ── Overview ──────────────────────────────────────────────────────────────
export async function renderOverview(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = `<div id="ov">Loading…</div>`;
  let a = null, k = null;
  try { a = await api.agentGet(); } catch (e) {}
  if (!a) { document.getElementById("ov").innerHTML = `<div class="${card}">No active agent. <a class="text-reddit underline" href="#/agents">Create one →</a></div>`; return; }
  try { k = await api.agentKnowledge(); } catch (e) {}
  const kpi = (l, v) => `<div class="${card}"><div class="text-sm text-zinc-500">${l}</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">${v}</div></div>`;
  document.getElementById("ov").outerHTML =
    head(esc(a.name), `${esc(a.niche || "")} · watching ${(a.platforms || []).join(", ")}`,
      `<button id="ov-refresh" class="${btn}">↻ Refresh knowledge</button><a href="#/opportunities" class="${btnP}">Find opportunities</a>`) +
    `<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
       ${kpi("Posts collected", (k && k.posts) || 0)}
       ${kpi("Map nodes", (k && k.graph_nodes) || 0)}
       ${kpi("Angles", (k && k.findings) || 0)}
       ${kpi("Last refresh", k && k.last_refresh_at ? new Date(k.last_refresh_at * 1000).toLocaleDateString() : "never")}
     </div>
     <div class="mt-5 grid gap-4 lg:grid-cols-2">
       <div class="${card}"><b class="text-zinc-900 dark:text-white">Voice</b><p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">${esc(a.persona || "—")}</p><p class="mt-1 text-sm text-zinc-500">Tone: ${esc(a.tone || "")}</p></div>
       <div class="${card}"><b class="text-zinc-900 dark:text-white">Next steps</b>
         <div class="mt-2 flex flex-col gap-2 text-sm">
           <a href="#/opportunities" class="text-reddit">→ Find conversations to reply to</a>
           <a href="#/compose" class="text-reddit">→ Generate a post / thread / article</a>
           <a href="#/connections" class="text-reddit">→ Connect accounts</a></div></div>
     </div>`;
  document.getElementById("ov-refresh").onclick = async (e) => {
    e.target.textContent = "Refreshing…"; e.target.disabled = true;
    try { await api.agentRefresh(null, false); toast("Knowledge refreshed"); renderOverview(view); }
    catch (err) { toast("Refresh failed"); e.target.textContent = "↻ Refresh knowledge"; e.target.disabled = false; }
  };
  icons();
}

// ── Opportunities ─────────────────────────────────────────────────────────
export async function renderOpportunities(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  let a = null; try { a = await api.agentGet(); } catch (e) {}
  const pfs = (a?.platforms || ["reddit_free"]).join(", ");
  view.innerHTML = head("Opportunities",
    `Conversations worth replying to for <b>${esc(a?.name || "—")}</b>.`,
    `<button id="op-find" class="${btnP}">⚡ Find opportunities</button>`) +
    `<div class="mb-5 flex flex-wrap items-end gap-4 ${card} text-sm">
       <label class="text-zinc-500">Platforms<input id="op-pf" value="${esc(pfs)}" class="mt-1 block w-64 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
       <label class="text-zinc-500">Per platform<input id="op-lim" type="number" value="15" class="mt-1 block w-20 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
       <button id="op-saved" class="${btn}">Show saved</button>
       <span id="op-status" class="ml-auto text-zinc-400"></span></div>
     <div id="op-list" class="space-y-3"></div>`;

  const list = document.getElementById("op-list");
  const status = document.getElementById("op-status");
  const draw = (opps) => {
    list.innerHTML = opps.length ? opps.map(oppCard).join("")
      : `<div class="${card} text-zinc-500">No opportunities yet. Click “Find opportunities”.</div>`;
    list.querySelectorAll("[data-draft]").forEach(b => b.onclick = () => doDraft(b));
    icons();
  };
  async function doDraft(b) {
    const id = b.getAttribute("data-draft");
    const slot = list.querySelector(`[data-slot="${CSS.escape(id)}"]`);
    b.disabled = true; b.textContent = "Drafting…";
    try {
      const d = await api.replyDraft(id);
      if (d?.error) slot.innerHTML = `<div class="mt-2 text-sm text-rose-500">${esc(d.error)}</div>`;
      else {
        const flag = d.compliant ? "" : `<div class="mt-2 inline-block rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">⚠ ${esc(d.compliance_notes || "check rules")}</div>`;
        slot.innerHTML = `${flag}<textarea rows="5" class="mt-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm">${esc(d.text || "")}</textarea>
          <div class="mt-1 text-xs text-zinc-400">Review, edit, then post manually.</div>`;
      }
    } catch (e) { slot.innerHTML = `<div class="mt-2 text-sm text-rose-500">${esc(e)}</div>`; }
    b.disabled = false; b.textContent = "Re-draft";
  }
  document.getElementById("op-find").onclick = async () => {
    const pf = document.getElementById("op-pf").value.trim();
    const lim = parseInt(document.getElementById("op-lim").value, 10) || 15;
    status.textContent = "Scanning + scoring… (may take a minute)";
    list.innerHTML = `<div class="${card} animate-pulse text-zinc-500">Scanning ${esc(pf)}…</div>`;
    try {
      const r = await api.replyFind(pf, lim, false);
      if (r?.error) { status.textContent = r.error; draw([]); return; }
      status.textContent = `Found ${r?.found ?? 0}.`;
      draw(r?.opportunities || []);
    } catch (e) { status.textContent = "Failed: " + e; draw([]); }
  };
  document.getElementById("op-saved").onclick = showSaved;
  async function showSaved() {
    status.textContent = "Loading saved…";
    try { const r = await api.replyList(null, 0, 50); status.textContent = ""; draw(r?.opportunities || []); }
    catch (e) { status.textContent = "Failed: " + e; }
  }
  showSaved();
}
function oppCard(o) {
  const s = Math.round((o.score || 0) * 100);
  const pf = o.platform || "";
  const badge = pf.includes("reddit") ? "bg-reddit/15 text-reddit" : pf === "hn" ? "bg-amber-500/15 text-amber-500" : "bg-brand/15 text-brand";
  return `<div class="${card}">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2"><span class="rounded ${badge} px-2 py-0.5 text-xs font-bold">${esc(pf)}</span>
        ${o.sub ? `<span class="text-sm text-zinc-500">r/${esc(o.sub)}</span>` : ""}</div>
      <span class="text-2xl font-extrabold ${scoreCls(o.score || 0)}" title="rel ${o.relevance} · intent ${o.intent} · fit ${o.fit} · eng ${o.engagement} · fresh ${o.freshness}">${s}</span></div>
    <div class="mt-1.5 font-semibold text-zinc-900 dark:text-white">${esc(o.title || "(no title)")}</div>
    ${o.reason ? `<div class="text-sm text-zinc-500 dark:text-zinc-400">${esc(o.reason)}</div>` : ""}
    <div class="mt-3 flex gap-2">
      ${o.url ? `<a href="${esc(o.url)}" target="_blank" class="rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">Open post ↗</a>` : ""}
      <button data-draft="${esc(o.id)}" class="rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white">Draft reply</button></div>
    <div data-slot="${esc(o.id)}"></div></div>`;
}

// ── Compose ───────────────────────────────────────────────────────────────
const KINDS = [["post", "Post"], ["thread", "Thread"], ["script", "Video script"], ["article", "Article"]];
export async function renderCompose(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  let a = null; try { a = await api.agentGet(); } catch (e) {}
  const platforms = a?.platforms || ["reddit_free"];
  view.innerHTML = head("Compose", `Generate content for <b>${esc(a?.name || "—")}</b> from its live niche knowledge.`) +
    `<div class="mb-5 ${card}">
       <div id="cm-kinds" class="mb-4 flex flex-wrap gap-2">${KINDS.map(([v, l], i) =>
         `<button data-kind="${v}" class="rounded-full ${i === 0 ? "bg-reddit text-white" : "border border-zinc-200 dark:border-zinc-700"} px-4 py-2 text-sm font-semibold">${l}</button>`).join("")}</div>
       <div class="flex flex-wrap items-end gap-4 text-sm">
         <label class="text-zinc-500">Platform<select id="cm-pf" class="mt-1 block w-44 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2">${platforms.map(p => `<option>${esc(p)}</option>`).join("")}</select></label>
         <label class="flex-1 text-zinc-500">Angle (optional)<input id="cm-angle" placeholder="leave blank to auto-pick" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
         <button id="cm-gen" class="${btnP}">✨ Generate</button></div>
       <span id="cm-status" class="text-sm text-zinc-400"></span></div>
     <div id="cm-out"></div>
     <h3 class="mb-3 mt-6 font-semibold text-zinc-900 dark:text-white">Recent drafts</h3>
     <div id="cm-recent" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"></div>`;

  let kind = "post";
  document.getElementById("cm-kinds").onclick = (e) => {
    const b = e.target.closest("[data-kind]"); if (!b) return;
    kind = b.getAttribute("data-kind");
    [...document.querySelectorAll("#cm-kinds [data-kind]")].forEach(x =>
      x.className = `rounded-full ${x === b ? "bg-reddit text-white" : "border border-zinc-200 dark:border-zinc-700"} px-4 py-2 text-sm font-semibold`);
  };
  document.getElementById("cm-gen").onclick = async () => {
    const platform = document.getElementById("cm-pf").value;
    const angle = document.getElementById("cm-angle").value.trim();
    const status = document.getElementById("cm-status");
    const out = document.getElementById("cm-out");
    status.textContent = "Generating…"; out.innerHTML = `<div class="${card} animate-pulse text-zinc-500">Writing a ${esc(kind)}…</div>`;
    try {
      const c = await api.contentGenerate(kind, platform, angle);
      if (c?.error) { status.textContent = c.error; out.innerHTML = ""; return; }
      status.textContent = "Done ✓";
      out.innerHTML = contentCard(c, true);
      loadRecent();
    } catch (e) { status.textContent = "Failed: " + e; out.innerHTML = ""; }
  };
  async function loadRecent() {
    const wrap = document.getElementById("cm-recent");
    try { const r = await api.contentList(null, null, 12); const items = r?.content || [];
      wrap.innerHTML = items.length ? items.map(c => contentCard(c, false)).join("") : `<div class="text-zinc-500">No drafts yet.</div>`;
    } catch (e) { wrap.innerHTML = `<div class="text-rose-500">${esc(e)}</div>`; }
  }
  loadRecent();
}
function contentCard(c, big) {
  return `<div class="${card}">
    <div class="flex items-center gap-2"><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">${esc(c.kind)}</span>
      <span class="text-xs text-zinc-500">${esc(c.platform || "")}</span>
      <span class="rounded bg-zinc-500/15 px-2 py-0.5 text-xs font-bold text-zinc-400">${esc(c.status || "draft")}</span></div>
    <textarea rows="${big ? 6 : 4}" class="mt-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm">${esc(c.body || "")}</textarea></div>`;
}

export const DYN = {
  agents: renderAgents,
  agent: renderOverview,
  opportunities: renderOpportunities,
  compose: renderCompose,
};
