// Collect — streams sidecar output with colorized log lines, stage tracker,
// elapsed timer, error counter, copy/clear actions, and a post-run CTA row.

import { api, $, esc } from '../api.js';

const STAGES = [
  { key: 'discover', label: 'Discover subs',   pattern: /(discovering|discover-subs|picking.*subs)/i },
  { key: 'reddit',   label: 'Fetch Reddit',    pattern: /(fetching r\/|reddit fetch|fetch posts|pullpush|historical archive)/i },
  { key: 'sources',  label: 'Other sources',   pattern: /(source:|hackernews|appstore|playstore|arxiv|scholar|github|news|wikipedia|pytrends)/i },
  { key: 'enrich',   label: 'LLM extraction',  pattern: /(enrich|painpoint|feature|workaround|gap extraction|temporal-gaps)/i },
  { key: 'graph',    label: 'Build graph',     pattern: /(building graph|graph built|structural graph)/i },
  { key: 'export',   label: 'Export viewer',   pattern: /(exporting|gap-map\.html|ready:)/i },
];

function classifyLine(line) {
  if (/✗|error|failed|fatal/i.test(line)) return 'err';
  if (/✓|ready|done\.|done —|finished/i.test(line)) return 'done';
  if (/^→|→ started|fetching|pulling|discovering|building|exporting/i.test(line)) return 'info';
  if (/warn|skipped/i.test(line)) return 'warn';
  return 'log';
}

function detectStage(line) {
  for (const s of STAGES) if (s.pattern.test(line)) return s.key;
  return null;
}

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export async function renderCollect(root, { params }) {
  const topic = decodeURIComponent(params[0] || '');
  const slug = params[0];

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/" style="color:var(--ink-3);text-decoration:none">Workspace</a> / <strong>Collecting</strong> / ${esc(topic)}
      </div>
      <div class="topbar-spacer"></div>
      <span class="pill active" id="collect-status-pill">● running</span>
    </header>

    <div class="progress-card">
      <div class="progress-head">
        <div>
          <h2>Collecting: ${esc(topic)}</h2>
          <p style="color:var(--ink-3);font-size:13px;margin-top:4px" id="progress-sub">Preparing…</p>
        </div>
        <div class="progress-stats">
          <span class="pchip"><b id="pchip-elapsed">0s</b><span>elapsed</span></span>
          <span class="pchip"><b id="pchip-lines">0</b><span>log lines</span></span>
          <span class="pchip" id="pchip-errs-wrap"><b id="pchip-errs">0</b><span>errors</span></span>
        </div>
      </div>

      <div class="stage-strip" id="stage-strip">
        ${STAGES.map(s => `
          <div class="stage-step" data-stage="${s.key}">
            <span class="stage-dot"></span>
            <span>${esc(s.label)}</span>
          </div>
        `).join('')}
      </div>

      <div class="log-toolbar">
        <label class="log-check">
          <input type="checkbox" id="log-autoscroll" checked />
          <span>Auto-scroll</span>
        </label>
        <div style="flex:1"></div>
        <button class="btn btn-ghost" id="btn-copy-log" style="padding:6px 10px;font-size:11px;border:1px solid var(--line)">📋 Copy log</button>
        <button class="btn btn-ghost" id="btn-clear-log" style="padding:6px 10px;font-size:11px;border:1px solid var(--line)">Clear</button>
      </div>

      <div class="progress-log" id="progress-log"></div>

      <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end" id="collect-actions">
        <button class="btn btn-ghost" id="btn-cancel" style="border:1px solid var(--line)">Cancel</button>
        <button class="btn btn-primary" id="btn-open" hidden>Open gap map →</button>
      </div>
    </div>
  `;

  // --- state ---
  const startTs = Date.now();
  let lineCount = 0;
  let errCount = 0;
  let collectDone = false;
  let exportPath = null;

  const log = $('#progress-log');
  const statusPill = $('#collect-status-pill');
  const sub = $('#progress-sub');
  const openBtn = $('#btn-open');
  const autoscroll = $('#log-autoscroll');
  const elapsedEl = $('#pchip-elapsed');
  const linesEl = $('#pchip-lines');
  const errsEl = $('#pchip-errs');
  const errsWrap = $('#pchip-errs-wrap');

  const markStage = (key) => {
    if (!key) return;
    const el = root.querySelector(`.stage-step[data-stage="${key}"]`);
    if (!el) return;
    root.querySelectorAll('.stage-step.active').forEach(x => { x.classList.remove('active'); x.classList.add('done'); });
    el.classList.add('active');
  };

  const appendLine = (text, cls = null) => {
    lineCount++;
    const klass = cls || classifyLine(text);
    const stage = detectStage(text);
    if (stage) markStage(stage);
    if (klass === 'err') { errCount++; errsEl.textContent = errCount; errsWrap.classList.add('has-errors'); }
    linesEl.textContent = lineCount;
    const div = document.createElement('div');
    div.className = `line line-${klass}`;
    div.textContent = text;
    log.appendChild(div);
    if (autoscroll.checked) log.scrollTop = log.scrollHeight;
  };

  // Elapsed timer
  const tick = setInterval(() => {
    if (collectDone) return;
    elapsedEl.textContent = fmtElapsed(Date.now() - startTs);
  }, 1000);

  // --- subscribe before starting ---
  const unlistenProgress = await api.onCollectProgress(line => {
    appendLine(line);
    const short = line.slice(0, 140);
    sub.textContent = short;
  });

  const setFinal = (label, bg, fg) => {
    statusPill.textContent = label;
    statusPill.style.background = bg;
    statusPill.style.color = fg;
  };

  const unlistenDone = await api.onCollectDone(async payload => {
    if (collectDone) return;
    collectDone = true;
    clearInterval(tick);

    if (payload?.code !== 0) {
      appendLine(`✗ collect exited with code ${payload?.code}`, 'err');
      setFinal('failed', 'var(--chronic, #B84747)', 'white');
      sub.textContent = 'Collect failed. Check the log above, fix, and retry.';
      showRetryAction();
      return;
    }

    appendLine('✓ collect finished — now building graph…', 'done');
    markStage('graph');
    try {
      const g = await api.buildGraph(topic);
      appendLine(`✓ graph built: ${g.total_nodes} nodes / ${g.total_edges} edges`, 'done');
      markStage('export');
      appendLine('✓ exporting HTML viewer…', 'done');
      exportPath = await api.exportHtml(topic);
      appendLine(`✓ ready: ${exportPath}`, 'done');
      setFinal('✓ ready', 'var(--mint)', '#1A3424');
      sub.textContent = `Completed in ${fmtElapsed(Date.now() - startTs)} · ${lineCount} log lines · ${errCount} errors`;
      openBtn.hidden = false;
    } catch (e) {
      appendLine(`✗ ${e?.message || e}`, 'err');
      setFinal('failed', 'var(--chronic, #B84747)', 'white');
      sub.textContent = 'Graph build failed.';
      showRetryAction();
    }
  });

  // --- actions ---
  $('#btn-copy-log').onclick = () => {
    const text = [...log.querySelectorAll('.line')].map(l => l.textContent).join('\n');
    navigator.clipboard.writeText(text);
    const b = $('#btn-copy-log');
    const orig = b.textContent;
    b.textContent = '✓ copied';
    setTimeout(() => { b.textContent = orig; }, 1400);
  };
  $('#btn-clear-log').onclick = () => {
    if (!confirm('Clear the on-screen log? (Doesn\'t cancel the collect.)')) return;
    log.innerHTML = '';
    lineCount = 0; errCount = 0;
    linesEl.textContent = '0'; errsEl.textContent = '0';
    errsWrap.classList.remove('has-errors');
  };

  $('#btn-cancel').addEventListener('click', async () => {
    const btn = $('#btn-cancel');
    const origText = btn.textContent;
    btn.textContent = 'Cancelling…';
    btn.disabled = true;
    try {
      const killed = await api.cancelCollect();
      appendLine(killed ? '✗ cancelled by user' : 'no active job', 'err');
      setFinal('cancelled', 'var(--fading, #8A8178)', 'white');
    } catch (e) {
      appendLine(`failed to cancel: ${e?.message || e}`, 'err');
    }
    btn.textContent = origText;
    btn.disabled = false;
    collectDone = true;
    clearInterval(tick);
    setTimeout(() => { location.hash = '#/'; }, 900);
  });

  openBtn.addEventListener('click', () => { location.hash = `#/topic/${slug}`; });

  function showRetryAction() {
    const actions = $('#collect-actions');
    if (actions.querySelector('#btn-retry')) return;
    const retry = document.createElement('button');
    retry.className = 'btn btn-primary';
    retry.id = 'btn-retry';
    retry.textContent = '↻ Retry';
    retry.onclick = () => { location.reload(); };
    actions.insertBefore(retry, $('#btn-open'));
    const home = document.createElement('button');
    home.className = 'btn btn-ghost';
    home.style.border = '1px solid var(--line)';
    home.textContent = 'Back to dashboard';
    home.onclick = () => { location.hash = '#/'; };
    actions.appendChild(home);
  }

  // --- start collect ---
  const aggressive = localStorage.getItem('gapmap.collect.last_aggressive') !== 'false';
  localStorage.removeItem('gapmap.collect.last_aggressive');
  try {
    await api.startCollect(topic, aggressive);
    appendLine(`→ started collect for "${topic}" (${aggressive ? 'aggressive — all sources + history' : 'quick — reddit only'})…`, 'info');
  } catch (e) {
    appendLine(`✗ failed to start: ${e?.message || e}`, 'err');
    setFinal('failed', 'var(--chronic, #B84747)', 'white');
    collectDone = true;
    clearInterval(tick);
    showRetryAction();
  }

  // --- cleanup ---
  const cleanup = () => {
    clearInterval(tick);
    try { unlistenProgress?.(); } catch {}
    try { unlistenDone?.();     } catch {}
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup);
}
