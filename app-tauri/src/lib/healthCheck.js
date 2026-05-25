import { api, esc } from '../api.js';

const ICON = {
  ok:   '<span class="hc-dot hc-ok">●</span>',
  fail: '<span class="hc-dot hc-fail">●</span>',
  warn: '<span class="hc-dot hc-warn">●</span>',
  info: '<span class="hc-dot hc-info">●</span>',
  run:  '<span class="hc-dot hc-run">●</span>',
};

const LABEL = {
  sidecar:  'Python engine (gapmap)',
  data_dir: 'Data folder writable',
  db:       'Database schema',
  palace:   'Semantic search model (ONNX)',
  llm:      'LLM provider',
  reddit:   'Reddit OAuth',
};

function statusFor(c) {
  if (c.ok) return 'ok';
  if (c.level === 'warn') return 'warn';
  if (c.level === 'info') return 'info';
  return 'fail';
}

export async function runHealthCheck() {
  try {
    const res = await api.healthCheck();
    return normalize(res);
  } catch (e) {
    return {
      ok: false,
      sidecar_ok: false,
      checks: [{ id: 'sidecar', ok: false, detail: `invoke failed: ${e?.message || e}` }],
    };
  }
}

function normalize(res) {
  if (!res || typeof res !== 'object') {
    return { ok: false, sidecar_ok: false, checks: [] };
  }
  const sidecarOk = res.sidecar_ok !== false;
  const checks = [];
  checks.push({
    id: 'sidecar',
    ok: sidecarOk,
    detail: sidecarOk
      ? `ready (${res.elapsed_ms ?? '?'} ms)`
      : (res.detail || 'sidecar not reachable'),
  });
  if (Array.isArray(res.checks)) {
    for (const c of res.checks) checks.push(c);
  }
  return { ...res, checks };
}

/**
 * Render a compact health-check card into `host`. Shows every check as a
 * coloured row; callers can pass a title + an optional "re-run" button.
 */
export function renderHealthCard(host, payload, { title = 'System check', onRerun } = {}) {
  const rows = (payload.checks || []).map(c => {
    const status = statusFor(c);
    const elapsed = typeof c.ms === 'number' ? ` <span class="hc-ms">${c.ms} ms</span>` : '';
    return `
      <div class="hc-row hc-${status}">
        ${ICON[status]}
        <div class="hc-body">
          <div class="hc-label">${esc(LABEL[c.id] || c.id)}${elapsed}</div>
          <div class="hc-detail">${esc(c.detail || '')}</div>
        </div>
      </div>
    `;
  }).join('');
  const hasBlocker = (payload.checks || []).some(c => !c.ok && c.level !== 'warn' && c.level !== 'info');
  host.innerHTML = `
    <div class="hc-card ${hasBlocker ? 'hc-card-fail' : 'hc-card-ok'}">
      <div class="hc-card-head">
        <strong>${esc(title)}</strong>
        ${onRerun ? '<button class="btn btn-sm" data-hc-rerun>Re-run</button>' : ''}
      </div>
      <div class="hc-rows">${rows}</div>
    </div>
  `;
  if (onRerun) {
    host.querySelector('[data-hc-rerun]')?.addEventListener('click', onRerun);
  }
  return { hasBlocker };
}

export function healthIsBlocking(payload) {
  if (!payload) return true;
  if (payload.sidecar_ok === false) return true;
  return (payload.checks || []).some(c => !c.ok && c.level !== 'warn' && c.level !== 'info');
}
