// Empathy Map screen — Dave Gray (2010), popularised by Stanford d.school.
//
// Two routes:
//   #/empathy             → topic picker
//   #/empathy/<topic>     → Says / Thinks / Does / Feels grid +
//                           Says-vs-Does gap note. Build / refresh button
//                           runs research/empathy.py which mines the
//                           corpus + LLM-fills the grid (offline fallback
//                           for users without an LLM key).
import { api, esc } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);

function topicFromHash() {
  const h = location.hash || '';
  const m = h.match(/^#\/empathy\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function quadrant(label, items, kind) {
  const list = (items || []).map(i => `<li>${esc(i)}</li>`).join('');
  const empty = !items?.length ? `<li class="muted">_(none yet)_</li>` : '';
  return `
    <div class="empathy-quadrant q-${kind}">
      <div class="empathy-quad-label">${esc(label)}</div>
      <ul class="empathy-quad-list">${list}${empty}</ul>
    </div>
  `;
}

function renderEmpathyShell(topic, persona, map, offlineSeed) {
  const banner = offlineSeed
    ? `<div class="empathy-banner muted">⚠ No LLM provider configured — offline seed below was mined deterministically from your corpus. Add an OpenAI / Anthropic / Ollama key in Settings, then click Refresh.</div>`
    : '';
  const updated = map?.updated_at
    ? `Last updated: ${new Date(map.updated_at).toLocaleString()}`
    : 'Never built';
  return `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/empathy">Empathy maps</a> ›
        <strong>${esc(topic)}</strong>
        <span class="muted" style="font-size:11px;margin-left:8px">${esc(updated)}</span>
      </div>
      <div class="topbar-actions">
        <input id="empathy-persona" type="text" value="${esc(persona)}"
               placeholder="persona (e.g. primary, returning user)"
               style="padding:6px 10px;border:1px solid var(--ink-3);border-radius:6px;font-size:12px;width:220px"/>
        <button class="btn primary" id="empathy-build">
          <i data-lucide="refresh-cw"></i> Build / refresh
        </button>
      </div>
    </header>

    <div class="empathy-wrap">
      ${banner}
      <section class="empathy-intro card">
        <h2>Empathy Map · ${esc(topic)} · <em>${esc(persona)}</em></h2>
        <p class="muted" style="font-size:13px;line-height:1.55">
          Four quadrants per persona — Says (verbatim quotes),
          Thinks (inferred beliefs), Does (observable behaviour /
          workarounds), Feels (emotion clusters). The gap between
          <b>Says</b> and <b>Does</b> is where the latent need lives.
        </p>
      </section>

      <section class="empathy-grid">
        ${quadrant('SAYS — verbatim from posts',          map?.says,    'says')}
        ${quadrant('THINKS — inferred beliefs',           map?.thinks,  'thinks')}
        ${quadrant('DOES — workarounds + behaviour',      map?.does,    'does')}
        ${quadrant('FEELS — emotion clusters',            map?.feels,   'feels')}
      </section>

      <section class="empathy-gap card">
        <h3>Says vs. Does — the latent insight</h3>
        <p style="font-size:13.5px;line-height:1.7">
          ${(map?.gap_notes || '<span class="muted">No gap note yet — click Build to mine the corpus and fill all five sections.</span>')}
        </p>
      </section>
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
    root.innerHTML = `<div class="empty-big"><h3>Couldn't load empathy map</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }

  const exists = !!result?.ok;
  const map = exists ? result : null;
  const offlineSeed = !exists || (Array.isArray(map?.thinks) && map.thinks.length === 0 && (map?.says?.length || 0) > 0);

  root.innerHTML = renderEmpathyShell(topic, persona, map, offlineSeed);
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
      // Force refresh of cached get
      location.hash = `#/empathy/${encodeURIComponent(topic)}?persona=${encodeURIComponent(personaIn)}&t=${Date.now()}`;
      // Re-route after hash change updates the URL
      setTimeout(() => renderTopicEmpathy(root, topic), 0);
    } catch (e) {
      alert(`Couldn't build empathy map: ${e?.message || e}`);
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="refresh-cw"></i> Build / refresh';
      window.refreshIcons?.();
    }
  });
}

async function renderPicker(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs"><strong>Empathy maps</strong> · Gray, 2010</div>
    </header>
    <div class="empathy-wrap"><div id="empathy-picker-mount"><div class="empty-state">loading…</div></div></div>
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
        <a class="btn primary" href="#/topics">Open Topics</a>
      </div>`;
    return;
  }
  const opts = topics.map(t => `<option value="${esc(t.topic)}">${esc(t.topic)} · ${t.posts || 0} posts</option>`).join('');
  mount.innerHTML = `
    <div class="empathy-picker card">
      <h2>Open an empathy map</h2>
      <p class="muted" style="font-size:13px;line-height:1.6;max-width:680px">
        Pick a topic — we mine its corpus for verbatim quotes, behavioural
        signals (workarounds, "I just use a spreadsheet"), and emotion words,
        then ask the LLM to fill in <em>Thinks</em> and write the
        <em>Says-vs-Does</em> gap insight.
      </p>
      <div class="row" style="gap:8px;margin-top:14px;align-items:center">
        <label for="empathy-topic-pick" class="muted">Topic</label>
        <select id="empathy-topic-pick">${opts}</select>
        <input type="text" id="empathy-persona-pick" placeholder="persona (default: primary)"
               style="padding:6px 10px;border:1px solid var(--ink-3);border-radius:6px;font-size:12px;width:220px"/>
        <button class="btn primary" id="empathy-go">Open →</button>
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
