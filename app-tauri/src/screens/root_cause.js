// Root Cause (5 Whys) tab — drill each top painpoint down to its addressable root.
// The gap map surfaces symptoms (painpoints); this view asks "why?" five times
// per painpoint until a root cause emerges, then names the addressable
// intervention it implies. Reads research/root_cause.py via root_cause_get;
// "Run 5-Whys analysis" runs the LLM synthesis via root_cause_compute, then
// re-renders the laddered cards + overall summary.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const ROOT_COLOR = '#1F5C99';
const YES_COLOR = '#1A7A4F';
const NO_COLOR = '#C47A14';

function addressableChip(addressable) {
  const yes = !!addressable;
  const color = yes ? YES_COLOR : NO_COLOR;
  const icon = yes ? 'check' : 'alert-triangle';
  const text = yes ? 'Addressable' : 'Hard to address';
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px;`
    + `border-radius:10px;font-size:11px;font-weight:600;color:#fff;background:${color}">`
    + `<i data-lucide="${icon}" style="width:12px;height:12px"></i>${esc(text)}</span>`;
}

function whyHtml(why, i) {
  // Each rung is laddered/indented progressively to show the causal chain.
  const indent = 12 * i;
  return `<li style="margin:0 0 6px 0;padding-left:${indent}px;list-style:none">
      <span style="color:var(--muted);font-weight:600;margin-right:6px">Why? →</span>
      <span>${esc(why)}</span>
    </li>`;
}

function cardHtml(a) {
  const whys = Array.isArray(a && a.whys) ? a.whys : [];
  const whysHtml = whys.length
    ? `<ol style="margin:0 0 10px 0;padding:0;counter-reset:why">${whys.map(whyHtml).join('')}</ol>`
    : '<div class="muted" style="margin:0 0 10px 0">No why-ladder returned.</div>';
  const root = String((a && a.root_cause) || '');
  const focus = String((a && a.suggested_focus) || '');
  return `
    <div style="border:1px solid var(--border,#e5e1da);border-radius:8px;
                padding:14px 16px;margin-bottom:12px;min-width:0">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <i data-lucide="git-fork" style="width:16px;height:16px;flex:none;color:${ROOT_COLOR}"></i>
        <strong style="font-size:14.5px">${esc((a && a.painpoint) || '')}</strong>
      </div>
      ${whysHtml}
      ${root ? `
        <div style="border-left:3px solid ${ROOT_COLOR};background:rgba(31,92,153,0.07);
                    border-radius:6px;padding:9px 12px;margin:0 0 10px 0">
          <div style="font-weight:700;color:${ROOT_COLOR};font-size:12px;margin-bottom:2px">ROOT CAUSE</div>
          <div>${esc(root)}</div>
        </div>` : ''}
      <div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div style="flex:none">${addressableChip(a && a.addressable)}</div>
        ${focus ? `<div class="muted" style="font-size:12.5px;flex:1;min-width:0">
          <b>Suggested focus:</b> ${esc(focus)}</div>` : ''}
      </div>
    </div>`;
}

export async function loadRootCause(contentEl, topic) {
  const alive = () => contentEl.dataset.tab === 'rootcause';

  const render = (res, { computing = false } = {}) => {
    if (!alive()) return;

    // ── empty / not-computed state ────────────────────────────────────────
    if (!res || !res.computed) {
      const reason = String((res && res.reason) || '');
      const needsEvidence = /evidence/i.test(reason);
      const label = needsEvidence ? 'Build the gap map first' : 'Run 5-Whys analysis';
      contentEl.innerHTML = `
        <div class="empty-big">
          <h3>Root Cause — 5 Whys from your gap map</h3>
          <p>${reason
            ? esc(reason)
            : 'Take the top painpoints mined for this topic and ask "why?" five times '
              + 'each until an underlying root cause emerges — then name the addressable '
              + 'intervention each root implies. Symptoms point you at gaps; roots point '
              + 'you at what to build.'}</p>
          <button class="btn btn-primary btn-sm icon-btn" id="compute-rootcause" ${computing ? 'disabled' : ''}>
            <i data-lucide="git-fork"></i> ${computing ? 'Analyzing… (LLM, ~30–60s)' : esc(label)}
          </button>
        </div>`;
      window.refreshIcons?.();
      wireCompute(res);
      return;
    }

    // ── computed state ────────────────────────────────────────────────────
    const data = res.data || {};
    const analyses = Array.isArray(data.analyses) ? data.analyses : [];
    const summary = String(data.summary || '');
    contentEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div><strong>Root Cause (5 Whys)</strong>
          <span class="muted">· ${analyses.length} painpoint${analyses.length === 1 ? '' : 's'} analysed</span></div>
        <div class="muted" style="font-size:12px">
          ${res.updated_at ? `Updated ${esc(res.updated_at)}` : ''}${res.provider ? ` · ${esc(res.provider)}` : ''}
        </div>
        <div style="margin-left:auto">
          <button class="btn btn-primary btn-sm icon-btn" id="compute-rootcause" ${computing ? 'disabled' : ''}>
            <i data-lucide="refresh-cw"></i> ${computing ? 'Analyzing… (LLM, ~30–60s)' : 'Regenerate'}
          </button>
        </div>
      </div>
      ${analyses.length
        ? analyses.map(cardHtml).join('')
        : '<div class="empty-state">No root-cause analyses were returned.</div>'}
      ${summary ? `
        <div style="margin-top:6px;border:1px solid var(--border,#e5e1da);border-radius:8px;
                    padding:12px 14px;display:flex;gap:9px;align-items:flex-start">
          <i data-lucide="compass" style="width:16px;height:16px;flex:none;margin-top:2px"></i>
          <div>
            <div style="font-weight:700;margin-bottom:2px">Dominant root cause</div>
            <div>${esc(summary)}</div>
          </div>
        </div>` : ''}`;
    window.refreshIcons?.();
    wireCompute(res);
  };

  const wireCompute = (res) => {
    contentEl.querySelector('#compute-rootcause')?.addEventListener('click', async () => {
      render(res, { computing: true });
      try {
        const fresh = await api.rootCauseCompute(topic);
        if (!alive()) return;
        render(fresh);
      } catch (e) {
        if (!alive()) return;
        render(res); // restore previous state on failure
      }
    });
  };

  contentEl.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const res = await api.rootCauseGet(topic);
    if (!alive()) return;
    render(res);
  } catch (e) {
    if (alive()) {
      contentEl.innerHTML = `<div class="empty-big"><h3>Couldn't load Root Cause</h3>`
        + `<p>${esc(e?.message || e)}</p></div>`;
    }
  }
}
