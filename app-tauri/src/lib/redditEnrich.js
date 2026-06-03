// Two-phase collect: fast sources first, Reddit in the background.
//
// Reddit's first fetch for a topic can take ~15 min (sub discovery + top/search
// + historical across many subs). Blocking the whole collect — and therefore
// the gap graph + AI conclusions — on that is a terrible first-run experience.
//
// So when a collect WANTS Reddit, we split it:
//   Phase 1 (foreground): collect the fast external sources with skip_reddit=ON.
//            Posts land in ~2-3 min → the enrich worker builds the graph +
//            conclusions → the user sees results almost immediately.
//   Phase 2 (background): once Phase 1's collect:done fires, kick a Reddit-ONLY
//            collect for the same topic (queued, non-blocking). Its posts get
//            tagged + enqueued, and the SAME long-lived enrich worker folds them
//            into the existing graph incrementally — the map just gets richer.
//
// This file is the orchestration glue. It reuses the existing `startCollect`
// command and the enrich worker; no pipeline surgery. Phase 1 alone is always a
// valid collect, so if Phase 2 fails to launch the user still has full results.

import { api } from '../api.js';

const PENDING_PREFIX = 'gapmap.collect.reddit_pending::';

// Topics whose background Reddit pass is currently running — prevents launching
// a duplicate Reddit collect and lets us clear the banner on its own done event.
const _redditRunning = new Set();

/**
 * Mark that `topic` still needs its Reddit pass after the fast Phase-1 collect.
 * Called by main.js when the chosen intent profile includes Reddit.
 * @param {string} topic
 * @param {{aggressive?: boolean}} [opts]
 */
export function markRedditPending(topic, opts = {}) {
  if (!topic) return;
  try {
    localStorage.setItem(
      PENDING_PREFIX + topic,
      JSON.stringify({ aggressive: opts.aggressive !== false, at: nowSec() }),
    );
  } catch { /* storage full / unavailable — Phase 2 just won't run */ }
}

function consumeRedditPending(topic) {
  if (!topic) return null;
  const key = PENDING_PREFIX + topic;
  let raw = null;
  try { raw = localStorage.getItem(key); localStorage.removeItem(key); } catch {}
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return { aggressive: true }; }
}

function nowSec() { return Math.floor(Date.now() / 1000); }

// ── Non-blocking "Reddit enriching" banner ──────────────────────────────────
let _bannerEl = null;
function showRedditBanner(topic) {
  if (_bannerEl) { _bannerEl.querySelector('.re-topic').textContent = topic; return; }
  const el = document.createElement('div');
  el.className = 're-banner';
  el.innerHTML = `
    <span class="re-dot" aria-hidden="true"></span>
    <span>Fetching <b>Reddit</b> for "<span class="re-topic">${escapeHtml(topic)}</span>" in the background — results update automatically.</span>
    <button type="button" class="re-dismiss" title="Hide">✕</button>`;
  el.querySelector('.re-dismiss').onclick = () => hideRedditBanner();
  document.body.appendChild(el);
  _bannerEl = el;
}
function hideRedditBanner() {
  if (_bannerEl) { _bannerEl.remove(); _bannerEl = null; }
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/**
 * Kick the background Reddit-only collect for `topic`. Reused command:
 * startCollect(topic, aggressive, sources='', skipReddit=false, ifBusy='queue').
 * Empty sources + skip_reddit=false ⇒ Reddit-only (sub discovery + fetch).
 */
async function startRedditPass(topic, opts) {
  if (_redditRunning.has(topic)) return;
  _redditRunning.add(topic);
  showRedditBanner(topic);
  try {
    // Attribute the background collect's progress + collect:done to this topic.
    // Without this, _activeTopic is null (we're not on the collect screen), so
    // its done event reports topic=null and the banner would never clear.
    try {
      const { setActiveCollectTopic } = await import('../screens/collect.js');
      setActiveCollectTopic(topic);
    } catch {}
    // 'queue' so it waits politely if any collect is still active; never errors out.
    await api.startCollect(topic, opts?.aggressive !== false, '', false, 'queue', false);
    // Make sure the incremental extractor is up to fold Reddit posts into the
    // graph as they land (idempotent — no-op if already running).
    try { await api.startExtractionWorker(); } catch {}
  } catch (e) {
    // Phase-1 results stand on their own; surface but don't block.
    // eslint-disable-next-line no-console
    console.warn('[reddit-enrich] background Reddit pass failed to start:', e);
    _redditRunning.delete(topic);
    hideRedditBanner();
  }
}

/**
 * Wire the two-phase orchestration. Idempotent — safe to call once at app boot.
 * Listens for the global collect:done bus event (fires regardless of which
 * screen is mounted) and chains Phase 2 when a topic has a pending Reddit pass.
 */
let _wired = false;
export function wireRedditEnrich() {
  if (_wired) return;
  _wired = true;
  window.addEventListener('gapmap:collect-done-global', (ev) => {
    const topic = ev.detail?.topic;
    const code = ev.detail?.payload?.code;
    if (!topic) return;

    // If THIS done belongs to the background Reddit pass, clear its banner and stop.
    if (_redditRunning.has(topic)) {
      _redditRunning.delete(topic);
      // Only hide if no other topic's Reddit pass is still running.
      if (_redditRunning.size === 0) hideRedditBanner();
      return;
    }

    // Phase-1 finished. Only chain Reddit on a SUCCESSFUL collect (code 0);
    // a failed/cancelled Phase 1 shouldn't silently start a 15-min Reddit job.
    const pending = consumeRedditPending(topic);
    if (!pending) return;
    if (code !== 0) return;
    startRedditPass(topic, pending);
  });
}
