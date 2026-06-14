// FSD Fleet — debate panel + trust badges for the Topic Map.
//
// Self-contained surface for the 5-persona debate. topic.js owns only three
// hooks: a "Debate" toolbar button (#btn-map-debate), a stale chip
// (#debate-stale-chip), and a host div (#debate-host). Everything else —
// fetching verdicts, rendering tiers, trust badges, dissent, and re-running
// the debate — lives here so the 271KB topic.js stays untouched.
//
// Backend: api.debateTopic(topic) runs + persists the debate;
// api.debateVerdicts(topic) is the cached read that paints the badges.
import { api, esc } from '../api.js';

const TIER_META = {
  confirmed: { label: 'Confirmed', cls: 'tier-confirmed', icon: '✓' },
  probable:  { label: 'Probable',  cls: 'tier-probable',  icon: '≈' },
  minority:  { label: 'Minority',  cls: 'tier-minority',  icon: '!' },
  discarded: { label: 'Discarded', cls: 'tier-discarded', icon: '✕' },
};

const AGENTS = ['Synthesizer', 'Skeptic', 'Quantifier', 'Risk Officer', "Devil's Advocate"];

let _busy = false;

/**
 * Trust badge HTML for one verdict. Shows tier + score, evidence count,
 * provenance, and a dissent flag — the four signals chosen for Phase 1.
 * Exported so finding cards in other tabs can reuse it.
 */
export function renderTrustBadge(v) {
  if (!v || !v.tier) return '';
  const meta = TIER_META[v.tier] || TIER_META.discarded;
  const score = (typeof v.consensus_score === 'number') ? ` · ${v.consensus_score.toFixed(2)}` : '';
  const prov = v.provenance === 'llm_fallback' ? 'heuristic' : (v.provenance || 'debated');
  const evCount = v.evidence_count != null ? v.evidence_count : (v.evidence_post_ids || []).length;
  const ev = evCount ? ` · ${evCount} ${evCount === 1 ? 'post' : 'posts'}` : '';
  const dissent = (v.dissent && v.dissent.length)
    ? ` <span class="tb-dissent" title="${esc((v.dissent[0] || {}).why || 'A persona dissented')}">⚑</span>`
    : '';
  return `<span class="trust-badge ${meta.cls}" title="5-persona debate verdict (${esc(prov)})">`
    + `<b>${meta.icon} ${meta.label}</b>${score}${ev}${dissent}</span>`;
}

/**
 * Mount/refresh the debate panel for a topic. Safe to call repeatedly
 * (cached + fresh map renders both call it). `opts.toast(title,detail,kind,ms)`
 * is topic.js's showToast.
 */
export async function mountDebatePanel(topic, opts = {}) {
  const toast = typeof opts.toast === 'function' ? opts.toast : () => {};
  const host = document.getElementById('debate-host');
  const btn = document.getElementById('btn-map-debate');
  if (!host && !btn) return;
  await _refresh(topic, host);
  if (btn && !btn._debateWired) {
    btn._debateWired = true;
    btn.addEventListener('click', () => _runDebate(topic, host, btn, toast));
  }
  const staleChip = document.getElementById('debate-stale-chip');
  if (staleChip && !staleChip._debateWired) {
    staleChip._debateWired = true;
    staleChip.addEventListener('click', () => _runDebate(topic, host, btn, toast));
  }
}

async function _refresh(topic, host) {
  let data = null;
  try { data = await api.debateVerdicts(topic); } catch { data = null; }
  const verdicts = (data && data.verdicts) || [];
  const stale = !!(data && data.stale);
  _updateStaleChip(stale, verdicts.length);
  if (!host) return;
  if (!verdicts.length) {
    host.innerHTML = '';
    host.style.display = 'none';
    return;
  }
  host.style.display = '';
  host.innerHTML = _renderPanel(verdicts, stale);
}

function _updateStaleChip(stale, count) {
  const chip = document.getElementById('debate-stale-chip');
  if (!chip) return;
  chip.style.display = (count && stale) ? '' : 'none';
}

function _renderPanel(verdicts, stale) {
  const tiers = { confirmed: [], probable: [], minority: [], discarded: [] };
  for (const v of verdicts) (tiers[v.tier] || tiers.discarded).push(v);

  const sections = ['confirmed', 'probable', 'minority', 'discarded'].map((t) => {
    const items = tiers[t];
    if (!items.length) return '';
    const meta = TIER_META[t];
    const rows = items.map((v) => {
      const dissent = (v.dissent && v.dissent.length)
        ? `<div class="debate-dissent">${v.dissent.slice(0, 2).map((d) =>
            `<span>“${esc((d.why || '').slice(0, 160))}” <em>— ${esc(d.by || 'persona')}</em></span>`).join('')}</div>`
        : '';
      return `<li class="debate-row">`
        + `<div class="debate-row-top">${renderTrustBadge(v)}<span class="debate-title">${esc(v.target_id || '')}</span></div>`
        + `${dissent}</li>`;
    }).join('');
    return `<div class="debate-tier ${meta.cls}">`
      + `<div class="debate-tier-head">${meta.icon} ${meta.label} <span class="debate-tier-n">${items.length}</span></div>`
      + `<ul class="debate-list">${rows}</ul></div>`;
  }).join('');

  const agents = AGENTS.map((a) => `<span class="debate-agent">${esc(a)}</span>`).join('');
  return `<div class="debate-panel">`
    + `<div class="debate-panel-head"><b>⚖️ Fleet debate</b>`
    + `<span class="debate-agents">${agents}</span>`
    + `${stale ? '<span class="debate-stale">findings changed — re-run</span>' : ''}</div>`
    + `${sections || '<div class="debate-empty">No verdicts.</div>'}</div>`;
}

async function _runDebate(topic, host, btn, toast) {
  if (_busy) return;
  _busy = true;
  const orig = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Debating…';
    window.refreshIcons?.();
  }
  try {
    const res = await api.debateTopic(topic, 1);
    if (res && res.ok === false && res.reason === 'needs_synthesis') {
      toast('Debate', 'Synthesize findings first, then run the debate.', 'info', 3200);
    } else if (res && res.ok === false) {
      toast('Debate failed', String(res.reason || res.error || 'unknown'), 'err', 3500);
    } else {
      const c = (res && res.counts) || {};
      const tag = res && res.provenance === 'llm_fallback' ? ' (heuristic — no LLM key)' : '';
      toast('Debate complete', `${(res && res.n_verdicts) || 0} findings tiered · ${c.confirmed || 0} confirmed${tag}`, 'ok', 3200);
    }
    await _refresh(topic, host);
    window.refreshIcons?.();
  } catch (e) {
    toast('Debate failed', String((e && e.message) || e), 'err', 3500);
  } finally {
    _busy = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = orig || '<i data-lucide="scale"></i> Debate';
      window.refreshIcons?.();
    }
  }
}
