// Collect — streams sidecar output with colorized log lines, stage tracker,
// elapsed timer, error counter, copy/clear actions, and a post-run CTA row.

import { api, $, esc } from '../api.js';
import {
  COLLECT_STAGES as STAGES,
  classifyCollectLine as classifyLine,
  detectCollectStage as detectStage,
  fmtCollectElapsed as fmtElapsed,
} from '../lib/collectFormat.js';

// Module-scope persistence. When the user navigates away from #/collect/<topic>
// and comes back mid-collect, renderCollect remounts fresh — but the Python
// sidecar is still streaming `collect:progress` events. Without these maps
// we'd lose every log line emitted between unmount and remount. Each entry
// keyed by topic; cleared on collect:done so a fresh collect for the same
// topic starts clean. Capped at 5000 lines per topic to bound memory if a
// pathologically long collect spews logs.
const _collectLogs   = new Map();   // topic → [{text, cls}, …]  up to 5000
const _collectStatus = new Map();   // topic → 'running' | 'done' | 'failed'
const _collectStart  = new Map();   // topic → ms timestamp of first line
const MAX_PERSISTED_LINES = 5000;

function pushPersistedLine(topic, text, cls) {
  if (!_collectLogs.has(topic)) _collectLogs.set(topic, []);
  const arr = _collectLogs.get(topic);
  arr.push({ text, cls });
  if (arr.length > MAX_PERSISTED_LINES) {
    arr.splice(0, arr.length - MAX_PERSISTED_LINES);
  }
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

      <!-- Per-source status grid (hidden until the parallel stage starts).
           One chip per extra source (HN / arXiv / App Store / …) — status
           flips from pending → running → done/error as sidecar log lines
           arrive. Makes it obvious at a glance that the pipeline is actually
           hitting all 11 sources in parallel, not just Reddit. -->
      <div class="sources-grid" id="sources-grid" hidden>
        <div class="sources-grid-head">
          <b>Sources</b>
          <span id="sources-grid-count">0 of 0 done</span>
        </div>
        <div class="sources-grid-chips" id="sources-grid-chips"></div>
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

  // --- per-source status tracker ---
  // The Python side emits well-defined log markers for its parallel fetch
  // stage (see research/collect.py::_run_source):
  //   "[parallel] fetching N sources across W workers…"
  //   "[src] starting…"
  //   "[i/N] [src] ✓ 42 posts (3.1s)"       OR
  //   "[i/N] [src] ✓ trends series collected (2.7s)"   OR
  //   "[i/N] [src] ✗ <error> (4.8s)"
  // We translate those into live chip state so the user sees all 11 sources
  // flip from pending → running → done/error in parallel.
  // Keep in sync with Python `SOURCES` in
  // src/reddit_research/sources/collect_adapter.py. Any source listed in
  // that dict needs a pretty label here, otherwise the chip shows the
  // raw id ("youtube", "github_issues", …). An unknown id falls back to
  // `src` verbatim via the SOURCE_LABELS[src] || src pattern below, so
  // a missing label never breaks the UI — it just looks rough.
  const SOURCE_LABELS = {
    hn: 'Hacker News', appstore: 'App Store', playstore: 'Play Store',
    arxiv: 'arXiv', openalex: 'OpenAlex', pubmed: 'PubMed',
    gnews: 'Google News', devto: 'Dev.to', stackoverflow: 'Stack Overflow',
    github: 'GitHub', trends: 'Google Trends',
    scholar: 'Google Scholar', github_issues: 'GitHub Issues',
    lemmy: 'Lemmy', mastodon: 'Mastodon',
    youtube: 'YouTube',
    trustpilot: 'Trustpilot', producthunt: 'Product Hunt',
    alternativeto: 'AlternativeTo',
  };
  const sourceState = new Map();      // src → { status, count, error, elapsed }
  const sourcesGrid  = $('#sources-grid');
  const sourcesChips = $('#sources-grid-chips');
  const sourcesCount = $('#sources-grid-count');

  function ensureChip(src) {
    let chip = sourcesChips.querySelector(`[data-src="${src}"]`);
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'src-chip pending';
      chip.dataset.src = src;
      chip.innerHTML = `
        <span class="src-dot"></span>
        <span class="src-name">${esc(SOURCE_LABELS[src] || src)}</span>
        <span class="src-meta">pending</span>`;
      sourcesChips.appendChild(chip);
    }
    return chip;
  }

  function repaintCount() {
    const total = sourceState.size;
    const done = [...sourceState.values()].filter(s => s.status === 'done' || s.status === 'error').length;
    sourcesCount.textContent = `${done} of ${total} done`;
  }

  function updateSource(src, patch) {
    const prev = sourceState.get(src) || { status: 'pending', count: 0, error: null, elapsed: null };
    const next = { ...prev, ...patch };
    sourceState.set(src, next);
    const chip = ensureChip(src);
    chip.classList.remove('pending', 'running', 'done', 'error');
    chip.classList.add(next.status);
    const meta = chip.querySelector('.src-meta');
    if (next.status === 'running') meta.textContent = 'fetching…';
    else if (next.status === 'done') {
      if (src === 'trends') meta.textContent = `✓ trends (${next.elapsed ?? '—'}s)`;
      else meta.textContent = `✓ ${next.count ?? 0} posts`;
    } else if (next.status === 'error') meta.textContent = `✗ ${(next.error || 'failed').slice(0, 28)}`;
    else meta.textContent = 'pending';
    repaintCount();
  }

  // Match the exact log shapes emitted by research/collect.py.
  const RE_PARALLEL_START = /\[parallel\] fetching (\d+) sources/i;
  const RE_SOURCE_START   = /^\[([a-z_]+)\] starting…/i;
  const RE_SOURCE_DONE    = /\[\d+\/\d+\]\s*\[([a-z_]+)\]\s*✓\s*(\d+)\s*posts\s*\(([\d.]+)s\)/i;
  const RE_SOURCE_TRENDS  = /\[\d+\/\d+\]\s*\[([a-z_]+)\]\s*✓\s*trends series collected\s*\(([\d.]+)s\)/i;
  const RE_SOURCE_ERR     = /\[\d+\/\d+\]\s*\[([a-z_]+)\]\s*✗\s*(.+?)\s*\(([\d.]+)s\)/i;

  // The default aggressive source sweep (keep in sync with
  // research/collect.py `if aggressive: sources = [...]`). Used to seed
  // pending chips up-front so the user sees "11 queued" the moment the
  // parallel stage begins, even though only _PARALLEL_SOURCES=6 can run
  // at a time.
  const AGGRESSIVE_SOURCES = [
    'hn', 'appstore', 'playstore', 'producthunt',
    'arxiv', 'openalex', 'pubmed',
    'gnews', 'devto', 'stackoverflow', 'github', 'trends',
  ];

  function maybeUpdateSourceGrid(text) {
    let m;
    if ((m = text.match(RE_PARALLEL_START))) {
      // Reveal the grid and pre-seed pending chips for the full aggressive
      // source list (11 sources). The parser honors whatever N the Python
      // side actually reported — if the user ran a custom --sources subset,
      // the extras will just sit at "pending" until they time out, which
      // is fine because errors mark them red anyway.
      sourcesGrid.hidden = false;
      for (const s of AGGRESSIVE_SOURCES) {
        if (!sourceState.has(s)) updateSource(s, { status: 'pending' });
      }
      return true;
    }
    if ((m = text.match(RE_SOURCE_DONE))) {
      updateSource(m[1], { status: 'done', count: Number(m[2]), elapsed: Number(m[3]).toFixed(1) });
      return true;
    }
    if ((m = text.match(RE_SOURCE_TRENDS))) {
      updateSource(m[1], { status: 'done', elapsed: Number(m[2]).toFixed(1) });
      return true;
    }
    if ((m = text.match(RE_SOURCE_ERR))) {
      updateSource(m[1], { status: 'error', error: m[2], elapsed: Number(m[3]).toFixed(1) });
      return true;
    }
    if ((m = text.match(RE_SOURCE_START))) {
      sourcesGrid.hidden = false;
      updateSource(m[1], { status: 'running' });
      return true;
    }
    return false;
  }

  const appendLine = (text, cls = null, { persist = true } = {}) => {
    lineCount++;
    const klass = cls || classifyLine(text);
    const stage = detectStage(text);
    if (stage) markStage(stage);
    // Side-effect: update chip grid if this line is a source marker. We
    // still append the raw line to the log so power users see everything.
    maybeUpdateSourceGrid(text);
    if (klass === 'err') { errCount++; errsEl.textContent = errCount; errsWrap.classList.add('has-errors'); }
    linesEl.textContent = lineCount;
    const div = document.createElement('div');
    div.className = `line line-${klass}`;
    div.textContent = text;
    log.appendChild(div);
    if (autoscroll.checked) log.scrollTop = log.scrollHeight;
    // Persist so navigating away + back rehydrates the same log. On rehydrate
    // we pass persist=false so we don't double-count lines into the backing
    // array.
    if (persist) pushPersistedLine(topic, text, klass);
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
      _collectStatus.set(topic, 'done');
    } catch (e) {
      appendLine(`✗ ${e?.message || e}`, 'err');
      setFinal('failed', 'var(--chronic, #B84747)', 'white');
      sub.textContent = 'Graph build failed.';
      _collectStatus.set(topic, 'failed');
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
  // Read the source-picker output from localStorage. The topic-page Rerun
  // modal stashes its choices here BEFORE navigating; the new-topic flow
  // (no picker) leaves them unset → defaults below.
  const aggressive = localStorage.getItem('gapmap.collect.last_aggressive') !== 'false';
  const sourcesStr = localStorage.getItem('gapmap.collect.last_sources') || '';
  const skipReddit = localStorage.getItem('gapmap.collect.last_skip_reddit') === 'true';
  // One-shot — clear so a manual reload doesn't carry the previous filter.
  localStorage.removeItem('gapmap.collect.last_aggressive');
  localStorage.removeItem('gapmap.collect.last_sources');
  localStorage.removeItem('gapmap.collect.last_skip_reddit');

  // Build a human-readable filter summary for the log line.
  const sourcesArg = sourcesStr ? sourcesStr : null;
  let filterSummary;
  if (skipReddit && sourcesArg) {
    filterSummary = `skip-reddit · only ${sourcesArg}`;
  } else if (sourcesArg) {
    filterSummary = `reddit + ${sourcesArg}`;
  } else if (aggressive) {
    filterSummary = 'aggressive — all sources + history';
  } else {
    filterSummary = 'quick — reddit only';
  }

  // Rehydrate persisted log first, BEFORE calling startCollect — if we're
  // revisiting an in-flight collect, the user should see the full history
  // immediately instead of an empty log until the next line ticks in.
  const persisted = _collectLogs.get(topic);
  let isRevisit = false;
  if (persisted && persisted.length) {
    isRevisit = true;
    for (const { text, cls } of persisted) {
      appendLine(text, cls, { persist: false });
    }
  }

  try {
    const result = await api.startCollect(topic, aggressive, sourcesArg, skipReddit);
    if (result && result.already_running) {
      // Another tab / earlier session of this very topic is already streaming.
      // Don't log "→ started…" — the log above already has the history and
      // new events will land via the collect:progress subscription set up
      // earlier in renderCollect.
      if (!isRevisit) {
        appendLine(`↻ attached to in-flight collect for "${topic}"…`, 'info');
      }
    } else {
      appendLine(`→ started collect for "${topic}" (${filterSummary})…`, 'info');
    }
    _collectStatus.set(topic, 'running');
    _collectStart.set(topic, Date.now());
  } catch (e) {
    appendLine(`✗ failed to start: ${e?.message || e}`, 'err');
    setFinal('failed', 'var(--chronic, #B84747)', 'white');
    collectDone = true;
    clearInterval(tick);
    _collectStatus.set(topic, 'failed');
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
