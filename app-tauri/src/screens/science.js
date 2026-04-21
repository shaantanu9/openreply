// Science & methodology — what we collect, what each source contributes,
// and the research backing the gap-finding approach.
// Pulls live DB counts where relevant so the numbers reflect your actual corpus.

import { api, esc } from '../api.js';

const SOURCES = [
  {
    key: 'reddit',
    label: 'Reddit',
    signal: 'lived experience',
    biasTag: 'self-selection, community norms',
    why: 'Long-form complaints, DIY workarounds, emotional cues. People describe problems in their own words — the "jobs to be done" source of truth.',
    citation: 'Christensen, Hall, Dillon (2016). Competing Against Luck.',
  },
  {
    key: 'hackernews',
    label: 'HackerNews',
    signal: 'dev + tech sentiment',
    biasTag: 'HN-bubble, engineer perspective',
    why: 'Early signal on dev tools, infrastructure, B2B SaaS. Strong technical scrutiny — where launches get picked apart.',
    citation: 'Greenberg et al. (2015). News velocity & topic momentum on HN.',
  },
  {
    key: 'appstore',
    label: 'App Store',
    signal: 'UX pain from real users',
    biasTag: 'extreme reviews over-represented',
    why: '1–2★ reviews surface exact feature gaps, bugs, missing workflows. Our CHRONIC classifier loves low-star reviews.',
    citation: 'Pagano & Maalej (2013). User feedback in the app store.',
  },
  {
    key: 'playstore',
    label: 'Play Store',
    signal: 'UX pain (Android subset)',
    biasTag: 'Android-skewed demographics',
    why: 'Complements App Store — Android users skew different geos & device tiers. Often reveals hardware / compatibility gaps.',
    citation: 'Chen et al. (2014). AR-Miner: mining informative reviews.',
  },
  {
    key: 'arxiv',
    label: 'arXiv',
    signal: 'academic lens',
    biasTag: 'pre-peer-review noise',
    why: 'What researchers think of the problem — often reframes the painpoint academically, surfaces forgotten prior art.',
    citation: 'N/A — ArXiv metadata directly.',
  },
  {
    key: 'scholar',
    label: 'Google Scholar',
    signal: 'peer-reviewed framing',
    biasTag: 'citation gaming, pay-walled abstracts',
    why: 'Established research on the topic — grounds claims, provides formal definitions, and surfaces the academic consensus.',
    citation: 'Martín-Martín et al. (2021). Google Scholar coverage analysis.',
  },
  {
    key: 'github',
    label: 'GitHub',
    signal: 'existing solutions & issues',
    biasTag: 'OSS-biased; issues skew power users',
    why: 'Competitor software, open source implementations, and the real bug reports from their users. Open issues = real painpoints still unresolved.',
    citation: 'Bissyandé et al. (2013). Got issues? Who cares about it?',
  },
  {
    key: 'news',
    label: 'News (Google News)',
    signal: 'narrative + framing',
    biasTag: 'press-release amplification',
    why: 'How mainstream media frames the topic — legitimizes a problem space and surfaces big-player moves.',
    citation: 'Boydstun (2013). Making the News — news attention dynamics.',
  },
  {
    key: 'wikipedia',
    label: 'Wikipedia',
    signal: 'canonical definition',
    biasTag: 'edit-war bias on contested topics',
    why: 'Neutral baseline — what is this thing, what are its subdomains, what\'s the history? Useful for topic taxonomy.',
    citation: 'Giles (2005). Internet encyclopaedias go head to head (Nature).',
  },
  {
    key: 'pytrends',
    label: 'Google Trends',
    signal: 'search momentum',
    biasTag: 'relative only — no absolute volumes',
    why: 'Is interest growing, flat, or fading? Critical for the Kano temporal classification and for spotting EMERGING tiers.',
    citation: 'Choi & Varian (2012). Predicting the present with Google Trends.',
  },
];

export async function renderScience(root) {
  // Capture the route generation that this render belongs to, so late-arriving
  // async results can bail out instead of writing to a stale DOM.
  const myGen = root.dataset.routeGen;
  const stillHere = () => root.dataset.routeGen === myGen;
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Science</strong></div>
      <div class="topbar-spacer"></div>
    </header>

    <div class="section-head">
      <div>
        <h2>What we collect · why it works</h2>
        <p>The research methodology + what each source contributes to the gap map.</p>
      </div>
    </div>

    <section class="card" style="margin-bottom:18px">
      <div class="card-head">
        <div>
          <h3>📐 The methodology in one paragraph</h3>
          <p>Why Gap Map isn't just scraping Reddit</p>
        </div>
      </div>
      <div style="padding:4px 22px 22px;color:var(--ink-2);font-size:var(--fs-15);line-height:1.75">
        <p>Every topic you collect runs through a four-stage pipeline:
        <b>(1) multi-source fetch</b> from up to 10 independent corpora,
        <b>(2) structural graph build</b> that links every post to subs, threads, and authors,
        <b>(3) LLM-driven semantic extraction</b> that tags painpoints / features / competitors / DIY workarounds — <i>with citation back to the source post</i>, and
        <b>(4) temporal classification</b> that splits painpoints into CHRONIC / EMERGING / FADING tiers using a fixed pullpush cutoff.</p>
        <p>The scoring rubric follows <b>Guest, Bunce & Johnson (2006)</b> — a painpoint is "chronic" only when ≥12 pieces of evidence are observed across ≥2 independent sources. This is the qualitative research threshold for saturation. Anything below it is labeled "emerging" or "candidate".</p>
        <p>The UI uses <b>Shneiderman's mantra</b>: <i>overview first, zoom and filter, then details-on-demand</i>. Dashboard → topic tile → gap map → individual citation. You never have to guess where a claim came from.</p>
      </div>
    </section>

    <div class="section-head">
      <div>
        <h2>Data sources</h2>
        <p id="science-sub">Loading live row counts…</p>
      </div>
    </div>

    <div class="science-src-list" id="science-src-list">
      <div class="empty-state">loading…</div>
    </div>

    <div class="section-head" style="margin-top:22px">
      <div><h2>Pillars</h2><p>The four ideas Gap Map is built on.</p></div>
    </div>

    <section class="science-pillars">
      <div class="settings-card">
        <h4><i data-lucide="flask-conical"></i> Saturation math (Guest et al. 2006)</h4>
        <p>A painpoint earns the CHRONIC label only after <b>≥12 evidence items</b> across <b>≥2 independent sources</b>. Below that it's "emerging" — worth watching but not bankable. This threshold comes from the qualitative-research saturation literature and is the reason Gap Map fetches from 10 sources, not one.</p>
        <p style="color:var(--ink-3);font-size:var(--fs-13);margin-top:8px"><em>Guest, Bunce & Johnson (2006). How Many Interviews Are Enough? — Field Methods, 18(1).</em></p>
      </div>

      <div class="settings-card">
        <h4><i data-lucide="clock"></i> Temporal tiers (pullpush 2025-05-19 cutoff)</h4>
        <p>Pullpush's historical index froze in May 2025. We exploit this as a natural experiment:</p>
        <ul style="font-size:var(--fs-13);color:var(--ink-2);padding-left:22px;margin-top:4px;line-height:1.75">
          <li><b>CHRONIC</b> — painpoint present in both pre-May-2025 and post-May-2025 corpora</li>
          <li><b>EMERGING</b> — only post-May-2025 — genuinely new pain</li>
          <li><b>FADING</b> — only pre-May-2025 — already solved or abandoned</li>
        </ul>
        <p style="color:var(--ink-3);font-size:var(--fs-13);margin-top:8px"><em>Inspired by Kano's attractive-vs-must-be dynamics model.</em></p>
      </div>

      <div class="settings-card">
        <h4><i data-lucide="share-2"></i> Shneiderman's mantra</h4>
        <p>Overview first → zoom + filter → details on demand. Every screen in Gap Map follows this:</p>
        <ul style="font-size:var(--fs-13);color:var(--ink-2);padding-left:22px;margin-top:4px;line-height:1.75">
          <li><b>Overview</b> — dashboard hero + topic tiles</li>
          <li><b>Zoom</b> — topic detail with filtered views</li>
          <li><b>Details</b> — click a node → jump to exact post citation</li>
        </ul>
        <p style="color:var(--ink-3);font-size:var(--fs-13);margin-top:8px"><em>Shneiderman (1996). The eyes have it: a task by data type taxonomy for information visualizations.</em></p>
      </div>

      <div class="settings-card">
        <h4><i data-lucide="bar-chart-3"></i> Tufte information density</h4>
        <p>Every chart earns its pixels. No 3D pies, no decorative gradients. The sparklines in the dashboard show momentum in 60 px; the gap-map uses force layout because spatial proximity encodes semantic proximity — nothing is decorative.</p>
        <p style="color:var(--ink-3);font-size:var(--fs-13);margin-top:8px"><em>Tufte (2001). The Visual Display of Quantitative Information.</em></p>
      </div>
    </section>

    <div class="section-head" style="margin-top:22px">
      <div><h2>What gets stored locally</h2><p>Everything Gap Map knows lives in SQLite on your machine.</p></div>
    </div>

    <section class="card" style="margin-bottom:18px">
      <div style="padding:4px 22px 22px">
        <table class="db-rows" style="font-size:var(--fs-13)">
          <thead><tr><th>Table</th><th>What it holds</th></tr></thead>
          <tbody>
            <tr><td><code>posts</code></td><td>Raw fetched posts from every source. Content, metadata, timestamp, source_type.</td></tr>
            <tr><td><code>topic_posts</code></td><td>Join table: which posts are tagged to which research topic.</td></tr>
            <tr><td><code>graph_nodes</code></td><td>Every entity in the gap map — subs, threads, people, painpoints, features, products, workarounds.</td></tr>
            <tr><td><code>graph_edges</code></td><td>Relationships (<code>posted_in</code>, <code>authored</code>, <code>evidenced_by</code>, <code>wished_in</code>, etc.).</td></tr>
            <tr><td><code>fetches</code></td><td>Every pipeline invocation — duration, row count, errors. Visible on the Activity page.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn btn-primary btn-sm" id="btn-science-db">Open database →</button>
      <button class="btn btn-ghost btn-sm btn-bordered" id="btn-science-activity">View activity log →</button>
    </div>
  `;
  window.refreshIcons?.();

  root.querySelector('#btn-science-db').onclick = () => { location.hash = '#/database'; };
  root.querySelector('#btn-science-activity').onclick = () => { location.hash = '#/activity'; };

  // Fetch per-source row counts.
  try {
    const res = await api.runQuery(
      `SELECT coalesce(source_type,'reddit') AS source, count(*) AS n \
       FROM posts GROUP BY coalesce(source_type,'reddit')`
    );
    if (!stillHere()) return; // user navigated away while sidecar was working
    const counts = {};
    if (Array.isArray(res)) res.forEach(r => { counts[r.source] = r.n; });
    const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);

    const list = root.querySelector('#science-src-list');
    const sub = root.querySelector('#science-sub');
    if (!list || !sub) return; // DOM has been replaced; abort silently
    sub.textContent =
      `${totalRows.toLocaleString()} posts indexed across ${Object.keys(counts).length} sources`;

    list.innerHTML = SOURCES.map(s => {
      const n = counts[s.key] || 0;
      const active = n > 0;
      return `
        <div class="science-src-card ${active ? 'active' : 'dim'}">
          <div class="science-src-head">
            <div>
              <h4>${esc(s.label)}</h4>
              <p class="science-src-signal">${esc(s.signal)}</p>
            </div>
            <div class="science-src-count">
              <b>${n.toLocaleString()}</b>
              <span>posts</span>
            </div>
          </div>
          <p class="science-src-why">${esc(s.why)}</p>
          <div class="science-src-foot">
            <span class="science-bias">⚠ ${esc(s.biasTag)}</span>
            <span class="science-cite">${esc(s.citation)}</span>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    if (!stillHere()) return;
    const list = root.querySelector('#science-src-list');
    if (list) list.innerHTML =
      `<div class="empty-state">Error loading counts: ${esc(e?.message || e)}</div>`;
  }
}
