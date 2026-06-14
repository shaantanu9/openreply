// FSD Fleet — flow orchestration UI (Phase 4). A "Run Fleet" surface on the
// Topic Map: a decision-gate-driven route picker (quick/standard/deep with
// risk + cost), then a per-stage flow timeline (clarify → ground → debate →
// synthesize → audit). Self-contained; topic.js owns only a toolbar button
// (#btn-map-fleet) and a host div (#fleet-host).
import { api, esc } from '../api.js';

const STAGE_ICON = {
  ok: '✓', reused: '↺', skipped: '·', attention: '⚠', error: '✕', running: '…', pending: '·',
};
const RISK_CLS = { low: 'risk-low', medium: 'risk-med', high: 'risk-high' };

let _busy = false;

export async function mountFleetPanel(topic, opts = {}) {
  const toast = typeof opts.toast === 'function' ? opts.toast : () => {};
  const host = document.getElementById('fleet-host');
  const btn = document.getElementById('btn-map-fleet');
  if (!host && !btn) return;

  // Show the last run's timeline if one exists.
  try {
    const st = await api.fleetStatus(topic);
    if (st && st.run && host) {
      host.style.display = '';
      host.innerHTML = _renderTimeline(st.run);
    }
  } catch { /* no prior run */ }

  if (btn && !btn._fleetWired) {
    btn._fleetWired = true;
    btn.addEventListener('click', () => _openPlanner(topic, host, btn, toast));
  }
}

async function _openPlanner(topic, host, btn, toast) {
  if (!host) return;
  host.style.display = '';
  host.innerHTML = '<div class="agent-empty">Planning routes…</div>';
  let plan = null;
  try { plan = await api.fleetPlan(topic); } catch (e) {
    host.innerHTML = `<div class="agent-empty">Couldn't plan: ${esc(e?.message || e)}</div>`;
    return;
  }
  const reasons = (plan.reasons || []).map((r) => `<li>${esc(r)}</li>`).join('');
  const cards = (plan.routes || []).map((r) => {
    const rec = r.recommended ? '<span class="fleet-rec">recommended</span>' : '';
    const riskCls = RISK_CLS[r.risk] || 'risk-med';
    return `<div class="fleet-route">
        <div class="fleet-route-head"><b>${esc(r.label)}</b>${rec}
          <span class="fleet-risk ${riskCls}">${esc(r.risk)} risk</span>
          <span class="fleet-cost">~${(r.est_cost_tokens || 0).toLocaleString()} tok</span></div>
        <div class="fleet-route-blurb">${esc(r.blurb)}</div>
        <div class="fleet-route-stages">${(r.stages || []).map((s) => esc(s)).join(' → ')}</div>
        <button class="btn btn-xs btn-primary fleet-run-btn" data-route="${esc(r.key)}">Run ${esc(r.label)}</button>
      </div>`;
  }).join('');
  host.innerHTML = `<div class="fleet-panel">
      <div class="fleet-panel-head"><b>🛰 Run Fleet</b>
        <span class="fleet-mode">decision: <b>${esc(plan.mode)}</b></span></div>
      <ul class="fleet-reasons">${reasons}</ul>
      <div class="fleet-routes">${cards}</div>
    </div>`;
  window.refreshIcons?.();
  host.querySelectorAll('.fleet-run-btn').forEach((b) => {
    b.addEventListener('click', () => _run(topic, b.dataset.route, host, btn, toast, plan));
  });
}

function _parseLine(line) {
  if (line && typeof line === 'object') return line;  // dev streaming path emits parsed objects
  if (typeof line !== 'string') return null;
  try { return JSON.parse(line); } catch { return null; }  // ignore interleaved log lines
}

async function _run(topic, route, host, btn, toast, plan) {
  if (_busy) return;
  _busy = true;
  const chosen = (plan.routes || []).find((r) => r.key === route) || { stages: [], label: route };
  // Live pending timeline; stages flip running → final as 'fleet:progress' arrives.
  const stageState = chosen.stages.map((name) => ({ name, label: _label(name), status: 'pending', detail: '' }));
  const render = () => { host.innerHTML = _renderTimeline({ route, route_label: chosen.label, mode: plan.mode, status: 'running', stages: stageState }); };
  if (stageState[0]) stageState[0].status = 'running';
  render();
  if (btn) { btn.disabled = true; btn.classList.add('on'); }

  let unP = null, unD = null, done = false;
  const cleanup = () => { try { unP && unP(); } catch {} try { unD && unD(); } catch {} };
  const finish = (result) => {
    if (done) return;
    done = true;
    cleanup();
    _busy = false;
    if (btn) { btn.disabled = false; btn.classList.remove('on'); }
    if (result) host.innerHTML = _renderTimeline({ ...result, route_label: result.route_label || chosen.label });
    const ok = result && (result.ok !== false) && result.status !== 'error';
    toast(ok ? 'Fleet flow complete' : 'Fleet flow stopped',
      `${esc(result?.route_label || chosen.label)} · ~${(result?.cost_tokens || 0).toLocaleString()} tok`,
      ok ? 'ok' : 'err', 3600);
  };

  try {
    unP = await api.onFleetProgress((line) => {
      const obj = _parseLine(line);
      if (!obj || !obj.__fleet) return;          // skip interleaved sidecar log lines
      if (obj.event === 'stage') {
        const i = stageState.findIndex((s) => s.name === obj.name);
        if (i >= 0) stageState[i] = { name: obj.name, label: obj.label || _label(obj.name), status: obj.status, detail: obj.detail || '' };
        const nxt = stageState.find((s) => s.status === 'pending');
        if (nxt) nxt.status = 'running';
        render();
      } else if (obj.event === 'done') {
        finish(obj.result);
      }
    });
    unD = await api.onFleetDone(() => {
      // Process exited; if the result line never arrived, settle from fleet-status.
      if (done) return;
      api.fleetStatus(topic)
        .then((st) => finish(st && st.run ? { ...st.run, ok: st.run.status !== 'error' } : null))
        .catch(() => finish(null));
    });
    await api.fleetRunStream(topic, route, 1);    // resolves once spawned; events drive the rest
  } catch (e) {
    cleanup();
    _busy = false;
    if (btn) { btn.disabled = false; btn.classList.remove('on'); }
    host.innerHTML = `<div class="agent-empty">Fleet run failed: ${esc(e?.message || e)}</div>`;
    toast('Fleet flow failed', String(e?.message || e), 'err', 3600);
  }
}

function _label(name) {
  return { clarify_check: 'Clarify', ground: 'Ground agents', synthesize: 'Synthesize',
    debate: 'Debate', audit: 'Audit' }[name] || name;
}

function _renderTimeline(run) {
  const stages = (run.stages || []).map((s) => {
    const icon = STAGE_ICON[s.status] || '·';
    const spin = s.status === 'running' ? ' <span class="fleet-spin"></span>' : '';
    return `<li class="fleet-stage st-${esc(s.status)}">
        <span class="fleet-stage-ic">${icon}</span>
        <span class="fleet-stage-label">${esc(s.label || s.name)}</span>${spin}
        ${s.detail ? `<span class="fleet-stage-detail">${esc(s.detail)}</span>` : ''}
      </li>`;
  }).join('');
  const cost = run.cost_tokens ? `· ~${run.cost_tokens.toLocaleString()} tok` : '';
  const statusCls = run.status === 'error' ? 'err' : (run.status === 'running' ? 'run' : 'ok');
  return `<div class="fleet-panel">
      <div class="fleet-panel-head"><b>🛰 Fleet flow</b>
        <span class="fleet-route-chip">${esc(run.route_label || run.route || '')}</span>
        <span class="fleet-status fleet-${statusCls}">${esc(run.status || '')}</span>
        <span class="fleet-mode">${cost}</span></div>
      <ul class="fleet-timeline">${stages || '<li class="agent-empty">No stages.</li>'}</ul>
    </div>`;
}
