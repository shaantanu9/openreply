// FSD Fleet — Agent Memory overlay (Phase 2). A topic-scoped view of what each
// persona/agent has LEARNED about this topic: their memories (lessons + cited
// evidence), distilled conclusions, and cross-agent divergences (rejections).
//
// Pure surfacing of the existing persona system — no new backend. Reads
// api.personaList / personaMemories({topic}) / personaConclusions /
// personaRejections, and lets the user teach an agent THIS topic via
// api.personaIngest({personaId, topic}).
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const CONF_COLOR = { low: '#B84747', medium: '#C47A14', high: '#1A7A4F' };

function impBar(v) {
  const pct = Math.max(0, Math.min(1, Number(v) || 0)) * 100;
  return `<span class="agent-imp" title="importance ${pct.toFixed(0)}%">`
    + `<span class="agent-imp-fill" style="width:${pct.toFixed(0)}%"></span></span>`;
}

function memoryRow(m) {
  const cite = m.source_post_id
    ? `<span class="agent-cite" title="source post">${esc(String(m.source_post_id))}</span>` : '';
  const excerpt = m.excerpt
    ? `<div class="agent-excerpt">“${esc(String(m.excerpt).slice(0, 220))}”</div>` : '';
  return `<li class="agent-mem">
      <div class="agent-mem-top">${impBar(m.importance)}<span class="agent-lesson">${esc(m.lesson || '')}</span></div>
      ${excerpt}
      <div class="agent-mem-meta">${cite}</div>
    </li>`;
}

function conclusionRow(c) {
  const conf = String(c.confidence != null ? (Number(c.confidence) >= 0.66 ? 'high' : Number(c.confidence) >= 0.33 ? 'medium' : 'low') : 'low');
  const chip = `<span class="agent-conf" style="background:${CONF_COLOR[conf]}">${(Number(c.confidence) || 0).toFixed(2)}</span>`;
  return `<li class="agent-conc">${chip}<span>${esc(c.statement || '')}</span></li>`;
}

function personaCard(p, mems, concs, rejs) {
  const lens = p.lens ? `<span class="agent-lens">${esc(p.lens)}</span>` : '';
  const dot = `<span class="agent-dot ${p.active ? 'on' : 'off'}" title="${p.active ? 'active' : 'inactive'}"></span>`;
  const memHtml = mems.length
    ? `<ul class="agent-mem-list">${mems.slice(0, 8).map(memoryRow).join('')}</ul>`
    : `<div class="agent-empty">No lessons on this topic yet. <button class="btn btn-xs btn-bordered agent-learn" data-pid="${p.id}">Learn this topic</button></div>`;
  const concHtml = concs.length
    ? `<div class="agent-sub">Distilled beliefs</div><ul class="agent-conc-list">${concs.slice(0, 4).map(conclusionRow).join('')}</ul>` : '';
  const rejHtml = rejs.length
    ? `<div class="agent-sub">Divergences (lens contradictions)</div>`
      + `<ul class="agent-rej-list">${rejs.slice(0, 3).map((r) =>
          `<li class="agent-rej">“${esc(String(r.donor_lesson || '').slice(0, 120))}” — <em>${esc(String(r.reason || '').slice(0, 140))}</em></li>`).join('')}</ul>` : '';
  return `<div class="agent-card" data-pid="${p.id}">
      <div class="agent-head">${dot}<b>${esc(p.name || 'Agent')}</b>${lens}
        <span class="agent-count">${mems.length} ${mems.length === 1 ? 'lesson' : 'lessons'} on this topic</span>
        ${mems.length ? `<button class="btn btn-xs btn-bordered agent-learn" data-pid="${p.id}" style="margin-left:auto">Re-learn</button>` : ''}
      </div>
      ${memHtml}${concHtml}${rejHtml}
    </div>`;
}

export async function loadAgents(contentEl, topic) {
  const alive = () => contentEl.dataset.tab === 'agents';

  contentEl.innerHTML = '<div class="empty-state">Loading agent memory…</div>';
  let personas = [];
  try {
    const r = await api.personaList();
    personas = (r && r.personas) || [];
  } catch (e) {
    if (alive()) contentEl.innerHTML = `<div class="empty-big"><h3>Couldn't load agents</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  if (!alive()) return;

  if (!personas.length) {
    contentEl.innerHTML = `<div class="empty-big">
      <h3>No agents yet</h3>
      <p>Agents are persistent personas that read this topic's posts through a
      fixed lens and accumulate <b>memories</b> — lessons cited back to real
      posts. Create one in the global <b>Personas</b> area, then come back to
      teach it this topic.</p>
      <button class="btn btn-primary btn-sm icon-btn" id="agents-go-personas"><i data-lucide="users"></i> Open Personas</button>
    </div>`;
    window.refreshIcons?.();
    contentEl.querySelector('#agents-go-personas')?.addEventListener('click',
      () => (window.go ? window.go('personas') : (location.hash = '#/personas')));
    return;
  }

  // Pull each persona's topic memories in parallel; then conclusions +
  // rejections only for the agents that actually learned this topic.
  const memsByP = await Promise.all(personas.map((p) =>
    api.personaMemories(p.id, { topic, limit: 50 }).then((r) => (r && r.memories) || []).catch(() => [])));
  if (!alive()) return;
  const withMems = personas.map((p, i) => ({ p, mems: memsByP[i] }));

  const detail = await Promise.all(withMems.map(({ p, mems }) =>
    (mems.length
      ? Promise.all([
          api.personaConclusions(p.id, 8).then((r) => (r && r.conclusions) || []).catch(() => []),
          api.personaRejections(p.id, { limit: 20 }).then((r) => (r && r.rejections) || []).catch(() => []),
        ])
      : Promise.resolve([[], []]))));
  if (!alive()) return;

  // Agents that learned this topic first, then the rest.
  const order = withMems
    .map((w, i) => ({ ...w, concs: detail[i][0], rejs: detail[i][1] }))
    .sort((a, b) => b.mems.length - a.mems.length);

  const learnedCount = order.filter((o) => o.mems.length).length;
  const cards = order.map((o) => personaCard(o.p, o.mems, o.concs, o.rejs)).join('');

  contentEl.innerHTML = `
    <div class="agents-head">
      <div>
        <strong>⚖️ Agent memory</strong>
        <span class="muted" style="font-size:12px">· ${learnedCount}/${personas.length} agents have learned this topic</span>
      </div>
      <p class="muted" style="font-size:12.5px;margin:4px 0 10px">
        Each agent reads this topic through its lens and remembers lessons,
        cited to real posts. Distilled beliefs and cross-agent divergences show
        where the lenses agree or contradict.
      </p>
    </div>
    <div class="agents-grid">${cards}</div>`;
  window.refreshIcons?.();

  // Wire "Learn this topic" / "Re-learn" — teaches the agent this topic's posts.
  contentEl.querySelectorAll('.agent-learn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pid = Number(btn.dataset.pid);
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Learning…';
      try {
        await api.personaIngest({ personaId: pid, topic, limit: 50 });
        await loadAgents(contentEl, topic); // refresh the overlay
      } catch (e) {
        btn.disabled = false;
        btn.textContent = orig;
      }
    });
  });
}
