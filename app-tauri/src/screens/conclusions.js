// Research conclusions — the PhD payoff. Evidence-grounded synthesis of a
// topic's literature: thesis, key findings, novel contributions (the links
// found), defensible conclusions, open questions, and a suggested research
// direction. Reads research/research_synthesis.py via conclusionsGet; the
// compute button runs the LLM synthesis over papers + connections + gaps.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const CONF_COLOR = { low: '#B84747', medium: '#C47A14', high: '#1A7A4F' };

function section(title, items, { icon = 'dot' } = {}) {
  if (!items || !items.length) return '';
  const lis = items.map((t) => `<li style="margin:3px 0">${esc(t)}</li>`).join('');
  return `<div style="margin:14px 0">
      <div style="font-weight:600;font-size:13px;margin-bottom:4px">${esc(title)}</div>
      <ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.5">${lis}</ul>
    </div>`;
}

export async function loadConclusions(contentEl, topic) {
  const alive = () => contentEl.dataset.tab === 'conclusions';
  let current = null;

  const render = (res, { computing = false } = {}) => {
    if (!alive()) return;
    const d = (res && res.data) || {};

    if (!res || !res.computed) {
      const reason = (res && res.reason) || '';
      contentEl.innerHTML = `<div class="empty-big">
        <h3>Research conclusions</h3>
        <p>Synthesise the literature into <b>real, evidence-grounded conclusions</b> —
        a thesis, key findings, the novel connections worth pursuing, open questions,
        and a suggested research direction.</p>
        ${reason ? `<p class="muted">${esc(reason)}</p>` : ''}
        <button class="btn btn-primary btn-sm icon-btn" id="compute-conclusions" ${computing ? 'disabled' : ''}>
          <i data-lucide="graduation-cap"></i> ${computing ? 'Synthesising… (LLM, ~30–60s)' : 'Generate conclusions'}
        </button>
      </div>`;
      window.refreshIcons?.();
      contentEl.querySelector('#compute-conclusions')?.addEventListener('click', wireCompute);
      return;
    }

    const ev = d.evidence || {};
    const conf = String(d.confidence || 'low').toLowerCase();
    const confChip = `<span style="display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:600;color:#fff;background:${CONF_COLOR[conf] || '#8A8178'}">${esc(conf)} confidence</span>`;

    contentEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <strong>Research synthesis</strong>
        ${confChip}
        <span class="muted" style="font-size:12px">· ${ev.paper_count || 0} papers · ${ev.connection_count || 0} connections · ${ev.gap_count || 0} gaps</span>
        <div style="margin-left:auto">
          <button class="btn btn-secondary btn-sm icon-btn" id="recompute-conclusions" ${computing ? 'disabled' : ''}>
            <i data-lucide="refresh-cw"></i> ${computing ? 'Working…' : 'Regenerate'}
          </button>
        </div>
      </div>
      ${d.thesis ? `<div style="background:var(--surface-2,#f6f3ee);border-left:3px solid #1F5C99;padding:10px 14px;border-radius:6px;margin:8px 0 4px;font-size:14px;font-weight:500">${esc(d.thesis)}</div>` : ''}
      ${d.confidence_reason ? `<p class="muted" style="font-size:12px;margin:4px 0 6px">${esc(d.confidence_reason)}</p>` : ''}
      ${section('Key findings', d.key_findings)}
      ${section('Novel contributions (links worth pursuing)', d.novel_contributions)}
      ${section('Conclusions', d.conclusions)}
      ${section('Open questions', d.open_questions)}
      ${d.suggested_direction ? `<div style="margin:14px 0">
        <div style="font-weight:600;font-size:13px;margin-bottom:4px">Suggested research direction</div>
        <div style="background:var(--surface-2,#f6f3ee);padding:10px 14px;border-radius:6px;font-size:13.5px">${esc(d.suggested_direction)}</div>
      </div>` : ''}
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm btn-bordered icon-btn" id="go-connections"><i data-lucide="git-merge"></i> See the connections</button>
        <button class="btn btn-sm btn-bordered icon-btn" id="go-papers"><i data-lucide="file-pen-line"></i> Draft a paper</button>
      </div>`;
    window.refreshIcons?.();
    contentEl.querySelector('#recompute-conclusions')?.addEventListener('click', wireCompute);
    contentEl.querySelector('#go-connections')?.addEventListener('click',
      () => document.querySelector('.tab[data-tab="connections"]')?.click());
    contentEl.querySelector('#go-papers')?.addEventListener('click',
      () => document.querySelector('.tab[data-tab="papers"]')?.click());
  };

  async function wireCompute() {
    render(current || { computed: false }, { computing: true });
    try {
      current = await api.conclusionsCompute(topic);
      render(current);
    } catch (e) {
      render(current || { computed: false });
    }
  }

  contentEl.innerHTML = '<div class="empty-state">Loading research synthesis…</div>';
  try {
    current = await api.conclusionsGet(topic);
    render(current);
  } catch (e) {
    if (alive()) {
      contentEl.innerHTML = `<div class="empty-big"><h3>Couldn't load conclusions</h3>`
        + `<p>${esc(e?.message || e)}</p></div>`;
    }
  }
}
