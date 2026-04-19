// Dashboard v2 — real momentum chart, real hero bars, skeleton loaders,
// active-collect banner, BYOK prompt, fixed empty-state reflow.

import { api, esc, fmtN, timeAgo } from '../api.js';
import { avatarInitials } from './settings.js';

function headerAvatar() {
  const name = localStorage.getItem('gapmap.profile.name') || '';
  return esc(avatarInitials(name));
}

const COVER_VARIANTS = ['cover-1', 'cover-2', 'cover-3', 'cover-4'];
const COVER_ICONS = [
  'file-text', 'graduation-cap', 'sprout', 'receipt',
  'target', 'wrench', 'lightbulb', 'rocket',
];

let momentumRange = 90; // days: 30 | 90 | 365

function topicTile(t, idx) {
  const cover = COVER_VARIANTS[idx % COVER_VARIANTS.length];
  const icon = COVER_ICONS[idx % COVER_ICONS.length];
  const painpoints = t.painpoints || 0;
  const sources = t.sources || 0;
  const slug = encodeURIComponent(t.topic);
  return `
    <div class="topic-tile" data-href="#/topic/${slug}">
      <div class="topic-cover ${cover}"><i data-lucide="${icon}"></i></div>
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
  const { kind, params_json, started_at, ended_at, rows, error } = row;
  let params = {};
  try { params = JSON.parse(params_json || '{}'); } catch {}
  let bgColor = 'var(--mint-soft)', fgColor = '#2E7D5B', ic = 'download';
  let title = kind;
  const running = !ended_at && !error;
  let meta = running
    ? `running · started ${timeAgo(started_at)}`
    : `${rows || 0} rows · ${timeAgo(started_at)}`;

  if (error) {
    bgColor = 'var(--rose-soft)'; fgColor = '#B84747'; ic = 'alert-triangle';
    meta = `${error.slice(0, 60)} · ${timeAgo(started_at)}`;
  } else if (kind === 'posts') {
    title = `Reddit fetch · r/${params.sub || '?'}`;
    ic = 'download';
  } else if (kind === 'historical') {
    title = `Pullpush archive · r/${params.sub || '?'}`;
    bgColor = 'var(--lavender-soft)'; fgColor = '#6B4FA8'; ic = 'archive';
  } else if (kind && kind.startsWith('source:')) {
    title = `${kind.replace('source:', '').toUpperCase()} fetch`;
    bgColor = 'var(--sky-soft)'; fgColor = '#2E5B8C'; ic = 'globe';
  } else if (kind === 'search') {
    title = `Search: "${(params.query || '').slice(0, 50)}"`;
    bgColor = 'var(--orange-soft)'; fgColor = '#B85A1E'; ic = 'search';
  } else if (kind === 'local_file') {
    title = `Ingested ${(params.path || '').split('/').pop() || '?'}`;
    bgColor = 'var(--gold-soft)'; fgColor = '#8A6E1E'; ic = 'upload';
  }

  const runningPill = running
    ? `<span class="pill pill-running" style="margin-left:auto"><span class="pulse-dot sm"></span> running</span>`
    : '';

  return `
    <div class="activity-item${running ? ' is-running' : ''}">
      <div class="activity-ic" style="background:${bgColor};color:${fgColor};"><i data-lucide="${ic}"></i></div>
      <div class="activity-body">
        <div class="activity-title">${esc(title)}${runningPill}</div>
        <div class="activity-meta">${esc(meta)}</div>
      </div>
    </div>
  `;
}

// ---- skeleton markup (shown before sidecar returns) ----
function skelHero() {
  return `
    <section class="hero">
      <div>
        <div class="skel skel-xs"></div>
        <div class="skel skel-h1"></div>
        <div class="skel skel-line"></div>
        <div class="skel skel-line" style="width:70%"></div>
      </div>
      <div class="hero-stat">
        <div class="skel skel-lg"></div>
        <div class="hero-bars">${Array(7).fill('<div class="hero-bar skel" style="height:60%"></div>').join('')}</div>
      </div>
    </section>`;
}
function skelStats() {
  return Array(4).fill(`
    <div class="stat-card">
      <div class="skel skel-round"></div>
      <div class="skel skel-h2" style="margin:10px 0 6px"></div>
      <div class="skel skel-line" style="width:60%"></div>
    </div>
  `).join('');
}

// ---- render helpers ----
function renderHero(heroRoot, topTopic, stats, dailyCounts) {
  const heroTopic = topTopic?.topic || 'Welcome to Gap Map';
  const heroCopy = topTopic
    ? `Your latest topic has ${topTopic.painpoints || 0} painpoints across ${topTopic.sources || 0} source types from ${fmtN(topTopic.posts)} posts.`
    : 'Start a topic to see multi-source gap maps with citations, competitors, DIY workarounds, and more.';
  heroRoot.innerHTML = `
    <section class="hero fade-in">
      <div>
        <div class="hero-eyebrow">${topTopic ? 'Active research' : 'Get started'}</div>
        <h1>${esc(heroTopic)}</h1>
        <p>${esc(heroCopy)}</p>
        <div class="hero-actions">
          <button class="btn btn-primary" id="hero-new">+ New topic</button>
          ${topTopic ? `<button class="btn btn-ghost" data-open-topic="${encodeURIComponent(topTopic.topic)}">Open map</button>` : ''}
        </div>
      </div>
      <div class="hero-stat">
        <div class="hero-stat-row">
          <div>
            <h4>Total posts indexed</h4>
            <div class="hero-num">${fmtN(stats.total_posts)}</div>
          </div>
          <div class="hero-stat-up">${topTopic ? `▲ last 7d` : 'live'}</div>
        </div>
        <div class="hero-bars">${heroBarsFromCounts(dailyCounts)}</div>
      </div>
    </section>
  `;
  heroRoot.querySelector('#hero-new')?.addEventListener('click', () => window.gapmapOpenNewTopic?.());
  heroRoot.querySelector('[data-open-topic]')?.addEventListener('click', (e) => {
    location.hash = `#/topic/${e.currentTarget.dataset.openTopic}`;
  });
}

function heroBarsFromCounts(counts) {
  if (!counts?.length) {
    // Real zero state (no activity in last 7 days) — show flat bars
    return Array(7).fill('<div class="hero-bar" style="height:8%;opacity:0.4"></div>').join('');
  }
  const max = Math.max(1, ...counts.map(c => c.n));
  return counts.map(c => {
    const pct = Math.max(6, Math.round((c.n / max) * 100));
    return `<div class="hero-bar" title="${esc(c.day)}: ${c.n}" style="height:${pct}%"></div>`;
  }).join('');
}

function renderStatGrid(el, stats, deltas) {
  const s = stats || {};
  const d = deltas || {};
  const trendPill = (delta) => {
    if (delta == null) return '';
    if (delta > 0) return `<span class="stat-trend trend-up">+${delta}</span>`;
    if (delta < 0) return `<span class="stat-trend" style="background:var(--rose-soft);color:#B84747">${delta}</span>`;
    return `<span class="stat-trend trend-flat">·</span>`;
  };
  el.innerHTML = `
    <div class="stat-card fade-in">
      <div class="stat-head"><div class="stat-icon peach"><i data-lucide="target"></i></div>${trendPill(d.painpoints)}</div>
      <div class="stat-num">${fmtN(s.total_painpoints || 0)}</div>
      <div class="stat-label">Painpoints surfaced</div>
    </div>
    <div class="stat-card fade-in">
      <div class="stat-head"><div class="stat-icon lavender"><i data-lucide="sparkles"></i></div>${trendPill(d.sources)}</div>
      <div class="stat-num">${fmtN(s.total_sources || 0)}</div>
      <div class="stat-label">Sources indexed</div>
    </div>
    <div class="stat-card fade-in">
      <div class="stat-head"><div class="stat-icon mint"><i data-lucide="wrench"></i></div>${trendPill(d.workarounds)}</div>
      <div class="stat-num">${fmtN(s.total_workarounds || 0)}</div>
      <div class="stat-label">DIY workarounds (gap signal)</div>
    </div>
    <div class="stat-card fade-in">
      <div class="stat-head"><div class="stat-icon sky"><i data-lucide="layers"></i></div>${trendPill(d.posts)}</div>
      <div class="stat-num">${fmtN(s.total_posts || 0)}</div>
      <div class="stat-label">Posts indexed</div>
    </div>
  `;
}

// ---- line chart (SVG) ----
function momentumChart(rows, days) {
  if (!rows?.length) {
    return `<div class="empty-state" style="padding:40px 20px">No fetches in the last ${days} days. Start a topic to fill this chart.</div>`;
  }
  // Fill missing days with 0 so the axis is continuous.
  const map = {};
  rows.forEach(r => { map[r.day] = r.n; });
  const today = new Date();
  const points = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    points.push({ day: key, n: map[key] || 0 });
  }
  const W = 600, H = 160, padL = 28, padR = 10, padT = 16, padB = 24;
  const max = Math.max(1, ...points.map(p => p.n));
  const xStep = (W - padL - padR) / Math.max(1, points.length - 1);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const path = points.map((p, i) => {
    const x = padL + i * xStep;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y(p.n).toFixed(1)}`;
  }).join(' ');
  const area = `${path} L${(padL + (points.length - 1) * xStep).toFixed(1)},${H - padB} L${padL},${H - padB} Z`;

  // Y axis ticks (0, mid, max)
  const ticks = [0, Math.round(max / 2), max];
  const tickMarks = ticks.map(t => `
    <g transform="translate(${padL - 4},${y(t)})">
      <text text-anchor="end" dy="0.35em" font-size="10" fill="#8A8178">${t}</text>
      <line x1="4" x2="${W - padR - padL + 4}" y1="0" y2="0" stroke="#E8DDD2" stroke-width="1" stroke-dasharray="2,3" />
    </g>`).join('');

  // X axis: first / mid / last date labels
  const firstDay = points[0].day.slice(5);
  const midDay = points[Math.floor(points.length / 2)].day.slice(5);
  const lastDay = points[points.length - 1].day.slice(5);
  const xLabels = `
    <text x="${padL}" y="${H - 4}" font-size="10" fill="#8A8178">${firstDay}</text>
    <text x="${W / 2}" y="${H - 4}" font-size="10" fill="#8A8178" text-anchor="middle">${midDay}</text>
    <text x="${W - padR}" y="${H - 4}" font-size="10" fill="#8A8178" text-anchor="end">${lastDay}</text>`;

  const total = points.reduce((a, p) => a + p.n, 0);
  const legend = `<div class="momentum-legend"><b>${total}</b> fetches · last ${days}d</div>`;

  return `
    ${legend}
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:180px">
      ${tickMarks}
      <path d="${area}" fill="#FFE9D6" opacity="0.55" />
      <path d="${path}" fill="none" stroke="#FF8C42" stroke-width="2" />
      ${xLabels}
    </svg>`;
}

// ---- dashboard cache (stale-while-revalidate) ----------------------------
// Every sidecar call spawns a fresh Python process (~500ms warm). The
// dashboard fires ~6 of them in parallel, so a fresh visit is always
// ~1-2s bounded by the slowest one. Caching the rendered data means
// second+ visits paint instantly while a background refresh runs. TTL=none
// (cache is invalidated only when data changes — a successful refresh
// overwrites it).
const DASH_CACHE_KEY = 'gapmap.dashboard.cache.v1';

function readDashCache() {
  try {
    const raw = localStorage.getItem(DASH_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeDashCache(patch) {
  try {
    const cur = readDashCache() || {};
    localStorage.setItem(DASH_CACHE_KEY, JSON.stringify({ ...cur, ...patch, _ts: Date.now() }));
  } catch {}
}

// ---- top-level ----
export async function renderHome(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Dashboard</strong></div>
      <div class="topbar-spacer"></div>
      <div class="search" id="home-search" role="button" tabindex="0" title="Start a new topic">
        <span>⌕</span>
        <span>Start a topic — type a market or problem…</span>
      </div>
      <div class="icon-btn-square" id="home-bell" title="Pipeline activity" role="button" tabindex="0"><i data-lucide="bell"></i></div>
      <div class="avatar" id="home-avatar" role="button" tabindex="0" title="Settings">${headerAvatar()}</div>
    </header>

    <div id="active-collect-slot"></div>
    <div id="byok-prompt-slot"></div>
    <div id="palace-nudge-slot"></div>

    <div id="hero-slot">${skelHero()}</div>
    <section class="stat-grid" id="stat-grid">${skelStats()}</section>
    <section class="two-col">
      <div class="card">
        <div class="card-head">
          <div>
            <h3>Topic momentum</h3>
            <p>Daily pipeline activity (fetches across all topics)</p>
          </div>
          <div class="filter-bar" id="momentum-range">
            <button class="pill ${momentumRange === 30  ? 'active' : ''}" data-days="30">30d</button>
            <button class="pill ${momentumRange === 90  ? 'active' : ''}" data-days="90">90d</button>
            <button class="pill ${momentumRange === 365 ? 'active' : ''}" data-days="365">1Y</button>
          </div>
        </div>
        <div class="card-body" id="momentum-body" style="padding:18px 20px 16px">
          <div class="empty-state">loading chart…</div>
        </div>
      </div>
      <div class="card">
        <div class="card-head">
          <div>
            <h3>Recent activity</h3>
            <p>Latest ingests &amp; events</p>
          </div>
          <a href="#/activity" class="pill" style="text-decoration:none;color:inherit">See all →</a>
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
        <button class="btn btn-primary btn-sm" id="btn-new-topic">
          + New topic
        </button>
      </div>
    </div>
    <div id="topic-grid-slot">
      <section class="topic-grid"></section>
    </div>
  `;

  // Header buttons (synchronous)
  root.querySelector('#btn-new-topic')?.addEventListener('click', () => window.gapmapOpenNewTopic?.());
  root.querySelector('#home-search')?.addEventListener('click',  () => window.gapmapOpenNewTopic?.());
  root.querySelector('#home-bell')?.addEventListener('click',    () => { location.hash = '#/activity'; });
  root.querySelector('#home-avatar')?.addEventListener('click',  () => { location.hash = '#/settings'; });

  // Momentum range toggles — re-render chart without re-running the whole page
  root.querySelector('#momentum-range').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-days]');
    if (!btn) return;
    momentumRange = Number(btn.dataset.days);
    root.querySelectorAll('#momentum-range .pill').forEach(p => {
      p.classList.toggle('active', Number(p.dataset.days) === momentumRange);
    });
    loadMomentum(root);
  });

  // Instant paint from cache (if any) — skeletons never appear on repeat visits.
  const cached = readDashCache();
  if (cached) {
    if (cached.topics && cached.stats) {
      const topTopic = cached.topics[0] || null;
      renderHero(root.querySelector('#hero-slot'), topTopic, cached.stats, cached.dailyCounts || []);
      renderStatGrid(root.querySelector('#stat-grid'), cached.stats, null);
    }
    if (cached.momentumByRange?.[momentumRange]) {
      root.querySelector('#momentum-body').innerHTML =
        momentumChart(cached.momentumByRange[momentumRange], momentumRange);
    }
    if (Array.isArray(cached.activity) && cached.activity.length) {
      root.querySelector('#activity-feed').innerHTML =
        cached.activity.slice(0, 8).map(activityItem).join('');
    }
    if (Array.isArray(cached.topics) && cached.topics.length) {
      const slot = root.querySelector('#topic-grid-slot');
      const sub = root.querySelector('#topics-subtitle');
      if (sub) sub.textContent = `${cached.topics.length} active ${cached.topics.length === 1 ? 'project' : 'projects'}`;
      slot.innerHTML = `<section class="topic-grid">${cached.topics.slice(0, 8).map((t, i) => topicTile(t, i)).join('')}</section>`;
      slot.querySelectorAll('.topic-tile').forEach(el => {
        el.addEventListener('click', () => { location.hash = el.dataset.href; });
      });
    }
    window.refreshIcons?.();
  }

  // Background refresh — fires all queries in parallel and rewrites slots
  // when fresher data arrives. Per-call failures are per-slot, never kill
  // the whole dashboard.
  loadHeroAndStats(root);
  loadMomentum(root);
  loadActivity(root);
  loadTopicGrid(root);
  loadActiveCollect(root);
  loadByokPrompt(root);
  loadPalaceNudge(root);

  // Live-refresh hooks:
  //   1. `gapmap:db-changed` fires when api.js's mtime poller detects an
  //      external DB write. Re-fetch every slot so the user always sees
  //      fresh data without clicking reload.
  //   2. A 30 s background interval for belt-and-braces (covers intra-app
  //      writes that don't bump mtime enough to trip the 5 s poller window).
  //   Both guarded by isConnected so they stop firing once the user navigates
  //   away (no leaked listeners / timers).
  const myRouteGen = root.dataset.routeGen;
  const alive = () => root.dataset.routeGen === myRouteGen && root.isConnected;
  const refresh = () => {
    if (!alive()) return;
    loadHeroAndStats(root);
    loadMomentum(root);
    loadActivity(root);
    loadTopicGrid(root);
    loadActiveCollect(root);
  };
  const dbListener = () => refresh();
  window.addEventListener('gapmap:db-changed', dbListener);
  const bgTimer = setInterval(() => {
    if (!alive()) {
      clearInterval(bgTimer);
      window.removeEventListener('gapmap:db-changed', dbListener);
      return;
    }
    if (document.visibilityState !== 'visible') return;
    refresh();
  }, 30000);
}

async function loadHeroAndStats(root) {
  let topics = [], stats = {}, dailyCounts = [];
  // Promise.allSettled instead of all — partial success beats a blank
  // dashboard when one endpoint times out. Each catch below handles its
  // own fallback; the outer allSettled is belt-and-braces against any
  // unhandled rejection slipping through.
  const settled = await Promise.allSettled([
    api.listTopics().catch(() => []),
    api.overviewStats().catch(() => [{}]),
  ]);
  const tRes = settled[0].status === 'fulfilled' ? settled[0].value : [];
  const sRes = settled[1].status === 'fulfilled' ? settled[1].value : [{}];
  topics = Array.isArray(tRes) ? tRes : [];
  stats = Array.isArray(sRes) && sRes[0] ? sRes[0] : {};

  const topTopic = topics[0];
  // Pull daily post counts for the top topic for the hero bars.
  if (topTopic?.topic) {
    try {
      const rows = await api.runQuery(
        `SELECT substr(added_at,1,10) AS day, count(*) AS n
         FROM topic_posts
         WHERE topic=:topic
           AND substr(added_at,1,10) >= date('now','-6 days')
         GROUP BY substr(added_at,1,10) ORDER BY day ASC`,
        String(topTopic.topic),
      );
      if (Array.isArray(rows)) {
        // Normalize to exactly the last 7 days, filling zeros.
        const map = {};
        rows.forEach(r => { map[r.day] = r.n; });
        const today = new Date();
        for (let i = 6; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(today.getDate() - i);
          const key = d.toISOString().slice(0, 10);
          dailyCounts.push({ day: key, n: map[key] || 0 });
        }
      }
    } catch {}
  }

  renderHero(root.querySelector('#hero-slot'), topTopic, stats, dailyCounts);
  renderStatGrid(root.querySelector('#stat-grid'), stats, null);
  window.refreshIcons?.();
  writeDashCache({ topics, stats, dailyCounts });
}

async function loadMomentum(root) {
  const body = root.querySelector('#momentum-body');
  // Only show skeleton if we have no cached chart for this range.
  const cached = readDashCache()?.momentumByRange?.[momentumRange];
  if (!cached) body.innerHTML = `<div class="empty-state">loading chart…</div>`;
  try {
    const rows = await api.runQuery(
      `SELECT substr(started_at,1,10) AS day, count(*) AS n \
       FROM fetches \
       WHERE substr(started_at,1,10) >= date('now','-${momentumRange} days') \
       GROUP BY substr(started_at,1,10) ORDER BY day ASC`
    );
    body.innerHTML = momentumChart(Array.isArray(rows) ? rows : [], momentumRange);
    // Cache per-range so the 30/90/1Y toggle also benefits.
    const prev = readDashCache()?.momentumByRange || {};
    writeDashCache({ momentumByRange: { ...prev, [momentumRange]: rows || [] } });
  } catch (e) {
    if (!cached) {
      body.innerHTML = `<div class="empty-state">error loading chart: ${esc(e?.message || e)}</div>`;
    }
    // With cache: keep the stale chart, don't overwrite with an error message.
  }
}

async function loadActivity(root) {
  const feed = root.querySelector('#activity-feed');
  const hadCache = !!(readDashCache()?.activity?.length);
  try {
    const rows = await api.recentActivity();
    if (!Array.isArray(rows) || !rows.length) {
      if (!hadCache) {
        feed.innerHTML = `<div class="empty-state" style="padding:24px">no activity yet — start a topic to see fetches land here</div>`;
      }
      writeDashCache({ activity: [] });
      return;
    }
    feed.innerHTML = rows.slice(0, 8).map(activityItem).join('');
    window.refreshIcons?.();
    writeDashCache({ activity: rows });
  } catch (e) {
    if (!hadCache) {
      feed.innerHTML = `<div class="empty-state" style="padding:24px">error: ${esc(e?.message || e)}</div>`;
    }
  }
}

async function loadTopicGrid(root) {
  // Avoid a second sidecar spawn — loadHeroAndStats already fetched + cached topics.
  // We wait up to 3s for that call to finish, then fall through to a fresh fetch
  // only if nothing landed (handles the case where hero-stats failed).
  let topics = [];
  for (let i = 0; i < 30 && !topics.length; i++) {
    const cached = readDashCache()?.topics;
    if (Array.isArray(cached)) { topics = cached; break; }
    await new Promise(r => setTimeout(r, 100));
  }
  if (!topics.length) {
    try {
      const r = await api.listTopics();
      topics = Array.isArray(r) ? r : [];
    } catch {}
  }

  const slot = root.querySelector('#topic-grid-slot');
  const subtitle = root.querySelector('#topics-subtitle');
  subtitle.textContent = `${topics.length} active ${topics.length === 1 ? 'project' : 'projects'}`;

  if (!topics.length) {
    slot.innerHTML = `
      <div class="empty-big">
        <h3>No topics yet</h3>
        <p>Give Gap Map a topic — "meditation apps", "freelance invoicing", "ATS resume tools" — and it'll pull multi-source data and render a gap map.</p>
        <button class="btn btn-primary" id="empty-new-topic">+ Start your first topic</button>
      </div>`;
    slot.querySelector('#empty-new-topic')?.addEventListener('click', () => window.gapmapOpenNewTopic?.());
    return;
  }

  slot.innerHTML = `<section class="topic-grid">${topics.slice(0, 8).map((t, i) => topicTile(t, i)).join('')}</section>`;
  slot.querySelectorAll('.topic-tile').forEach(el => {
    el.addEventListener('click', () => { location.hash = el.dataset.href; });
  });
}

async function loadActiveCollect(root) {
  const slot = root.querySelector('#active-collect-slot');
  if (!slot) return;

  let lastTopic = '';
  let lastWasRunning = false;

  const tick = async () => {
    if (!document.body.contains(slot)) return; // DOM unmounted
    try {
      // A running collect writes a `fetches` row with ended_at NULL.
      const rows = await api.runQuery(
        `SELECT kind, params_json, started_at FROM fetches \
         WHERE ended_at IS NULL \
         ORDER BY started_at DESC LIMIT 1`
      );
      const running = Array.isArray(rows) && rows.length > 0;
      if (!running) {
        if (lastWasRunning) {
          // Collect just finished — refresh downstream panels so stats update.
          loadActivity(root);
          loadTopicGrid(root);
          loadHeroAndStats(root);
        }
        slot.innerHTML = '';
        lastWasRunning = false;
        lastTopic = '';
        return;
      }
      const row = rows[0];
      let params = {};
      try { params = JSON.parse(row.params_json || '{}'); } catch {}
      const topic = params.topic || '';
      const since = timeAgo(row.started_at);
      // Only re-render when the row or topic actually changes — avoids
      // losing focus on other parts of the page every poll.
      const same = lastWasRunning && topic === lastTopic;
      if (!same) {
        slot.innerHTML = `
          <div class="active-collect-banner">
            <div class="pulse-dot"></div>
            <div class="acb-body" role="button" tabindex="0" title="Click to view progress">
              <b>Collecting${topic ? ` "${esc(topic)}"` : ''}…</b>
              <span>step: ${esc(row.kind || '…')} · started ${esc(since)}</span>
            </div>
            <button class="btn btn-ghost btn-sm btn-bordered" id="acb-cancel" style="color:#B84747;border-color:#E8C8C8">Cancel fetch</button>
            <div class="acb-cta">View →</div>
          </div>`;
        const banner = slot.querySelector('.active-collect-banner');
        const goToProgress = () => {
          if (topic) location.hash = `#/collect/${encodeURIComponent(topic)}`;
          else location.hash = '#/activity';
        };
        // Click body → navigate; cancel button stops propagation and kills.
        slot.querySelector('.acb-body').addEventListener('click', goToProgress);
        slot.querySelector('.acb-cta').addEventListener('click', goToProgress);
        const cancelBtn = slot.querySelector('#acb-cancel');
        cancelBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const label = topic ? `"${topic}"` : 'the active fetch';
          if (!confirm(`Stop ${label}? Partial results stay in the corpus — you can Rerun anytime.`)) return;
          cancelBtn.disabled = true;
          const orig = cancelBtn.textContent;
          cancelBtn.textContent = 'Cancelling…';
          try {
            await api.cancelCollect();
            // Clear optimistically; loadActiveCollect's next poll confirms.
            slot.innerHTML = '';
            lastWasRunning = false; lastTopic = null;
          } catch (err) {
            cancelBtn.disabled = false;
            cancelBtn.textContent = orig;
            alert(`Cancel failed: ${err?.message || err}`);
          }
        });
        lastWasRunning = true;
        lastTopic = topic;
      } else {
        // Same collect still running — refresh the "started N ago" text cheaply.
        const span = slot.querySelector('.acb-body span');
        if (span) span.textContent = `step: ${row.kind || '…'} · started ${since}`;
      }
      // While a collect is running, keep the activity feed fresh so the user
      // can watch new fetch rows land without refreshing the page.
      loadActivity(root);
    } catch {
      slot.innerHTML = '';
    }
  };

  await tick();
  const intervalId = setInterval(tick, 4000);
  window.addEventListener('hashchange', function once() {
    clearInterval(intervalId);
    window.removeEventListener('hashchange', once);
  });
}

// ─── Dedicated Topics screen ──────────────────────────────────────────────

export async function renderTopicsList(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Topics</strong></div>
      <div class="topbar-spacer"></div>
      <div class="search"><i data-lucide="search"></i> Start a topic — type a market or problem…</div>
      <div class="icon-btn-square" id="topics-bell" title="Pipeline activity" role="button" tabindex="0">
        <i data-lucide="bell"></i>
      </div>
      <div class="avatar" id="topics-avatar" role="button" tabindex="0" title="Settings">${headerAvatar()}</div>
    </header>
    <div class="section-head">
      <div><h2>All topics</h2><p id="topics-count">Loading…</p></div>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="topics-filter" placeholder="Filter by name…" style="padding:8px 12px;border:1px solid var(--line);border-radius:999px;font-size:12px;font-family:inherit;background:var(--surface)" />
        <button class="btn btn-primary btn-sm icon-btn" id="topics-new"><i data-lucide="plus"></i> New topic</button>
      </div>
    </div>
    <div id="topics-grid-slot"><div class="empty-state" style="padding:24px">loading…</div></div>
  `;
  root.querySelector('#topics-new').onclick = () => window.gapmapOpenNewTopic?.();
  root.querySelector('#topics-bell').onclick = () => { location.hash = '#/activity'; };
  root.querySelector('#topics-avatar').onclick = () => { location.hash = '#/settings'; };
  window.refreshIcons?.();

  const slot = root.querySelector('#topics-grid-slot');
  const countEl = root.querySelector('#topics-count');
  const filterInput = root.querySelector('#topics-filter');

  let topics = [];
  try {
    const r = await api.listTopics();
    topics = Array.isArray(r) ? r : [];
  } catch (e) {
    const msg = (e?.message || e || '').toString();
    // "no such table: topic_posts" means no collect has ever been run —
    // treat it as an empty workspace, not a crash.
    const isEmptyDb = /no such table/i.test(msg);
    countEl.textContent = isEmptyDb ? '0 topics' : 'error';
    slot.innerHTML = isEmptyDb
      ? `<div class="empty-big">
          <h3>No topics yet</h3>
          <p>Start your first research topic — we'll pull posts from Reddit, HN, Dev.to and more, then surface painpoints and DIY workarounds.</p>
          <button class="btn btn-primary icon-btn" id="topics-empty-new"><i data-lucide="plus"></i> Start new topic</button>
        </div>`
      : `<div class="empty-big">
          <h3>Couldn't load topics</h3>
          <p style="white-space:pre-wrap;max-height:160px;overflow:auto;text-align:left;margin:8px auto;max-width:640px">${esc(msg)}</p>
          <button class="btn btn-ghost icon-btn" id="topics-empty-retry" style="border:1px solid var(--line)"><i data-lucide="rotate-cw"></i> Retry</button>
        </div>`;
    slot.querySelector('#topics-empty-new')?.addEventListener('click', () => window.gapmapOpenNewTopic?.());
    slot.querySelector('#topics-empty-retry')?.addEventListener('click', () => renderTopicsList(root));
    window.refreshIcons?.();
    return;
  }

  const paint = (list) => {
    countEl.textContent = `${list.length} ${list.length === 1 ? 'topic' : 'topics'}`;
    if (!list.length) {
      const filtering = filterInput.value.trim().length > 0;
      slot.innerHTML = filtering
        ? `<div class="empty-big">
             <h3>No matching topics</h3>
             <p>Try clearing the filter, or start a new one.</p>
             <button class="btn btn-primary icon-btn" id="topics-empty-new"><i data-lucide="plus"></i> Start new topic</button>
           </div>`
        : `<div class="empty-big">
             <h3>No topics yet</h3>
             <p>Start your first research topic to collect posts and surface painpoints + DIY workarounds.</p>
             <button class="btn btn-primary icon-btn" id="topics-empty-new"><i data-lucide="plus"></i> Start new topic</button>
           </div>`;
      slot.querySelector('#topics-empty-new')?.addEventListener('click', () => window.gapmapOpenNewTopic?.());
      window.refreshIcons?.();
      return;
    }
    slot.innerHTML = `<section class="topic-grid">${list.map((t, i) => topicTile(t, i)).join('')}</section>`;
    slot.querySelectorAll('.topic-tile').forEach(el => {
      el.addEventListener('click', () => { location.hash = el.dataset.href; });
    });
    window.refreshIcons?.();
  };

  paint(topics);

  filterInput.addEventListener('input', () => {
    const q = filterInput.value.trim().toLowerCase();
    if (!q) return paint(topics);
    paint(topics.filter(t => (t.topic || '').toLowerCase().includes(q)));
  });
}

async function loadByokPrompt(root) {
  const slot = root.querySelector('#byok-prompt-slot');
  try {
    const s = await api.byokStatus();
    const anyReady =
      s?.anthropic?.set || s?.openai?.set || s?.openrouter?.set ||
      s?.groq?.set || s?.deepseek?.set || s?.mistral?.set || s?.google?.set ||
      !!s?.ollama_base_url;
    if (anyReady) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <div class="byok-prompt-card">
        <div class="byok-prompt-ic"><i data-lucide="key-round"></i></div>
        <div class="byok-prompt-body">
          <b>Add an LLM key to unlock painpoint extraction</b>
          <p>Gap Map can pull data without a key, but painpoints / features / DIY workarounds need an LLM. Anthropic, OpenAI, OpenRouter, Groq, DeepSeek, Gemini, or local Ollama all work.</p>
        </div>
        <button class="btn btn-primary btn-sm" id="byok-prompt-btn">Add key</button>
      </div>`;
    slot.querySelector('#byok-prompt-btn').addEventListener('click', () => {
      location.hash = '#/settings';
    });
  } catch {
    slot.innerHTML = '';
  }
}

// First-time nudge for the opt-in semantic-search download. Shows only when:
//   - retrieval extras are installed (build has chromadb wheels)
//   - ONNX model NOT yet cached
//   - user hasn't permanently dismissed the nudge
// Dismissed state persists in localStorage so repeat Dashboard visits
// don't nag. Enabling from Settings → Semantic search clears the flag
// automatically (see settings.js → palace reload), so this banner never
// reappears after the model is ready.
async function loadPalaceNudge(root) {
  const slot = root.querySelector('#palace-nudge-slot');
  if (!slot) return;
  const DISMISS_KEY = 'gapmap.palace.nudge.dismissed';
  if (localStorage.getItem(DISMISS_KEY) === 'true') { slot.innerHTML = ''; return; }
  try {
    const ms = await api.palaceModelStatus();
    if (!ms?.installed || ms?.ready) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <div class="byok-prompt-card palace-nudge-card">
        <div class="byok-prompt-ic" style="background:var(--orange-soft);color:#B85A1E"><i data-lucide="sparkles"></i></div>
        <div class="byok-prompt-body">
          <b>Unlock semantic search (optional · 80 MB)</b>
          <p>One-time download of a tiny embedding model lets you search your corpus by <i>meaning</i> — find similar painpoints across topics, get smarter chat answers, zero cloud calls. Everything stays local.</p>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm btn-bordered" id="palace-nudge-skip" title="Hide this banner">Skip</button>
          <button class="btn btn-primary btn-sm" id="palace-nudge-enable">Enable →</button>
        </div>
      </div>`;
    slot.querySelector('#palace-nudge-enable').addEventListener('click', () => {
      location.hash = '#/settings';
    });
    slot.querySelector('#palace-nudge-skip').addEventListener('click', () => {
      localStorage.setItem(DISMISS_KEY, 'true');
      slot.innerHTML = '';
    });
  } catch {
    slot.innerHTML = '';
  }
}
