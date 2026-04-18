// Dashboard v2 — real momentum chart, real hero bars, skeleton loaders,
// active-collect banner, BYOK prompt, fixed empty-state reflow.

import { api, esc, fmtN, timeAgo } from '../api.js';

const COVER_VARIANTS = ['cover-1', 'cover-2', 'cover-3', 'cover-4'];
const COVER_EMOJIS = ['📄', '🎓', '🌱', '💸', '🎯', '🔧', '💡', '🚀'];

let momentumRange = 90; // days: 30 | 90 | 365

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
    <section class="hero">
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
    <div class="stat-card">
      <div class="stat-head"><div class="stat-icon peach">◉</div>${trendPill(d.painpoints)}</div>
      <div class="stat-num">${fmtN(s.total_painpoints || 0)}</div>
      <div class="stat-label">Painpoints surfaced</div>
    </div>
    <div class="stat-card">
      <div class="stat-head"><div class="stat-icon lavender">✦</div>${trendPill(d.sources)}</div>
      <div class="stat-num">${fmtN(s.total_sources || 0)}</div>
      <div class="stat-label">Sources indexed</div>
    </div>
    <div class="stat-card">
      <div class="stat-head"><div class="stat-icon mint">◢</div>${trendPill(d.workarounds)}</div>
      <div class="stat-num">${fmtN(s.total_workarounds || 0)}</div>
      <div class="stat-label">DIY workarounds (gap signal)</div>
    </div>
    <div class="stat-card">
      <div class="stat-head"><div class="stat-icon sky">▭</div>${trendPill(d.posts)}</div>
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
      <div class="icon-btn" id="home-bell" title="Pipeline activity" role="button" tabindex="0">🔔</div>
      <div class="avatar" id="home-avatar" role="button" tabindex="0" title="Settings">SB</div>
    </header>

    <div id="active-collect-slot"></div>
    <div id="byok-prompt-slot"></div>

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
        <button class="btn btn-primary" id="btn-new-topic" style="padding:8px 14px;font-size:12px">
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

  // Kick off all data fetches in parallel. Each updates its own slot as it arrives.
  loadHeroAndStats(root);
  loadMomentum(root);
  loadActivity(root);
  loadTopicGrid(root);
  loadActiveCollect(root);
  loadByokPrompt(root);
}

async function loadHeroAndStats(root) {
  let topics = [], stats = {}, dailyCounts = [];
  try {
    const [tRes, sRes] = await Promise.all([
      api.listTopics().catch(() => []),
      api.overviewStats().catch(() => [{}]),
    ]);
    topics = Array.isArray(tRes) ? tRes : [];
    stats = Array.isArray(sRes) && sRes[0] ? sRes[0] : {};
  } catch {}

  const topTopic = topics[0];
  // Pull daily post counts for the top topic for the hero bars.
  if (topTopic?.topic) {
    try {
      const safe = String(topTopic.topic).replace(/'/g, "''");
      const rows = await api.runQuery(
        `SELECT substr(added_at,1,10) AS day, count(*) AS n \
         FROM topic_posts \
         WHERE topic='${safe}' \
           AND substr(added_at,1,10) >= date('now','-6 days') \
         GROUP BY substr(added_at,1,10) ORDER BY day ASC`
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
}

async function loadMomentum(root) {
  const body = root.querySelector('#momentum-body');
  body.innerHTML = `<div class="empty-state">loading chart…</div>`;
  try {
    const rows = await api.runQuery(
      `SELECT substr(started_at,1,10) AS day, count(*) AS n \
       FROM fetches \
       WHERE substr(started_at,1,10) >= date('now','-${momentumRange} days') \
       GROUP BY substr(started_at,1,10) ORDER BY day ASC`
    );
    body.innerHTML = momentumChart(Array.isArray(rows) ? rows : [], momentumRange);
  } catch (e) {
    body.innerHTML = `<div class="empty-state">error loading chart: ${esc(e?.message || e)}</div>`;
  }
}

async function loadActivity(root) {
  const feed = root.querySelector('#activity-feed');
  try {
    const rows = await api.recentActivity();
    if (!Array.isArray(rows) || !rows.length) {
      feed.innerHTML = `<div class="empty-state" style="padding:24px">no activity yet — start a topic to see fetches land here</div>`;
      return;
    }
    feed.innerHTML = rows.slice(0, 8).map(activityItem).join('');
  } catch (e) {
    feed.innerHTML = `<div class="empty-state" style="padding:24px">error: ${esc(e?.message || e)}</div>`;
  }
}

async function loadTopicGrid(root) {
  let topics = [];
  try {
    const r = await api.listTopics();
    topics = Array.isArray(r) ? r : [];
  } catch {}

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
  try {
    // A running collect writes a `fetches` row with ended_at NULL.
    const rows = await api.runQuery(
      `SELECT kind, params_json, started_at FROM fetches \
       WHERE ended_at IS NULL \
       ORDER BY started_at DESC LIMIT 1`
    );
    if (!Array.isArray(rows) || !rows.length) { slot.innerHTML = ''; return; }
    const row = rows[0];
    let params = {};
    try { params = JSON.parse(row.params_json || '{}'); } catch {}
    const topic = params.topic || '';
    const since = timeAgo(row.started_at);
    slot.innerHTML = `
      <div class="active-collect-banner" role="button" tabindex="0">
        <div class="pulse-dot"></div>
        <div class="acb-body">
          <b>Collecting${topic ? ` "${esc(topic)}"` : ''}…</b>
          <span>step: ${esc(row.kind || '…')} · started ${esc(since)}</span>
        </div>
        <div class="acb-cta">View progress →</div>
      </div>`;
    slot.querySelector('.active-collect-banner').addEventListener('click', () => {
      if (topic) location.hash = `#/collect/${encodeURIComponent(topic)}`;
      else location.hash = '#/activity';
    });
  } catch {
    slot.innerHTML = '';
  }
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
        <div class="byok-prompt-ic">🗝</div>
        <div class="byok-prompt-body">
          <b>Add an LLM key to unlock painpoint extraction</b>
          <p>Gap Map can pull data without a key, but painpoints / features / DIY workarounds need an LLM. Anthropic, OpenAI, OpenRouter, Groq, DeepSeek, Gemini, or local Ollama all work.</p>
        </div>
        <button class="btn btn-primary" id="byok-prompt-btn" style="padding:8px 14px;font-size:12px">Add key</button>
      </div>`;
    slot.querySelector('#byok-prompt-btn').addEventListener('click', () => {
      location.hash = '#/settings';
    });
  } catch {
    slot.innerHTML = '';
  }
}
