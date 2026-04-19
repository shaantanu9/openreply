// Collect — streams sidecar output with colorized log lines, stage tracker,
// elapsed timer, error counter, copy/clear actions, and a post-run CTA row.

import { api, $, esc } from '../api.js';
import {
  COLLECT_STAGES as STAGES,
  classifyCollectLine as classifyLine,
  detectCollectStage as detectStage,
  fmtCollectElapsed as fmtElapsed,
} from '../lib/collectFormat.js';

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

      <div class="now-banner" id="now-banner" style="margin:14px 0 10px;padding:12px 14px;background:var(--surface-2);border:1px solid var(--line);border-radius:10px;display:flex;align-items:center;gap:10px">
        <span id="now-spinner" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:2px solid var(--line);border-top-color:var(--orange);border-radius:50%;animation:nowspin 1s linear infinite;flex-shrink:0"></span>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;color:var(--ink-3);text-transform:uppercase;letter-spacing:0.05em;font-weight:700;margin-bottom:2px">Now</div>
          <div id="now-text" style="font-size:13px;color:var(--ink-1);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Starting up…</div>
        </div>
      </div>

      <div class="log-toolbar">
        <label class="log-check">
          <input type="checkbox" id="log-autoscroll" checked />
          <span>Auto-scroll</span>
        </label>
        <div style="flex:1"></div>
        <button class="btn btn-ghost btn-xs btn-bordered icon-btn" id="btn-copy-log" aria-label="Copy log to clipboard" title="Copy log"><i data-lucide="copy"></i></button>
        <button class="btn btn-ghost btn-xs btn-bordered icon-btn" id="btn-clear-log" aria-label="Clear log" title="Clear log"><i data-lucide="trash-2"></i></button>
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

  const nowText = $('#now-text');
  const nowSpinner = $('#now-spinner');

  // --- subscribe before starting ---
  const unlistenProgress = await api.onCollectProgress(line => {
    appendLine(line);
    const short = line.slice(0, 140);
    sub.textContent = short;
    // Strip rich-formatting "• " prefix the sidecar prepends, then surface
    // the most recent meaningful line as the big "Now" banner text.
    const clean = line.replace(/^\s*[•·→]\s*/, '').trim();
    if (clean && nowText) nowText.textContent = clean.slice(0, 120);
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
      const cls = payload?.error_class || 'unknown';
      const hint = payload?.hint || `Collect exited ${payload?.code}.`;
      appendLine(`✗ collect exited with code ${payload?.code} [${cls}]`, 'err');
      appendLine(`  ${hint}`, 'err');
      setFinal(cls === 'reddit_rate_limit' ? 'rate-limited' : 'failed',
               'var(--chronic, #B84747)', 'white');
      sub.textContent = hint;
      if (nowText) nowText.textContent = `✗ ${cls.replace(/_/g, ' ')}`;
      if (nowSpinner) nowSpinner.style.animation = 'none';
      showRetryAction();
      return;
    }

    appendLine('✓ collect finished — now building graph…', 'done');
    markStage('graph');
    try {
      const g = await api.buildGraph(topic);
      appendLine(`✓ structural graph built: ${g.total_nodes} nodes / ${g.total_edges} edges`, 'done');

      // Enrichment — LLM extracts painpoints / features / workarounds.
      // Safe even with no LLM configured: Python returns {ok:false, skipped:true}.
      markStage('enrich');
      appendLine('→ extracting painpoints via LLM…', 'info');
      try {
        const e = await api.enrichGraph(topic);
        if (e?.skipped) {
          appendLine(`⚠ enrichment skipped: ${e.reason || 'no LLM configured'}`, 'warn');
          appendLine('  gap map will show posts only, no painpoints. Add a key in Settings → API keys.', 'warn');
        } else if (e?.ok === false) {
          appendLine(`⚠ enrichment failed: ${e.error || 'unknown'}`, 'warn');
        } else {
          const np = e?.painpoints_added ?? e?.painpoints ?? 0;
          const nf = e?.feature_wishes_added ?? e?.feature_wishes ?? 0;
          const nw = e?.workarounds_added ?? e?.diy_workarounds ?? 0;
          appendLine(`✓ enrichment: +${np} painpoints, +${nf} feature wishes, +${nw} workarounds`, 'done');
        }
      } catch (err) {
        appendLine(`⚠ enrichment errored: ${err?.message || err}`, 'warn');
      }

      markStage('export');
      appendLine('✓ exporting HTML viewer…', 'done');
      exportPath = await api.exportHtml(topic);
      appendLine(`✓ ready: ${exportPath}`, 'done');
      setFinal('✓ ready', 'var(--mint)', '#1A3424');
      sub.textContent = `Completed in ${fmtElapsed(Date.now() - startTs)} · ${lineCount} log lines · ${errCount} errors`;
      if (nowText) nowText.textContent = '✓ Done — gap map ready';
      if (nowSpinner) nowSpinner.style.animation = 'none';
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
    const orig = b.innerHTML;
    b.innerHTML = '<i data-lucide="check"></i> copied';
    window.refreshIcons?.();
    setTimeout(() => { b.innerHTML = orig; window.refreshIcons?.(); }, 1400);
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
    retry.className = 'btn btn-primary icon-btn';
    retry.id = 'btn-retry';
    retry.innerHTML = '<i data-lucide="rotate-cw"></i> Retry';
    retry.onclick = () => { location.reload(); };
    actions.insertBefore(retry, $('#btn-open'));
    const home = document.createElement('button');
    home.className = 'btn btn-ghost';
    home.style.border = '1px solid var(--line)';
    home.textContent = 'Back to dashboard';
    home.onclick = () => { location.hash = '#/'; };
    actions.appendChild(home);
    window.refreshIcons?.();
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
