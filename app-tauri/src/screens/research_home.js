// Research Home — the front door in Research Mode.
//
// Lists the user's research PROJECTS (topics), offers a one-line "start new
// research" entry that drops into the Research Workspace (academic gather →
// read → synthesize → write), and shows the Gather→Read→Synthesize→Write spine
// so a PhD/researcher always knows the flow. Library + Reading-queue tiles are
// placeholders that light up in later phases.
//
// Pure additive screen — reached via #/research-home. Reuses api.listTopics()
// for the project list and the existing new-topic creator + research workspace.
import { api } from '../api.js';
import { labels } from '../labels.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const STAGES = [
  { icon: 'download',        title: 'Gather',     hint: 'Pull papers from arXiv, PubMed, OpenAlex, Semantic Scholar…' },
  { icon: 'book-open',       title: 'Read',       hint: 'Full text by section · highlight + note · ask the paper' },
  { icon: 'git-merge',       title: 'Synthesize', hint: 'Lit-review matrix · connect the dots · gaps · cited Q&A' },
  { icon: 'pen-line',        title: 'Write',      hint: 'Outline → draft → citations → export' },
];

function stageStrip() {
  return STAGES.map((s, i) => `
    <div style="flex:1 1 160px;min-width:150px;border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--surface,#fff)">
      <div style="display:flex;align-items:center;gap:8px;font-weight:650;font-size:13.5px">
        <span style="display:inline-flex;width:22px;height:22px;align-items:center;justify-content:center;border-radius:999px;background:var(--accent,#5B8DB8);color:#fff;font-size:11px">${i + 1}</span>
        <i data-lucide="${s.icon}"></i> ${esc(s.title)}
      </div>
      <div class="muted" style="font-size:11.5px;margin-top:5px">${esc(s.hint)}</div>
    </div>
  `).join('<div style="align-self:center;color:var(--muted,#8A8178)">→</div>');
}

function projectCard(t) {
  const name = t.topic || t.name || 'Untitled';
  const posts = t.posts ?? t.post_count ?? t.n_posts ?? null;
  const papers = t.papers ?? t.paper_count ?? null;
  const chips = [];
  if (papers != null) chips.push(`${papers} papers`);
  else if (posts != null) chips.push(`${posts} items`);
  if (t.pains != null) chips.push(`${t.pains} painpoints`);
  const chipHtml = chips.map(c => `<span class="muted" style="font-size:11px;border:1px solid var(--line);border-radius:999px;padding:2px 8px">${esc(c)}</span>`).join(' ');
  const te = encodeURIComponent(name);
  const quick = (href, icon, label) =>
    `<a href="${href}" title="${esc(label)}" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;text-decoration:none;color:var(--accent,#5B8DB8);border:1px solid var(--line);border-radius:7px;padding:3px 8px"><i data-lucide="${icon}" style="width:12px;height:12px"></i> ${esc(label)}</a>`;
  return `
    <div class="rh-project" style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--surface,#fff)">
      <a href="#/topic/${te}" style="text-decoration:none;color:inherit;font-weight:650;font-size:14px;display:flex;align-items:center;gap:6px"><i data-lucide="folder-open" style="color:var(--accent,#5B8DB8)"></i> ${esc(name)}</a>
      ${chipHtml ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${chipHtml}</div>` : '<div class="muted" style="font-size:11.5px;margin-top:8px">Open to gather papers</div>'}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        ${quick(`#/topic/${te}`, 'book-open', 'Read')}
        ${quick(`#/lit-matrix/${te}`, 'table', 'Matrix')}
        ${quick(`#/write/${te}`, 'pen-line', 'Write')}
      </div>
    </div>`;
}

export async function renderResearchHome(main) {
  const L = labels();
  main.innerHTML = `
    <div class="screen" style="max-width:1000px;margin:0 auto;padding:20px">
      <div style="display:flex;align-items:center;gap:10px">
        <i data-lucide="graduation-cap" style="color:var(--accent,#5B8DB8)"></i>
        <h2 style="margin:0">Research</h2>
        <span class="muted" style="font-size:12px;margin-left:auto">Academic workspace</span>
      </div>
      <p class="muted" style="font-size:13px;margin:6px 0 16px">
        Start from a question, gather the literature, read with citations, synthesize, and write — all grounded in real papers.
      </p>

      <div style="background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:18px">
        <div style="font-weight:650;font-size:14px;margin-bottom:8px"><i data-lucide="sparkles"></i> Start new research</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input id="rh-new" type="text" placeholder="e.g. effects of binaural beats on EEG and attention"
            style="flex:1 1 360px;min-width:0;padding:9px 12px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:inherit;font-size:13.5px" />
          <button class="btn btn-primary" id="rh-go" type="button"><i data-lucide="arrow-right"></i> Begin</button>
        </div>
        <div class="muted" style="font-size:11.5px;margin-top:6px">Opens the research workspace and gathers an academic corpus (arXiv, PubMed, OpenAlex, Semantic Scholar, Crossref, Europe PMC, DBLP, Scholar).</div>
      </div>

      <div style="font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#8A8178);margin-bottom:8px">The flow</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:stretch;margin-bottom:22px">${stageStrip()}</div>

      <div id="rh-reading" style="margin-bottom:18px"></div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-weight:650;font-size:14px">Your ${esc(L.topics)}</div>
        <a href="#/topics" class="muted" style="font-size:12px;text-decoration:none">View all →</a>
      </div>
      <div id="rh-projects" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">
        <div class="muted" style="font-size:12.5px">Loading ${esc(L.topics)}…</div>
      </div>
    </div>
  `;

  const go = () => {
    const q = (main.querySelector('#rh-new')?.value || '').trim();
    // Stash the seed question so the research workspace can prefill it.
    if (q) { try { sessionStorage.setItem('gapmap.research.seed', q); } catch { /* ignore */ } }
    location.hash = '#/research';
  };
  main.querySelector('#rh-go')?.addEventListener('click', go);
  main.querySelector('#rh-new')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  window.refreshIcons?.();

  // "Continue reading" — papers currently in progress (status=reading) across
  // all projects, so the cockpit resumes where you left off. Best-effort.
  (async () => {
    const host = main.querySelector('#rh-reading');
    if (!host) return;
    try {
      const r = await api.paperLibrary({ status: 'reading', limit: 6 });
      const papers = (r && r.papers) || [];
      if (!papers.length) return;  // nothing in progress → keep the cockpit clean
      const cards = papers.map(p => `
        <a href="#/reader/${encodeURIComponent(p.post_id)}" style="display:flex;align-items:center;gap:8px;text-decoration:none;color:inherit;border:1px solid var(--line);border-radius:9px;padding:9px 11px;background:var(--surface,#fff)">
          <i data-lucide="book-open" style="color:#1F5C99;width:15px;height:15px"></i>
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px">${esc(p.title || 'Untitled')}</span>
          <span class="muted" style="font-size:11px">${esc(p.source_type || '')}</span>
        </a>`).join('');
      host.innerHTML = `
        <div style="font-weight:650;font-size:14px;display:flex;align-items:center;gap:6px;margin-bottom:8px"><i data-lucide="book-marked"></i> Continue reading</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px">${cards}</div>`;
      window.refreshIcons?.();
    } catch { /* library unavailable — skip the section */ }
  })();

  // Load projects (topics) defensively.
  const slot = main.querySelector('#rh-projects');
  try {
    const r = await api.listTopics();
    const topics = Array.isArray(r) ? r : [];
    if (!topics.length) {
      slot.innerHTML = `<div class="muted" style="font-size:12.5px">No ${esc(L.topics)} yet — start your first research above.</div>`;
    } else {
      slot.innerHTML = topics.map(projectCard).join('');
    }
  } catch (e) {
    const msg = (e?.message || e || '').toString();
    slot.innerHTML = /no such table/i.test(msg)
      ? `<div class="muted" style="font-size:12.5px">No ${esc(L.topics)} yet — start your first research above.</div>`
      : `<div class="muted" style="font-size:12.5px;color:#B84747">Couldn't load ${esc(L.topics)}: ${esc(msg)}</div>`;
  }
  window.refreshIcons?.();
}
