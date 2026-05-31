// Sentiment tab — per-source sentiment cards.
// Reads from graph_nodes kind='source_sentiment' (persisted by the
// Python sentiment_by_source pipeline). Run button kicks off the LLM
// aggregation; results land in the same node table for fast re-renders.
import { api, esc } from '../api.js';
import { skelGrid } from '../lib/skeleton.js';

const $ = (sel, root = document) => root.querySelector(sel);

const EMOTION_EMOJI = {
  anger: '😠',
  anticipation: '👀',
  joy: '😊',
  trust: '🤝',
  fear: '😨',
  surprise: '😯',
  sadness: '😞',
  disgust: '🤢',
};

const SENTIMENT_TONE = {
  positive: { class: 'sent-pos', label: 'positive' },
  negative: { class: 'sent-neg', label: 'negative' },
  neutral:  { class: 'sent-neu', label: 'neutral' },
  mixed:    { class: 'sent-mix', label: 'mixed' },
};

async function fetchSentimentData(topic) {
  const sql = `
    SELECT label, metadata_json
    FROM graph_nodes
    WHERE topic = :topic AND kind = 'source_sentiment'
    ORDER BY label
  `;
  const rows = await api.runQuery(sql, topic);
  return (rows || []).map(r => {
    let meta = {};
    try { meta = JSON.parse(r.metadata_json || '{}'); } catch {}
    return { label: r.label, ...meta };
  });
}

function renderEmotionChips(emotions) {
  if (!emotions || !emotions.length) return '<span class="muted">no signal</span>';
  return emotions.map(e => {
    const emo = EMOTION_EMOJI[e] || '';
    return `<span class="sent-emo">${emo} ${esc(e)}</span>`;
  }).join(' ');
}

function renderThemes(themes) {
  if (!themes || !themes.length) return '';
  return `
    <div class="sent-themes">
      ${themes.map(t => `<span class="sent-theme-chip">${esc(t)}</span>`).join('')}
    </div>
  `;
}

function renderCard(s) {
  const tone = SENTIMENT_TONE[(s.label || '').toLowerCase()] || SENTIMENT_TONE.neutral;
  const conf = s.confidence ? `<span class="sent-conf">${esc(s.confidence)} confidence</span>` : '';
  const quote = s.representative_quote
    ? `<blockquote class="sent-quote">"${esc(s.representative_quote)}"</blockquote>`
    : '';
  return `
    <div class="sent-card ${tone.class}">
      <div class="sent-card-head">
        <div class="sent-card-title">${esc(s.label || s.source || '?')}</div>
        <div class="sent-card-meta">
          <span class="sent-tone">${esc(tone.label)}</span>
          ${conf}
          <span class="sent-count">${(s.n_posts || 0).toLocaleString()} posts</span>
        </div>
      </div>
      <div class="sent-emos">${renderEmotionChips(s.dominant_emotions)}</div>
      <p class="sent-summary">${esc(s.summary || '—')}</p>
      ${quote}
      ${renderThemes(s.common_themes)}
    </div>
  `;
}

function renderEmptyCta(topic) {
  return `
    <div class="empty-state">
      <p>No sentiment analysis yet for <b>${esc(topic)}</b>.</p>
      <p class="muted">Aggregates how each source community (Reddit, HN, arXiv, etc.) feels about this topic in one LLM pass per source.</p>
      <button class="btn btn-primary icon-btn" id="btn-run-sent"><i data-lucide="play"></i> Run sentiment analysis</button>
      <div id="sent-status" class="muted" style="margin-top:8px"></div>
    </div>
  `;
}

// Stages cycled through during the "Analyzing…" loader so the user sees
// what's happening behind the single-blocking-call `runSentimentBySource`
// API (no progress NDJSON stream is plumbed for this endpoint — the LLM
// fans out per-source server-side and returns one consolidated payload).
// Times are coarse: chosen so the 6th stage shows up around the 60-second
// mark — past the median run-time but well inside the 30–90s expected
// window. The user reads them in order, not by clock; the value is "this
// is doing real work" not "this is exactly at step 4".
export const SENT_STAGES = [
  'Connecting to LLM…',
  'Sampling posts from each source…',
  'Reading what the community actually says…',
  'Detecting tone and emotion per source…',
  'Pulling out representative quotes…',
  'Summarizing per-source sentiment…',
  'Almost done — packaging results…',
];

// Pure derivation of the loader's elapsed / progress / stage from the run's
// REAL start timestamp. Kept side-effect-free so the analyzing hero can be
// re-mounted (e.g. after a tab switch away and back) and continue from the
// actual elapsed time instead of resetting to 0 — see sentiment.progress.test.mjs.
//   • pct: asymptotic 0 → 90% via 1 - e^(-t/45) (never hits 100% on its own).
//   • stageIdx: elapsed-seconds / 9, capped at the last stage.
export function sentimentLoaderProgress(startedAtMs, nowMs) {
  const start = Number.isFinite(startedAtMs) ? startedAtMs : nowMs;
  const elapsedSec = Math.max(0, (nowMs - start) / 1000);
  const pct = Math.min(90, 90 * (1 - Math.exp(-elapsedSec / 45)));
  const stageIdx = Math.min(SENT_STAGES.length - 1, Math.floor(elapsedSec / 9));
  return { elapsedSec, pct, stageIdx };
}

// Mount a full-bleed "Analyzing" loading state that FEELS alive:
//   • 44px orange spinner up top so eyes have something obvious to track.
//   • Cycling stage messages every ~9s (see SENT_STAGES above).
//   • Live elapsed-seconds counter ticking every 1s.
//   • Asymptotic progress bar (0 → 90% via 1 - e^(-t/45), never reaches
//     100% until the API resolves) — feels like progress without lying
//     about an unknown ETA.
//   • Skeleton cards mirroring the eventual `.sent-grid` layout, so when
//     real cards arrive the page doesn't visually reflow.
// Returns a cleanup function the caller MUST invoke when replacing this
// markup; otherwise the interval keeps firing against a detached DOM.
function renderAnalyzingState(contentEl, { headline = 'Analyzing sentiment per source', startedAt } = {}) {
  // `startedAt` is the run's REAL start time (persisted across tab re-entries
  // in `_sentimentRunStart`). When omitted we default to now (fresh run).
  const startedAtMs = Number.isFinite(startedAt) ? startedAt : Date.now();
  // Initial values computed from the real elapsed so a re-mount paints the
  // right state on frame 1 instead of flashing "0s elapsed / 0% / stage 0".
  const init = sentimentLoaderProgress(startedAtMs, Date.now());
  const skeletonCard = `
    <div class="sent-card sent-card-skel">
      <div class="sent-card-head">
        <div class="skel skel-bar" style="width:55%;height:14px;border-radius:6px"></div>
        <div class="sent-card-meta">
          <span class="skel" style="width:60px;height:14px;border-radius:999px"></span>
          <span class="skel" style="width:48px;height:14px;border-radius:999px"></span>
          <span class="skel" style="width:80px;height:12px;border-radius:6px"></span>
        </div>
      </div>
      <div class="sent-emos">
        <span class="skel" style="width:54px;height:18px;border-radius:999px"></span>
        <span class="skel" style="width:62px;height:18px;border-radius:999px"></span>
        <span class="skel" style="width:50px;height:18px;border-radius:999px"></span>
      </div>
      <div class="skel skel-bar" style="width:92%;height:12px;border-radius:6px"></div>
      <div class="skel skel-bar" style="width:80%;height:12px;border-radius:6px"></div>
      <div class="skel" style="height:42px;border-radius:6px;margin-top:4px"></div>
    </div>
  `;
  contentEl.innerHTML = `
    <div class="sent-tab sent-analyzing" aria-busy="true" aria-live="polite">
      <div class="sent-analyzing-hero">
        <div class="sent-spinner-lg" aria-hidden="true"></div>
        <h3 class="sent-analyzing-title">${esc(headline)}</h3>
        <p class="sent-analyzing-stage" id="sent-analyzing-stage">${esc(SENT_STAGES[init.stageIdx])}</p>
        <div class="sent-analyzing-meta">
          <span class="sent-analyzing-elapsed" id="sent-analyzing-elapsed">${Math.round(init.elapsedSec)}s elapsed</span>
          <span class="sent-analyzing-eta">typically 30–90 seconds</span>
        </div>
        <div class="sent-progress-bar" role="progressbar" aria-label="Analyzing progress">
          <div class="sent-progress-fill" id="sent-progress-fill" style="width:${init.pct.toFixed(1)}%"></div>
        </div>
      </div>
      <div class="sent-grid sent-grid-skel" aria-hidden="true">
        ${skeletonCard}${skeletonCard}${skeletonCard}
      </div>
    </div>
  `;

  const stageEl = contentEl.querySelector('#sent-analyzing-stage');
  const elapsedEl = contentEl.querySelector('#sent-analyzing-elapsed');
  const fillEl = contentEl.querySelector('#sent-progress-fill');

  const tick = setInterval(() => {
    // Detached-DOM guard: if the caller forgot to call cleanup, at least
    // self-terminate when our elements are gone from the tree.
    if (!document.body.contains(elapsedEl)) {
      clearInterval(tick);
      return;
    }
    // Elapsed/progress/stage derive from the run's REAL start (startedAtMs),
    // so a re-mounted loader continues the count instead of resetting to 0.
    const { elapsedSec, pct, stageIdx } = sentimentLoaderProgress(startedAtMs, Date.now());
    elapsedEl.textContent = `${Math.round(elapsedSec)}s elapsed`;
    if (fillEl) fillEl.style.width = `${pct.toFixed(1)}%`;
    if (stageEl && stageEl.textContent !== SENT_STAGES[stageIdx]) {
      stageEl.textContent = SENT_STAGES[stageIdx];
    }
  }, 1000);

  return function cleanup({ snapToComplete = false } = {}) {
    clearInterval(tick);
    if (snapToComplete && fillEl && document.body.contains(fillEl)) {
      fillEl.style.width = '100%';
    }
  };
}

// How many distinct sources the Python run will visit, so the "X of N done"
// counter is meaningful from the first poll. `run_query` hits SQLite directly
// in Rust — it does NOT go through the sidecar daemon — so it returns even
// while the LLM call is blocking that daemon's mutex.
async function countSourcesForTopic(topic) {
  try {
    const rows = await api.runQuery(
      `SELECT count(distinct coalesce(p.source_type, 'reddit')) AS n
       FROM topic_posts tp JOIN posts p ON p.id = tp.post_id
       WHERE tp.topic = :topic`,
      topic,
    );
    const n = rows?.[0]?.n;
    return typeof n === 'number' && n > 0 ? n : null;
  } catch {
    return null;
  }
}

// Live polling on top of the "Analyzing…" hero. The Python sentiment loop
// persists each source's row to `graph_nodes` as soon as its LLM call returns
// (sentiment_by_source.py — `persist_sentiment_for_source` inside the loop).
// `fetchSentimentData` bypasses the daemon, so we can poll every 1.5s and
// progressively swap skeleton cards for real ones as they land. Returns a
// `stop()` function — caller MUST invoke it when leaving this state.
function startLiveSentimentPolling(contentEl, topic, totalSources) {
  const grid = contentEl.querySelector('.sent-grid-skel') || contentEl.querySelector('.sent-grid');
  if (!grid) return () => {};
  const heroMeta = contentEl.querySelector('.sent-analyzing-meta');
  let counterEl = contentEl.querySelector('#sent-analyzing-count');
  if (heroMeta && !counterEl) {
    counterEl = document.createElement('span');
    counterEl.id = 'sent-analyzing-count';
    counterEl.className = 'sent-analyzing-count';
    counterEl.textContent = totalSources ? `0 of ${totalSources} sources analyzed` : '0 sources analyzed';
    heroMeta.appendChild(counterEl);
  }
  const seen = new Set();
  let stopped = false;

  const tick = async () => {
    if (stopped || !document.body.contains(grid)) return;
    let sources = [];
    try { sources = await fetchSentimentData(topic); } catch { return; }
    if (stopped || !document.body.contains(grid)) return;
    for (const s of sources) {
      const key = s.source || s.label;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const wrap = document.createElement('div');
      wrap.innerHTML = renderCard(s);
      const card = wrap.firstElementChild;
      if (!card) continue;
      // Replace one skeleton if any remain; otherwise insert at the top so
      // newly-finished real cards stay visible above any leftover skeletons.
      const skel = grid.querySelector('.sent-card-skel');
      if (skel) skel.replaceWith(card);
      else grid.insertBefore(card, grid.firstChild);
    }
    if (counterEl) {
      counterEl.textContent = totalSources
        ? `${seen.size} of ${totalSources} sources analyzed`
        : `${seen.size} source${seen.size === 1 ? '' : 's'} analyzed`;
    }
  };

  // Run immediately so an already-complete row (re-run case) shows up on the
  // first paint without a 1.5s gap, then poll on a cadence the LLM can keep
  // up with.
  tick();
  const timer = setInterval(tick, 1500);

  return function stop() {
    stopped = true;
    clearInterval(timer);
  };
}

async function runAndRender(contentEl, topic, startedAt = Date.now()) {
  const stopAnalyzing = renderAnalyzingState(contentEl, { startedAt });
  // Best-effort source count for the counter. Don't block the LLM kickoff
  // on this — fire both in parallel.
  const totalPromise = countSourcesForTopic(topic);
  let stopPolling = () => {};
  try {
    const runPromise = api.runSentimentBySource(topic);
    const total = await totalPromise;
    stopPolling = startLiveSentimentPolling(contentEl, topic, total);
    const result = await runPromise;
    if (result?.skipped) {
      stopPolling();
      stopAnalyzing();
      contentEl.innerHTML = `<div class="empty-state"><p>Skipped: ${esc(result.reason || 'no LLM provider')}.</p><p>Add a key in Settings.</p></div>`;
      return;
    }
    if (result?.error) {
      stopPolling();
      stopAnalyzing();
      contentEl.innerHTML = `<div class="empty-state"><p>${esc(result.error)}</p></div>`;
      return;
    }
    // Snap progress to 100% for a beat before the real content paints —
    // makes the transition feel like the bar "completed" rather than
    // disappearing mid-fill.
    stopPolling();
    stopAnalyzing({ snapToComplete: true });
    // After persistence, re-load from DB so renders are uniform.
    await loadSentiment(contentEl, topic);
  } catch (e) {
    stopPolling();
    stopAnalyzing();
    contentEl.innerHTML = `<div class="empty-state"><p>Error: ${esc(e?.message || String(e))}</p></div>`;
  }
}

// Per-topic guard so auto-run on first view doesn't re-fire if the user
// flips away from the Sentiment tab and back while the first call is still
// in flight (a second call would queue behind Ollama's inference lock and
// stall the UI the same way the enrich pileup did).
const _sentimentRunning = new Set();  // topic
// Real start timestamp of each in-flight run, keyed by topic. Lets the
// analyzing loader continue from the actual elapsed time when it is
// re-mounted on tab re-entry, instead of resetting to 0 (the reported bug).
const _sentimentRunStart = new Map();  // topic -> ms

export async function loadSentiment(contentEl, topic) {
  // Initial DB read — usually 50-200ms. Show a card-shaped skeleton matching
  // the per-source sentiment grid that lands here, so the brief read reads as
  // "loading these cards" rather than a dead text line. The heavy "Analyzing…"
  // hero is reserved for the actual LLM call below (which takes 30-90s).
  contentEl.innerHTML = skelGrid(4, { lines: 3 });
  const sources = await fetchSentimentData(topic);

  if (!sources.length) {
    // Auto-run on first view: persistence means subsequent opens pull the
    // DB rows directly (fast path above). If an auto-run is already in
    // flight from another tab open, mount the full "Analyzing…" hero so
    // both surfaces show the same alive-feeling loader rather than a
    // dead text line. Tab auto-refresh still happens via the in-flight
    // runAndRender call's own loadSentiment recursion.
    if (_sentimentRunning.has(topic)) {
      const stopAnalyzing = renderAnalyzingState(contentEl, {
        headline: 'Analyzing sentiment per source (in another tab)',
        startedAt: _sentimentRunStart.get(topic),  // continue from the real elapsed
      });
      // Live polling: progressively replace skeleton cards with real ones as
      // the in-flight run lands sources in the DB. Same hero, real progress.
      const total = await countSourcesForTopic(topic);
      const stopPolling = startLiveSentimentPolling(contentEl, topic, total);
      // Termination watcher — when the flag clears (the running tab's
      // runAndRender finishes), re-load to swap to the final layout.
      const watcher = setInterval(async () => {
        if (!document.body.contains(contentEl) || contentEl.dataset.tab !== 'sentiment') {
          clearInterval(watcher);
          stopPolling();
          stopAnalyzing();
          return;
        }
        if (!_sentimentRunning.has(topic)) {
          clearInterval(watcher);
          stopPolling();
          stopAnalyzing({ snapToComplete: true });
          await loadSentiment(contentEl, topic);
        }
      }, 1500);
      return;
    }
    _sentimentRunning.add(topic);
    _sentimentRunStart.set(topic, Date.now());
    try {
      await runAndRender(contentEl, topic, _sentimentRunStart.get(topic));
    } finally {
      _sentimentRunning.delete(topic);
      _sentimentRunStart.delete(topic);
    }
    return;
  }

  contentEl.innerHTML = `
    <div class="sent-tab">
      <div class="sent-toolbar">
        <span class="muted">Aggregated from ${sources.length} source${sources.length === 1 ? '' : 's'} · click Re-run to refresh</span>
        <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-rerun-sent"><i data-lucide="refresh-cw"></i> Re-run</button>
      </div>
      <div class="sent-grid">${sources.map(renderCard).join('')}</div>
    </div>
  `;
  window.refreshIcons?.();

  $('#btn-rerun-sent', contentEl)?.addEventListener('click', () => runAndRender(contentEl, topic));
}
