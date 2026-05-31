// Improve — guided "one button" pipeline runner.
//
// Walks audience → synthesize → deliberate → launch in order, lighting
// up each checkpoint as it completes. Reads from pipeline_status() to
// know which stages already have fresh data (skip) vs need a run.
//
// This is the SINGLE SCREEN that ties Phases 1-4 together for a
// non-power-user. Click "Run pipeline" → real audience clusters get
// built from real Reddit users → findings get tiered by 5 personas →
// launch brief refreshes — without the user navigating between 4 tabs.
//
// Routes:
//   #/improve              → topic picker
//   #/improve/<topic>      → checkpoint dashboard + Run/Force buttons
import { api, esc } from '../api.js';
import { renderAnalyzingState } from '../lib/analyzingLoader.js';

const $ = (sel, root = document) => root.querySelector(sel);

function topicFromHash() {
  const m = (location.hash || '').match(/^#\/improve\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

// Domain stages for the single blocking full-pipeline run (api.pipelineRun
// walks audience → synthesize → deliberate → launch). It blocks until every
// stale stage finishes, so the dashboard would otherwise sit frozen behind a
// static "Running…" line. Mount the alive loader for the duration, then
// repaint the real checkpoint dashboard from pipeline_status().
const PIPELINE_STAGES = [
  'Clustering real authors into ICP personas…',
  'Synthesizing findings from the corpus…',
  'Debating findings across 5 personas…',
  'Collecting cluster endorsements…',
  'Refreshing the launch brief…',
  'Almost done — finalizing checkpoints…',
];

const STAGE_INFO = {
  audience:   { label: 'Audience clusters',  sub: 'Personas from real Reddit users',           icon: 'users',         next: '/audience/' },
  synthesize: { label: 'Insights synthesis', sub: 'LLM extracts findings from corpus',         icon: 'sparkles',      next: '/topic/' },
  deliberate: { label: '5-persona debate',   sub: 'Confirmed/Probable/Minority/Discarded',     icon: 'gavel',         next: '/topic/' },
  launch:     { label: 'Launch brief',       sub: 'Audience + channels + MVP + pricing',       icon: 'rocket',        next: '/launch/' },
};

function checkmark(stage) {
  // Colors in style.css (.imp-stat--ok/warn/bad) — no inline hex.
  if (stage.ready && stage.fresh) return '<span class="imp-mark imp-stat--ok">✓</span>';
  if (stage.ready)                return '<span class="imp-mark imp-stat--warn">~</span>';
  return                                  '<span class="imp-mark imp-stat--bad">✗</span>';
}

function stageRow(stage, topic) {
  const info = STAGE_INFO[stage.name] || { label: stage.name, sub: '', icon: 'circle' };
  const detail = stage.detail || {};
  let detailStr = '';
  if (stage.name === 'audience') {
    detailStr = `${detail.n_clusters || 0} clusters` +
      (detail.generated_at ? ` · ${new Date(detail.generated_at).toLocaleString()}` : '');
  } else if (stage.name === 'synthesize') {
    detailStr = `${detail.n_findings || 0} findings · ${detail.n_confirmed || 0} confirmed` +
      (detail.generated_at ? ` · ${new Date(detail.generated_at).toLocaleString()}` : '');
  } else if (stage.name === 'deliberate') {
    detailStr = `${detail.n_confirmed || 0} confirmed (latest synth)`;
  } else if (stage.name === 'launch') {
    detailStr = detail.generated_at
      ? `Last built ${new Date(detail.generated_at).toLocaleString()}`
      : 'Not yet built';
  }
  const statusLabel = stage.ready
    ? (stage.fresh ? 'fresh' : 'stale (>24h)')
    : 'missing';
  // Tone palette lives in style.css (.imp-tone--ok/warn/bad) — no inline hex.
  const toneClass = stage.ready
    ? (stage.fresh ? 'imp-tone--ok' : 'imp-tone--warn')
    : 'imp-tone--bad';
  const nextHref = (info.next || '').includes(':')
    ? null
    : (info.next + encodeURIComponent(topic));
  return `
    <div class="card" style="margin-bottom:10px">
      <div class="card-head" style="gap:14px">
        <div style="display:flex;gap:12px;align-items:center;flex:1;min-width:0">
          <div class="stat-icon mint" style="width:38px;height:38px;border-radius:10px"><i data-lucide="${info.icon}"></i></div>
          <div style="min-width:0">
            <h3>${esc(info.label)} ${checkmark(stage)}</h3>
            <p>${esc(info.sub)} · <span class="muted" style="font-size:11px">${esc(detailStr)}</span></p>
          </div>
        </div>
        <span class="pill ${toneClass}" style="font-family:'DM Mono',monospace;font-size:11px">${esc(statusLabel)}</span>
        ${nextHref ? `<a class="btn btn-ghost btn-xs btn-bordered" href="#${nextHref}">Open →</a>` : ''}
      </div>
    </div>
  `;
}

function statHeadline(status) {
  const stages = status?.stages || [];
  const fresh = stages.filter(s => s.fresh).length;
  const ready = stages.filter(s => s.ready).length;
  const total = stages.length || 4;
  return `
    <section class="stat-grid">
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon mint"><i data-lucide="check-circle"></i></div></div>
        <div class="stat-num">${fresh}/${total}</div>
        <div class="stat-label">Fresh stages (<24h)</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon sky"><i data-lucide="circle"></i></div></div>
        <div class="stat-num">${ready}/${total}</div>
        <div class="stat-label">Stages with any data</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon lavender"><i data-lucide="users"></i></div></div>
        <div class="stat-num">${(stages.find(s => s.name === 'audience')?.detail || {}).n_clusters || 0}</div>
        <div class="stat-label">Real-user persona clusters</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon peach"><i data-lucide="award"></i></div></div>
        <div class="stat-num">${(stages.find(s => s.name === 'synthesize')?.detail || {}).n_confirmed || 0}</div>
        <div class="stat-label">Confirmed findings</div>
      </div>
    </section>
  `;
}

async function refreshAndPaint(root, topic) {
  // routeGen guard — a slow pipelineStatus() can resolve after the user has
  // navigated away; main.js bumps root.dataset.routeGen on every route, so
  // this is the JS analog of Flutter's `context.mounted` check.
  const myGen = root.dataset.routeGen;
  const alive = () => root.dataset.routeGen === myGen && root.isConnected;
  let status;
  try {
    status = await api.pipelineStatus(topic);
  } catch (e) {
    if (!alive()) return;
    root.innerHTML = `<div class="empty-big"><h3>Couldn't load pipeline status</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  if (!alive()) return;
  paintImprove(root, topic, status);
}

function paintImprove(root, topic, status) {
  const stages = status?.stages || [];
  const allReady = status?.overall_ready;
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/improve">Improve</a> /
        <strong>${esc(topic)}</strong>
      </div>
      <div class="topbar-spacer"></div>
      <a class="btn btn-ghost btn-sm btn-bordered icon-btn" href="#/iterate/${encodeURIComponent(topic)}">
        <i data-lucide="repeat"></i> Tune configs
      </a>
      <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="run-fresh">
        <i data-lucide="refresh-cw"></i> Refresh stale
      </button>
      <button class="btn btn-primary btn-sm icon-btn" id="run-force">
        <i data-lucide="play"></i> ${allReady ? 'Re-run all' : 'Run full pipeline'}
      </button>
    </header>

    <div class="muted" style="font-size:12.5px;margin-bottom:14px">
      Walks <strong>audience → synthesize → deliberate → launch</strong>.
      Stale stages re-run with the per-topic best configs you've applied
      via the Iterate screen. Fresh stages skip.
    </div>

    ${statHeadline(status)}

    <div class="section-head">
      <div><h2>Pipeline checkpoints</h2><p>${stages.length} stages · ${stages.filter(s => s.ready).length} have data</p></div>
    </div>

    ${stages.map(s => stageRow(s, topic)).join('') || '<div class="empty-state">No stages.</div>'}

    <div class="card" style="margin-top:14px">
      <div class="card-head">
        <div>
          <h3>Why personas-from-real-users come first</h3>
          <p>Every other stage gets stronger when grounded on real authors</p>
        </div>
      </div>
      <div class="card-body">
        <p class="muted" style="font-size:12.5px;line-height:1.6;margin:0">
          The <strong>audience clustering</strong> stage groups your topic's
          real Reddit / HN / etc. authors into 3-7 ICP personas, each
          backed by their actual posts. Subsequent stages then use those
          clusters: deliberation lets each cluster cast an "endorse"
          vote on every finding (citation-grounded, not just LLM
          self-talk); the launch brief reads cluster IDs directly into
          its <code>icp_personas</code> slot. If you skip audience, the
          rest still runs but falls back to LLM-imagined personas.
          That's why we run audience FIRST.
        </p>
      </div>
    </div>
  `;
  window.refreshIcons?.();
  $('#run-fresh', root)?.addEventListener('click', () => runPipeline(root, topic, { force: false }));
  $('#run-force', root)?.addEventListener('click', () => runPipeline(root, topic, { force: true }));
}

async function runPipeline(root, topic, { force = false } = {}) {
  // pipelineRun blocks until every stale stage finishes (audience →
  // synthesize → deliberate → launch — minutes, not seconds). Replace the
  // dashboard with the full-bleed alive loader so the wait doesn't look
  // frozen, then repaint the real checkpoints from pipeline_status().
  const myGen = root.dataset.routeGen;
  const alive = () => root.dataset.routeGen === myGen && root.isConnected;
  const stop = renderAnalyzingState(root, {
    headline: `Running full pipeline${force ? ' (force)' : ''}`,
    stages: PIPELINE_STAGES,
    medianRuntimeSec: 40, etaText: 'typically 20–60 seconds', skeletonCount: 4,
  });
  try {
    const res = await api.pipelineRun(topic, { force });
    if (alive() && res?.ok === false) {
      alert(`Pipeline error: ${res.error || 'unknown'}`);
    }
  } catch (e) {
    if (alive()) alert(`Pipeline error: ${e?.message || e}`);
  }
  stop({ snapToComplete: true });
  if (!alive()) return;
  refreshAndPaint(root, topic);
}

async function renderTopicImprove(root, topic) {
  await refreshAndPaint(root, topic);
}

async function renderPicker(root) {
  const myGen = root.dataset.routeGen;
  const alive = () => root.dataset.routeGen === myGen && root.isConnected;
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Improve a topic</strong></div>
      <div class="topbar-spacer"></div>
      <span class="muted" style="font-size:12px">audience → synthesize → deliberate → launch</span>
    </header>
    <div id="imp-pick"><div class="empty-state">loading…</div></div>
  `;
  let topics = [];
  try { topics = await api.listTopics(); } catch (e) {
    if (!alive()) return;
    $('#imp-pick', root).innerHTML = `<div class="empty-big"><h3>Couldn't list topics</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  if (!alive()) return;
  if (!topics?.length) {
    $('#imp-pick', root).innerHTML = `
      <div class="empty-big">
        <h3>No topics yet</h3>
        <p>Collect a topic first — then come back to run the full discovery pipeline in one click.</p>
        <a class="btn btn-primary btn-sm" href="#/topics">Open Topics</a>
      </div>`;
    return;
  }
  const opts = topics.map(t => `<option value="${esc(t.topic)}">${esc(t.topic)} · ${t.posts || 0} posts</option>`).join('');
  $('#imp-pick', root).innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <h3>Pick a topic to improve</h3>
          <p>Walks every discovery stage in order, with audience-first grounding</p>
        </div>
      </div>
      <div class="card-body">
        <p class="muted" style="font-size:13px;line-height:1.6;margin:0 0 14px">
          The pipeline starts by clustering real authors into ICP
          personas (citation-backed), then synthesizes findings, debates
          them across 5 personas + cluster endorsements, and refreshes
          the launch brief — all in one click. Iterate (sidebar) tunes
          per-stage configs and "Apply best" persists improvements so
          future runs use them automatically.
        </p>
        <div class="row">
          <select id="imp-topic" style="flex:1;min-width:240px">${opts}</select>
          <button class="btn btn-primary btn-sm" id="imp-go">Open →</button>
        </div>
      </div>
    </div>
  `;
  $('#imp-go', root)?.addEventListener('click', () => {
    const t = $('#imp-topic', root).value;
    if (t) location.hash = `#/improve/${encodeURIComponent(t)}`;
  });
}

export async function renderImprove(root) {
  const topic = topicFromHash();
  if (topic) return renderTopicImprove(root, topic);
  return renderPicker(root);
}
