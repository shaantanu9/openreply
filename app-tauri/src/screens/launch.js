// Go-to-Market Launch Brief screen.
//
// Per-topic deliverable that answers four questions in one place:
//   1. WHO is the target audience?  (ICP personas + demographics)
//   2. WHERE should we launch?      (channel ranking + best post-time)
//   3. WHAT do they need?           (MVP feature list, pricing, PMF/NPS)
//   4. HOW do we sequence the launch? (3-step plan with metrics)
//
// Routes:
//   #/launch              → topic picker
//   #/launch/<topic>      → cached brief (or empty-state with "Generate" CTA)
//
// Design: matches Home/Topics — slash crumbs + topbar-spacer,
// stat-grid headline, two-col blocks, section-head transitions,
// btn-primary / btn-ghost-bordered.
import { api, esc } from '../api.js';
import { renderAnalyzingState } from '../lib/analyzingLoader.js';
import { skelDetail } from '../lib/skeleton.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Domain stages for the single blocking LLM-augmented launch-brief build
// (api.launchBrief with {llm:true}). The whole brief lands at once — hero-only
// loader. Offline mode (deterministic SQL) is sub-second and keeps plain text.
const LAUNCH_STAGES = [
  'Mining the corpus for this topic…',
  'Inferring ICP personas & demographics…',
  'Ranking launch channels by fit…',
  'Synthesizing market requirements & pricing…',
  'Writing the launch sequence…',
  'Almost done — assembling the brief…',
];

function topicFromHash() {
  const m = (location.hash || '').match(/^#\/launch\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function fmtAge(d) {
  if (!d) return '—';
  if (d.age_range) return d.age_range;
  if ((d.ages || []).length) return d.ages.slice(0, 3).join(', ');
  return '—';
}

function fmtGeo(d) {
  if (!d) return '—';
  if (d.geography_text) return d.geography_text;
  if ((d.geography || []).length) return d.geography.slice(0, 3).join(', ');
  return '—';
}

function topChannelLabel(channels) {
  const c = (channels || [])[0];
  if (!c) return '—';
  return c.type === 'reddit' ? `r/${c.name}` : (c.name || c.type);
}

function timeLabel(t) {
  if (!t || t.hour_utc == null) return '—';
  const h = t.hour_utc;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${t.day_of_week || ''} ${h12} ${ampm} UTC`.trim();
}

function statGrid(brief) {
  const a = brief?.audience || {};
  const d = a.demographics || {};
  const persona = (a.icp_personas || [])[0]?.name || '—';
  return `
    <section class="stat-grid">
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon mint"><i data-lucide="users"></i></div>
        </div>
        <div class="stat-num" style="font-size:18px">${esc(persona)}</div>
        <div class="stat-label">Top ICP persona${a.persona_count ? ` of ${a.persona_count}` : ''}</div>
      </div>
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon sky"><i data-lucide="globe"></i></div>
        </div>
        <div class="stat-num" style="font-size:16px">${esc(fmtGeo(d))}</div>
        <div class="stat-label">Geography signals</div>
      </div>
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon lavender"><i data-lucide="rocket"></i></div>
        </div>
        <div class="stat-num" style="font-size:16px">${esc(topChannelLabel(brief?.launch_channels))}</div>
        <div class="stat-label">Top launch channel</div>
      </div>
      <div class="stat-card">
        <div class="stat-head">
          <div class="stat-icon peach"><i data-lucide="clock"></i></div>
        </div>
        <div class="stat-num" style="font-size:16px">${esc(timeLabel(brief?.best_post_time))}</div>
        <div class="stat-label">Best post window</div>
      </div>
    </section>
  `;
}

function personasCard(brief) {
  const ps = brief?.audience?.icp_personas || [];
  if (!ps.length) {
    return `
      <div class="card">
        <div class="card-head">
          <div><h3>ICP personas</h3><p>None extracted yet</p></div>
        </div>
        <div class="card-body">
          <p class="muted" style="margin:0;font-size:13px">
            Build empathy maps or capture interviews first — those feed
            this section deterministically.
          </p>
        </div>
      </div>
    `;
  }
  const rows = ps.map(p => `
    <li style="padding:12px 0;border-bottom:1px dashed var(--line)">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">
        <strong style="font-size:14px">${esc(p.name)}</strong>
        <span class="muted" style="font-size:11px">${p.signals_count || 0} signals · ${esc(p.source || '—')}</span>
      </div>
      ${p.one_liner ? `<div style="font-size:12.5px;margin-top:4px">${esc(p.one_liner)}</div>` : ''}
      ${p.jtbd ? `<blockquote style="border-left:3px solid var(--ink-3);padding:4px 10px;margin:6px 0 0;font-size:12px;color:var(--ink-2);font-style:italic">JTBD: ${esc(p.jtbd)}</blockquote>` : ''}
    </li>
  `).join('');
  return `
    <div class="card">
      <div class="card-head">
        <div><h3>ICP personas</h3><p>Top ${ps.length} from corpus + interviews + LLM</p></div>
      </div>
      <div class="card-body">
        <ul style="list-style:none;padding:0;margin:0">${rows}</ul>
      </div>
    </div>
  `;
}

function demographicsCard(brief) {
  const d = brief?.audience?.demographics || {};
  const occText = d.occupations_text || (d.occupations || []).slice(0, 6).join(', ') || '—';
  const incomeText = d.income_bracket || '—';
  const sample = d.samples ? `n=${d.samples} posts` : '—';
  return `
    <div class="card">
      <div class="card-head">
        <div><h3>Demographics</h3><p>Inferred from corpus mentions${brief?.llm_augmented ? ' + LLM' : ''}</p></div>
      </div>
      <div class="card-body">
        <div style="display:grid;gap:10px;font-size:13px">
          <div><strong>Age range</strong> · ${esc(fmtAge(d))}</div>
          <div><strong>Geography</strong> · ${esc(fmtGeo(d))}</div>
          <div><strong>Occupations</strong> · ${esc(occText)}</div>
          <div><strong>Income bracket</strong> · ${esc(incomeText)}</div>
          <div class="muted" style="font-size:11px;margin-top:4px">Corpus sample: ${esc(sample)}</div>
        </div>
      </div>
    </div>
  `;
}

function channelCard(c) {
  const url = c.type === 'reddit'
    ? `https://reddit.com/r/${encodeURIComponent(c.name)}`
    : null;
  const head = url
    ? `<h3><a href="${url}" target="_blank" rel="noopener">${c.type === 'reddit' ? `r/${esc(c.name)}` : esc(c.name)}</a></h3>`
    : `<h3>${esc(c.name)}</h3>`;
  const fit = (c.fit_score != null) ? `<span class="pill">Fit ${c.fit_score}/10</span>` : '';
  const authors = (c.top_authors || []).slice(0, 3)
    .map(a => `<span class="pill">u/${esc(a)}</span>`).join(' ');
  return `
    <div class="card">
      <div class="card-head">
        <div>
          ${head}
          <p>${c.type} · ${c.posts} posts · avg score ${c.avg_score} · engagement ${c.total_engagement}</p>
        </div>
        ${fit}
      </div>
      <div class="card-body">
        ${c.fit_rationale ? `<p style="font-size:12.5px;line-height:1.5;margin:0 0 8px">${esc(c.fit_rationale)}</p>` : ''}
        ${authors ? `<div style="display:flex;flex-wrap:wrap;gap:4px"><span class="muted" style="font-size:11px;align-self:center">Top authors:</span> ${authors}</div>` : '<div class="muted" style="font-size:11px">No identified top authors.</div>'}
      </div>
    </div>
  `;
}

function externalChannels(brief) {
  const ext = brief?.external_channels || [];
  if (!ext.length) return '';
  return `
    <div class="card">
      <div class="card-head">
        <div><h3>External channels to consider</h3><p>LLM-suggested platforms beyond your corpus sources</p></div>
      </div>
      <div class="card-body">
        <ul style="list-style:none;padding:0;margin:0;display:grid;gap:10px">
          ${ext.map(x => `
            <li style="padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2)">
              <strong style="font-size:13px">${esc(x.name || '—')}</strong>
              ${x.why ? `<div style="font-size:12px;color:var(--ink-2);margin-top:4px">${esc(x.why)}</div>` : ''}
            </li>
          `).join('')}
        </ul>
      </div>
    </div>
  `;
}

function mvpCard(brief) {
  const feats = brief?.market_requirements?.mvp_features || [];
  if (!feats.length) {
    return `
      <div class="card">
        <div class="card-head">
          <div><h3>MVP feature list</h3><p>None ranked yet</p></div>
        </div>
        <div class="card-body">
          <p class="muted" style="font-size:13px;margin:0">
            Run RICE scoring on the topic's interventions first
            (OST → Re-run RICE).
          </p>
        </div>
      </div>
    `;
  }
  const rows = feats.map((f, i) => `
    <tr>
      <td style="padding:6px 8px">${i + 1}</td>
      <td style="padding:6px 8px;font-size:13px">${esc(f.label)}</td>
      <td style="padding:6px 8px;font-family:'DM Mono',monospace;font-size:12px">${f.rice_score != null ? f.rice_score.toFixed(1) : '—'}</td>
      <td style="padding:6px 8px"><span class="ost-chip kano-${esc(f.kano || 'indifferent')}" style="font-size:10px">${esc(f.kano || '—')}</span></td>
      <td style="padding:6px 8px"><span class="ost-chip moscow-${esc(f.moscow || 'could')}" style="font-size:10px">${esc(f.moscow || '—')}</span></td>
    </tr>
  `).join('');
  return `
    <div class="card">
      <div class="card-head">
        <div><h3>MVP feature list</h3><p>Ranked by RICE · Kano + MoSCoW chips</p></div>
      </div>
      <div class="card-body" style="padding:0">
        <table style="width:100%;border-collapse:collapse;font-size:12.5px">
          <thead style="background:var(--surface-2)">
            <tr>
              <th style="text-align:left;padding:8px;font-weight:700;font-size:11px;color:var(--ink-3);letter-spacing:0.5px">#</th>
              <th style="text-align:left;padding:8px;font-weight:700;font-size:11px;color:var(--ink-3);letter-spacing:0.5px">Feature</th>
              <th style="text-align:left;padding:8px;font-weight:700;font-size:11px;color:var(--ink-3);letter-spacing:0.5px">RICE</th>
              <th style="text-align:left;padding:8px;font-weight:700;font-size:11px;color:var(--ink-3);letter-spacing:0.5px">Kano</th>
              <th style="text-align:left;padding:8px;font-weight:700;font-size:11px;color:var(--ink-3);letter-spacing:0.5px">MoSCoW</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function pricingCard(brief) {
  const mr = brief?.market_requirements || {};
  const v = mr.pricing;
  const pmf = mr.pmf;
  const nps = mr.nps;
  const f = (x) => (x == null) ? '—' : Number(x).toFixed(2);
  return `
    <div class="card">
      <div class="card-head">
        <div><h3>Pricing & demand validation</h3><p>From VW survey, PMF, NPS</p></div>
      </div>
      <div class="card-body">
        ${v ? `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:12px">
            <div><div class="muted" style="font-size:10.5px;letter-spacing:1px;font-weight:700">OPP</div><div style="font-size:18px;font-weight:700">${f(v.opp)}</div></div>
            <div><div class="muted" style="font-size:10.5px;letter-spacing:1px;font-weight:700">IPP</div><div style="font-size:18px;font-weight:700">${f(v.ipp)}</div></div>
            <div><div class="muted" style="font-size:10.5px;letter-spacing:1px;font-weight:700">PMC</div><div style="font-size:18px;font-weight:700">${f(v.pmc)}</div></div>
            <div><div class="muted" style="font-size:10.5px;letter-spacing:1px;font-weight:700">PME</div><div style="font-size:18px;font-weight:700">${f(v.pme)}</div></div>
          </div>
          <p class="muted" style="font-size:11px;margin:0">Van Westendorp · n=${v.n}. Acceptable range PMC..PME; OPP minimises resistance.</p>
        ` : `<p class="muted" style="font-size:13px;margin:0 0 10px">No Van Westendorp data yet — collect ≥30 responses on the Pricing tab.</p>`}
        ${pmf ? `<div style="margin-top:10px"><strong style="font-size:12.5px">PMF:</strong> ${pmf.pct_very_disappointed.toFixed(1)}% very disappointed (n=${pmf.n_total}) ${pmf.threshold_met ? '<span class="pmf-met">✓ ≥40%</span>' : '<span class="pmf-unmet">⚠ <40%</span>'}</div>` : ''}
        ${nps ? `<div style="margin-top:6px"><strong style="font-size:12.5px">NPS:</strong> ${nps.nps.toFixed(1)} (n=${nps.n}) · ${nps.promoters} promoters / ${nps.detractors} detractors</div>` : ''}
        ${mr.positioning_statement ? `<blockquote style="border-left:3px solid #1d4ed8;padding:8px 12px;margin:14px 0 0;background:rgba(29,78,216,0.05);border-radius:0 6px 6px 0;font-size:13px;font-style:italic">${esc(mr.positioning_statement)}</blockquote>` : ''}
      </div>
    </div>
  `;
}

function launchSequence(brief) {
  const seq = brief?.launch_sequence || [];
  if (!seq.length) return '';
  return `
    <div class="section-head" style="margin-top:18px">
      <div><h2>Launch sequence</h2><p>${seq.length}-step plan with target channels and metrics</p></div>
    </div>
    <ol style="list-style:none;padding:0;margin:0;display:grid;gap:10px">
      ${seq.map(s => `
        <li class="card">
          <div class="card-head">
            <div>
              <h3>Step ${s.step || '?'} · ${esc(s.action || '')}</h3>
              <p>${esc(s.eta || 'no ETA')}</p>
            </div>
          </div>
          <div class="card-body">
            ${(s.target_channels || []).length ? `<div style="margin-bottom:8px">${(s.target_channels || []).map(c => `<span class="pill">${esc(c)}</span> `).join('')}</div>` : ''}
            ${s.success_metric ? `<div style="font-size:12.5px"><strong>Success metric:</strong> ${esc(s.success_metric)}</div>` : ''}
          </div>
        </li>
      `).join('')}
    </ol>
  `;
}

// Friendly, actionable copy per LLM error class (set by launch.py).
const LLM_ERROR_COPY = {
  rate_limit: 'The AI provider is rate-limited right now. The brief below is the deterministic version — retry in a minute for AI-refined personas & sequence.',
  llm_key:    'No working AI provider key is configured. Add one in Settings → Keys, then retry. Showing the deterministic brief meanwhile.',
  llm_model:  'The configured AI model is unavailable. Pick a different model in Settings → Keys, then retry. Showing the deterministic brief meanwhile.',
  network:    'Couldn’t reach the AI provider (network/timeout). The brief below is deterministic — retry once you’re back online.',
  llm:        'AI augmentation failed, so the brief below is the deterministic version. Retry to refine personas, demographics & the launch sequence.',
};

function llmErrorBanner(brief) {
  if (!brief?.llm_error) return '';
  const cls = brief.llm_error_class || 'llm';
  const msg = LLM_ERROR_COPY[cls] || LLM_ERROR_COPY.llm;
  return `
    <div class="card" style="border-left:3px solid #d97706;background:rgba(217,119,6,0.06);margin-bottom:14px">
      <div class="card-body" style="display:flex;gap:12px;align-items:flex-start">
        <i data-lucide="triangle-alert" style="color:#d97706;flex:0 0 auto;margin-top:2px"></i>
        <div style="flex:1">
          <strong style="font-size:13px">AI augmentation unavailable (${esc(cls)})</strong>
          <div style="font-size:12.5px;color:var(--ink-2);margin-top:3px">${esc(msg)}</div>
          <div class="muted" style="font-size:11px;margin-top:4px">${esc(String(brief.llm_error).slice(0, 180))}</div>
        </div>
        <button class="btn btn-primary btn-sm icon-btn" id="launch-retry-llm" style="flex:0 0 auto">
          <i data-lucide="refresh-cw"></i> Retry with AI
        </button>
      </div>
    </div>
  `;
}

function renderShell(topic, brief) {
  const stale = brief?.cached
    ? `Cached ${new Date(brief.generated_at).toLocaleString()}`
    : (brief?.generated_at ? `Generated ${new Date(brief.generated_at).toLocaleString()}` : '');
  const llmTag = brief?.llm_augmented
    ? '<span class="pill">LLM ✓</span>'
    : (brief?.llm_error
        ? '<span class="pill" style="background:rgba(217,119,6,0.12);color:#b45309">AI failed</span>'
        : '<span class="pill">deterministic</span>');

  return `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/launch">Launch &amp; GTM</a> /
        <strong>${esc(topic)}</strong>
      </div>
      <div class="topbar-spacer"></div>
      ${llmTag}
      <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="launch-regen-no-llm" title="Re-build offline (no LLM)">
        <i data-lucide="rotate-ccw"></i> Refresh
      </button>
      <button class="btn btn-primary btn-sm icon-btn" id="launch-regen" title="Re-build with LLM augmentation">
        <i data-lucide="sparkles"></i> Re-generate
      </button>
    </header>

    <div class="muted" style="font-size:11.5px;margin-bottom:14px">${esc(stale)}</div>

    ${statGrid(brief)}

    <div class="section-head">
      <div><h2>Target audience</h2><p>Who this product is for</p></div>
    </div>
    <section class="two-col">
      ${personasCard(brief)}
      ${demographicsCard(brief)}
    </section>

    <div class="section-head" style="margin-top:18px">
      <div><h2>Where to launch</h2><p>${(brief?.launch_channels || []).length} channels ranked by engagement</p></div>
    </div>
    <section class="topic-grid">
      ${(brief?.launch_channels || []).map(channelCard).join('') || '<div class="empty-state">No channels detected yet — collect this topic first.</div>'}
    </section>

    ${externalChannels(brief)}

    <div class="section-head" style="margin-top:18px">
      <div><h2>Market requirements</h2><p>What to ship and how to price</p></div>
    </div>
    <section class="two-col">
      ${mvpCard(brief)}
      ${pricingCard(brief)}
    </section>

    ${launchSequence(brief)}
  `;
}

async function generateAndRender(root, topic, { llm = true } = {}) {
  // routeGen guard — JS analog of Flutter context.mounted
  const myGen = root.dataset.routeGen;
  const alive = () => root.dataset.routeGen === myGen && root.isConnected;
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs"><a href="#/launch">Launch &amp; GTM</a> / <strong>${esc(topic)}</strong></div>
      <div class="topbar-spacer"></div>
    </header>
    <div id="launch-gen-mount"></div>
  `;
  const mount = $('#launch-gen-mount', root);
  // LLM augmentation is the 5+ s blocking call — show the full-bleed alive
  // loader. Offline mode is deterministic SQL (sub-second) — keep plain text.
  let stop = null;
  if (llm) {
    stop = renderAnalyzingState(mount, {
      headline: 'Synthesizing the launch brief', stages: LAUNCH_STAGES,
      medianRuntimeSec: 40, etaText: 'typically 30–90 seconds', skeletonCount: 4,
    });
  } else {
    mount.innerHTML = `<div class="empty-state" style="padding:40px">Building deterministic brief from cached data…</div>`;
  }
  let brief;
  try {
    brief = await api.launchBrief(topic, { llm });
  } catch (e) {
    if (!alive()) return;
    stop?.();
    root.innerHTML = `<div class="empty-big"><h3>Couldn't generate brief</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  stop?.({ snapToComplete: true });
  if (!alive()) return;
  if (brief?.timed_out) {
    root.innerHTML = `<div class="empty-big"><h3>Brief generation timed out</h3><p>${esc(brief.error || 'try again or switch to offline mode')}</p>
      <button class="btn btn-ghost btn-sm btn-bordered" id="launch-fallback">Build offline (no LLM)</button></div>`;
    $('#launch-fallback', root)?.addEventListener('click', () => generateAndRender(root, topic, { llm: false }));
    return;
  }
  if (brief?.ok === false) {
    root.innerHTML = `<div class="empty-big"><h3>Couldn't build brief</h3><p>${esc(brief.error || 'unknown error')}</p></div>`;
    return;
  }
  root.innerHTML = renderShell(topic, brief);
  window.refreshIcons?.();
  wireActions(root, topic);
}

function wireActions(root, topic) {
  $('#launch-regen', root)?.addEventListener('click', () => generateAndRender(root, topic, { llm: true }));
  $('#launch-regen-no-llm', root)?.addEventListener('click', () => generateAndRender(root, topic, { llm: false }));
}

async function renderTopicLaunch(root, topic) {
  // routeGen guard — JS analog of Flutter context.mounted
  const myGen = root.dataset.routeGen;
  const alive = () => root.dataset.routeGen === myGen && root.isConnected;
  root.innerHTML = skelDetail({ paras: 6 });
  let brief;
  try {
    brief = await api.launchBriefGet(topic);
  } catch (e) {
    brief = { ok: false, error: String(e?.message || e) };
  }
  if (!alive()) return;
  if (brief?.ok && brief.cached) {
    root.innerHTML = renderShell(topic, brief);
    window.refreshIcons?.();
    wireActions(root, topic);
    return;
  }
  // Nothing cached — show "Generate" CTA so the user opts in.
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs"><a href="#/launch">Launch &amp; GTM</a> / <strong>${esc(topic)}</strong></div>
      <div class="topbar-spacer"></div>
    </header>
    <div class="empty-big">
      <h3>No launch brief yet for ${esc(topic)}</h3>
      <p>The brief combines your corpus, surveys, interviews, and findings
      into a per-topic Go-to-Market deliverable: target audience,
      demographics, where to launch, and market requirements.</p>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:14px">
        <button class="btn btn-ghost btn-sm btn-bordered" id="launch-build-offline">Build offline</button>
        <button class="btn btn-primary btn-sm icon-btn" id="launch-build-llm">
          <i data-lucide="sparkles"></i> Build with AI
        </button>
      </div>
      <p class="muted" style="font-size:11px;margin-top:14px">
        Offline mode uses deterministic SQL only — no LLM key required.
        AI mode adds personas, demographics inference, channel fit,
        positioning, and a 3-step launch sequence.
      </p>
    </div>
  `;
  window.refreshIcons?.();
  $('#launch-build-llm', root)?.addEventListener('click', () => generateAndRender(root, topic, { llm: true }));
  $('#launch-build-offline', root)?.addEventListener('click', () => generateAndRender(root, topic, { llm: false }));
}

async function renderPicker(root) {
  // routeGen guard — JS analog of Flutter context.mounted
  const myGen = root.dataset.routeGen;
  const alive = () => root.dataset.routeGen === myGen && root.isConnected;
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Launch &amp; GTM</strong></div>
      <div class="topbar-spacer"></div>
      <span class="muted" style="font-size:12px">Audience · Demographics · Channels · Market requirements</span>
    </header>
    <div id="launch-picker-mount">${skelDetail({ paras: 4 })}</div>
  `;
  let topics = [];
  try { topics = await api.listTopics(); } catch (e) {
    if (!alive()) return;
    $('#launch-picker-mount', root).innerHTML =
      `<div class="empty-big"><h3>Couldn't list topics</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  if (!alive()) return;
  if (!topics?.length) {
    $('#launch-picker-mount', root).innerHTML = `
      <div class="empty-big">
        <h3>No topics yet</h3>
        <p>Collect a topic first — the launch brief mines its corpus.</p>
        <a class="btn btn-primary btn-sm" href="#/topics">Open Topics</a>
      </div>`;
    return;
  }
  const opts = topics.map(t => `<option value="${esc(t.topic)}">${esc(t.topic)} · ${t.posts || 0} posts</option>`).join('');
  $('#launch-picker-mount', root).innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <h3>Open a Launch Brief</h3>
          <p>Per-topic Go-to-Market deliverable — audience, channels, MVP, pricing, sequence</p>
        </div>
      </div>
      <div class="card-body">
        <p class="muted" style="font-size:13px;line-height:1.6;margin:0 0 14px">
          The brief synthesizes everything you've already collected for the topic:
          posts, empathy maps, interviews, PMF / NPS / Van Westendorp surveys,
          and OST findings. LLM augmentation refines the audience and writes
          the launch sequence.
        </p>
        <div class="row">
          <select id="launch-topic-pick" style="flex:1;min-width:240px">${opts}</select>
          <button class="btn btn-primary btn-sm" id="launch-go">Open →</button>
        </div>
      </div>
    </div>
  `;
  $('#launch-go', root)?.addEventListener('click', () => {
    const t = $('#launch-topic-pick', root).value;
    if (t) location.hash = `#/launch/${encodeURIComponent(t)}`;
  });
}

export async function renderLaunch(root) {
  const topic = topicFromHash();
  if (topic) return renderTopicLaunch(root, topic);
  return renderPicker(root);
}
