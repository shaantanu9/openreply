// Empathy Map screen — Dave Gray (2010), popularised by Stanford d.school.
//
// Two routes:
//   #/empathy             → topic picker
//   #/empathy/<topic>     → Says / Thinks / Does / Feels grid +
//                           Says-vs-Does gap note. Build / refresh button
//                           runs research/empathy.py which mines the
//                           corpus + LLM-fills the grid (offline fallback
//                           for users without an LLM key).
//
// Design: matches Home/Topics design language — slash crumbs +
// topbar-spacer, card-head/card-body, btn-primary/btn-ghost-bordered.
import { api, esc } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);

function isMissingMapError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('not found');
}

function isNoLlmError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('no llm')
    || msg.includes('not connected')
    || msg.includes('api keys')
    || msg.includes('all configured llm providers failed');
}

function topicFromHash() {
  const h = location.hash || '';
  const m = h.match(/^#\/empathy\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

const QUAD_META = {
  says:   { label: 'Says',   sub: 'Verbatim quotes from posts',  icon: 'quote',         tone: 'sky' },
  thinks: { label: 'Thinks', sub: 'Inferred beliefs',            icon: 'brain',         tone: 'lavender' },
  does:   { label: 'Does',   sub: 'Workarounds + behaviour',     icon: 'tool',          tone: 'mint' },
  feels:  { label: 'Feels',  sub: 'Emotion clusters',            icon: 'heart',         tone: 'peach' },
};

function quadrant(kind, items) {
  const m = QUAD_META[kind];
  const list = (items || []).map(i => `<li>${esc(i)}</li>`).join('');
  const empty = !items?.length ? `<li class="muted">_(none yet)_</li>` : '';
  return `
    <div class="card empathy-quadrant q-${kind}">
      <div class="card-head" style="padding:12px 16px">
        <div style="display:flex;gap:10px;align-items:center">
          <div class="stat-icon ${m.tone}" style="width:30px;height:30px;border-radius:8px"><i data-lucide="${m.icon}"></i></div>
          <div>
            <h3>${m.label}</h3>
            <p>${m.sub}</p>
          </div>
        </div>
      </div>
      <div class="card-body" style="padding:14px 18px">
        <ul class="empathy-quad-list">${list}${empty}</ul>
      </div>
    </div>
  `;
}

function renderEmpathyShell(topic, persona, map, state) {
  const banner = (() => {
    if (state === 'offline') {
      return `<div class="empathy-banner muted">⚠ The last build ran in offline mode (LLM unavailable). <em>Says</em>, <em>Does</em>, and <em>Feels</em> are seeded from the corpus; <em>Thinks</em> and the gap-note need an LLM.</div>`;
    }
    if (state === 'never_built') {
      return `<div class="empathy-banner muted">No empathy map yet for this persona. Click <b>Build / refresh</b> to mine the corpus.</div>`;
    }
    if (state === 'empty_corpus') {
      return `<div class="empathy-banner muted">No matching corpus posts found for persona <b>${esc(persona)}</b>. Run a collect on this topic first, then come back.</div>`;
    }
    return '';
  })();
  const updated = map?.updated_at
    ? `Last updated ${new Date(map.updated_at).toLocaleString()}`
    : 'Never built';
  return `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/empathy">Empathy Maps</a> /
        <strong>${esc(topic)}</strong>
      </div>
      <div class="topbar-spacer"></div>
      <input id="empathy-persona" type="text" value="${esc(persona)}"
             placeholder="persona"
             style="padding:8px 12px;border:1px solid var(--line);border-radius:8px;font-size:12.5px;width:200px;background:var(--surface);color:var(--ink)"/>
      <button class="btn btn-primary btn-sm icon-btn" id="empathy-build">
        <i data-lucide="refresh-cw"></i> Build / refresh
      </button>
    </header>

    ${banner}

    <div class="section-head">
      <div>
        <h2>Empathy Map · <em>${esc(persona)}</em></h2>
        <p>${esc(updated)} — Says, Thinks, Does, Feels per persona</p>
      </div>
    </div>

    <section class="empathy-grid">
      ${quadrant('says',   map?.says)}
      ${quadrant('thinks', map?.thinks)}
      ${quadrant('does',   map?.does)}
      ${quadrant('feels',  map?.feels)}
    </section>

    <div class="card" style="margin-top:18px">
      <div class="card-head">
        <div>
          <h3>Says vs. Does — the latent insight</h3>
          <p>Where the gap between what users say and what they do reveals unmet need</p>
        </div>
      </div>
      <div class="card-body">
        <p style="font-size:13.5px;line-height:1.7;margin:0">
          ${(map?.gap_notes || '<span class="muted">No gap note yet — click Build to mine the corpus and fill all five sections.</span>')}
        </p>
      </div>
    </div>
  `;
}

async function renderTopicEmpathy(root, topic) {
  const persona =
    new URLSearchParams((location.hash.split('?')[1] || '')).get('persona')
    || 'primary';

  root.innerHTML = `<div class="empty-state">Loading empathy map…</div>`;
  let result;
  try {
    result = await api.empathyGet(topic, persona);
  } catch (e) {
    if (isMissingMapError(e) || isNoLlmError(e)) {
      try {
        await api.runEmpathyBuild(topic, persona);
        result = await api.empathyGet(topic, persona);
      } catch (bootstrapErr) {
        if (isNoLlmError(bootstrapErr)) {
          root.innerHTML = `<div class="empty-big"><h3>No LLM configured</h3><p>The empathy map can still run in offline mode from local corpus data. Click Build / refresh to try again.</p></div>`;
        } else {
          root.innerHTML = `<div class="empty-big"><h3>Couldn't load empathy map</h3><p>${esc(bootstrapErr?.message || bootstrapErr)}</p></div>`;
        }
        return;
      }
    } else {
      root.innerHTML = `<div class="empty-big"><h3>Couldn't load empathy map</h3><p>${esc(e?.message || e)}</p></div>`;
      return;
    }
  }

  const exists = !!result?.ok;
  const map = exists ? result : null;
  let state;
  if (!exists) {
    state = 'never_built';
  } else if (map?.built_offline) {
    state = 'offline';
  } else {
    const totalSignals =
      (map?.says?.length || 0) +
      (map?.thinks?.length || 0) +
      (map?.does?.length || 0) +
      (map?.feels?.length || 0);
    state = totalSignals === 0 ? 'empty_corpus' : 'llm';
  }

  root.innerHTML = renderEmpathyShell(topic, persona, map, state);
  window.refreshIcons?.();

  $('#empathy-build', root)?.addEventListener('click', async () => {
    const btn = $('#empathy-build', root);
    const personaIn = ($('#empathy-persona', root)?.value || 'primary').trim() || 'primary';
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader"></i> Building…';
    window.refreshIcons?.();
    try {
      const out = await api.runEmpathyBuild(topic, personaIn);
      if (out?.ok === false) throw new Error(out.error || 'build failed');
      location.hash = `#/empathy/${encodeURIComponent(topic)}?persona=${encodeURIComponent(personaIn)}&t=${Date.now()}`;
      setTimeout(() => renderTopicEmpathy(root, topic), 0);
    } catch (e) {
      const msg = isNoLlmError(e)
        ? 'No LLM configured — offline mode is available.'
        : `Couldn't build empathy map: ${e?.message || e}`;
      alert(msg);
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="refresh-cw"></i> Build / refresh';
      window.refreshIcons?.();
    }
  });
}

async function renderPicker(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Empathy Maps</strong></div>
      <div class="topbar-spacer"></div>
      <span class="muted" style="font-size:12px">Gray, 2010</span>
    </header>
    <div id="empathy-picker-mount"><div class="empty-state">loading…</div></div>
  `;

  let topics = [];
  try { topics = await api.listTopics(); } catch (e) {
    $('#empathy-picker-mount', root).innerHTML =
      `<div class="empty-big"><h3>Couldn't list topics</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }

  const mount = $('#empathy-picker-mount', root);
  if (!topics?.length) {
    mount.innerHTML = `
      <div class="empty-big">
        <h3>No topics yet</h3>
        <p>Collect a topic first — the empathy map mines its corpus.</p>
        <a class="btn btn-primary btn-sm" href="#/topics">Open Topics</a>
      </div>`;
    return;
  }
  const opts = topics.map(t => `<option value="${esc(t.topic)}">${esc(t.topic)} · ${t.posts || 0} posts</option>`).join('');
  mount.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <h3>Open an empathy map</h3>
          <p>Says · Thinks · Does · Feels — per persona, mined from the corpus</p>
        </div>
      </div>
      <div class="card-body">
        <p class="muted" style="font-size:13px;line-height:1.6;margin:0 0 14px">
          We mine verbatim quotes, behavioural signals (workarounds,
          "I just use a spreadsheet"), and emotion words, then ask the
          LLM to fill in <em>Thinks</em> and write the
          <em>Says-vs-Does</em> gap insight.
        </p>
        <div class="row">
          <select id="empathy-topic-pick" style="flex:1;min-width:220px">${opts}</select>
          <input type="text" id="empathy-persona-pick" placeholder="persona (default: primary)"
                 style="padding:8px 12px;border:1px solid var(--line);border-radius:8px;font-size:12.5px;width:200px;background:var(--surface);color:var(--ink)"/>
          <button class="btn btn-primary btn-sm" id="empathy-go">Open →</button>
        </div>
      </div>
    </div>
  `;
  $('#empathy-go', mount)?.addEventListener('click', () => {
    const t = $('#empathy-topic-pick', mount).value;
    const p = ($('#empathy-persona-pick', mount).value || 'primary').trim() || 'primary';
    if (t) location.hash = `#/empathy/${encodeURIComponent(t)}?persona=${encodeURIComponent(p)}`;
  });
}

export async function renderEmpathy(root) {
  const topic = topicFromHash();
  if (topic) return renderTopicEmpathy(root, topic);
  return renderPicker(root);
}
