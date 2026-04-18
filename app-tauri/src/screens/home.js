import { api, esc, fmtN, timeAgo } from '../api.js';

const COVER_VARIANTS = ['cover-1', 'cover-2', 'cover-3', 'cover-4'];
const COVER_EMOJIS = ['📄', '🎓', '🌱', '💸', '🎯', '🔧', '💡', '🚀'];

function topicTile(t, idx) {
  const cover = COVER_VARIANTS[idx % COVER_VARIANTS.length];
  const emoji = COVER_EMOJIS[idx % COVER_EMOJIS.length];
  const painpoints = t.painpoints || 0;
  const sources = t.sources || 0;
  const slug = encodeURIComponent(t.topic);
  return `
    <div class="topic-tile" data-href="#/topic/${slug}">
      <div class="topic-cover ${cover}">${emoji}</div>
      <h4>${esc(t.topic)}</h4>
      <div class="topic-stats">
        <span><b>${fmtN(t.posts)}</b> posts</span>
        <span><b>${painpoints}</b> pains</span>
        <span><b>${sources}</b> src</span>
      </div>
    </div>
  `;
}

function activityItem(row) {
  const { kind, params_json, started_at, rows, error } = row;
  let params = {};
  try { params = JSON.parse(params_json || '{}'); } catch {}
  let bgColor = 'var(--mint-soft)', fgColor = '#2E7D5B', ic = '↓';
  let title = kind;
  let meta = `${rows || 0} rows · ${timeAgo(started_at)}`;

  if (error) {
    bgColor = 'var(--rose-soft)'; fgColor = '#B84747'; ic = '!';
    meta = `${error.slice(0, 60)} · ${timeAgo(started_at)}`;
  } else if (kind === 'posts') {
    title = `Reddit fetch · r/${params.sub || '?'}`;
    ic = '↓';
  } else if (kind === 'historical') {
    title = `Pullpush archive · r/${params.sub || '?'}`;
    bgColor = 'var(--lavender-soft)'; fgColor = '#6B4FA8'; ic = '✦';
  } else if (kind && kind.startsWith('source:')) {
    title = `${kind.replace('source:', '').toUpperCase()} fetch`;
    bgColor = 'var(--sky-soft)'; fgColor = '#2E5B8C'; ic = '▤';
  } else if (kind === 'search') {
    title = `Search: "${(params.query || '').slice(0, 50)}"`;
    bgColor = 'var(--orange-soft)'; fgColor = '#B85A1E'; ic = '⌕';
  } else if (kind === 'local_file') {
    title = `Ingested ${(params.path || '').split('/').pop() || '?'}`;
    bgColor = 'var(--gold-soft)'; fgColor = '#8A6E1E'; ic = '↑';
  }

  return `
    <div class="activity-item">
      <div class="activity-ic" style="background:${bgColor};color:${fgColor};">${ic}</div>
      <div class="activity-body">
        <div class="activity-title">${esc(title)}</div>
        <div class="activity-meta">${esc(meta)}</div>
      </div>
    </div>
  `;
}

function heroBars(n = 7) {
  // Deterministic pseudo-bars so UI feels alive on first render
  const base = [32, 56, 44, 72, 60, 88, 100];
  return base.slice(0, n).map(h => `<div class="hero-bar" style="height:${h}%"></div>`).join('');
}

export async function renderHome(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Dashboard</strong></div>
      <div class="topbar-spacer"></div>
      <div class="search" id="home-search" role="button" tabindex="0" title="Start a new topic">
        <span>⌕</span>
        <span>Start a topic — type a market or problem…</span>
      </div>
      <div class="icon-btn" id="home-bell" title="Pipeline activity" role="button" tabindex="0">🔔</div>
      <div class="avatar" id="home-avatar" role="button" tabindex="0" title="Settings">SB</div>
    </header>
    <div id="hero-slot"></div>
    <section class="stat-grid" id="stat-grid"></section>
    <section class="two-col">
      <div class="card">
        <div class="card-head">
          <div>
            <h3>Topic momentum</h3>
            <p>Weekly fetch counts · placeholder, real chart in v2</p>
          </div>
          <div class="filter-bar">
            <span class="pill">1M</span>
            <span class="pill active">3M</span>
            <span class="pill">YTD</span>
          </div>
        </div>
        <div class="card-body" style="padding:24px 20px 28px">
          <svg viewBox="0 0 600 160" style="width:100%;height:160px">
            <path d="M0,120 C60,110 120,80 180,70 C240,60 300,30 360,50 C420,70 480,40 540,20 L540,160 L0,160 Z"
                  fill="#FFE9D6" opacity="0.6" />
            <path d="M0,120 C60,110 120,80 180,70 C240,60 300,30 360,50 C420,70 480,40 540,20"
                  fill="none" stroke="#FF8C42" stroke-width="2" />
          </svg>
        </div>
      </div>
      <div class="card">
        <div class="card-head">
          <div>
            <h3>Recent activity</h3>
            <p>Latest ingests &amp; events</p>
          </div>
          <span class="pill">Live</span>
        </div>
        <div class="activity" id="activity-feed">
          <div class="empty-state" style="padding:24px">loading…</div>
        </div>
      </div>
    </section>
    <div class="section-head">
      <div>
        <h2>Your topics</h2>
        <p id="topics-subtitle">Active research projects</p>
      </div>
      <div class="filter-bar">
        <button class="btn btn-primary" id="btn-new-topic" style="padding:8px 14px;font-size:12px">
          + New topic
        </button>
      </div>
    </div>
    <section class="topic-grid" id="topic-grid"></section>
  `;

  // --- wire buttons ---
  root.querySelector('#btn-new-topic')?.addEventListener('click', () => window.gapmapOpenNewTopic?.());
  root.querySelector('#home-search')?.addEventListener('click', () => window.gapmapOpenNewTopic?.());
  root.querySelector('#home-bell')?.addEventListener('click',   () => { location.hash = '#/activity'; });
  root.querySelector('#home-avatar')?.addEventListener('click', () => { location.hash = '#/settings'; });

  // --- fetch + render data ---
  let topics = [];
  let stats = {};
  let activity = [];

  try {
    const results = await Promise.all([
      api.listTopics().catch(() => []),
      api.overviewStats().catch(() => [{}]),
      api.recentActivity().catch(() => []),
    ]);
    topics = Array.isArray(results[0]) ? results[0] : [];
    stats = Array.isArray(results[1]) && results[1][0] ? results[1][0] : {};
    activity = Array.isArray(results[2]) ? results[2] : [];
  } catch (e) {
    // continue with empties
  }

  // ---- Hero ----
  const heroRoot = root.querySelector('#hero-slot');
  const topTopic = topics[0];
  const heroTopic = topTopic?.topic || 'Welcome to Gap Map';
  const heroCopy = topTopic
    ? `Your latest topic has ${topTopic.painpoints || 0} painpoints across ${topTopic.sources || 0} source types from ${fmtN(topTopic.posts)} posts.`
    : 'Start a topic to see multi-source gap maps with citations, competitors, DIY workarounds, and more.';
  heroRoot.innerHTML = `
    <section class="hero">
      <div>
        <div class="hero-eyebrow">${topTopic ? 'Active research' : 'Get started'}</div>
        <h1>${esc(heroTopic)}</h1>
        <p>${esc(heroCopy)}</p>
        <div class="hero-actions">
          <button class="btn btn-primary" id="hero-new">+ New topic</button>
          ${topTopic ? `<button class="btn btn-ghost" onclick="location.hash='#/topic/${encodeURIComponent(topTopic.topic)}'">Open map</button>` : ''}
        </div>
      </div>
      <div class="hero-stat">
        <div class="hero-stat-row">
          <div>
            <h4>Total posts indexed</h4>
            <div class="hero-num">${fmtN(stats.total_posts)}</div>
          </div>
          <div class="hero-stat-up">▲ live</div>
        </div>
        <div class="hero-bars">${heroBars()}</div>
      </div>
    </section>
  `;
  root.querySelector('#hero-new')?.addEventListener('click', () => window.gapmapOpenNewTopic?.());

  // ---- Stat grid ----
  const s = stats || {};
  root.querySelector('#stat-grid').innerHTML = `
    <div class="stat-card">
      <div class="stat-head">
        <div class="stat-icon peach">◉</div>
        <span class="stat-trend trend-up">${s.total_painpoints || 0}</span>
      </div>
      <div class="stat-num">${fmtN(s.total_painpoints || 0)}</div>
      <div class="stat-label">Painpoints surfaced</div>
    </div>
    <div class="stat-card">
      <div class="stat-head">
        <div class="stat-icon lavender">✦</div>
        <span class="stat-trend trend-up">${s.total_sources || 0}</span>
      </div>
      <div class="stat-num">${fmtN(s.total_sources || 0)}</div>
      <div class="stat-label">Sources indexed</div>
    </div>
    <div class="stat-card">
      <div class="stat-head">
        <div class="stat-icon mint">◢</div>
        <span class="stat-trend trend-up">${s.total_workarounds || 0}</span>
      </div>
      <div class="stat-num">${fmtN(s.total_workarounds || 0)}</div>
      <div class="stat-label">DIY workarounds (gap signal)</div>
    </div>
    <div class="stat-card">
      <div class="stat-head">
        <div class="stat-icon sky">▭</div>
        <span class="stat-trend trend-flat">${s.total_topics || 0}</span>
      </div>
      <div class="stat-num">${fmtN(s.total_posts || 0)}</div>
      <div class="stat-label">Posts indexed</div>
    </div>
  `;

  // ---- Activity feed ----
  const feed = root.querySelector('#activity-feed');
  if (!activity.length) {
    feed.innerHTML = `<div class="empty-state">no activity yet — start a topic to see fetches land here</div>`;
  } else {
    feed.innerHTML = activity.slice(0, 8).map(activityItem).join('');
  }

  // ---- Topic tiles ----
  const grid = root.querySelector('#topic-grid');
  root.querySelector('#topics-subtitle').textContent = `${topics.length} active ${topics.length === 1 ? 'project' : 'projects'}`;
  if (!topics.length) {
    grid.outerHTML = `
      <div class="empty-big">
        <h3>No topics yet</h3>
        <p>Give Gap Map a topic — "meditation apps", "freelance invoicing", "ATS resume tools" — and it'll pull multi-source data and render a gap map.</p>
        <button class="btn btn-primary" onclick="window.gapmapOpenNewTopic()">+ Start your first topic</button>
      </div>
    `;
  } else {
    grid.innerHTML = topics.slice(0, 8).map((t, i) => topicTile(t, i)).join('');
    grid.querySelectorAll('.topic-tile').forEach(el => {
      el.addEventListener('click', () => { location.hash = el.dataset.href; });
    });
  }
}
