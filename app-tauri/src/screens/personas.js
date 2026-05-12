// Persona agents — Phase 1 (2026-05-12).
//
// Two routes:
//   #/personas        → list + create + per-persona dashboard launcher
//   #/persona/<id>    → single-persona dashboard: Memories | Chat | Ingest
//
// Self-contained module. Remove the route registrations in main.js + the
// nav link in index.html + this file to fully roll back.
import { api, esc } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ─── auto-ingest hook ─────────────────────────────────────────────────────
// Phase 2d (2026-05-12). When a collect finishes, fan out persona ingest
// over the newly-collected topic for every active persona. Off by default
// on the user's first encounter (so they can opt in deliberately), but
// toggle persists in localStorage once flipped either way.
const AUTO_INGEST_KEY = 'gapmap.persona.auto_ingest';

export function isPersonaAutoIngestEnabled() {
  const v = localStorage.getItem(AUTO_INGEST_KEY);
  return v === 'true'; // explicit opt-in; absent or 'false' → off
}

export function setPersonaAutoIngestEnabled(on) {
  localStorage.setItem(AUTO_INGEST_KEY, on ? 'true' : 'false');
}

let _autoIngestHookInstalled = false;
let _lastAutoIngestAt = 0;

export function setupPersonaAutoIngest() {
  if (_autoIngestHookInstalled) return;
  _autoIngestHookInstalled = true;
  api.onCollectDone(async (payload) => {
    if (!isPersonaAutoIngestEnabled()) return;
    const topic = payload?.topic;
    if (!topic) return;
    // Debounce: collect:done can fire twice in tight succession on some
    // resume paths. Throttle to once per 3s per topic.
    const now = Date.now();
    if (now - _lastAutoIngestAt < 3000) return;
    _lastAutoIngestAt = now;
    try {
      // Fire-and-forget — the persona_ingest:* events stream regardless of
      // whether anyone is listening, so the Ingest tab on a persona dashboard
      // will pick up live progress if the user navigates to one.
      await api.personaIngest({ topic, limit: 100 });
    } catch (e) {
      console.warn('[persona auto-ingest] failed:', e);
    }
  });
}

// ─── helpers ───────────────────────────────────────────────────────────────

function unwrap(rust) {
  // Sidecar one-shot commands return { _parse_error: true, _raw: "..." } if
  // the JSON output didn't parse; otherwise the parsed payload from the CLI.
  if (rust && rust._parse_error) {
    // The CLI emits a single JSON line per command — pull the last non-empty
    // line and try to parse it. This covers `_emit` from persona_cmds.py.
    try {
      const lines = (rust._raw || '').trim().split('\n').filter(Boolean);
      return JSON.parse(lines[lines.length - 1]);
    } catch {
      return { ok: false, error: rust._error || 'parse_error' };
    }
  }
  return rust;
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    const dt = new Date(iso);
    if (isNaN(dt.getTime())) return iso;
    return dt.toLocaleString();
  } catch { return iso; }
}

function refreshIcons() {
  if (window.lucide?.createIcons) window.lucide.createIcons();
}

// ─── list screen ───────────────────────────────────────────────────────────

export async function renderPersonas(root) {
  root.innerHTML = `
    <div class="screen-pad personas-screen" style="padding:24px 28px 48px;max-width:1200px;margin:0 auto">
      <div class="page-head" style="margin-bottom:18px">
        <h1 style="font-size:28px;letter-spacing:-.01em;margin:0 0 6px">Persona agents</h1>
        <p class="muted" style="margin:0;max-width:820px;line-height:1.55;font-size:13.5px">
          Each persona is an always-on learning agent with a single lens.
          When you collect on any topic, every active persona reads the new
          posts, filters for relevance to its lens, and distills the lesson
          into its own memory. Ask the persona questions later; it answers
          from what it's learned.
        </p>
      </div>

      <div class="card persona-auto-ingest" style="margin:14px 0;padding:14px 18px;display:flex;align-items:center;gap:14px">
        <div style="width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:rgba(124,58,237,.12);color:#7c3aed;flex-shrink:0">
          <i data-lucide="zap" style="width:18px;height:18px"></i>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px;color:var(--ink-1)">Auto-ingest after every collect</div>
          <div class="muted" style="font-size:12px;margin-top:2px;line-height:1.45">When ON, every collect:done event fans out persona ingest across active personas for that topic.</div>
        </div>
        <label class="persona-switch" title="Toggle auto-ingest">
          <input id="ai-toggle" type="checkbox" />
          <span class="persona-switch-track" aria-hidden="true"><span class="persona-switch-thumb"></span></span>
          <span class="persona-switch-label">Enable</span>
        </label>
      </div>

      <div id="personas-list" class="personas-grid" style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill, minmax(300px, 1fr));margin:18px 0"></div>

      <div class="card" style="margin-top:28px">
        <div class="card-head" style="padding:18px 20px 0">
          <div>
            <h3>Create a new persona</h3>
            <p>Name it, give it a lens, and write one sentence describing what it should learn.</p>
          </div>
        </div>
        <div class="card-body np-form" style="display:grid;gap:14px">
          <div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr))">
            <label class="np-field">
              <span>Name</span>
              <input id="np-name" placeholder="e.g. Market Hunter" />
            </label>
            <label class="np-field">
              <span>Lens (single keyword)</span>
              <input id="np-lens" placeholder="e.g. market-gap" />
            </label>
          </div>
          <label class="np-field">
            <span>Goal (one sentence)</span>
            <textarea id="np-goal" rows="2" placeholder="e.g. Learn unmet market needs from every corpus."></textarea>
          </label>
          <label class="np-field">
            <span>System prompt override <em class="muted" style="font-style:normal;font-weight:500">(optional)</em></span>
            <textarea id="np-sp" rows="3" placeholder="Leave blank to auto-generate from name + goal + lens"></textarea>
          </label>
          <div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap">
            <label class="np-field" style="width:auto">
              <span>Color</span>
              <input id="np-color" type="color" value="#7c3aed" />
            </label>
            <label class="np-field" style="flex:1;min-width:180px">
              <span>Icon (lucide name)</span>
              <input id="np-icon" placeholder="sparkles" value="sparkles" />
            </label>
            <button id="np-create" class="btn btn-primary btn-sm" style="height:38px">
              <i data-lucide="plus" style="width:14px;height:14px"></i>
              Create persona
            </button>
          </div>
          <div id="np-msg" class="muted" style="font-size:12.5px;min-height:16px"></div>
        </div>
      </div>
    </div>
  `;

  // Wire auto-ingest toggle (reads/writes the same localStorage key the
  // app-boot listener checks before firing).
  const ai = $('#ai-toggle', root);
  if (ai) {
    ai.checked = isPersonaAutoIngestEnabled();
    ai.addEventListener('change', () => setPersonaAutoIngestEnabled(ai.checked));
  }
  refreshIcons();

  await reloadList(root);

  $('#np-create', root).addEventListener('click', async () => {
    const fields = {
      name:         $('#np-name', root).value.trim(),
      goal:         $('#np-goal', root).value.trim(),
      lens:         $('#np-lens', root).value.trim(),
      systemPrompt: $('#np-sp', root).value.trim() || null,
      color:        $('#np-color', root).value || null,
      icon:         $('#np-icon', root).value.trim() || null,
    };
    if (!fields.name || !fields.goal || !fields.lens) {
      $('#np-msg', root).textContent = 'name, lens, and goal are all required.';
      return;
    }
    $('#np-msg', root).textContent = 'creating…';
    try {
      const r = unwrap(await api.personaCreate(fields));
      if (!r.ok) {
        $('#np-msg', root).textContent = 'error: ' + (r.error || 'unknown');
        return;
      }
      $('#np-msg', root).textContent = `created persona #${r.id} '${r.name}'`;
      $$('#np-name, #np-goal, #np-lens, #np-sp', root).forEach(i => i.value = '');
      await reloadList(root);
    } catch (e) {
      $('#np-msg', root).textContent = 'error: ' + String(e?.message || e);
    }
  });
}

async function reloadList(root) {
  const grid = $('#personas-list', root);
  grid.innerHTML = '<div class="muted" style="padding:18px">loading…</div>';
  try {
    const r = unwrap(await api.personaList());
    const rows = r?.personas || [];
    if (!rows.length) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;padding:36px;text-align:center">
          <div style="font-size:14px;color:var(--ink-2);margin-bottom:4px">No personas yet</div>
          <div class="muted" style="font-size:12.5px">Create your first one in the form below.</div>
        </div>`;
      return;
    }
    grid.innerHTML = rows.map(p => personaCard(p)).join('');
    refreshIcons();
    // Wire card actions: the whole card opens the detail view; buttons handle
    // their own actions and stop propagation so they don't double-trigger.
    $$('[data-persona-id]', grid).forEach(el => {
      const id = parseInt(el.dataset.personaId, 10);
      // Whole-card navigation
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-act]')) return; // button handled separately
        location.hash = `#/persona/${id}`;
      });
      // Per-button actions
      $$('[data-act]', el).forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const act = btn.dataset.act;
          if (act === 'open')   location.hash = `#/persona/${id}`;
          if (act === 'toggle') togglePersona(id, !(el.dataset.active === '1' || el.dataset.active === 'true'), root);
          if (act === 'delete') deletePersona(id, root);
        });
      });
    });
  } catch (e) {
    grid.innerHTML = `<div class="muted" style="padding:18px">error: ${esc(String(e?.message || e))}</div>`;
  }
}

function personaCard(p) {
  const s = p.stats || { memories: 0, edges: 0, topics_seen: 0, last_memory_at: null };
  const color = p.color || '#7c3aed';
  const isActive = p.active ? '1' : '0';
  return `
    <div class="card persona-card" data-persona-id="${p.id}" data-active="${isActive}"
         style="border-left:4px solid ${esc(color)};cursor:pointer;display:flex;flex-direction:column">
      <div class="card-head" style="padding:14px 16px;display:flex;align-items:center;gap:12px;border-bottom:0">
        <div style="width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:${esc(color)}22;color:${esc(color)};flex-shrink:0">
          <i data-lucide="${esc(p.icon || 'sparkles')}" style="width:18px;height:18px"></i>
        </div>
        <div style="flex:1;min-width:0">
          <h3 style="margin:0;font-size:15px;font-weight:700;letter-spacing:-.01em">${esc(p.name)}</h3>
          <p class="muted" style="margin:2px 0 0;font-size:11.5px">lens: <span style="color:${esc(color)};font-weight:600">${esc(p.lens)}</span> · ${p.active ? 'active' : 'paused'}</p>
        </div>
        <i data-lucide="chevron-right" style="width:16px;height:16px;color:var(--ink-3);flex-shrink:0" aria-hidden="true"></i>
      </div>
      <div class="card-body" style="padding:6px 16px 14px;flex:1;display:flex;flex-direction:column">
        <p style="margin:0 0 12px;font-size:13px;line-height:1.45;color:var(--ink-2)">${esc(p.goal)}</p>
        <div class="persona-stats muted" style="display:flex;gap:16px;font-size:12px">
          <span><strong style="color:var(--ink-1)">${s.memories}</strong> memories</span>
          <span><strong style="color:var(--ink-1)">${s.topics_seen}</strong> topics</span>
          <span><strong style="color:var(--ink-1)">${s.edges}</strong> edges</span>
        </div>
        <p class="muted" style="margin:6px 0 0;font-size:11px">last memory: ${fmtTime(s.last_memory_at)}</p>
        <div style="display:flex;gap:6px;margin-top:auto;padding-top:14px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" data-act="open">
            <i data-lucide="folder-open" style="width:12px;height:12px"></i>
            Open
          </button>
          <button class="btn btn-ghost btn-bordered btn-sm" data-act="toggle" title="${p.active ? 'Pause learning' : 'Resume learning'}">
            <i data-lucide="${p.active ? 'pause' : 'play'}" style="width:12px;height:12px"></i>
            ${p.active ? 'Pause' : 'Resume'}
          </button>
          <button class="btn btn-ghost btn-bordered btn-sm persona-delete-btn" data-act="delete" title="Delete this persona" style="margin-left:auto">
            <i data-lucide="trash-2" style="width:12px;height:12px"></i>
          </button>
        </div>
      </div>
    </div>
  `;
}

async function togglePersona(id, makeActive, root) {
  await api.personaUpdate(id, { active: makeActive });
  await reloadList(root);
}

async function deletePersona(id, root) {
  if (!confirm('Delete this persona and ALL its memories? This cannot be undone.')) return;
  await api.personaDelete(id);
  await reloadList(root);
}


// ─── detail screen ─────────────────────────────────────────────────────────

export async function renderPersona(root, { params } = {}) {
  const id = parseInt((params || [])[0], 10);
  if (!id) {
    root.innerHTML = '<div class="screen-pad muted">invalid persona id</div>';
    return;
  }

  root.innerHTML = `
    <div class="screen-pad">
      <div id="persona-head"></div>
      <div class="tabs" style="margin:14px 0;display:flex;gap:8px;border-bottom:1px solid var(--line);flex-wrap:wrap">
        <button class="tab-btn active" data-tab="memories"    style="padding:8px 14px;background:none;border:none;border-bottom:2px solid var(--accent, #7c3aed);cursor:pointer">Memories</button>
        <button class="tab-btn"        data-tab="graph"       style="padding:8px 14px;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer">Graph</button>
        <button class="tab-btn"        data-tab="conclusions" style="padding:8px 14px;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer">Conclusions</button>
        <button class="tab-btn"        data-tab="chat"        style="padding:8px 14px;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer">Chat</button>
        <button class="tab-btn"        data-tab="ingest"      style="padding:8px 14px;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer">Ingest</button>
      </div>
      <div id="persona-body"></div>
    </div>
  `;

  let persona = null;
  try {
    const r = unwrap(await api.personaList());
    persona = (r?.personas || []).find(p => p.id === id);
  } catch {}
  if (!persona) {
    root.innerHTML = `<div class="screen-pad muted">persona #${id} not found</div>`;
    return;
  }

  $('#persona-head', root).innerHTML = renderHead(persona);
  refreshIcons();

  const tabBtns = $$('.tab-btn', root);
  tabBtns.forEach(b => b.addEventListener('click', () => {
    tabBtns.forEach(x => {
      const on = x === b;
      x.classList.toggle('active', on);
      x.style.borderBottomColor = on ? 'var(--accent, #7c3aed)' : 'transparent';
    });
    mountTab(b.dataset.tab, $('#persona-body', root), persona);
  }));
  mountTab('memories', $('#persona-body', root), persona);
}

function renderHead(p) {
  const s = p.stats || {};
  const color = p.color || '#7c3aed';
  return `
    <div style="display:flex;align-items:flex-start;gap:14px">
      <div style="width:48px;height:48px;border-radius:10px;display:grid;place-items:center;background:${esc(color)}22;color:${esc(color)}">
        <i data-lucide="${esc(p.icon || 'sparkles')}" style="width:24px;height:24px"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:10px">
          <h1 style="margin:0;font-size:22px">${esc(p.name)}</h1>
          <span class="chip" style="background:${esc(color)}22;color:${esc(color)};padding:2px 8px;border-radius:6px;font-size:12px">${esc(p.lens)}</span>
          <span class="muted" style="font-size:12px">${p.active ? 'active' : 'paused'}</span>
        </div>
        <p class="muted" style="margin:6px 0 0">${esc(p.goal)}</p>
        <div style="display:flex;gap:14px;margin-top:8px;font-size:13px" class="muted">
          <span><strong>${s.memories || 0}</strong> memories</span>
          <span><strong>${s.topics_seen || 0}</strong> topics</span>
          <span><strong>${s.edges || 0}</strong> edges</span>
          <span><strong>${s.conclusions || 0}</strong> conclusions</span>
        </div>
      </div>
    </div>
  `;
}

function mountTab(tab, host, persona) {
  if (tab === 'memories')    return mountMemoriesTab(host, persona);
  if (tab === 'graph')       return mountGraphTab(host, persona);
  if (tab === 'conclusions') return mountConclusionsTab(host, persona);
  if (tab === 'chat')        return mountChatTab(host, persona);
  if (tab === 'ingest')      return mountIngestTab(host, persona);
}

async function mountMemoriesTab(host, persona) {
  host.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin:10px 0">
      <label>Filter by topic <input id="m-topic" placeholder="(all)" style="margin-left:6px"></label>
      <label>Limit <input id="m-limit" type="number" value="50" min="1" max="500" style="width:80px;margin-left:6px"></label>
      <button id="m-refresh" class="btn btn-ghost btn-bordered btn-sm" style="margin-left:auto"><i data-lucide="rotate-ccw" style="width:12px;height:12px"></i>Refresh</button>
    </div>
    <div id="m-list" class="muted">loading…</div>
  `;
  async function load() {
    $('#m-list', host).innerHTML = '<div class="muted">loading…</div>';
    const topic = $('#m-topic', host).value.trim() || null;
    const limit = parseInt($('#m-limit', host).value, 10) || 50;
    const r = unwrap(await api.personaMemories(persona.id, { topic, limit }));
    const rows = r?.memories || [];
    if (!rows.length) {
      $('#m-list', host).innerHTML = '<div class="muted">no memories yet — go to the Ingest tab.</div>';
      return;
    }
    $('#m-list', host).innerHTML = rows.map(m => `
      <div class="card" data-mem-id="${m.id}" style="margin-bottom:10px">
        <div class="card-body" style="padding:12px 16px">
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:6px">
            <span class="chip" style="font-size:11px;padding:1px 7px;border-radius:5px;background:var(--accent-soft, #7c3aed22)">topic: ${esc(m.topic || '—')}</span>
            <span class="muted" style="font-size:11px">imp ${(m.importance ?? 0).toFixed(2)} · ${fmtTime(m.created_at)}</span>
            <span style="margin-left:auto;font-size:11px" class="muted">mem#${m.id}</span>
            <button data-act="share" class="btn-ghost-bordered" style="padding:2px 8px;font-size:11px" title="Share this memory with another persona — they'll re-frame it through their own lens">Share →</button>
          </div>
          <p style="margin:0 0 6px;line-height:1.45">${esc(m.lesson || '')}</p>
          ${m.excerpt ? `<p class="muted" style="margin:0;font-size:12px;font-style:italic">"${esc(m.excerpt)}"</p>` : ''}
          ${m.post_title ? `<p class="muted" style="margin:6px 0 0;font-size:11px">source: ${esc(m.post_source || '?')} — ${esc(m.post_title.slice(0,80))}${m.post_url ? ` <a href="${esc(m.post_url)}" target="_blank">↗</a>` : ''}</p>` : ''}
        </div>
      </div>
    `).join('');
    // Wire share buttons
    $$('.card[data-mem-id]', host).forEach(card => {
      const btn = card.querySelector('[data-act="share"]');
      if (btn) btn.addEventListener('click', () => openShareModal(persona, parseInt(card.dataset.memId, 10)));
    });
  }
  $('#m-refresh', host).addEventListener('click', load);
  $('#m-topic', host).addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
  await load();
}

async function mountChatTab(host, persona) {
  const raw = String(persona.color || '#7c3aed').trim();
  const accentSafe = /^#[0-9A-Fa-f]{6}$/.test(raw) ? raw : /^#[0-9A-Fa-f]{3}$/.test(raw) ? raw : '#7c3aed';
  host.innerHTML = `
    <div class="persona-chat" style="--persona-accent:${accentSafe}">
      <div id="chat-history" class="persona-chat-history" aria-live="polite"></div>
      <div class="persona-chat-composer">
        <input id="chat-q" class="persona-chat-q" type="text" placeholder="Ask ${esc(persona.name)} something…" autocomplete="off" />
        <input id="chat-k" class="persona-chat-k" type="number" value="8" min="1" max="30" title="Memories to retrieve for context (top‑K)" />
        <button id="chat-send" type="button" class="btn btn-primary btn-sm"><i data-lucide="send" style="width:12px;height:12px"></i> Ask</button>
      </div>
      <p class="persona-chat-hint muted">
        Answers use only ${esc(persona.name)}'s ingested memories. Inline tags like (M1, M3) match the <strong>Memories</strong> tab — open a citation block below to see which memory backed each phrase.
      </p>
    </div>
  `;
  const hist = $('#chat-history', host);
  function append(role, text, cits, beliefs, retrieval) {
    const isUser = role === 'user';
    const wrap = document.createElement('div');
    wrap.className = `persona-chat-msg ${isUser ? 'persona-chat-msg--user' : 'persona-chat-msg--assistant'}`;
    const label = isUser ? 'You' : esc(persona.name);
    const headExtras = !isUser && retrieval
      ? ` <span class="persona-chat-retrieval">· ${esc(retrieval)} retrieval</span>`
      : '';
    const body = esc(text).replace(/\n/g, '<br/>');
    wrap.innerHTML = `<div class="persona-chat-msg-label">${label}${headExtras}</div><div class="persona-chat-msg-body">${body}</div>`;
    if (beliefs && beliefs.length) {
      wrap.innerHTML += `<details class="persona-chat-details"><summary>${beliefs.length} established beliefs</summary>` +
        beliefs.map(b => `<div class="persona-chat-cite-line"><strong>${esc(b.tag)}</strong> conf=${(b.confidence || 0).toFixed(2)}: ${esc((b.statement || '').slice(0, 220))}</div>`).join('') +
        '</details>';
    }
    if (cits && cits.length) {
      wrap.innerHTML += `<details class="persona-chat-details"><summary>${cits.length} memory citations</summary>` +
        cits.map(c => {
          const simBit = c.similarity != null ? ` · sim ${Number(c.similarity).toFixed(2)}` : '';
          return `<div class="persona-chat-cite-line"><strong>${esc(c.tag)}</strong> mem#${c.memory_id} (topic=${esc(c.topic || '—')}${simBit}): ${esc((c.lesson || '').slice(0, 180))}</div>`;
        }).join('') +
        '</details>';
    }
    hist.appendChild(wrap);
    hist.scrollTop = hist.scrollHeight;
  }
  async function ask() {
    const q = $('#chat-q', host).value.trim();
    if (!q) return;
    const k = parseInt($('#chat-k', host).value, 10) || 8;
    append('user', q, null, null, null);
    $('#chat-q', host).value = '';
    const placeholder = document.createElement('div');
    placeholder.className = 'persona-chat-msg persona-chat-msg--assistant persona-chat-msg--pending';
    placeholder.innerHTML = `<div class="persona-chat-msg-label">${esc(persona.name)}</div><div class="persona-chat-msg-body">Thinking…</div>`;
    hist.appendChild(placeholder);
    hist.scrollTop = hist.scrollHeight;
    try {
      const r = unwrap(await api.personaChat(persona.id, q, k));
      placeholder.remove();
      if (!r.ok) {
        append(persona.name, 'Error: ' + (r.error || 'unknown'), null, null, null);
      } else {
        append(persona.name, r.answer || '(empty)', r.citations, r.beliefs, r.retrieval);
      }
    } catch (e) {
      placeholder.remove();
      append(persona.name, 'Error: ' + String(e?.message || e), null, null, null);
    }
  }
  $('#chat-send', host).addEventListener('click', ask);
  $('#chat-q', host).addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
  window.refreshIcons?.();
}

// ─── Graph tab ────────────────────────────────────────────────────────────

async function mountGraphTab(host, persona) {
  host.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin:10px 0">
      <span class="muted" style="font-size:13px">Memory graph — node size by importance, edge weight by cosine similarity.</span>
      <button id="g-refresh"  class="btn btn-ghost btn-bordered btn-sm" style="margin-left:auto"><i data-lucide="rotate-ccw" style="width:12px;height:12px"></i>Refresh</button>
      <button id="g-backfill" class="btn btn-ghost btn-bordered btn-sm" title="Re-embed every memory and recompute every edge from scratch"><i data-lucide="layers" style="width:12px;height:12px"></i>Backfill</button>
    </div>
    <div id="g-stage" style="position:relative;width:100%;height:520px;border:1px solid var(--border, #2a2a2a);border-radius:8px;overflow:hidden;background:var(--bg-elev, #111)">
      <svg id="g-svg" width="100%" height="100%" style="display:block"></svg>
      <div id="g-tooltip" style="position:absolute;display:none;pointer-events:none;background:#000c;color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;max-width:340px;line-height:1.4;z-index:5"></div>
    </div>
    <p class="muted" style="font-size:11px;margin:6px 0">Drag nodes to explore. Hover to read the memory.</p>
  `;
  const svg = $('#g-svg', host);
  const tip = $('#g-tooltip', host);

  async function load() {
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#888" font-size="12">loading…</text>';
    const r = unwrap(await api.personaGraph(persona.id));
    const g = (r && r.graph) || { nodes: [], edges: [] };
    if (!g.nodes.length) {
      svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#888" font-size="12">no graph yet — ingest memories or click Backfill.</text>';
      return;
    }
    drawForceGraph(svg, tip, g, persona);
  }

  $('#g-refresh', host).addEventListener('click', load);
  $('#g-backfill', host).addEventListener('click', async () => {
    $('#g-backfill', host).disabled = true;
    $('#g-backfill', host).textContent = 'backfilling…';
    try {
      const r = unwrap(await api.personaBackfill(persona.id));
      const stats = r?.ok ? `${r.embeddings_added || 0} added, ${r.edges_written || 0} edges` : (r?.error || 'unknown');
      $('#g-backfill', host).textContent = `Backfill (${stats})`;
      await load();
    } catch (e) {
      $('#g-backfill', host).textContent = 'Backfill (error)';
    } finally {
      $('#g-backfill', host).disabled = false;
      setTimeout(() => { $('#g-backfill', host).textContent = 'Backfill'; }, 4000);
    }
  });

  await load();
}

// Tiny vanilla force-directed graph — no D3 dep, ~100 lines of math.
// Sufficient for graphs of <500 nodes/<1000 edges which is well within
// the Phase-2 ceiling (top-5 edges/memory * a few hundred memories).
function drawForceGraph(svg, tip, g, persona) {
  const W = svg.clientWidth || 600;
  const H = svg.clientHeight || 520;
  const color = persona.color || '#7c3aed';
  // Pull stable size from importance
  const nodes = g.nodes.map((n, i) => ({
    id: n.id,
    lesson: n.lesson || '',
    topic: n.topic || '',
    importance: n.importance ?? 0.5,
    x: W / 2 + (Math.random() - 0.5) * 80,
    y: H / 2 + (Math.random() - 0.5) * 80,
    vx: 0, vy: 0,
    r: 6 + (n.importance ?? 0.5) * 8,
  }));
  const idx = new Map(nodes.map(n => [n.id, n]));
  const edges = g.edges
    .filter(e => idx.has(e.from_memory_id) && idx.has(e.to_memory_id))
    .map(e => ({
      from: idx.get(e.from_memory_id),
      to:   idx.get(e.to_memory_id),
      w: e.weight || 0,
    }));

  // Force-sim params — tuned for graphs of 10..500 nodes.
  const REPULSE = 1800;
  const SPRING  = 0.05;
  const DAMP    = 0.78;
  const CENTER  = 0.012;
  const TICKS   = 220;

  for (let t = 0; t < TICKS; t++) {
    // Repulsion between all pairs (O(N²) — fine at this scale)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy + 1;
        const f = REPULSE / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
    // Spring on edges (target length proportional to (1 - weight))
    for (const e of edges) {
      const dx = e.to.x - e.from.x, dy = e.to.y - e.from.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const target = 60 + (1 - e.w) * 80;
      const k = SPRING * (d - target);
      const fx = (dx / d) * k, fy = (dy / d) * k;
      e.from.vx += fx; e.from.vy += fy;
      e.to.vx   -= fx; e.to.vy   -= fy;
    }
    // Centering + damping
    for (const n of nodes) {
      n.vx = (n.vx + (W / 2 - n.x) * CENTER) * DAMP;
      n.vy = (n.vy + (H / 2 - n.y) * CENTER) * DAMP;
      n.x += n.vx;
      n.y += n.vy;
      // clamp to viewport
      n.x = Math.max(n.r + 4, Math.min(W - n.r - 4, n.x));
      n.y = Math.max(n.r + 4, Math.min(H - n.r - 4, n.y));
    }
  }

  // Render
  const NS = 'http://www.w3.org/2000/svg';
  svg.innerHTML = '';
  // Edges first so nodes paint on top
  for (const e of edges) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', e.from.x);
    line.setAttribute('y1', e.from.y);
    line.setAttribute('x2', e.to.x);
    line.setAttribute('y2', e.to.y);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-opacity', String(0.15 + e.w * 0.6));
    line.setAttribute('stroke-width', String(0.5 + e.w * 1.8));
    svg.appendChild(line);
  }
  for (const n of nodes) {
    const g = document.createElementNS(NS, 'g');
    g.style.cursor = 'grab';
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', n.x);
    c.setAttribute('cy', n.y);
    c.setAttribute('r', n.r);
    c.setAttribute('fill', color);
    c.setAttribute('fill-opacity', '0.85');
    c.setAttribute('stroke', '#fff');
    c.setAttribute('stroke-opacity', '0.45');
    c.setAttribute('stroke-width', '1');
    g.appendChild(c);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', n.x);
    t.setAttribute('y', n.y + 4);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('fill', '#fff');
    t.setAttribute('font-size', '10');
    t.setAttribute('pointer-events', 'none');
    t.textContent = String(n.id);
    g.appendChild(t);
    g.addEventListener('mouseenter', (ev) => {
      tip.style.display = 'block';
      tip.textContent = `mem#${n.id} (${n.topic || '—'}, imp ${n.importance.toFixed(2)})\n${n.lesson.slice(0,260)}`;
      tip.style.whiteSpace = 'pre-line';
    });
    g.addEventListener('mousemove', (ev) => {
      const rect = svg.getBoundingClientRect();
      tip.style.left = (ev.clientX - rect.left + 12) + 'px';
      tip.style.top  = (ev.clientY - rect.top + 12) + 'px';
    });
    g.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    // Drag
    let dragging = false, ox = 0, oy = 0;
    g.addEventListener('mousedown', (ev) => {
      dragging = true;
      ox = ev.clientX - n.x;
      oy = ev.clientY - n.y;
      g.style.cursor = 'grabbing';
    });
    const onMove = (ev) => {
      if (!dragging) return;
      n.x = ev.clientX - ox;
      n.y = ev.clientY - oy;
      c.setAttribute('cx', n.x);
      c.setAttribute('cy', n.y);
      t.setAttribute('x', n.x);
      t.setAttribute('y', n.y + 4);
      // Re-route incident edges
      for (const e of edges) {
        if (e.from === n || e.to === n) {
          const line = svg.querySelectorAll('line')[edges.indexOf(e)];
          if (line) {
            line.setAttribute('x1', e.from.x);
            line.setAttribute('y1', e.from.y);
            line.setAttribute('x2', e.to.x);
            line.setAttribute('y2', e.to.y);
          }
        }
      }
    };
    const onUp = () => { dragging = false; g.style.cursor = 'grab'; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    svg.appendChild(g);
  }
}

// ─── Conclusions tab ──────────────────────────────────────────────────────

async function mountConclusionsTab(host, persona) {
  host.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin:10px 0">
      <span class="muted" style="font-size:13px">Synthesised beliefs — each clusters densely-connected memories into one falsifiable statement.</span>
      <button id="c-refresh"   class="btn btn-ghost btn-bordered btn-sm" style="margin-left:auto"><i data-lucide="rotate-ccw" style="width:12px;height:12px"></i>Refresh</button>
      <button id="c-synthesise" class="btn btn-primary btn-sm"><i data-lucide="sparkles" style="width:12px;height:12px"></i>Synthesise</button>
    </div>
    <div id="c-log" style="display:none;font-family:var(--mono, ui-monospace, monospace);font-size:12px;padding:10px;margin-bottom:12px;border:1px solid var(--border, #2a2a2a);border-radius:8px;max-height:240px;overflow-y:auto"></div>
    <div id="c-list" class="muted">loading…</div>
    <div style="margin-top:24px">
      <div style="font-size:11px;letter-spacing:.5px;text-transform:uppercase" class="muted">CONTRADICTIONS — shares this persona refused (lens mismatches)</div>
      <div id="c-rejections" style="margin-top:8px" class="muted">loading…</div>
    </div>
  `;

  async function load() {
    $('#c-list', host).innerHTML = '<div class="muted">loading…</div>';
    const r = unwrap(await api.personaConclusions(persona.id));
    const rows = r?.conclusions || [];
    if (!rows.length) {
      $('#c-list', host).innerHTML = '<div class="muted">no conclusions yet — click Synthesise (needs ≥3 connected memories).</div>';
      return;
    }
    $('#c-list', host).innerHTML = rows.map(c => `
      <div class="card" style="margin-bottom:10px">
        <div class="card-body" style="padding:12px 16px">
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:6px">
            <span class="chip" style="font-size:11px;padding:1px 7px;border-radius:5px;background:var(--accent-soft, #7c3aed22)">confidence ${(c.confidence || 0).toFixed(2)}</span>
            <span class="muted" style="font-size:11px">${(c.evidence || []).length} supporting memories</span>
            <span class="muted" style="font-size:11px;margin-left:auto">${fmtTime(c.updated_at || c.created_at)}</span>
          </div>
          <p style="margin:0 0 8px;line-height:1.5;font-size:14px">${esc(c.statement || '')}</p>
          <details>
            <summary class="muted" style="cursor:pointer;font-size:11px">evidence (mem ${(c.evidence||[]).join(', ')})</summary>
            <div class="muted" style="margin-top:6px;font-size:11px">scroll to those memory ids in the Memories tab to see the source lessons.</div>
          </details>
        </div>
      </div>
    `).join('');
  }
  async function loadRejections() {
    const box = $('#c-rejections', host);
    if (!box) return;
    box.innerHTML = '<div class="muted">loading…</div>';
    try {
      const r = unwrap(await api.personaRejections(persona.id, { direction: 'as_receiver', limit: 20 }));
      const rows = r?.rejections || [];
      if (!rows.length) {
        box.innerHTML = '<div class="muted" style="font-size:12px">No shares have been refused by this lens yet. As other personas share memories to this one and the lens says "not relevant", the rejections will accumulate here — a map of where worldviews diverge.</div>';
        return;
      }
      box.innerHTML = rows.map(j => `
        <div style="padding:8px 10px;margin-bottom:6px;border-left:2px solid #b84747;background:#b8474711;border-radius:4px">
          <div style="font-size:11px" class="muted">${esc(j.from_name || '?')} (${esc(j.from_lens || '?')}) → refused · ${fmtTime(j.created_at)}</div>
          <div style="font-size:12px;margin:4px 0">donor said: <em>"${esc((j.donor_lesson || '').slice(0,200))}"</em></div>
          <div style="font-size:12px;color:#b84747">reason: ${esc(j.reason || '')}</div>
        </div>
      `).join('');
    } catch (e) {
      box.innerHTML = `<div class="muted">error: ${esc(String(e?.message || e))}</div>`;
    }
  }
  $('#c-refresh', host).addEventListener('click', () => { load(); loadRejections(); });

  let unsubP, unsubD;
  $('#c-synthesise', host).addEventListener('click', async () => {
    const log = $('#c-log', host);
    log.style.display = 'block';
    log.innerHTML = '';
    const line = (t) => { const d = document.createElement('div'); d.textContent = t; log.appendChild(d); log.scrollTop = log.scrollHeight; };
    if (unsubP) await unsubP();
    if (unsubD) await unsubD();
    unsubP = await api.onPersonaConcludeProgress(payload => {
      try {
        const ev = JSON.parse(String(payload || '').trim());
        if (ev.event === 'start')      line(`▶ start — ${ev.clusters} clusters`);
        else if (ev.event === 'concluded') {
          line(`  ✓ #${ev.conclusion_id} conf=${(ev.confidence||0).toFixed(2)} ev=${ev.evidence}`);
          line(`    ${(ev.statement||'').slice(0,200)}`);
        } else if (ev.event === 'skip')  line(`  · skip (${ev.reason})`);
        else if (ev.event === 'error')   line(`  ✗ ${(ev.error||'').slice(0,160)}`);
        else if (ev.event === 'done')    line(`done — written=${ev.written} refreshed=${ev.refreshed} skipped=${ev.skipped} errors=${ev.errors}`);
      } catch {
        line(String(payload));
      }
    });
    unsubD = await api.onPersonaConcludeDone(_ => {
      load();
      if (unsubP) unsubP();
      if (unsubD) unsubD();
    });
    try {
      await api.personaConclude(persona.id);
    } catch (e) {
      line('error: ' + String(e?.message || e));
    }
  });

  await load();
  await loadRejections();
}

async function mountIngestTab(host, persona) {
  host.innerHTML = `
    <div style="max-width:680px">
      <p class="muted">
        Scans posts already in your corpus that ${esc(persona.name)} hasn't read yet,
        filters them through the lens, and stores any relevant lesson in
        ${esc(persona.name)}'s memory. Safe to re-run — already-ingested posts are skipped.
      </p>
      <div style="display:flex;gap:8px;align-items:center;margin:12px 0;flex-wrap:wrap">
        <label>Limit posts to scan <input id="in-limit" type="number" value="50" min="1" max="500" style="width:80px;margin-left:6px"></label>
        <label>Topic (optional) <input id="in-topic" placeholder="(all topics)" style="margin-left:6px"></label>
        <span style="flex:1"></span>
        <button id="in-peers" class="btn btn-ghost-bordered btn-sm" title="Ingest other personas' conclusions through THIS persona's lens — the persona-of-personas / meta-agent pass"><i data-lucide="users" style="width:12px;height:12px"></i>Ingest peers</button>
        <button id="in-run" class="btn btn-primary btn-sm"><i data-lucide="play" style="width:12px;height:12px"></i>Run ingest</button>
      </div>
      <div id="in-log" style="font-family:var(--mono, ui-monospace, monospace);font-size:12px;padding:10px;border:1px solid var(--border, #2a2a2a);border-radius:8px;min-height:140px;max-height:50vh;overflow-y:auto"></div>
    </div>
  `;
  const log = $('#in-log', host);
  function line(text, cls = '') {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }
  let progressUnsub, doneUnsub;
  $('#in-run', host).addEventListener('click', async () => {
    log.innerHTML = '';
    const limit = parseInt($('#in-limit', host).value, 10) || 50;
    const topic = $('#in-topic', host).value.trim() || null;
    line(`▶ starting ingest (persona=${persona.name}, topic=${topic || '(all)'}, limit=${limit})`);
    if (progressUnsub) await progressUnsub();
    if (doneUnsub) await doneUnsub();
    progressUnsub = await api.onPersonaIngestProgress(payload => {
      const t = String(payload || '').trim();
      if (!t) return;
      // payload is an NDJSON line emitted by the python CLI
      try {
        const ev = JSON.parse(t);
        if (ev.event === 'start') line(`  start — ${ev.candidates} candidates`);
        else if (ev.event === 'memory') line(`  ✓ mem#${ev.memory_id}: ${(ev.lesson || '').slice(0,150)}`);
        else if (ev.event === 'skip')   line(`  · skip (${ev.reason})`, 'muted');
        else if (ev.event === 'error')  line(`  ✗ ${(ev.error || '').slice(0,150)}`, 'muted');
        else if (ev.event === 'done')   line(`  ▶ done — kept=${ev.kept} dropped=${ev.dropped} errors=${ev.errors}`);
      } catch {
        line(t);
      }
    });
    doneUnsub = await api.onPersonaIngestDone(_payload => {
      line('✔ ingest complete', '');
      if (progressUnsub) progressUnsub();
      if (doneUnsub) doneUnsub();
    });
    try {
      await api.personaIngest({ personaId: persona.id, topic, limit });
    } catch (e) {
      line('error: ' + String(e?.message || e));
    }
  });

  // Peer ingest (Phase 4a)
  $('#in-peers', host)?.addEventListener('click', async () => {
    log.innerHTML = '';
    const limit = parseInt($('#in-limit', host).value, 10) || 50;
    line(`▶ starting peer-ingest (persona=${persona.name}, limit=${limit})`);
    if (progressUnsub) await progressUnsub();
    if (doneUnsub) await doneUnsub();
    progressUnsub = await api.onPersonaIngestProgress(payload => {
      const t = String(payload || '').trim();
      if (!t) return;
      try {
        const ev = JSON.parse(t);
        if (ev.event === 'start')      line(`  peer start — ${ev.candidates} candidate conclusions`);
        else if (ev.event === 'memory') line(`  ✓ meta-mem#${ev.memory_id}: ${(ev.lesson || '').slice(0,150)}`);
        else if (ev.event === 'skip')   line(`  · skip (${ev.reason})`, 'muted');
        else if (ev.event === 'error')  line(`  ✗ ${(ev.error || '').slice(0,150)}`, 'muted');
        else if (ev.event === 'done')   line(`  ▶ peer done — kept=${ev.kept} dropped=${ev.dropped} errors=${ev.errors}`);
      } catch { line(t); }
    });
    doneUnsub = await api.onPersonaIngestDone(_payload => {
      line('✔ peer ingest complete', '');
      if (progressUnsub) progressUnsub();
      if (doneUnsub) doneUnsub();
    });
    try {
      await api.personaIngestPeers(persona.id, limit);
    } catch (e) {
      line('error: ' + String(e?.message || e));
    }
  });
}

// ─── orchestra dashboard (#/agents) ───────────────────────────────────────
// Phase 4b — live multi-persona view. Auto-refreshes while visible so the
// user sees memories landing in real-time during ingest. Cleans up its
// interval when the user navigates away (route() reassigns main innerHTML
// which orphans listeners; we use MutationObserver to detect that).

export async function renderAgentsDashboard(root) {
  root.innerHTML = `
    <div class="screen-pad" style="padding:24px 28px 48px;max-width:1400px;margin:0 auto">
      <div class="page-head" style="margin-bottom:18px;display:flex;align-items:flex-start;gap:14px">
        <div style="flex:1">
          <h1 style="font-size:28px;letter-spacing:-.01em;margin:0 0 6px">Agents orchestra</h1>
          <p class="muted" style="margin:0;max-width:820px;line-height:1.55;font-size:13.5px">
            All your active personas at a glance — what each has learned, their
            most recent memory, their most-confident belief. Auto-refreshes every
            5 seconds while this page is open so you can watch them learn in
            real time during a collect.
          </p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span id="ao-pulse" class="muted" style="font-size:11px">live · 5s</span>
          <a href="#/personas" class="btn btn-ghost-bordered btn-sm" style="text-decoration:none">Manage personas</a>
        </div>
      </div>
      <div id="ao-grid" style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill, minmax(360px, 1fr))"></div>
    </div>
  `;

  let interval = null;
  let lastTickAt = 0;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    lastTickAt = Date.now();
    const r = unwrap(await api.personaList());
    const rows = (r?.personas || []).filter(p => p.active);
    const grid = $('#ao-grid', root);
    if (!grid) return;
    if (!rows.length) {
      grid.innerHTML = '<div class="muted">no active personas — <a href="#/personas">create one</a>.</div>';
      return;
    }
    // Fetch the per-persona latest memory + top conclusion in parallel
    const enriched = await Promise.all(rows.map(async p => {
      const [memRes, conRes] = await Promise.all([
        api.personaMemories(p.id, { limit: 3 }).catch(() => null),
        api.personaConclusions(p.id, 1).catch(() => null),
      ]);
      const mems = unwrap(memRes)?.memories || [];
      const cons = unwrap(conRes)?.conclusions || [];
      return { ...p, recentMems: mems, topConclusion: cons[0] || null };
    }));
    grid.innerHTML = enriched.map(p => orchestraCard(p)).join('');
    refreshIcons();
    const pulse = $('#ao-pulse', root);
    if (pulse) pulse.textContent = `live · refreshed ${new Date().toLocaleTimeString()}`;
  }

  await tick();
  interval = setInterval(tick, 5000);

  // Auto-cleanup: when the route hands main over to another screen, the
  // root subtree is replaced. Watch for that with a MutationObserver on
  // root.parentElement (the route container itself isn't replaced; its
  // children are). When root is detached, kill the interval.
  const obs = new MutationObserver(() => {
    if (!root.isConnected) {
      stopped = true;
      if (interval) clearInterval(interval);
      obs.disconnect();
    }
  });
  if (root.parentElement) obs.observe(root.parentElement, { childList: true, subtree: false });
}

function orchestraCard(p) {
  const color = p.color || '#7c3aed';
  const s = p.stats || {};
  const recent = (p.recentMems || []).slice(0, 3);
  const con = p.topConclusion;
  return `
    <div class="card persona-card" style="border-left:4px solid ${esc(color)};cursor:default">
      <div class="card-body" style="padding:14px 16px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <div style="width:32px;height:32px;border-radius:8px;background:${esc(color)}22;color:${esc(color)};display:grid;place-items:center">
            <i data-lucide="${esc(p.icon || 'sparkles')}"></i>
          </div>
          <div style="flex:1;min-width:0">
            <a href="#/persona/${p.id}" style="text-decoration:none;color:inherit"><h3 style="margin:0;font-size:15px">${esc(p.name)}</h3></a>
            <p class="muted" style="margin:1px 0 0;font-size:11px">lens: ${esc(p.lens)} · ${s.memories || 0} mem · ${s.edges || 0} edges · ${s.conclusions || 0} concl</p>
          </div>
          <a href="#/persona/${p.id}" class="btn btn-ghost-bordered btn-sm" style="text-decoration:none;font-size:11px">Open</a>
        </div>
        ${con ? `
          <div style="margin:8px 0 10px;padding:8px 10px;background:${esc(color)}11;border-radius:6px">
            <div style="font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:${esc(color)};margin-bottom:4px">TOP BELIEF · conf ${((con.confidence||0)).toFixed(2)}</div>
            <div style="font-size:12.5px;line-height:1.4">${esc((con.statement || '').slice(0,220))}</div>
          </div>
        ` : ''}
        <div style="font-size:11px;letter-spacing:.5px;text-transform:uppercase" class="muted">RECENT MEMORIES</div>
        <div style="margin-top:6px">
          ${recent.length === 0 ? '<div class="muted" style="font-size:12px;font-style:italic">(no memories yet)</div>' :
            recent.map(m => `
              <div style="font-size:12px;line-height:1.4;padding:5px 0;border-bottom:1px solid var(--line, #2a2a2a3a)">
                <span class="muted" style="font-size:10px">[${esc(m.topic || '—')}] mem#${m.id}</span><br/>
                ${esc((m.lesson || '').slice(0,180))}
              </div>
            `).join('')
          }
        </div>
      </div>
    </div>
  `;
}

// ─── share modal ──────────────────────────────────────────────────────────

async function openShareModal(fromPersona, memoryId) {
  // Fetch all personas → exclude the donor
  let receivers = [];
  try {
    const r = unwrap(await api.personaList());
    receivers = (r?.personas || []).filter(p => p.id !== fromPersona.id && p.active);
  } catch {}

  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;background:#000a;display:flex;align-items:center;justify-content:center;z-index:9999';
  const dlg = document.createElement('div');
  dlg.style.cssText = 'background:var(--bg-elev, #1a1a1a);color:inherit;padding:20px;border-radius:10px;max-width:520px;width:90%;border:1px solid var(--border, #2a2a2a)';
  dlg.innerHTML = `
    <h3 style="margin:0 0 8px">Share mem#${memoryId} from ${esc(fromPersona.name)}</h3>
    <p class="muted" style="margin:0 0 12px;font-size:12px">
      The receiver will re-distill this lesson through their own lens. If the
      receiver already has a memory from the same source post, the share is skipped.
    </p>
    ${receivers.length === 0
      ? '<p class="muted">No other active personas to share with — create one or activate an inactive persona first.</p>'
      : `<div id="share-list" style="display:grid;gap:8px;margin-bottom:14px"></div>`
    }
    <div id="share-result" class="muted" style="font-size:12px;margin-bottom:10px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="share-close" class="btn-ghost-bordered">Close</button>
    </div>
  `;
  backdrop.appendChild(dlg);
  document.body.appendChild(backdrop);

  $('#share-close', dlg).addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

  const list = $('#share-list', dlg);
  if (list) {
    list.innerHTML = receivers.map(p => `
      <button data-rid="${p.id}" class="btn-ghost-bordered" style="display:flex;align-items:center;gap:10px;padding:10px 12px;text-align:left;cursor:pointer">
        <span style="width:26px;height:26px;border-radius:6px;background:${esc(p.color || '#7c3aed')}33;color:${esc(p.color || '#7c3aed')};display:grid;place-items:center">
          <i data-lucide="${esc(p.icon || 'sparkles')}"></i>
        </span>
        <span style="flex:1">
          <div style="font-weight:600">${esc(p.name)}</div>
          <div class="muted" style="font-size:11px">lens: ${esc(p.lens)}</div>
        </span>
        <span class="muted" style="font-size:11px">${p.stats?.memories || 0} mem</span>
      </button>
    `).join('');
    refreshIcons();
    list.querySelectorAll('button[data-rid]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const toId = parseInt(btn.dataset.rid, 10);
        const out = $('#share-result', dlg);
        out.textContent = `Re-framing through receiver's lens…`;
        btn.disabled = true;
        try {
          const r = unwrap(await api.personaShare(fromPersona.id, memoryId, toId));
          if (!r.ok) {
            out.innerHTML = `<span style="color:#b84747">${esc(r.error || 'failed')}</span>`
              + (r.existing_lesson ? `<br/><span class="muted">receiver already had: ${esc(r.existing_lesson.slice(0,200))}</span>` : '');
          } else {
            out.innerHTML = `
              <div style="color:#2da44e">✓ shared as mem#${r.new_memory_id} on ${esc(r.to_persona_name)} (+${r.edges_added || 0} edges)</div>
              <div style="margin-top:6px;line-height:1.4">${esc(r.lesson || '')}</div>
            `;
          }
        } catch (e) {
          out.innerHTML = `<span style="color:#b84747">${esc(String(e?.message || e))}</span>`;
        } finally {
          btn.disabled = false;
        }
      });
    });
  }
}
