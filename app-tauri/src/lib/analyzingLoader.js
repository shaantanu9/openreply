// Shared "Analyzing…" loader — the five-element alive-feeling loader from the
// loader-progress-ux skill, extracted from screens/sentiment.js so EVERY tab
// that fires a 5+second blocking LLM call can reuse it in ~5 lines.
//
// Provides:
//   renderAnalyzingState(contentEl, opts) → cleanup({snapToComplete})
//   pollUntil(contentEl, { fetch, render, total, ... })  → stop()
//   kickAndPoll(contentEl, { run, fetch, render, ... })   → Promise
//
// The CSS lives under the `.gm-az-*` namespace in style.css (added alongside
// this file). Sentiment keeps its own `.sent-*` classes for back-compat; new
// adopters use this.
//
// Why a shared helper and not per-screen copies: the loader has subtle
// correctness requirements (interval cleanup, detached-DOM guard, asymptotic
// curve, tab-still-active checks) that are easy to get wrong when copy-pasted.
// One audited implementation → every tab benefits.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

// A sensible generic stage list. Callers SHOULD pass domain-specific stages
// (e.g. persona-building, insight-synthesis) — these are the fallback.
export const DEFAULT_STAGES = [
  'Connecting to the model…',
  'Reading the corpus for this topic…',
  'Analyzing patterns across sources…',
  'Synthesizing the result…',
  'Almost done — packaging output…',
];

// Persistent run-start registry. The loader's elapsed / progress / stage are
// a function of WHEN THE RUN STARTED, not when this particular mount happened.
// Without this, re-mounting the loader (e.g. switching a topic tab away and
// back mid-run) reset the counter to "0s / 0% / stage-0" even though the
// backend call kept running — the reported sentiment-loader bug. Pass a stable
// `runKey` (e.g. `concepts:<topic>`) and every re-mount continues from the real
// elapsed. Keys auto-expire so a leaked (never-cleaned-up) run can't pin a
// future fresh run to a stale start.
const RUN_STALE_MS = 15 * 60 * 1000;
const _runStarts = new Map(); // runKey -> startedAtMs

function resolveRunStart(runKey, explicitStartedAt, now) {
  if (runKey) {
    const prev = _runStarts.get(runKey);
    if (Number.isFinite(prev) && now - prev < RUN_STALE_MS) return prev;
    _runStarts.set(runKey, now);
    return now;
  }
  return Number.isFinite(explicitStartedAt) ? explicitStartedAt : now;
}

/**
 * Pure derivation of the loader's elapsed / progress / stage from the run's
 * REAL start. Side-effect-free so a re-mounted loader can paint the correct
 * state on frame 1 and continue ticking from the actual elapsed time.
 *   • pct: asymptotic 0 → 90% via 1 - e^(-t/τ) (never hits 100% on its own).
 *   • stageIdx: elapsed / stageStep, capped at the last stage; stageStep is
 *     sized so the final stage lands ~median runtime.
 */
export function analyzingProgress(startedAtMs, nowMs, { medianRuntimeSec = 45, stageCount = DEFAULT_STAGES.length } = {}) {
  const start = Number.isFinite(startedAtMs) ? startedAtMs : nowMs;
  const elapsedSec = Math.max(0, (nowMs - start) / 1000);
  const pct = Math.min(90, 90 * (1 - Math.exp(-elapsedSec / medianRuntimeSec)));
  const stageStepSec = Math.max(4, (medianRuntimeSec / Math.max(1, stageCount)) * 1.2);
  const stageIdx = Math.min(Math.max(0, stageCount - 1), Math.floor(elapsedSec / stageStepSec));
  return { elapsedSec, pct, stageIdx, stageStepSec };
}

// One generic skeleton card. Mirrors a typical card: title bar + two meta
// chips + two text lines. Pass `skeletonCardHtml` to match a specific layout
// (prevents reflow on swap-in).
export function genericSkeletonCard() {
  return `
    <div class="gm-az-card gm-az-card-skel">
      <div class="skel skel-bar" style="width:55%;height:14px;border-radius:6px"></div>
      <div class="gm-az-card-meta">
        <span class="skel" style="width:60px;height:14px;border-radius:999px"></span>
        <span class="skel" style="width:48px;height:14px;border-radius:999px"></span>
      </div>
      <div class="skel skel-bar" style="width:92%;height:12px;border-radius:6px"></div>
      <div class="skel skel-bar" style="width:80%;height:12px;border-radius:6px"></div>
    </div>`;
}

/**
 * Mount the full-bleed "Analyzing" loader. Returns a cleanup function the
 * caller MUST invoke when replacing the markup (otherwise the 1s interval
 * keeps firing against a detached DOM — there's a self-terminating guard too,
 * but explicit cleanup is correct).
 *
 * @param {HTMLElement} contentEl
 * @param {object} opts
 * @param {string} [opts.headline]
 * @param {string[]} [opts.stages]
 * @param {number} [opts.medianRuntimeSec]  drives the asymptotic curve + stage cadence
 * @param {string} [opts.etaText]
 * @param {number} [opts.skeletonCount]
 * @param {string} [opts.skeletonCardHtml]  one card's HTML (repeated skeletonCount times)
 * @returns {(o?:{snapToComplete?:boolean})=>void} cleanup
 */
export function renderAnalyzingState(contentEl, opts = {}) {
  const {
    headline = 'Analyzing…',
    stages = DEFAULT_STAGES,
    medianRuntimeSec = 45,
    etaText = 'typically 30–90 seconds',
    skeletonCount = 3,
    skeletonCardHtml = genericSkeletonCard(),
    runKey = null,      // stable per-run id → elapsed continues across re-mounts
    startedAt: explicitStartedAt,  // explicit alternative when caller owns the timestamp
  } = opts;

  const stageList = Array.isArray(stages) && stages.length ? stages : DEFAULT_STAGES;
  // Resolve the run's REAL start so a re-mount continues the count.
  const startedAt = resolveRunStart(runKey, explicitStartedAt, Date.now());
  const progressOpts = { medianRuntimeSec, stageCount: stageList.length };
  // Initial values from real elapsed → no "0s / 0%" flash when re-mounting.
  const init = analyzingProgress(startedAt, Date.now(), progressOpts);

  contentEl.innerHTML = `
    <div class="gm-az" aria-busy="true" aria-live="polite">
      <div class="gm-az-hero">
        <div class="gm-az-spinner" aria-hidden="true"></div>
        <h3 class="gm-az-title">${esc(headline)}</h3>
        <p class="gm-az-stage" id="gm-az-stage">${esc(stageList[init.stageIdx])}</p>
        <div class="gm-az-meta">
          <span class="gm-az-elapsed" id="gm-az-elapsed">${Math.round(init.elapsedSec)}s elapsed</span>
          <span class="gm-az-eta">${esc(etaText)}</span>
        </div>
        <div class="gm-az-bar" role="progressbar" aria-label="Working">
          <div class="gm-az-fill" id="gm-az-fill" style="width:${init.pct.toFixed(1)}%"></div>
        </div>
      </div>
      <div class="gm-az-grid" aria-hidden="true">
        ${skeletonCardHtml.repeat(Math.max(1, skeletonCount))}
      </div>
    </div>`;

  const stageEl = contentEl.querySelector('#gm-az-stage');
  const elapsedEl = contentEl.querySelector('#gm-az-elapsed');
  const fillEl = contentEl.querySelector('#gm-az-fill');

  const tick = setInterval(() => {
    if (!document.body.contains(elapsedEl)) { clearInterval(tick); return; }
    const { elapsedSec, pct, stageIdx } = analyzingProgress(startedAt, Date.now(), progressOpts);
    elapsedEl.textContent = `${Math.round(elapsedSec)}s elapsed`;
    if (fillEl) fillEl.style.width = `${pct.toFixed(1)}%`;
    if (stageEl && stageEl.textContent !== stageList[stageIdx]) {
      stageEl.textContent = stageList[stageIdx];
    }
  }, 1000);

  return function cleanup({ snapToComplete = false } = {}) {
    clearInterval(tick);
    // Run is over (success or error) — forget its start so the next fresh run
    // begins at 0 rather than continuing this one's elapsed.
    if (runKey) _runStarts.delete(runKey);
    if (snapToComplete && fillEl && document.body.contains(fillEl)) {
      fillEl.style.width = '100%';
    }
  };
}

/**
 * Live-poll SQLite (or any data source) while a blocking call runs, swapping
 * skeleton cards for real ones as rows land. Works because `api.runQuery`
 * bypasses the sidecar daemon mutex (native rusqlite), so polling returns even
 * while the LLM holds the daemon. Returns a `stop()` the caller MUST invoke.
 *
 * @param {HTMLElement} contentEl
 * @param {object} cfg
 * @param {() => Promise<any[]>} cfg.fetch          returns the rows persisted so far
 * @param {(row:any) => string} cfg.renderCardHtml  one row → card HTML
 * @param {(row:any) => string} cfg.keyOf           stable per-row identity
 * @param {number} [cfg.total]                       expected count (for the "X of N" counter)
 * @param {string} [cfg.unit]                        e.g. 'sources', 'personas'
 * @param {string} [cfg.tabName]                     contentEl.dataset.tab guard
 * @param {number} [cfg.intervalMs]
 * @returns {() => void} stop
 */
export function startLivePolling(contentEl, cfg = {}) {
  const {
    fetch, renderCardHtml, keyOf,
    total = null, unit = 'items', tabName = null,
    intervalMs = 1500,
  } = cfg;
  const grid = contentEl.querySelector('.gm-az-grid');
  if (!grid || typeof fetch !== 'function' || typeof renderCardHtml !== 'function') {
    return () => {};
  }
  const heroMeta = contentEl.querySelector('.gm-az-meta');
  let counterEl = contentEl.querySelector('#gm-az-count');
  if (heroMeta && !counterEl) {
    counterEl = document.createElement('span');
    counterEl.id = 'gm-az-count';
    counterEl.className = 'gm-az-count';
    counterEl.textContent = total ? `0 of ${total} ${unit} analyzed` : `0 ${unit} analyzed`;
    heroMeta.appendChild(counterEl);
  }
  const seen = new Set();
  let stopped = false;

  const tick = async () => {
    if (stopped || !document.body.contains(grid)) return;
    if (tabName && contentEl.dataset.tab !== tabName) return;
    let rows = [];
    try { rows = await fetch(); } catch { return; }
    if (stopped || !document.body.contains(grid)) return;
    for (const row of rows || []) {
      const key = keyOf ? keyOf(row) : JSON.stringify(row);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const wrap = document.createElement('div');
      wrap.innerHTML = renderCardHtml(row);
      const card = wrap.firstElementChild;
      if (!card) continue;
      const skel = grid.querySelector('.gm-az-card-skel');
      if (skel) skel.replaceWith(card);
      else grid.insertBefore(card, grid.firstChild);
    }
    if (counterEl) {
      counterEl.textContent = total
        ? `${seen.size} of ${total} ${unit} analyzed`
        : `${seen.size} ${unit} analyzed`;
    }
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  return function stop() { stopped = true; clearInterval(timer); };
}

/**
 * The full kick-and-poll orchestration: mount the hero, fire the blocking
 * `run()`, poll the DB while it runs, then re-render from the authoritative
 * source on completion. Handles {skipped}/{error} payloads and exceptions.
 *
 * @param {HTMLElement} contentEl
 * @param {object} cfg
 * @param {() => Promise<any>}   cfg.run            the blocking LLM call
 * @param {() => Promise<any[]>} cfg.fetch          rows persisted so far (for polling)
 * @param {(row:any)=>string}    cfg.renderCardHtml
 * @param {(row:any)=>string}    [cfg.keyOf]
 * @param {() => Promise<void>}  cfg.onDone         re-render from DB after success
 * @param {(msg:string)=>void}   cfg.onEmptyOrError render skip/error state
 * @param {() => Promise<number|null>} [cfg.countTotal]
 * @param {object} [cfg.loaderOpts]                 passed to renderAnalyzingState
 * @param {string} [cfg.unit]
 * @param {string} [cfg.tabName]
 */
export async function kickAndPoll(contentEl, cfg = {}) {
  const {
    run, fetch, renderCardHtml, keyOf, onDone, onEmptyOrError,
    countTotal, loaderOpts = {}, unit = 'items', tabName = null,
  } = cfg;

  const stopAnalyzing = renderAnalyzingState(contentEl, loaderOpts);
  const totalPromise = typeof countTotal === 'function'
    ? countTotal().catch(() => null)
    : Promise.resolve(null);
  let stopPolling = () => {};
  try {
    const runPromise = run();
    const total = await totalPromise;
    stopPolling = startLivePolling(contentEl, {
      fetch, renderCardHtml, keyOf, total, unit, tabName,
    });
    const result = await runPromise;
    stopPolling();
    if (result?.skipped) {
      stopAnalyzing();
      onEmptyOrError?.(result.reason || 'Skipped — no LLM provider configured.');
      return;
    }
    if (result?.error) {
      stopAnalyzing();
      onEmptyOrError?.(result.error);
      return;
    }
    stopAnalyzing({ snapToComplete: true });
    await onDone?.();
  } catch (e) {
    stopPolling();
    stopAnalyzing();
    onEmptyOrError?.(e?.message || String(e));
  }
}
