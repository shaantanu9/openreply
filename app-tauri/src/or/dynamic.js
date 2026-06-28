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
  try { platforms = (await api.replyPlatforms())?.platforms || []; } catch (e) { console.error(e); }
  const OR_DEFAULT_PICK = new Set(["reddit_free", "hn", "lemmy", "mastodon", "devto", "stackoverflow", "producthunt"]);

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
             <input type="checkbox" class="accent-reddit" value="${esc(p.key)}" ${OR_DEFAULT_PICK.has(p.key) ? "checked" : ""}> ${esc(p.label)}</label>`).join("")}</div>
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
        : `<div class="${card} sm:col-span-2 text-center">
             <p class="text-zinc-500">No agents yet. Set up your first brand persona to start finding conversations worth joining.</p>
             <a href="#/onboarding" class="mt-3 inline-block ${btnP}">Set up your first agent</a>
           </div>`;
      grid.querySelectorAll("[data-use]").forEach(b => b.onclick = async () => {
        await api.agentUse(b.getAttribute("data-use")); toast("Switched agent"); load();
      });
      grid.querySelectorAll("[data-edit]").forEach(b => b.onclick = async () => {
        try { await api.agentUse(b.getAttribute("data-edit")); location.hash = "#/keywords"; }
        catch (e) { toast("Failed: " + e); }
      });
      grid.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
        const id = b.getAttribute("data-del"), name = b.getAttribute("data-name") || "this agent";
        window.orModal({
          title: `Delete ${name}?`, okText: "Delete",
          body: `<p class="text-sm text-zinc-500">Removes the agent and its settings. Collected posts/knowledge stay. This can’t be undone.</p>`,
          onOk: async () => { try { await api.agentDelete(id); toast("Deleted " + name); load(); } catch (e) { toast("Delete failed: " + e); } },
        });
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
      <button data-edit="${esc(a.id)}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Edit</button>
      <button data-del="${esc(a.id)}" data-name="${esc(a.name)}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold text-rose-500">Delete</button></div>
  </div>`;
}

// ── Overview ──────────────────────────────────────────────────────────────
export async function renderOverview(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = `<div id="ov">Loading…</div>`;
  let a = null, k = null;
  try { a = await api.agentGet(); } catch (e) { console.error(e); }
  if (!a) { document.getElementById("ov").innerHTML = `<div class="${card}">No active agent. <a class="text-reddit underline" href="#/agents">Create one →</a></div>`; return; }
  try { k = await api.agentKnowledge(); } catch (e) { console.error(e); }

  const fresh = !(k && ((k.posts || 0) > 0 || k.last_refresh_at));
  const freshBanner = fresh
    ? `<div class="mb-5 rounded-lg bg-reddit/10 px-4 py-3 text-sm text-reddit"><i data-lucide="sparkles" class="inline-block h-4 w-4 align-[-2px]"></i> <b>New agent — no knowledge yet.</b> Click <b>Refresh + learn</b> to fetch posts for your niche and build the agent's brain, then <b>Find opportunities</b>.</div>`
    : "";

  const kpi = (l, v, href, icon) => `<a href="${href}" class="${card} group block transition hover:border-reddit/50">
      <div class="flex items-center justify-between"><div class="text-sm text-zinc-500">${l}</div><i data-lucide="${icon}" class="h-4 w-4 text-zinc-300 group-hover:text-reddit"></i></div>
      <div class="mt-1 text-3xl font-extrabold text-zinc-900 dark:text-white">${v}</div></a>`;
  const tile = (href, icon, title, desc) => `<a href="${href}" class="${card} group flex items-start gap-3 transition hover:border-reddit/50 hover:shadow-sm">
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-reddit/10 text-reddit"><i data-lucide="${icon}" class="h-4 w-4"></i></span>
      <div class="min-w-0"><div class="font-semibold text-zinc-900 dark:text-white">${title}</div>
        <div class="text-xs text-zinc-500 dark:text-zinc-400">${desc}</div></div></a>`;

  document.getElementById("ov").outerHTML =
    head(esc(a.name), `${esc(a.niche || "—")} · watching ${(a.platforms || []).join(", ") || "no sources yet"}`,
      `<button id="ov-refresh" class="${btn}"><i data-lucide="refresh-cw" class="inline-block h-4 w-4 align-[-2px]"></i> Refresh + learn</button>
       <button id="ov-evolve" class="${btn}"><i data-lucide="sparkles" class="inline-block h-4 w-4 align-[-2px]"></i> Evolve now</button>
       <button id="ov-suggest" class="${btn}"><i data-lucide="lightbulb" class="inline-block h-4 w-4 align-[-2px]"></i> Suggest ideas</button>
       <a href="#/opportunities" class="${btnP}"><i data-lucide="target" class="inline-block h-4 w-4 align-[-2px]"></i> Find opportunities</a>`) +
    freshBanner +
    `<div id="ov-strategy" class="mb-5"></div>` +
    `<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
       ${kpi("Posts collected", (k && k.posts) || 0, "#/knowledge", "database")}
       ${kpi("Brain nodes", (k && k.graph_nodes) || 0, "#/knowledge", "brain")}
       <div id="ov-kpi-opps">${kpi("New opportunities", "…", "#/opportunities", "target")}</div>
       <div id="ov-kpi-drafts">${kpi("Drafts", "…", "#/inbox", "file-pen")}</div>
     </div>` +
    `<h3 class="mb-3 mt-7 text-sm font-bold uppercase tracking-wider text-zinc-400">Workspace</h3>
     <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
       ${tile("#/opportunities", "target", "Opportunities", "Find conversations to reply to")}
       ${tile("#/inbox", "inbox", "Inbox", "Draft & manage saved replies")}
       ${tile("#/compose", "pen-line", "Compose", "Posts, threads, scripts, articles")}
       ${tile("#/queue", "calendar-clock", "Queue", "Schedule replies & posts")}
     </div>
     <h3 class="mb-3 mt-7 text-sm font-bold uppercase tracking-wider text-zinc-400">Intelligence</h3>
     <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
       ${tile("#/knowledge", "brain", "Knowledge & Brain", "Niche graph + teach from a video")}
       ${tile("#/keywords", "key-round", "Keywords", "What the agent scans for")}
       ${tile("#/subreddit", "shield-check", "Subreddit Intel", "Rules, stats & posting safety")}
       ${tile("#/learning", "brain-circuit", "Learning", "Memories & beliefs it learned")}
       ${tile("#/analytics", "bar-chart-3", "Analytics", "KPIs, trends & drivers")}
       ${tile("#/geo", "sparkles", "AI Visibility", "Are you cited in AI answers?")}
     </div>
     <h3 class="mb-3 mt-7 text-sm font-bold uppercase tracking-wider text-zinc-400">Account</h3>
     <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
       ${tile("#/connections", "plug", "Connections", "Connect Reddit, X & sources")}
       ${tile("#/settings", "settings", "Settings", "AI provider, feeds & data")}
       ${tile("#/pricing", "gem", "Plans", "Upgrade & billing")}
     </div>` +
    `<div class="mt-7 grid gap-4 lg:grid-cols-2">
       <div class="${card}"><div class="mb-2 flex items-center justify-between"><b class="text-zinc-900 dark:text-white">Top opportunities</b><a href="#/opportunities" class="text-xs font-semibold text-reddit">View all →</a></div>
         <div id="ov-opps" class="space-y-2 text-sm text-zinc-500">Loading…</div></div>
       <div class="${card}"><div class="mb-2 flex items-center justify-between"><b class="text-zinc-900 dark:text-white">Recent drafts</b><a href="#/compose" class="text-xs font-semibold text-reddit">Compose →</a></div>
         <div id="ov-drafts" class="space-y-2 text-sm text-zinc-500">Loading…</div></div>
     </div>` +
    `<div class="mt-5 grid gap-4 lg:grid-cols-2">
       <div class="${card}"><b class="text-zinc-900 dark:text-white">Voice</b><p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">${esc(a.persona || "—")}</p><p class="mt-1 text-sm text-zinc-500">Tone: ${esc(a.tone || "")}</p></div>
       <div id="ov-personas" class="${card}"><div class="text-sm text-zinc-500">Loading personas…</div></div>
     </div>`;

  document.getElementById("ov-refresh").onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; const html = b.innerHTML; b.textContent = "Refreshing + learning…";
    try { await api.agentRefresh(null, false); toast("Knowledge refreshed + learned"); renderOverview(view); }
    catch (err) { toast("Refresh failed"); b.disabled = false; b.innerHTML = html; icons(); }
  };

  // Evolve the Goal Playbook from here (mirrors the Learning screen's button).
  document.getElementById("ov-evolve").onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; const html = b.innerHTML;
    b.innerHTML = `<i data-lucide="loader" class="inline-block h-4 w-4 align-[-2px] animate-spin"></i> Evolving…`; icons();
    try { const r = await api.agentEvolve(); toast(r?.skipped ? (r.reason || "Skipped") : (r?.summary || "Evolved ✓")); }
    catch (err) { toast("Evolve failed: " + err); }
    b.disabled = false; b.innerHTML = html; icons(); loadStrategyStrip();
  };
  document.getElementById("ov-suggest").onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; const html = b.innerHTML;
    b.innerHTML = `<i data-lucide="loader" class="inline-block h-4 w-4 align-[-2px] animate-spin"></i> Thinking…`; icons();
    try { const r = await api.agentIdeas(true); toast(r?.skipped ? (r.reason || "Skipped") : `Suggested ${(r?.ideas || []).length} idea(s) — see Learning`); }
    catch (err) { toast("Suggest failed: " + err); }
    b.disabled = false; b.innerHTML = html; icons();
  };

  // Compact strategy strip: current playbook top angle + freshness, links to Learning.
  async function loadStrategyStrip() {
    const host = document.getElementById("ov-strategy");
    if (!host) return;
    let cur = null;
    try { cur = await api.agentPlaybook(); } catch (e) { console.error(e); }
    const pb = cur && cur.playbook;
    if (!pb) {
      const goalSet = (a.objective || a.goal || "").trim();
      host.innerHTML = `<div class="${card} flex flex-wrap items-center justify-between gap-2">
        <div class="text-sm text-zinc-500"><i data-lucide="sparkles" class="inline-block h-4 w-4 align-[-2px] text-reddit"></i> ${goalSet ? "No strategy yet — hit <b>Evolve now</b> to build one." : "Set a <a href='#/keywords' class='text-reddit'>goal</a> so the agent can self-evolve a strategy."}</div>
        <a href="#/learning" class="text-xs font-semibold text-reddit">Learning →</a></div>`;
      icons(); return;
    }
    const top = (pb.winning_angles || [])[0];
    const angle = top ? (typeof top === "string" ? top : top.angle) : "";
    const when = cur.created_at ? new Date(cur.created_at * 1000).toLocaleDateString() : "";
    host.innerHTML = `<div class="${card}">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <b class="text-zinc-900 dark:text-white"><i data-lucide="sparkles" class="inline-block h-4 w-4 align-[-2px] text-reddit"></i> Strategy <span class="text-xs font-normal text-zinc-400">v${cur.version}${when ? " · " + esc(when) : ""}</span></b>
        <a href="#/learning" class="text-xs font-semibold text-reddit">Full playbook →</a></div>
      ${angle ? `<p class="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Leading angle: <b>${esc(angle)}</b></p>` : ""}</div>`;
    icons();
  }
  loadStrategyStrip();

  // Live counts + snippets (best-effort; never block the page).
  (async () => {
    try {
      const r = await api.replyList("new", 0, 3, { sort: "score" });
      const opps = r?.opportunities || [];
      const cnt = (r && r.total != null) ? r.total : opps.length;
      const box = document.getElementById("ov-kpi-opps");
      if (box) box.innerHTML = kpi("New opportunities", cnt, "#/opportunities", "target");
      const ol = document.getElementById("ov-opps");
      if (ol) ol.innerHTML = opps.length
        ? opps.map((o) => `<a href="#/opportunities" class="block rounded-lg border border-zinc-100 dark:border-zinc-800 px-3 py-2 hover:border-reddit/40">
            <div class="flex items-center gap-2"><span class="rounded ${platformBadge(o.platform)} px-1.5 py-0.5 text-[11px] font-bold">${esc(o.platform || "")}</span><span class="text-xs font-extrabold ${scoreCls(o.score || 0)}">${Math.round((o.score || 0) * 100)}</span></div>
            <div class="mt-1 truncate text-zinc-700 dark:text-zinc-300">${esc(o.title || "(no title)")}</div></a>`).join("")
        : `<div class="text-zinc-400">No new opportunities yet — <a href="#/opportunities" class="text-reddit">find some →</a></div>`;
      icons();
    } catch (e) { console.error(e); }
  })();
  (async () => {
    try {
      const r = await api.contentList(null, null, 3);
      const drafts = r?.content || [];
      const box = document.getElementById("ov-kpi-drafts");
      if (box) box.innerHTML = kpi("Drafts", drafts.length, "#/inbox", "file-pen");
      const dl = document.getElementById("ov-drafts");
      if (dl) dl.innerHTML = drafts.length
        ? drafts.map((d) => `<a href="#/compose" class="block rounded-lg border border-zinc-100 dark:border-zinc-800 px-3 py-2 hover:border-reddit/40">
            <div class="text-[11px] font-bold uppercase text-zinc-400">${esc(d.kind || "draft")}</div>
            <div class="truncate text-zinc-700 dark:text-zinc-300">${esc(d.title || d.body || "")}</div></a>`).join("")
        : `<div class="text-zinc-400">No drafts yet — <a href="#/compose" class="text-reddit">compose one →</a></div>`;
      icons();
    } catch (e) { console.error(e); }
  })();

  // Knowledge personas — link single-lens learning personas so their beliefs +
  // memories + graph get blended into this agent's replies/content.
  async function loadPersonas() {
    const box = document.getElementById("ov-personas");
    if (!box) return;
    let all = [], linked = [];
    try { all = (await api.personaList())?.personas || []; } catch (e) { console.error(e); }
    try { linked = (await api.agentPersonas(a.id))?.personas || []; } catch (e) { console.error(e); }
    const linkedIds = new Set(linked.map((p) => p.persona_id));
    const avail = all.filter((p) => !linkedIds.has(p.id));
    const linkedHtml = linked.length
      ? linked.map((p) => `<div class="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-sm">
           <span class="text-zinc-700 dark:text-zinc-300"><b>${esc(p.name)}</b><span class="text-zinc-400"> · ${esc(p.lens || "—")} · ×${Number(p.weight ?? 1).toFixed(1)}</span></span>
           <button data-unlink="${p.persona_id}" class="text-xs font-semibold text-rose-500 hover:text-rose-700">Unlink</button></div>`).join("")
      : `<div class="text-sm text-zinc-400">No personas linked — link one below to blend its learned knowledge into replies.</div>`;
    const picker = avail.length
      ? `<div class="mt-3 flex flex-wrap items-end gap-2">
           <label class="text-sm"><span class="text-zinc-500">Persona</span>
             <select id="ov-plink" class="mt-1 block rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm">
               ${avail.map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(p.lens || "")}</option>`).join("")}</select></label>
           <label class="text-sm"><span class="text-zinc-500">Weight</span>
             <input id="ov-pweight" type="number" step="0.5" min="0" value="1.0" class="mt-1 block w-24 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm"></label>
           <button id="ov-plink-btn" class="${btnP}">Link persona</button></div>`
      : (all.length ? `<div class="mt-3 text-sm text-zinc-400">All personas are linked.</div>`
                    : `<div class="mt-3 text-sm text-zinc-400">No learning personas yet — create one in the Personas tab to teach this agent.</div>`);
    box.innerHTML = `<b class="text-zinc-900 dark:text-white">Knowledge personas</b>
      <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Their beliefs, memories &amp; graph get blended into this agent's replies &amp; content.</p>
      <div class="space-y-2">${linkedHtml}</div>${picker}`;
    box.querySelectorAll("[data-unlink]").forEach((b) => b.onclick = async () => {
      try { await api.agentUnlinkPersona(parseInt(b.getAttribute("data-unlink")), a.id); toast("Persona unlinked"); loadPersonas(); }
      catch (e) { toast("Unlink failed"); }
    });
    const lb = document.getElementById("ov-plink-btn");
    if (lb) lb.onclick = async () => {
      const pid = parseInt(document.getElementById("ov-plink").value);
      const w = parseFloat(document.getElementById("ov-pweight").value) || 1.0;
      lb.disabled = true;
      try { await api.agentLinkPersona(pid, a.id, w); toast("Persona linked"); loadPersonas(); }
      catch (e) { toast("Link failed"); lb.disabled = false; }
    };
  }
  loadPersonas();
  icons();
}

// ── Opportunities ─────────────────────────────────────────────────────────
// Shared platform colour + lifecycle status helpers (used by Opportunities +
// Inbox). Social platforms get their own tint now that social fetch is wired.
function platformBadge(pf) {
  pf = (pf || "").toLowerCase();
  if (pf.includes("reddit")) return "bg-reddit/15 text-reddit";
  if (pf === "hn") return "bg-amber-500/15 text-amber-500";
  if (pf === "x" || pf === "twitter") return "bg-zinc-900/10 text-zinc-900 dark:bg-white/15 dark:text-white";
  if (pf === "tiktok") return "bg-pink-500/15 text-pink-500";
  if (pf === "instagram") return "bg-fuchsia-500/15 text-fuchsia-500";
  if (pf === "threads") return "bg-zinc-500/15 text-zinc-500";
  if (pf === "youtube") return "bg-red-500/15 text-red-500";
  if (pf === "bluesky") return "bg-sky-500/15 text-sky-500";
  if (pf === "mastodon") return "bg-purple-500/15 text-purple-500";
  if (pf === "pinterest") return "bg-rose-500/15 text-rose-500";
  if (pf === "truthsocial") return "bg-red-600/15 text-red-600";
  return "bg-brand/15 text-brand";
}
// Community label: "r/x" only for Reddit. Social adapters hardcode `sub` to the
// platform name (not a real community) — show nothing in that case; show a real
// handle/community plainly when the adapter provides one.
function subLabel(o) {
  const pf = (o.platform || "").toLowerCase();
  const sub = (o.sub || "").trim();
  if (!sub) return "";
  if (pf.includes("reddit")) return `<span class="text-sm text-zinc-500">r/${esc(sub)}</span>`;
  if (sub.toLowerCase() === pf) return "";
  return `<span class="text-sm text-zinc-500">${esc(sub)}</span>`;
}
const OPP_STATUS_META = {
  new: ["new", "bg-zinc-500/15 text-zinc-400"],
  saved: ["saved", "bg-sky-500/15 text-sky-500"],
  drafted: ["drafted", "bg-amber-500/15 text-amber-500"],
  ready: ["ready", "bg-violet-500/15 text-violet-500"],
  queued: ["queued", "bg-indigo-500/15 text-indigo-500"],
  posted: ["posted", "bg-emerald-500/15 text-emerald-500"],
  skipped: ["dismissed", "bg-rose-500/15 text-rose-500"],
  snoozed: ["snoozed", "bg-zinc-400/15 text-zinc-400"],
};
function statusPill(st) {
  const [label, cls] = OPP_STATUS_META[st] || OPP_STATUS_META.new;
  return `<span class="rounded ${cls} px-2 py-0.5 text-xs font-bold">${label}</span>`;
}
// Post-age chip — how old the source post/article is (its own created_utc),
// with the absolute date in a tooltip. Falls back to when we found it.
function postWhen(o) {
  const ts = o.created_utc || o.found_at;
  if (!ts) return "";
  let abs = "";
  try { abs = new Date(ts * 1000).toLocaleString(); } catch (e) { console.error(e); }
  const kind = o.created_utc ? "posted" : "found";
  return `<span class="inline-flex items-center gap-1 text-xs text-zinc-400" title="${kind} ${esc(abs)}"><i data-lucide="clock" class="h-3 w-3"></i>${esc(_ago(ts))}</span>`;
}
// Discovery = the triage queue: New / Snoozed / Dismissed / All. Saved items
// move on to the Inbox workspace, so discovery stops showing them once saved.
const OPP_FILTERS = [
  ["new", "New"], ["snoozed", "Snoozed"], ["skipped", "Dismissed"], ["", "All"],
];
const REPLY_SORTS = [["score", "Top score"], ["recent", "Most recent"], ["engagement", "Most engaged"]];
const MIN_SCORES = [["0", "Any score"], ["0.4", "≥ 40"], ["0.6", "≥ 60"], ["0.8", "≥ 80"]];
const SNOOZE_OPTS = [[3, "3 hours"], [24, "1 day"], [72, "3 days"], [168, "1 week"]];
const PAGE = 25;
const _chip = (on) => `rounded-full px-3 py-1.5 text-xs font-semibold ${on
  ? "bg-reddit text-white" : "border border-zinc-200 dark:border-zinc-700 text-zinc-500"}`;
const inputCls = "rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm";
const skeleton = (n = 3) => Array.from({ length: n }, () =>
  `<div class="${card}"><div class="h-4 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"></div>
     <div class="mt-3 h-4 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"></div>
     <div class="mt-2 h-3 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"></div></div>`).join("");
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export async function renderOpportunities(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  let a = null; try { a = await api.agentGet(); } catch (e) { console.error(e); }
  let _allPfs = []; try { _allPfs = ((await api.replyPlatforms())?.platforms || []).filter((p) => p.can_reply); } catch (e) { console.error(e); }
  // Per-source counts (opportunities found + posts fetched) so the source dropdown
  // shows which source has how much signal — incl. discovery sources (HN, Dev.to,
  // Stack Overflow) that produce opportunities even though you don't reply on them.
  let _cnt = {}; try { _cnt = (await api.replySourceCounts()) || {}; } catch (e) { console.error(e); }
  const _oppC = _cnt.opportunities || {}, _postC = _cnt.posts || {};
  const _srcLabelOf = {}; _allPfs.forEach((p) => { _srcLabelOf[p.key] = p.label; });
  const _srcKeys = [...new Set([..._allPfs.map((p) => p.key), ...Object.keys(_oppC), ...Object.keys(_postC)])]
    .sort((x, y) => ((_oppC[y] || 0) + (_postC[y] || 0)) - ((_oppC[x] || 0) + (_postC[x] || 0)));
  const _srcOptLabel = (k) => {
    const o = _oppC[k] || 0, p = _postC[k] || 0, bits = [];
    if (o) bits.push(`${o} opp`);
    if (p) bits.push(`${p} posts`);
    return (_srcLabelOf[k] || k) + (bits.length ? ` — ${bits.join(" · ")}` : "");
  };
  const _allSrcLabel = `All sources${_cnt.total_opportunities ? ` (${_cnt.total_opportunities} opp · ${_cnt.total_posts || 0} posts)` : ""}`;
  const pfs = (a?.platforms || ["reddit_free"]).join(", ");
  const S = { filter: "new", query: "", sort: "recent", minScore: 0, source: "", offset: 0, items: [], total: 0, sel: new Set() };

  view.innerHTML = head("Opportunities",
    `Discover conversations worth replying to for <b>${esc(a?.name || "—")}</b> — Save the good ones to your Inbox.`,
    `<button id="op-find" class="${btnP}">⚡ Find opportunities</button>`) +
    `<div class="mb-4 flex flex-wrap items-end gap-3 ${card} text-sm">
       <label class="text-zinc-500">Platforms<input id="op-pf" value="${esc(pfs)}" class="mt-1 block w-56 ${inputCls}"></label>
       <label class="text-zinc-500">Per platform<input id="op-lim" type="number" value="15" class="mt-1 block w-20 ${inputCls}"></label>
       <span id="op-status" class="ml-auto text-zinc-400"></span></div>
     <div class="mb-3 flex flex-wrap items-center gap-2">
       <input id="op-q" placeholder="Search title, author, sub…" class="${inputCls} w-60">
       <select id="op-sort" class="${inputCls}">${REPLY_SORTS.map(([v, l]) => `<option value="${v}"${v === S.sort ? " selected" : ""}>${l}</option>`).join("")}</select>
       <select id="op-min" class="${inputCls}">${MIN_SCORES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
       <select id="op-src" class="${inputCls}" title="Source — opportunities found · posts fetched"><option value="">${esc(_allSrcLabel)}</option>${_srcKeys.map((k) => `<option value="${esc(k)}">${esc(_srcOptLabel(k))}</option>`).join("")}</select>
       <div id="op-filters" class="ml-auto flex flex-wrap gap-2">${OPP_FILTERS.map(([v, l]) =>
         `<button data-filter="${v}" class="${_chip(v === "new")}">${l}</button>`).join("")}</div>
     </div>
     <div id="op-bulk" class="mb-3 hidden items-center gap-2 rounded-lg border border-reddit/30 bg-reddit/5 px-3 py-2 text-sm">
       <span id="op-bulk-n" class="font-semibold text-zinc-900 dark:text-white"></span>
       <button data-bulk="save" class="${btn} text-sky-500">☆ Save</button>
       <button data-bulk="skip" class="${btn} text-rose-500">✕ Skip</button>
       <button data-bulk="clear" class="ml-auto text-xs text-zinc-400">clear</button></div>
     <div id="op-list" class="space-y-3"></div>
     <div id="op-more" class="mt-4 hidden text-center"><button class="${btn}">Load more</button></div>`;

  const list = view.querySelector("#op-list");
  const statusEl = view.querySelector("#op-status");
  const moreWrap = view.querySelector("#op-more");
  const bulkBar = view.querySelector("#op-bulk");

  function syncBulk() {
    bulkBar.classList.toggle("hidden", S.sel.size === 0);
    bulkBar.classList.toggle("flex", S.sel.size > 0);
    if (S.sel.size) view.querySelector("#op-bulk-n").textContent = `${S.sel.size} selected`;
  }

  function triageBtns(o) {
    const id = esc(o.id), st0 = o.status || "new";
    const c = "rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold";
    let out = st0 === "saved"
      ? `<a href="#/inbox" class="${c} text-sky-500">★ In Inbox →</a>`
      : `<button data-act="save" data-id="${id}" class="${c} text-sky-500">☆ Save to Inbox</button>`;
    out += `<span class="relative inline-block"><button data-act="snooze-menu" data-id="${id}" class="${c} text-zinc-500">⏰ Snooze</button>
      <span data-menu="${id}" class="absolute z-10 mt-1 hidden w-28 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        ${SNOOZE_OPTS.map(([h, l]) => `<button data-act="snooze" data-id="${id}" data-h="${h}" class="block w-full rounded px-2 py-1 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800">${l}</button>`).join("")}</span></span>`;
    if (st0 !== "skipped") out += `<button data-act="skip" data-id="${id}" class="${c} text-rose-500">✕ Skip</button>`;
    return out;
  }

  function cardHTML(o) {
    const s = Math.round((o.score || 0) * 100);
    return `<div class="${card}" data-card="${esc(o.id)}">
      <div class="flex items-start gap-3">
        <input type="checkbox" data-sel="${esc(o.id)}" ${S.sel.has(o.id) ? "checked" : ""} class="mt-1 h-4 w-4 accent-reddit">
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2"><span class="rounded ${platformBadge(o.platform)} px-2 py-0.5 text-xs font-bold">${esc(o.platform || "")}</span>
              ${subLabel(o)}${statusPill(o.status || "new")}${postWhen(o)}</div>
            <span class="text-2xl font-extrabold ${scoreCls(o.score || 0)}" title="rel ${o.relevance} · intent ${o.intent} · fit ${o.fit} · eng ${o.engagement} · fresh ${o.freshness}">${s}</span></div>
          <div class="mt-1 font-semibold text-zinc-900 dark:text-white">${esc(o.title || "(no title)")}</div>
          ${o.reason ? `<div class="text-sm text-zinc-500 dark:text-zinc-400">${esc(o.reason)}</div>` : ""}
          <div class="mt-3 flex flex-wrap items-center gap-2">
            ${o.url ? `<a href="${esc(o.url)}" target="_blank" class="rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">Open ↗</a>` : ""}
            ${triageBtns(o)}</div>
        </div></div></div>`;
  }

  const emptyMsg = () => {
    if (S.query) return `No opportunities match “${esc(S.query)}”.`;
    // Source-aware: a posts-only source (e.g. YouTube, DuckDuckGo) shows real post
    // counts in the dropdown but has no scored opportunities — explain that instead
    // of a blank list so it doesn't look broken.
    if (S.source) {
      const lbl = _srcLabelOf[S.source] || S.source;
      const o = _oppC[S.source] || 0, p = _postC[S.source] || 0;
      if (!o && p) return `<b>${esc(lbl)}</b> has ${p} post${p === 1 ? "" : "s"} collected but no scored opportunities yet. It's a discovery source — pick a source with opportunities, or click <b>Find opportunities</b>.`;
      if (!o) return `No opportunities from <b>${esc(lbl)}</b> yet. Click <b>Find opportunities</b> to scan it.`;
    }
    if (S.filter === "new") return `No new opportunities. Click <b>Find opportunities</b> to scan your platforms.`;
    return `No ${OPP_STATUS_META[S.filter]?.[0] || "matching"} opportunities.`;
  };

  function paint() {
    list.querySelectorAll("[data-sel]").forEach(cb => cb.onchange = () => {
      cb.checked ? S.sel.add(cb.getAttribute("data-sel")) : S.sel.delete(cb.getAttribute("data-sel"));
      syncBulk();
    });
    list.querySelectorAll("[data-act]").forEach(b => b.onclick = (e) => oppAction(b, e));
    moreWrap.classList.toggle("hidden", S.items.length >= S.total);
    icons();
  }

  async function load(reset = true) {
    if (reset) { S.offset = 0; S.items = []; list.innerHTML = skeleton(); }
    statusEl.textContent = "Loading…";
    try {
      const r = await api.replyList(S.filter || null, S.minScore, PAGE,
        { query: S.query, sort: S.sort, offset: S.offset, platform: S.source });
      const batch = r?.opportunities || [];
      S.total = r?.total ?? batch.length;
      S.items = reset ? batch : S.items.concat(batch);
      statusEl.textContent = S.total ? `${S.items.length} of ${S.total}` : "";
      list.innerHTML = S.items.length ? S.items.map(cardHTML).join("")
        : `<div class="${card} text-zinc-500">${emptyMsg()}</div>`;
      paint();
    } catch (e) {
      list.innerHTML = `<div class="${card} border-rose-500/40 text-rose-500">Couldn't load opportunities — ${esc(e)}
        <div class="mt-2"><button id="op-retry" class="${btn}">Retry</button></div></div>`;
      statusEl.textContent = "";
      const rt = view.querySelector("#op-retry"); if (rt) rt.onclick = () => load(true);
    }
  }

  async function oppAction(b, e) {
    const act = b.getAttribute("data-act"), id = b.getAttribute("data-id");
    if (act === "snooze-menu") {
      e.stopPropagation();
      const m = list.querySelector(`[data-menu="${CSS.escape(id)}"]`);
      list.querySelectorAll("[data-menu]").forEach(x => { if (x !== m) x.classList.add("hidden"); });
      m.classList.toggle("hidden");
      return;
    }
    b.disabled = true;
    try {
      let r;
      if (act === "save") r = await api.replySetStatus(id, "saved");
      else if (act === "skip") r = await api.replySetStatus(id, "skipped");
      else if (act === "snooze") r = await api.replySnooze(id, parseInt(b.getAttribute("data-h"), 10));
      if (r?.error) { toast(r.error); b.disabled = false; return; }
      toast(act === "save" ? "Saved to Inbox" : act === "skip" ? "Dismissed" : "Snoozed");
      S.sel.delete(id); syncBulk();
      // drop the card in place; it leaves the current filter
      const cardEl = list.querySelector(`[data-card="${CSS.escape(id)}"]`);
      if (cardEl && S.filter === "new") { cardEl.remove(); S.items = S.items.filter(o => o.id !== id); S.total = Math.max(0, S.total - 1); statusEl.textContent = S.total ? `${S.items.length} of ${S.total}` : ""; if (!S.items.length) load(true); }
      else load(true);
    } catch (e2) { toast("Failed: " + e2); b.disabled = false; }
  }

  async function bulk(action) {
    const ids = [...S.sel];
    if (!ids.length) return;
    statusEl.textContent = `${action === "save" ? "Saving" : "Skipping"} ${ids.length}…`;
    for (const id of ids) {
      try { await api.replySetStatus(id, action === "save" ? "saved" : "skipped"); } catch (e) { console.error(e); }
    }
    toast(`${action === "save" ? "Saved" : "Skipped"} ${ids.length}`);
    S.sel.clear(); syncBulk(); load(true);
  }

  // wiring
  view.querySelectorAll("[data-filter]").forEach(c => c.onclick = () => {
    S.filter = c.getAttribute("data-filter");
    view.querySelectorAll("[data-filter]").forEach(x => x.className = _chip(x === c));
    S.sel.clear(); syncBulk(); load(true);
  });
  view.querySelector("#op-q").oninput = debounce((e) => { S.query = e.target.value.trim(); load(true); });
  view.querySelector("#op-sort").onchange = (e) => { S.sort = e.target.value; load(true); };
  view.querySelector("#op-min").onchange = (e) => { S.minScore = parseFloat(e.target.value) || 0; load(true); };
  view.querySelector("#op-src").onchange = (e) => { S.source = e.target.value; load(true); };
  bulkBar.querySelectorAll("[data-bulk]").forEach(b => b.onclick = () => {
    const k = b.getAttribute("data-bulk");
    if (k === "clear") { S.sel.clear(); list.querySelectorAll("[data-sel]").forEach(cb => cb.checked = false); syncBulk(); }
    else bulk(k);
  });
  moreWrap.querySelector("button").onclick = () => { S.offset += PAGE; load(false); };
  document.addEventListener("click", () => list.querySelectorAll("[data-menu]").forEach(m => m.classList.add("hidden")), { once: false });

  document.getElementById("op-find").onclick = async () => {
    const pf = document.getElementById("op-pf").value.trim();
    const lim = parseInt(document.getElementById("op-lim").value, 10) || 15;
    statusEl.textContent = "Scanning + scoring… (may take a minute)";
    list.innerHTML = `<div class="${card} animate-pulse text-zinc-500">Scanning ${esc(pf)}…</div>`;
    try {
      const r = await api.replyFind(pf, lim, false);
      if (r?.error) { statusEl.textContent = r.error; return; }
      statusEl.textContent = `Found ${r?.found ?? 0}.`;
      S.filter = "new"; view.querySelectorAll("[data-filter]").forEach(x => x.className = _chip(x.getAttribute("data-filter") === "new"));
      load(true);
    } catch (e) { statusEl.textContent = "Failed: " + e; }
  };
  load(true);
}

// ── Compose ───────────────────────────────────────────────────────────────
// `followup` is a UI pseudo-kind — it expands into followup_reply / followup_post
// based on the sub-mode toggle, and shows a context panel the others don't.
const KINDS = [
  ["post", "Post"], ["thread", "Thread"], ["script", "Short script"],
  ["youtube", "YouTube"], ["article", "Article"], ["followup", "Follow-up"],
  ["repurpose", "Repurpose"],
];
const _pill = (on) => `rounded-full ${on ? "bg-reddit text-white" : "border border-zinc-200 dark:border-zinc-700"} px-4 py-2 text-sm font-semibold`;
const _field = "mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm";

export async function renderCompose(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  let a = null; try { a = await api.agentGet(); } catch (e) { console.error(e); }
  const platforms = a?.platforms || ["reddit_free"];
  // Drafts usable as the "original" for a sequence follow-up.
  let drafts = []; try { drafts = (await api.contentList(null, null, 30))?.content || []; } catch (e) { console.error(e); }

  view.innerHTML = head("Compose", `Generate content for <b>${esc(a?.name || "—")}</b> from its live niche knowledge.`) +
    `<div class="mb-5 ${card}">
       <div id="cm-kinds" class="mb-4 flex flex-wrap gap-2">${KINDS.map(([v, l], i) =>
         `<button data-kind="${v}" class="${_pill(i === 0)}">${esc(l)}</button>`).join("")}</div>

       <div id="cm-ctx" class="mb-4 hidden rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/40 p-4">
         <div id="cm-fmode" class="mb-3 flex gap-2">
           <button data-fmode="reply" class="${_pill(true)}">Reply to a reply</button>
           <button data-fmode="sequence" class="${_pill(false)}">Sequence (part 2)</button>
         </div>
         <div id="cm-fmode-reply">
           <label class="text-zinc-500">Conversation to answer
             <textarea id="cm-ctxtext" rows="4" placeholder="Paste the thread + the latest reply you want to respond to…" class="${_field}"></textarea></label>
         </div>
         <div id="cm-fmode-sequence" class="hidden">
           <label class="text-zinc-500">Original draft to follow up
             <select id="cm-orig" class="${_field}">${drafts.length
               ? drafts.map(d => `<option value="${esc(d.id)}">${esc((d.kind || "") + " · " + (d.title || d.body || "").slice(0, 60))}</option>`).join("")
               : `<option value="">(no drafts yet — generate one first)</option>`}</select></label>
         </div>
         <div id="cm-repurpose-div" class="hidden">
           <label class="text-zinc-500">Source post to rewrite in your voice
             <textarea id="cm-repurpose-text" rows="5" placeholder="Paste the tweet, post, or article you want to repurpose — keep the insight, shed the framing…" class="${_field}"></textarea></label>
           <p class="mt-1 text-xs text-zinc-400">The AI will rewrite this entirely in your brand voice. It stays in your drafts for editing before you post.</p>
         </div>
       </div>

       <div class="flex flex-wrap items-end gap-4 text-sm">
         <label class="text-zinc-500">Platform<select id="cm-pf" class="mt-1 block w-44 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2">${platforms.map(p => `<option>${esc(p)}</option>`).join("")}</select></label>
         <label class="flex-1 text-zinc-500">Angle (optional)<input id="cm-angle" placeholder="leave blank to auto-pick" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
         <button id="cm-gen" class="${btnP}"><i data-lucide="sparkles" class="inline-block h-4 w-4 align-[-2px]"></i> Generate</button></div>
       <span id="cm-status" class="text-sm text-zinc-400"></span></div>
     <div id="cm-out"></div>

     <div class="mb-5 mt-2 ${card}" id="cm-sched">
       <div class="flex items-center justify-between gap-3">
         <div><b class="text-zinc-900 dark:text-white"><i data-lucide="calendar-clock" class="inline-block h-4 w-4 align-[-2px]"></i> Auto-pilot</b>
           <p class="text-sm text-zinc-500">Daily, from your brain + knowledge — drafts waiting when you open the app.</p></div>
         <span id="ap-status" class="shrink-0 text-xs text-zinc-400"></span>
       </div>
       <div class="mt-3 grid gap-4 sm:grid-cols-2">
         <div class="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
           <label class="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white"><input type="checkbox" id="ap-content"> Daily content</label>
           <p class="mt-1 text-xs text-zinc-500">Pick the kinds to auto-draft each day.</p>
           <div class="mt-2 flex flex-wrap gap-1.5" id="ap-kinds"></div>
           <label class="mt-2 block text-xs text-zinc-500">Per day <input type="number" id="ap-ccount" min="1" max="5" value="1" class="ml-1 w-14 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-1"></label>
         </div>
         <div class="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
           <label class="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white"><input type="checkbox" id="ap-opp"> Daily opportunity reply</label>
           <p class="mt-1 text-xs text-zinc-500">Finds fresh threads and drafts the top reply.</p>
           <label class="mt-2 block text-xs text-zinc-500">Per day <input type="number" id="ap-ocount" min="1" max="5" value="1" class="ml-1 w-14 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-1"></label>
         </div>
       </div>
       <div class="mt-3 flex flex-wrap items-center gap-2">
         <button id="ap-save" class="${btnP}">Save schedule</button>
         <button id="ap-run" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-sm font-semibold">Run now</button>
         <span id="ap-msg" class="text-xs text-zinc-400"></span>
       </div>
     </div>

     <h3 class="mb-3 mt-6 font-semibold text-zinc-900 dark:text-white">Recent drafts</h3>
     <div id="cm-recent" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"></div>`;
  icons();
  initAutopilot();

  let kind = "post";
  let fmode = "reply";
  const ctxPanel = document.getElementById("cm-ctx");
  function _applyKind(k) {
    kind = k;
    ctxPanel.classList.toggle("hidden", kind !== "followup" && kind !== "repurpose");
    document.getElementById("cm-fmode").classList.toggle("hidden", kind === "repurpose");
    document.getElementById("cm-fmode-reply").classList.toggle("hidden", kind === "repurpose");
    document.getElementById("cm-fmode-sequence").classList.toggle("hidden", kind === "repurpose" || fmode !== "sequence");
    document.getElementById("cm-repurpose-div").classList.toggle("hidden", kind !== "repurpose");
  }
  document.getElementById("cm-kinds").onclick = (e) => {
    const b = e.target.closest("[data-kind]"); if (!b) return;
    [...document.querySelectorAll("#cm-kinds [data-kind]")].forEach(x =>
      x.className = _pill(x === b));
    _applyKind(b.getAttribute("data-kind"));
  };
  // Check for a repurpose context passed from Watch screen.
  const _rpCtx = sessionStorage.getItem("or-repurpose-ctx");
  if (_rpCtx) {
    sessionStorage.removeItem("or-repurpose-ctx");
    try {
      const d = JSON.parse(_rpCtx);
      const rpBtn = [...document.querySelectorAll("#cm-kinds [data-kind]")].find(b => b.getAttribute("data-kind") === "repurpose");
      if (rpBtn) {
        [...document.querySelectorAll("#cm-kinds [data-kind]")].forEach(x => x.className = _pill(x === rpBtn));
        _applyKind("repurpose");
        const ta = document.getElementById("cm-repurpose-text");
        if (ta) ta.value = [d.title, d.text].filter(x => x && x.trim()).join("\n\n");
      }
    } catch (e) { console.error(e); }
  }
  document.getElementById("cm-fmode").onclick = (e) => {
    const b = e.target.closest("[data-fmode]"); if (!b) return;
    fmode = b.getAttribute("data-fmode");
    [...document.querySelectorAll("#cm-fmode [data-fmode]")].forEach(x => x.className = _pill(x === b));
    document.getElementById("cm-fmode-reply").classList.toggle("hidden", fmode !== "reply");
    document.getElementById("cm-fmode-sequence").classList.toggle("hidden", fmode !== "sequence");
  };

  document.getElementById("cm-gen").onclick = async () => {
    const platform = document.getElementById("cm-pf").value;
    const angle = document.getElementById("cm-angle").value.trim();
    const status = document.getElementById("cm-status");
    const out = document.getElementById("cm-out");

    // Resolve the UI pseudo-kind + gather follow-up / repurpose context.
    let realKind = kind, ctx = {};
    if (kind === "followup") {
      if (fmode === "reply") {
        realKind = "followup_reply";
        ctx.contextText = document.getElementById("cm-ctxtext").value.trim();
        if (!ctx.contextText) { status.textContent = "Paste the conversation to reply to first."; return; }
      } else {
        realKind = "followup_post";
        ctx.contextId = document.getElementById("cm-orig").value;
        if (!ctx.contextId) { status.textContent = "Generate a draft first, then follow up on it."; return; }
      }
    } else if (kind === "repurpose") {
      ctx.contextText = document.getElementById("cm-repurpose-text").value.trim();
      if (!ctx.contextText) { status.textContent = "Paste the source post you want to rewrite first."; return; }
    }

    status.textContent = "Generating…";
    out.innerHTML = `<div class="${card} animate-pulse text-zinc-500">Writing a ${esc(realKind.replace("_", " "))}…</div>`;
    try {
      const c = await api.contentGenerate(realKind, platform, angle, ctx);
      if (!c) { status.textContent = "Run inside the app to generate."; out.innerHTML = ""; return; }
      if (c.error) { status.textContent = c.error; out.innerHTML = ""; return; }
      status.textContent = "Done ✓";
      out.innerHTML = contentCard(c, true);
      loadRecent();
    } catch (e) { status.textContent = "Failed: " + e; out.innerHTML = ""; }
  };

  // One delegated handler for Save / Schedule on every card (output + recent).
  view.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-cm-act]"); if (!b) return;
    const wrap = b.closest("[data-cid]"); if (!wrap) return;
    const id = wrap.getAttribute("data-cid");
    const ta = wrap.querySelector("textarea");
    const msg = wrap.querySelector("[data-cm-msg]");
    const act = b.getAttribute("data-cm-act");
    try {
      let r;
      if (act === "publish-x") {
        if (ta) { try { await api.contentUpdate(id, { body: ta.value }); } catch (e) { console.error(e); } }
        if (msg) msg.textContent = "Posting to X…";
        r = await api.contentPublishX(id, false);
        if (r === null) { if (msg) msg.textContent = "Run inside the app."; return; }
        if (r?.error) { if (msg) msg.textContent = /credential/i.test(r.error) ? "No X credentials — Settings → Connect X" : r.error; return; }
        if (msg) msg.textContent = r?.url ? `Posted ✓ (${r.parts} tweet${r.parts > 1 ? "s" : ""})` : "Posted ✓";
        loadRecent();
        return;
      }
      if (act === "save") r = await api.contentUpdate(id, { body: ta ? ta.value : null });
      else if (act === "schedule") r = await api.contentUpdate(id, { status: "scheduled", scheduledAt: Math.floor(Date.now() / 1000) });
      if (r === null) { if (msg) msg.textContent = "Run inside the app."; return; }
      if (r?.error) { if (msg) msg.textContent = r.error; return; }
      if (msg) msg.textContent = act === "save" ? "Saved ✓" : "Scheduled ✓";
      if (act === "schedule") loadRecent();
    } catch (err) { if (msg) msg.textContent = "Failed: " + err; }
  });

  async function loadRecent() {
    const wrap = document.getElementById("cm-recent");
    try {
      const r = await api.contentList(null, null, 12); const items = r?.content || [];
      wrap.innerHTML = items.length ? items.map(c => contentCard(c, false)).join("") : `<div class="text-zinc-500">No drafts yet.</div>`;
    } catch (e) { wrap.innerHTML = `<div class="text-rose-500">${esc(e)}</div>`; }
  }

  // Auto-pilot: configure the daily content + opportunity schedule.
  async function initAutopilot() {
    const AP_KINDS = [["post", "Post"], ["thread", "Thread"], ["article", "Article"], ["youtube", "YouTube"], ["script", "Short"]];
    let cfg = null, sched = null;
    try { cfg = await api.agentAutopilot(); } catch (e) { console.error(e); }
    try { sched = await api.scheduleStatus(); } catch (e) { console.error(e); }
    const apc = document.getElementById("ap-content"); if (!apc) return;  // panel not present
    const c = (cfg && cfg.content) || { enabled: true, count: 1, kinds: ["post"] };
    const o = (cfg && cfg.opportunity) || { enabled: true, count: 1 };
    const sel = new Set(c.kinds || ["post"]);
    apc.checked = !!c.enabled;
    document.getElementById("ap-opp").checked = !!o.enabled;
    document.getElementById("ap-ccount").value = c.count || 1;
    document.getElementById("ap-ocount").value = o.count || 1;
    const kindsBox = document.getElementById("ap-kinds");
    const paint = () => { kindsBox.innerHTML = AP_KINDS.map(([v, l]) => `<button type="button" data-apk="${v}" class="${_pill(sel.has(v))} !px-3 !py-1 text-xs">${esc(l)}</button>`).join(""); };
    paint();
    kindsBox.onclick = (e) => { const b = e.target.closest("[data-apk]"); if (!b) return; const k = b.getAttribute("data-apk"); sel.has(k) ? sel.delete(k) : sel.add(k); if (!sel.size) sel.add(k); paint(); };
    document.getElementById("ap-status").textContent = (sched && (sched.installed || sched.loaded)) ? "scheduler on ✓" : "scheduler off";
    document.getElementById("ap-save").onclick = async () => {
      const msg = document.getElementById("ap-msg"); msg.textContent = "Saving…";
      const contentOn = apc.checked, oppOn = document.getElementById("ap-opp").checked;
      try {
        const r = await api.agentAutopilotSet({
          content: contentOn, contentKinds: [...sel].join(","), contentCount: +document.getElementById("ap-ccount").value || 1,
          opportunity: oppOn, oppCount: +document.getElementById("ap-ocount").value || 1,
        });
        if (r === null) { msg.textContent = "Run inside the app to save."; return; }
        if (contentOn || oppOn) { try { await api.scheduleInstall(24); document.getElementById("ap-status").textContent = "scheduler on ✓"; } catch (e) { console.error(e); } }
        msg.textContent = "Saved ✓ — runs daily"; toast("Auto-pilot saved");
      } catch (e) { msg.textContent = "Failed: " + e; }
    };
    document.getElementById("ap-run").onclick = async () => {
      const msg = document.getElementById("ap-msg"), btn = document.getElementById("ap-run");
      btn.disabled = true; btn.textContent = "Running…"; msg.textContent = "Generating from your brain… (a moment)";
      try {
        const r = await api.agentAutopilotRun();
        if (r === null) { msg.textContent = "Run inside the app."; }
        else { const cN = ((r.content && r.content.generated) || []).length, oN = ((r.opportunity && r.opportunity.drafted) || []).length; msg.textContent = `Created ${cN} content + ${oN} reply draft(s)`; toast("Auto-pilot ran"); loadRecent(); }
      } catch (e) { msg.textContent = "Failed: " + e; }
      finally { btn.disabled = false; btn.textContent = "Run now"; }
    };
    icons();
  }

  loadRecent();
}

function contentCard(c, big) {
  const statusColor = c.status === "scheduled" ? "bg-emerald-500/15 text-emerald-500"
    : c.status === "posted" ? "bg-sky-500/15 text-sky-500" : "bg-amber-500/15 text-amber-500";
  return `<div class="${card}" data-cid="${esc(c.id)}">
    <div class="flex items-center gap-2"><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">${esc((c.kind || "").replace("_", " "))}</span>
      <span class="text-xs text-zinc-500">${esc(c.platform || "")}</span>
      <span class="rounded ${statusColor} px-2 py-0.5 text-xs font-bold">${esc(c.status || "draft")}</span></div>
    <textarea rows="${big ? 8 : 4}" class="mt-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm">${esc(c.body || "")}</textarea>
    <div class="mt-2 flex items-center gap-2">
      <button data-cm-act="save" class="rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white">Save draft</button>
      <button data-cm-act="schedule" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Schedule</button>
      ${/^(x|twitter)$/i.test(c.platform || "") ? `<button data-cm-act="publish-x" class="rounded-full border border-zinc-900 dark:border-white px-3 py-1.5 text-xs font-semibold text-zinc-900 dark:text-white">𝕏 Publish</button>` : ""}
      <span data-cm-msg class="text-xs text-zinc-400"></span>
    </div></div>`;
}

// ── Connections (Reach credentials) ───────────────────────────────────────
const _connInput = (id, ph, type = "text") =>
  `<input id="${id}" type="${type}" placeholder="${esc(ph)}" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm">`;

function connBadge(c) {
  if (c.connected) return ['connected', 'bg-emerald-500/15 text-emerald-500'];
  if (c.kind === "public") return ['unreachable', 'bg-rose-500/15 text-rose-500'];
  if (c.kind === "api_key") return ['needs key', 'bg-amber-500/15 text-amber-500'];
  if (c.kind === "login_pair") return ['needs login', 'bg-amber-500/15 text-amber-500'];
  return ['not connected', 'bg-rose-500/15 text-rose-500'];
}

// A pill toggle for "use this source in collection runs". Shown on any
// connected (or public) source. Reflects c.enabled.
function connToggle(c) {
  const s = esc(c.source);
  const on = !!c.enabled;
  const cls = on
    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40'
    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-700';
  return `<button data-act="toggle" data-src="${s}" data-enabled="${on ? "0" : "1"}"
    class="rounded-full border ${cls} px-3 py-1.5 text-xs font-semibold"
    title="Whether this source is pulled into collection runs">
    <i data-lucide="${on ? "check" : "circle"}" class="inline-block h-3.5 w-3.5 align-[-2px]"></i>
    ${on ? "Used in collection" : "Not used"}</button>`;
}

export async function renderConnections(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = head("Connections",
    "Log in to platforms to unlock authenticated reach. Read-only &amp; account-safe — we never post for you or need your password.",
    `<button id="cn-test-all" class="${btnP}">⚡ Test all</button>`) +
    `<p class="mb-5 rounded-lg bg-reddit/10 px-3 py-2 text-sm text-reddit"><i data-lucide="lock" class="inline-block h-4 w-4 align-[-2px]"></i> Credentials are stored locally on this machine only. Connect a platform and it's automatically pulled into your collection runs — toggle "Used in collection" to opt out. Public sources (Hacker News, Dev.to, Mastodon, YouTube) need no login.</p>
     <div id="cn-summary" class="mb-5"></div>
     <div id="cn-grid" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><div class="text-zinc-500">Loading connections…</div></div>`;

  const grid = document.getElementById("cn-grid");

  async function load() {
    try {
      const rows = (await api.credsList()) || [];
      const _accts = rows.filter((c) => c.connected && c.kind !== "public");
      const _pub = rows.filter((c) => c.kind === "public" && c.enabled !== false);
      const _sum = document.getElementById("cn-summary");
      if (_sum) _sum.innerHTML = _accts.length
        ? `<div class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm">
             <span class="font-bold text-emerald-600 dark:text-emerald-400"><i data-lucide="check-circle-2" class="inline-block h-4 w-4 align-[-2px]"></i> ${_accts.length} account${_accts.length > 1 ? "s" : ""} connected:</span>
             ${_accts.map((c) => `<span class="ml-1 inline-block rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-zinc-800 dark:text-emerald-300">${esc(c.label)}</span>`).join(" ")}
             <span class="ml-2 text-zinc-500">· ${_pub.length} public source${_pub.length === 1 ? "" : "s"} active</span></div>`
        : `<div class="rounded-lg border border-zinc-200 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700">No accounts connected yet — log in to a platform below to unlock authenticated reach (${_pub.length} public sources already active).</div>`;
      grid.innerHTML = rows.length
        ? rows.map(connCard).join("")
        : `<div class="${card} text-zinc-500">No reachable platforms configured.</div>`;
      grid.querySelectorAll("[data-act]").forEach(b => b.onclick = () => connAction(b));
      icons();
    } catch (e) {
      grid.innerHTML = `<div class="rounded-xl border border-rose-500/40 bg-rose-500/5 p-4 text-rose-500">${esc(e)}</div>`;
    }
  }

  function connCard(c) {
    const [label, cls] = connBadge(c);
    const meta = c.username ? `@${esc(c.username)}` :
      c.kind === "public" ? "Public API — no login" :
      c.kind === "api_key" ? "Needs an API key" :
      c.kind === "login_pair" ? "Needs login" : "Browser cookie login";
    const verified = c.last_verified_at ? `verified ${esc(String(c.last_verified_at).slice(0, 10))}` : "";
    const btn = "rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold";
    const primary = "rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white hover:bg-reddit-hi";
    let actions = "";
    const s = esc(c.source);
    const dl = `data-label="${esc(c.label)}"`;
    // Preview = live-fetch a sample of real content (titles + links) in a modal.
    // The truest "is this source working?" test. Shown on public + connected cards
    // (LinkedIn is URL-reader only, no topic search).
    const canPreview = (c.kind === "public" || c.connected) && c.source !== "linkedin";
    const prevBtn = canPreview ? `<button data-act="preview" data-src="${s}" ${dl} class="${primary}"><i data-lucide="eye" class="inline-block h-3.5 w-3.5 align-[-2px]"></i> Test reach</button>` : "";
    if (c.kind === "public") {
      actions = `${prevBtn}<button data-act="verify" data-src="${s}" class="${btn}">Check status</button>`;
    } else if (c.kind === "api_key") {
      actions = c.connected
        ? `${prevBtn}<button data-act="verify" data-src="${s}" class="${btn}">Verify</button>
           <button data-act="delete" data-src="${s}" class="${btn} text-rose-500">Remove key</button>`
        : `<button data-act="key" data-src="${s}" ${dl} class="${primary}">Add key</button>
           ${c.login_url ? `<button data-act="open" data-url="${esc(c.login_url)}" class="${btn}">Get key ↗</button>` : ""}`;
    } else if (c.kind === "login_pair") {
      actions = c.connected
        ? `${prevBtn}<button data-act="verify" data-src="${s}" class="${btn}">Verify</button>
           <button data-act="pair" data-src="${s}" ${dl} class="${btn}">Reconnect</button>
           <button data-act="delete" data-src="${s}" class="${btn} text-rose-500">Disconnect</button>`
        : `${c.login_url ? `<button data-act="open" data-url="${esc(c.login_url)}" class="${btn}">Get app password ↗</button>` : ""}
           <button data-act="pair" data-src="${s}" ${dl} class="${primary}">Add login</button>`;
    } else { // cookie
      actions = c.connected
        ? `${prevBtn}<button data-act="verify" data-src="${s}" class="${btn}">Verify</button>
           <button data-act="cookie" data-src="${s}" ${dl} class="${btn}">Reconnect</button>
           <button data-act="delete" data-src="${s}" class="${btn} text-rose-500">Disconnect</button>`
        : `${c.login_url ? `<button data-act="open" data-url="${esc(c.login_url)}" class="${primary}">Log in ↗</button>` : ""}
           <button data-act="import" data-src="${s}" class="${btn}">Import from browser</button>
           <button data-act="cookie" data-src="${s}" ${dl} class="${btn}">Paste cookie</button>`;
    }
    // "Unlocks" chips — shown when one connection feeds >1 collection source
    // (e.g. the single ScrapeCreators key → tiktok/instagram/threads/pinterest).
    const unlocks = Array.isArray(c.unlocks) ? c.unlocks : [];
    const unlocksRow = (unlocks.length > 1)
      ? `<p class="mb-2 text-xs text-zinc-400 dark:text-zinc-500">Unlocks: ${unlocks.map(u => esc(u)).join(" · ")}</p>` : "";
    const noteRow = c.note ? `<p class="mb-2 text-xs text-zinc-400 dark:text-zinc-500">${esc(c.note)}</p>` : "";
    const usesRow = c.uses ? `<p class="mb-2 text-sm text-zinc-600 dark:text-zinc-300">${esc(c.uses)}</p>` : "";
    // The use-in-collection toggle only makes sense once the source is reachable.
    const toggleRow = c.connected ? `<div class="mt-2">${connToggle(c)}</div>` : "";
    // Persistent hint on not-yet-connected cookie cards: which cookies are needed
    // + how. The live "why import failed" reason still appears in the msg row.
    const cookieHint = (c.kind === "cookie" && !c.connected && (c.need || []).length)
      ? `<p class="mb-2 text-xs text-zinc-400 dark:text-zinc-500">Needs ${(c.need).map(n => `<code class="text-zinc-600 dark:text-zinc-300">${esc(n)}</code>`).join(", ")} — log in &amp; Import, or Paste via Cookie-Editor → Export.</p>`
      : "";
    return `<div class="${card}">
      <div class="flex items-center justify-between"><b class="text-zinc-900 dark:text-white">${esc(c.label)}</b>
        <span class="rounded ${cls} px-2 py-0.5 text-xs font-bold">${label}</span></div>
      <p class="mb-2 mt-2 text-sm text-zinc-500 dark:text-zinc-400">${meta}${verified ? ` · ${verified}` : ""}</p>
      ${usesRow}${noteRow}${cookieHint}${unlocksRow}
      <div class="flex flex-wrap gap-2" data-card="${s}">${actions}</div>
      ${toggleRow}
      <div data-msg="${s}" class="mt-2 text-xs"></div>
    </div>`;
  }

  function setMsg(src, txt, ok) {
    const el = grid.querySelector(`[data-msg="${CSS.escape(src)}"]`);
    if (el) el.innerHTML = `<span class="${ok ? "text-emerald-500" : "text-zinc-500"}">${esc(txt)}</span>`;
  }

  async function connAction(b) {
    const act = b.getAttribute("data-act");
    const src = b.getAttribute("data-src");
    const label = b.getAttribute("data-label") || src;
    if (act === "open") { try { await api.openUrl(b.getAttribute("data-url")); } catch (e) { toast("Could not open browser"); } return; }
    if (act === "verify") {
      setMsg(src, "Checking…"); b.disabled = true;
      try { const r = (await api.credsVerify(src))?.[0] || {}; setMsg(src, r.message || (r.connected ? "OK" : "Failed"), !!r.connected); load(); }
      catch (e) { setMsg(src, String(e)); }
      b.disabled = false; return;
    }
    if (act === "preview") {
      setMsg(src, "Fetching live content…"); b.disabled = true;
      let r = {};
      try { r = (await api.credsPreview(src, null, 6)) || {}; }
      catch (e) { setMsg(src, "Failed: " + e); b.disabled = false; return; }
      b.disabled = false;
      setMsg(src, r.message || (r.ok ? "OK" : "No results"), !!r.ok);
      if (r.ok) load();  // a successful credentialed preview stamps verified
      const items = Array.isArray(r.items) ? r.items : [];
      const body = items.length
        ? `<div class="max-h-[55vh] space-y-2 overflow-auto">${items.map(it => {
            const meta = [it.author ? "by " + esc(it.author) : "", it.source_type ? esc(it.source_type) : "",
              it.score != null ? esc(it.score) + " pts" : "", it.comments != null ? esc(it.comments) + " comments" : ""]
              .filter(Boolean).join(" · ");
            return `<div class="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
              <div class="font-semibold text-zinc-900 dark:text-white">${it.url
                ? `<a href="${esc(it.url)}" target="_blank" rel="noreferrer" class="text-reddit hover:underline">${esc(it.title)} ↗</a>`
                : esc(it.title)}</div>
              ${meta ? `<div class="mt-0.5 text-xs text-zinc-400">${meta}</div>` : ""}
              ${it.snippet ? `<div class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">${esc(it.snippet)}</div>` : ""}</div>`;
          }).join("")}</div>`
        : `<p class="text-sm text-zinc-500">${esc(r.message || "No content returned.")}</p>`;
      window.orModal({
        title: `${esc(label)} — live preview${r.query ? ` · “${esc(r.query)}”` : ""}`,
        body: `<p class="mb-3 text-sm text-zinc-500">${items.length ? `Real content this source returns right now (${items.length} items). Click a title to open it.` : "No content — connect/verify the credential, or this source may be rate-limited."}</p>${body}`,
        okText: "Done",
      });
      return;
    }
    if (act === "import") {
      setMsg(src, "Reading cookies from your browser…"); b.disabled = true;
      try { const r = (await api.credsImportBrowser(src, null))?.[0] || {}; setMsg(src, r.message || "Done", !!r.connected); load(); }
      catch (e) { setMsg(src, String(e)); }
      b.disabled = false; return;
    }
    if (act === "delete") {
      try { await api.credsDelete(src); toast("Disconnected " + label); load(); } catch (e) { toast("Failed: " + e); }
      return;
    }
    if (act === "toggle") {
      const enable = b.getAttribute("data-enabled") === "1";
      b.disabled = true;
      try { const r = (await api.credsToggle(src, enable))?.[0] || {}; setMsg(src, r.message || "Updated", enable); load(); }
      catch (e) { setMsg(src, String(e)); b.disabled = false; }
      return;
    }
    if (act === "pair") {
      const c = (await api.credsList() || []).find(x => x.source === src) || {};
      const fa = c.field_a || "field_a", fb = c.field_b || "field_b";
      const la = c.label_a || "Field A", lb = c.label_b || "Field B";
      window.orModal({
        title: "Connect " + label,
        body: `<p class="mb-2 text-sm text-zinc-500 dark:text-zinc-400">${esc(c.note || "Stored locally only.")}</p>
          <label class="text-xs font-semibold text-zinc-500">${esc(la)}</label>${_connInput("cn-a", la)}
          <label class="mt-3 block text-xs font-semibold text-zinc-500">${esc(lb)}</label>${_connInput("cn-b", lb, "password")}`,
        okText: "Save & verify",
        onOk: async (ov) => {
          const a = (ov.querySelector("#cn-a")?.value || "").trim();
          const bv = (ov.querySelector("#cn-b")?.value || "").trim();
          if (!a || !bv) { toast("Both fields required"); return; }
          setMsg(src, "Saving & verifying…");
          const payload = JSON.stringify({ [fa]: a, [fb]: bv });
          try { const r = (await api.credsSaveManual(src, payload))?.[0] || {}; setMsg(src, r.message || "Done", !!r.connected); load(); }
          catch (e) { setMsg(src, String(e)); }
        },
      });
      return;
    }
    if (act === "cookie" || act === "key") {
      const isKey = act === "key";
      const c = (await api.credsList() || []).find(x => x.source === src) || {};
      const need = c.need || [];
      const needHint = need.length
        ? `<div class="mb-2 rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">Copy ${need.length > 1 ? "these cookies" : "this cookie"}: ${need.map(n => `<code class="font-bold text-zinc-900 dark:text-white">${esc(n)}</code>`).join(", ")}</div>`
        : "";
      const loginLink = c.login_url
        ? `<a href="${esc(c.login_url)}" target="_blank" class="text-reddit underline">open ${esc(label)} login ↗</a>`
        : "the site";
      const placeholder = need.length ? need.map(n => n + "=…").join("; ") : "session=…; csrf=…";
      window.orModal({
        title: (isKey ? "Add API key for " : "Paste cookie for ") + label,
        body: isKey
          ? `<p class="mb-2 text-sm text-zinc-500 dark:text-zinc-400">Paste your API key. Stored locally only.</p>${_connInput("cn-val", "key…", "password")}`
          : `${needHint}<p class="mb-2 text-sm text-zinc-500 dark:text-zinc-400">1) Log into ${loginLink}. 2) In the <b>Cookie-Editor</b> extension → <b>Export</b> (or copy the named cookies). 3) Paste below as <code>name=value; name2=value2</code> or a JSON map.</p><textarea id="cn-val" rows="4" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm" placeholder="${esc(placeholder)}"></textarea>`,
        okText: "Save & verify",
        onOk: async (ov) => {
          const val = (ov.querySelector("#cn-val")?.value || "").trim();
          if (!val) { toast("Empty value"); return; }
          setMsg(src, "Saving & verifying…");
          try { const r = (await api.credsSaveManual(src, val))?.[0] || {}; setMsg(src, r.message || "Done", !!r.connected); load(); }
          catch (e) { setMsg(src, String(e)); }
        },
      });
    }
  }

  // Test-all: run the real per-source verify for every reachable source
  // (public sources + connected credentials), updating each card live.
  async function testAll() {
    const btnEl = document.getElementById("cn-test-all");
    const rows = (await api.credsList()) || [];
    const targets = rows.filter(c => c.kind === "public" || c.connected);
    if (!targets.length) { toast("Nothing to test yet — connect a platform first."); return; }
    btnEl.disabled = true; const orig = btnEl.textContent;
    let ok = 0, fail = 0;
    for (let i = 0; i < targets.length; i++) {
      const src = targets[i].source;
      btnEl.textContent = `Testing ${i + 1}/${targets.length}…`;
      setMsg(src, "Checking…");
      try {
        const r = (await api.credsVerify(src))?.[0] || {};
        setMsg(src, r.message || (r.connected ? "OK" : "Failed"), !!r.connected);
        r.connected ? ok++ : fail++;
      } catch (e) { setMsg(src, String(e)); fail++; }
    }
    btnEl.textContent = orig; btnEl.disabled = false;
    toast(`Tested ${targets.length}: ${ok} reachable, ${fail} failed`);
    load();
  }

  const testAllBtn = document.getElementById("cn-test-all");
  if (testAllBtn) testAllBtn.onclick = testAll;
  load();
}

// ── Settings ──────────────────────────────────────────────────────────────
const LLM_PROVIDERS = [
  ["anthropic", "Anthropic (Claude)", "ANTHROPIC_API_KEY", "sk-ant-…"],
  ["openai", "OpenAI", "OPENAI_API_KEY", "sk-…"],
  ["openrouter", "OpenRouter", "OPENROUTER_API_KEY", "sk-or-…"],
  ["groq", "Groq", "GROQ_API_KEY", "gsk_…"],
  ["deepseek", "DeepSeek", "DEEPSEEK_API_KEY", "sk-…"],
  ["mistral", "Mistral", "MISTRAL_API_KEY", "…"],
  ["google", "Google Gemini", "GOOGLE_API_KEY", "AIza…"],
  ["nvidia", "NVIDIA NIM", "NVIDIA_API_KEY", "nvapi-…"],
  ["ollama", "Local Ollama", "OLLAMA_BASE_URL", "http://localhost:11434"],
];

export async function renderSettings(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = head("Settings", "AI provider, appearance, custom feeds, and your local data.") +
    `<div class="mb-4 relative max-w-md">
       <i data-lucide="search" class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"></i>
       <input id="set-search" type="search" autocomplete="off" placeholder="Search settings…" class="${inputCls} w-full pl-9">
       <p id="set-empty" class="mt-2 hidden text-sm text-zinc-400">No settings match.</p></div>
     <div id="set-grid" class="grid gap-4 lg:grid-cols-2">
       <div id="st-profile" data-skw="profile name avatar account you identity" class="${card}"><div class="text-zinc-500">Loading profile…</div></div>
       <div id="st-llm" data-skw="ai provider llm api key model anthropic openai gemini ollama byok draft" class="${card}"><div class="text-zinc-500">Loading provider…</div></div>
       <div id="st-appear" data-skw="appearance theme dark light mode display" class="${card}"></div>
       <div id="st-auto" data-skw="automation schedule auto refresh learn cadence daily weekly launchd cron background" class="${card}"><div class="text-zinc-500">Loading automation…</div></div>
       <div id="st-mcp" data-skw="mcp connect claude code cursor windsurf desktop integration tools agent client" class="${card}"><div class="text-zinc-500">Loading MCP…</div></div>
       <div id="st-usage" data-skw="usage limits token cap spend cost budget today" class="${card}"><div class="text-zinc-500">Loading usage…</div></div>
       <div id="st-semantic" data-skw="semantic memory embeddings palace vector graph model reindex learning" class="${card}"><div class="text-zinc-500">Loading…</div></div>
       <div id="st-feeds" data-skw="feeds rss custom sources news add url" class="${card}"><div class="text-zinc-500">Loading feeds…</div></div>
       <div id="st-publish" data-skw="publish x twitter post tweet thread api key oauth social outbound connect" class="${card}"><div class="text-zinc-500">Loading publishing…</div></div>
       <div id="st-notify" data-skw="notifications telegram slack bot alerts opportunity reminder reply article webhook chat push mobile two-way" class="${card}"><div class="text-zinc-500">Loading notifications…</div></div>
       <div id="st-power" data-skw="cli terminal install symlink export folder power tools" class="${card}"><div class="text-zinc-500">Loading…</div></div>
       <div id="st-data" data-skw="data export reset delete local database backup storage wipe" class="${card}"><div class="text-zinc-500">Loading data…</div></div>
       <div id="st-about" data-skw="about version support feedback email github issue logs help" class="${card}"><div class="text-zinc-500">Loading…</div></div>
     </div>`;
  buildProfileCard(document.getElementById("st-profile"));
  buildLlmCard(document.getElementById("st-llm"));
  buildAppearanceCard(document.getElementById("st-appear"));
  buildAutomationCard(document.getElementById("st-auto"));
  buildMcpCard(document.getElementById("st-mcp"));
  buildUsageCard(document.getElementById("st-usage"));
  buildSemanticCard(document.getElementById("st-semantic"));
  buildFeedsCard(document.getElementById("st-feeds"));
  buildPublishCard(document.getElementById("st-publish"));
  buildNotifyCard(document.getElementById("st-notify"));
  buildPowerCard(document.getElementById("st-power"));
  buildDataCard(document.getElementById("st-data"));
  buildAboutCard(document.getElementById("st-about"));
  const setSearch = document.getElementById("set-search");
  if (setSearch) setSearch.oninput = () => {
    const q = setSearch.value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll("#set-grid > div[data-skw]").forEach((d) => {
      const kw = d.getAttribute("data-skw") + " " + (d.textContent || "").toLowerCase();
      const ok = !q || kw.includes(q);
      d.style.display = ok ? "" : "none";
      if (ok) shown++;
    });
    const empty = document.getElementById("set-empty");
    if (empty) empty.classList.toggle("hidden", shown > 0);
  };
  icons();
}

// ── Telegram / Slack notifications ──────────────────────────────────────────
// The two-way Telegram poller runs only while the app is open: a module-level
// interval calls bot-poll --once, so button taps (Approve/Regenerate/Skip) are
// handled live, and it stops the moment the window closes. No always-on server.
let _botTimer = null;
export async function ensureBotPoller() {
  try {
    const c = await api.notifyGet();
    const want = c && c.enabled && c.two_way && c.has_telegram;
    if (want && !_botTimer) {
      const tick = async () => { try { await api.botPollOnce(); } catch (e) { console.error(e); } };
      _botTimer = setInterval(tick, 4000);
      tick();
    } else if (!want && _botTimer) {
      clearInterval(_botTimer); _botTimer = null;
    }
  } catch (e) { console.error(e); }
}
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => { if (_botTimer) { clearInterval(_botTimer); _botTimer = null; } });
}

async function buildNotifyCard(el) {
  let c = {};
  try { c = (await api.notifyGet()) || {}; } catch (e) {
    el.innerHTML = `<b class="text-zinc-900 dark:text-white">Notifications</b><p class="mt-1 text-sm text-rose-500">Unavailable: ${esc(e)}</p>`; return;
  }
  const ev = c.events || {};
  const onBadge = c.enabled
    ? `<span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">on</span>`
    : `<span class="rounded bg-zinc-500/15 px-2 py-0.5 text-xs font-bold text-zinc-400">off</span>`;
  const chk = (id, on, label) =>
    `<label class="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300"><input type="checkbox" id="${id}" ${on ? "checked" : ""} class="h-4 w-4 accent-reddit"> ${label}</label>`;
  el.innerHTML = `
    <div class="flex items-center gap-2"><b class="text-zinc-900 dark:text-white">Notifications</b>${onBadge}</div>
    <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Get pinged on <b>Telegram</b> or <b>Slack</b> when there's a new opportunity, a freshly drafted post, or a reply due — with the draft + link so you can post fast. Tokens stay on this Mac.</p>

    <div class="mb-3">
      <div class="mb-1 text-xs font-bold uppercase tracking-wide text-zinc-400">Telegram${c.has_telegram ? ` <span class="text-emerald-500">· saved ${esc(c.telegram_hint)}</span>` : ""}</div>
      <p class="mb-2 text-xs text-zinc-500">Message <a href="https://t.me/BotFather" target="_blank" class="text-reddit underline">@BotFather</a> → <code>/newbot</code> for a token, then <a href="https://t.me/userinfobot" target="_blank" class="text-reddit underline">@userinfobot</a> for your chat id. Supports two-way buttons (Approve / Regenerate / Skip).</p>
      <div class="grid gap-2 sm:grid-cols-2">
        <input id="nt-token" type="password" placeholder="${c.has_telegram ? "Bot token (leave blank to keep)" : "Bot token"}" class="${inputCls}">
        <input id="nt-chat" placeholder="Chat id" value="${esc(c.telegram_chat || "")}" class="${inputCls}">
      </div>
    </div>

    <div class="mb-3">
      <div class="mb-1 text-xs font-bold uppercase tracking-wide text-zinc-400">Slack${c.has_slack ? ` <span class="text-emerald-500">· saved ${esc(c.slack_hint)}</span>` : ""}</div>
      <p class="mb-2 text-xs text-zinc-500">Create an <a href="https://api.slack.com/messaging/webhooks" target="_blank" class="text-reddit underline">Incoming Webhook ↗</a> for a channel. Notify-only — Slack buttons need a public server a local Mac can't host.</p>
      <input id="nt-slack" type="password" placeholder="${c.has_slack ? "Webhook URL (leave blank to keep)" : "https://hooks.slack.com/services/…"}" class="${inputCls} w-full">
    </div>

    <div class="mb-3">
      <div class="mb-1 text-xs font-bold uppercase tracking-wide text-zinc-400">Send me</div>
      <div class="grid gap-1.5 sm:grid-cols-2">
        ${chk("nt-ev-opp", ev.opportunity, "New opportunities")}
        ${chk("nt-ev-article", ev.article, "New drafted posts")}
        ${chk("nt-ev-reply", ev.reply, "Replies due (reminder)")}
        ${chk("nt-ev-digest", ev.digest, "Daily digest")}
        ${chk("nt-ev-geo", ev.geo, "AI-visibility changes")}
      </div>
      <label class="mt-2 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">Min opportunity match
        <input id="nt-minscore" type="number" min="0" max="1" step="0.05" value="${Number(c.min_score || 0)}" class="${inputCls} w-24"></label>
    </div>

    <div class="mb-3 flex flex-wrap gap-3">
      ${chk("nt-enabled", c.enabled, "Notifications on")}
      ${chk("nt-twoway", c.two_way, "Telegram two-way buttons")}
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <button id="nt-save" class="${btnP}">Save</button>
      <button id="nt-test" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold">Send test</button>
      <span id="nt-msg" class="text-xs text-zinc-400"></span>
    </div>`;

  const msg = el.querySelector("#nt-msg");
  const val = (id) => (el.querySelector(id)?.value || "").trim();
  const chkd = (id) => !!el.querySelector(id)?.checked;

  async function save() {
    msg.textContent = "Saving…";
    const cfg = {
      enabled: chkd("#nt-enabled"),
      twoWay: chkd("#nt-twoway"),
      telegramChat: val("#nt-chat"),
      minScore: parseFloat(val("#nt-minscore") || "0") || 0,
      evOpportunity: chkd("#nt-ev-opp"),
      evArticle: chkd("#nt-ev-article"),
      evReply: chkd("#nt-ev-reply"),
      evDigest: chkd("#nt-ev-digest"),
      evGeo: chkd("#nt-ev-geo"),
    };
    const tok = val("#nt-token"); if (tok) cfg.telegramToken = tok;
    const hook = val("#nt-slack"); if (hook) cfg.slackWebhook = hook;
    try {
      const r = await api.notifySet(cfg);
      if (r?.error) { msg.textContent = r.error; return; }
      toast("Notifications saved");
      ensureBotPoller();
      buildNotifyCard(el);
    } catch (e) { msg.textContent = "Failed: " + esc(e); }
  }
  el.querySelector("#nt-save").onclick = save;
  el.querySelector("#nt-test").onclick = async () => {
    msg.textContent = "Sending test… (save first if you just changed a token)";
    try {
      const r = await api.notifyTest();
      if (r?.error) { msg.textContent = r.error; return; }
      const okTg = r.telegram ? (r.telegram.ok ? "Telegram ✓" : "Telegram ✗ " + (r.telegram.msg || "")) : "";
      const okSk = r.slack ? (r.slack.ok ? "Slack ✓" : "Slack ✗ " + (r.slack.msg || "")) : "";
      msg.textContent = [okTg, okSk].filter(Boolean).join(" · ") || "No channel configured.";
    } catch (e) { msg.textContent = "Failed: " + esc(e); }
  };
}

async function buildPublishCard(el) {
  let connected = false;
  try { connected = !!(await api.publishStatus())?.x; } catch (e) { console.error(e); }
  const badge = connected
    ? `<span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">connected</span>`
    : `<span class="rounded bg-zinc-500/15 px-2 py-0.5 text-xs font-bold text-zinc-400">not connected</span>`;
  el.innerHTML = `
    <div class="flex items-center gap-2"><b class="text-zinc-900 dark:text-white">Publish to X / Twitter</b>${badge}</div>
    <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Post threads from Compose straight to X. Needs an X developer app set to <b>Read &amp; Write</b> — <a href="https://developer.x.com/en/portal/dashboard" target="_blank" class="text-reddit underline">create one ↗</a>. Stored locally only.</p>
    <div class="grid gap-2 sm:grid-cols-2">
      <input id="px-key" placeholder="API key" class="${inputCls}">
      <input id="px-secret" type="password" placeholder="API key secret" class="${inputCls}">
      <input id="px-token" placeholder="Access token" class="${inputCls}">
      <input id="px-tsecret" type="password" placeholder="Access token secret" class="${inputCls}">
    </div>
    <div class="mt-3 flex items-center gap-2"><button id="px-save" class="${btnP}">${connected ? "Update keys" : "Connect X"}</button><span id="px-msg" class="text-xs text-zinc-400"></span></div>`;
  el.querySelector("#px-save").onclick = async () => {
    const v = (id) => (el.querySelector(id)?.value || "").trim();
    const k = v("#px-key"), s = v("#px-secret"), t = v("#px-token"), ts = v("#px-tsecret");
    const msg = el.querySelector("#px-msg");
    if (!k || !s || !t || !ts) { msg.textContent = "All four keys are required."; return; }
    msg.textContent = "Saving…";
    try {
      const r = await api.publishSetXCreds(k, s, t, ts);
      if (r?.error) { msg.textContent = r.error; return; }
      toast("X publishing connected"); buildPublishCard(el);
    } catch (e) { msg.textContent = "Failed: " + e; }
  };
}

async function buildLlmCard(el) {
  let st = {};
  try { st = (await api.byokStatus()) || {}; } catch (e) { console.error(e); }
  const cur = (st.llm_provider || "anthropic").toLowerCase();
  const sel = LLM_PROVIDERS.some(p => p[0] === cur) ? cur : "anthropic";
  const opts = LLM_PROVIDERS.map(([v, l]) => `<option value="${v}"${v === sel ? " selected" : ""}>${l}</option>`).join("");
  el.innerHTML = `
    <b class="text-zinc-900 dark:text-white">AI provider (BYOK)</b>
    <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Runs on your own key — nothing is sent to us. Used for drafting replies &amp; content.</p>
    <label class="block mb-3 text-sm text-zinc-500">Provider<select id="st-prov" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2">${opts}</select></label>
    <label class="block mb-3 text-sm text-zinc-500" id="st-keywrap"></label>
    <label class="block mb-3 text-sm text-zinc-500">Model <span class="text-zinc-400">(optional)</span><input id="st-model" value="${esc(st.llm_model || "")}" placeholder="leave blank for provider default" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
    <div class="flex flex-wrap gap-2"><button id="st-save" class="${btnP}">Save</button><button id="st-test" class="${btn}">Test connection</button></div>
    <div id="st-llm-msg" class="mt-2 text-xs"></div>`;

  const provSel = el.querySelector("#st-prov");
  const keyWrap = el.querySelector("#st-keywrap");
  let keyEdited = false;
  const paintKey = () => {
    const p = provSel.value;
    const isOllama = p === "ollama";
    const stEntry = st[p];
    const setOrUrl = isOllama
      ? (typeof stEntry === "string" ? stEntry : "")
      : (stEntry && stEntry.set ? stEntry.preview : "");
    const ph = LLM_PROVIDERS.find(x => x[0] === p)?.[3] || "";
    keyEdited = false;
    keyWrap.innerHTML = `${isOllama ? "Base URL" : "API key"}${(!isOllama && stEntry?.set) ? ' <span class="text-emerald-500">· saved</span>' : ""}
      <input id="st-key" type="${isOllama ? "text" : "password"}" value="${esc(setOrUrl)}" placeholder="${esc(ph)}" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2">`;
    keyWrap.querySelector("#st-key").addEventListener("input", () => { keyEdited = true; });
  };
  paintKey();
  provSel.onchange = paintKey;

  const msg = el.querySelector("#st-llm-msg");
  el.querySelector("#st-save").onclick = async () => {
    const p = provSel.value;
    const envKey = LLM_PROVIDERS.find(x => x[0] === p)?.[2];
    const keyVal = (el.querySelector("#st-key")?.value || "").trim();
    const model = (el.querySelector("#st-model")?.value || "").trim();
    msg.innerHTML = `<span class="text-zinc-500">Saving…</span>`;
    try {
      if (p === "ollama") {
        await api.byokSet("OLLAMA_BASE_URL", keyVal || "http://localhost:11434");
      } else if (keyEdited && keyVal && !keyVal.includes("…")) {
        await api.byokSet(envKey, keyVal);
      }
      await api.byokSet("LLM_PROVIDER", p);
      await api.byokSet("LLM_MODEL", model);
      st = (await api.byokStatus()) || st;
      paintKey();
      msg.innerHTML = `<span class="text-emerald-500">Saved ✓</span>`;
      toast("Provider saved");
    } catch (e) { msg.innerHTML = `<span class="text-rose-500">${esc(e)}</span>`; }
  };
  el.querySelector("#st-test").onclick = async (e) => {
    const p = provSel.value;
    const model = (el.querySelector("#st-model")?.value || "").trim();
    e.target.disabled = true; msg.innerHTML = `<span class="text-zinc-500">Testing ${esc(p)}…</span>`;
    try {
      const r = (await api.testLlm(p, model)) || {};
      msg.innerHTML = r.ok
        ? `<span class="text-emerald-500">✓ ${esc(r.provider || p)} · ${esc(r.model || "")} · ${esc(String(r.latency_ms || "?"))}ms</span>`
        : `<span class="text-rose-500">✗ ${esc(r.error || "failed")}</span>`;
    } catch (err) { msg.innerHTML = `<span class="text-rose-500">${esc(err)}</span>`; }
    e.target.disabled = false;
  };
}

function buildAppearanceCard(el) {
  const theme = localStorage.getItem("or-theme") || "dark";
  const o = (val, cur, label) => `<option value="${val}"${val === cur ? " selected" : ""}>${label}</option>`;
  el.innerHTML = `
    <b class="text-zinc-900 dark:text-white">Appearance</b>
    <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Theme also has a quick toggle in the sidebar.</p>
    <label class="block mb-3 text-sm text-zinc-500">Default theme<select id="st-theme" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2">
      ${o("system", theme, "Match system")}${o("dark", theme, "Dark")}${o("light", theme, "Light")}</select></label>
    <span id="st-appear-msg" class="text-xs text-zinc-400"></span>`;
  const apply = () => {
    const t = el.querySelector("#st-theme").value;
    localStorage.setItem("or-theme", t);
    const dark = t === "dark" || (t === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    el.querySelector("#st-appear-msg").textContent = "Saved ✓";
    if (window.refreshIcons) window.refreshIcons();
  };
  el.querySelector("#st-theme").onchange = apply;
}

// Automation — REAL launchd auto collect+learn (replaces the old localStorage-only
// "cadence" that did nothing). Off / Daily (24h) / Weekly (168h).
async function buildAutomationCard(el) {
  el.innerHTML = `<b class="text-zinc-900 dark:text-white">Automation</b>
    <p class="mb-2 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Keep this agent working on a schedule, even when the app is closed (macOS). Each run:</p>
    <ul class="mb-3 ml-4 list-disc space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
      <li>scans for <b>new opportunities</b> (on this cadence)</li>
      <li><b>learns</b> from the fetched posts</li>
      <li><b>posts due</b> queued replies — or reminds you</li>
      <li>refreshes <b>AI-visibility</b> citation checks (~daily)</li></ul>
    <label class="block mb-2 text-sm text-zinc-500">Auto cadence
      <select id="st-sched" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2">
        <option value="0">Off (manual only)</option><option value="24">Daily</option><option value="168">Weekly</option></select></label>
    <span id="st-sched-msg" class="text-xs text-zinc-400">Checking…</span>
    <div id="st-sched-last" class="mt-1 text-xs text-zinc-400"></div>`;
  const selEl = el.querySelector("#st-sched"), msg = el.querySelector("#st-sched-msg"),
        lastEl = el.querySelector("#st-sched-last");
  const ago = (ts) => { if (!ts) return "never"; const s = Math.floor(Date.now() / 1000) - ts; return s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
  async function showLast() {
    try { const a = await api.agentGet(); if (a && lastEl) lastEl.textContent = `Last auto-scan: ${ago(a.last_refresh_at)}`; } catch (e) { console.error(e); }
  }
  try {
    const s = (await api.scheduleStatus()) || {};
    if (s.installed && s.interval_hours) selEl.value = String(s.interval_hours >= 168 ? 168 : 24);
    msg.textContent = s.installed ? `On · every ${s.interval_hours || 24}h${s.loaded === false ? " (reselect to reload)" : ""}` : "Off";
  } catch (e) { msg.textContent = "Scheduling unavailable on this platform."; selEl.disabled = true; }
  showLast();
  selEl.onchange = async () => {
    const h = parseInt(selEl.value, 10);
    const cad = h >= 168 ? "weekly" : h > 0 ? "daily" : "off";
    msg.textContent = "Applying…"; selEl.disabled = true;
    try {
      const r = h > 0 ? await api.scheduleInstall(h) : await api.scheduleUninstall();
      try { await api.agentUpdate({ cadence: cad }); } catch (e) { console.error(e); }  // drives reply.find_if_due
      if (r && r.error) { msg.textContent = "Failed: " + r.error; }
      else msg.textContent = h > 0 ? `On · every ${h}h ✓ — auto-scan ${cad}` : "Off ✓";
    } catch (e) { msg.textContent = "Failed: " + e; }
    selEl.disabled = false; showLast();
  };
}

// Connect to apps (MCP) — register the app's MCP server with Claude Code / Cursor / etc.
async function buildMcpCard(el) {
  el.innerHTML = `<b class="text-zinc-900 dark:text-white">Connect to apps (MCP)</b>
    <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Use this agent's data + tools from Claude Code, Claude Desktop, Cursor or Windsurf — they read/write this app's database.</p>
    <div class="flex flex-wrap items-end gap-2">
      <label class="text-sm text-zinc-500">Client<select id="st-mcp-client" class="mt-1 block w-48 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><option>Loading…</option></select></label>
      <span id="st-mcp-badge" class="rounded bg-zinc-500/15 px-2 py-0.5 text-xs font-bold text-zinc-400">…</span></div>
    <div class="mt-3 flex flex-wrap gap-2" id="st-mcp-actions"></div>
    <div id="st-mcp-msg" class="mt-2 text-xs text-zinc-400"></div>`;
  const sel = el.querySelector("#st-mcp-client"), badge = el.querySelector("#st-mcp-badge"),
        actions = el.querySelector("#st-mcp-actions"), msg = el.querySelector("#st-mcp-msg");
  let clients = [];
  try { clients = (await api.mcpClients())?.clients || []; } catch (e) { el.querySelector("b").insertAdjacentHTML("afterend", `<p class="text-sm text-rose-500 mt-1">MCP unavailable: ${esc(e)}</p>`); return; }
  if (!clients.length) clients = ["claude-code", "claude-desktop", "cursor", "windsurf"].map(id => ({ id, label: id }));
  sel.innerHTML = clients.map(c => `<option value="${esc(c.id || c)}">${esc(c.label || c.id || c)}</option>`).join("");

  async function refresh() {
    badge.textContent = "checking…"; badge.className = "rounded bg-zinc-500/15 px-2 py-0.5 text-xs font-bold text-zinc-400";
    actions.innerHTML = "";
    let st = {};
    try { st = (await api.mcpStatus(sel.value)) || {}; } catch (e) { msg.textContent = String(e); return; }
    const connected = !!st.connected, aligned = st.db_aligned !== false;
    badge.textContent = connected ? (aligned ? "connected" : "connected · DB mismatch") : "not connected";
    badge.className = `rounded px-2 py-0.5 text-xs font-bold ${connected && aligned ? "bg-emerald-500/15 text-emerald-500" : connected ? "bg-amber-500/15 text-amber-500" : "bg-zinc-500/15 text-zinc-400"}`;
    const bd = "rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold";
    actions.innerHTML = (connected
      ? `<button data-mcp="resync" class="${bd}">Re-sync paths</button><button data-mcp="disconnect" class="${bd} text-rose-500">Disconnect</button>`
      : `<button data-mcp="connect" class="rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white">Connect</button>`)
      + `<button data-mcp="copy" class="${bd}">Copy config</button>`;
    if (st.reason && !connected) msg.textContent = st.reason; else if (!connected) msg.textContent = "";
    actions.querySelectorAll("[data-mcp]").forEach(b => b.onclick = () => mcpAction(b.getAttribute("data-mcp")));
  }
  async function mcpAction(act) {
    msg.textContent = act === "copy" ? "Copying…" : "Working… (restart the client after)";
    try {
      if (act === "connect" || act === "resync") { const r = await api.mcpInstall(sel.value); msg.textContent = r?.error ? ("Failed: " + r.error) : "Done — restart " + sel.value; }
      else if (act === "disconnect") { await api.mcpUninstall(sel.value); msg.textContent = "Disconnected — restart " + sel.value; }
      else if (act === "copy") { const snip = await api.mcpConfigSnippet(sel.value); const txt = typeof snip === "string" ? snip : JSON.stringify(snip?.snippet || snip, null, 2); await navigator.clipboard.writeText(txt); msg.textContent = "Config copied"; }
      if (act !== "copy") refresh();
    } catch (e) { msg.textContent = "Failed: " + e; }
  }
  sel.onchange = refresh;
  refresh();
}

// Usage & limits — daily token cap + today's spend (cost guardrail).
async function buildUsageCard(el) {
  let prefs = {}, spend = {};
  try { prefs = (await api.extractionPrefsGet(null)) || {}; } catch (e) { console.error(e); }
  try { spend = (await api.todayTokenSpend()) || {}; } catch (e) { console.error(e); }
  const cap = Number(prefs.daily_token_cap || prefs.global?.daily_token_cap || 0) || 0;
  const used = Number(spend.tokens || spend.today_tokens || 0) || 0;
  const cost = spend.cost_usd != null ? `$${Number(spend.cost_usd).toFixed(3)}` : "";
  el.innerHTML = `<b class="text-zinc-900 dark:text-white">Usage &amp; limits</b>
    <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Today’s LLM token spend and an optional daily cap (0 = no cap). Runs on your own key.</p>
    <div class="mb-3 flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm">
      <span class="text-zinc-500">Today</span><b class="text-zinc-900 dark:text-white">${used.toLocaleString()} tokens${cost ? " · " + cost : ""}</b></div>
    <label class="block mb-2 text-sm text-zinc-500">Daily token cap
      <input id="st-cap" type="number" min="0" value="${cap}" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
    <div class="flex gap-2"><button id="st-cap-save" class="${btnP}">Save cap</button></div>
    <span id="st-cap-msg" class="mt-2 inline-block text-xs text-zinc-400"></span>`;
  el.querySelector("#st-cap-save").onclick = async () => {
    const v = parseInt(el.querySelector("#st-cap").value, 10) || 0;
    const m = el.querySelector("#st-cap-msg"); m.textContent = "Saving…";
    try { const r = await api.extractionPrefsSet("global", { daily_token_cap: v }); m.textContent = r?.error ? ("Failed: " + r.error) : "Saved ✓"; }
    catch (e) { m.textContent = "Failed: " + e; }
  };
}

// Avatar helpers (ported from multi-source) — deterministic initials + colour.
function avatarInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
function avatarColor(name) {
  const palette = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#06b6d4"];
  let h = 0; for (const c of String(name || "x")) h = (h * 31 + c.charCodeAt(0)) | 0;
  return palette[Math.abs(h) % palette.length];
}

// Profile — name + avatar (closes the onboarding "or-user-name collected but unused"
// gap). Stored locally.
async function buildProfileCard(el) {
  const name = localStorage.getItem("or-user-name") || "";
  const paint = (n) => {
    const av = el.querySelector("#st-av");
    if (av) { av.textContent = avatarInitials(n || "You"); av.style.background = avatarColor(n || "You"); }
  };
  el.innerHTML = `<b class="text-zinc-900 dark:text-white">Profile</b>
    <div class="mt-3 flex items-center gap-3">
      <span id="st-av" class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-extrabold text-white" style="background:${avatarColor(name || "You")}">${esc(avatarInitials(name || "You"))}</span>
      <div class="min-w-0 flex-1">
        <input id="st-name" value="${esc(name)}" placeholder="Your name" class="block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm">
        ${email ? `<p class="mt-1 truncate text-xs text-zinc-400">${esc(email)}</p>` : ""}</div></div>
    <div class="mt-3 flex gap-2"><button id="st-name-save" class="${btnP}">Save</button><span id="st-name-msg" class="self-center text-xs text-zinc-400"></span></div>`;
  const input = el.querySelector("#st-name");
  input.oninput = () => paint(input.value);
  el.querySelector("#st-name-save").onclick = () => {
    const v = input.value.trim();
    try { localStorage.setItem("or-user-name", v); } catch (e) { console.error(e); }
    el.querySelector("#st-name-msg").textContent = "Saved ✓";
    // Reflect in the sidebar footer immediately if present.
    const f = document.querySelector("#side [data-user-name]"); if (f) f.textContent = v || "You";
  };
}

// Semantic memory (palace) — the embedding engine behind the learning loop's graph.
async function buildSemanticCard(el) {
  el.innerHTML = `<b class="text-zinc-900 dark:text-white">Semantic memory</b>
    <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">On-device embeddings link the agent’s lessons into a knowledge graph (powers Learning + reply blending).</p>
    <div id="st-pal-body" class="text-sm text-zinc-500">Checking…</div>
    <div class="mt-3 flex gap-2"><button id="st-pal-reindex" class="${btn}">Re-index</button><span id="st-pal-msg" class="self-center text-xs text-zinc-400"></span></div>`;
  const body = el.querySelector("#st-pal-body");
  try {
    const [ms, stx] = await Promise.all([api.palaceModelStatus().catch(() => ({})), api.palaceStats().catch(() => ({}))]);
    const ready = ms.ready || ms.installed;
    const n = stx.vectors || stx.count || stx.n || 0;
    body.innerHTML = `<span class="rounded ${ready ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"} px-2 py-0.5 text-xs font-bold">${ready ? "ready" : "model not downloaded"}</span>
      <span class="ml-2 text-zinc-500">${Number(n).toLocaleString()} embedded memories</span>`;
  } catch (e) { body.textContent = "Semantic memory unavailable."; }
  el.querySelector("#st-pal-reindex").onclick = async (ev) => {
    const m = el.querySelector("#st-pal-msg"); ev.currentTarget.disabled = true; m.textContent = "Re-indexing…";
    try { const r = await api.palaceReindex(); m.textContent = r?.error ? ("Failed: " + r.error) : "Re-indexed ✓"; }
    catch (e) { m.textContent = "Failed: " + e; }
    ev.currentTarget.disabled = false;
  };
}

// Power tools — install the `openreply` CLI + choose the export folder.
async function buildPowerCard(el) {
  let cli = {}, exp = {};
  try { cli = (await api.cliSymlinkStatus()) || {}; } catch (e) { console.error(e); }
  try { exp = (await api.exportPrefsGet()) || {}; } catch (e) { console.error(e); }
  const installed = cli.installed || cli.linked;
  const dir = exp.export_dir || exp.dir || "";
  el.innerHTML = `<b class="text-zinc-900 dark:text-white">Power tools</b>
    <div class="mt-3 flex items-center justify-between gap-3 text-sm">
      <div><div class="text-zinc-900 dark:text-white font-semibold">Terminal CLI</div><div class="text-xs text-zinc-400">Use <code>openreply</code> from any terminal.</div></div>
      <button id="st-cli" class="${btn}">${installed ? "Reinstall" : "Install CLI"}</button></div>
    <div class="mt-3 flex items-center justify-between gap-3 text-sm">
      <div class="min-w-0"><div class="text-zinc-900 dark:text-white font-semibold">Export folder</div><div class="truncate text-xs text-zinc-400">${esc(dir || "default (app data)")}</div></div>
      <button id="st-exp-reveal" class="${btn}">Reveal</button></div>
    <span id="st-pw-msg" class="mt-2 inline-block text-xs text-zinc-400"></span>`;
  const m = el.querySelector("#st-pw-msg");
  el.querySelector("#st-cli").onclick = async () => {
    m.textContent = "Installing…";
    try { const r = await api.installCli(); m.textContent = r?.error ? ("Failed: " + r.error) : (r?.path ? "Installed → " + r.path : "Installed ✓"); }
    catch (e) { m.textContent = "Failed: " + e; }
  };
  el.querySelector("#st-exp-reveal").onclick = async () => {
    try { await api.revealInFinder(dir || ""); } catch (e) { m.textContent = "Couldn’t open folder"; }
  };
}

// About & support — version, feedback email, GitHub issues, open data/logs folder.
async function buildAboutCard(el) {
  let ver = "";
  try { const i = await api.checkAppVersion(); ver = i?.version || i?.current || ""; } catch (e) { console.error(e); }
  if (!ver) { try { const i = await api.cliInfo(); ver = i?.version || ""; } catch (e) { console.error(e); } }
  let dir = ""; try { dir = (await api.appDataDir())?.path || (await api.appDataDir()) || ""; } catch (e) { console.error(e); }
  el.innerHTML = `<b class="text-zinc-900 dark:text-white">About &amp; support</b>
    <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">OpenReply${ver ? ` · v${esc(ver)}` : ""}</p>
    <div class="flex flex-wrap gap-2">
      <button id="st-fb-email" class="${btn}"><i data-lucide="mail" class="inline-block h-3.5 w-3.5 align-[-2px]"></i> Email feedback</button>
      <button id="st-fb-gh" class="${btn}"><i data-lucide="github" class="inline-block h-3.5 w-3.5 align-[-2px]"></i> Report an issue</button>
      <button id="st-fb-logs" class="${btn}"><i data-lucide="folder" class="inline-block h-3.5 w-3.5 align-[-2px]"></i> Open data folder</button></div>`;
  el.querySelector("#st-fb-email").onclick = () => api.openUrl(`mailto:sbombatkar@leaptodigital.com?subject=${encodeURIComponent("OpenReply feedback" + (ver ? " v" + ver : ""))}`).catch(() => toast("Couldn’t open mail"));
  el.querySelector("#st-fb-gh").onclick = () => api.openUrl("https://github.com/myind-ai/openreply/issues").catch(() => {});
  el.querySelector("#st-fb-logs").onclick = () => api.revealInFinder(String(dir || "")).catch(() => toast("Couldn’t open folder"));
}

async function buildFeedsCard(el) {
  async function load() {
    let feeds = [];
    try { feeds = (await api.feedsList())?.feeds || []; } catch (e) { console.error(e); }
    el.innerHTML = `
      <b class="text-zinc-900 dark:text-white">Custom RSS feeds</b>
      <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Extra sources swept on every knowledge refresh.</p>
      <div class="space-y-2 text-sm">${feeds.length ? feeds.map(f => `
        <div class="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2">
          <div class="min-w-0"><div class="truncate font-semibold text-zinc-900 dark:text-white">${esc(f.name || f.url)}</div>
            <div class="truncate text-xs text-zinc-400">${esc(f.url)}</div></div>
          <button data-rm="${esc(f.url)}" class="shrink-0 text-zinc-400 hover:text-rose-500"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>`).join("") : `<div class="text-zinc-500">No custom feeds yet.</div>`}</div>
      <div class="mt-3 flex flex-wrap items-end gap-2">
        <input id="st-feed-url" placeholder="https://example.com/feed.xml" class="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm">
        <button id="st-feed-add" class="${btnP}">+ Add</button></div>
      <div id="st-feed-msg" class="mt-2 text-xs"></div>`;
    el.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => {
      try { await api.feedsRemove(b.getAttribute("data-rm")); toast("Feed removed"); load(); } catch (e) { toast("Failed: " + e); }
    });
    el.querySelector("#st-feed-add").onclick = async () => {
      const url = (el.querySelector("#st-feed-url").value || "").trim();
      const m = el.querySelector("#st-feed-msg");
      if (!url) { m.innerHTML = `<span class="text-rose-500">Enter a URL.</span>`; return; }
      m.innerHTML = `<span class="text-zinc-500">Validating &amp; adding…</span>`;
      try {
        const r = await api.feedsAdd(url, "");
        if (r && r.ok === false) { m.innerHTML = `<span class="text-rose-500">${esc(r.error || "Not a valid feed.")}</span>`; return; }
        toast("Feed added"); load();
      } catch (e) { m.innerHTML = `<span class="text-rose-500">${esc(e)}</span>`; }
    };
    icons();
  }
  load();
}

async function buildDataCard(el) {
  let info = {};
  try { info = (await api.appResetPreview()) || {}; } catch (e) { console.error(e); }
  el.innerHTML = `
    <b class="text-zinc-900 dark:text-white">Data &amp; account</b>
    <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Everything is stored locally${info.data_mb != null ? ` · ~${esc(String(info.data_mb))} MB` : ""}${info.topic_count != null ? ` · ${esc(String(info.topic_count))} topics` : ""}.</p>
    <div class="mb-3 truncate rounded-lg bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs text-zinc-500">${esc(info.data_dir || "—")}</div>
    <div class="flex flex-wrap gap-2">
      <button id="st-reveal" class="${btn}">Reveal in Finder</button>
      <button id="st-reset" class="rounded-full border border-rose-500 px-4 py-2 text-sm font-semibold text-rose-500 hover:bg-rose-500/10">Reset all data…</button></div>
    <div id="st-data-msg" class="mt-2 text-xs"></div>`;
  el.querySelector("#st-reveal").onclick = async () => {
    try { await api.revealInFinder(info.data_dir); } catch (e) { toast("Could not open: " + e); }
  };
  el.querySelector("#st-reset").onclick = () => {
    window.orModal({
      title: "Reset all data?",
      body: `<p class="text-sm text-zinc-500 dark:text-zinc-400">This permanently deletes all local data (agents, posts, drafts) and your saved API keys. This cannot be undone.</p>
        <p class="mt-2 text-sm text-zinc-500">Type <b>DELETE</b> to confirm:</p>
        <input id="st-reset-confirm" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2" placeholder="DELETE">`,
      okText: "Reset everything",
      onOk: async (ov) => {
        if ((ov.querySelector("#st-reset-confirm")?.value || "").trim() !== "DELETE") { toast("Type DELETE to confirm"); return; }
        try {
          await api.appHardReset();
          try { localStorage.clear(); } catch (e) { console.error(e); }
          toast("Data wiped — relaunching…");
          await api.appRelaunch();
        } catch (e) { toast("Reset failed: " + e); }
      },
    });
  };
}

// ── Knowledge ─────────────────────────────────────────────────────────────
export async function renderKnowledge(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = `<div id="kn">Loading…</div>`;
  let a = null, k = null;
  try { a = await api.agentGet(); } catch (e) { console.error(e); }
  if (!a) { document.getElementById("kn").innerHTML = `<div class="${card}">No active agent. <a class="text-reddit underline" href="#/agents">Create one →</a></div>`; return; }
  try { k = await api.agentKnowledge(); } catch (e) { console.error(e); }
  const kpi = (l, v) => `<div class="${card}"><div class="text-sm text-zinc-500">${l}</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">${v}</div></div>`;
  document.getElementById("kn").outerHTML =
    head("Knowledge", `What <b>${esc(a.name)}</b> knows about its niche — refreshed on demand.`,
      `<button id="kn-refresh" class="${btn}">↻ Refresh now</button>`) +
    `<div class="grid grid-cols-2 gap-4 lg:grid-cols-3">
       ${kpi("Posts collected", (k && k.posts) || 0)}
       ${kpi("Map nodes", (k && k.graph_nodes) || 0)}
       ${kpi("Angles / findings", (k && k.findings) || 0)}</div>
     <div class="mt-5 ${card}"><b class="text-zinc-900 dark:text-white">Sources watched</b>
       <div class="mt-2 flex flex-wrap gap-1.5">${(a.platforms || []).map(p => `<span class="${chip}">${esc(p)}</span>`).join("")}</div>
       <p class="mt-3 text-sm text-zinc-500">Last refresh: ${k && k.last_refresh_at ? new Date(k.last_refresh_at * 1000).toLocaleString() : "never"}</p></div>
     <div class="mt-5 ${card}">
       <b class="text-zinc-900 dark:text-white"><i data-lucide="youtube" class="inline-block h-4 w-4 align-[-3px] text-red-500"></i> Teach from a video</b>
       <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Paste a YouTube link — the agent pulls the subtitles/transcript and learns from it. Lessons blend into its replies &amp; content.</p>
       <div class="flex flex-wrap items-end gap-3">
         <input id="kn-vid" placeholder="https://www.youtube.com/watch?v=\u2026" class="${inputCls} min-w-0 flex-1">
         <button id="kn-teach" class="${btnP}"><i data-lucide="graduation-cap" class="inline-block h-4 w-4 align-[-2px]"></i> Learn from video</button></div>
       <div id="kn-teach-msg" class="mt-3 text-sm"></div></div>
     <div class="mt-5 ${card}">
       <div class="flex items-center justify-between gap-3">
         <b class="text-zinc-900 dark:text-white"><i data-lucide="brain" class="inline-block h-4 w-4 align-[-3px] text-reddit"></i> Brain &amp; knowledge graph</b>
         <button id="kn-build" class="${btn}"><i data-lucide="workflow" class="inline-block h-4 w-4 align-[-2px]"></i> Build brain (deep)</button></div>
       <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">The agent's content mapped into a graph \u2014 posts, people, sources and the niche's painpoints/wishes/workarounds, connected by meaning (embeddings).</p>
       <div id="kn-graph" class="text-sm text-zinc-500">Loading graph\u2026</div>
       <div id="kn-build-msg" class="mt-2 text-xs"></div></div>`;
  document.getElementById("kn-refresh").onclick = async (e) => {
    e.target.textContent = "Refreshing…"; e.target.disabled = true;
    try { await api.agentRefresh(null, false); toast("Knowledge refreshed"); renderKnowledge(view); }
    catch (err) { toast("Refresh failed"); e.target.disabled = false; e.target.textContent = "↻ Refresh now"; }
  };
  const teachBtn = document.getElementById("kn-teach");
  if (teachBtn) teachBtn.onclick = async () => {
    const inp = document.getElementById("kn-vid");
    const msg = document.getElementById("kn-teach-msg");
    const url = (inp.value || "").trim();
    if (!url) { msg.innerHTML = `<span class="text-amber-500">Paste a video URL first.</span>`; return; }
    const html = teachBtn.innerHTML; teachBtn.disabled = true; teachBtn.textContent = "Learning\u2026";
    msg.innerHTML = `<span class="text-zinc-500">Fetching the video\u2019s subtitles &amp; learning \u2014 this can take a minute\u2026</span>`;
    try {
      const r = await api.agentTeachVideo(url);
      if (r === null) { msg.innerHTML = `<span class="text-amber-500">Run inside the app to teach.</span>`; }
      else if (r.error) { msg.innerHTML = `<span class="text-rose-500">${esc(r.error)}</span>`; }
      else {
        const f = r.fetched || {};
        msg.innerHTML = `<span class="text-emerald-500">\u2713 ${esc(r.message || "Learned.")}</span><span class="text-zinc-400"> \u00b7 ${f.transcript || 0} transcript chunks \u00b7 ${r.learned || 0} lessons \u00b7 ${r.beliefs || 0} beliefs</span>`;
        inp.value = "";
        toast(`Learned ${r.learned || 0} lesson(s) from the video`);
      }
    } catch (e) { msg.innerHTML = `<span class="text-rose-500">${esc(e)}</span>`; }
    finally { teachBtn.disabled = false; teachBtn.innerHTML = html; icons(); }
  };
  const graphBox = document.getElementById("kn-graph");
  async function loadGraph() {
    if (!graphBox) return;
    try {
      const g = await api.agentGraph();
      if (!g || g.error) { graphBox.innerHTML = `<span class="text-zinc-400">${esc((g && g.error) || "No graph yet \u2014 click Build brain.")}</span>`; return; }
      if (!g.total_nodes) { graphBox.innerHTML = `<span class="text-zinc-400">Empty graph \u2014 collect/learn, then Build brain.</span>`; return; }
      const kinds = (g.by_kind || []).map((x) => `<span class="${chip}">${esc(x.kind)} \u00b7 ${x.count}</span>`).join(" ");
      const hubs = (g.hubs || []).slice(0, 8).map((h) => `<span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs">${esc(h.label)} <span class="text-zinc-400">\u00b7${h.degree}</span></span>`).join(" ");
      const conns = (g.connections || []).slice(0, 8).map((c) => `<div class="flex flex-wrap items-center gap-1.5 text-xs"><span class="text-zinc-700 dark:text-zinc-300">${esc(c.from)}</span><span class="text-reddit">\u2192 ${esc(c.kind)} \u2192</span><span class="text-zinc-700 dark:text-zinc-300">${esc(c.to)}</span><span class="text-zinc-400">${c.weight}</span></div>`).join("");
      graphBox.innerHTML = `<div class="mb-2 text-zinc-500">${g.total_nodes} nodes \u00b7 ${g.total_edges} connections</div>
        <div class="mb-3 flex flex-wrap gap-1.5">${kinds}</div>
        ${hubs ? `<div class="mb-1 font-semibold text-zinc-700 dark:text-zinc-300">Top hubs</div><div class="mb-3 flex flex-wrap gap-1.5">${hubs}</div>` : ""}
        ${conns ? `<div class="mb-1 font-semibold text-zinc-700 dark:text-zinc-300">Connections</div><div class="space-y-1">${conns}</div>` : ""}`;
      icons();
    } catch (e) { graphBox.innerHTML = `<span class="text-rose-500">${esc(e)}</span>`; }
  }
  const buildBtn = document.getElementById("kn-build");
  if (buildBtn) buildBtn.onclick = async () => {
    const msg = document.getElementById("kn-build-msg");
    const html = buildBtn.innerHTML; buildBtn.disabled = true; buildBtn.textContent = "Building brain\u2026";
    msg.innerHTML = `<span class="text-zinc-500">Mapping content + mining insights (LLM) \u2014 this can take a minute\u2026</span>`;
    try {
      const r = await api.agentBuildGraph(true);
      if (r === null) { msg.innerHTML = `<span class="text-amber-500">Run inside the app to build.</span>`; }
      else if (r.error) { msg.innerHTML = `<span class="text-rose-500">${esc(r.error)}</span>`; }
      else { msg.innerHTML = `<span class="text-emerald-500">\u2713 ${esc(r.message || "Brain built.")}</span>`; toast("Brain built"); loadGraph(); }
    } catch (e) { msg.innerHTML = `<span class="text-rose-500">${esc(e)}</span>`; }
    finally { buildBtn.disabled = false; buildBtn.innerHTML = html; icons(); }
  };
  loadGraph();
  icons();
}

// ── Inbox (reply workspace) ─────────────────────────────────────────────────
// Tabs map to lifecycle stages: Saved → Drafting → Ready (+ queued) → Posted.
// Drafts load lazily (one CLI spawn per opened card, not per visible card).
const INBOX_TABS = [["saved", "Saved"], ["drafted", "Drafting"], ["ready", "Ready"], ["posted", "Posted"]];
const INBOX_EMPTY = {
  saved: "Nothing saved yet. Save opportunities from Discovery to start replying.",
  drafted: "No drafts in progress. Open a saved item and generate a reply.",
  ready: "Nothing approved yet. Approve a draft to move it here.",
  posted: "No replies posted yet.",
};

export async function renderInbox(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  let a = null; try { a = await api.agentGet(); } catch (e) { console.error(e); }
  const S = { tab: "saved", query: "", sort: "recent", offset: 0, items: [], total: 0 };
  const bP = "rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white hover:bg-reddit-hi";
  const bO = "rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold";

  view.innerHTML = head("Inbox", `Your reply workspace for <b>${esc(a?.name || "—")}</b> — draft, approve, and post.`,
    `<a href="#/opportunities" class="${btnP}">⚡ Find more</a>`) +
    `<div id="ib-tabs" class="mb-3 flex flex-wrap gap-2">${INBOX_TABS.map(([v, l]) =>
      `<button data-tab="${v}" class="${_chip(v === "saved")}">${l}</button>`).join("")}</div>
     <div class="mb-3 flex flex-wrap items-center gap-2">
       <input id="ib-q" placeholder="Search title, author, sub…" class="${inputCls} w-60">
       <select id="ib-sort" class="${inputCls}">${REPLY_SORTS.map(([v, l]) =>
         `<option value="${v}"${v === "recent" ? " selected" : ""}>${l}</option>`).join("")}</select>
       <span id="ib-status" class="ml-auto text-xs text-zinc-400"></span></div>
     <div id="ib-list" class="space-y-3"></div>
     <div id="ib-more" class="mt-4 hidden text-center"><button class="${btn}">Load more</button></div>`;

  const list = view.querySelector("#ib-list");
  const statusEl = view.querySelector("#ib-status");
  const moreWrap = view.querySelector("#ib-more");

  function cardHTML(o) {
    const s = Math.round((o.score || 0) * 100);
    const dueNow = o.status === "queued" && o.scheduled_at && (o.scheduled_at * 1000) <= Date.now();
    const sched = o.status !== "queued" ? ""
      : dueNow
        ? `<span class="rounded bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-500">⏰ Due now</span>`
        : o.scheduled_at ? `<span class="text-xs text-indigo-400">· scheduled</span>` : "";
    return `<div class="${card}" data-card="${esc(o.id)}">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0"><div class="flex flex-wrap items-center gap-2">
            <span class="rounded ${platformBadge(o.platform)} px-2 py-0.5 text-xs font-bold">${esc(o.platform || "")}</span>
            ${subLabel(o)}${statusPill(o.status || "saved")}${postWhen(o)}${sched}</div>
          <div class="mt-1 font-semibold text-zinc-900 dark:text-white">${esc(o.title || "(no title)")}</div>
          ${o.reason ? `<div class="text-sm text-zinc-500 dark:text-zinc-400">${esc(o.reason)}</div>` : ""}</div>
        <span class="shrink-0 text-xl font-extrabold ${scoreCls(o.score || 0)}">${s}</span></div>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        ${o.url ? `<a href="${esc(o.url)}" target="_blank" class="rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">Open thread ↗</a>` : ""}
        <button data-open="${esc(o.id)}" class="${bP}">${o.status === "saved" ? "✍ Draft reply" : "✏️ Open draft"}</button>
        ${o.status !== "posted" ? `<button data-skip="${esc(o.id)}" class="${bO} text-rose-500">✕ Skip</button>` : ""}
      </div>
      <div data-draft="${esc(o.id)}" class="mt-3 hidden"></div></div>`;
  }

  function actionsHTML(o) {
    const st = o.status || "saved";
    let out = `<button data-do="save" class="${bP}">💾 Save</button>`;
    out += `<button data-do="regen" class="${bO}">↻ Re-generate</button>`;
    out += `<button data-do="copy" class="${bO}">📋 Copy</button>`;
    if (st === "saved" || st === "drafted") out += `<button data-do="approve" class="${bO} text-violet-500">✓ Approve</button>`;
    if (st === "ready" || st === "queued") {
      out += `<button data-do="queue" class="${bO} text-indigo-500">📅 Queue</button>`;
      out += `<button data-do="posted" class="${bO} text-emerald-500">✓ Mark posted</button>`;
    }
    return out;
  }

  function renderEditor(box, id, o, drafts) {
    const cur = drafts[0] || { text: "", compliant: 1 };
    const comp = cur.compliant ? "" :
      `<div class="mb-2 inline-block rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">⚠ ${esc(cur.compliance_notes || "check platform rules")}</div>`;
    const versions = drafts.length > 1
      ? `<details class="mt-2 text-xs text-zinc-400"><summary class="cursor-pointer">${drafts.length} versions</summary>
          <div class="mt-1 space-y-1">${drafts.map(d =>
            `<button data-ver="${esc(d.id)}" class="block w-full truncate rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800">v${d.version || "?"} · ${esc(d.source || "")} · ${esc((d.text || "").slice(0, 70))}</button>`).join("")}</div></details>`
      : "";
    box.innerHTML = `${comp}
      <textarea data-edit="${esc(id)}" rows="6" class="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm">${esc(cur.text || "")}</textarea>
      <div class="mt-2 flex flex-wrap items-center gap-2">${actionsHTML(o)}</div>
      <div data-msg="${esc(id)}" class="mt-1 text-xs text-zinc-400"></div>${versions}`;
    wireEditor(box, id, o, drafts);
  }

  function wireEditor(box, id, o, drafts) {
    const ta = box.querySelector(`[data-edit="${CSS.escape(id)}"]`);
    const msg = box.querySelector(`[data-msg="${CSS.escape(id)}"]`);
    const setMsg = (t, cls = "text-zinc-400") => { if (msg) msg.innerHTML = `<span class="${cls}">${esc(t)}</span>`; };
    box.querySelectorAll("[data-ver]").forEach(b => b.onclick = () => {
      const d = drafts.find(x => x.id === b.getAttribute("data-ver"));
      if (d) { ta.value = d.text || ""; setMsg("Loaded v" + (d.version || "?") + " — Save to keep it as the latest."); }
    });
    box.querySelectorAll("[data-do]").forEach(b => b.onclick = async () => {
      const act = b.getAttribute("data-do");
      if (act === "copy") { try { await navigator.clipboard.writeText(ta.value); toast("Copied"); } catch (e) { toast("Copy failed"); } return; }
      if (act === "queue") return queueModal(id);
      b.disabled = true;
      try {
        if (act === "save") {
          const r = await api.replySaveDraft(id, ta.value.trim());
          if (r?.error) { setMsg(r.error, "text-rose-500"); b.disabled = false; return; }
          toast("Draft saved"); o.status = "drafted"; return openDraft(id, o);
        }
        if (act === "regen") {
          setMsg("Re-generating…"); const d = await api.replyDraft(id);
          if (d?.error) { setMsg(d.error, "text-rose-500"); b.disabled = false; return; }
          return openDraft(id, o);
        }
        if (act === "approve") {
          if (ta.value.trim()) await api.replySaveDraft(id, ta.value.trim());
          const r = await api.replyApprove(id);
          if (r?.error) { setMsg(r.error, "text-rose-500"); b.disabled = false; return; }
          toast("Approved — ready to post"); return load(true);
        }
        if (act === "posted") {
          const r = await api.replySetStatus(id, "posted");
          if (r?.error) { setMsg(r.error, "text-rose-500"); b.disabled = false; return; }
          toast("Marked posted"); return load(true);
        }
      } catch (e) { setMsg(String(e), "text-rose-500"); b.disabled = false; }
    });
  }

  function queueModal(id) {
    window.orModal({
      title: "Queue reply",
      body: `<p class="mb-2 text-sm text-zinc-500 dark:text-zinc-400">Schedule when to post (leave blank to queue for the next cycle). Where posting credentials exist it posts automatically; otherwise you'll get a reminder to post manually.</p>
        <input id="q-at" type="datetime-local" class="${inputCls} w-full">`,
      okText: "Queue",
      onOk: async (ov) => {
        const v = ov.querySelector("#q-at")?.value;
        const at = v ? Math.floor(new Date(v).getTime() / 1000) : null;
        try {
          const r = await api.replyQueue(id, at);
          if (r?.error) { toast(r.error); return; }
          toast(at ? "Scheduled" : "Queued"); load(true);
        } catch (e) { toast("Failed: " + e); }
      },
    });
  }

  async function generateInto(box, id, o) {
    box.classList.remove("hidden");
    box.innerHTML = `<div class="text-sm text-zinc-400 animate-pulse">Generating on-brand reply…</div>`;
    try {
      const d = await api.replyDraft(id);
      if (d?.error) { box.innerHTML = `<div class="text-sm text-rose-500">${esc(d.error)}</div>`; return; }
      o.status = "drafted";
      const drafts = (await api.replyDrafts(id))?.drafts || [d];
      renderEditor(box, id, o, drafts);
    } catch (e) { box.innerHTML = `<div class="text-sm text-rose-500">${esc(e)}</div>`; }
  }

  async function openDraft(id, o) {
    const box = list.querySelector(`[data-draft="${CSS.escape(id)}"]`);
    if (!box) return;
    box.classList.remove("hidden");
    box.innerHTML = `<div class="text-sm text-zinc-400">Loading draft…</div>`;
    let drafts = [];
    try { drafts = (await api.replyDrafts(id))?.drafts || []; } catch (e) { console.error(e); }
    if (!drafts.length) {
      if (o.status === "saved") return generateInto(box, id, o);
      box.innerHTML = `<button class="${bP}" data-gen="${esc(id)}">Generate draft</button>`;
      box.querySelector("[data-gen]").onclick = () => generateInto(box, id, o);
      return;
    }
    renderEditor(box, id, o, drafts);
  }

  function paint() {
    list.querySelectorAll("[data-open]").forEach(b => b.onclick = () => {
      const id = b.getAttribute("data-open");
      openDraft(id, S.items.find(x => x.id === id) || { id, status: S.tab });
    });
    list.querySelectorAll("[data-skip]").forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { await api.replySetStatus(b.getAttribute("data-skip"), "skipped"); toast("Dismissed"); load(true); }
      catch (e) { toast("Failed: " + e); b.disabled = false; }
    });
    moreWrap.classList.toggle("hidden", S.items.length >= S.total);
    icons();
  }

  const emptyMsg = () => S.query ? `No items match “${esc(S.query)}”.` : (INBOX_EMPTY[S.tab] || "Nothing here.");

  async function load(reset = true) {
    if (reset) { S.offset = 0; S.items = []; list.innerHTML = skeleton(2); }
    statusEl.textContent = "Loading…";
    try {
      const r = await api.replyList(S.tab, 0, PAGE, { query: S.query, sort: S.sort, offset: S.offset });
      let items = r?.opportunities || [];
      let total = r?.total ?? items.length;
      // Ready tab also surfaces queued (scheduled) replies, shown first.
      if (S.tab === "ready" && reset) {
        try {
          const q = await api.replyList("queued", 0, PAGE, { query: S.query, sort: S.sort, offset: 0 });
          const qi = q?.opportunities || [];
          items = qi.concat(items); total += (q?.total ?? qi.length);
        } catch (e) { console.error(e); }
      }
      S.items = reset ? items : S.items.concat(items);
      S.total = total;
      statusEl.textContent = S.total ? `${S.items.length} of ${S.total}` : "";
      list.innerHTML = S.items.length ? S.items.map(cardHTML).join("")
        : `<div class="${card} text-zinc-500">${emptyMsg()}</div>`;
      paint();
    } catch (e) {
      list.innerHTML = `<div class="${card} border-rose-500/40 text-rose-500">Couldn't load — ${esc(e)}
        <div class="mt-2"><button id="ib-retry" class="${btn}">Retry</button></div></div>`;
      statusEl.textContent = "";
      const rt = view.querySelector("#ib-retry"); if (rt) rt.onclick = () => load(true);
    }
  }

  view.querySelectorAll("[data-tab]").forEach(t => t.onclick = () => {
    S.tab = t.getAttribute("data-tab");
    view.querySelectorAll("[data-tab]").forEach(x => x.className = _chip(x === t));
    load(true);
  });
  view.querySelector("#ib-q").oninput = debounce((e) => { S.query = e.target.value.trim(); load(true); });
  view.querySelector("#ib-sort").onchange = (e) => { S.sort = e.target.value; load(true); };
  moreWrap.querySelector("button").onclick = () => { S.offset += PAGE; load(false); };
  // On open, process any queued replies whose schedule is due (best-effort
  // auto-post; the rest surface a "Due now" badge for manual posting). If
  // anything posted, refresh so it moves to the Posted tab.
  api.replyPostDue?.().then((r) => { if (r && r.posted && r.posted.length) load(true); }).catch(() => {});
  load(true);
}

// ── Learning (the agent's evolving brain — memories + beliefs + feedback) ────
export async function renderLearning(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = head("Learning",
    "What this agent has learned from the data it fetches. It distills posts into memories, links them into beliefs, and writes from them.",
    `<button id="ln-learn" class="${btnP}"><i data-lucide="brain-circuit" class="inline-block h-4 w-4 align-[-2px]"></i> Learn now</button>`) +
    `<div id="ln-body"><div class="${card} text-zinc-500">Loading…</div></div>`;
  const body = document.getElementById("ln-body");
  const kpi = (l, v, sub) => `<div class="${card}"><div class="text-sm text-zinc-500">${l}</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">${v}</div>${sub ? `<div class="text-xs text-zinc-400 mt-0.5">${sub}</div>` : ""}</div>`;
  // De-duplicate insights by normalized text (defensive — the backend dedups too).
  const dedup = (arr) => {
    const seen = new Set();
    return (arr || []).filter((x) => {
      const k = String(x && x.text || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 160);
      if (!k || seen.has(k)) return false;
      seen.add(k); return true;
    });
  };
  // Lesson/belief card: insight on its own line, source as a clean byline below.
  const li = (t, icon = "book-open") => `<div class="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-800/30 px-3.5 py-2.5">
    <p class="text-sm leading-snug text-zinc-700 dark:text-zinc-200">${esc(t.text)}</p>
    ${t.persona ? `<div class="mt-1.5 flex items-center gap-1 text-xs text-zinc-400"><i data-lucide="${icon}" class="h-3 w-3 shrink-0"></i><span class="truncate">${esc(t.persona)}</span></div>` : ""}</div>`;

  async function load() {
    let s = null;
    try { s = await api.agentLearnStatus(); } catch (e) { console.error(e); }
    if (!s || s.error) {
      body.innerHTML = `<div class="${card} text-zinc-500">${esc(s?.error || "No active agent.")} <a class="text-reddit underline" href="#/agents">Agents →</a></div>`;
      icons(); return;
    }
    const fb = s.feedback || {};
    const last = s.last_learn_at ? new Date(s.last_learn_at * 1000).toLocaleString() : "never";
    body.innerHTML =
      `<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
         ${kpi("Memories", s.memories || 0, "distilled lessons")}
         ${kpi("Beliefs", s.beliefs || 0, "synthesized conclusions")}
         ${kpi("Engaged", fb.engaged || 0, "saved / replied → learned")}
         ${kpi("Dismissed", fb.dismissed || 0, "suppressed from finds")}</div>
       <div class="mt-2 text-xs text-zinc-400">${s.linked_personas || 0} learning persona(s) · last learned ${esc(last)}</div>
       <div class="mt-5 grid gap-4 lg:grid-cols-2">
         <div class="${card}"><b class="text-zinc-900 dark:text-white">Recent lessons</b>
           <div class="mt-3 space-y-2">${dedup(s.recent_lessons).map((t) => li(t, "book-open")).join("") || `<div class="text-sm text-zinc-500">Nothing learned yet — hit “Learn now” after a collect.</div>`}</div></div>
         <div class="${card}"><b class="text-zinc-900 dark:text-white">Beliefs it writes from</b>
           <div class="mt-3 space-y-2">${dedup(s.recent_beliefs).map((t) => li(t, "lightbulb")).join("") || `<div class="text-sm text-zinc-500">No beliefs yet — they form once enough memories accumulate.</div>`}</div></div>
       </div>
       <div id="ln-strategy" class="mt-5"></div>
       <div id="ln-ideas" class="mt-5"></div>`;
    icons();
    loadStrategy();
    loadIdeas();
  }

  // ── Goal Playbook (self-evolving strategy) ──
  async function loadStrategy() {
    const host = document.getElementById("ln-strategy");
    if (!host) return;
    let cur = null;
    try { cur = await api.agentPlaybook(); } catch (e) { console.error(e); }
    const pb = cur && cur.playbook;
    const when = cur && cur.created_at ? new Date(cur.created_at * 1000).toLocaleString() : "";
    const list = (arr, fmt) => (arr && arr.length)
      ? arr.map(fmt).join("") : `<div class="text-sm text-zinc-500">—</div>`;
    const body = !pb
      ? `<div class="text-sm text-zinc-500">No strategy yet — set a goal (Agents → Edit) then hit <b>Evolve now</b>.</div>`
      : `<div class="grid gap-4 lg:grid-cols-3">
           <div><div class="mb-1 text-xs font-bold uppercase tracking-wide text-zinc-400">Winning angles</div>
             ${list(pb.winning_angles, (a) => `<div class="mb-1.5 text-sm"><b class="text-zinc-800 dark:text-zinc-100">${esc(a.angle || a)}</b>${a.why ? `<div class="text-xs text-zinc-500">${esc(a.why)}</div>` : ""}</div>`)}</div>
           <div><div class="mb-1 text-xs font-bold uppercase tracking-wide text-zinc-400">Avoid</div>
             ${list(pb.avoid, (x) => `<div class="mb-1 text-sm text-zinc-600 dark:text-zinc-300">• ${esc(x)}</div>`)}</div>
           <div><div class="mb-1 text-xs font-bold uppercase tracking-wide text-zinc-400">Next experiments</div>
             ${list(pb.next_experiments, (x) => `<div class="mb-1 text-sm text-zinc-600 dark:text-zinc-300">→ ${esc(x)}</div>`)}</div>
         </div>`;
    host.innerHTML = `<div class="${card}">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <b class="text-zinc-900 dark:text-white">Strategy playbook${pb ? ` <span class="text-xs font-normal text-zinc-400">v${cur.version} · ${esc(when)}</span>` : ""}</b>
        <button id="ln-evolve" class="${btn}"><i data-lucide="sparkles" class="inline-block h-4 w-4 align-[-2px]"></i> Evolve now</button></div>
      <div class="mt-3">${body}</div></div>`;
    const eb = document.getElementById("ln-evolve");
    if (eb) eb.onclick = async () => {
      eb.disabled = true; eb.innerHTML = `<i data-lucide="loader" class="inline-block h-4 w-4 align-[-2px] animate-spin"></i> Evolving…`; icons();
      try { const r = await api.agentEvolve(); toast(r?.skipped ? (r.reason || "Skipped") : (r?.summary || "Evolved ✓")); }
      catch (e) { toast("Evolve failed: " + e); }
      loadStrategy();
    };
    icons();
  }

  // ── Idea board (combine knowledge → suggested articles/posts) ──
  async function loadIdeas() {
    const host = document.getElementById("ln-ideas");
    if (!host) return;
    let ideas = [];
    try { ideas = (await api.agentIdeas(false))?.ideas || []; } catch (e) { console.error(e); }
    const mixCls = { "data-source": "bg-sky-500/15 text-sky-500", "conclusion": "bg-indigo-500/15 text-indigo-400", "mixed": "bg-emerald-500/15 text-emerald-500" };
    const cards = ideas.map((i) => `<div class="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3" data-idea="${esc(i.id)}">
      <div class="flex items-start justify-between gap-2"><b class="text-sm text-zinc-900 dark:text-white">${esc(i.title)}</b>
        <span class="shrink-0 rounded ${mixCls[i.source_mix] || "bg-zinc-500/15 text-zinc-400"} px-2 py-0.5 text-[11px] font-bold">${esc(i.source_mix || "mixed")}${i.goal_fit ? ` · fit ${Math.round(i.goal_fit * 100)}` : ""}</span></div>
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">${esc((i.thesis || "").slice(0, 220))}</p>
      <div class="mt-2 flex gap-2">
        <button data-idraft="${esc(i.id)}" class="rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white hover:bg-reddit-hi">Draft this</button>
        <button data-idismiss="${esc(i.id)}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-500">Dismiss</button></div></div>`).join("");
    host.innerHTML = `<div class="${card}">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <b class="text-zinc-900 dark:text-white">Idea board <span class="text-xs font-normal text-zinc-400">— combines its knowledge into articles/posts</span></b>
        <button id="ln-suggest" class="${btn}"><i data-lucide="lightbulb" class="inline-block h-4 w-4 align-[-2px]"></i> Suggest ideas</button></div>
      <div class="mt-3 space-y-2">${cards || `<div class="text-sm text-zinc-500">No ideas yet — Learn from data, then hit <b>Suggest ideas</b>.</div>`}</div></div>`;
    const sb = document.getElementById("ln-suggest");
    if (sb) sb.onclick = async () => {
      sb.disabled = true; sb.innerHTML = `<i data-lucide="loader" class="inline-block h-4 w-4 align-[-2px] animate-spin"></i> Thinking…`; icons();
      try { const r = await api.agentIdeas(true); toast(r?.skipped ? (r.reason || "Skipped") : `Suggested ${(r?.ideas || []).length} idea(s)`); }
      catch (e) { toast("Suggest failed: " + e); }
      loadIdeas();
    };
    host.querySelectorAll("[data-idraft]").forEach((b) => b.onclick = async () => {
      b.disabled = true; b.textContent = "Drafting…";
      try { const r = await api.agentIdeaDraft(b.getAttribute("data-idraft")); if (r?.error) { toast(r.error); b.disabled = false; b.textContent = "Draft this"; return; } toast("Draft created → Compose"); location.hash = "#/compose"; }
      catch (e) { toast("Draft failed: " + e); b.disabled = false; b.textContent = "Draft this"; }
    });
    host.querySelectorAll("[data-idismiss]").forEach((b) => b.onclick = async () => {
      try { await api.agentIdeaStatus(b.getAttribute("data-idismiss"), "dismissed"); loadIdeas(); } catch (e) { toast("Failed: " + e); }
    });
    icons();
  }

  document.getElementById("ln-learn").onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.innerHTML = `<i data-lucide="loader" class="inline-block h-4 w-4 align-[-2px] animate-spin"></i> Learning…`; icons();
    try {
      const r = await api.agentLearn(null, 30);
      toast(r?.error ? ("Learn failed: " + r.error) : (r?.message || "Learned."));
    } catch (err) { toast("Learn failed: " + err); }
    b.disabled = false; b.innerHTML = `<i data-lucide="brain-circuit" class="inline-block h-4 w-4 align-[-2px]"></i> Learn now`; icons();
    load();
  };
  load();
}

// ── Analytics (derived from saved opportunities + content) ──────────────────
// ── Inline-SVG chart helpers (no chart lib) ─────────────────────────────────
const _kpi = (l, v) => `<div class="${card}"><div class="text-sm text-zinc-500">${esc(l)}</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">${esc(String(v))}</div></div>`;

// Horizontal bar list scaled to the max value. items = [{label, count}].
function barList(items, color = "bg-reddit") {
  if (!items || !items.length) return `<div class="text-sm text-zinc-500">No data yet.</div>`;
  const max = Math.max(1, ...items.map((i) => i.count || 0));
  return `<div class="space-y-2">${items.map((i) => {
    const pct = Math.round(100 * (i.count || 0) / max);
    return `<div class="flex items-center gap-2 text-sm">
      <span class="w-28 shrink-0 truncate text-zinc-600 dark:text-zinc-300" title="${esc(i.label)}">${esc(i.label)}</span>
      <div class="h-2.5 flex-1 rounded-full bg-zinc-100 dark:bg-zinc-800"><div class="h-2.5 rounded-full ${color}" style="width:${pct}%"></div></div>
      <span class="w-8 shrink-0 text-right text-zinc-500">${i.count || 0}</span></div>`;
  }).join("")}</div>`;
}

// Multi-series sparkline chart over the daily series.
function sparkChart(series, palette) {
  const labels = series?.labels || [];
  const streams = series?.streams || {};
  const names = Object.keys(streams);
  if (!labels.length || !names.length) return `<div class="text-sm text-zinc-500">No activity in this window.</div>`;
  const n = labels.length, W = 640, H = 120, pad = 4;
  const max = Math.max(1, ...names.flatMap((nm) => streams[nm]));
  const x = (i) => pad + (W - 2 * pad) * (n === 1 ? 0.5 : i / (n - 1));
  const y = (v) => H - pad - (H - 2 * pad) * (v / max);
  const colors = palette || ["#ff4500", "#6366f1", "#10b981"];
  const paths = names.map((nm, k) => {
    const c = colors[k % colors.length];
    const pts = streams[nm].map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    return `<polyline fill="none" stroke="${c}" stroke-width="2" points="${pts}" />`;
  }).join("");
  const legend = names.map((nm, k) => `<span class="inline-flex items-center gap-1 text-xs text-zinc-500">
    <span class="h-2 w-2 rounded-full" style="background:${colors[k % colors.length]}"></span>${esc(nm)} (${streams[nm].reduce((a, b) => a + b, 0)})</span>`).join(" · ");
  return `<svg viewBox="0 0 ${W} ${H}" class="w-full" preserveAspectRatio="none" style="height:120px">${paths}</svg>
    <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1">${legend}</div>`;
}

export async function renderAnalytics(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = head("Analytics", "Activity for the active agent — last 30 days.") + `<div id="an">Loading…</div>`;
  let s = null;
  try { s = await api.analyticsSummary(30); } catch (e) { console.error(e); }
  const wrap = document.getElementById("an");
  if (s === null) { wrap.outerHTML = `<div class="${card} text-zinc-500">Run inside the app to see analytics.</div>`; return; }
  if (s.error) { wrap.outerHTML = `<div class="${card} text-zinc-500">${esc(s.error)} <a class="text-reddit underline" href="#/agents">Agents →</a></div>`; return; }
  const k = s.kpis || {};
  const fkv = Object.entries(s.funnel || {});
  wrap.outerHTML =
    `<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
       ${_kpi("Opportunities", k.opportunities)}${_kpi("Replied", k.replied)}
       ${_kpi("Content items", k.content_total)}${_kpi("Citation rate", (k.citation_rate || 0) + "%")}</div>
     <div class="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
       ${_kpi("Saved", k.saved)}${_kpi("Drafted", k.drafted)}
       ${_kpi("Scheduled", k.content_scheduled)}${_kpi("Posted", k.content_posted)}</div>

     <div class="mt-5 ${card}"><b class="text-zinc-900 dark:text-white">Activity over time</b>
       <div class="mt-3">${sparkChart(s.series)}</div></div>

     <div class="mt-5 grid gap-4 lg:grid-cols-2">
       <div class="${card}"><b class="text-zinc-900 dark:text-white">Content by type</b>
         <div class="mt-3">${barList(s.content_by_kind || [], "bg-indigo-500")}</div></div>
       <div class="${card}"><b class="text-zinc-900 dark:text-white">Content funnel</b>
         <div class="mt-3">${barList(fkv.map(([label, count]) => ({ label, count })), "bg-emerald-500")}</div></div>
       <div class="${card}"><b class="text-zinc-900 dark:text-white">Top subreddits / sources</b>
         <div class="mt-3">${barList(s.by_subreddit || [], "bg-reddit")}</div></div>
       <div class="${card}"><b class="text-zinc-900 dark:text-white">Opportunities by keyword</b>
         <div class="mt-3">${barList(s.by_keyword || [], "bg-amber-500")}</div></div></div>`;
  icons();
}

// ── Queue (content items by status) ─────────────────────────────────────────
const QUEUE_STATUS = { draft: "bg-zinc-500/15 text-zinc-400", scheduled: "bg-amber-500/15 text-amber-500", posted: "bg-emerald-500/15 text-emerald-500" };
const QUEUE_TABS = [["all", "All"], ["draft", "Drafts"], ["scheduled", "Scheduled"], ["posted", "Posted"]];
// epoch seconds ↔ value for <input type="datetime-local"> (local time, no tz suffix)
function _toLocalInput(ts) {
  const d = ts ? new Date(ts * 1000) : new Date(Date.now() + 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export async function renderQueue(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  let tab = "all";
  view.innerHTML = head("Queue", "Drafts, scheduled &amp; posted content. Publishing is manual — copy, post, then mark it posted.",
    `<a href="#/compose" class="${btnP}">+ New content</a>`) +
    `<div id="q-tabs" class="mb-4 flex flex-wrap gap-2"></div><div id="q">Loading…</div>`;
  const wrap = () => document.getElementById("q");
  const tabsEl = document.getElementById("q-tabs");
  const chip = (on) => `q-tab rounded-full px-3 py-1.5 text-xs font-semibold ${on ? "bg-reddit text-white" : "border border-zinc-200 dark:border-zinc-700 text-zinc-500"}`;
  let all = [];

  function paintTabs() {
    const n = (s) => s === "all" ? all.length : all.filter(c => (c.status || "draft") === s).length;
    tabsEl.innerHTML = QUEUE_TABS.map(([v, l]) => `<button data-tab="${v}" class="${chip(v === tab)}">${l} <span class="opacity-60">${n(v)}</span></button>`).join("");
    tabsEl.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.getAttribute("data-tab"); paintTabs(); paint(); });
  }

  async function load() {
    const el = wrap(); if (el) el.innerHTML = `<div class="${card} animate-pulse text-zinc-500">Loading…</div>`;
    let content;
    try { content = (await api.contentList(null, null, 200))?.content; }
    catch (e) { if (wrap()) wrap().innerHTML = `<div class="rounded-xl border border-rose-500/40 bg-rose-500/5 p-4 text-rose-500">Couldn’t load content — ${esc(e)} <button id="q-retry" class="ml-2 underline">Retry</button></div>`; const r = document.getElementById("q-retry"); if (r) r.onclick = load; return; }
    all = content || [];
    paintTabs(); paint();
  }

  function paint() {
    if (!all.length) { wrap().innerHTML = `<div class="${card} text-zinc-500">No content yet. <a class="text-reddit underline" href="#/compose">Compose your first post →</a></div>`; return; }
    const list = tab === "all" ? all : all.filter(c => (c.status || "draft") === tab);
    if (!list.length) { wrap().innerHTML = `<div class="${card} text-zinc-500">No ${tab} content.</div>`; return; }
    const rows = list.map((c) => {
      const id = esc(c.id);
      const st = c.status || "draft";
      const stCls = QUEUE_STATUS[st] || QUEUE_STATUS.draft;
      const when = c.scheduled_at ? ` · ${new Date(c.scheduled_at * 1000).toLocaleString()}` : "";
      const bd = "rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold";
      return `<div class="${card}" data-row="${id}">
        <div class="flex items-center gap-2"><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">${esc((c.kind || "").replace(/_/g, " "))}</span>
          ${c.platform ? `<span class="text-xs text-zinc-500">${esc(c.platform)}</span>` : ""}
          <span class="rounded ${stCls} px-2 py-0.5 text-xs font-bold">${esc(st)}${esc(when)}</span></div>
        <div class="mt-1.5 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-200">${esc((c.body || "").slice(0, 300))}${(c.body || "").length > 300 ? "…" : ""}</div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button data-act="copy" data-id="${id}" class="${bd}"><i data-lucide="copy" class="inline-block h-3.5 w-3.5 align-[-2px]"></i> Copy</button>
          <button data-act="edit" data-id="${id}" class="${bd}">Edit</button>
          ${st === "scheduled"
            ? `<button data-act="unschedule" data-id="${id}" class="${bd}">↺ Unschedule</button>`
            : st !== "posted" ? `<button data-act="schedule" data-id="${id}" class="${bd} text-amber-500">Schedule</button>` : ""}
          ${st !== "posted"
            ? `<button data-act="posted" data-id="${id}" class="${bd} text-emerald-500">✓ Mark posted</button>`
            : `<button data-act="draft" data-id="${id}" class="${bd}">↺ Back to draft</button>`}
          <button data-act="delete" data-id="${id}" class="${bd} text-rose-500">Delete</button></div></div>`;
    }).join("");
    wrap().innerHTML = `<div class="space-y-3">${rows}</div>`;
    wrap().querySelectorAll("[data-act]").forEach(b => b.onclick = () => qAction(b));
    icons();
  }

  async function qAction(b) {
    const act = b.getAttribute("data-act"), id = b.getAttribute("data-id");
    const c = all.find(x => String(x.id) === id) || {};
    if (act === "copy") {
      try { await navigator.clipboard.writeText(c.body || ""); toast("Copied — paste it where you’re posting"); }
      catch (e) { toast("Couldn’t copy"); }
      return;
    }
    if (act === "edit") {
      window.orModal({
        title: "Edit content", okText: "Save",
        body: `<textarea id="q-body" rows="8" class="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm">${esc(c.body || "")}</textarea>`,
        onOk: async (ov) => {
          const body = ov.querySelector("#q-body")?.value || "";
          try { await api.contentUpdate(id, { body }); toast("Saved"); load(); } catch (e) { toast("Save failed: " + e); }
        },
      });
      return;
    }
    if (act === "schedule") {
      window.orModal({
        title: "Schedule content", okText: "Schedule",
        body: `<p class="mb-2 text-sm text-zinc-500">Pick when to publish. You’ll still post manually — this just queues a reminder time.</p>
          <input id="q-when" type="datetime-local" value="${_toLocalInput(c.scheduled_at)}" class="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm">`,
        onOk: async (ov) => {
          const v = ov.querySelector("#q-when")?.value;
          if (!v) { toast("Pick a date/time"); return; }
          const ts = Math.floor(new Date(v).getTime() / 1000);
          try { await api.contentUpdate(id, { status: "scheduled", scheduledAt: ts }); toast("Scheduled"); load(); }
          catch (e) { toast("Failed: " + e); }
        },
      });
      return;
    }
    if (act === "delete") {
      window.orModal({
        title: "Delete this content?", okText: "Delete",
        body: `<p class="text-sm text-zinc-500">This can’t be undone.</p>`,
        onOk: async () => { try { await api.contentDelete(id); toast("Deleted"); load(); } catch (e) { toast("Delete failed: " + e); } },
      });
      return;
    }
    // status transitions: posted / draft / unschedule(→draft, clear scheduled_at)
    const patch = act === "unschedule" ? { status: "draft", scheduledAt: 0 } : { status: act };
    b.disabled = true;
    try {
      await api.contentUpdate(id, patch);
      toast(act === "posted" ? "Marked posted" : act === "unschedule" ? "Unscheduled" : "Back to draft");
      load();
    } catch (e) { toast("Failed: " + e); b.disabled = false; }
  }
  load();
}

// ── Keywords (edit the agent's tracked keywords + platforms) ────────────────
export async function renderKeywords(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = `<div id="kw">Loading…</div>`;
  let a = null, platforms = [];
  try { a = await api.agentGet(); } catch (e) { console.error(e); }
  if (!a) { document.getElementById("kw").innerHTML = `<div class="${card}">No active agent. <a class="text-reddit underline" href="#/agents">Create one →</a></div>`; return; }
  try { platforms = (await api.replyPlatforms())?.platforms || []; } catch (e) { console.error(e); }
  const checks = platforms.filter((p) => p.can_reply).map((p) =>
    `<label class="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 px-2 py-1.5 text-sm">
       <input type="checkbox" value="${esc(p.key)}" ${(a.platforms || []).includes(p.key) ? "checked" : ""}> ${esc(p.label)}</label>`).join("");
  document.getElementById("kw").outerHTML =
    head("Keywords &amp; platforms", `What <b>${esc(a.name)}</b> watches.`,
      `<button id="kw-save" class="${btnP}">Save</button>`) +
    `<div class="grid gap-5 lg:grid-cols-2">
       <div class="${card}"><b class="text-zinc-900 dark:text-white">Keywords</b>
         <p class="mb-2 mt-1 text-sm text-zinc-500">Comma-separated topics to scan for.</p>
         <textarea id="kw-list" rows="4" class="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm">${esc((a.keywords || []).join(", "))}</textarea>
         <div class="mt-3"><b class="text-zinc-900 dark:text-white">Product / what you promote</b>
           <p class="mb-1 mt-0.5 text-xs text-zinc-500">What your product does — the agent weaves this into replies (only as much as each sub's rules allow).</p>
           <textarea id="kw-product" rows="2" placeholder="e.g. AI note-taking app that auto-links your notes for students" class="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm">${esc(a.brand && a.brand !== a.name ? a.brand : (a.niche || ""))}</textarea></div>
         <div class="mt-3"><b class="text-zinc-900 dark:text-white">Voice</b>
           <input id="kw-persona" value="${esc(a.persona || "")}" placeholder="ex-teacher, founder of the product" class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm"></div>
         <div class="mt-3"><b class="text-zinc-900 dark:text-white">Tone</b>
           <input id="kw-tone" value="${esc(a.tone || "")}" placeholder="helpful, concise, non-salesy" class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm"></div>
         <div class="mt-3"><b class="text-zinc-900 dark:text-white">Website</b>
           <p class="mb-1 mt-0.5 text-xs text-zinc-500">Your brand domain — used to detect citations in AI Visibility.</p>
           <input id="kw-website" value="${esc(a.website || "")}" placeholder="acme-notes.com" class="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm"></div></div>
       <div class="${card}"><b class="text-zinc-900 dark:text-white">Platforms watched</b>
         <div class="mt-3 grid grid-cols-2 gap-2">${checks}</div></div></div>
     <div class="mt-4 ${card}"><b class="text-zinc-900 dark:text-white">Goal <span class="text-xs font-normal text-zinc-400">— what this agent evolves toward</span></b>
       <p class="mb-3 mt-1 text-sm text-zinc-500">The self-evolving engine optimizes every reply &amp; post toward this.</p>
       <div class="grid gap-3 sm:grid-cols-2">
         <label class="block text-sm text-zinc-500">Objective<input id="kw-objective" value="${esc(a.objective || "")}" placeholder="drive TestNotes signups" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
         <label class="block text-sm text-zinc-500">Audience<input id="kw-audience" value="${esc(a.audience || "")}" placeholder="students who struggle to organize notes" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
         <label class="block text-sm text-zinc-500">Win signal<input id="kw-winsignal" value="${esc(a.win_signal || "")}" placeholder="reply posted + author engages" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
         <label class="block text-sm text-zinc-500">Guardrails<input id="kw-guardrails" value="${esc(a.guardrails || "")}" placeholder="never spam; disclose; obey sub rules" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
       </div></div>
     <span id="kw-msg" class="mt-3 inline-block text-sm text-zinc-500"></span>`;
  document.getElementById("kw-save").onclick = async () => {
    const msg = document.getElementById("kw-msg");
    const kws = document.getElementById("kw-list").value;
    const persona = document.getElementById("kw-persona").value.trim();
    const product = document.getElementById("kw-product").value.trim();
    const tone = document.getElementById("kw-tone").value.trim();
    const website = document.getElementById("kw-website").value.trim();
    const pfs = [...document.querySelectorAll("#kw input[type=checkbox]:checked")].map((c) => c.value);
    msg.textContent = "Saving…";
    const patch = { keywords: kws, persona, tone, website, platforms: pfs.join(",") };
    // Product → the `brand` field the draft generator promotes from. Only set
    // when non-empty so we never clobber an existing description with a blank.
    if (product) patch.brand = product;
    const objective = document.getElementById("kw-objective").value.trim();
    const audience = document.getElementById("kw-audience").value.trim();
    const winSignal = document.getElementById("kw-winsignal").value.trim();
    const guardrails = document.getElementById("kw-guardrails").value.trim();
    try {
      await api.agentUpdate(patch);
      await api.agentGoalSet(objective, audience, winSignal, guardrails);
      msg.textContent = "Saved ✓"; toast("Agent saved");
    } catch (e) { msg.textContent = "Failed: " + e; }
  };
  icons();
}

// ── Subreddit Intelligence (fetch a sub's rules before you post) ────────────
export async function renderSubreddit(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  let a = null; try { a = await api.agentGet(); } catch (e) { console.error(e); }
  view.innerHTML = head("Subreddit Intelligence",
    "Know the rules before you post — fetched live from Reddit.",
    `<div class="flex gap-2"><input id="sr-input" placeholder="subreddit (e.g. GetStudying)" class="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm"><button id="sr-go" class="${btnP}">Check rules</button></div>`) +
    `<div id="sr-out"><div class="${card} text-zinc-500">Enter a subreddit to see its rules &amp; self-promo policy.</div></div>`;
  document.getElementById("sr-go").onclick = run;
  document.getElementById("sr-input").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  async function run() {
    const sub = document.getElementById("sr-input").value.trim().replace(/^r\//, "");
    const out = document.getElementById("sr-out");
    if (!sub) return;
    out.innerHTML = `<div class="${card} animate-pulse text-zinc-500">Fetching r/${esc(sub)} rules…</div>`;
    try {
      const r = await api.replyRules(sub, false);
      if (r?.error) { out.innerHTML = `<div class="${card} text-rose-500">${esc(r.error)}</div>`; return; }
      const rules = r?.rules || [];
      out.innerHTML = `<div class="${card}">
        <div class="flex items-center justify-between"><b class="text-zinc-900 dark:text-white">r/${esc(sub)}</b>
          <span class="text-sm text-zinc-500">${rules.length} rules</span></div>
        <div class="mt-3 space-y-2 text-sm">${rules.length ? rules.map((x) =>
          `<div><div class="font-semibold text-zinc-900 dark:text-white">• ${esc(x.name || "")}</div>${x.desc ? `<div class="text-zinc-500">${esc(x.desc)}</div>` : ""}</div>`).join("")
          : '<div class="text-zinc-500">No rules returned (private/quarantined or fetch failed).</div>'}</div>
        <p class="mt-3 rounded-lg bg-reddit/10 px-3 py-2 text-sm text-reddit">OpenReply checks your reply against these before you post.</p></div>`;
    } catch (e) { out.innerHTML = `<div class="${card} text-rose-500">${esc(e)}</div>`; }
  }
  icons();
}

// ── Onboarding (create the first agent) ─────────────────────────────────────
export async function renderOnboarding(view) {
  view.className = "mx-auto max-w-2xl px-6 py-10";
  let platforms = [];
  try { platforms = (await api.replyPlatforms())?.platforms || []; } catch (e) { console.error(e); }
  const tiles = platforms.filter((p) => p.can_reply).slice(0, 9).map((p) =>
    `<label data-tile class="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm transition hover:border-zinc-400">
       <input type="checkbox" value="${esc(p.key)}" ${p.key === "reddit_free" ? "checked" : ""} class="h-4 w-4 accent-reddit">
       <span class="truncate">${esc(p.label)}</span></label>`).join("");
  const sec = (t) => `<div class="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">${t}</div>`;

  view.innerHTML = `
    <a href="#/agents" class="text-sm text-zinc-500 hover:text-reddit">← Agents</a>
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">Create an agent</h1>
    <p class="text-zinc-500 dark:text-zinc-400">A brand/niche persona with its own purpose, knowledge, voice &amp; platforms.</p>

    <div class="mt-5 ${card} space-y-5">
      <div>${sec("1 · Identity")}
        <div class="space-y-3">
          ${field("ob-name", "Name *", "Acme Notes")}
          ${field("ob-website", "Website", "acmenotes.com — used for AI-visibility citation tracking")}
          ${field("ob-niche", "Niche", "AI note-taking for students")}
        </div></div>

      <div>${sec("2 · Purpose")}
        <p class="mb-2 -mt-1 text-xs text-zinc-400">Why this agent exists. It writes replies + a growth plan from this.</p>
        <div class="space-y-3">
          ${field("ob-goal", "Goal — what should it achieve?", "drive trial signups from students in r/GradSchool")}
          ${field("ob-product", "Product — what you offer", "AI notes that summarize lectures into study guides")}
        </div></div>

      <div>${sec("3 · Voice")}
        <div class="space-y-3">
          ${field("ob-persona", "Voice / persona", "ex-teacher, founder of Acme")}
          ${field("ob-tone", "Tone", "helpful, concise, non-salesy")}
        </div></div>

      <div>${sec("4 · Targeting")}
        ${field("ob-keywords", "Keywords (comma-separated)", "note taking app, obsidian alternative, study notes")}
        <div class="mt-3">
          <div class="mb-1 text-sm text-zinc-500 dark:text-zinc-400">Platforms to watch <span id="ob-pf-count" class="text-zinc-400"></span></div>
          <div id="ob-platforms" class="grid grid-cols-2 gap-2 sm:grid-cols-3">${tiles}</div></div>
      </div>

      <div class="flex items-center gap-3 border-t border-zinc-100 dark:border-zinc-800 pt-4">
        <button id="ob-create" class="${btnP}">Create agent →</button>
        <span id="ob-msg" class="text-sm text-rose-500"></span></div>
    </div>`;

  const pfBox = view.querySelector("#ob-platforms");
  const countEl = view.querySelector("#ob-pf-count");
  const tileEls = [...pfBox.querySelectorAll("[data-tile]")];
  const selected = () => tileEls.filter((t) => t.querySelector("input").checked);
  const paint = () => {
    tileEls.forEach((t) => {
      const on = t.querySelector("input").checked;
      t.classList.toggle("border-reddit", on);
      t.classList.toggle("bg-reddit/5", on);
      t.classList.toggle("text-reddit", on);
    });
    const n = selected().length;
    countEl.textContent = n ? `· ${n} selected` : "· pick at least one";
  };
  tileEls.forEach((t) => t.querySelector("input").addEventListener("change", paint));
  paint();

  view.querySelector("#ob-create").onclick = async () => {
    const msg = view.querySelector("#ob-msg");
    const nameEl = view.querySelector("#ob-name");
    const name = nameEl.value.trim();
    if (!name) { msg.className = "text-sm text-rose-500"; msg.textContent = "Name is required."; nameEl.focus(); return; }
    const pfs = selected().map((t) => t.querySelector("input").value);
    if (!pfs.length) { msg.className = "text-sm text-rose-500"; msg.textContent = "Pick at least one platform to watch."; return; }
    const btn = view.querySelector("#ob-create"); btn.disabled = true;
    msg.className = "text-sm text-zinc-500"; msg.textContent = "Creating…";
    try {
      await api.agentCreate({
        name,
        website: view.querySelector("#ob-website").value.trim(),
        niche: view.querySelector("#ob-niche").value.trim(),
        goal: view.querySelector("#ob-goal").value.trim(),
        product: view.querySelector("#ob-product").value.trim(),
        persona: view.querySelector("#ob-persona").value.trim(),
        tone: view.querySelector("#ob-tone").value.trim(),
        keywords: view.querySelector("#ob-keywords").value.trim(),
        platforms: pfs.join(","),
      });
      toast("Agent created"); location.hash = "#/agent";
    } catch (e) { msg.className = "text-sm text-rose-500"; msg.textContent = "Failed: " + e; btn.disabled = false; }
  };
  icons();
}
// ── Alerts (rule store; push transport later) ───────────────────────────────
export async function renderAlerts(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = head("Alert rules", "Get pinged when a high-value conversation appears.",
    `<button id="al-new" class="${btnP}">+ New rule</button>`) +
    `<div id="al-form" class="hidden mb-5 ${card}"></div><div id="al-list" class="space-y-3">Loading…</div>`;
  document.getElementById("al-new").onclick = () => {
    const f = document.getElementById("al-form");
    f.classList.toggle("hidden");
    if (!f.innerHTML) {
      f.innerHTML = `<h3 class="mb-3 font-semibold text-zinc-900 dark:text-white">New alert rule</h3>
        <div class="grid gap-3 sm:grid-cols-2">${field("al-rule", "When (rule)", "high-intent reddit mentions")}${field("al-channel", "Channel", "slack")}</div>
        <div class="mt-2 text-sm text-zinc-500">Min score (0-1)</div>
        <input id="al-score" type="number" step="0.05" value="0.7" class="mt-1 w-32 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm">
        <div class="mt-3"><button id="al-add" class="${btnP}">Add rule</button> <span id="al-msg" class="text-sm text-zinc-500"></span></div>`;
      document.getElementById("al-add").onclick = async () => {
        const rule = document.getElementById("al-rule").value.trim();
        const msg = document.getElementById("al-msg");
        if (!rule) { msg.textContent = "Rule required."; return; }
        msg.textContent = "Adding…";
        try { await api.alertsAdd(rule, document.getElementById("al-channel").value.trim(), "any", parseFloat(document.getElementById("al-score").value) || 0); toast("Alert added"); f.classList.add("hidden"); load(); }
        catch (e) { msg.textContent = "Failed: " + e; }
      };
    }
  };
  async function load() {
    const list = document.getElementById("al-list");
    try {
      const alerts = (await api.alertsList())?.alerts || [];
      list.innerHTML = alerts.length ? alerts.map((a) => `<div class="${card} flex items-center justify-between gap-4">
        <div><div class="font-semibold text-zinc-900 dark:text-white">${esc(a.rule)}</div>
          <div class="text-sm text-zinc-500">${esc(a.channel)} · score ≥ ${a.score_min} · <span class="text-emerald-500">${esc(a.status)}</span></div></div>
        <button data-del="${esc(a.id)}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold text-rose-500">Delete</button></div>`).join("")
        : `<div class="${card} text-zinc-500">No alert rules. Click "+ New rule".</div>`;
      list.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => { await api.alertsDelete(b.getAttribute("data-del")); toast("Deleted"); load(); });
      icons();
    } catch (e) { list.innerHTML = `<div class="${card} text-rose-500">${esc(e)}</div>`; }
  }
  load();
}

// ── AI Visibility (GEO) ─────────────────────────────────────────────────────
// Relative "Nm ago" for an epoch-seconds timestamp (0 = never).
function _ago(ts) {
  if (!ts) return "never checked";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Bare host of a URL for compact display (drops scheme/www/path).
function _host(u) {
  let s = String(u || "").split("//").pop().split("/")[0].split("?")[0];
  return s.startsWith("www.") ? s.slice(4) : s;
}

// Compact citation-trend: one colored dot per past check (oldest → newest).
// cited=green · competitor=amber · absent=rose. Built from geo_checks history.
function geoTrendDots(checks) {
  if (!checks || !checks.length) return `<span class="text-xs text-zinc-400">No checks yet — hit Check to start the trend.</span>`;
  const color = (s) => s === "cited" ? "bg-emerald-500" : s === "competitor" ? "bg-amber-500" : "bg-rose-500";
  const dots = checks.map((c) =>
    `<span class="inline-block h-2.5 w-2.5 rounded-full ${color(c.status)}" title="${esc(c.status)} · ${esc(c.engine || "")} · ${esc(_ago(c.checked_at))}"></span>`).join("");
  return `<div class="text-xs font-semibold text-zinc-500">Citation trend (oldest → newest)</div>
    <div class="mt-1 flex flex-wrap items-center gap-1">${dots}</div>`;
}

export async function renderGeo(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = head("AI Visibility (GEO)",
    "Reddit is the #1 cited source in AI answers. Track queries, then Check to see if your brand is cited.",
    `<div class="flex gap-2"><button id="geo-checkall" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold">Check all</button><button id="geo-new" class="${btnP}">+ Track a query</button></div>`) +
    `<div id="geo-kpi" class="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4"></div>
     <div id="geo-trend" class="mb-5"></div>
     <div id="geo-engine" class="mb-5"></div>
     <div id="geo-form" class="hidden mb-5 ${card}"></div><div id="geo-list" class="space-y-3">Loading…</div>`;

  // Real-check engine status + connect Perplexity for live-web citations.
  (async () => {
    let hasKey = false;
    try { const st = await api.byokStatus(); hasKey = !!(st && (st.PERPLEXITY_API_KEY || st.perplexity || (st.keys && st.keys.includes && st.keys.includes("PERPLEXITY_API_KEY")))); } catch (e) { console.error(e); }
    const el = document.getElementById("geo-engine"); if (!el) return;
    el.innerHTML = hasKey
      ? `<div class="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400"><i data-lucide="globe" class="h-4 w-4"></i> Live-web checks on (Perplexity) — citations are real source URLs.</div>`
      : `<details class="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
           <summary class="cursor-pointer font-semibold">Checks use model knowledge (no live web). Connect Perplexity for real citation tracking →</summary>
           <div class="mt-2 flex flex-wrap items-end gap-2">
             <input id="geo-pplx" type="password" placeholder="pplx-…" class="flex-1 rounded-lg border border-amber-300/50 bg-white/60 px-3 py-2 text-zinc-900 dark:bg-zinc-900/60 dark:text-white">
             <button id="geo-pplx-save" class="${btnP}">Connect</button></div>
           <p class="mt-1 text-xs opacity-80">Get a key at perplexity.ai → Settings → API. Stored locally only.</p></details>`;
    icons();
    const sv = document.getElementById("geo-pplx-save");
    if (sv) sv.onclick = async () => {
      const v = document.getElementById("geo-pplx").value.trim();
      if (!v) return;
      try { await api.byokSet("PERPLEXITY_API_KEY", v); toast("Perplexity connected — checks now use live web"); renderGeo(view); }
      catch (e) { toast("Failed: " + e); }
    };
  })();

  document.getElementById("geo-new").onclick = () => {
    const f = document.getElementById("geo-form");
    f.classList.toggle("hidden");
    if (!f.innerHTML) {
      f.innerHTML = `<div class="flex flex-wrap items-end gap-3">
        <label class="flex-1 text-sm text-zinc-500">Query<input id="geo-q" placeholder="best note app for students" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
        <label class="text-sm text-zinc-500">Surface<select id="geo-s" class="mt-1 block rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><option>ChatGPT</option><option>Perplexity</option><option>Google</option></select></label>
        <button id="geo-add" class="${btnP}">Track</button></div><span id="geo-msg" class="text-sm text-zinc-500"></span>`;
      document.getElementById("geo-add").onclick = async () => {
        const q = document.getElementById("geo-q").value.trim();
        const msg = document.getElementById("geo-msg");
        if (!q) { msg.textContent = "Query required."; return; }
        try { await api.geoAdd(q, document.getElementById("geo-s").value); toast("Tracking"); f.classList.add("hidden"); load(); }
        catch (e) { msg.textContent = "Failed: " + e; }
      };
    }
  };
  document.getElementById("geo-checkall").onclick = async () => {
    const b = document.getElementById("geo-checkall");
    const prev = b.textContent; b.textContent = "Checking…"; b.disabled = true;
    try {
      const r = await api.geoCheckAll();
      if (r === null) toast("Run inside the app to check");
      else { const t = r.tally || {}; toast(`Checked ${r.checked || 0} · cited ${t.cited || 0}, competitor ${t.competitor || 0}, absent ${t.absent || 0}`); }
      load();
    } catch (e) { toast("Check failed"); }
    finally { b.textContent = prev; b.disabled = false; }
  };
  const stColor = (s) => s === "cited" ? "bg-emerald-500/15 text-emerald-500" : s === "competitor" ? "bg-amber-500/15 text-amber-500" : s === "absent" ? "bg-rose-500/15 text-rose-500" : "bg-zinc-500/15 text-zinc-400";
  async function load() {
    try {
      const r = await api.geoList();
      const kpi = (l, v) => `<div class="${card}"><div class="text-sm text-zinc-500">${l}</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">${v}</div></div>`;
      const qs = r?.queries || [];
      document.getElementById("geo-kpi").innerHTML =
        kpi("Tracked queries", r?.total || 0) + kpi("Cited", r?.cited || 0) +
        kpi("Share of voice", (r?.share_of_voice || 0) + "%") + kpi("Citation rate", (r?.citation_rate || 0) + "%");
      // Citation-rate-over-time — aggregated across all queries' check history.
      const trendEl = document.getElementById("geo-trend");
      const tr = r?.trend;
      if (trendEl) {
        trendEl.innerHTML = (tr && tr.labels && tr.labels.length >= 2)
          ? `<div class="${card}"><div class="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">Citation rate over time</div>${sparkChart({ labels: tr.labels, streams: { "Citation rate %": tr.rates } }, ["#10b981"])}</div>`
          : "";
      }
      const list = document.getElementById("geo-list");
      list.innerHTML = qs.length ? qs.map((q) => {
        let comps = [], cites = [];
        try { comps = JSON.parse(q.competitors || "[]"); } catch (e) { console.error(e); }
        try { cites = JSON.parse(q.citations || "[]"); } catch (e) { console.error(e); }
        const engBadge = q.engine === "perplexity"
          ? `<span class="rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-500" title="Checked against live web citations">live web</span>`
          : q.engine === "llm" ? `<span class="rounded bg-zinc-500/15 px-2 py-0.5 text-[11px] font-bold text-zinc-400" title="Model knowledge — no live web search">model only</span>` : "";
        const srcRow = cites.length ? `<div class="mt-2"><div class="text-xs font-semibold text-zinc-500">Cited sources</div>
          <div class="mt-1 flex flex-wrap gap-1.5">${cites.map((u) => `<a data-openurl="${esc(u)}" href="#" class="rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-600 hover:underline dark:text-sky-400">${esc(_host(u))}</a>`).join("")}</div></div>` : "";
        const detail = (q.answer || comps.length || cites.length) ? `<details class="mt-3 text-sm">
          <summary class="cursor-pointer text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">What the AI answered</summary>
          ${q.answer ? `<p class="mt-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 p-3 text-zinc-600 dark:text-zinc-300">${esc(q.answer)}</p>` : ""}
          ${srcRow}
          ${comps.length ? `<div class="mt-2"><div class="text-xs font-semibold text-zinc-500">Competitors named</div><div class="mt-1 flex flex-wrap gap-1.5">${comps.map((c) => `<span class="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">${esc(c)}</span>`).join("")}</div></div>` : ""}</details>` : "";
        return `<div class="${card}">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0"><div class="font-semibold text-zinc-900 dark:text-white">"${esc(q.query)}"</div>
              <div class="mt-1 flex flex-wrap items-center gap-2 text-sm"><span class="rounded bg-brand/15 px-2 py-0.5 text-xs font-bold text-brand">${esc(q.surface)}</span>
                <span class="rounded ${stColor(q.status)} px-2 py-0.5 text-xs font-bold">${esc(q.status)}</span>
                ${engBadge}
                <span class="text-xs text-zinc-400">${esc(_ago(q.last_checked))}</span></div></div>
            <div class="flex shrink-0 gap-2"><button data-check="${esc(q.id)}" class="${btnP} px-3 py-1.5 text-xs">Check</button>
              <button data-trend="${esc(q.id)}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">📈 Trend</button>
              <button data-cite="${esc(q.id)}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Mark cited</button>
              <button data-del="${esc(q.id)}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold text-rose-500">✕</button></div></div>
          ${detail}
          <div data-trendbox="${esc(q.id)}" class="mt-3 hidden"></div></div>`;
      }).join("")
        : `<div class="${card} text-zinc-500">No queries tracked. Click "+ Track a query".</div>`;
      list.querySelectorAll("[data-check]").forEach((b) => b.onclick = async () => {
        const prev = b.textContent; b.textContent = "Checking…"; b.disabled = true;
        try {
          const res = await api.geoCheck(b.getAttribute("data-check"));
          if (res === null) toast("Run inside the app to check");
          else if (res.error) toast(res.error);
          else toast(`Result: ${res.status}`);
          load();
        } catch (e) { toast("Check failed"); b.textContent = prev; b.disabled = false; }
      });
      list.querySelectorAll("[data-trend]").forEach((b) => b.onclick = async () => {
        const id = b.getAttribute("data-trend");
        const box = list.querySelector(`[data-trendbox="${CSS.escape(id)}"]`);
        if (!box) return;
        if (!box.classList.contains("hidden")) { box.classList.add("hidden"); return; }
        box.classList.remove("hidden");
        box.innerHTML = `<div class="text-xs text-zinc-400">Loading trend…</div>`;
        try { const h = await api.geoHistory(id); box.innerHTML = geoTrendDots(h?.checks || []); }
        catch (e) { box.innerHTML = `<div class="text-xs text-rose-500">${esc(e)}</div>`; }
      });
      list.querySelectorAll("[data-cite]").forEach((b) => b.onclick = async () => { await api.geoSet(b.getAttribute("data-cite"), "cited"); toast("Marked cited"); load(); });
      list.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => { await api.geoDelete(b.getAttribute("data-del")); toast("Deleted"); load(); });
      list.querySelectorAll("[data-openurl]").forEach((a) => a.onclick = (e) => { e.preventDefault(); api.openUrl(a.getAttribute("data-openurl")); });
      icons();
    } catch (e) { document.getElementById("geo-list").innerHTML = `<div class="${card} text-rose-500">${esc(e)}</div>`; }
  }
  load();
}

// ── Onboarding: profile + AI provider (BYOK) ─────────────────
export async function renderWelcome(view) {
  view.className = "min-h-screen w-full flex items-center justify-center px-6 py-10";
  let st = {};
  try { st = (await api.byokStatus()) || {}; } catch (e) { console.error(e); }
  const curProv = (st.llm_provider || "anthropic").toLowerCase();
  const sel = LLM_PROVIDERS.some(p => p[0] === curProv) ? curProv : "anthropic";
  const opts = LLM_PROVIDERS.map(([v, l]) => `<option value="${v}"${v === sel ? " selected" : ""}>${l}</option>`).join("");
  const name = localStorage.getItem("or-user-name") || "";
  view.innerHTML = `
    <div class="w-full max-w-lg">
      <div class="mb-6 flex items-center gap-2 text-xl font-extrabold text-zinc-900 dark:text-white">
        <span class="h-6 w-6 rounded-full bg-reddit"></span> OpenReply</div>
      <div class="${card} space-y-4">
        <div><h1 class="text-xl font-bold text-zinc-900 dark:text-white">Welcome 👋</h1>
          <p class="text-sm text-zinc-500 dark:text-zinc-400">Two quick things and you're in.</p></div>
        <div class="space-y-2">
          <div class="text-xs font-bold uppercase tracking-wider text-zinc-400">1 · Your profile</div>
          <label class="block text-sm"><span class="text-zinc-500 dark:text-zinc-400">Name</span>
            <input id="wc-name" value="${esc(name)}" placeholder="Your name" class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
        </div>
        <div class="space-y-2">
          <div class="text-xs font-bold uppercase tracking-wider text-zinc-400">2 · AI provider (your own key)</div>
          <p class="text-sm text-zinc-500 dark:text-zinc-400">Runs on your key — used to draft replies &amp; content. Stored locally only.</p>
          <label class="block text-sm"><span class="text-zinc-500 dark:text-zinc-400">Provider</span>
            <select id="wc-prov" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2">${opts}</select></label>
          <label class="block text-sm" id="wc-keywrap"></label>
          <button id="wc-test" class="${btn}">Test connection <span class="text-zinc-400">(optional)</span></button>
        </div>
        <button id="wc-finish" class="${btnP} w-full">Finish setup →</button>
        <div id="wc-msg" class="text-sm"></div>
      </div>
    </div>`;

  const provSel = view.querySelector("#wc-prov");
  const keyWrap = view.querySelector("#wc-keywrap");
  const paintKey = () => {
    const p = provSel.value, isOllama = p === "ollama";
    const ph = LLM_PROVIDERS.find(x => x[0] === p)?.[3] || "";
    keyWrap.innerHTML = `<span class="text-zinc-500 dark:text-zinc-400">${isOllama ? "Base URL" : "API key"}${isOllama ? "" : ' <span class="text-rose-500">· required to finish</span>'}</span>
      <input id="wc-key" type="${isOllama ? "text" : "password"}" placeholder="${esc(ph)}" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2">`;
  };
  paintKey();
  provSel.onchange = paintKey;

  const msg = view.querySelector("#wc-msg");
  const setMsg = (t, cls) => { msg.innerHTML = `<span class="${cls}">${esc(t)}</span>`; };
  async function saveProvider() {
    const p = provSel.value;
    const envKey = LLM_PROVIDERS.find(x => x[0] === p)?.[2];
    const keyVal = (view.querySelector("#wc-key")?.value || "").trim();
    if (p === "ollama") { await api.byokSet("OLLAMA_BASE_URL", keyVal || "http://localhost:11434"); }
    else { if (!keyVal) throw new Error("Enter your API key to continue."); await api.byokSet(envKey, keyVal); }
    await api.byokSet("LLM_PROVIDER", p);
  }
  view.querySelector("#wc-test").onclick = async (e) => {
    e.target.disabled = true; setMsg("Testing…", "text-zinc-500");
    try {
      await saveProvider();
      const r = (await api.testLlm(provSel.value, "")) || {};
      setMsg(r.ok ? `✓ ${r.provider || provSel.value}${r.model ? " · " + r.model : ""}` : `✗ ${r.error || "failed"}`, r.ok ? "text-emerald-500" : "text-rose-500");
    } catch (err) { setMsg(String(err.message || err), "text-rose-500"); }
    e.target.disabled = false;
  };
  view.querySelector("#wc-finish").onclick = async (e) => {
    e.target.disabled = true; setMsg("Verifying your provider…", "text-zinc-500");
    try {
      localStorage.setItem("or-user-name", view.querySelector("#wc-name").value.trim());
      await saveProvider();
      // Validate the key/endpoint actually works before we finish — otherwise a
      // typo'd key drops the user into an app where every draft/analysis fails
      // with a cryptic error and no obvious way back to fix it.
      const r = (await api.testLlm(provSel.value, "")) || {};
      if (!r.ok) {
        setMsg(`✗ ${r.error || "couldn't reach that provider"} — check your key and try again, or use “Test connection”.`, "text-rose-500");
        e.target.disabled = false; return;
      }
      localStorage.setItem("or-onboarded", "1");
      toast("You're all set"); location.hash = "#/agents";
    } catch (err) { setMsg(String(err.message || err), "text-rose-500"); e.target.disabled = false; }
  };
  icons();
}

// ── Subreddit Intelligence (full) ───────────────────────────────────────────
export async function renderSubredditFull(view) {
  const sbtn = "rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold";
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = head("Subreddit Intelligence",
    "Know the rules before you post — discover subs, see stats, rules, strictness & account safety.",
    `<button id="sr-disc" class="${btnP}">✨ Discover subs</button>`) +
    `<div id="sr-acct" class="mb-5"><div class="${card} flex items-center justify-between gap-4"><div class="h-4 w-52 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"></div><div class="h-6 w-24 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800"></div></div></div>
     <div class="mb-5 ${card}"><div class="flex flex-wrap items-end gap-3">
       <label class="flex-1 text-sm text-zinc-500">Add or check subreddits you know <span class="text-zinc-400">(comma-separated)</span><input id="sr-q" placeholder="GetStudying, productivity, ObsidianMD" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
       <button id="sr-add" class="${btnP}">+ Add to agent</button>
       <button id="sr-go" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold">Get intel</button></div>
       <p class="mt-2 text-xs text-zinc-400">Added subs are <b>tracked</b> — the agent keeps monitoring them for opportunities and caches their rules so replies stay compliant.</p></div>
     <div id="sr-detail"></div>
     <div id="sr-map" class="mb-5">${srSkelMap()}</div>
     <div class="mb-2 mt-2 flex flex-wrap items-center justify-between gap-2">
       <h3 class="font-semibold text-zinc-900 dark:text-white">Your subreddits</h3>
       <input id="sr-filter" type="search" placeholder="Filter your subs…" autocomplete="off" class="w-44 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-1.5 text-sm"></div>
     <div id="sr-tree" class="space-y-1.5">${srSkelTree()}</div>`;

  try {
    const a = await api.redditAccountStatus();
    document.getElementById("sr-acct").innerHTML =
      `<div class="${card} flex items-center justify-between gap-4"><div><b class="text-zinc-900 dark:text-white">Account safety</b>
        <div class="text-sm text-zinc-500">${a && a.connected ? ("Reddit connected" + (a.username ? (" · u/" + esc(a.username)) : "")) : "Reddit not connected — connect on Connections for live rules & stats"}</div></div>
        <span class="rounded ${a && a.connected ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"} px-2 py-0.5 text-xs font-bold">${a && a.connected ? "connected" : "connect for live data"}</span></div>`;
  } catch (e) { console.error(e); }

  document.getElementById("sr-disc").onclick = async (e) => {
    e.target.textContent = "Discovering…"; e.target.disabled = true;
    try { const r = await api.subDiscover(8); toast(r && r.error ? r.error : "Discovered subs"); } catch (err) { toast("Discover failed"); }
    e.target.textContent = "✨ Discover subs"; e.target.disabled = false; loadList();
  };
  document.getElementById("sr-go").onclick = runIntel;
  document.getElementById("sr-add").onclick = addSubs;
  document.getElementById("sr-q").addEventListener("keydown", (e) => { if (e.key === "Enter") addSubs(); });

  // Add subreddits the user already knows → track them (so the agent keeps
  // monitoring them) and fetch each one's rules/stats in the background.
  async function addSubs() {
    const raw = (document.getElementById("sr-q").value || "").trim();
    if (!raw) return;
    const subs = [...new Set(raw.split(/[\s,]+/).map((s) => s.replace(/^\/?r\//i, "").trim()).filter(Boolean))];
    if (!subs.length) return;
    const b = document.getElementById("sr-add");
    b.disabled = true; b.textContent = `Adding ${subs.length}…`;
    let ok = 0;
    for (const s of subs) {
      try { await api.subTrack(s, false); ok++; api.subIntel(s, false).catch(() => {}); } catch (e) { console.error(e); }
    }
    b.disabled = false; b.textContent = "+ Add to agent";
    document.getElementById("sr-q").value = "";
    toast(ok ? `Added ${ok} subreddit${ok > 1 ? "s" : ""} — fetching rules…` : "Could not add subs");
    loadList();
    // Re-render shortly so the background intel (members/rules) shows up.
    setTimeout(() => { try { loadList(); } catch (e) { console.error(e); } }, 4000);
  }

  async function runIntel() {
    const sub = document.getElementById("sr-q").value.trim().replace(/^r\//, "");
    if (!sub) return;
    const d = document.getElementById("sr-detail");
    d.innerHTML = srSkelIntel(sub);
    try {
      const i = await api.subIntel(sub, false);
      if (i?.error) { d.innerHTML = `<div class="${card} text-rose-500">${esc(i.error)}</div>`; return; }
      const rules = i.rules || [];
      const pill = (l, v) => `<div><div class="text-xs uppercase tracking-wide text-zinc-400">${l}</div><div class="font-semibold text-zinc-900 dark:text-white">${v}</div></div>`;
      d.innerHTML = `<div class="${card}">
        <div class="flex items-center justify-between gap-4"><div><a id="sr-open" href="https://www.reddit.com/r/${esc(i.sub)}" class="font-bold text-zinc-900 hover:text-reddit dark:text-white">r/${esc(i.sub)} ↗</a>
          <div class="text-sm text-zinc-500">${esc(i.description || "") || "—"}</div></div>
          <button id="sr-track" class="${btn}">${i.tracked ? "✓ Tracked" : "Track"}</button></div>
        <div class="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          ${pill("Members", (i.subscribers || 0).toLocaleString())}${pill("Self-promo", esc(i.self_promo || "—"))}
          ${pill("Strictness", esc(i.strictness || "—"))}${pill("Best time", esc(i.best_time || "—"))}</div>
        <div class="mt-4"><b class="text-zinc-900 dark:text-white">Rules</b>
          <div class="mt-2 space-y-1.5 text-sm">${rules.length ? rules.map((x) => `<div>• <b class="text-zinc-900 dark:text-white">${esc(x.name || "")}</b>${x.desc ? ` — <span class="text-zinc-500">${esc(x.desc)}</span>` : ""}</div>`).join("") : `<div class="text-zinc-500">No rules returned — connect Reddit (Connections) for live rules.</div>`}</div></div>
        <div class="mt-4"><b class="text-zinc-900 dark:text-white">Check a draft against r/${esc(i.sub)}</b>
          <textarea id="sr-draft" rows="3" class="mt-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm" placeholder="Paste your reply to check…"></textarea>
          <div class="mt-2"><button id="sr-check" class="${btnP}">Check compliance</button> <span id="sr-cres" class="text-sm"></span></div></div></div>`;
      document.getElementById("sr-track").onclick = async () => {
        const on = !i.tracked; await api.subTrack(sub, !on); i.tracked = on;
        document.getElementById("sr-track").textContent = on ? "✓ Tracked" : "Track"; toast(on ? "Tracked" : "Untracked"); loadList();
      };
      document.getElementById("sr-check").onclick = async () => {
        const t = document.getElementById("sr-draft").value.trim();
        const res = document.getElementById("sr-cres");
        if (!t) { res.textContent = "enter a draft"; return; }
        res.textContent = "Checking…";
        try { const c = await api.subCheck(sub, t); res.innerHTML = c.compliant ? `<span class="text-emerald-500">✓ compliant</span>` : `<span class="text-amber-500">⚠ ${esc(c.notes || "check rules")}</span>`; }
        catch (e) { res.textContent = "failed"; }
      };
      document.getElementById("sr-open").onclick = (e) => { e.preventDefault(); api.openUrl("https://www.reddit.com/r/" + sub).catch(() => toast("Could not open")); };
      icons();
    } catch (e) { d.innerHTML = `<div class="${card} text-rose-500">${esc(e)}</div>`; }
  }

  // fit → {pct 0-100, tier, color}. Backend `fit` is 0-1 (or already a %).
  function srFit(s) {
    const raw = Number(s.fit) || 0;
    const pct = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
    const tier = pct >= 80 ? "best" : pct >= 55 ? "good" : "tangential";
    const color = tier === "best" ? "#10b981" : tier === "good" ? "#f59e0b" : "#a1a1aa";
    return { pct, tier, color };
  }

  // Radial hub-and-spoke graph: niche center → subreddits, size = members,
  // color = fit, ring = tracked. Nodes are clickable (→ load intel).
  function srGraph(subs, niche) {
    const W = 640, H = 340, cx = W / 2, cy = H / 2;
    const nodes = subs.slice(0, 14);
    const N = nodes.length || 1;
    const R = Math.min(130, 64 + N * 7);
    let edges = "", circles = "", labels = "";
    nodes.forEach((s, i) => {
      const ang = (i / N) * 2 * Math.PI - Math.PI / 2;
      const x = cx + Math.cos(ang) * R, y = cy + Math.sin(ang) * R;
      const f = srFit(s);
      const r = Math.max(8, Math.min(22, 8 + Math.log10((Number(s.subscribers) || 100)) * 2.4));
      edges += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${f.color}" stroke-width="1.5" stroke-opacity="0.35"/>`;
      circles += `<g class="cursor-pointer" data-intel="${esc(s.sub)}"><circle cx="${x}" cy="${y}" r="${r}" fill="${f.color}" fill-opacity="0.85"/>${s.tracked ? `<circle cx="${x}" cy="${y}" r="${r + 3}" fill="none" stroke="${f.color}" stroke-width="1.5"/>` : ""}<title>r/${esc(s.sub)} · ${f.pct}% fit</title></g>`;
      const raw = "r/" + s.sub, lbl = raw.length > 16 ? raw.slice(0, 15) + "…" : raw;
      const ly = y > cy ? y + r + 12 : y - r - 7;
      labels += `<text x="${x}" y="${ly}" text-anchor="middle" font-size="10" fill="#71717a" class="pointer-events-none">${esc(lbl)}</text>`;
    });
    const hub = `<circle cx="${cx}" cy="${cy}" r="30" fill="#ff4500"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" class="pointer-events-none">${esc((niche || "You").slice(0, 9))}</text>`;
    return `<div class="${card}"><div class="mb-2 flex flex-wrap items-center justify-between gap-2"><b class="text-zinc-900 dark:text-white">Subreddit map</b>
       <span class="text-xs text-zinc-400">node size = members · color = fit · ring = tracked · click a node for intel</span></div>
       <svg viewBox="0 0 ${W} ${H}" class="w-full" style="max-height:340px">${edges}${circles}${hub}${labels}</svg></div>`;
  }

  // Fit-tier tree: Best / Good / Tangential groups (native <details> = built-in
  // expand/collapse). Each sub row lazily loads its rules + strictness on open.
  function srTree(subs) {
    const byTier = { best: [], good: [], tangential: [] };
    subs.forEach((s) => byTier[srFit(s).tier].push(s));
    const tiers = [["best", "Best fit", "bg-emerald-500"], ["good", "Good fit", "bg-amber-500"], ["tangential", "Tangential", "bg-zinc-400"]];
    return tiers.filter(([k]) => byTier[k].length).map(([k, label, dot]) => {
      const rows = byTier[k].map((s) => {
        const f = srFit(s);
        return `<details data-sub="${esc(s.sub)}" class="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2">
          <summary class="flex cursor-pointer list-none items-center justify-between gap-2">
            <span class="min-w-0 truncate"><b class="text-zinc-900 dark:text-white">r/${esc(s.sub)}</b>
              ${s.tracked ? '<span class="ml-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-500">tracked</span>' : ""}
              <span class="ml-1 text-xs text-zinc-500">${s.subscribers ? Number(s.subscribers).toLocaleString() + " · " : ""}${s.self_promo ? esc(s.self_promo) + " · " : ""}fit ${f.pct}%</span></span>
            <span class="flex shrink-0 gap-1.5">
              <button data-open="${esc(s.sub)}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs font-semibold">Open ↗</button>
              <button data-intel="${esc(s.sub)}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs font-semibold">Intel</button></span>
          </summary>
          <div data-rules class="mt-2 text-sm text-zinc-500">Expand to load rules…</div></details>`;
      }).join("");
      return `<details open class="mb-2"><summary class="cursor-pointer list-none py-1 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        <span class="mr-1.5 inline-block h-2 w-2 rounded-full ${dot} align-middle"></span>${label} <span class="text-zinc-400">(${byTier[k].length})</span></summary>
        <div class="mt-1 space-y-1.5">${rows}</div></details>`;
    }).join("");
  }

  // ── Skeleton loaders (hoisted fn declarations so the initial innerHTML can
  //    call them before loadList runs). ──
  function srSkelBar(w, h = "h-4") { return `<div class="${h} ${w} animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"></div>`; }
  function srSkelMap() { return `<div class="${card}">${srSkelBar("w-28")}<div class="mt-4 flex h-56 items-center justify-center"><div class="h-40 w-40 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800"></div></div></div>`; }
  function srSkelTree() { return Array.from({ length: 4 }).map(() => `<div class="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2.5">${srSkelBar("w-44", "h-3.5")}<div class="flex shrink-0 gap-1.5"><div class="h-6 w-14 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800"></div><div class="h-6 w-12 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800"></div></div></div>`).join(""); }
  function srSkelIntel(sub) { return `<div class="${card}"><div class="flex items-center justify-between gap-4">${srSkelBar("w-36", "h-5")}<div class="h-7 w-16 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800"></div></div><div class="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">${Array.from({ length: 4 }).map(() => `<div>${srSkelBar("w-12", "h-2.5")}<div class="mt-1.5">${srSkelBar("w-16")}</div></div>`).join("")}</div><div class="mt-4 space-y-2">${["w-3/4", "w-2/3", "w-1/2"].map((w) => srSkelBar(w, "h-3.5")).join("")}</div><div class="mt-3 text-xs text-zinc-400">Fetching r/${esc(sub)} intel…</div></div>`; }

  // Live filter over the user's subreddit tree.
  function srFilter() {
    const q = (document.getElementById("sr-filter")?.value || "").trim().toLowerCase();
    const tree = document.getElementById("sr-tree"); if (!tree) return;
    tree.querySelectorAll("details[data-sub]").forEach((d) => { d.style.display = (!q || d.getAttribute("data-sub").toLowerCase().includes(q)) ? "" : "none"; });
    tree.querySelectorAll(":scope > details").forEach((grp) => { const any = [...grp.querySelectorAll("details[data-sub]")].some((d) => d.style.display !== "none"); grp.style.display = any ? "" : "none"; });
  }

  async function loadList() {
    const tree = document.getElementById("sr-tree");
    const map = document.getElementById("sr-map");
    if (tree) tree.innerHTML = srSkelTree();
    if (map) map.innerHTML = srSkelMap();
    try {
      const r = await api.subList();
      const subs = r?.subreddits || [];
      if (!subs.length) {
        map.innerHTML = "";
        tree.innerHTML = `<div class="${card} text-zinc-500">No subs yet — click "✨ Discover subs" (needs Reddit connected for results).</div>`;
        return;
      }
      let niche = ""; try { niche = (await api.agentGet())?.name || ""; } catch (e) { console.error(e); }
      map.innerHTML = srGraph(subs, niche);
      tree.innerHTML = srTree(subs);
      // Intel (graph nodes + tree rows) → load detail at top.
      [map, tree].forEach((root) => {
        root.querySelectorAll("[data-intel]").forEach((b) => b.onclick = (e) => {
          e.preventDefault(); e.stopPropagation();
          document.getElementById("sr-q").value = b.getAttribute("data-intel");
          runIntel(); window.scrollTo({ top: 0, behavior: "smooth" });
        });
        root.querySelectorAll("[data-open]").forEach((b) => b.onclick = (e) => {
          e.preventDefault(); e.stopPropagation();
          api.openUrl("https://www.reddit.com/r/" + b.getAttribute("data-open")).catch(() => toast("Could not open"));
        });
      });
      // Lazy-load rules when a tree row is expanded.
      tree.querySelectorAll("details[data-sub]").forEach((d) => d.addEventListener("toggle", async () => {
        if (!d.open) return;
        const box = d.querySelector("[data-rules]");
        if (!box || box.dataset.loaded) return;
        box.dataset.loaded = "1"; box.textContent = "Loading rules…";
        try {
          const i = await api.subIntel(d.getAttribute("data-sub"), false);
          const rules = i?.rules || [];
          const meta = [i?.strictness ? `strictness: <b class="text-zinc-700 dark:text-zinc-300">${esc(i.strictness)}</b>` : "", i?.best_time ? `best time: <b class="text-zinc-700 dark:text-zinc-300">${esc(i.best_time)}</b>` : ""].filter(Boolean).join(" · ");
          box.innerHTML = (meta ? `<div class="mb-1 text-xs text-zinc-500">${meta}</div>` : "") +
            (rules.length ? rules.map((x) => `<div>• <b class="text-zinc-700 dark:text-zinc-300">${esc(x.name || "")}</b>${x.desc ? ` — ${esc(x.desc)}` : ""}</div>`).join("") : '<div>No rules returned — connect Reddit (Connections) for live rules.</div>');
        } catch (e) { box.textContent = "Could not load rules."; box.dataset.loaded = ""; }
      }));
      const filt = document.getElementById("sr-filter");
      if (filt) { filt.oninput = srFilter; srFilter(); }
      icons();
    } catch (e) { tree.innerHTML = `<div class="${card} text-rose-500">${esc(e)}</div>`; }
  }
  loadList();
}

// ── Pricing / Plans ─────────────────────────────────────────────────────────
const PRICE_TIERS = [
  { id: "free", name: "Free / Self-host", price: "$0", tag: "open-source", feats: ["Unlimited agents, keywords, subs", "No scan / reply / post caps", "All platforms · MCP / CLI / API", "Manual posting (review gate)"], cta: "Start free", href: "#/agents", primary: true },
  { id: "solo", name: "Solo (hosted)", price: "$19", per: "/mo", feats: ["Managed cloud (no setup)", "Real-time inbox alerts", "Analytics + AI Visibility", "1 seat"], cta: "Upgrade", hosted: true },
  { id: "business", name: "Business", price: "$99", per: "/mo", feats: ["Slack/email alerts", "Scheduling & queue", "3 seats · approvals", "Priority support"], cta: "Upgrade", hosted: true },
  { id: "team", name: "Team / Agency", price: "$299", per: "/mo", feats: ["Unlimited seats & agents", "Roles · audit log", "SSO · SLA", "Dedicated support"], cta: "Contact", hosted: true },
];
const PRICE_COMPARE = [
  ["Open-source / self-host", "✓", "✗", "✗"],
  ["BYOK, no caps", "✓", "lifetime only; capped", "✗ (credits)"],
  ["Multi-platform reply", "✓ 9+", "Reddit only", "Reddit only"],
  ["Subreddit intel + ban-safety", "✓", "✓", "partial"],
  ["Self-learning agent", "✓", "✗", "✗"],
  ["AI Visibility (GEO)", "✓", "✗", "✗"],
  ["Entry price", "$0", "$49/mo", "$19–$30/mo"],
];
export async function renderPricing(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  const cur = (id) => id === "free" || id === "self-host";

  const cards = PRICE_TIERS.map(t => {
    const mine = cur(t.id);
    const cta = t.href
      ? `<a href="${t.href}" class="mt-4 block rounded-full bg-reddit px-3 py-2 text-center text-sm font-semibold text-white hover:bg-reddit-hi">${t.cta}</a>`
      : `<button data-up="${t.id}" ${mine ? "disabled" : ""} class="mt-4 block w-full rounded-full ${mine ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 cursor-default" : "border border-zinc-200 dark:border-zinc-700 hover:border-reddit hover:text-reddit"} px-3 py-2 text-sm font-semibold">${mine ? "✓ Current plan" : t.cta + " ↗"}</button>`;
    return `<div class="rounded-xl border-2 ${t.primary ? "border-reddit" : mine ? "border-emerald-500/50" : "border-zinc-200 dark:border-zinc-800"} bg-white dark:bg-zinc-900 p-5">
      <div class="flex items-center justify-between"><b class="text-zinc-900 dark:text-white">${esc(t.name)}</b>${mine ? '<span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">your plan</span>' : t.tag ? `<span class="rounded bg-reddit/15 px-2 py-0.5 text-xs font-bold text-reddit">${esc(t.tag)}</span>` : ""}</div>
      <div class="my-2 text-3xl font-extrabold text-zinc-900 dark:text-white">${t.price}${t.per ? `<span class="text-sm text-zinc-400">${t.per}</span>` : ""}</div>
      <ul class="list-disc space-y-1.5 pl-5 text-sm text-zinc-500 dark:text-zinc-400">${t.feats.map(f => `<li>${esc(f)}</li>`).join("")}</ul>${cta}</div>`;
  }).join("");

  const compareRows = PRICE_COMPARE.map(([label, a, b, c]) => {
    const cell = (v) => v === "✓" || v.startsWith("✓") ? `<span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">${esc(v)}</span>` : `<span class="text-zinc-${v === "✗" ? "400" : "500"}">${esc(v)}</span>`;
    return `<tr><td class="py-2.5">${esc(label)}</td><td>${cell(a)}</td><td>${cell(b)}</td><td>${cell(c)}</td></tr>`;
  }).join("");

  view.innerHTML = head("Plans", "Open-source & self-host free. Hosted plans add convenience — never caps.") +
    `<p class="mb-5 rounded-lg bg-reddit/10 px-3 py-2 text-sm text-reddit"><i data-lucide="key-round" class="inline-block h-4 w-4 align-[-2px]"></i> <b>Every tier is bring-your-own-key.</b> Model cost runs on your own key — so unlike ReplyDaddy/ReplyGuy we put <b>no caps</b> on scans, replies, or generated posts.</p>
     <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">${cards}</div>
     <div class="mt-5 overflow-hidden ${card}"><b class="text-zinc-900 dark:text-white">How we compare</b>
       <table class="mt-3 w-full text-sm"><thead><tr class="text-left text-xs uppercase tracking-wide text-zinc-400"><th class="py-2"></th><th class="py-2">OpenReply</th><th class="py-2">ReplyDaddy</th><th class="py-2">ReplyGuy / Reppit</th></tr></thead>
         <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800/70">${compareRows}</tbody></table></div>`;

  view.querySelectorAll("[data-up]").forEach(b => b.onclick = () => {
    toast("Hosted plans are coming — you’re on Free/self-host with no caps.");
  });
  icons();
}

// ── Brain (unified knowledge graph + tree) ──────────────────────────────────
const BRAIN_COLORS = {
  belief: "#a855f7", memory: "#6366f1", painpoint: "#ef4444", product: "#10b981",
  user: "#f59e0b", source: "#0ea5e9", post: "#9ca3af", wish: "#ec4899",
  workaround: "#14b8a6", topic: "#64748b", concept: "#94a3b8",
};
const _bc = (g) => BRAIN_COLORS[g] || BRAIN_COLORS.concept;

// Canvas force-directed graph. Returns a stop() fn. onPick(node|null) on click.
function forceGraph(canvas, graph, onPick) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 800, H = canvas.clientHeight || 520;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  const deg = {};
  graph.edges.forEach((e) => { deg[e.src] = (deg[e.src] || 0) + 1; deg[e.dst] = (deg[e.dst] || 0) + 1; });
  const N = graph.nodes.map((n, i) => {
    const ang = (i / graph.nodes.length) * Math.PI * 2;
    return { ...n, x: W / 2 + Math.cos(ang) * 180 + (i % 7) * 3, y: H / 2 + Math.sin(ang) * 180 + (i % 5) * 3,
      vx: 0, vy: 0, r: 4 + Math.min(10, (deg[n.id] || 0) * 0.7) };
  });
  const idx = {}; N.forEach((n, i) => idx[n.id] = i);
  const E = graph.edges.map((e) => ({ a: idx[e.src], b: idx[e.dst], kind: e.kind, w: e.weight }))
    .filter((e) => e.a != null && e.b != null);
  const nbrs = {};
  E.forEach((e) => { (nbrs[e.a] = nbrs[e.a] || new Set()).add(e.b); (nbrs[e.b] = nbrs[e.b] || new Set()).add(e.a); });
  let alpha = 1, raf = 0, drag = null, sel = null, hover = null;
  const isNeighbor = (n) => sel && nbrs[idx[sel.id]] && nbrs[idx[sel.id]].has(idx[n.id]);
  const tick = () => {
    alpha *= 0.985;
    for (let i = 0; i < N.length; i++) {
      const a = N[i];
      for (let j = i + 1; j < N.length; j++) {
        const b = N[j]; let dx = a.x - b.x, dy = a.y - b.y; let d2 = dx * dx + dy * dy || 1;
        const f = (1600 / d2) * alpha; const d = Math.sqrt(d2);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      a.vx += (W / 2 - a.x) * 0.002 * alpha; a.vy += (H / 2 - a.y) * 0.002 * alpha;
    }
    for (const e of E) {
      const a = N[e.a], b = N[e.b]; let dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 70) * 0.02 * alpha; const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
    for (const a of N) {
      if (a === drag) continue;
      a.vx *= 0.85; a.vy *= 0.85; a.x += a.vx; a.y += a.vy;
      a.x = Math.max(a.r, Math.min(W - a.r, a.x)); a.y = Math.max(a.r, Math.min(H - a.r, a.y));
    }
    draw();
    if (alpha > 0.02 || drag) raf = requestAnimationFrame(tick);
  };
  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    const isDark = document.documentElement.classList.contains("dark");
    for (const e of E) {
      const a = N[e.a], b = N[e.b]; const cross = e.kind === "grounds" || e.kind === "about" || e.kind === "concludes";
      ctx.strokeStyle = cross ? "rgba(168,85,247,0.35)" : (isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)");
      ctx.lineWidth = cross ? 1.2 : 0.7; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (const n of N) {
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = _bc(n.group); ctx.globalAlpha = (sel && sel !== n && !isNeighbor(n)) ? 0.25 : 1;
      ctx.fill();
      if (n === sel || n === hover) { ctx.lineWidth = 2; ctx.strokeStyle = isDark ? "#fff" : "#111"; ctx.stroke(); }
      ctx.globalAlpha = 1;
      if (n.r >= 8 || n === sel || n === hover) {
        ctx.fillStyle = isDark ? "#d4d4d8" : "#3f3f46"; ctx.font = "11px ui-sans-serif, system-ui";
        ctx.fillText((n.label || "").slice(0, 22), n.x + n.r + 3, n.y + 3);
      }
    }
  };
  const at = (mx, my) => { for (let i = N.length - 1; i >= 0; i--) { const n = N[i]; if ((mx - n.x) ** 2 + (my - n.y) ** 2 <= (n.r + 3) ** 2) return n; } return null; };
  const pos = (ev) => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  canvas.onmousedown = (ev) => { const [x, y] = pos(ev); drag = at(x, y); if (drag) { sel = drag; onPick && onPick(sel); alpha = Math.max(alpha, 0.3); if (!raf) raf = requestAnimationFrame(tick); } };
  canvas.onmousemove = (ev) => { const [x, y] = pos(ev); if (drag) { drag.x = x; drag.y = y; drag.vx = drag.vy = 0; } else { const h = at(x, y); if (h !== hover) { hover = h; canvas.style.cursor = h ? "pointer" : "default"; draw(); } } };
  window.addEventListener("mouseup", () => { drag = null; });
  canvas.onclick = (ev) => { const [x, y] = pos(ev); const n = at(x, y); if (!n) { sel = null; onPick && onPick(null); draw(); } };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export async function renderBrain(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = head("Brain", "Loading the unified brain…") + `<div id="br">Loading…</div>`;
  let b = null; try { b = await api.agentBrain(); } catch (e) { console.error(e); }
  const wrap = document.getElementById("br");
  if (b === null) { wrap.outerHTML = `<div class="${card} text-zinc-500">Run inside the app to see the brain.</div>`; return; }
  if (b.error) { wrap.outerHTML = `<div class="${card} text-zinc-500">${esc(b.error)} <a class="text-reddit underline" href="#/agents">Agents →</a></div>`; return; }
  const s = b.stats || { nodes: 0, edges: 0, cross_links: 0, personas: 0, by_group: {} };
  let stop = null;
  view.innerHTML =
    head("Brain <span class='text-base font-normal text-zinc-400'>(unified)</span>",
      `One connected mind: structural graph + ${s.personas} persona brain(s) + beliefs, merged.`,
      `<div class="flex gap-2">
        <div class="inline-flex rounded-full border border-zinc-200 dark:border-zinc-700 p-0.5 text-sm font-semibold">
          <button id="br-g" class="rounded-full px-3 py-1.5 bg-reddit text-white">Graph</button>
          <button id="br-t" class="rounded-full px-3 py-1.5 text-zinc-500">Tree</button></div>
        <button id="br-relink" class="${btnP}">Rebuild</button></div>`) +
    `<div class="mb-3 flex flex-wrap gap-3 text-xs text-zinc-500">${Object.entries(s.by_group || {}).map(([g, n]) =>
      `<span class="inline-flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-full" style="background:${_bc(g)}"></span>${esc(g)} ${n}</span>`).join("")}
      <span class="inline-flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-full bg-fuchsia-500"></span>cross-links ${s.cross_links}</span></div>
     <div id="br-body"></div>`;
  icons();

  const body = document.getElementById("br-body");
  const setMode = (m) => {
    document.getElementById("br-g").className = `rounded-full px-3 py-1.5 ${m === "g" ? "bg-reddit text-white" : "text-zinc-500"}`;
    document.getElementById("br-t").className = `rounded-full px-3 py-1.5 ${m === "t" ? "bg-reddit text-white" : "text-zinc-500"}`;
    if (stop) { stop(); stop = null; }
    if (m === "g") {
      body.innerHTML = `<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr),18rem]">
        <div class="${card} !p-0 overflow-hidden"><canvas id="br-canvas" class="block h-[520px] w-full"></canvas></div>
        <div id="br-detail" class="${card} text-sm text-zinc-500">Click a node to inspect it.</div></div>`;
      const detail = document.getElementById("br-detail");
      stop = forceGraph(document.getElementById("br-canvas"), b.graph, (n) => {
        if (!n) { detail.innerHTML = "Click a node to inspect it."; return; }
        detail.innerHTML = `<div class="flex items-center gap-2"><span class="h-3 w-3 rounded-full" style="background:${_bc(n.group)}"></span><b class="text-zinc-900 dark:text-white">${esc(n.group)}</b>${n.lens ? `<span class="text-xs">· ${esc(n.lens)} lens</span>` : ""}</div>
          <p class="mt-2 text-zinc-700 dark:text-zinc-200">${esc(n.label)}</p>
          ${n.excerpt ? `<p class="mt-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 p-2 text-xs">${esc(n.excerpt)}</p>` : ""}
          ${n.confidence != null ? `<div class="mt-2 text-xs">confidence ${(n.confidence).toFixed(2)}</div>` : ""}
          ${n.importance ? `<div class="mt-1 text-xs">importance ${(n.importance).toFixed(2)}</div>` : ""}`;
      });
    } else {
      const t = b.tree || { personas: [], structural: [] };
      body.innerHTML = `<div class="grid gap-4 lg:grid-cols-2">
        <div class="${card}"><b class="text-zinc-900 dark:text-white">Persona brains → beliefs</b>
          <div class="mt-3 space-y-3">${(t.personas || []).map((p) => `<details open>
            <summary class="cursor-pointer font-semibold text-indigo-500">${esc(p.lens)} <span class="text-xs font-normal text-zinc-400">· ${p.memories} memories · ${p.beliefs} beliefs</span></summary>
            <ul class="mt-1 space-y-1 pl-4">${(p.top_beliefs || []).map((bl) => `<li class="text-sm text-zinc-600 dark:text-zinc-300">• ${esc(bl.statement)} <span class="text-xs text-zinc-400">(conf ${(bl.confidence || 0).toFixed(2)}, ${bl.evidence} mem)</span></li>`).join("") || '<li class="text-xs text-zinc-400">No beliefs yet — run Learn.</li>'}</ul></details>`).join("") || '<div class="text-sm text-zinc-500">No linked personas. Link one in Agents.</div>'}</div></div>
        <div class="${card}"><b class="text-zinc-900 dark:text-white">Structural concepts (by connections)</b>
          <div class="mt-3 space-y-1.5">${(t.structural || []).map((n) => `<div class="flex items-center justify-between text-sm">
            <span class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full" style="background:${_bc(BRAIN_COLORS[n.kind] ? n.kind : 'concept')}"></span>${esc(n.label)}</span>
            <span class="text-xs text-zinc-400">${esc(n.kind)} · ${n.degree}</span></div>`).join("") || '<div class="text-sm text-zinc-500">No concepts yet — run Build brain in Knowledge.</div>'}</div></div></div>`;
    }
  };
  document.getElementById("br-g").onclick = () => setMode("g");
  document.getElementById("br-t").onclick = () => setMode("t");
  document.getElementById("br-relink").onclick = async () => {
    const btn = document.getElementById("br-relink"); const prev = btn.textContent; btn.textContent = "Rebuilding…"; btn.disabled = true;
    try { const r = await api.agentBrainRelink(); if (r === null) toast("Run inside the app"); else toast(`Merged: ${r.links} cross-links (${r.about || 0} semantic)`); renderBrain(view); }
    catch (e) { toast("Rebuild failed"); btn.textContent = prev; btn.disabled = false; }
  };
  setMode("g");
}

export async function renderLibrary(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  let a = null; try { a = await api.agentGet(); } catch (e) { console.error(e); }
  if (!a) { view.innerHTML = `<div class="${card}">No active agent. <a class="text-reddit underline" href="#/agents">Create one →</a></div>`; return; }
  const S = { source: "", query: "", limit: 60, rel: "" };
  view.innerHTML = head("Library",
    `Everything <b>${esc(a.name)}</b> has collected about its niche — from every source. Read it, learn from it, turn it into posts.`,
    `<button id="lib-refresh" class="${btn}"><i data-lucide="refresh-cw" class="inline-block h-4 w-4 align-[-2px]"></i> Fetch latest</button>`) +
    `<div class="mb-3 flex flex-wrap items-center gap-2"><input id="lib-q" placeholder="Search collected content…" class="${inputCls} w-64"></div>
     <div id="lib-srcs" class="mb-3 flex flex-wrap gap-2"></div>
     <div id="lib-rel" class="mb-3"></div>
     <div id="lib-list" class="space-y-3">Loading…</div>
     <div id="lib-more" class="mt-4 hidden text-center"><button class="${btn}">Load more</button></div>`;
  const list = view.querySelector("#lib-list");
  const srcsBox = view.querySelector("#lib-srcs");
  async function load(reset = true) {
    if (reset) { S.limit = 60; list.innerHTML = skeleton(); }
    try {
      const r = await api.agentCorpus(S.source || null, S.query || null, S.limit, 0, S.rel || null);
      if (!r || r.error) { list.innerHTML = `<div class="${card} text-rose-500">${esc((r && r.error) || "Couldn't load")}</div>`; return; }
      const total = r.total_all || 0;
      const chips = [["", "All", total]].concat((r.sources || []).map((s) => [s.source, s.source, s.count]));
      srcsBox.innerHTML = chips.map(([k, label, c]) => `<button data-src="${esc(k)}" class="${_chip(k === S.source)}">${esc(label)}${c != null ? ` · ${c}` : ""}</button>`).join("");
      srcsBox.querySelectorAll("[data-src]").forEach((b) => b.onclick = () => { S.source = b.getAttribute("data-src"); load(true); });
      const items = r.items || [];
      const relTag = (it) => it.relevant === 0
        ? `<span class="rounded bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-bold text-rose-500" title="${esc(it.rel_reason || "off-topic")}">not related</span>`
        : it.relevant === 1
          ? `<span class="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-bold text-emerald-500">on-topic</span>`
          : "";
      list.innerHTML = items.length ? items.map((it) => `<div class="${card} ${it.relevant === 0 ? "opacity-60" : ""}">
        <div class="flex flex-wrap items-center gap-2"><span class="rounded ${platformBadge(it.source)} px-1.5 py-0.5 text-[11px] font-bold">${esc(it.source || "")}</span>
          ${relTag(it)}
          ${it.sub ? `<span class="text-xs text-zinc-500">${esc(it.sub)}</span>` : ""}
          ${it.created_utc ? `<span class="text-xs text-zinc-400">${_ago(it.created_utc)}</span>` : ""}
          ${it.score ? `<span class="text-xs text-zinc-400">↑${it.score}</span>` : ""}</div>
        <div class="mt-1 font-semibold text-zinc-900 dark:text-white">${esc(it.title || "(untitled)")}</div>
        ${it.snippet ? `<div class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">${esc(it.snippet)}</div>` : ""}
        <div class="mt-2 flex flex-wrap gap-3 text-xs">
          ${it.url ? `<a href="${esc(it.url)}" target="_blank" class="font-semibold text-reddit">Open ↗</a>` : ""}
          <a href="#/compose" class="font-semibold text-zinc-500 hover:text-reddit">Use in Compose →</a></div></div>`).join("")
        : `<div class="${card} text-zinc-500">${(S.query || S.source) ? "No matching content." : "Nothing collected yet — click <b>Fetch latest</b> (or Refresh + learn on Overview)."}</div>`;
      // Relevance gate banner — counts + an LLM-check action for unchecked posts.
      const rel = r.relevance || { on_topic: 0, off_topic: 0, unchecked: 0 };
      const relBox = view.querySelector("#lib-rel");
      if (relBox) {
        const relPill = (key, label, n, cls) => `<button data-rel="${key}" class="rounded-full px-2.5 py-1 text-xs font-semibold ${S.rel === key ? "bg-reddit text-white" : cls}">${label} ${n}</button>`;
        relBox.innerHTML = `<div class="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm">
          <span class="font-semibold text-zinc-700 dark:text-zinc-200">Relevance</span>
          ${relPill("", "all", rel.on_topic + rel.off_topic + rel.unchecked, "text-zinc-500")}
          ${relPill("on", "on-topic", rel.on_topic, "text-emerald-500 bg-emerald-500/10")}
          ${relPill("off", "not related", rel.off_topic, "text-rose-500 bg-rose-500/10")}
          ${relPill("unchecked", "unchecked", rel.unchecked, "text-zinc-400 bg-zinc-500/10")}
          ${rel.unchecked > 0
            ? `<button id="lib-check" class="${btnP} ml-auto px-3 py-1.5 text-xs">Check ${rel.unchecked} with AI</button>`
            : `<span class="ml-auto text-xs text-zinc-400">${(rel.on_topic + rel.off_topic) ? "all checked ✓" : ""}</span>`}</div>`;
        relBox.querySelectorAll("[data-rel]").forEach((b) => b.onclick = () => { S.rel = b.getAttribute("data-rel"); load(true); });
        const cb = view.querySelector("#lib-check");
        if (cb) cb.onclick = async () => {
          cb.textContent = "Checking… (a moment)"; cb.disabled = true;
          try {
            const res = await api.agentCorpusCheck(60);
            if (res === null) toast("Run inside the app to check");
            else if (res.error) toast(res.error);
            else toast(`Checked ${res.checked}: ${res.relevant} on-topic, ${res.off_topic} not related`);
            load(true);
          } catch (e) { toast("Check failed"); cb.disabled = false; cb.textContent = "Check with AI"; }
        };
      }
      view.querySelector("#lib-more").classList.toggle("hidden", items.length < S.limit);
      icons();
    } catch (e) { list.innerHTML = `<div class="${card} text-rose-500">${esc(e)}</div>`; }
  }
  view.querySelector("#lib-q").oninput = debounce((e) => { S.query = e.target.value.trim(); load(true); });
  view.querySelector("#lib-more").querySelector("button").onclick = () => { S.limit += 60; load(true); };
  view.querySelector("#lib-refresh").onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; const html = b.innerHTML; b.textContent = "Fetching… (a minute)";
    try { await api.agentRefresh(null, false); toast("Fetched latest"); } catch (err) { toast("Fetch failed"); }
    b.disabled = false; b.innerHTML = html; icons(); load(true);
  };
  load(true);
}

// ── Growth plan (turn the agent's purpose into a strategy) ──────────────────
export async function renderGrowth(view) {
  view.className = "w-full max-w-4xl flex-1 px-8 py-7";
  let a = null; try { a = await api.agentGet(); } catch (e) { console.error(e); }
  view.innerHTML = head("Growth plan",
    `A Reddit-first strategy for <b>${esc(a?.name || "—")}</b>, built from its goal &amp; product.`,
    `<button id="gp-gen" class="${btnP}">⚡ Generate plan</button>`) +
    `<div id="gp-body" class="space-y-4"></div>`;
  const body = view.querySelector("#gp-body");
  const li = (arr) => (arr || []).map((x) => `<li>${esc(typeof x === "string" ? x : (x.text || JSON.stringify(x)))}</li>`).join("");
  function render(plan) {
    if (!plan) {
      body.innerHTML = `<div class="${card} text-zinc-500">No plan yet. Give this agent a <b>Goal</b> + <b>Product</b> (create or edit the agent), then click <b>Generate plan</b>.</div>`;
      return;
    }
    const comm = (plan.target_communities || []).map((c) =>
      `<div class="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2"><b class="text-zinc-900 dark:text-white">${esc(c.sub ? "r/" + c.sub : "")}</b><div class="text-sm text-zinc-500">${esc(c.why || "")}</div></div>`).join("");
    const sect = (t, inner) => inner ? `<div class="${card}"><div class="mb-1 text-sm font-semibold text-zinc-900 dark:text-white">${t}</div>${inner}</div>` : "";
    body.innerHTML =
      (plan.summary ? `<div class="${card}"><div class="text-sm font-semibold text-zinc-900 dark:text-white">Strategy</div><p class="mt-1 text-zinc-600 dark:text-zinc-300">${esc(plan.summary)}</p></div>` : "") +
      sect("Target communities", comm ? `<div class="grid gap-2 sm:grid-cols-2">${comm}</div>` : "") +
      sect("Messaging angles", plan.angles?.length ? `<ul class="ml-4 list-disc space-y-1 text-zinc-600 dark:text-zinc-300">${li(plan.angles)}</ul>` : "") +
      (plan.cadence ? `<div class="${card}"><div class="text-sm font-semibold text-zinc-900 dark:text-white">Cadence</div><p class="mt-1 text-zinc-600 dark:text-zinc-300">${esc(plan.cadence)}</p></div>` : "") +
      sect("KPIs", plan.kpis?.length ? `<ul class="ml-4 list-disc space-y-1 text-zinc-600 dark:text-zinc-300">${li(plan.kpis)}</ul>` : "") +
      sect("First steps", plan.first_steps?.length ? `<ol class="ml-4 list-decimal space-y-1 text-zinc-600 dark:text-zinc-300">${li(plan.first_steps)}</ol>` : "");
    icons();
  }
  async function load() {
    body.innerHTML = `<div class="${card} text-zinc-500">Loading…</div>`;
    try { const r = await api.replyGrowthGet(); render(r?.plan); }
    catch (e) { body.innerHTML = `<div class="${card} text-rose-500">${esc(e)}</div>`; }
  }
  view.querySelector("#gp-gen").onclick = async () => {
    const b = view.querySelector("#gp-gen"); const t = b.textContent; b.textContent = "Generating… (~10s)"; b.disabled = true;
    try { const r = await api.replyGrowthPlan(); if (r?.error) toast(r.error); else { toast("Growth plan generated"); render(r.plan); } }
    catch (e) { toast("Failed: " + e); }
    b.textContent = t; b.disabled = false;
  };
  load();
}

export async function renderWatch(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  let a = null; try { a = await api.agentGet(); } catch (e) { console.error(e); }
  if (!a) { view.innerHTML = `<div class="${card}">No active agent. <a class="text-reddit underline" href="#/agents">Create one →</a></div>`; return; }
  view.innerHTML = head("Watch accounts",
    `Track creators & competitors on X — their posts are automatically saved to <b>${esc(a.name)}</b>'s Library corpus so you can learn, search, and repurpose.`,
    `<button id="wa-all" class="${btnP}"><i data-lucide="download" class="inline-block h-4 w-4 align-[-2px]"></i> Fetch all + learn</button>
     <a href="#/library" class="${btn}">See all in Library →</a>`) +
    `<div class="mb-4 ${card}"><div class="flex flex-wrap items-end gap-3">
       <label class="flex-1 text-sm text-zinc-500">Add an X account<input id="wa-handle" placeholder="@naval  or  x.com/naval" class="mt-1 block w-full ${inputCls}"></label>
       <button id="wa-add" class="${btnP}">Track</button></div>
       <p class="mt-2 text-xs text-zinc-400"><b>What this is:</b> competitor/creator tracking. Add any X handle and we pull their recent posts into this agent's Library corpus. You can see everything in <a href="#/library" class="text-reddit">Library</a>. Needs an X connection in <a href="#/connections" class="text-reddit">Connections</a>.</p>
       <div id="wa-msg" class="mt-2 text-sm"></div></div>
     <div id="wa-list" class="space-y-3">Loading…</div>`;
  const list = view.querySelector("#wa-list");
  async function load() {
    try {
      const accts = (await api.accountList())?.accounts || [];
      list.innerHTML = accts.length ? accts.map((c) => `<div class="${card}" data-row="${esc(c.handle)}">
        <div class="flex items-center justify-between gap-3">
          <div><a href="https://x.com/${esc(c.handle)}" target="_blank" class="font-semibold text-zinc-900 dark:text-white">@${esc(c.handle)}</a>
            ${c.note ? `<span class="ml-2 text-xs text-zinc-400">${esc(c.note)}</span>` : ""}
            <div class="text-xs text-zinc-400">${c.posts_count ? `${c.posts_count} posts pulled` : "not fetched yet"}${c.last_fetched_at ? ` · ${_ago(c.last_fetched_at)}` : ""}</div></div>
          <div class="flex gap-2">
            <button data-act="fetch" data-h="${esc(c.handle)}" class="${btn}">Fetch posts</button>
            <button data-act="untrack" data-h="${esc(c.handle)}" class="${btn} text-rose-500">Untrack</button></div></div>
        <div data-samp="${esc(c.handle)}" class="mt-2 space-y-1"></div></div>`).join("")
        : `<div class="${card} text-zinc-500">No accounts tracked yet — add an X handle above.</div>`;
      list.querySelectorAll("[data-act]").forEach((b) => b.onclick = () => waAction(b));
      icons();
    } catch (e) { list.innerHTML = `<div class="${card} text-rose-500">${esc(e)}</div>`; }
  }
  async function waAction(b) {
    const act = b.getAttribute("data-act"), h = b.getAttribute("data-h");
    if (act === "untrack") { try { await api.accountUntrack(h); toast("Untracked @" + h); load(); } catch (e) { toast("Failed"); } return; }
    if (act === "fetch") {
      b.disabled = true; const t = b.textContent; b.textContent = "Fetching…";
      try {
        const r = await api.accountFetch(h, false);
        const samp = list.querySelector(`[data-samp="${CSS.escape(h)}"]`);
        if (r?.error) { if (samp) samp.innerHTML = `<div class="text-xs text-rose-500">${esc(r.error)}</div>`; }
        else if (!r?.fetched) {
          if (samp) samp.innerHTML = `<div class="text-xs text-amber-600">${esc(r.message || "No posts returned")} — <a href="#/connections" class="underline">Connect X →</a></div>`;
        } else {
          toast(r.message || `Pulled ${r.fetched || 0}`);
          const _rp = (s) => { sessionStorage.setItem("or-repurpose-ctx", JSON.stringify({title: s.title, text: s.text || s.title})); location.hash = "#/compose"; };
          if (samp) {
            samp.innerHTML = (r.sample || []).map((s, i) =>
              `<div class="flex items-start gap-2 text-sm text-zinc-500">
                 <span class="shrink-0">•</span>
                 <span class="flex-1 min-w-0">${esc(s.title)}${s.url ? ` <a href="${esc(s.url)}" target="_blank" class="text-reddit">↗</a>` : ""}</span>
                 <button data-rp="${i}" class="shrink-0 text-xs font-semibold text-reddit hover:underline">Create post →</button>
               </div>`).join("")
              + `<div class="mt-2 flex gap-3"><button data-rp-all="1" class="text-xs font-semibold text-reddit hover:underline">Open Compose (repurpose all) →</button><a href="#/library" class="text-xs font-semibold text-reddit hover:underline">See all in Library →</a></div>`;
            samp.querySelectorAll("[data-rp]").forEach((btn) => {
              const idx = Number(btn.getAttribute("data-rp"));
              const s = (r.sample || [])[idx] || {};
              btn.onclick = () => _rp(s);
            });
            samp.querySelector("[data-rp-all]")?.addEventListener("click", () => {
              const allText = (r.sample || []).map(s => s.title).join("\n");
              _rp({title: `Posts from @${h}`, text: allText});
            });
          }
        }
        load();
      } catch (e) { toast("Fetch failed"); }
      b.disabled = false; b.textContent = t;
    }
  }
  view.querySelector("#wa-add").onclick = async () => {
    const inp = view.querySelector("#wa-handle"); const msg = view.querySelector("#wa-msg");
    const h = (inp.value || "").trim();
    if (!h) { msg.innerHTML = `<span class="text-amber-500">Enter a handle.</span>`; return; }
    try { await api.accountTrack(h); inp.value = ""; toast("Tracking " + h); load(); }
    catch (e) { msg.innerHTML = `<span class="text-rose-500">${esc(e)}</span>`; }
  };
  view.querySelector("#wa-all").onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; const html = b.innerHTML; b.textContent = "Fetching all…";
    try { const r = await api.accountFetch(null, true); toast(`Pulled ${r.fetched || 0} posts from ${r.accounts || 0} accounts`); }
    catch (err) { toast("Fetch failed"); }
    b.disabled = false; b.innerHTML = html; icons(); load();
  };
  load();
}

// ── Minimal X-account worktree screen ─────────────────────────────────────
export async function renderXAccount(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = head("X Account",
    `Connect an X account to browse its timeline and threads. Posts stay private here unless you click <b>Save to Library</b> — then they appear in <a href="#/library" class="text-reddit underline">Library</a> for search, learning, and repurpose.`,
    `<button id="xa-add-btn" class="${btnP}">+ Add account</button>
     <button id="xa-import-btn" class="ml-2 ${btn}">Import from browser</button>
     <a href="#/library" class="ml-2 ${btn}">See all in Library →</a>`) +
    `<div id="xa-form" class="hidden mb-5 ${card}"></div>
     <div id="xa-import-msg" class="hidden mb-2 text-sm text-zinc-500"></div>
     <div id="xa-accounts" class="${card} mb-5"><div class="text-zinc-500">Loading accounts…</div></div>
     <div id="xa-output" class="${card}"><div class="text-zinc-500">Select an account to see profile/posts.</div></div>`;

  const form = document.getElementById("xa-form");
  document.getElementById("xa-add-btn").onclick = () => {
    form.classList.toggle("hidden");
    if (!form.innerHTML) renderAddForm();
  };

  document.getElementById("xa-import-btn").onclick = async () => {
    const msg = document.getElementById("xa-import-msg");
    const handle = window.prompt("X handle to import cookies for (no @):");
    if (!handle) return;
    msg.classList.remove("hidden");
    msg.textContent = "Importing cookies from browser…";
    try {
      await api.xAccountImportBrowser(handle);
      toast("Cookies imported");
      msg.textContent = "";
      loadAccounts();
    } catch (e) {
      msg.textContent = "Import failed: " + e;
    }
  };

  function field(id, label, placeholder) {
    return `<div><label class="mb-1 block text-xs font-semibold text-zinc-500">${esc(label)}</label>
            <input id="${id}" type="text" placeholder="${esc(placeholder)}" class="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-1 focus:ring-reddit dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"></div>`;
  }

  function renderAddForm() {
    form.innerHTML = `
      <h3 class="mb-3 font-semibold text-zinc-900 dark:text-white">Add X account</h3>
      <div class="grid gap-3 sm:grid-cols-2">
        ${field("xa-handle", "Handle (no @)", "elonmusk")}
      </div>
      <p class="mt-2 text-xs text-zinc-400">Just the handle. We'll auto-import your X cookies from the browser if you're logged in to x.com, and fall back to public access otherwise.</p>
      <button id="xa-save" class="mt-4 ${btnP}">Save account</button> <span id="xa-msg" class="text-sm text-zinc-500"></span>`;
    document.getElementById("xa-save").onclick = async () => {
      const handle = document.getElementById("xa-handle").value.trim().replace(/^@/, "");
      const msg = document.getElementById("xa-msg");
      if (!handle) { msg.textContent = "Enter a handle."; return; }
      msg.textContent = "Saving…";
      try {
        const r = await api.xAccountAdd(handle);
        toast(r?.source === "browser" ? "Account saved — cookies imported" : "Account saved");
        form.classList.add("hidden");
        loadAccounts();
      } catch (e) { msg.textContent = "Failed: " + e; }
    };
  }

  async function loadAccounts() {
    const el = document.getElementById("xa-accounts");
    try {
      const res = await api.xAccountList();
      const accounts = res?.accounts || [];
      if (!accounts.length) {
        el.innerHTML = `<div class="text-zinc-500">No accounts. Click “+ Add account” or “Import from browser”.</div>`;
        return;
      }
      el.innerHTML = `<div class="mb-2 text-sm font-semibold text-zinc-500">Stored accounts</div>
        <div class="flex flex-wrap gap-2">${accounts.map(a =>
          `<button data-handle="${esc(a.handle)}" class="xa-acct rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-sm hover:border-reddit hover:text-reddit">@${esc(a.handle)}</button>`
        ).join("")}</div>`;
      el.querySelectorAll(".xa-acct").forEach(b => b.onclick = () => loadAccount(b.dataset.handle));
    } catch (e) { el.innerHTML = `<div class="text-rose-500">${esc(e)}</div>`; }
  }

  async function loadAccount(handle) {
    const out = document.getElementById("xa-output");
    out.innerHTML = `<div class="text-zinc-500">Loading @${esc(handle)}…</div>`;
    try {
      const withThreads = !!document.getElementById("xa-with-threads")?.checked;
      const [profile, posts] = await Promise.all([
        api.xAccountProfile(handle),
        api.xAccountFetchPosts(handle, 10, withThreads),
      ]);
      const p = profile?.profile || {};
      out.innerHTML = `
        <div class="mb-4">
          <div class="text-lg font-bold text-zinc-900 dark:text-white">@${esc(p.handle || handle)}</div>
          <div class="text-zinc-500">${esc(p.name || "")}</div>
          <div class="mt-1 text-sm text-zinc-500">${esc(p.bio || "")}</div>
          <div class="mt-2 flex gap-4 text-sm">
            <span class="font-semibold">${(p.followers || 0).toLocaleString()}</span> followers
            <span class="font-semibold">${(p.following || 0).toLocaleString()}</span> following
            <span class="font-semibold">${(p.tweets || 0).toLocaleString()}</span> tweets
          </div>
        </div>
        <div class="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <label class="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
            <input id="xa-with-threads" type="checkbox" ${withThreads ? "checked" : ""}> Include reply threads
          </label>
          <button id="xa-reload" class="${btn}">Reload</button>
          <button id="xa-save-lib" class="${btnP}">Save to Library</button>
          <a href="#/library" class="text-xs text-reddit hover:underline">See all saved posts →</a>
        </div>
        <div class="mb-4">
          <label class="mb-1 block text-xs font-semibold text-zinc-500">Fetch thread by tweet URL or id</label>
          <div class="flex gap-2">
            <input id="xa-thread-input" type="text" placeholder="https://x.com/elonmusk/status/123... or 123..." class="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-1 focus:ring-reddit dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
            <button id="xa-thread-btn" class="${btnP}">Fetch thread</button>
          </div>
          <div id="xa-thread-msg" class="mt-1 text-sm text-zinc-500"></div>
        </div>
        <div id="xa-posts" class="space-y-3"></div>`;

      document.getElementById("xa-reload").onclick = () => loadAccount(handle);
      document.getElementById("xa-with-threads").onchange = () => loadAccount(handle);
      document.getElementById("xa-save-lib").onclick = async () => {
        const btn = document.getElementById("xa-save-lib");
        btn.disabled = true; const prev = btn.textContent; btn.textContent = "Saving…";
        try {
          const withThreads = !!document.getElementById("xa-with-threads")?.checked;
          const r = await api.xAccountSaveToLibrary(handle, 25, withThreads);
          toast(r?.message || `Saved ${r?.saved || 0} post(s)`);
        } catch (e) { toast("Save failed: " + e); }
        finally { btn.disabled = false; btn.textContent = prev; }
      };
      document.getElementById("xa-thread-btn").onclick = async () => {
        const input = document.getElementById("xa-thread-input").value.trim();
        const tmsg = document.getElementById("xa-thread-msg");
        if (!input) { tmsg.textContent = "Paste a tweet URL or id."; return; }
        tmsg.textContent = "Loading thread…";
        try {
          const res = await api.xAccountFetchThread(handle, input, 50);
          renderPosts(res?.thread || [], "Thread", true, handle);
          tmsg.textContent = `${res?.count || 0} tweets`;
        } catch (e) { tmsg.textContent = "Failed: " + e; }
      };

      renderPosts(posts?.posts || [], "Recent posts", false, handle);
    } catch (e) { out.innerHTML = `<div class="text-rose-500">${esc(e)}</div>`; }
  }

  function renderPosts(posts, title, skipHeader, accountHandle) {
    const container = document.getElementById("xa-posts");
    if (!container) return;
    const html = (skipHeader ? "" : `<div class="mb-2 text-sm font-semibold text-zinc-500">${esc(title)}</div>`) +
      posts.map(t => `
        <div class="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 ${t.is_reply ? "border-l-4 border-l-reddit" : ""}" data-tweet-id="${esc(t.id)}">
          <div class="text-sm text-zinc-900 dark:text-white whitespace-pre-wrap">${esc(t.text)}</div>
          <div class="mt-2 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
            <span>♥ ${t.likes || 0}</span>
            <span>↻ ${t.retweets || 0}</span>
            <span>💬 ${t.replies || 0}</span>
            ${t.is_reply ? "<span>reply</span>" : ""}
            ${t.is_retweet ? "<span>retweet</span>" : ""}
            <a href="${esc(t.url)}" target="_blank" class="hover:text-reddit">open →</a>
            <button data-reply="${esc(t.id)}" class="text-reddit hover:underline font-semibold">Reply</button>
          </div>
          <div data-reply-form="${esc(t.id)}" class="hidden mt-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 p-3">
            <label class="mb-1 block text-xs font-semibold text-zinc-500">Your reply as @${esc(accountHandle || "")}</label>
            <textarea data-reply-text="${esc(t.id)}" rows="3" class="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-1 focus:ring-reddit dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" placeholder="Write your reply…"></textarea>
            <div class="mt-2 flex gap-2">
              <button data-reply-post="${esc(t.id)}" class="${btnP}">Post reply</button>
              <button data-reply-preview="${esc(t.id)}" class="${btn}">Preview</button>
              <button data-reply-cancel="${esc(t.id)}" class="${btn}">Cancel</button>
            </div>
            <div data-reply-msg="${esc(t.id)}" class="mt-2 text-sm"></div>
          </div>
          ${(t.thread || []).length ? `
            <div class="mt-3 space-y-2 border-l-2 border-zinc-200 dark:border-zinc-700 pl-3">
              ${t.thread.map(r => `
                <div class="text-sm text-zinc-700 dark:text-zinc-300">${esc(r.text)}</div>
              `).join("")}
            </div>
          ` : ""}
        </div>
      `).join("");
    container.innerHTML = html;

    // Reply toggles
    container.querySelectorAll("[data-reply]").forEach((btn) => {
      const id = btn.getAttribute("data-reply");
      btn.onclick = () => {
        const form = container.querySelector(`[data-reply-form="${CSS.escape(id)}"]`);
        if (form) form.classList.toggle("hidden");
      };
    });

    // Cancel
    container.querySelectorAll("[data-reply-cancel]").forEach((btn) => {
      const id = btn.getAttribute("data-reply-cancel");
      btn.onclick = () => {
        const form = container.querySelector(`[data-reply-form="${CSS.escape(id)}"]`);
        if (form) form.classList.add("hidden");
      };
    });

    // Preview / Post reply
    container.querySelectorAll("[data-reply-preview], [data-reply-post]").forEach((btn) => {
      const id = btn.getAttribute("data-reply-preview") || btn.getAttribute("data-reply-post");
      const dryRun = btn.hasAttribute("data-reply-preview");
      btn.onclick = async () => {
        const ta = container.querySelector(`[data-reply-text="${CSS.escape(id)}"]`);
        const msg = container.querySelector(`[data-reply-msg="${CSS.escape(id)}"]`);
        const text = (ta?.value || "").trim();
        if (!text) { if (msg) msg.innerHTML = `<span class="text-amber-500">Enter reply text.</span>`; return; }
        btn.disabled = true; const prev = btn.textContent; btn.textContent = dryRun ? "Previewing…" : "Posting…";
        try {
          const r = await api.contentPublishXReply(id, text, dryRun);
          if (r?.ok) {
            if (dryRun) {
              const parts = (r?.tweets || [text]).map(s => `<li class="mt-1">${esc(s)}</li>`).join("");
              if (msg) msg.innerHTML = `<div class="text-emerald-600">Preview (${r?.parts || 1} tweet(s)):</div><ul class="list-disc pl-4 text-zinc-600 dark:text-zinc-300">${parts}</ul>`;
            } else {
              if (msg) msg.innerHTML = `<div class="text-emerald-600">Posted! <a href="${esc(r?.url || "")}" target="_blank" class="underline">View reply →</a></div>`;
              ta.value = "";
            }
          } else {
            if (msg) msg.innerHTML = `<div class="text-rose-500">${esc(r?.error || "Post failed")}</div>`;
          }
        } catch (e) { if (msg) msg.innerHTML = `<div class="text-rose-500">${esc(e)}</div>`; }
        finally { btn.disabled = false; btn.textContent = prev; }
      };
    });
  }

  loadAccounts();
  icons();
}

export const DYN = {
  "x-account": renderXAccount,
  watch: renderWatch,
  growth: renderGrowth,
  library: renderLibrary,
  pricing: renderPricing,
  welcome: renderWelcome,
  agents: renderAgents,
  agent: renderOverview,
  opportunities: renderOpportunities,
  compose: renderCompose,
  connections: renderConnections,
  settings: renderSettings,
  knowledge: renderKnowledge,
  learning: renderLearning,
  brain: renderBrain,
  inbox: renderInbox,
  analytics: renderAnalytics,
  queue: renderQueue,
  keywords: renderKeywords,
  subreddit: renderSubredditFull,
  onboarding: renderOnboarding,
  alerts: renderAlerts,
  geo: renderGeo,
};
