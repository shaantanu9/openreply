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

// ── Connections (Reach credentials) ───────────────────────────────────────
const _connInput = (id, ph, type = "text") =>
  `<input id="${id}" type="${type}" placeholder="${esc(ph)}" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm">`;

function connBadge(c) {
  if (c.kind === "public") return ['no auth needed', 'bg-emerald-500/15 text-emerald-500'];
  if (c.connected) return ['connected', 'bg-emerald-500/15 text-emerald-500'];
  if (c.kind === "api_key") return ['no key', 'bg-amber-500/15 text-amber-500'];
  return ['not connected', 'bg-rose-500/15 text-rose-500'];
}

export async function renderConnections(view) {
  view.className = "w-full max-w-6xl flex-1 px-8 py-7";
  view.innerHTML = head("Connections",
    "Log in to platforms to unlock authenticated reach. Read-only &amp; account-safe — we never post for you or need your password.") +
    `<p class="mb-5 rounded-lg bg-reddit/10 px-3 py-2 text-sm text-reddit"><i data-lucide="lock" class="inline-block h-4 w-4 align-[-2px]"></i> Credentials are stored locally on this machine only. Public sources (Hacker News, Dev.to, Bluesky, Mastodon) need no login.</p>
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
      c.kind === "api_key" ? "Needs an API key" : "Browser cookie login";
    const verified = c.last_verified_at ? `verified ${esc(String(c.last_verified_at).slice(0, 10))}` : "";
    let actions = "";
    const s = esc(c.source);
    if (c.kind === "public") {
      actions = `<button data-act="verify" data-src="${s}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Test reach</button>`;
    } else if (c.kind === "api_key") {
      actions = c.connected
        ? `<button data-act="verify" data-src="${s}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Verify</button>
           <button data-act="delete" data-src="${s}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold text-rose-500">Remove key</button>`
        : `<button data-act="key" data-src="${s}" data-label="${esc(c.label)}" class="rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white hover:bg-reddit-hi">Add key</button>
           ${c.login_url ? `<button data-act="open" data-url="${esc(c.login_url)}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Get key ↗</button>` : ""}`;
    } else { // cookie
      actions = c.connected
        ? `<button data-act="verify" data-src="${s}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Verify</button>
           <button data-act="cookie" data-src="${s}" data-label="${esc(c.label)}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Reconnect</button>
           <button data-act="delete" data-src="${s}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold text-rose-500">Disconnect</button>`
        : `${c.login_url ? `<button data-act="open" data-url="${esc(c.login_url)}" class="rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white hover:bg-reddit-hi">Log in ↗</button>` : ""}
           <button data-act="import" data-src="${s}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Import from browser</button>
           <button data-act="cookie" data-src="${s}" data-label="${esc(c.label)}" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Paste cookie</button>`;
    }
    return `<div class="${card}">
      <div class="flex items-center justify-between"><b class="text-zinc-900 dark:text-white">${esc(c.label)}</b>
        <span class="rounded ${cls} px-2 py-0.5 text-xs font-bold">${label}</span></div>
      <p class="mb-3 mt-2 text-sm text-zinc-500 dark:text-zinc-400">${meta}${verified ? ` · ${verified}` : ""}</p>
      <div class="flex flex-wrap gap-2" data-card="${s}">${actions}</div>
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
       <div id="st-llm" class="${card}"><div class="text-zinc-500">Loading provider…</div></div>
       <div id="st-appear" class="${card}"></div>
       <div id="st-feeds" class="${card}"><div class="text-zinc-500">Loading feeds…</div></div>
       <div id="st-data" class="${card}"><div class="text-zinc-500">Loading data…</div></div>
     </div>`;
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
      <td class="px-4 py-3"><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">${esc(c.kind)}</span></td>
      <td class="px-4 py-3">${esc((c.body || "").slice(0, 80))}…</td>
      <td class="px-4 py-3 text-zinc-500">${esc(c.platform || "")}</td>
      <td class="px-4 py-3"><span class="rounded bg-zinc-500/15 px-2 py-0.5 text-xs font-bold text-zinc-400">${esc(c.status || "draft")}</span></td></tr>`).join("");
  wrap.outerHTML = `<div class="overflow-hidden ${card} !p-0"><table class="w-full text-sm"><thead><tr class="text-left text-xs uppercase tracking-wide text-zinc-400">
      <th class="px-4 py-3">Type</th><th class="px-4 py-3">Content</th><th class="px-4 py-3">Platform</th><th class="px-4 py-3">Status</th></tr></thead><tbody>${body}</tbody></table></div>`;
  icons();
}

export const DYN = {
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
};
