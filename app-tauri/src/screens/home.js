// Dashboard v2 — real momentum chart, real hero bars, skeleton loaders,
// active-collect banner, BYOK prompt, fixed empty-state reflow.

import { api, esc, fmtN, timeAgo } from '../api.js';
import { confirmModal } from '../lib/confirmModal.js';
import { avatarInitials } from './settings.js';
import { setHTMLIfChanged } from '../lib/screenCache.js';
import { skelGrid, skelRows, skelInline } from '../lib/skeleton.js';
import { openMergeModal } from './mergeModal.js';

function normalizeTopicLabel(value) {
  const s = String(value ?? '');
  return s.replace(/\s+/g, ' ').trim();
}

function safeDecodeTopicSlug(value) {
  const s = String(value ?? '');
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

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
  const topic = String(t?.topic ?? '');
  const topicLabel = normalizeTopicLabel(topic) || topic;
  const slug = encodeURIComponent(topic);
  return `
    <div class="topic-tile" data-href="#/topic/${slug}" data-topic-href="#/topic/${slug}">
      <div class="topic-cover ${cover}"><i data-lucide="${icon}"></i></div>
      <h4>${esc(topicLabel)}</h4>
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
  // Stale-render guard: overview_stats is async, so by the time it resolves
  // the user may have routed away and `#hero-slot` no longer exists in the
  // current DOM tree. Silently skip — the next route's own renderer owns
  // the screen now.
  if (!heroRoot) return;
  const heroTopic = normalizeTopicLabel(topTopic?.topic || '') || 'Welcome to Gap Map';
  const heroCopy = topTopic
    ? `Your latest topic has ${topTopic.painpoints || 0} painpoints across ${topTopic.sources || 0} source types from ${fmtN(topTopic.posts)} posts.`
    : 'Start a topic to see multi-source gap maps with citations, competitors, DIY workarounds, and more.';
  const heroHtml = `
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
  if (!setHTMLIfChanged(heroRoot, heroHtml)) return;   // identical → keep handlers
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
  // Defensive: home tab cache pre-paints from localStorage before the
  // host element is in the DOM, AND the dashboard cache write-back can
  // call this with the prior `el` ref after the user navigated to a
  // topic (`#stat-grid` no longer exists). Without this guard, the
  // next `el.innerHTML = …` throws `TypeError: null is not an object`
  // — observed when opening a chat tab while the dashboard cache
  // refresh was still in flight. No-op when host is gone.
  if (!el) return;
  const s = stats || {};
  const d = deltas || {};
  const trendPill = (delta) => {
    if (delta == null) return '';
    if (delta > 0) return `<span class="stat-trend trend-up">+${delta}</span>`;
    if (delta < 0) return `<span class="stat-trend" style="background:var(--rose-soft);color:#B84747">${delta}</span>`;
    return `<span class="stat-trend trend-flat">·</span>`;
  };
  setHTMLIfChanged(el, `
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
  `);
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
      <form class="search search--interactive" id="home-search" title="Search across your corpus">
        <span>⌕</span>
        <input
          id="home-search-input"
          type="search"
          placeholder="Search your corpus — topics, signals, findings…"
          autocomplete="off"
          spellcheck="false"
          aria-label="Search corpus"
        />
      </form>
      <div class="icon-btn-square" id="home-bell" title="Pipeline activity" role="button" tabindex="0"><i data-lucide="bell"></i></div>
      <div class="avatar" id="home-avatar" role="button" tabindex="0" title="Settings">${headerAvatar()}</div>
    </header>

    <!-- First-launch warm-up notice — shows when the bundled Python sidecar
         hasn't responded within 4s. macOS Gatekeeper verifies every .so
         inside the PyInstaller binary on the FIRST launch only (~10-30s
         on Apple Silicon). Without this banner the user sees only loading
         skeletons and assumes the app is broken. Auto-hides the moment
         the first api.cliInfo() returns. -->
    <div id="first-launch-warmup" class="empty-state" style="display:none;margin:14px 0;padding:14px;background:var(--orange-pale);border:1px solid var(--orange);color:var(--ink-2)">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="skel skel-round" style="width:14px;height:14px;border-radius:50%;flex-shrink:0"></span>
        <div>
          <div style="font-weight:600;color:var(--ink-1)">First-time setup — one moment</div>
          <div style="color:var(--ink-3);font-size:12.5px">
            macOS is verifying the Gap Map engine. This takes 10-30 seconds on first launch,
            then never again.
          </div>
        </div>
      </div>
    </div>

    <div id="active-collect-slot"></div>
    <div id="byok-prompt-slot"></div>
    <div id="palace-nudge-slot"></div>
    <!-- Dual-Mode Pivot — Your Products card. Populated async by loadProductsCard(). Silent when none. -->
    <div id="products-card-slot"></div>
    <!-- Phase-4 weekly-delta card. Populated async by loadWeeklyDeltas() -->
    <div id="weekly-deltas-slot"></div>
    <!-- Phase-3 active bets summary. Populated async by loadBetsSummary() -->
    <div id="bets-summary-slot"></div>

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
          <div class="empty-state">${skelInline('Loading chart…')}</div>
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
        <div class="activity" id="activity-feed">${skelRows(6)}</div>
      </div>
    </section>

    <!-- Phase-5 cross-topic leaderboard. Populated async by loadTopOpportunities().
         Sits just above "Your topics" so it acts as a lead-in to the topic grid. -->
    <div id="top-opportunities-slot"></div>

    <div class="section-head">
      <div>
        <h2>Your topics</h2>
        <p id="topics-subtitle">Active research projects</p>
      </div>
      <div class="filter-bar" style="display:flex;gap:8px">
        <a href="#/ingest-video" class="btn btn-ghost btn-sm btn-bordered icon-btn" title="Paste any YouTube / Vimeo / podcast URL — audio stays local, Whisper transcribes on-device">
          <i data-lucide="video"></i> Ingest video
        </a>
        <a href="#/ingest" class="btn btn-ghost btn-sm btn-bordered icon-btn" title="Drop a CSV, JSON, PDF, or transcript file into a topic">
          <i data-lucide="file-up"></i> Ingest files
        </a>
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
  root.querySelector('#home-search')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = (root.querySelector('#home-search-input')?.value || '').trim();
    location.hash = q ? `#/find?q=${encodeURIComponent(q)}` : '#/find';
  });
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

  // First-launch warm-up indicator. Show the explanatory banner if no
  // sidecar response arrives within 4s; hide as soon as one does. Avoids
  // the "skeletons forever — is it broken?" impression during the
  // unavoidable one-time Gatekeeper verification of the PyInstaller
  // binary's .so files (10-30s on Apple Silicon, first launch only).
  const warmupBanner = root.querySelector('#first-launch-warmup');
  let warmupShown = false;
  const showWarmup = setTimeout(() => {
    if (warmupBanner) {
      warmupBanner.style.display = '';
      warmupShown = true;
    }
  }, 4000);
  const hideWarmup = () => {
    clearTimeout(showWarmup);
    if (warmupBanner && (warmupShown || warmupBanner.style.display === '')) {
      // Fade-out micro-animation
      warmupBanner.style.transition = 'opacity 240ms';
      warmupBanner.style.opacity = '0';
      setTimeout(() => { warmupBanner.style.display = 'none'; warmupBanner.style.opacity = ''; }, 260);
    } else if (warmupBanner) {
      warmupBanner.style.display = 'none';
    }
  };
  // Any successful api response means the sidecar warmed up — hide the banner.
  // overviewStats is what loadHeroAndStats calls first; pre-fire it solo so
  // the banner reflects real readiness rather than the slowest slot.
  api.overviewStats().then(hideWarmup).catch(hideWarmup);

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
  loadProductsCard(root);
  loadWeeklyDeltas(root);
  loadBetsSummary(root);
  loadTopOpportunities(root);

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
    api.overviewStats().catch(() => ({})),
  ]);
  const tRes = settled[0].status === 'fulfilled' ? settled[0].value : [];
  const sRes = settled[1].status === 'fulfilled' ? settled[1].value : {};
  topics = Array.isArray(tRes) ? tRes : [];
  // Rust overview_stats unwraps the single-row SQL result to a plain object.
  // Tolerate both shapes (array-of-rows from older builds, object from current)
  // so the stat grid never silently shows zeros when the backend is fine.
  if (Array.isArray(sRes)) stats = sRes[0] || {};
  else if (sRes && typeof sRes === 'object') stats = sRes;
  else stats = {};

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
  if (!cached) setHTMLIfChanged(body, `<div class="empty-state">${skelInline('Loading chart…')}</div>`);
  try {
    const rows = await api.runQuery(
      `SELECT substr(started_at,1,10) AS day, count(*) AS n \
       FROM fetches \
       WHERE substr(started_at,1,10) >= date('now','-${momentumRange} days') \
       GROUP BY substr(started_at,1,10) ORDER BY day ASC`
    );
    setHTMLIfChanged(body, momentumChart(Array.isArray(rows) ? rows : [], momentumRange));
    // Cache per-range so the 30/90/1Y toggle also benefits.
    const prev = readDashCache()?.momentumByRange || {};
    writeDashCache({ momentumByRange: { ...prev, [momentumRange]: rows || [] } });
  } catch (e) {
    if (!cached) {
      setHTMLIfChanged(body, `<div class="empty-state">error loading chart: ${esc(e?.message || e)}</div>`);
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
        setHTMLIfChanged(feed, `<div class="empty-state" style="padding:24px">no activity yet — start a topic to see fetches land here</div>`);
      }
      writeDashCache({ activity: [] });
      return;
    }
    const html = rows.slice(0, 8).map(activityItem).join('');
    if (setHTMLIfChanged(feed, html)) window.refreshIcons?.();
    writeDashCache({ activity: rows });
  } catch (e) {
    if (!hadCache) {
      setHTMLIfChanged(feed, `<div class="empty-state" style="padding:24px">error: ${esc(e?.message || e)}</div>`);
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
  if (!slot) return; // not on home — e.g. delete/undo refreshed #main-content from another route
  const subtitle = root.querySelector('#topics-subtitle');
  if (subtitle) {
    subtitle.textContent = `${topics.length} active ${topics.length === 1 ? 'project' : 'projects'}`;
  }

  if (!topics.length) {
    // Phase 6 — replace bland empty with 5 quick-start chips for <30s first Minto.
    const quickstarts = [
      'AI coding assistants', 'sleep tracking apps', 'no-code website builders',
      'meditation apps', 'resume builders',
    ];
    slot.innerHTML = `
      <div class="empty-big">
        <h3>Let's find your first opportunity</h3>
        <p>Pick a problem space below — Gap Map pulls Reddit + HN + App Store + Play Store + arXiv in one run, then synthesizes a Minto-structured brief.</p>
        <div class="quick-start-chips">
          ${quickstarts.map(q => `<button class="quick-start-chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
        </div>
        <div style="margin-top:18px">
          <button class="btn btn-primary icon-btn" id="empty-new-topic"><i data-lucide="plus"></i> Start a custom topic</button>
        </div>
      </div>`;
    slot.querySelector('#empty-new-topic')?.addEventListener('click', () => window.gapmapOpenNewTopic?.());
    slot.querySelectorAll('.quick-start-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const q = btn.dataset.q;
        if (!q) return;
        location.hash = `#/collect/${encodeURIComponent(q)}`;
      });
    });
    window.refreshIcons?.();
    return;
  }

  const gridHtml = `<section class="topic-grid">${topics.slice(0, 8).map((t, i) => topicTile(t, i)).join('')}</section>`;
  const changed = setHTMLIfChanged(slot, gridHtml);
  if (!changed) return;          // identical grid — leave existing handlers in place
  slot.querySelectorAll('.topic-tile').forEach(el => {
    el.addEventListener('click', () => { location.hash = el.dataset.href; });
    // T1.1: right-click on a topic tile → context menu with Delete + Re-collect.
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const href = el.dataset.href || '';
      const topic = normalizeTopicLabel(safeDecodeTopicSlug(href.replace('#/topic/', '')));
      if (!topic) return;
      showTopicContextMenu(e.clientX, e.clientY, topic);
    });
  });
}

// T1.1: tile context menu — Delete (type-to-confirm) + Re-collect.
function showTopicContextMenu(x, y, topic) {
  // Remove any existing menu first
  document.querySelector('.home-topic-ctx-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'home-topic-ctx-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:1000;
    background:var(--surface-1,#FFFDF7);border:1px solid var(--border-soft,#EADFC8);
    border-radius:8px;padding:4px;min-width:200px;box-shadow:0 6px 20px rgba(0,0,0,0.1)`;
  menu.innerHTML = `
    <button class="ctx-open"   style="display:flex;width:100%;gap:8px;padding:8px 10px;border:0;background:transparent;text-align:left;cursor:pointer;border-radius:4px;font-family:inherit">
      <i data-lucide="external-link"></i><span>Open topic</span>
    </button>
    <button class="ctx-recol"  style="display:flex;width:100%;gap:8px;padding:8px 10px;border:0;background:transparent;text-align:left;cursor:pointer;border-radius:4px;font-family:inherit">
      <i data-lucide="refresh-cw"></i><span>Re-collect fresh data</span>
    </button>
    <button class="ctx-merge"  style="display:flex;width:100%;gap:8px;padding:8px 10px;border:0;background:transparent;text-align:left;cursor:pointer;border-radius:4px;font-family:inherit">
      <i data-lucide="git-merge"></i><span>Merge into…</span>
    </button>
    <div style="height:1px;background:var(--border-soft,#EADFC8);margin:4px 0"></div>
    <button class="ctx-delete" style="display:flex;width:100%;gap:8px;padding:8px 10px;border:0;background:transparent;text-align:left;cursor:pointer;border-radius:4px;font-family:inherit;color:#B84747">
      <i data-lucide="trash-2"></i><span>Delete (soft, 7-day undo)</span>
    </button>
  `;
  document.body.appendChild(menu);
  window.refreshIcons?.();
  const close = () => menu.remove();
  menu.querySelector('.ctx-open').onclick = () => {
    location.hash = `#/topic/${encodeURIComponent(topic)}`; close();
  };
  menu.querySelector('.ctx-recol').onclick = () => {
    location.hash = `#/collect/${encodeURIComponent(topic)}`;
    setTimeout(() => window.dispatchEvent(new CustomEvent('gapmap:start-collect',
      { detail: { topic, aggressive: true } })), 100);
    close();
  };
  menu.querySelector('.ctx-merge').onclick = () => {
    close();
    openMergeModal(topic);
  };
  menu.querySelector('.ctx-delete').onclick = async () => {
    close();
    const { confirmDestructiveAction } = await import('../lib/deleteConfirm.js');
    const ok = await confirmDestructiveAction({
      title: `Delete topic "${topic}"?`,
      body: 'Soft-deleted — recoverable for 7 days from Settings → Trash.',
      matchText: topic, confirmLabel: 'Delete topic', confirmDanger: true,
      hint: `type the topic name to confirm`,
    });
    if (!ok) return;
    try {
      await api.deleteTopic(topic);
      const t = document.createElement('div');
      t.className = 'toast toast-success';
      t.style.cssText = 'display:flex;align-items:center;gap:12px';
      t.innerHTML = `🗑 "${esc(topic)}" moved to trash <button class="btn btn-xs btn-primary" id="undo-home">Undo</button>`;
      document.body.appendChild(t);
      let undone = false;
      t.querySelector('#undo-home').onclick = async () => {
        undone = true;
        try { await api.restoreTopic(topic); t.remove(); } catch {}
        // Re-render the topic grid
        const root = document.querySelector('#main-content') || document;
        loadTopicGrid(root);
      };
      setTimeout(() => { if (!undone) t.remove(); }, 10000);
      // Immediate grid refresh — row is hidden by list_topics right away.
      const root = document.querySelector('#main-content') || document;
      loadTopicGrid(root);
    } catch (err) {
      alert(`Delete failed: ${err?.message || err}`);
    }
  };
  // Close on outside click or Escape
  const outside = (e) => { if (!menu.contains(e.target)) { close(); document.removeEventListener('click', outside); } };
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  setTimeout(() => {
    document.addEventListener('click', outside);
    document.addEventListener('keydown', onKey);
  }, 0);
}

async function loadActiveCollect(root) {
  const slot = root.querySelector('#active-collect-slot');
  if (!slot) return;

  let lastTopic = '';
  let lastWasRunning = false;

  const tick = async () => {
    if (!document.body.contains(slot)) return; // DOM unmounted
    try {
      // Primary source: Rust's ActiveCollects map is keyed by topic and is
      // authoritative about what `start_collect` calls are live. Fall back
      // to the fetches-table heuristic only if the Rust map is empty (e.g.
      // after an app restart that killed the Tauri side but left the sidecar
      // still streaming to stdout — unlikely but not impossible).
      let activeTopic = '';
      let activeStartedSecs = 0;
      try {
        const active = await api.activeCollects();
        if (active && typeof active === 'object') {
          const keys = Object.keys(active);
          if (keys.length > 0) {
            activeTopic = keys[0];
            activeStartedSecs = Number(active[activeTopic]) || 0;
          }
        }
      } catch {
        // Rust command failed — fall through to DB-based detection.
      }

      const rows = activeTopic
        ? null
        : await api.runQuery(
            `SELECT kind, params_json, started_at FROM fetches \
             WHERE ended_at IS NULL \
             ORDER BY started_at DESC LIMIT 1`
          );
      const running = !!activeTopic || (Array.isArray(rows) && rows.length > 0);
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
      let topic, kind, since;
      if (activeTopic) {
        topic = activeTopic;
        kind = 'collecting…';
        // activeStartedSecs is Unix epoch seconds from Rust SystemTime.
        const startedIso = new Date(activeStartedSecs * 1000).toISOString();
        since = timeAgo(startedIso);
      } else {
        const row = rows[0];
        let params = {};
        try { params = JSON.parse(row.params_json || '{}'); } catch {}
        topic = params.topic || '';
        kind = row.kind || '…';
        since = timeAgo(row.started_at);
      }
      // Only re-render when the row or topic actually changes — avoids
      // losing focus on other parts of the page every poll.
      const same = lastWasRunning && topic === lastTopic;
      if (!same) {
        slot.innerHTML = `
          <div class="active-collect-banner">
            <div class="pulse-dot"></div>
            <div class="acb-body" role="button" tabindex="0" title="Click to view progress">
              <b>Collecting${topic ? ` "${esc(topic)}"` : ''}…</b>
              <span>step: ${esc(kind)} · started ${esc(since)}</span>
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
          if (!(await confirmModal(`Stop ${label}? Partial results stay in the corpus — you can Rerun anytime.`))) return;
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
        if (span) span.textContent = `step: ${kind} · started ${since}`;
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
    <div class="topics-page">
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
      <div class="filter-bar topics-toolbar">
        <input id="topics-filter" type="search" autocomplete="off" class="topics-field topics-field--pill topics-field--search" placeholder="Search topics…" />
        <select id="topics-sort" class="topics-field topics-field--pill" aria-label="Sort topics">
          <option value="updated_desc">Latest activity</option>
          <option value="posts_desc">Most posts</option>
          <option value="pains_desc">Most painpoints</option>
          <option value="name_asc">Name A-Z</option>
        </select>
        <select id="topics-filter-status" class="topics-field topics-field--pill" aria-label="Filter by corpus">
          <option value="all">All</option>
          <option value="with_posts">With posts</option>
          <option value="with_pains">With painpoints</option>
          <option value="with_sources">With sources</option>
        </select>
        <select id="topics-page-size" class="topics-field topics-field--pill" aria-label="Topics per page">
          <option value="12">12 / page</option>
          <option value="24" selected>24 / page</option>
          <option value="48">48 / page</option>
        </select>
        <button class="btn btn-primary btn-sm icon-btn" id="topics-new"><i data-lucide="plus"></i> New topic</button>
      </div>
    </div>
    <div class="card topics-quick-card">
      <div class="topics-quick-row">
        <input id="topics-quick-create" type="text" class="topics-field topics-field--grow" placeholder="Quick create — e.g. Bloomberg NSE" />
        <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="topics-quick-open"><i data-lucide="sparkles"></i> Open in creator</button>
        <button class="btn btn-primary btn-sm icon-btn" id="topics-quick-create-btn"><i data-lucide="plus"></i> Create</button>
      </div>
      <p class="topics-quick-tip">Press Enter for a fast path. Duplicates are checked in the creator flow.</p>
    </div>
    <div id="topics-grid-slot">${skelGrid(6, { lines: 2 })}</div>
    <div id="topics-pagination" class="topics-pagination" aria-live="polite"></div>
    </div>
  `;
  root.querySelector('#topics-new').onclick = () => window.gapmapOpenNewTopic?.();
  root.querySelector('#topics-bell').onclick = () => { location.hash = '#/activity'; };
  root.querySelector('#topics-avatar').onclick = () => { location.hash = '#/settings'; };
  window.refreshIcons?.();

  const slot = root.querySelector('#topics-grid-slot');
  const paginationEl = root.querySelector('#topics-pagination');
  const countEl = root.querySelector('#topics-count');
  const filterInput = root.querySelector('#topics-filter');
  const sortSelect = root.querySelector('#topics-sort');
  const statusSelect = root.querySelector('#topics-filter-status');
  const pageSizeSelect = root.querySelector('#topics-page-size');
  const quickCreateInput = root.querySelector('#topics-quick-create');
  const quickCreateBtn = root.querySelector('#topics-quick-create-btn');
  const quickOpenBtn = root.querySelector('#topics-quick-open');

  const normalizeTopicInput = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const openCreateModalPrefilled = (topicName) => {
    window.gapmapOpenNewTopic?.();
    if (!topicName) return;
    setTimeout(() => {
      const input = document.getElementById('new-topic-input');
      if (!input) return;
      input.value = topicName;
      input.focus();
      input.select?.();
    }, 80);
  };

  let topics = [];
  let filtered = [];
  let page = 1;
  let pageSize = Number(pageSizeSelect.value) || 24;
  let lastGridHtml = '';
  let lastPagerHtml = '';

  try {
    const r = await api.listTopics();
    topics = (Array.isArray(r) ? r : []).map((t) => ({
      ...t,
      _topicNorm: (t.topic || '').toLowerCase(),
    }));
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
    paginationEl.innerHTML = '';
    window.refreshIcons?.();
    return;
  }

  const sortRows = (rows) => {
    const key = sortSelect.value;
    const out = rows.slice();
    if (key === 'name_asc') out.sort((a, b) => (a._topicNorm || '').localeCompare(b._topicNorm || ''));
    else if (key === 'posts_desc') out.sort((a, b) => (b.posts || 0) - (a.posts || 0));
    else if (key === 'pains_desc') out.sort((a, b) => (b.painpoints || 0) - (a.painpoints || 0));
    else out.sort((a, b) => (new Date(b.last_collect_at || 0).getTime() || 0) - (new Date(a.last_collect_at || 0).getTime() || 0));
    return out;
  };

  const applyFilters = () => {
    const q = filterInput.value.trim().toLowerCase();
    const status = statusSelect.value;
    const base = topics.filter((t) => {
      if (q && !t._topicNorm.includes(q)) return false;
      if (status === 'with_posts' && !(t.posts > 0)) return false;
      if (status === 'with_pains' && !(t.painpoints > 0)) return false;
      if (status === 'with_sources' && !(t.sources > 0)) return false;
      return true;
    });
    filtered = sortRows(base);
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (page > totalPages) page = totalPages;
  };

  const renderPagination = () => {
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const from = total === 0 ? 0 : ((page - 1) * pageSize) + 1;
    const to = Math.min(total, page * pageSize);
    const html = `
      <span class="topics-pagination-meta">${from}-${to} of ${total}</span>
      <div class="topics-pagination-controls">
        <button class="btn btn-ghost btn-sm btn-bordered" id="topics-page-prev" ${page <= 1 ? 'disabled' : ''}>Prev</button>
        <span class="topics-pagination-meta">Page ${page} / ${totalPages}</span>
        <button class="btn btn-ghost btn-sm btn-bordered" id="topics-page-next" ${page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
    `;
    if (html !== lastPagerHtml) {
      paginationEl.innerHTML = html;
      lastPagerHtml = html;
    }
    paginationEl.querySelector('#topics-page-prev')?.addEventListener('click', () => {
      if (page <= 1) return;
      page -= 1;
      paint();
    });
    paginationEl.querySelector('#topics-page-next')?.addEventListener('click', () => {
      const max = Math.max(1, Math.ceil(filtered.length / pageSize));
      if (page >= max) return;
      page += 1;
      paint();
    });
  };

  const paint = () => {
    applyFilters();
    countEl.textContent = `${filtered.length} ${filtered.length === 1 ? 'topic' : 'topics'}`;
    if (!filtered.length) {
      const filtering = filterInput.value.trim().length > 0 || statusSelect.value !== 'all';
      slot.innerHTML = filtering
        ? `<div class="empty-big">
             <h3>No matching topics</h3>
             <p>Try changing filters, or start a new one.</p>
             <button class="btn btn-primary icon-btn" id="topics-empty-new"><i data-lucide="plus"></i> Start new topic</button>
           </div>`
        : `<div class="empty-big">
             <h3>No topics yet</h3>
             <p>Start your first research topic to collect posts and surface painpoints + DIY workarounds.</p>
             <button class="btn btn-primary icon-btn" id="topics-empty-new"><i data-lucide="plus"></i> Start new topic</button>
           </div>`;
      slot.querySelector('#topics-empty-new')?.addEventListener('click', () => window.gapmapOpenNewTopic?.());
      paginationEl.innerHTML = '';
      lastPagerHtml = '';
      window.refreshIcons?.();
      return;
    }

    const start = (page - 1) * pageSize;
    const pageRows = filtered.slice(start, start + pageSize);
    const gridHtml = `<section class="topic-grid">${pageRows.map((t, i) => topicTile(t, i + start)).join('')}</section>`;
    if (gridHtml !== lastGridHtml) {
      setHTMLIfChanged(slot, gridHtml);
      lastGridHtml = gridHtml;
    }
    slot.querySelectorAll('.topic-tile').forEach(el => {
      el.addEventListener('click', () => { location.hash = el.dataset.href; });
    });
    renderPagination();
    window.refreshIcons?.();
  };

  paint();

  let filterDebounce = null;
  filterInput.addEventListener('input', () => {
    clearTimeout(filterDebounce);
    filterDebounce = setTimeout(() => {
      page = 1;
      paint();
    }, 120);
  });
  sortSelect.addEventListener('change', () => { page = 1; paint(); });
  statusSelect.addEventListener('change', () => { page = 1; paint(); });
  pageSizeSelect.addEventListener('change', () => {
    pageSize = Number(pageSizeSelect.value) || 24;
    page = 1;
    paint();
  });

  const submitQuickCreate = () => {
    const topic = normalizeTopicInput(quickCreateInput.value);
    if (!topic) {
      quickCreateInput.focus();
      return;
    }
    openCreateModalPrefilled(topic);
  };
  quickOpenBtn?.addEventListener('click', submitQuickCreate);
  quickCreateBtn?.addEventListener('click', submitQuickCreate);
  quickCreateInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitQuickCreate();
    }
  });
}

async function loadByokPrompt(root) {
  const slot = root.querySelector('#byok-prompt-slot');
  try {
    const s = await api.byokStatus();
    const anyReady =
      s?.anthropic?.set || s?.openai?.set || s?.openrouter?.set ||
      s?.groq?.set || s?.deepseek?.set || s?.mistral?.set || s?.google?.set ||
      s?.nvidia?.set ||
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

// ─── Phase 4 — Weekly delta card ────────────────────────────────────
// Renders "What's changed this week" on the dashboard when any topic
// has recorded deltas in the last 7 days. Silent if none. The biggest
// single retention hook we have — reason for users to open on Monday.
async function loadWeeklyDeltas(root) {
  const slot = root.querySelector('#weekly-deltas-slot');
  if (!slot) return;
  let deltas;
  try {
    deltas = await api.monitorDeltas(null, 5, 7);
  } catch {
    slot.innerHTML = '';
    return;
  }
  // Filter to runs that actually changed something (first-runs show N adds;
  // subsequent runs with 0 magnitude are silent)
  const meaningful = (deltas || []).filter(r => {
    const d = r?.delta || {};
    return d.is_first_run
      ? (d.findings_added || []).length > 0
      : (d.total_change_magnitude || 0) >= 1;
  });
  if (!meaningful.length) { slot.innerHTML = ''; return; }

  const rows = meaningful.map(r => {
    const d = r.delta || {};
    const t = r.topic;
    const encoded = encodeURIComponent(t);
    const added = (d.findings_added || []).length;
    const removed = (d.findings_removed || []).length;
    const scored = (d.score_changes || []).length;
    const compAdded = (d.competitors_added || []).length;
    const newPapers = d.new_academic_papers || 0;
    const parts = [];
    if (added)     parts.push(`<b>${added}</b> new finding${added === 1 ? '' : 's'}`);
    if (scored)    parts.push(`<b>${scored}</b> score change${scored === 1 ? '' : 's'}`);
    if (compAdded) parts.push(`<b>${compAdded}</b> new competitor${compAdded === 1 ? '' : 's'}`);
    if (newPapers) parts.push(`<b>${newPapers}</b> new paper${newPapers === 1 ? '' : 's'}`);
    if (removed)   parts.push(`<b>${removed}</b> dropped`);
    const summary = parts.length ? parts.join(' · ') : 'refreshed';
    const when = r.run_at ? timeAgo(r.run_at) : '';
    const firstChip = d.is_first_run
      ? '<span class="delta-chip delta-chip-new">first run</span>' : '';
    return `
      <a class="delta-row" href="#/topic/${encoded}" title="Open topic">
        <div class="delta-row-head">
          <b>${esc(t)}</b>
          ${firstChip}
        </div>
        <div class="delta-row-body muted">${summary}</div>
        <div class="delta-row-foot muted">${esc(when)}</div>
      </a>
    `;
  }).join('');

  slot.innerHTML = `
    <section class="card weekly-deltas-card">
      <div class="card-head">
        <div>
          <h3>
            <i data-lucide="activity"></i>
            What's changed this week
          </h3>
          <p class="muted">${meaningful.length} topic${meaningful.length === 1 ? '' : 's'} with fresh signals · last 7 days</p>
        </div>
        <div class="filter-bar">
          <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-dismiss-deltas" title="Hide this week">
            <i data-lucide="x"></i>
          </button>
        </div>
      </div>
      <div class="delta-rows">${rows}</div>
    </section>
  `;
  slot.querySelector('#btn-dismiss-deltas')?.addEventListener('click', () => {
    slot.innerHTML = '';
  });
  window.refreshIcons?.();
}

// ─── Phase 3 — Active bets summary card on Dashboard ────────────────
// Shows "My bets" aggregated across all topics when any tracked
// hypothesis exists. Reads hypothesisStats({topic:null}) — the global
// cross-topic count bucket.
async function loadBetsSummary(root) {
  const slot = root.querySelector('#bets-summary-slot');
  if (!slot) return;
  let resp;
  try {
    resp = await api.hypothesisStats(null);
  } catch {
    slot.innerHTML = '';
    return;
  }
  const stats = (resp && resp.stats) || {};
  const total = Object.values(stats).reduce((a, b) => a + (b || 0), 0);
  if (total === 0) { slot.innerHTML = ''; return; }

  // Fetch recent running/drafted bets so the card can surface the
  // most-recently-updated one as a "pick up where you left off" nudge.
  let recent = [];
  try {
    recent = await api.hypothesisList(null, null, false);
  } catch { recent = []; }
  recent = (recent || []).slice(0, 3);

  const statEntries = [
    { key: 'running',     icon: '🏃', color: '#1F5C99' },
    { key: 'validated',   icon: '✓',  color: '#1A7A4F' },
    { key: 'invalidated', icon: '✗',  color: '#B84747' },
    { key: 'paused',      icon: '⏸',  color: '#C47A14' },
    { key: 'draft',       icon: '📝', color: '#8A8178' },
  ].filter(s => (stats[s.key] || 0) > 0);

  const pills = statEntries.map(s =>
    `<span class="bet-summary-pill" style="background:${s.color}22;color:${s.color}">
       ${s.icon} <b>${stats[s.key]}</b> ${esc(s.key)}
     </span>`
  ).join('');

  const rows = recent.map(r => {
    const card = r.card || {};
    const title = card.finding_title || card.experiences || '(untitled)';
    const encoded = encodeURIComponent(r.topic);
    return `
      <a class="bet-summary-row" href="#/topic/${encoded}" title="Open ${esc(r.topic)}'s Bets tab">
        <span class="bet-summary-state state-${esc(r.status)}">${esc(r.status)}</span>
        <span class="bet-summary-title">${esc(title)}</span>
        <span class="bet-summary-topic muted">${esc(r.topic)}</span>
      </a>
    `;
  }).join('');

  slot.innerHTML = `
    <section class="card bets-summary-card">
      <div class="card-head">
        <div>
          <h3>
            <i data-lucide="target"></i>
            My bets
          </h3>
          <p class="muted">${total} tracked hypothes${total === 1 ? 'is' : 'es'} across all topics</p>
        </div>
        <div class="bet-summary-pills">${pills}</div>
      </div>
      ${rows ? `<div class="bet-summary-rows">${rows}</div>` : ''}
    </section>
  `;
  window.refreshIcons?.();
}

// ─── Phase 5 — Cross-topic top-opportunities card on Dashboard ───────
// Leaderboard of highest Ulwick-scored findings across every topic the
// user has synthesized. Silent until ≥1 finding exists globally.
async function loadTopOpportunities(root) {
  const slot = root.querySelector('#top-opportunities-slot');
  if (!slot) return;
  let rows = [];
  try {
    rows = await api.topOpportunities(8, 0);
  } catch { slot.innerHTML = ''; return; }
  if (!Array.isArray(rows) || rows.length === 0) { slot.innerHTML = ''; return; }

  const scoreClass = (s) => s >= 15 ? 'score-high' : s >= 10 ? 'score-mid' : 'score-low';
  const items = rows.map(r => {
    const encoded = encodeURIComponent(r.topic);
    const kind = { painpoint: '🔥', feature_wish: '💡', workaround: '🛠' }[r.kind] || '•';
    const cls = scoreClass(r.opportunity_score || 0);
    const tri = { strong: '🟢', moderate: '🟡', narrow: '🔴' }[r.triangulation_strength] || '';
    return `
      <a class="top-opp-row" href="#/topic/${encoded}">
        <span class="top-opp-score ${cls}"><b>${(r.opportunity_score || 0).toFixed(1)}</b></span>
        <span class="top-opp-kind">${kind}</span>
        <span class="top-opp-title">${esc(r.title || '(untitled)')}</span>
        <span class="top-opp-topic muted">${esc(r.topic)}</span>
        <span class="top-opp-tri" title="triangulation: ${esc(r.triangulation_strength || '')}">${tri}</span>
      </a>
    `;
  }).join('');

  slot.innerHTML = `
    <section class="card top-opps-card">
      <div class="card-head">
        <div>
          <h3><i data-lucide="trophy"></i> Top opportunities across all topics</h3>
          <p class="muted">Ranked by Ulwick opportunity score · click to open the topic</p>
        </div>
      </div>
      <div class="top-opps-rows">${items}</div>
    </section>
  `;
  window.refreshIcons?.();
}

// ─── Dual-Mode Pivot — "Your products" Dashboard card ────────────────
// Silent when user has no products. When ≥1, shows each registered product
// with open-signal count + last-sweep freshness + click-to-open.
async function loadProductsCard(root) {
  const slot = root.querySelector('#products-card-slot');
  if (!slot) return;
  let resp;
  try {
    resp = await api.productList(true);
  } catch { slot.innerHTML = ''; return; }
  const products = resp?.products || [];
  if (!products.length) { slot.innerHTML = ''; return; }

  const tile = (p) => {
    const open = p.open_signal_count || 0;
    const last = p.last_swept_at ? new Date(p.last_swept_at).toLocaleDateString() : 'never';
    return `
      <a class="prod-card-row" href="#/product/${encodeURIComponent(p.id)}">
        <div class="prod-card-title">
          <b>${esc(p.name)}</b>
          ${open > 0 ? `<span class="prod-open-pill">${open} open</span>` : ''}
        </div>
        <div class="muted prod-card-meta">
          ${p.competitor_count || 0} competitors · last sweep: ${esc(last)}
        </div>
      </a>
    `;
  };

  slot.innerHTML = `
    <section class="card products-home-card">
      <div class="card-head">
        <div>
          <h3><i data-lucide="package"></i> Your products <span class="muted">(${products.length})</span></h3>
          <p class="muted">Daily-use monitoring surface · click a product to open its dashboard</p>
        </div>
        <a class="pill" href="#/products" style="text-decoration:none;color:inherit">See all →</a>
      </div>
      <div class="prod-card-grid">${products.slice(0, 6).map(tile).join('')}</div>
    </section>
  `;
  window.refreshIcons?.();
}
