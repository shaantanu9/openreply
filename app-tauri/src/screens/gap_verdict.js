// Evidence-weighted answers — ask a claim, get a verdict backed by counts.
//
// Type a claim about the topic ("users want offline mode") and Gap Map returns
// supported / contradicted / mixed with supporting vs contradicting source
// counts and a per-source breakdown. Reached via #/verdict/<topic>.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const VERDICT = {
  supported: ['Supported', '#3E8E5A', '✓'],
  contradicted: ['Contradicted', '#B84747', '✗'],
  mixed: ['Mixed', '#C08A2D', '~'],
  insufficient: ['Insufficient evidence', '#7A8290', '?'],
};

export async function renderGapVerdict(main, topicRaw) {
  const topic = decodeURIComponent(topicRaw || '');
  let history = [];

  main.innerHTML = `
    <div class="screen" style="max-width:820px;margin:0 auto;padding:16px 20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <button id="vd-back" class="btn btn-ghost btn-sm" type="button"><i data-lucide="arrow-left"></i></button>
        <i data-lucide="scale" style="color:var(--accent,#5B8DB8)"></i>
        <h2 style="margin:0;font-size:18px">Evidence verdict</h2>
        <span class="muted" style="font-size:12.5px">${esc(topic)}</span>
      </div>
      <p class="muted" style="font-size:12.5px;margin:4px 0 12px">
        Ask a claim about this topic. Gap Map weighs the real posts for and against it and returns a verdict with the counts.
      </p>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <input id="vd-claim" type="text" placeholder='e.g. "users want an offline mode"' style="flex:1;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:inherit;font-size:13.5px" />
        <button class="btn btn-primary btn-sm" id="vd-ask" type="button"><i data-lucide="search"></i> Adjudicate</button>
      </div>
      <div id="vd-status" class="muted" style="font-size:12px;margin-bottom:8px"></div>
      <div id="vd-result"></div>
      <div id="vd-history" style="margin-top:18px"></div>
    </div>`;
  window.refreshIcons?.();

  const statusEl = main.querySelector('#vd-status');
  const resultEl = main.querySelector('#vd-result');
  main.querySelector('#vd-back')?.addEventListener('click', () => globalThis.history.back());

  const card = (r) => {
    const [label, color, glyph] = VERDICT[r.verdict] || VERDICT.insufficient;
    const total = (r.supporting || 0) + (r.contradicting || 0);
    const supPct = total ? Math.round((r.supporting / total) * 100) : 0;
    const breakdown = Object.entries(r.sources_breakdown || {}).map(([src, b]) =>
      `<span class="muted" style="font-size:11px">${esc(src)}: <span style="color:#3E8E5A">${b.support || 0}↑</span> / <span style="color:#B84747">${b.contradict || 0}↓</span></span>`
    ).join(' · ');
    return `
      <div style="border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:999px;background:${color}1a;color:${color};font-weight:800;font-size:16px">${glyph}</span>
          <span style="font-weight:700;font-size:15px;color:${color}">${label}</span>
          <span class="muted" style="font-size:11.5px;margin-left:auto">confidence ${Math.round((r.confidence || 0) * 100)}%</span>
        </div>
        ${r.claim ? `<div style="font-size:13px;margin-bottom:10px">“${esc(r.claim)}”</div>` : ''}
        <div style="display:flex;height:8px;border-radius:6px;overflow:hidden;background:var(--line);margin-bottom:6px">
          <div style="width:${supPct}%;background:#3E8E5A"></div>
          <div style="width:${100 - supPct}%;background:#B84747"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:8px">
          <span style="color:#3E8E5A">${r.supporting || 0} support</span>
          <span style="color:#B84747">${r.contradicting || 0} contradict</span>
        </div>
        ${breakdown ? `<div style="border-top:1px solid var(--line);padding-top:8px">${breakdown}</div>` : ''}
      </div>`;
  };

  const loadHistory = async () => {
    try { history = (await api.gapVerdictList(topic))?.rows || []; } catch { history = []; }
    const slot = main.querySelector('#vd-history');
    if (!history.length) { slot.innerHTML = ''; return; }
    slot.innerHTML = `<h3 style="font-size:13px;margin:0 0 8px">Past verdicts</h3>` +
      history.map(card).join('');
  };

  main.querySelector('#vd-ask')?.addEventListener('click', async (e) => {
    const claim = main.querySelector('#vd-claim').value.trim();
    if (!claim) { statusEl.textContent = 'Type a claim first.'; return; }
    const btn = e.currentTarget; const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2"></i> weighing…';
    statusEl.textContent = 'Retrieving evidence and adjudicating (LLM)…';
    window.refreshIcons?.();
    try {
      const r = await api.gapVerdict(topic, { claim });
      if (r?.ok) { resultEl.innerHTML = card(r); statusEl.textContent = `Analyzed ${r.analyzed} excerpts.`; await loadHistory(); }
      else { statusEl.textContent = `No verdict: ${r?.error || r?.reason || 'unknown'}`; }
    } catch (err) { statusEl.textContent = `Failed: ${err?.message || err}`; }
    finally { btn.disabled = false; btn.innerHTML = orig; window.refreshIcons?.(); }
  });

  main.querySelector('#vd-claim')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') main.querySelector('#vd-ask')?.click();
  });

  await loadHistory();
}
