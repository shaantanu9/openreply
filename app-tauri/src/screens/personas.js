// Persona agents — Phase 1 (2026-05-12).
//
// Two routes:
//   #/personas        → list + create + per-persona dashboard launcher
//   #/persona/<id>    → single-persona dashboard: Memories | Chat | Ingest
//
// Self-contained module. Remove the route registrations in main.js + the
// nav link in index.html + this file to fully roll back.
import { api, esc } from '../api.js';
import { confirmModal } from '../lib/confirmModal.js';
import { currentRouteGen } from '../main.js';
import { skelGrid, skelRows } from '../lib/skeleton.js';
import { withButtonBusy } from '../lib/busyButton.js';
import { confirmDestructiveAction } from '../lib/deleteConfirm.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Persona accent colours come from DB — only allow #rgb / #rrggbb for CSS injection */
function safeHexColor(c, fallback = '#7c3aed') {
  const raw = String(c ?? fallback).trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return raw;
  if (/^#[0-9A-Fa-f]{3}$/.test(raw)) return raw;
  return fallback;
}

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
    // Phase 6b — Personas should learn from the WHOLE corpus, not just the
    // topic just collected. The NOT-EXISTS dedup in _candidate_posts means
    // each post is only LLM-filtered once per persona, so cross-topic
    // sweeps are cheap — they only spend tokens on posts a given persona
    // hasn't seen yet. Lets a memory landed under one topic still find
    // links into a persona's lens from a different topic.
    const topic = payload?.topic; // kept for logging only
    const now = Date.now();
    if (now - _lastAutoIngestAt < 3000) return;
    _lastAutoIngestAt = now;
    try {
      // topic intentionally omitted so the sidecar scans the full corpus.
      await api.personaIngest({ limit: 200 });
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

  $('#np-create', root).addEventListener('click', (ev) => {
    const createBtn = ev.currentTarget;
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
    return withButtonBusy(createBtn, async () => {
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
    }, { busyLabel: 'Creating…' });
  });
}

async function reloadList(root) {
  const grid = $('#personas-list', root);
  grid.innerHTML = skelGrid(3, { lines: 3 });
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
  if (!(await confirmModal('Delete this persona and ALL its memories? This cannot be undone.'))) return;
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
    <div class="screen-pad persona-screen-pad">
      <div id="persona-head"></div>
      <div class="persona-tabs" role="tablist" aria-label="Persona sections">
        <button type="button" class="persona-tab-btn active" data-tab="memories" role="tab" aria-selected="true">Memories</button>
        <button type="button" class="persona-tab-btn" data-tab="graph" role="tab" aria-selected="false">Graph</button>
        <button type="button" class="persona-tab-btn" data-tab="conclusions" role="tab" aria-selected="false">Conclusions</button>
        <button type="button" class="persona-tab-btn" data-tab="chat" role="tab" aria-selected="false">Chat</button>
        <button type="button" class="persona-tab-btn" data-tab="ingest" role="tab" aria-selected="false">Ingest</button>
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

  const pad = root.querySelector('.persona-screen-pad');
  if (pad) pad.style.setProperty('--persona-accent', safeHexColor(persona.color));

  $('#persona-head', root).innerHTML = renderHead(persona);
  refreshIcons();

  // Phase 6c — Scan-all-corpus button. Streams persona_ingest:* events on
  // the same channel the Ingest tab's log listens to, so switching to that
  // tab while it runs shows the live progress.
  const scanBtn = $('#scan-corpus', root);
  const learnAllBtn = $('#learn-all', root);
  const scanStatus = $('#scan-status', root);
  if (scanBtn || learnAllBtn) {
    let kept = 0, dropped = 0, errors = 0, running = false;
    let progressUnsub = null, doneUnsub = null;
    const allBtns = [scanBtn, learnAllBtn].filter(Boolean);
    async function detach() {
      if (progressUnsub) { try { await progressUnsub(); } catch {} progressUnsub = null; }
      if (doneUnsub)     { try { await doneUnsub();     } catch {} doneUnsub = null; }
    }
    // Shared streaming-ingest runner for both buttons. `limit` is how many
    // un-seen posts to distill (500 for the quick scan; the full un-ingested
    // count for "Learn from all"). Posts are distilled in batches of 8 on the
    // Python side, so this is resumable + idempotent (NOT-EXISTS filter).
    async function runIngest(triggerBtn, limit, busyLabel) {
      if (running) return;
      running = true;
      kept = dropped = errors = 0;
      allBtns.forEach(b => { b.disabled = true; });
      const orig = triggerBtn.innerHTML;
      triggerBtn.innerHTML = `<i data-lucide="loader-2" style="width:12px;height:12px"></i>${esc(busyLabel)}`;
      refreshIcons();
      scanStatus.textContent = 'starting…';
      const restore = () => {
        allBtns.forEach(b => { b.disabled = false; });
        triggerBtn.innerHTML = orig;
        refreshIcons();
        running = false;
      };
      progressUnsub = await api.onPersonaIngestProgress(payload => {
        const t = String(payload || '').trim();
        if (!t) return;
        try {
          const ev = JSON.parse(t);
          if (ev.event === 'start')   scanStatus.textContent = `0 / ${ev.candidates} posts processed`;
          else if (ev.event === 'memory') { kept++; scanStatus.textContent = `${kept + dropped + errors} done — ${kept} learned`; }
          else if (ev.event === 'skip')   { dropped++; scanStatus.textContent = `${kept + dropped + errors} done — ${kept} learned`; }
          else if (ev.event === 'error')  { errors++; }
        } catch {}
      });
      doneUnsub = await api.onPersonaIngestDone(async () => {
        scanStatus.textContent = `done — ${kept} new memories${errors ? ` · ${errors} errors` : ''}`;
        restore();
        await detach();
        // Refresh the head + currently-active tab so new counts/memories show
        try {
          const r = unwrap(await api.personaList());
          const fresh = (r?.personas || []).find(p => p.id === persona.id);
          if (fresh) {
            Object.assign(persona, fresh);
            $('#persona-head', root).innerHTML = renderHead(persona);
            refreshIcons();
            const active = $('.persona-tab-btn.active', root);
            if (active) mountTab(active.dataset.tab, $('#persona-body', root), persona);
          }
        } catch {}
      });
      try {
        await api.personaIngest({ personaId: persona.id, limit });
      } catch (e) {
        scanStatus.textContent = 'error: ' + String(e?.message || e);
        restore();
        await detach();
      }
    }

    if (scanBtn) {
      scanBtn.addEventListener('click', () => runIngest(scanBtn, 500, 'Scanning…'));
    }
    if (learnAllBtn) {
      learnAllBtn.addEventListener('click', async () => {
        if (running) return;
        scanStatus.textContent = 'counting corpus…';
        // Count un-ingested posts via the native rusqlite read path (daemon-
        // free, sub-10ms) so the confirm shows the real scale.
        let count = 0;
        try {
          const rows = await api.runQuery(
            'SELECT count(*) AS n FROM posts p WHERE NOT EXISTS '
            + '(SELECT 1 FROM persona_memories m WHERE m.persona_id = CAST(:pid AS INTEGER) '
            + 'AND m.source_post_id = p.id)',
            null,
            { pid: String(persona.id) },
          );
          count = Number((rows && rows[0] && rows[0].n) || 0);
        } catch (e) {
          scanStatus.textContent = 'could not count corpus: ' + String(e?.message || e);
          return;
        }
        if (count <= 0) {
          scanStatus.textContent = 'nothing new — this persona has already learned from the whole corpus';
          return;
        }
        const batches = Math.ceil(count / 8);
        scanStatus.textContent = `${count.toLocaleString()} new posts available`;
        const ok = await confirmDestructiveAction({
          title: `Learn from all ${count.toLocaleString()} posts?`,
          body: `${persona.name} will distill every corpus post it hasn't seen yet — about ${batches.toLocaleString()} LLM calls (8 posts per call). This can take a while and use tokens. You can keep using the app; progress streams here and in the Ingest tab. It's resumable — re-run any time and only un-learned posts are processed.`,
          matchText: persona.name,
          confirmLabel: 'Learn from all',
          confirmDanger: false,
          caseInsensitive: true,
          hint: `type "${persona.name}" to confirm`,
        });
        if (!ok) { scanStatus.textContent = ''; return; }
        runIngest(learnAllBtn, count, 'Learning…');
      });
    }
  }

  const tabBtns = $$('.persona-tab-btn', root);
  tabBtns.forEach(b => b.addEventListener('click', () => {
    tabBtns.forEach(x => {
      const on = x === b;
      x.classList.toggle('active', on);
      x.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    mountTab(b.dataset.tab, $('#persona-body', root), persona);
  }));
  mountTab('memories', $('#persona-body', root), persona);
}

function renderHead(p) {
  const s = p.stats || {};
  return `
    <div class="persona-detail-head">
      <div class="persona-icon">
        <i data-lucide="${esc(p.icon || 'sparkles')}" style="width:24px;height:24px"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div class="persona-detail-row1">
          <h1>${esc(p.name)}</h1>
          <span class="persona-lens-chip">${esc(p.lens)}</span>
          <span class="persona-status-chip ${p.active ? 'is-active' : ''}">${p.active ? 'active' : 'paused'}</span>
        </div>
        <p>${esc(p.goal)}</p>
        <div class="persona-stat-row">
          <span><strong>${s.memories || 0}</strong> memories</span>
          <span><strong>${s.topics_seen || 0}</strong> topics</span>
          <span><strong>${s.edges || 0}</strong> edges</span>
          <span><strong>${s.conclusions || 0}</strong> conclusions</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          <button id="scan-corpus" type="button" class="btn btn-ghost btn-sm btn-bordered" title="Quick sweep — LLM-filters up to the next 500 corpus posts this persona hasn't seen yet. Good for a fast top-up.">
            <i data-lucide="search" style="width:12px;height:12px"></i>
            Scan 500
          </button>
          <button id="learn-all" type="button" class="btn btn-primary btn-sm" title="Have this persona learn from EVERY corpus post it hasn't seen yet — the full corpus, not just 500. Distills 8 posts per LLM call. Shows the exact count + a confirm before running, and is resumable.">
            <i data-lucide="brain" style="width:12px;height:12px"></i>
            Learn from all
          </button>
        </div>
        <span id="scan-status" class="muted" style="font-size:11px;min-height:14px;font-feature-settings:'tnum' 1"></span>
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
    <div class="persona-toolbar">
      <span class="persona-toolbar-hint">All ${esc(persona.name)}'s distilled lessons — newest first. Click <strong>Share →</strong> on any memory to push it through another persona's lens.</span>
      <label>Topic<input id="m-topic" type="text" placeholder="(all)"></label>
      <label>Limit<input id="m-limit" type="number" value="50" min="1" max="500"></label>
      <button id="m-refresh" class="btn btn-ghost btn-bordered btn-sm"><i data-lucide="rotate-ccw" style="width:12px;height:12px"></i>Refresh</button>
    </div>
    <div id="m-list" class="persona-list"></div>
  `;
  async function load() {
    const listEl = $('#m-list', host);
    listEl.innerHTML = skelRows(5);
    const topic = $('#m-topic', host).value.trim() || null;
    const limit = parseInt($('#m-limit', host).value, 10) || 50;
    const r = unwrap(await api.personaMemories(persona.id, { topic, limit }));
    const rows = r?.memories || [];
    if (!rows.length) {
      listEl.innerHTML = `<div class="persona-empty">No memories yet${topic ? ` for topic <strong>${esc(topic)}</strong>` : ''} — open the <strong>Ingest</strong> tab to run a pass over your corpus.</div>`;
      return;
    }
    listEl.innerHTML = rows.map(m => `
      <article class="persona-mem-card" data-mem-id="${m.id}">
        <div class="persona-mem-meta">
          <span class="persona-topic-chip">${esc(m.topic || '—')}</span>
          <span>importance ${(m.importance ?? 0).toFixed(2)}</span>
          <span>·</span>
          <span>${fmtTime(m.created_at)}</span>
          <span class="persona-mem-id">mem#${m.id}</span>
          <button type="button" data-act="share" class="btn btn-ghost btn-bordered btn-sm persona-share-btn" title="Share this memory with another persona — they'll re-frame it through their own lens"><i data-lucide="share-2" style="width:11px;height:11px"></i>Share</button>
        </div>
        <p class="persona-mem-lesson">${esc(m.lesson || '')}</p>
        ${m.excerpt ? `<p class="persona-mem-excerpt">"${esc(m.excerpt)}"</p>` : ''}
        ${m.post_title ? `<p class="persona-mem-source">source: ${esc(m.post_source || '?')} — ${esc(m.post_title.slice(0,90))}${m.post_url ? ` <a href="${esc(m.post_url)}" target="_blank" rel="noopener">↗</a>` : ''}</p>` : ''}
      </article>
    `).join('');
    refreshIcons();
    $$('.persona-mem-card', listEl).forEach(card => {
      const btn = card.querySelector('[data-act="share"]');
      if (btn) btn.addEventListener('click', () => openShareModal(persona, parseInt(card.dataset.memId, 10)));
    });
  }
  $('#m-refresh', host).addEventListener('click', (ev) => withButtonBusy(ev.currentTarget, load, { busyLabel: 'Refreshing…' }));
  $('#m-topic', host).addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
  await load();
}

async function mountChatTab(host, persona) {
  const accentSafe = safeHexColor(persona.color);
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
    <div class="persona-toolbar">
      <span class="persona-toolbar-hint">Memory graph — node size encodes importance, edge thickness encodes cosine similarity. Drag nodes to explore, hover to read.</span>
      <button id="g-refresh"  class="btn btn-ghost btn-bordered btn-sm"><i data-lucide="rotate-ccw" style="width:12px;height:12px"></i>Refresh</button>
      <button id="g-backfill" class="btn btn-ghost btn-bordered btn-sm" title="Re-embed every memory and recompute every edge from scratch"><i data-lucide="layers" style="width:12px;height:12px"></i>Backfill</button>
    </div>
    <div id="g-stage" class="persona-graph-stage">
      <svg id="g-svg" width="100%" height="100%" style="display:block"></svg>
      <div id="g-tooltip" class="persona-graph-tooltip"></div>
      <div id="g-empty" class="persona-graph-empty" style="display:none"></div>
    </div>
  `;
  refreshIcons();
  const svg = $('#g-svg', host);
  const tip = $('#g-tooltip', host);
  const empty = $('#g-empty', host);

  async function load() {
    svg.innerHTML = '';
    empty.style.display = 'grid';
    empty.textContent = 'Loading graph…';
    const r = unwrap(await api.personaGraph(persona.id));
    const g = (r && r.graph) || { nodes: [], edges: [] };
    if (!g.nodes.length) {
      empty.innerHTML = '<div>No graph yet — open the <strong>Ingest</strong> tab to land some memories, or click <strong>Backfill</strong> to re-embed existing ones.</div>';
      return;
    }
    empty.style.display = 'none';
    drawForceGraph(svg, tip, g, persona);
  }

  $('#g-refresh', host).addEventListener('click', (ev) => withButtonBusy(ev.currentTarget, load, { busyLabel: 'Refreshing…' }));
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
    <div class="persona-toolbar">
      <span class="persona-toolbar-hint">Synthesised beliefs — each clusters densely-connected memories into one falsifiable statement, ranked by confidence.</span>
      <button id="c-refresh"   class="btn btn-ghost btn-bordered btn-sm"><i data-lucide="rotate-ccw" style="width:12px;height:12px"></i>Refresh</button>
      <button id="c-synthesise" class="btn btn-primary btn-sm"><i data-lucide="sparkles" style="width:12px;height:12px"></i>Synthesise</button>
    </div>
    <div id="c-log" class="persona-mono-log" style="display:none;margin-bottom:14px;max-height:240px;overflow-y:auto"></div>
    <div id="c-list" class="persona-list"></div>

    <div class="persona-contradictions">
      <div class="persona-section-label">Contradictions · shares this lens refused</div>
      <div id="c-rejections"></div>
    </div>
  `;
  refreshIcons();

  async function load() {
    const listEl = $('#c-list', host);
    listEl.innerHTML = skelRows(4);
    const r = unwrap(await api.personaConclusions(persona.id));
    const rows = r?.conclusions || [];
    if (!rows.length) {
      listEl.innerHTML = '<div class="persona-empty">No conclusions yet — click <strong>Synthesise</strong> above. Needs at least 3 memories connected by cosine edges ≥ 0.50.</div>';
      return;
    }
    listEl.innerHTML = rows.map(c => `
      <article class="persona-concl-card">
        <div class="persona-concl-meta">
          <span class="persona-conf-chip">confidence ${(c.confidence || 0).toFixed(2)}</span>
          <span>${(c.evidence || []).length} supporting memories</span>
          <span class="persona-mem-id">${fmtTime(c.updated_at || c.created_at)}</span>
        </div>
        <p class="persona-concl-statement">${esc(c.statement || '')}</p>
        <details class="persona-concl-evidence">
          <summary>evidence — mem ${(c.evidence || []).join(', ')}</summary>
          <div>Scroll to those memory ids in the <strong>Memories</strong> tab to read the source lessons.</div>
        </details>
      </article>
    `).join('');
  }

  async function loadRejections() {
    const box = $('#c-rejections', host);
    if (!box) return;
    box.innerHTML = skelRows(3);
    try {
      const r = unwrap(await api.personaRejections(persona.id, { direction: 'as_receiver', limit: 20 }));
      const rows = r?.rejections || [];
      if (!rows.length) {
        box.innerHTML = '<div class="persona-empty">No shares refused yet. When another persona shares a memory to this one and the lens says "not relevant", the rejection will land here — building a map of where worldviews diverge.</div>';
        return;
      }
      box.innerHTML = rows.map(j => `
        <article class="persona-rejection-card">
          <div class="persona-rejection-meta">${esc(j.from_name || '?')} (${esc(j.from_lens || '?')}) → refused · ${fmtTime(j.created_at)}</div>
          <div class="persona-rejection-donor">donor said: <em>"${esc((j.donor_lesson || '').slice(0, 220))}"</em></div>
          <div class="persona-rejection-reason">reason: ${esc(j.reason || '')}</div>
        </article>
      `).join('');
    } catch (e) {
      box.innerHTML = `<div class="persona-empty">error: ${esc(String(e?.message || e))}</div>`;
    }
  }
  $('#c-refresh', host).addEventListener('click', (ev) =>
    withButtonBusy(ev.currentTarget, () => Promise.all([load(), loadRejections()]), { busyLabel: 'Refreshing…' }));

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
    <div style="max-width:820px;display:flex;flex-direction:column;gap:18px">
      <section class="card persona-teach-card" style="border-left:4px solid ${esc(persona.color || '#7c3aed')}">
        <div class="card-head" style="padding:14px 18px 0">
          <div>
            <h3 style="display:flex;align-items:center;gap:8px">
              <i data-lucide="graduation-cap" style="width:16px;height:16px"></i>
              Teach ${esc(persona.name)} from a video
            </h3>
            <p>Paste a <strong>YouTube</strong> or <strong>Instagram</strong> link. ${esc(persona.name)} reads the speaker's words (transcript) — plus, on YouTube, the description and top commenter reactions — all filtered through the <strong style="color:${esc(persona.color || '#7c3aed')}">${esc(persona.lens)}</strong> lens. Instagram is transcribed on-device with Whisper (the first one downloads the model).</p>
          </div>
        </div>
        <div class="card-body" style="display:grid;gap:12px;padding-top:12px">
          <div class="np-form" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
            <label class="np-field" style="flex:1;min-width:280px">
              <span>YouTube or Instagram URL</span>
              <input id="teach-url" type="text" placeholder="youtu.be/…  ·  youtube.com/watch?v=…  ·  instagram.com/reel/…" />
            </label>
            <label class="np-field" style="width:120px">
              <span>Comments</span>
              <input id="teach-comments" type="number" value="100" min="0" max="500" />
            </label>
            <button id="teach-run" class="btn btn-primary btn-sm" style="height:38px">
              <i data-lucide="brain" style="width:14px;height:14px"></i>
              Teach
            </button>
          </div>
          <p class="muted" style="font-size:11.5px;margin:0;line-height:1.5">
            Already-learned content is skipped automatically, so re-running with the same URL is safe.
          </p>
        </div>
      </section>

      <section>
        <div style="display:flex;align-items:center;gap:8px;margin:0 0 8px">
          <h3 style="margin:0;font-size:14px;font-weight:700;letter-spacing:-.01em">Or scan the existing corpus</h3>
        </div>
        <p class="muted" style="line-height:1.55;margin:0 0 10px;font-size:12.5px">
          Scans posts in your corpus that <strong>${esc(persona.name)}</strong> hasn't read yet,
          filters them through the lens, and stores any relevant lesson in this persona's memory.
          Safe to re-run — already-ingested posts are skipped.
        </p>
        <div class="persona-toolbar">
          <label>Limit<input id="in-limit" type="number" value="50" min="1" max="500"></label>
          <label>Topic<input id="in-topic" type="text" placeholder="(all topics)"></label>
          <span style="flex:1"></span>
          <button id="in-peers" class="btn btn-ghost btn-bordered btn-sm" title="Ingest other personas' conclusions through THIS persona's lens — the persona-of-personas / meta-agent pass"><i data-lucide="users" style="width:12px;height:12px"></i>Ingest peers</button>
          <button id="in-run" class="btn btn-primary btn-sm"><i data-lucide="play" style="width:12px;height:12px"></i>Run ingest</button>
        </div>
      </section>

      <div id="in-log" class="persona-mono-log persona-mono-log--ingest"></div>
    </div>
  `;
  refreshIcons();
  const log = $('#in-log', host);
  function line(text, kind = '') {
    const div = document.createElement('div');
    if (kind) div.className = `persona-log-line--${kind}`;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  // Shared NDJSON event renderer — handles the regular ingest, peer ingest,
  // AND the teach-from-video stream (which prepends `teach:*` events before
  // the standard ingest ones). Returns silently for events it doesn't know
  // so a future event type doesn't bleed raw JSON into the log.
  function renderEvent(ev, opts = {}) {
    const label = opts.label || 'ingest';
    const memoryPrefix = opts.memoryPrefix || 'mem';
    if (!ev || typeof ev !== 'object') return;
    switch (ev.event) {
      case 'teach:start':
        line(`▶ teaching — video=${ev.video_id}`, 'info');
        return;
      case 'teach:fetched':
        line(`  fetched ${ev.rows} rows (${ev.comments} comments · ${ev.transcript} transcript chunks · ${ev.description} description)`, 'info');
        return;
      case 'teach:error':
        line(`  ✗ teach: ${(ev.error || '').slice(0, 200)}`, 'err');
        return;
      case 'start':
        line(`  ${label} start — ${ev.candidates} candidates`);
        return;
      case 'memory':
        line(`  ✓ ${memoryPrefix}#${ev.memory_id}: ${(ev.lesson || '').slice(0, 150)}`);
        return;
      case 'skip':
        line(`  · skip (${ev.reason})`, 'info');
        return;
      case 'error':
        line(`  ✗ ${(ev.error || '').slice(0, 200)}`, 'err');
        return;
      case 'done':
        line(`  ▶ ${label} done — kept=${ev.kept} dropped=${ev.dropped} errors=${ev.errors}`);
        return;
    }
  }

  let progressUnsub, doneUnsub;

  // Resets stream subscriptions before each run so old listeners don't pile
  // up on rapid re-runs.
  async function attachStream(opts) {
    if (progressUnsub) await progressUnsub();
    if (doneUnsub) await doneUnsub();
    progressUnsub = await api.onPersonaIngestProgress(payload => {
      const t = String(payload || '').trim();
      if (!t) return;
      try { renderEvent(JSON.parse(t), opts); } catch { line(t); }
    });
    doneUnsub = await api.onPersonaIngestDone(_payload => {
      line(`✔ ${opts.label || 'ingest'} complete`, 'ok');
      if (progressUnsub) progressUnsub();
      if (doneUnsub) doneUnsub();
    });
  }

  $('#teach-run', host).addEventListener('click', async () => {
    const url = $('#teach-url', host).value.trim();
    const commentsLimit = parseInt($('#teach-comments', host).value, 10);
    if (!url) {
      line('paste a YouTube URL above first', 'err');
      return;
    }
    log.innerHTML = '';
    const btn = $('#teach-run', host);
    btn.disabled = true;
    const restore = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader-2" style="width:14px;height:14px"></i>Teaching…';
    refreshIcons();
    line(`▶ teaching ${persona.name} from ${url}`, 'info');
    await attachStream({ label: 'teach' });
    try {
      await api.personaTeachVideo(persona.id, url, {
        commentsLimit: Number.isFinite(commentsLimit) ? commentsLimit : 100,
      });
    } catch (e) {
      line('error: ' + String(e?.message || e), 'err');
    } finally {
      btn.disabled = false;
      btn.innerHTML = restore;
      refreshIcons();
    }
  });
  $('#teach-url', host).addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#teach-run', host).click();
  });

  $('#in-run', host).addEventListener('click', async () => {
    log.innerHTML = '';
    const limit = parseInt($('#in-limit', host).value, 10) || 50;
    const topic = $('#in-topic', host).value.trim() || null;
    line(`▶ starting ingest (persona=${persona.name}, topic=${topic || '(all)'}, limit=${limit})`, 'info');
    await attachStream({ label: 'ingest' });
    try {
      await api.personaIngest({ personaId: persona.id, topic, limit });
    } catch (e) {
      line('error: ' + String(e?.message || e), 'err');
    }
  });

  // Peer ingest (Phase 4a)
  $('#in-peers', host)?.addEventListener('click', async () => {
    log.innerHTML = '';
    const limit = parseInt($('#in-limit', host).value, 10) || 50;
    line(`▶ starting peer-ingest (persona=${persona.name}, limit=${limit})`, 'info');
    await attachStream({ label: 'peer ingest', memoryPrefix: 'meta-mem' });
    try {
      await api.personaIngestPeers(persona.id, limit);
    } catch (e) {
      line('error: ' + String(e?.message || e), 'err');
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
    <div class="screen-pad personas-screen" style="padding:24px 28px 48px;max-width:1400px;margin:0 auto">
      <div class="persona-orchestra-head">
        <div style="flex:1;min-width:0">
          <h1>Agents orchestra</h1>
          <p class="muted" style="margin:0;max-width:820px;line-height:1.55;font-size:13.5px">
            All your active personas at a glance — lens, counts, top belief, and the three most-recent memories.
            Auto-refreshes every 5 seconds so you can watch them learn in real time during a collect.
          </p>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
          <span id="ao-pulse" class="persona-orchestra-pulse">live · 5s</span>
          <a href="#/personas" class="btn btn-ghost btn-bordered btn-sm" style="text-decoration:none"><i data-lucide="settings-2" style="width:12px;height:12px"></i>Manage personas</a>
        </div>
      </div>
      <div id="ao-grid" class="persona-orchestra-grid"></div>
    </div>
  `;
  refreshIcons();

  let interval = null;
  let stopped = false;
  // Capture the route generation we mounted under. main.js bumps a counter
  // on every navigation; when it doesn't equal `myGen` anymore, the user
  // has navigated away and we must stop polling. The previous MutationObserver
  // approach didn't fire because route() replaces root.innerHTML (root stays
  // connected; only its children change), so the dashboard polled forever.
  const myGen = currentRouteGen();

  function stop() {
    if (stopped) return;
    stopped = true;
    if (interval) clearInterval(interval);
  }

  async function tick() {
    if (stopped || currentRouteGen() !== myGen) { stop(); return; }
    const r = unwrap(await api.personaList());
    if (currentRouteGen() !== myGen) { stop(); return; }
    const rows = (r?.personas || []).filter(p => p.active);
    const grid = $('#ao-grid', root);
    if (!grid) { stop(); return; }
    if (!rows.length) {
      grid.innerHTML = '<div class="persona-empty">No active personas — <a href="#/personas">create one</a> or activate an inactive persona.</div>';
      return;
    }
    const enriched = await Promise.all(rows.map(async p => {
      const [memRes, conRes] = await Promise.all([
        api.personaMemories(p.id, { limit: 3 }).catch(() => null),
        api.personaConclusions(p.id, 1).catch(() => null),
      ]);
      const mems = unwrap(memRes)?.memories || [];
      const cons = unwrap(conRes)?.conclusions || [];
      return { ...p, recentMems: mems, topConclusion: cons[0] || null };
    }));
    if (currentRouteGen() !== myGen) { stop(); return; }
    grid.innerHTML = enriched.map(p => orchestraCard(p)).join('');
    refreshIcons();
    const pulse = $('#ao-pulse', root);
    if (pulse) pulse.textContent = `live · refreshed ${new Date().toLocaleTimeString()}`;
  }

  await tick();
  interval = setInterval(tick, 5000);

  const onLeave = () => {
    stop();
    window.removeEventListener('hashchange', onLeave);
  };
  window.addEventListener('hashchange', onLeave);
}

function orchestraCard(p) {
  const accent = safeHexColor(p.color);
  const s = p.stats || {};
  const recent = (p.recentMems || []).slice(0, 3);
  const con = p.topConclusion;
  return `
    <article class="persona-orchestra-card" style="--persona-accent:${accent}">
      <div class="persona-orchestra-row1">
        <div class="persona-icon" style="width:36px;height:36px;border-radius:10px">
          <i data-lucide="${esc(p.icon || 'sparkles')}"></i>
        </div>
        <div style="flex:1;min-width:0">
          <h3 class="persona-orchestra-name"><a href="#/persona/${p.id}">${esc(p.name)}</a></h3>
          <p class="persona-orchestra-sub">lens: ${esc(p.lens)} · ${s.memories || 0} mem · ${s.edges || 0} edges · ${s.conclusions || 0} concl</p>
        </div>
        <a href="#/persona/${p.id}" class="btn btn-ghost btn-bordered btn-sm" style="text-decoration:none">Open</a>
      </div>
      ${con ? `
        <div class="persona-orchestra-belief">
          <div class="persona-belief-label">Top belief · conf ${((con.confidence || 0)).toFixed(2)}</div>
          <div class="persona-belief-body">${esc((con.statement || '').slice(0, 240))}</div>
        </div>
      ` : ''}
      <div class="persona-orchestra-recent">Recent memories</div>
      <div>
        ${recent.length === 0
          ? '<div class="persona-empty" style="padding:8px 12px;font-size:12px">No memories yet — run an ingest from the Personas screen.</div>'
          : recent.map(m => `
            <div class="persona-orchestra-mem">
              <span class="persona-orchestra-mem-meta">[${esc(m.topic || '—')}] mem#${m.id}</span>
              ${esc((m.lesson || '').slice(0, 180))}
            </div>
          `).join('')
        }
      </div>
    </article>
  `;
}

// ─── share modal ──────────────────────────────────────────────────────────

async function openShareModal(fromPersona, memoryId) {
  let receivers = [];
  try {
    const r = unwrap(await api.personaList());
    receivers = (r?.personas || []).filter(p => p.id !== fromPersona.id && p.active);
  } catch {}

  const backdrop = document.createElement('div');
  backdrop.className = 'persona-share-backdrop';
  const dlg = document.createElement('div');
  dlg.className = 'persona-share-dialog';
  dlg.style.setProperty('--persona-accent', safeHexColor(fromPersona.color));
  dlg.innerHTML = `
    <h3 style="margin:0 0 6px;font-size:17px;letter-spacing:-.005em">Share mem#${memoryId}</h3>
    <p class="muted" style="margin:0 0 16px;font-size:12.5px;line-height:1.5">
      From <strong>${esc(fromPersona.name)}</strong> — the receiver will re-distill this lesson through their own lens.
      If the receiver already has a memory from the same source post, the share is skipped.
    </p>
    ${receivers.length === 0
      ? '<div class="persona-empty">No other active personas to share with — create one or activate an inactive persona first.</div>'
      : `<div id="share-list" class="persona-share-list"></div>`
    }
    <div id="share-result" style="display:none"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button id="share-close" type="button" class="btn btn-ghost btn-bordered btn-sm">Close</button>
    </div>
  `;
  backdrop.appendChild(dlg);
  document.body.appendChild(backdrop);

  // Single close path so we never leak the keydown listener — close()
  // is idempotent. Was bug: prior version only removed the keydown
  // handler on Esc; clicking Close or the backdrop left it attached
  // forever (memory leak + would intercept Esc on the next screen).
  let closed = false;
  const escHandler = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', escHandler);
    backdrop.remove();
  }
  document.addEventListener('keydown', escHandler);
  $('#share-close', dlg).addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  const list = $('#share-list', dlg);
  if (list) {
    list.innerHTML = receivers.map(p => `
      <button type="button" data-rid="${p.id}" class="persona-share-row" style="--persona-accent:${safeHexColor(p.color)}">
        <span class="persona-share-icon">
          <i data-lucide="${esc(p.icon || 'sparkles')}"></i>
        </span>
        <span style="flex:1;min-width:0">
          <div class="persona-share-name">${esc(p.name)}</div>
          <div class="persona-share-sub">lens: ${esc(p.lens)}</div>
        </span>
        <span class="persona-share-sub" style="margin-left:auto">${p.stats?.memories || 0} mem</span>
      </button>
    `).join('');
    refreshIcons();
    list.querySelectorAll('button[data-rid]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const toId = parseInt(btn.dataset.rid, 10);
        const out = $('#share-result', dlg);
        out.style.display = 'block';
        out.className = 'persona-share-result';
        out.textContent = "Re-framing through receiver's lens…";
        btn.disabled = true;
        try {
          const r = unwrap(await api.personaShare(fromPersona.id, memoryId, toId));
          if (!r.ok) {
            out.className = 'persona-share-result persona-share-result--err';
            out.innerHTML = `<strong>${esc(r.error || 'failed')}</strong>`
              + (r.existing_lesson ? `<div style="margin-top:4px;font-style:italic;opacity:.85">receiver already had: "${esc(r.existing_lesson.slice(0, 220))}"</div>` : '');
          } else {
            out.className = 'persona-share-result persona-share-result--ok';
            out.innerHTML = `
              <div style="font-weight:600;margin-bottom:4px">✓ shared as mem#${r.new_memory_id} on ${esc(r.to_persona_name)} (+${r.edges_added || 0} edges)</div>
              <div style="line-height:1.45">${esc(r.lesson || '')}</div>
            `;
          }
        } catch (e) {
          out.className = 'persona-share-result persona-share-result--err';
          out.textContent = String(e?.message || e);
        } finally {
          btn.disabled = false;
        }
      });
    });
  }
}
