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
// `followup` is a UI pseudo-kind — it expands into followup_reply / followup_post
// based on the sub-mode toggle, and shows a context panel the others don't.
const KINDS = [
  ["post", "Post"], ["thread", "Thread"], ["script", "Short script"],
  ["youtube", "YouTube"], ["article", "Article"], ["followup", "Follow-up"],
];
const _pill = (on) => `rounded-full ${on ? "bg-reddit text-white" : "border border-zinc-200 dark:border-zinc-700"} px-4 py-2 text-sm font-semibold`;
const _field = "mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm";

export async function renderCompose(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  let a = null; try { a = await api.agentGet(); } catch (e) {}
  const platforms = a?.platforms || ["reddit_free"];
  // Drafts usable as the "original" for a sequence follow-up.
  let drafts = []; try { drafts = (await api.contentList(null, null, 30))?.content || []; } catch (e) {}

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
       </div>

       <div class="flex flex-wrap items-end gap-4 text-sm">
         <label class="text-zinc-500">Platform<select id="cm-pf" class="mt-1 block w-44 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2">${platforms.map(p => `<option>${esc(p)}</option>`).join("")}</select></label>
         <label class="flex-1 text-zinc-500">Angle (optional)<input id="cm-angle" placeholder="leave blank to auto-pick" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
         <button id="cm-gen" class="${btnP}"><i data-lucide="sparkles" class="inline-block h-4 w-4 align-[-2px]"></i> Generate</button></div>
       <span id="cm-status" class="text-sm text-zinc-400"></span></div>
     <div id="cm-out"></div>
     <h3 class="mb-3 mt-6 font-semibold text-zinc-900 dark:text-white">Recent drafts</h3>
     <div id="cm-recent" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"></div>`;
  icons();

  let kind = "post";
  let fmode = "reply";
  const ctxPanel = document.getElementById("cm-ctx");
  document.getElementById("cm-kinds").onclick = (e) => {
    const b = e.target.closest("[data-kind]"); if (!b) return;
    kind = b.getAttribute("data-kind");
    [...document.querySelectorAll("#cm-kinds [data-kind]")].forEach(x =>
      x.className = _pill(x === b));
    ctxPanel.classList.toggle("hidden", kind !== "followup");
  };
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

    // Resolve the UI pseudo-kind + gather follow-up context.
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
    "Log in to platforms to unlock authenticated reach. Read-only &amp; account-safe — we never post for you or need your password.") +
    `<p class="mb-5 rounded-lg bg-reddit/10 px-3 py-2 text-sm text-reddit"><i data-lucide="lock" class="inline-block h-4 w-4 align-[-2px]"></i> Credentials are stored locally on this machine only. Connect a platform and it's automatically pulled into your collection runs — toggle "Used in collection" to opt out. Public sources (Hacker News, Dev.to, Mastodon, YouTube) need no login.</p>
     <div id="cn-grid" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><div class="text-zinc-500">Loading connections…</div></div>`;

  const grid = document.getElementById("cn-grid");

  async function load() {
    try {
      const rows = (await api.credsList()) || [];
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
    if (c.kind === "public") {
      actions = `<button data-act="verify" data-src="${s}" class="${btn}">Test reach</button>`;
    } else if (c.kind === "api_key") {
      actions = c.connected
        ? `<button data-act="verify" data-src="${s}" class="${btn}">Verify</button>
           <button data-act="delete" data-src="${s}" class="${btn} text-rose-500">Remove key</button>`
        : `<button data-act="key" data-src="${s}" ${dl} class="${primary}">Add key</button>
           ${c.login_url ? `<button data-act="open" data-url="${esc(c.login_url)}" class="${btn}">Get key ↗</button>` : ""}`;
    } else if (c.kind === "login_pair") {
      actions = c.connected
        ? `<button data-act="verify" data-src="${s}" class="${btn}">Verify</button>
           <button data-act="pair" data-src="${s}" ${dl} class="${btn}">Reconnect</button>
           <button data-act="delete" data-src="${s}" class="${btn} text-rose-500">Disconnect</button>`
        : `${c.login_url ? `<button data-act="open" data-url="${esc(c.login_url)}" class="${btn}">Get app password ↗</button>` : ""}
           <button data-act="pair" data-src="${s}" ${dl} class="${primary}">Add login</button>`;
    } else { // cookie
      actions = c.connected
        ? `<button data-act="verify" data-src="${s}" class="${btn}">Verify</button>
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
    // The use-in-collection toggle only makes sense once the source is reachable.
    const toggleRow = c.connected ? `<div class="mt-2">${connToggle(c)}</div>` : "";
    return `<div class="${card}">
      <div class="flex items-center justify-between"><b class="text-zinc-900 dark:text-white">${esc(c.label)}</b>
        <span class="rounded ${cls} px-2 py-0.5 text-xs font-bold">${label}</span></div>
      <p class="mb-2 mt-2 text-sm text-zinc-500 dark:text-zinc-400">${meta}${verified ? ` · ${verified}` : ""}</p>
      ${noteRow}${unlocksRow}
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
      window.orModal({
        title: (isKey ? "Add API key for " : "Paste cookie for ") + label,
        body: isKey
          ? `<p class="mb-2 text-sm text-zinc-500 dark:text-zinc-400">Paste your API key. Stored locally only.</p>${_connInput("cn-val", "key…", "password")}`
          : `<p class="mb-2 text-sm text-zinc-500 dark:text-zinc-400">Paste the session cookie string (<code>name=value; name2=value2</code>) or a JSON map. Use a Cookie-Editor extension to copy it.</p><textarea id="cn-val" rows="4" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm" placeholder="session=…; csrf=…"></textarea>`,
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
    `<div class="grid gap-4 lg:grid-cols-2">
       <div id="st-license" class="${card} lg:col-span-2"><div class="text-zinc-500">Loading licence…</div></div>
       <div id="st-llm" class="${card}"><div class="text-zinc-500">Loading provider…</div></div>
       <div id="st-appear" class="${card}"></div>
       <div id="st-feeds" class="${card}"><div class="text-zinc-500">Loading feeds…</div></div>
       <div id="st-data" class="${card}"><div class="text-zinc-500">Loading data…</div></div>
     </div>`;
  buildLicenseCard(document.getElementById("st-license"));
  buildLlmCard(document.getElementById("st-llm"));
  buildAppearanceCard(document.getElementById("st-appear"));
  buildFeedsCard(document.getElementById("st-feeds"));
  buildDataCard(document.getElementById("st-data"));
  icons();
}

async function buildLlmCard(el) {
  let st = {};
  try { st = (await api.byokStatus()) || {}; } catch (e) {}
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
  const theme = localStorage.getItem("or-theme") || "system";
  const accent = localStorage.getItem("or-accent") || "reddit";
  const cadence = localStorage.getItem("or-refresh-cadence") || "daily";
  const o = (val, cur, label) => `<option value="${val}"${val === cur ? " selected" : ""}>${label}</option>`;
  el.innerHTML = `
    <b class="text-zinc-900 dark:text-white">Appearance &amp; refresh</b>
    <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Theme also has a quick toggle in the sidebar.</p>
    <label class="block mb-3 text-sm text-zinc-500">Default theme<select id="st-theme" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2">
      ${o("system", theme, "Match system")}${o("dark", theme, "Dark")}${o("light", theme, "Light")}</select></label>
    <label class="block mb-3 text-sm text-zinc-500">Knowledge refresh<select id="st-cadence" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2">
      ${o("daily", cadence, "Daily")}${o("weekly", cadence, "Weekly")}${o("manual", cadence, "Manual only")}</select></label>
    <span id="st-appear-msg" class="text-xs text-zinc-400"></span>`;
  const apply = () => {
    const t = el.querySelector("#st-theme").value;
    localStorage.setItem("or-theme", t);
    localStorage.setItem("or-refresh-cadence", el.querySelector("#st-cadence").value);
    const dark = t === "dark" || (t === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    el.querySelector("#st-appear-msg").textContent = "Saved ✓";
    if (window.refreshIcons) window.refreshIcons();
  };
  el.querySelector("#st-theme").onchange = apply;
  el.querySelector("#st-cadence").onchange = apply;
}

async function buildFeedsCard(el) {
  async function load() {
    let feeds = [];
    try { feeds = (await api.feedsList())?.feeds || []; } catch (e) {}
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
  try { info = (await api.appResetPreview()) || {}; } catch (e) {}
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
          try { localStorage.clear(); } catch (e) {}
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
  try { a = await api.agentGet(); } catch (e) {}
  if (!a) { document.getElementById("kn").innerHTML = `<div class="${card}">No active agent. <a class="text-reddit underline" href="#/agents">Create one →</a></div>`; return; }
  try { k = await api.agentKnowledge(); } catch (e) {}
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
       <p class="mt-3 text-sm text-zinc-500">Last refresh: ${k && k.last_refresh_at ? new Date(k.last_refresh_at * 1000).toLocaleString() : "never"}</p></div>`;
  document.getElementById("kn-refresh").onclick = async (e) => {
    e.target.textContent = "Refreshing…"; e.target.disabled = true;
    try { await api.agentRefresh(null, false); toast("Knowledge refreshed"); renderKnowledge(view); }
    catch (err) { toast("Refresh failed"); e.target.disabled = false; e.target.textContent = "↻ Refresh now"; }
  };
  icons();
}

// ── Inbox (saved opportunities as a mentions feed) ──────────────────────────
export async function renderInbox(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  let a = null; try { a = await api.agentGet(); } catch (e) {}
  view.innerHTML = head("Inbox", `Saved mentions for <b>${esc(a?.name || "—")}</b>, highest score first.`,
    `<a href="#/opportunities" class="${btnP}">⚡ Find more</a>`) + `<div id="ib-list" class="space-y-3">Loading…</div>`;
  const list = document.getElementById("ib-list");
  try {
    const r = await api.replyList(null, 0, 50);
    const opps = r?.opportunities || [];
    list.innerHTML = opps.length ? opps.map(inboxRow).join("")
      : `<div class="${card} text-zinc-500">No saved mentions yet. <a class="text-reddit underline" href="#/opportunities">Find opportunities →</a></div>`;
    list.querySelectorAll("[data-draft]").forEach(b => b.onclick = () => inboxDraft(b, list));
    icons();
  } catch (e) { list.innerHTML = `<div class="${card} text-rose-500">${esc(e)}</div>`; }
}
function inboxRow(o) {
  const s = Math.round((o.score || 0) * 100);
  const pf = o.platform || "";
  const badge = pf.includes("reddit") ? "bg-reddit/15 text-reddit" : pf === "hn" ? "bg-amber-500/15 text-amber-500" : "bg-brand/15 text-brand";
  return `<div class="${card}"><div class="flex items-start justify-between gap-4"><div class="min-w-0">
      <div class="flex items-center gap-2"><span class="rounded ${badge} px-2 py-0.5 text-xs font-bold">${esc(pf)}</span>
        ${o.sub ? `<span class="text-sm text-zinc-500">r/${esc(o.sub)}</span>` : ""}
        <span class="rounded bg-zinc-500/15 px-2 py-0.5 text-xs font-bold text-zinc-400">${esc(o.status || "new")}</span></div>
      <div class="mt-1 font-semibold text-zinc-900 dark:text-white">${esc(o.title || "")}</div>
      ${o.reason ? `<div class="text-sm text-zinc-500 dark:text-zinc-400">${esc(o.reason)}</div>` : ""}</div>
    <div class="flex shrink-0 flex-col items-end gap-1.5"><span class="text-xl font-extrabold ${scoreCls(o.score || 0)}">${s}</span>
      <button data-draft="${esc(o.id)}" class="rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white">Draft reply</button></div></div>
    <div data-slot="${esc(o.id)}"></div></div>`;
}
async function inboxDraft(b, list) {
  const id = b.getAttribute("data-draft");
  const slot = list.querySelector(`[data-slot="${CSS.escape(id)}"]`);
  b.disabled = true; b.textContent = "Drafting…";
  try {
    const d = await api.replyDraft(id);
    slot.innerHTML = d?.error ? `<div class="mt-2 text-sm text-rose-500">${esc(d.error)}</div>`
      : `${d.compliant ? "" : `<div class="mt-2 inline-block rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">⚠ ${esc(d.compliance_notes || "check rules")}</div>`}<textarea rows="5" class="mt-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm">${esc(d.text || "")}</textarea>`;
  } catch (e) { slot.innerHTML = `<div class="mt-2 text-sm text-rose-500">${esc(e)}</div>`; }
  b.disabled = false; b.textContent = "Re-draft";
}

// ── Analytics (derived from saved opportunities + content) ──────────────────
export async function renderAnalytics(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = head("Analytics", "Activity for the active agent.") + `<div id="an">Loading…</div>`;
  let opps = [], content = [];
  try { opps = (await api.replyList(null, 0, 500))?.opportunities || []; } catch (e) {}
  try { content = (await api.contentList(null, null, 500))?.content || []; } catch (e) {}
  const byStatus = (arr, f) => arr.filter((x) => x.status === f).length;
  const group = (arr, key) => { const m = {}; arr.forEach((x) => { const k = x[key] || "—"; m[k] = (m[k] || 0) + 1; }); return m; };
  const kpi = (l, v) => `<div class="${card}"><div class="text-sm text-zinc-500">${l}</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">${v}</div></div>`;
  const rows = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<div class="flex items-center justify-between text-sm"><span>${esc(k)}</span><span class="text-zinc-500">${v}</span></div>`).join("") || `<div class="text-sm text-zinc-500">none</div>`;
  document.getElementById("an").outerHTML =
    `<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
       ${kpi("Opportunities", opps.length)}${kpi("Drafted", byStatus(opps, "drafted"))}
       ${kpi("Content items", content.length)}${kpi("Content drafts", byStatus(content, "draft"))}</div>
     <div class="mt-5 grid gap-4 lg:grid-cols-2">
       <div class="${card}"><b class="text-zinc-900 dark:text-white">Opportunities by platform</b><div class="mt-3 space-y-2">${rows(group(opps, "platform"))}</div></div>
       <div class="${card}"><b class="text-zinc-900 dark:text-white">Content by type</b><div class="mt-3 space-y-2">${rows(group(content, "kind"))}</div></div></div>`;
  icons();
}

// ── Queue (content items by status) ─────────────────────────────────────────
export async function renderQueue(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = head("Queue", "Drafts &amp; scheduled content. Publishing is manual for now.",
    `<a href="#/compose" class="${btn}">+ New content</a>`) + `<div id="q">Loading…</div>`;
  let content = [];
  try { content = (await api.contentList(null, null, 200))?.content || []; } catch (e) {}
  const wrap = document.getElementById("q");
  if (!content.length) { wrap.outerHTML = `<div class="${card} text-zinc-500">No content yet. <a class="text-reddit underline" href="#/compose">Compose →</a></div>`; return; }
  const body = content.map((c) => `<tr class="border-b border-zinc-100 dark:border-zinc-800/60">
      <td class="px-4 py-3"><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">${esc((c.kind || "").replace("_", " "))}</span></td>
      <td class="px-4 py-3">${esc((c.body || "").slice(0, 80))}…</td>
      <td class="px-4 py-3 text-zinc-500">${esc(c.platform || "")}</td>
      <td class="px-4 py-3"><span class="rounded bg-zinc-500/15 px-2 py-0.5 text-xs font-bold text-zinc-400">${esc(c.status || "draft")}</span></td></tr>`).join("");
  wrap.outerHTML = `<div class="overflow-hidden ${card} !p-0"><table class="w-full text-sm"><thead><tr class="text-left text-xs uppercase tracking-wide text-zinc-400">
      <th class="px-4 py-3">Type</th><th class="px-4 py-3">Content</th><th class="px-4 py-3">Platform</th><th class="px-4 py-3">Status</th></tr></thead><tbody>${body}</tbody></table></div>`;
  icons();
}

// ── Keywords (edit the agent's tracked keywords + platforms) ────────────────
export async function renderKeywords(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = `<div id="kw">Loading…</div>`;
  let a = null, platforms = [];
  try { a = await api.agentGet(); } catch (e) {}
  if (!a) { document.getElementById("kw").innerHTML = `<div class="${card}">No active agent. <a class="text-reddit underline" href="#/agents">Create one →</a></div>`; return; }
  try { platforms = (await api.replyPlatforms())?.platforms || []; } catch (e) {}
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
         <div class="mt-3"><b class="text-zinc-900 dark:text-white">Voice</b>
           <input id="kw-persona" value="${esc(a.persona || "")}" placeholder="persona / voice" class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm"></div></div>
       <div class="${card}"><b class="text-zinc-900 dark:text-white">Platforms watched</b>
         <div class="mt-3 grid grid-cols-2 gap-2">${checks}</div></div></div>
     <span id="kw-msg" class="mt-3 inline-block text-sm text-zinc-500"></span>`;
  document.getElementById("kw-save").onclick = async () => {
    const msg = document.getElementById("kw-msg");
    const kws = document.getElementById("kw-list").value;
    const persona = document.getElementById("kw-persona").value.trim();
    const pfs = [...document.querySelectorAll("#kw input[type=checkbox]:checked")].map((c) => c.value);
    msg.textContent = "Saving…";
    try { await api.agentUpdate({ keywords: kws, persona, platforms: pfs.join(",") }); msg.textContent = "Saved ✓"; toast("Keywords saved"); }
    catch (e) { msg.textContent = "Failed: " + e; }
  };
  icons();
}

// ── Subreddit Intelligence (fetch a sub's rules before you post) ────────────
export async function renderSubreddit(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  let a = null; try { a = await api.agentGet(); } catch (e) {}
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
  try { platforms = (await api.replyPlatforms())?.platforms || []; } catch (e) {}
  const checks = platforms.filter((p) => p.can_reply).slice(0, 9).map((p) =>
    `<label class="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 px-2 py-1.5 text-sm">
       <input type="checkbox" value="${esc(p.key)}" ${p.key === "reddit_free" ? "checked" : ""}> ${esc(p.label)}</label>`).join("");
  view.innerHTML = `
    <a href="#/agents" class="text-sm text-zinc-500 hover:text-reddit">← Agents</a>
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">Create an agent</h1>
    <p class="text-zinc-500 dark:text-zinc-400">A brand/niche persona with its own knowledge, voice &amp; platforms.</p>
    <div class="mt-5 ${card} space-y-3">
      ${field("ob-name", "Name", "Acme Notes")}
      ${field("ob-niche", "Niche", "AI note-taking for students")}
      ${field("ob-persona", "Voice / persona", "ex-teacher, founder of Acme")}
      ${field("ob-keywords", "Keywords (comma-sep)", "note taking app, obsidian alternative, study notes")}
      <div><div class="text-sm text-zinc-500">Platforms to watch</div>
        <div class="mt-1 grid grid-cols-3 gap-2">${checks}</div></div>
      <button id="ob-create" class="${btnP}">Create agent →</button>
      <span id="ob-msg" class="text-sm text-zinc-500"></span></div>`;
  document.getElementById("ob-create").onclick = async () => {
    const name = document.getElementById("ob-name").value.trim();
    const msg = document.getElementById("ob-msg");
    if (!name) { msg.textContent = "Name required."; return; }
    const pfs = [...document.querySelectorAll("#main-content input[type=checkbox]:checked")].map((c) => c.value);
    msg.textContent = "Creating…";
    try {
      await api.agentCreate({
        name,
        niche: document.getElementById("ob-niche").value.trim(),
        persona: document.getElementById("ob-persona").value.trim(),
        keywords: document.getElementById("ob-keywords").value.trim(),
        platforms: pfs.join(","),
      });
      toast("Agent created"); location.hash = "#/agent";
    } catch (e) { msg.textContent = "Failed: " + e; }
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
export async function renderGeo(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = head("AI Visibility <span class='text-base font-normal text-zinc-400'>(GEO)</span>",
    "Reddit is the #1 cited source in AI answers. Track queries where your brand should show up.",
    `<button id="geo-new" class="${btnP}">+ Track a query</button>`) +
    `<div id="geo-kpi" class="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3"></div>
     <div id="geo-form" class="hidden mb-5 ${card}"></div><div id="geo-list" class="space-y-3">Loading…</div>`;
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
  const stColor = (s) => s === "cited" ? "bg-emerald-500/15 text-emerald-500" : s === "competitor" ? "bg-amber-500/15 text-amber-500" : s === "absent" ? "bg-rose-500/15 text-rose-500" : "bg-zinc-500/15 text-zinc-400";
  async function load() {
    try {
      const r = await api.geoList();
      const kpi = (l, v) => `<div class="${card}"><div class="text-sm text-zinc-500">${l}</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">${v}</div></div>`;
      document.getElementById("geo-kpi").innerHTML = kpi("Tracked queries", r?.total || 0) + kpi("Cited", r?.cited || 0) + kpi("Citation rate", (r?.citation_rate || 0) + "%");
      const list = document.getElementById("geo-list");
      const qs = r?.queries || [];
      list.innerHTML = qs.length ? qs.map((q) => `<div class="${card} flex items-center justify-between gap-4">
        <div><div class="font-semibold text-zinc-900 dark:text-white">"${esc(q.query)}"</div>
          <div class="mt-1 flex items-center gap-2 text-sm"><span class="rounded bg-brand/15 px-2 py-0.5 text-xs font-bold text-brand">${esc(q.surface)}</span>
            <span class="rounded ${stColor(q.status)} px-2 py-0.5 text-xs font-bold">${esc(q.status)}</span></div></div>
        <div class="flex gap-2"><button data-cite="${esc(q.id)}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Mark cited</button>
          <button data-del="${esc(q.id)}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold text-rose-500">✕</button></div></div>`).join("")
        : `<div class="${card} text-zinc-500">No queries tracked. Click "+ Track a query".</div>`;
      list.querySelectorAll("[data-cite]").forEach((b) => b.onclick = async () => { await api.geoSet(b.getAttribute("data-cite"), "cited"); toast("Marked cited"); load(); });
      list.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => { await api.geoDelete(b.getAttribute("data-del")); toast("Deleted"); load(); });
      icons();
    } catch (e) { document.getElementById("geo-list").innerHTML = `<div class="${card} text-rose-500">${esc(e)}</div>`; }
  }
  load();
}

// ── Activation gate (Gap Map licence backend) ───────────────────────────────
// Format a raw key into XXXX-XXXX-XXXX-XXXX, keeping only the backend's
// alphabet (A–Z and 2–9 — no 0/1). Returns {raw, display}.
function fmtKey(s) {
  const raw = (s || "").toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 16);
  const display = raw.replace(/(.{4})/g, "$1-").replace(/-$/, "");
  return { raw, display };
}

function humanLicenseError(s) {
  const t = String(s).toLowerCase();
  if (t.includes("network") || t.includes("connect") || t.includes("timeout")) return "Network error — couldn't reach the activation server.";
  if (t.includes("password") || t.includes("credential") || t.includes("401")) return "Wrong email or password.";
  if (t.includes("device")) return "This key is already bound to another device.";
  if (t.includes("revoked") || t.includes("expired")) return "This licence has expired or was revoked.";
  if (t.includes("invalid") || t.includes("not found") || t.includes("404")) return "That activation key isn't valid.";
  return String(s).replace(/^Error:\s*/i, "") || "Activation failed.";
}

export async function renderActivate(view) {
  view.className = "min-h-screen w-full flex items-center justify-center px-6 py-10";
  let apiBase = "";
  try { apiBase = (await api.licenseDefaultApiBase())?.api_base || ""; } catch (e) {}
  view.innerHTML = `
    <div class="w-full max-w-md">
      <div class="mb-6 flex items-center gap-2 text-xl font-extrabold text-zinc-900 dark:text-white">
        <span class="h-6 w-6 rounded-full bg-reddit"></span> OpenReply</div>
      <div class="${card} space-y-3">
        <h1 class="text-xl font-bold text-zinc-900 dark:text-white">Activate your licence</h1>
        <p class="text-sm text-zinc-500 dark:text-zinc-400">Enter the email, password, and activation key from your purchase to unlock OpenReply on this device.</p>
        ${field("ac-email", "Email", "you@example.com")}
        <label class="block text-sm"><span class="text-zinc-500 dark:text-zinc-400">Password</span>
          <input id="ac-pass" type="password" placeholder="••••••••" class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
        <label class="block text-sm"><span class="text-zinc-500 dark:text-zinc-400">Activation key</span>
          <input id="ac-key" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX" class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 font-mono tracking-widest"></label>
        <details class="text-sm">
          <summary class="cursor-pointer text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">Advanced</summary>
          <label class="mt-2 block text-sm"><span class="text-zinc-500 dark:text-zinc-400">Activation server</span>
            <input id="ac-api" value="${esc(apiBase)}" class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs"></label>
        </details>
        <button id="ac-go" class="${btnP} w-full">Activate</button>
        <div id="ac-msg" class="text-sm"></div>
      </div>
      <p class="mt-4 text-center text-xs text-zinc-400">Need a key? Check your purchase email or account page.</p>
    </div>`;

  const keyEl = view.querySelector("#ac-key");
  keyEl.addEventListener("input", () => { keyEl.value = fmtKey(keyEl.value).display; });

  const msg = view.querySelector("#ac-msg");
  const setMsg = (t, cls) => { msg.innerHTML = `<span class="${cls}">${esc(t)}</span>`; };
  view.querySelector("#ac-go").onclick = async () => {
    const email = view.querySelector("#ac-email").value.trim();
    const password = view.querySelector("#ac-pass").value;
    const { raw } = fmtKey(view.querySelector("#ac-key").value);
    const base = view.querySelector("#ac-api").value.trim() || apiBase;
    if (!email || !email.includes("@")) { setMsg("Enter a valid email.", "text-rose-500"); return; }
    if (!password) { setMsg("Enter your password.", "text-rose-500"); return; }
    if (raw.length !== 16) { setMsg("Activation key must be 16 characters (A–Z, 2–9).", "text-rose-500"); return; }
    const btn2 = view.querySelector("#ac-go");
    btn2.disabled = true;
    setMsg("Contacting activation server…", "text-zinc-500");
    try {
      const chk = await api.licenseServerCheck(base);
      if (chk && chk.ok === false) { setMsg("Can't reach the activation server. Check your connection.", "text-rose-500"); btn2.disabled = false; return; }
    } catch (e) { /* non-fatal — let activate surface the real error */ }
    setMsg("Activating…", "text-zinc-500");
    try {
      const r = await api.licenseActivate(base, email, password, raw, null);
      if (r && (r.ok || r.activated)) { toast("Licence activated"); location.hash = "#/welcome"; }
      else { setMsg(humanLicenseError((r && (r.reason || r.error)) || "Activation failed."), "text-rose-500"); btn2.disabled = false; }
    } catch (e) { setMsg(humanLicenseError(e), "text-rose-500"); btn2.disabled = false; }
  };
  icons();
}

// ── Post-activation onboarding: profile + AI provider (BYOK) ─────────────────
export async function renderWelcome(view) {
  view.className = "min-h-screen w-full flex items-center justify-center px-6 py-10";
  let lic = {}, st = {};
  try { lic = (await api.licenseStatus()) || {}; } catch (e) {}
  try { st = (await api.byokStatus()) || {}; } catch (e) {}
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
          <label class="block text-sm"><span class="text-zinc-500 dark:text-zinc-400">Email</span>
            <input value="${esc(lic.email || "")}" disabled class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800/60 px-3 py-2 text-zinc-500"></label>
        </div>
        <div class="space-y-2">
          <div class="text-xs font-bold uppercase tracking-wider text-zinc-400">2 · AI provider (your own key)</div>
          <p class="text-sm text-zinc-500 dark:text-zinc-400">Runs on your key — used to draft replies &amp; content. Stored locally only.</p>
          <label class="block text-sm"><span class="text-zinc-500 dark:text-zinc-400">Provider</span>
            <select id="wc-prov" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2">${opts}</select></label>
          <label class="block text-sm" id="wc-keywrap"></label>
          <button id="wc-test" class="${btn}">Test connection</button>
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
    keyWrap.innerHTML = `<span class="text-zinc-500 dark:text-zinc-400">${isOllama ? "Base URL" : "API key"}</span>
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
    e.target.disabled = true; setMsg("Saving…", "text-zinc-500");
    try {
      localStorage.setItem("or-user-name", view.querySelector("#wc-name").value.trim());
      await saveProvider();
      localStorage.setItem("or-onboarded", "1");
      toast("You're all set"); location.hash = "#/agents";
    } catch (err) { setMsg(String(err.message || err), "text-rose-500"); e.target.disabled = false; }
  };
  icons();
}

// ── Settings › Licence card ─────────────────────────────────────────────────
export async function buildLicenseCard(el) {
  let st = {};
  try { st = (await api.licenseStatus()) || {}; } catch (e) {}
  const row = (k, v) => v ? `<div class="flex justify-between gap-3 py-1.5 text-sm"><span class="text-zinc-500">${k}</span><span class="font-semibold text-zinc-900 dark:text-white">${esc(v)}</span></div>` : "";
  const daysLeft = (iso) => {
    if (!iso) return "";
    const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
    return isFinite(d) ? `${d} day${d === 1 ? "" : "s"} left` : "";
  };
  const badge = !st.activated
    ? `<span class="rounded bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-500">Inactive</span>`
    : st.is_trial
      ? `<span class="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">Trial</span>`
      : `<span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">Active</span>`;
  el.innerHTML = `
    <div class="flex items-center justify-between"><b class="text-zinc-900 dark:text-white">Licence</b>${badge}</div>
    <div class="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
      ${row("Email", st.email)}
      ${row("Plan", st.plan_id)}
      ${row("Licence ID", st.license_id)}
      ${row("Expires", st.expires_at ? `${st.expires_at}${daysLeft(st.expires_at) ? " · " + daysLeft(st.expires_at) : ""}` : "")}
      ${st.is_trial ? row("Trial ends", st.trial_ends_at) : ""}
    </div>
    <div class="mt-3 flex flex-wrap gap-2">
      <button id="lic-refresh" class="${btn}">Refresh</button>
      <button id="lic-logout" class="rounded-full border border-rose-300 dark:border-rose-800 px-4 py-2 text-sm font-semibold text-rose-500 hover:bg-rose-500/10">Deactivate</button>
    </div>
    <div id="lic-msg" class="mt-2 text-xs"></div>`;
  const msg = el.querySelector("#lic-msg");
  el.querySelector("#lic-refresh").onclick = async (e) => {
    e.target.disabled = true; msg.innerHTML = `<span class="text-zinc-500">Checking…</span>`;
    try { await api.licenseRevalidate(); toast("Licence refreshed"); buildLicenseCard(el); }
    catch (err) { msg.innerHTML = `<span class="text-rose-500">${esc(err)}</span>`; e.target.disabled = false; }
  };
  el.querySelector("#lic-logout").onclick = () => {
    window.orModal({
      title: "Deactivate licence?",
      body: `<p class="text-sm text-zinc-500 dark:text-zinc-400">This signs the licence out of this device. You'll need your activation key to use OpenReply here again.</p>`,
      okText: "Deactivate",
      onOk: async () => {
        try { await api.licenseLogout(); localStorage.removeItem("or-onboarded"); location.hash = "#/activate"; }
        catch (e) { toast("Failed: " + e); }
      },
    });
  };
}

export const DYN = {
  activate: renderActivate,
  welcome: renderWelcome,
  agents: renderAgents,
  agent: renderOverview,
  opportunities: renderOpportunities,
  compose: renderCompose,
  connections: renderConnections,
  settings: renderSettings,
  knowledge: renderKnowledge,
  inbox: renderInbox,
  analytics: renderAnalytics,
  queue: renderQueue,
  keywords: renderKeywords,
  subreddit: renderSubreddit,
  onboarding: renderOnboarding,
  alerts: renderAlerts,
  geo: renderGeo,
};
