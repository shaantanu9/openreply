// Audience Personas screen — clusters of REAL authors from the corpus.
//
// Routes:
//   #/audience              → topic picker
//   #/audience/<topic>      → personas grid (or empty-state with Build CTA)
//
// Design: matches Home/Topics — slash crumbs + topbar-spacer,
// stat-grid headline, topic-grid of cluster cards, two-col blocks,
// btn-primary / btn-ghost-bordered.
//
// Each cluster card carries citation links to actual Reddit/HN/etc.
// posts so users can verify the persona is grounded.
import { api, esc } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function topicFromHash() {
  const m = (location.hash || '').match(/^#\/audience\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

// ── Deterministic avatar from cluster ID — gradient seed pinned per
//    cluster so the same cluster shows the same colour across reloads.
const AV_GRADIENTS = [
  ['#FFE4CD', '#FFC196'],
  ['#EFE7FB', '#C9B6F2'],
  ['#E1F2EA', '#A8DCC4'],
  ['#E4F0FA', '#B5D4F0'],
  ['#FBE3E6', '#F4B6BD'],
  ['#FBF1D4', '#F0D78A'],
  ['#FFE9D6', '#FF8C42'],
];

function avatarHtml(cid) {
  const [a, b] = AV_GRADIENTS[(cid + 7) % AV_GRADIENTS.length];
  return `<div class="aud-avatar" style="background:linear-gradient(135deg,${a} 0%,${b} 100%)">
    ${cid + 1}
  </div>`;
}

function tightnessChip(t) {
  if (t == null) return '';
  const cls = t >= 0.5 ? 'trend-up' : t >= 0.3 ? 'trend-flat' : 'trend-down';
  return `<span class="stat-trend ${cls}" title="Cluster tightness — silhouette score">tightness ${t.toFixed(2)}</span>`;
}

function postLinkUrl(postId) {
  // Reddit ids are non-prefixed. Most of our corpus is Reddit; for HN
  // / arxiv / etc. we don't construct links (those rows store full
  // URLs in posts.url which the row exemplar carries directly).
  if (!postId) return null;
  if (postId.startsWith('hn_') || postId.startsWith('arxiv') || postId.startsWith('pubmed') || postId.startsWith('gh_')) {
    return null;
  }
  return `https://www.reddit.com/comments/${encodeURIComponent(postId)}`;
}

function authorLinkUrl(name) {
  if (!name) return null;
  // Heuristic — corpus authors that look like Reddit usernames link
  // out; HN / arxiv author strings stay non-linked.
  if (/^[A-Za-z0-9_-]{3,20}$/.test(name)) {
    return `https://www.reddit.com/user/${encodeURIComponent(name)}`;
  }
  return null;
}

// Mini 7×24 SVG heatmap.
function heatmapSvg(grid) {
  if (!grid || !grid.length) return '';
  let max = 0;
  for (const row of grid) for (const v of row) if (v > max) max = v;
  if (max === 0) return '<div class="muted" style="font-size:11px">No timestamped activity yet.</div>';
  const cell = 10, gap = 1;
  const w = 24 * (cell + gap), h = 7 * (cell + gap);
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  let cells = '';
  for (let d = 0; d < 7; d++) {
    for (let h2 = 0; h2 < 24; h2++) {
      const v = grid[d][h2] || 0;
      const a = max ? Math.min(1, v / max) : 0;
      const x = h2 * (cell + gap), y = d * (cell + gap);
      cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="rgba(190,18,60,${(0.05 + a * 0.85).toFixed(3)})" rx="1"/>`;
    }
  }
  let labels = '';
  for (let d = 0; d < 7; d++) {
    labels += `<text x="-4" y="${d * (cell + gap) + cell - 1}" font-size="8" text-anchor="end" fill="var(--ink-3)">${days[d]}</text>`;
  }
  return `<svg viewBox="-12 0 ${w + 12} ${h}" width="100%" height="${h + 4}" style="overflow:visible;display:block;max-width:280px">${cells}${labels}</svg>`;
}

function quadrantList(items, cls) {
  if (!items?.length) return `<li class="muted" style="font-style:italic">(none extracted)</li>`;
  return items.slice(0, 4).map(s => `<li class="${cls}">${esc(s)}</li>`).join('');
}

function demographicsChips(demo, p) {
  const chips = [];
  if (p.age_range) chips.push(`<span class="pill">age ${esc(p.age_range)}</span>`);
  if (p.country) chips.push(`<span class="pill">${esc(p.country)}</span>`);
  if (p.profession) chips.push(`<span class="pill">${esc(p.profession)}</span>`);
  // Deterministic signal chips when LLM-inferred fields are missing.
  if (!p.age_range && (demo.ages || []).length) {
    chips.push(`<span class="pill">${esc(demo.ages.slice(0, 2).join(' · '))}</span>`);
  }
  if (!p.country && (demo.geography || []).length) {
    chips.push(`<span class="pill">${esc(demo.geography.slice(0, 2).join(' · '))}</span>`);
  }
  if (!p.profession && (demo.occupations || []).length) {
    chips.push(`<span class="pill">${esc(demo.occupations.slice(0, 2).join(' · '))}</span>`);
  }
  return chips.join(' ');
}

function topSubsList(subs) {
  if (!subs?.length) return '<span class="muted" style="font-size:11px">No subs yet</span>';
  return subs.slice(0, 4).map(s => {
    const label = s.type === 'reddit' ? `r/${s.name}` : s.name;
    const url = s.type === 'reddit' ? `https://reddit.com/r/${encodeURIComponent(s.name)}` : null;
    return url
      ? `<a href="${url}" target="_blank" rel="noopener" class="pill">${esc(label)} · ${s.posts}</a>`
      : `<span class="pill">${esc(label)} · ${s.posts}</span>`;
  }).join(' ');
}

function membersList(members) {
  if (!members?.length) return '';
  const top = members.slice(0, 8);
  const more = members.length - top.length;
  const links = top.map(m => {
    const url = authorLinkUrl(m);
    return url
      ? `<a href="${url}" target="_blank" rel="noopener" class="pill">u/${esc(m)}</a>`
      : `<span class="pill">${esc(m)}</span>`;
  }).join(' ');
  const moreTag = more > 0 ? `<span class="pill">+${more} more</span>` : '';
  return `${links} ${moreTag}`;
}

function exemplarPostBlock(p) {
  const ex = p.exemplar_post;
  if (!ex && !p.exemplar_post_ids?.length) return '';
  const id = ex?.id || p.exemplar_post_ids?.[0];
  const url = (ex?.url || ex?.permalink) || postLinkUrl(id);
  const title = (ex?.title || '').slice(0, 200) || `(post ${id})`;
  return `
    <div style="margin-top:10px;padding:10px 12px;background:var(--surface-2);border:1px solid var(--line);border-radius:8px">
      <div class="muted" style="font-size:10.5px;letter-spacing:1px;font-weight:700;margin-bottom:4px">EXEMPLAR POST</div>
      <div style="font-size:13px;line-height:1.45">
        ${url
          ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(title)}</a>`
          : esc(title)}
      </div>
      ${ex?.author ? `<div class="muted" style="font-size:11px;margin-top:4px">by ${esc(ex.author)}${ex.score != null ? ` · ${ex.score} pts` : ''}${ex.num_comments != null ? ` · ${ex.num_comments} comments` : ''}</div>` : ''}
    </div>
  `;
}

function personaCard(p, topic) {
  const demo = p.demographics || {};
  const swh = p.says_wants_hates || {};
  const cid = p.cluster_id;
  const llmTag = p.llm_augmented
    ? '<span class="pill">LLM ✓</span>'
    : '<span class="pill">deterministic</span>';
  const persona = p.persona ? esc(p.persona).replace(/\[(\w+)\]/g, (_m, id) => {
    const url = postLinkUrl(id);
    return url ? `<a href="${url}" target="_blank" rel="noopener" style="font-size:11px">[${esc(id)}]</a>` : `[${esc(id)}]`;
  }) : '';
  return `
    <article class="card aud-card" data-cid="${cid}">
      <div class="card-head" style="gap:14px">
        <div style="display:flex;gap:12px;align-items:center;flex:1;min-width:0">
          ${avatarHtml(cid)}
          <div style="min-width:0">
            <h3 style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.label || `Cluster ${cid + 1}`)}</h3>
            <p>${p.member_count || 0} authors · ${p.post_count || 0} posts</p>
          </div>
        </div>
        ${tightnessChip(p.tightness)}
      </div>
      <div class="card-body">
        ${p.bio ? `<p style="font-size:13px;line-height:1.55;margin:0 0 10px">${esc(p.bio)}</p>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
          ${demographicsChips(demo, p)}
          ${llmTag}
        </div>

        ${persona ? `
          <details style="margin-bottom:10px">
            <summary style="cursor:pointer;font-size:11.5px;color:var(--ink-3);font-weight:600;letter-spacing:0.5px">FULL PERSONA NARRATIVE</summary>
            <p style="font-size:13px;line-height:1.7;margin-top:8px;white-space:pre-wrap">${persona}</p>
          </details>
        ` : ''}

        ${p.personal_memory ? `
          <details style="margin-bottom:10px">
            <summary style="cursor:pointer;font-size:11.5px;color:var(--ink-3);font-weight:600;letter-spacing:0.5px">PERSONAL MEMORY (CITATIONS)</summary>
            <p style="font-size:12.5px;line-height:1.65;margin-top:8px;white-space:pre-wrap">${esc(p.personal_memory).replace(/\[(\w+)\]/g, (_m, id) => {
              const url = postLinkUrl(id);
              return url ? `<a href="${url}" target="_blank" rel="noopener">[${esc(id)}]</a>` : `[${esc(id)}]`;
            })}</p>
          </details>
        ` : ''}

        <div class="aud-quad-grid">
          <div class="aud-quad q-says">
            <div class="aud-quad-label">SAYS</div>
            <ul>${quadrantList(swh.says, '')}</ul>
          </div>
          <div class="aud-quad q-wants">
            <div class="aud-quad-label">WANTS</div>
            <ul>${quadrantList(swh.wants, '')}</ul>
          </div>
          <div class="aud-quad q-hates">
            <div class="aud-quad-label">HATES</div>
            <ul>${quadrantList(swh.hates, '')}</ul>
          </div>
        </div>

        <div style="margin-top:10px">
          <div class="muted" style="font-size:10.5px;letter-spacing:1px;font-weight:700;margin-bottom:4px">TOP SUBS / SOURCES</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${topSubsList(p.top_subs)}</div>
        </div>

        ${(p.vocab_signatures || []).length ? `
          <div style="margin-top:10px">
            <div class="muted" style="font-size:10.5px;letter-spacing:1px;font-weight:700;margin-bottom:4px">VOCAB SIGNATURES</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px">${p.vocab_signatures.slice(0, 12).map(v => `<span class="pill">${esc(v)}</span>`).join(' ')}</div>
          </div>` : ''}

        ${(p.interested_topics || []).length ? `
          <div style="margin-top:10px">
            <div class="muted" style="font-size:10.5px;letter-spacing:1px;font-weight:700;margin-bottom:4px">INTERESTED TOPICS</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px">${p.interested_topics.map(v => `<span class="pill">${esc(v)}</span>`).join(' ')}</div>
          </div>` : ''}

        <div style="margin-top:10px">
          <div class="muted" style="font-size:10.5px;letter-spacing:1px;font-weight:700;margin-bottom:4px">ACTIVITY HEATMAP (UTC, hr × dow)</div>
          ${heatmapSvg(p.activity_heatmap)}
        </div>

        ${exemplarPostBlock(p)}

        <details style="margin-top:10px">
          <summary style="cursor:pointer;font-size:11.5px;color:var(--ink-3);font-weight:600;letter-spacing:0.5px">MEMBERS (${p.member_count || (p.members || []).length})</summary>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">${membersList(p.members)}</div>
        </details>
      </div>
    </article>
  `;
}

function statGrid(personasResp) {
  const ps = personasResp?.personas || [];
  const total_members = ps.reduce((a, p) => a + (p.member_count || 0), 0);
  const total_posts   = ps.reduce((a, p) => a + (p.post_count || 0), 0);
  const tightest = ps.length ? Math.max(...ps.map(p => p.tightness || 0)) : 0;
  const llm = ps.some(p => p.llm_augmented);
  const trend = llm ? 'trend-up' : 'trend-flat';
  return `
    <section class="stat-grid">
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon mint"><i data-lucide="users"></i></div>
        </div>
        <div class="stat-num">${ps.length}</div>
        <div class="stat-label">Distinct personas</div>
      </div>
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon sky"><i data-lucide="user"></i></div>
        </div>
        <div class="stat-num">${total_members}</div>
        <div class="stat-label">Real authors clustered</div>
      </div>
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon lavender"><i data-lucide="message-square"></i></div>
        </div>
        <div class="stat-num">${total_posts}</div>
        <div class="stat-label">Backing posts</div>
      </div>
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon peach"><i data-lucide="target"></i></div>
          <div class="stat-trend ${trend}">${llm ? 'LLM' : 'offline'}</div>
        </div>
        <div class="stat-num">${tightest.toFixed(2)}</div>
        <div class="stat-label">Tightest cluster (silhouette)</div>
      </div>
    </section>
  `;
}

function renderShell(topic, resp) {
  const ps = resp?.personas || [];
  const generated = ps[0]?.generated_at
    ? `Generated ${new Date(ps[0].generated_at).toLocaleString()}`
    : '';
  const k = resp?.k != null ? `k=${resp.k}` : '';
  const sil = resp?.silhouette != null ? ` · silhouette ${resp.silhouette.toFixed(3)}` : '';
  return `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/audience">Audience</a> /
        <strong>${esc(topic)}</strong>
      </div>
      <div class="topbar-spacer"></div>
      <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="aud-rebuild-offline" title="Re-cluster without LLM">
        <i data-lucide="rotate-ccw"></i> Re-cluster
      </button>
      <button class="btn btn-primary btn-sm icon-btn" id="aud-rebuild" title="Re-cluster + re-write personas with LLM">
        <i data-lucide="sparkles"></i> Re-build with AI
      </button>
    </header>

    <div class="muted" style="font-size:11.5px;margin-bottom:14px">${esc(generated)}${generated && k ? ' · ' : ''}${esc(k)}${esc(sil)}</div>

    ${statGrid(resp)}

    <div class="section-head">
      <div>
        <h2>Personas grounded in your corpus</h2>
        <p>${ps.length} clusters from ${resp?.n_authors_clustered || ps.reduce((a, p) => a + (p.member_count || 0), 0)} real authors${(resp?.n_authors_total ?? null) != null ? ` (of ${resp.n_authors_total} total)` : ''}</p>
      </div>
    </div>

    <section class="topic-grid">
      ${ps.map(p => personaCard(p, topic)).join('') || '<div class="empty-state" style="padding:30px">No personas yet — click Re-build above.</div>'}
    </section>

    <div class="card" style="margin-top:18px">
      <div class="card-head">
        <div>
          <h3>How these were built</h3>
          <p>Pure feature engineering + optional LLM augmentation</p>
        </div>
      </div>
      <div class="card-body">
        <p class="muted" style="font-size:12.5px;line-height:1.6;margin:0">
          Authors with ≥3 posts in this topic are embedded with the
          ChromaDB MiniLM model (the same embedder the rest of the app
          uses), then clustered with k-means at k ∈ {3, 5, 7} — the k
          with the highest silhouette score wins. For each cluster we
          extract the top-engagement post, top-3 subs/sources,
          says/wants/hates clauses (cue-based regex), demographic
          keyword scan, vocab signatures (TF-IDF vs other clusters),
          and a 7×24 activity heatmap. Optional LLM augmentation makes
          one call per cluster to write the label + persona narrative
          + personal memory, with a hard constraint that every claim
          cite a specific post_id.
        </p>
      </div>
    </div>
  `;
}

function wireActions(root, topic) {
  $('#aud-rebuild', root)?.addEventListener('click', () => buildAndRender(root, topic, { llm: true }));
  $('#aud-rebuild-offline', root)?.addEventListener('click', () => buildAndRender(root, topic, { llm: false }));
}

async function buildAndRender(root, topic, { llm = true } = {}) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs"><a href="#/audience">Audience</a> / <strong>${esc(topic)}</strong></div>
      <div class="topbar-spacer"></div>
    </header>
    <div class="empty-state" style="padding:36px">${llm ? 'Clustering authors and writing personas — this can take 20–60s when LLM is on…' : 'Clustering authors (offline mode) — should be quick…'}</div>
  `;
  let resp;
  try {
    resp = await api.audiencePersonasBuild(topic, { llm });
  } catch (e) {
    root.innerHTML = `<div class="empty-big"><h3>Couldn't build audience</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  if (resp?.timed_out) {
    root.innerHTML = `<div class="empty-big"><h3>Build timed out</h3><p>${esc(resp.error || 'try again or use offline mode')}</p>
      <button class="btn btn-ghost btn-sm btn-bordered" id="aud-fallback">Build offline (no LLM)</button></div>`;
    $('#aud-fallback', root)?.addEventListener('click', () => buildAndRender(root, topic, { llm: false }));
    return;
  }
  if (resp?.ok === false) {
    root.innerHTML = `<div class="empty-big"><h3>Couldn't build audience</h3><p>${esc(resp.error || 'unknown error')}</p>
      <button class="btn btn-ghost btn-sm btn-bordered" id="aud-fallback">Try offline mode</button></div>`;
    $('#aud-fallback', root)?.addEventListener('click', () => buildAndRender(root, topic, { llm: false }));
    return;
  }
  root.innerHTML = renderShell(topic, resp);
  window.refreshIcons?.();
  wireActions(root, topic);
}

async function renderTopicAudience(root, topic) {
  root.innerHTML = `<div class="empty-state">Loading audience personas…</div>`;
  let resp;
  try {
    resp = await api.audiencePersonasGet(topic);
  } catch (e) {
    resp = { ok: false, error: String(e?.message || e), personas: [] };
  }
  if (resp?.ok && (resp.personas || []).length) {
    root.innerHTML = renderShell(topic, resp);
    window.refreshIcons?.();
    wireActions(root, topic);
    return;
  }
  // No cached personas — show CTA.
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs"><a href="#/audience">Audience</a> / <strong>${esc(topic)}</strong></div>
      <div class="topbar-spacer"></div>
    </header>
    <div class="empty-big">
      <h3>No audience clusters yet for ${esc(topic)}</h3>
      <p>We'll group your topic's real authors into ICP personas — one per
      cluster — backed by their actual posts. Every persona claim links
      back to a specific post you can verify.</p>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:14px">
        <button class="btn btn-ghost btn-sm btn-bordered" id="aud-build-offline">Cluster offline</button>
        <button class="btn btn-primary btn-sm icon-btn" id="aud-build-llm">
          <i data-lucide="sparkles"></i> Cluster &amp; write with AI
        </button>
      </div>
      <p class="muted" style="font-size:11px;margin-top:14px">
        Offline mode produces clusters + heatmaps + says/wants/hates from
        your corpus only — no LLM key needed. AI mode adds a written
        narrative + structured demographics for each cluster.
      </p>
    </div>
  `;
  window.refreshIcons?.();
  $('#aud-build-llm', root)?.addEventListener('click', () => buildAndRender(root, topic, { llm: true }));
  $('#aud-build-offline', root)?.addEventListener('click', () => buildAndRender(root, topic, { llm: false }));
}

async function renderPicker(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Audience</strong></div>
      <div class="topbar-spacer"></div>
      <span class="muted" style="font-size:12px">Real-user personas · clustered from your corpus</span>
    </header>
    <div id="aud-picker-mount"><div class="empty-state">loading…</div></div>
  `;
  let topics = [];
  try { topics = await api.listTopics(); } catch (e) {
    $('#aud-picker-mount', root).innerHTML = `<div class="empty-big"><h3>Couldn't list topics</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  if (!topics?.length) {
    $('#aud-picker-mount', root).innerHTML = `
      <div class="empty-big">
        <h3>No topics yet</h3>
        <p>Collect a topic first — clustering needs ≥4 authors with ≥3 posts each.</p>
        <a class="btn btn-primary btn-sm" href="#/topics">Open Topics</a>
      </div>`;
    return;
  }
  const opts = topics.map(t => `<option value="${esc(t.topic)}">${esc(t.topic)} · ${t.posts || 0} posts</option>`).join('');
  $('#aud-picker-mount', root).innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <h3>Open audience personas</h3>
          <p>Clustered from real authors, citation-backed</p>
        </div>
      </div>
      <div class="card-body">
        <p class="muted" style="font-size:13px;line-height:1.6;margin:0 0 14px">
          Pick a topic — we'll group your topic's real authors into 3–7 ICP
          personas, each backed by their actual posts. Replaces every
          LLM-imagined persona surface in the app.
        </p>
        <div class="row">
          <select id="aud-topic-pick" style="flex:1;min-width:240px">${opts}</select>
          <button class="btn btn-primary btn-sm" id="aud-go">Open →</button>
        </div>
      </div>
    </div>
  `;
  $('#aud-go', root)?.addEventListener('click', () => {
    const t = $('#aud-topic-pick', root).value;
    if (t) location.hash = `#/audience/${encodeURIComponent(t)}`;
  });
}

export async function renderAudience(root) {
  const topic = topicFromHash();
  if (topic) return renderTopicAudience(root, topic);
  return renderPicker(root);
}
