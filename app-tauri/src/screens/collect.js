// Collect — streams sidecar output with colorized log lines, stage tracker,
// elapsed timer, error counter, copy/clear actions, and a post-run CTA row.
//
// Phase-A / Phase-B progress card (spec §2 + §6.1):
//
//   • Phase-A (posts < threshold=100): big "Gathering evidence" heading,
//     progress bar N/100, per-source chips, "Insights begin at 100 posts.
//     ETA ~X min." copy with rough estimate from live posts/sec rate.
//
//   • Phase-B (posts ≥ 100, can flip mid-collect): heading becomes
//     "Extracting insights…", shows live findings counter from
//     graph_nodes, plus "Keep collecting — new posts auto-improve the
//     graph." The card border animates to orange on the flip.
//
// Below the hero card we keep the full log + stage strip intact for power
// users. Cancel still works. Cleanup on hashchange.

import { api, $, esc } from '../api.js';
import {
  COLLECT_STAGES as STAGES,
  classifyCollectLine as classifyLine,
  detectCollectStage as detectStage,
  fmtCollectElapsed as fmtElapsed,
} from '../lib/collectFormat.js';
// Parallel topic-recon preview — fires canonicalize + discover_subs + the
// external-source catalog the moment the screen mounts so the user sees
// "we're going to fetch from r/X, r/Y, r/Z + 15 sources" before any data
// arrives. Each source chip flips to "fetched: N" when the sidecar
// emits its `[src] ✓ N posts` line.
import { mountReconCard } from '../components/CollectReconCard.js';
// Shared busy modal — also used by the /collects manager screen, so a
// "topic already running" prompt looks the same everywhere a collect
// can be initiated.
import { showCollectBusyModal } from '../components/CollectBusyModal.js';

// Threshold at which Phase A → B flip happens. Spec §2.1 / §2.3 locks this
// at 100 posts (user-adjustable later via Settings — Task 9.5).
const PHASE_B_THRESHOLD = 100;

// Module-scope persistence. When the user navigates away from #/collect/<topic>
// and comes back mid-collect, renderCollect remounts fresh — but the Python
// sidecar is still streaming `collect:progress` events. Without these maps
// we'd lose every log line emitted between unmount and remount. Each entry
// keyed by topic; cleared on collect:done so a fresh collect for the same
// topic starts clean. Capped at 5000 lines per topic to bound memory if a
// pathologically long collect spews logs.
const _collectLogs   = new Map();   // topic → [{text, cls}, …]  up to 5000
const _collectStatus = new Map();   // topic → 'running' | 'done' | 'failed' | 'queued' | 'idle'
const _collectStart  = new Map();   // topic → ms timestamp of first line
const MAX_PERSISTED_LINES = 5000;

// Re-exported snapshot for the central CollectsManager screen so it can
// show the last few log lines + status of every topic that's been
// collected this session, without having to re-spawn the sidecar.
export function getCollectSnapshot() {
  const out = [];
  const seen = new Set();
  for (const t of _collectLogs.keys()) seen.add(t);
  for (const t of _collectStatus.keys()) seen.add(t);
  for (const t of _collectStart.keys()) seen.add(t);
  for (const topic of seen) {
    const lines = _collectLogs.get(topic) || [];
    const tail = lines.slice(-5);
    out.push({
      topic,
      status: _collectStatus.get(topic) || 'idle',
      started_ms: _collectStart.get(topic) || null,
      line_count: lines.length,
      tail,
    });
  }
  // Newest first by start time, falling back to topic name.
  out.sort((a, b) => (b.started_ms || 0) - (a.started_ms || 0));
  return out;
}

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

  // routeGen gate — hoisted to the top so any early-path handler (e.g. the
  // catch in startCollect → showRetryAction) can call stillHere() without
  // hitting a TDZ. The router sets root.dataset.routeGen before dispatching,
  // so it's already populated here.
  const myRouteGen = root.dataset.routeGen;
  const stillHere  = () => root.dataset.routeGen === myRouteGen && root.isConnected;

  // Source-picker output (read once, hoisted). Previously these `const`s
  // sat ~500 lines below, but `mountReconCard(...)` at the top of the
  // function references `aggressive`, which raised a TDZ
  // ("Cannot access 'aggressive' before initialization") on the Collections
  // / Active page. Reading localStorage early is harmless — the topic-page
  // Rerun modal writes them BEFORE navigating, and the new-topic flow leaves
  // them unset (defaults apply).
  const aggressive = localStorage.getItem('gapmap.collect.last_aggressive') !== 'false';
  const sourcesStr = localStorage.getItem('gapmap.collect.last_sources') || '';
  const skipReddit = localStorage.getItem('gapmap.collect.last_skip_reddit') === 'true';
  // One-shot — clear so a manual reload doesn't carry the previous filter.
  localStorage.removeItem('gapmap.collect.last_aggressive');
  localStorage.removeItem('gapmap.collect.last_sources');
  localStorage.removeItem('gapmap.collect.last_skip_reddit');

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/" style="color:var(--ink-3);text-decoration:none">Workspace</a> / <strong>Collecting</strong> / ${esc(topic)}
      </div>
      <div class="topbar-spacer"></div>
      <span class="pill active" id="collect-status-pill">● running</span>
    </header>

    <!-- Recon card — runs canonicalize + discover_subs + source-catalog
         in parallel so the user sees the full sweep target list within
         ~1s of arrival, before any actual fetch numbers come back. Chips
         flip from "queued" → fetched count as collect:progress lines
         arrive from the sidecar. -->
    <div id="recon-host"></div>

    <!-- Phase-A / Phase-B hero card. Sits above the log for glanceability.
         Starts in phase-a (below threshold) and flips to phase-b when the
         post count crosses PHASE_B_THRESHOLD — border animates orange and
         the heading + body copy change via CSS classes. Kept in the same
         .progress-card container so the whole block shares a background.
         Collapsed by default: the head row (title + stat chips) stays
         visible; bar + copy + freshness expand on click. -->
    <div class="progress-card phase-card phase-a" id="phase-card">
      <button type="button" class="phase-head" id="phase-head" aria-expanded="false" data-phase-toggle>
        <h2 class="phase-title" id="phase-title">Gathering evidence for "${esc(topic)}"</h2>
        <div class="progress-stats phase-stats">
          <span class="pchip"><b id="pchip-phase-elapsed">0s</b><span>elapsed</span></span>
          <span class="pchip"><b id="pchip-posts">0</b><span>posts</span></span>
          <span class="pchip" id="pchip-findings-wrap" hidden><b id="pchip-findings">0</b><span>findings</span></span>
        </div>
        <span class="phase-caret" aria-hidden="true">▸</span>
      </button>

      <div class="phase-body" id="phase-body" hidden>
        <!-- Threshold progress bar. Clamped to PHASE_B_THRESHOLD for display;
             once over we swap to a "Phase B" tint but keep the bar full. -->
        <div class="phase-bar-wrap">
          <div class="phase-bar" id="phase-bar">
            <div class="phase-bar-fill" id="phase-bar-fill" style="width:0%"></div>
            <div class="phase-bar-tick" style="left:100%"></div>
          </div>
          <div class="phase-bar-label"><span id="phase-bar-count">0</span> / ${PHASE_B_THRESHOLD}</div>
        </div>

        <!-- Flip-copy. Phase A = ETA + threshold hint. Phase B = findings +
             keep-collecting nudge. Findings counter is live-driven by
             enrich:tick + gapmap:changed + initial runQuery. -->
        <div class="phase-copy" id="phase-copy">
          <p class="phase-copy-line" id="phase-copy-primary">Insights begin at ${PHASE_B_THRESHOLD} posts. ETA —</p>
          <p class="phase-copy-line phase-copy-muted" id="phase-copy-secondary" hidden>Keep collecting — new posts auto-improve the graph.</p>
        </div>

        <!-- Freshness badge — updated each time enrich:tick fires. -->
        <p class="phase-freshness" id="phase-freshness" hidden>Last finding: just now</p>
      </div>
    </div>

    <div class="progress-card">
      <div class="progress-head">
        <div>
          <h2>Collecting: ${esc(topic)}</h2>
          <p style="color:var(--ink-3);font-size:var(--fs-13);margin-top:4px" id="progress-sub">Preparing…</p>
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

      <!-- Searching-for strip. Surfaces the LLM-expanded keyword fan-out
           that every source is actually querying. Users who type
           "public speaking anxiety app" can see at a glance that the
           pipeline is also hitting "confident speaking", "speaking
           tricks", and so on — not just the literal string. Hidden
           until canonicalizeTopic resolves. -->
      <div class="search-keywords-strip" id="search-keywords-strip" hidden>
        <div class="skw-head">
          <b>Searching for</b>
          <span class="skw-sub" id="skw-sub"></span>
        </div>
        <div class="skw-chips" id="skw-chips"></div>
        <div class="skw-hint" id="skw-hint" hidden></div>
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
          <div style="font-size:var(--fs-11);color:var(--ink-3);text-transform:uppercase;letter-spacing:0.05em;font-weight:700;margin-bottom:2px">Now</div>
          <div id="now-text" style="font-size:var(--fs-13);color:var(--ink-1);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Starting up…</div>
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

  // Phase-card state. Post count is authoritative from runQuery polling;
  // we seed it from the incoming log lines so the bar climbs visibly in
  // the first few seconds before the first poll returns.
  let postCount = 0;
  let findingsCount = 0;
  let phaseB = false;                 // flipped once postCount ≥ threshold
  let lastFindingTs = 0;              // ms; powers the freshness badge

  const log = $('#progress-log');
  const statusPill = $('#collect-status-pill');
  const sub = $('#progress-sub');
  const openBtn = $('#btn-open');
  const autoscroll = $('#log-autoscroll');
  const elapsedEl = $('#pchip-elapsed');
  const linesEl = $('#pchip-lines');
  const errsEl = $('#pchip-errs');
  const errsWrap = $('#pchip-errs-wrap');

  // Mount the parallel recon card. Fires canonicalize + discover + the
  // source catalog immediately so the user sees the full sweep target
  // list within ~1s, before any actual fetch numbers arrive. Returns an
  // unmount we keep for the route-cleanup path below.
  let unmountRecon = () => {};
  const reconHost = $('#recon-host');
  if (reconHost) {
    mountReconCard(reconHost, { topic, aggressive }).then((u) => {
      unmountRecon = u || (() => {});
    }).catch((e) => console.warn('[collect] recon mount failed:', e));
  }

  // Phase-card handles.
  const phaseCard    = $('#phase-card');
  const phaseHead    = $('#phase-head');
  const phaseBody    = $('#phase-body');
  // Click the head row to expand/collapse the bar + copy + freshness.
  // Persists per-topic so a user who left it open stays open on revisit.
  const phaseExpandKey = `gapmap.collect.phase_open.${topic}`;
  if (localStorage.getItem(phaseExpandKey) === '1') {
    phaseBody.hidden = false;
    phaseCard.classList.add('is-open');
    phaseHead.setAttribute('aria-expanded', 'true');
    const c = phaseHead.querySelector('.phase-caret'); if (c) c.textContent = '▾';
  }
  phaseHead?.addEventListener('click', () => {
    const open = phaseBody.hidden;
    phaseBody.hidden = !open;
    phaseCard.classList.toggle('is-open', open);
    phaseHead.setAttribute('aria-expanded', String(open));
    const c = phaseHead.querySelector('.phase-caret'); if (c) c.textContent = open ? '▾' : '▸';
    try { localStorage.setItem(phaseExpandKey, open ? '1' : '0'); } catch {}
  });
  const phaseTitle   = $('#phase-title');
  const phaseElapsed = $('#pchip-phase-elapsed');
  const phasePosts   = $('#pchip-posts');
  const phaseBarFill = $('#phase-bar-fill');
  const phaseBarCount= $('#phase-bar-count');
  const phaseCopyP   = $('#phase-copy-primary');
  const phaseCopyS   = $('#phase-copy-secondary');
  const phaseFindingsWrap = $('#pchip-findings-wrap');
  const phaseFindings     = $('#pchip-findings');
  const phaseFreshness    = $('#phase-freshness');

  function fmtEtaMinutes(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return '—';
    if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
    const m = seconds / 60;
    if (m < 1.5) return '~1 min';
    if (m < 10)  return `~${Math.round(m)} min`;
    return `~${Math.round(m)} min`;
  }

  function repaintPhaseCard() {
    // Clamp the bar at threshold for Phase A; once in B the bar stays
    // visually full (100%) — the findings chip is the new signal of life.
    const pct = Math.min(100, (postCount / PHASE_B_THRESHOLD) * 100);
    phaseBarFill.style.width = `${pct}%`;
    phaseBarCount.textContent = String(postCount);
    phasePosts.textContent = String(postCount);

    // Flip. Only fires once per screen mount — we gate on `phaseB` so we
    // don't re-animate every repaint. Flip is mid-render: no reload,
    // DOM nodes persist, we just toggle a class + swap copy.
    const nowInB = postCount >= PHASE_B_THRESHOLD;
    if (nowInB && !phaseB) {
      phaseB = true;
      phaseCard.classList.remove('phase-a');
      phaseCard.classList.add('phase-b', 'phase-flipping');
      phaseTitle.textContent = 'Extracting insights…';
      phaseFindingsWrap.hidden = false;
      phaseCopyS.hidden = false;
      phaseFreshness.hidden = false;
      // Drop the transient animation class once the border-color
      // transition finishes (400ms in CSS). Guarded by a timeout so
      // repaints during the transition don't re-trigger.
      setTimeout(() => { phaseCard.classList.remove('phase-flipping'); }, 900);
    }

    // Phase-A copy: keep the ETA fresh. Use the overall posts/sec rate
    // since the screen mounted as a rough estimate. Avoids dividing by
    // zero in the first second.
    if (!phaseB) {
      const elapsedSec = Math.max(1, (Date.now() - startTs) / 1000);
      const rate = postCount / elapsedSec;        // posts/sec
      if (rate > 0) {
        const remaining = Math.max(0, PHASE_B_THRESHOLD - postCount);
        const etaSec = remaining / rate;
        phaseCopyP.textContent =
          `Insights begin at ${PHASE_B_THRESHOLD} posts. ETA ${fmtEtaMinutes(etaSec)}.`;
      } else {
        phaseCopyP.textContent =
          `Insights begin at ${PHASE_B_THRESHOLD} posts. ETA —`;
      }
    } else {
      // Phase-B copy. Uses the live findings counter.
      phaseCopyP.textContent = `${findingsCount} findings so far.`;
    }
  }

  function setFindings(n) {
    if (typeof n !== 'number' || !isFinite(n)) return;
    const changed = n !== findingsCount;
    findingsCount = n;
    phaseFindings.textContent = String(n);
    if (changed) {
      // Brief fade-in so the new count is noticed without being noisy.
      phaseFindings.classList.remove('phase-findings-pop');
      // Force reflow so the animation restarts when the number changes
      // back-to-back (e.g. two enrich:tick events within 300ms).
      void phaseFindings.offsetWidth;
      phaseFindings.classList.add('phase-findings-pop');
      lastFindingTs = Date.now();
      updateFreshnessBadge();
    }
    repaintPhaseCard();
  }

  function updateFreshnessBadge() {
    if (!phaseFreshness || phaseFreshness.hidden) return;
    if (!lastFindingTs) {
      phaseFreshness.textContent = 'Last finding: —';
      return;
    }
    const secs = Math.max(0, Math.floor((Date.now() - lastFindingTs) / 1000));
    const t = secs < 5  ? 'just now'
            : secs < 60 ? `${secs}s ago`
            : secs < 3600 ? `${Math.floor(secs/60)}m ago`
            : `${Math.floor(secs/3600)}h ago`;
    phaseFreshness.textContent = `Last finding: ${t}`;
  }

  const markStage = (key) => {
    if (!key) return;
    const el = root.querySelector(`.stage-step[data-stage="${key}"]`);
    if (!el) return;
    root.querySelectorAll('.stage-step.active').forEach(x => { x.classList.remove('active'); x.classList.add('done'); });
    el.classList.add('active');
  };

  // Render the "Searching for…" strip from a canonicalize() response.
  // Shape: { original, canonical, variants, confidence,
  //          search_keywords: [{ keyword, relevance }, …] }
  // Keywords are filtered to the same relevance floor that collect.py uses
  // (high in non-aggressive runs, medium-or-better in aggressive) so the
  // chip list mirrors what the sources actually queried.
  function renderSearchKeywordsStrip(canon, { aggressive } = {}) {
    const wrap = $('#search-keywords-strip');
    const chipsEl = $('#skw-chips');
    const subEl = $('#skw-sub');
    const hintEl = $('#skw-hint');
    if (!wrap || !chipsEl) return;
    const rank = { high: 3, medium: 2, low: 1 };
    const floor = aggressive ? 2 : 3;
    const canonical = String(canon?.canonical || topic).trim();
    const originalRaw = String(canon?.original || topic).trim();
    const kwList = Array.isArray(canon?.search_keywords) ? canon.search_keywords : [];
    const filtered = kwList
      .map(k => ({
        keyword: String(k?.keyword || '').trim(),
        relevance: String(k?.relevance || 'low').toLowerCase(),
      }))
      .filter(k => k.keyword && (rank[k.relevance] || 0) >= floor);
    // Always include the canonical as the lead chip even if the LLM didn't
    // echo it into search_keywords (defensive).
    const seen = new Set();
    const chips = [];
    if (canonical) { seen.add(canonical.toLowerCase()); chips.push({ keyword: canonical, relevance: 'high' }); }
    for (const k of filtered) {
      const lo = k.keyword.toLowerCase();
      if (seen.has(lo)) continue;
      seen.add(lo);
      chips.push(k);
    }
    if (!chips.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    chipsEl.innerHTML = chips.map(c => {
      const isCanon = c.keyword.toLowerCase() === canonical.toLowerCase();
      const cls = isCanon ? 'skw-chip skw-chip-canon' : `skw-chip skw-chip-${c.relevance}`;
      const tip = isCanon ? 'Canonical topic' : `Expanded keyword · relevance: ${c.relevance}`;
      return `<span class="${cls}" title="${esc(tip)}">${esc(c.keyword)}</span>`;
    }).join('');
    const tail = chips.length === 1 ? '' : ` + ${chips.length - 1} expanded synonym${chips.length === 2 ? '' : 's'}`;
    subEl.textContent = `"${canonical}"${tail}`;
    // Surface corrections and low-confidence matches inline so users know
    // the canonical didn't exactly match what they typed.
    const bits = [];
    if (originalRaw && originalRaw.toLowerCase() !== canonical.toLowerCase()) {
      bits.push(`Corrected "${originalRaw}" → "${canonical}".`);
    }
    if ((canon?.confidence || '').toLowerCase() === 'low' && Array.isArray(canon?.variants) && canon.variants.length) {
      bits.push(`Low-confidence match. Alternatives: ${canon.variants.slice(0, 3).join(', ')}.`);
    }
    if (bits.length) {
      hintEl.hidden = false;
      hintEl.textContent = bits.join(' ');
    } else {
      hintEl.hidden = true;
      hintEl.textContent = '';
    }
  }

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
    rss_products: 'RSS — Products', rss_tech_news: 'RSS — Tech News',
    oc_bluesky: 'Bluesky (authors)',
    oc_substack: 'Substack',
    oc_producthunt_today: 'Product Hunt — today',
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

    // Seed the phase-card post count eagerly from per-source totals. This
    // is optimistic (server-side dedupe may reduce it) — the 2s DB poll
    // corrects it shortly after. Without this, the bar would sit at 0
    // until the first poll returns, feeling dead in the first few seconds.
    if (next.status === 'done' && typeof next.count === 'number' && next.count > 0) {
      const sumFromSources = [...sourceState.values()]
        .filter(s => s.status === 'done' && typeof s.count === 'number')
        .reduce((acc, s) => acc + s.count, 0);
      if (sumFromSources > postCount) {
        postCount = sumFromSources;
        repaintPhaseCard();
      }
    }
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
    'hn', 'appstore', 'playstore', 'trustpilot', 'producthunt',
    'rss_products', 'rss_tech_news',
    'arxiv', 'openalex', 'pubmed',
    'gnews', 'devto', 'stackoverflow', 'github', 'trends',
    'youtube',
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

  // Elapsed timer — updates both the detailed-card elapsed chip and the
  // phase-card elapsed chip. We also recompute the ETA every second so it
  // moves smoothly as the rate stabilises during Phase A.
  const tick = setInterval(() => {
    const s = fmtElapsed(Date.now() - startTs);
    if (!collectDone) elapsedEl.textContent = s;
    if (phaseElapsed) phaseElapsed.textContent = s;
    if (!phaseB) repaintPhaseCard();
    updateFreshnessBadge();
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
      // Keep Insights in sync with fresh multi-source data: regenerate in the
      // background after collect/enrich completes so conclusions are not stale.
      appendLine('→ refreshing insights from the latest cross-source corpus…', 'info');
      api.monitorRunTopic(topic, true)
        .then((res) => {
          if (res?.ok) {
            appendLine('✓ insights refreshed (painpoints, product value, and user-value synthesis updated)', 'done');
          } else {
            appendLine(`⚠ insights refresh skipped/failed: ${res?.error || 'unknown'}`, 'warn');
          }
        })
        .catch((err) => {
          appendLine(`⚠ insights refresh errored: ${err?.message || err}`, 'warn');
        });
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
    if (!stillHere()) return;
    const actions = root.querySelector('#collect-actions');
    if (!actions) return;
    if (actions.querySelector('#btn-retry')) return;
    const retry = document.createElement('button');
    retry.className = 'btn btn-primary icon-btn';
    retry.id = 'btn-retry';
    retry.innerHTML = '<i data-lucide="rotate-cw"></i> Retry';
    retry.onclick = () => { location.reload(); };
    const open = root.querySelector('#btn-open');
    actions.insertBefore(retry, open || null);
    const home = document.createElement('button');
    home.className = 'btn btn-ghost';
    home.style.border = '1px solid var(--line)';
    home.textContent = 'Back to dashboard';
    home.onclick = () => { location.hash = '#/'; };
    actions.appendChild(home);
    window.refreshIcons?.();
  }

  // --- start collect ---
  // (Source-picker `aggressive` / `sourcesStr` / `skipReddit` were read at
  //  the top of this function so the recon-card mount above could see them.)

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

  // Paint the "Searching for…" strip as soon as possible. Canonicalize is
  // ~free when cached (one DB read) and ~400 tokens when cold. Runs in
  // parallel with startCollect so it never blocks the collect itself.
  // Failure silently hides the strip — worst case: user doesn't see the
  // expansion, everything else still works.
  (async () => {
    try {
      const canon = await api.canonicalizeTopic(topic);
      if (!stillHere()) return;
      renderSearchKeywordsStrip(canon, { aggressive });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[collect] canonicalize failed:', e);
    }
  })();

  // Helper that handles the structured "blocked" response from the backend.
  // Replaces the old opaque "✗ failed to start: another collect is already
  // running" error path: now we render a modal letting the user pick:
  //   1) Cancel running and start this one
  //   2) Queue this one (auto-spawns when the running collect finishes)
  //   3) Open the running collect's log
  async function handleBlocked(blockedBy) {
    let otherTopic = blockedBy?.topic || '(unknown)';
    let elapsedSecs = Number(blockedBy?.elapsed_secs) || 0;
    // The Rust orphan path returns "(unknown)" + 0; the old bug also let
    // huge numbers through ("29625725 min"). Recover from JS state if the
    // value looks broken or unknown.
    const looksUnknown = /\(unknown/i.test(otherTopic) || elapsedSecs > 60 * 60 * 24 * 30;
    if (looksUnknown) {
      const snap = (_collectStatus.entries
        ? Array.from(_collectStatus.entries()) : []).find(([t, st]) => st === 'running' && t !== topic);
      if (snap) {
        otherTopic = snap[0];
        const ms = _collectStart.get(otherTopic);
        elapsedSecs = ms ? Math.floor((Date.now() - ms) / 1000) : 0;
      } else {
        otherTopic = '(orphan sidecar — name unavailable)';
        elapsedSecs = 0;
      }
    }
    const elapsedMins = Math.floor(elapsedSecs / 60);
    const elapsedStr = elapsedSecs <= 0 ? 'unknown'
      : elapsedMins > 0 ? `${elapsedMins} min` : `${elapsedSecs}s`;
    appendLine(
      `⏸ collect for "${topic}" is waiting — "${otherTopic}" is currently running (${elapsedStr}).`,
      'info',
    );
    const choice = await showCollectBusyModal({
      newTopic: topic,
      runningTopic: otherTopic,
      elapsedStr,
    });
    if (choice === 'cancel-and-start') {
      appendLine(`✗ cancelling "${otherTopic}", starting "${topic}"…`, 'info');
      try {
        const r = await api.startCollect(topic, aggressive, sourcesArg, skipReddit, 'cancel_and_start');
        if (r?.ok) {
          appendLine(`→ started collect for "${topic}" (${filterSummary})…`, 'info');
          _collectStatus.set(topic, 'running');
          _collectStart.set(topic, Date.now());
        }
      } catch (e) {
        appendLine(`✗ cancel-and-start failed: ${e?.message || e}`, 'err');
        showRetryAction();
      }
    } else if (choice === 'queue') {
      try {
        const r = await api.startCollect(topic, aggressive, sourcesArg, skipReddit, 'queue');
        const pos = r?.position || '?';
        appendLine(
          r?.already_queued
            ? `↻ "${topic}" is already in the queue.`
            : `⏳ queued "${topic}" — position ${pos} in line.`,
          'info',
        );
        setFinal('queued', 'var(--accent-soft, #2E75B6)', 'white');
        _collectStatus.set(topic, 'queued');
        clearInterval(tick);
      } catch (e) {
        appendLine(`✗ queue failed: ${e?.message || e}`, 'err');
        showRetryAction();
      }
    } else if (choice === 'open-running') {
      window.location.hash = `#/collect/${encodeURIComponent(otherTopic)}`;
    } else {
      // 'dismiss' — leave the screen in a soft "waiting for user" state.
      setFinal('idle', 'var(--ink-3, #8a8a8a)', 'white');
      _collectStatus.set(topic, 'idle');
      clearInterval(tick);
    }
  }

  try {
    const result = await api.startCollect(topic, aggressive, sourcesArg, skipReddit);
    if (result && result.blocked) {
      // Structured-blocked response — branch through the modal.
      await handleBlocked(result.blocked_by);
    } else if (result && result.already_running) {
      // Another tab / earlier session of this very topic is already streaming.
      // Don't log "→ started…" — the log above already has the history and
      // new events will land via the collect:progress subscription set up
      // earlier in renderCollect.
      if (!isRevisit) {
        appendLine(`↻ attached to in-flight collect for "${topic}"…`, 'info');
      }
      _collectStatus.set(topic, 'running');
      _collectStart.set(topic, Date.now());
    } else {
      appendLine(`→ started collect for "${topic}" (${filterSummary})…`, 'info');
      _collectStatus.set(topic, 'running');
      _collectStart.set(topic, Date.now());
    }
  } catch (e) {
    appendLine(`✗ failed to start: ${e?.message || e}`, 'err');
    setFinal('failed', 'var(--chronic, #B84747)', 'white');
    collectDone = true;
    clearInterval(tick);
    _collectStatus.set(topic, 'failed');
    showRetryAction();
  }

  // --- phase-card data plumbing ---
  //
  // 1) Poll `topic_posts` + `graph_nodes` every 2s for authoritative counts.
  //    The collect log gives an optimistic post count (summed from `[src] ✓
  //    N posts` markers) but dedupe happens server-side, so the DB number
  //    is what we trust for the threshold flip.
  //
  // 2) Listen for `enrich:tick` — Python emits
  //    {batch_size, processed, queued, duration_ms, topics:[...]}.
  //    We don't trust its findings number; instead we re-query the DB
  //    (it's < 1ms) so we always match what the topic page will show.
  //
  // 3) Listen for `gapmap:changed` (our own in-app broadcast) — the same
  //    re-query path. Collect-done and topic views fire this.
  //
  // routeGen gate: each async callback bails if the user has navigated
  // away. That way late-arriving events don't mutate DOM belonging to the
  // next screen. (myRouteGen / stillHere are declared at the top of
  // renderCollect so early-path handlers can use them too.)

  async function refetchPhaseCounts() {
    if (!stillHere()) return;
    try {
      const rows = await api.runQuery(
        `SELECT
           (SELECT count(*) FROM topic_posts WHERE topic=:topic) AS posts,
           (SELECT count(*) FROM graph_nodes WHERE topic=:topic
              AND kind IN ('painpoint','feature_wish','workaround','product')) AS findings`,
        topic,
      );
      if (!stillHere()) return;
      const r = (Array.isArray(rows) && rows[0]) || {};
      const nPosts = Number(r.posts) || 0;
      const nFind  = Number(r.findings) || 0;
      if (nPosts > postCount) postCount = nPosts;
      repaintPhaseCard();
      if (nFind !== findingsCount) setFindings(nFind);
    } catch {
      // graph_nodes / topic_posts may not exist until first write — that's
      // fine, bar will seed from log lines until the DB query succeeds.
    }
  }

  // Prime counts as soon as possible (revisit case may already have posts).
  refetchPhaseCounts();
  const pollTimer = setInterval(refetchPhaseCounts, 2000);

  // Subscribe to enrich:tick via a dynamic import. Dynamic so this module
  // works in node tests without pulling in the Tauri SDK. Cleanup guard
  // (`detached`) prevents stale listeners from mutating DOM after unmount.
  let unlistenEnrich = null;
  let detached = false;
  (async () => {
    try {
      const mod = await import('@tauri-apps/api/event');
      if (detached) return;
      unlistenEnrich = await mod.listen('enrich:tick', (e) => {
        if (!stillHere()) return;
        // Only refetch if the tick is for a topic we care about. Worker
        // emits topics:[...]. If the payload isn't scoped we still
        // refetch — it's a 1ms query.
        const topics = e?.payload?.topics;
        if (topics && Array.isArray(topics) && !topics.includes(topic)) {
          // Not our topic — refresh freshness timestamp anyway so the
          // badge reflects worker activity, but skip the DB roundtrip.
          lastFindingTs = Date.now();
          updateFreshnessBadge();
          return;
        }
        refetchPhaseCounts();
      });
    } catch {
      // Non-Tauri runtime (tests, preview) — no-op.
    }
  })();

  // `mutated('findings'|'collect'|'graph', …)` fires via the api layer on
  // every relevant write. Cheap re-query on each — the 10s runQuery cache
  // is busted by the invalidate inside mutated().
  const onGapmapChanged = (ev) => {
    if (!stillHere()) return;
    const k = ev?.detail?.kind;
    if (k === 'findings' || k === 'collect' || k === 'graph') {
      refetchPhaseCounts();
    }
  };
  window.addEventListener('gapmap:changed', onGapmapChanged);

  // --- cleanup ---
  const cleanup = () => {
    detached = true;
    clearInterval(tick);
    clearInterval(pollTimer);
    try { unlistenProgress?.(); } catch {}
    try { unlistenDone?.();     } catch {}
    try { unlistenEnrich?.();   } catch {}
    try { unmountRecon?.();     } catch {}
    window.removeEventListener('gapmap:changed', onGapmapChanged);
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup);
}
