// Research Workspace — the one-shot PhD research engine.
//
// You type a research topic/question; this gathers as much academic corpus as
// it can, builds the knowledge graph + paper knowledge (full text → gaps),
// materialises paper relations, finds NOVEL cross-paper connections, and
// synthesises real, evidence-grounded research conclusions — then drops you
// into the full topic workspace. This is "how research and discovery happen":
// gather → relate → connect → conclude → discover.
//
// It orchestrates existing, individually-proven steps via the api layer and
// shows a live stepper. Each step is resilient: a non-fatal failure marks the
// step and the run continues where it sensibly can.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Academic sources only — this is a literature engine, not social listening.
const ACADEMIC_SOURCES = [
  'arxiv', 'pubmed', 'openalex', 'semantic_scholar',
  'crossref', 'europepmc', 'dblp', 'scholar',
];

const STEPS = [
  { id: 'collect',     label: 'Gather academic corpus', icon: 'download',
    hint: 'Search arXiv, PubMed, OpenAlex, Semantic Scholar, Crossref, Europe PMC, DBLP, Scholar' },
  { id: 'graph',       label: 'Build knowledge graph', icon: 'network',
    hint: 'Extract entities + relations across the corpus' },
  { id: 'knowledge',   label: 'Read papers (full text → gaps)', icon: 'book-open',
    hint: 'Download + section full text, detect cross-paper gaps, synthesise insights' },
  { id: 'relations',   label: 'Link the papers', icon: 'share-2',
    hint: 'Materialise cites / relates-to / shared-finding edges' },
  { id: 'connections', label: 'Connect the dots', icon: 'git-merge',
    hint: 'Surface novel cross-paper connections, ranked by novelty' },
  { id: 'conclusions', label: 'Make research conclusions', icon: 'graduation-cap',
    hint: 'Evidence-grounded thesis, findings, discoveries, open questions' },
];

function stepRow(s, state) {
  const ICON = { pending: 'circle', running: 'loader-2', done: 'check-circle-2',
                 error: 'alert-circle', skipped: 'minus-circle' };
  const COLOR = { pending: 'var(--muted,#8A8178)', running: '#1F5C99',
                  done: '#1A7A4F', error: '#B84747', skipped: '#8A8178' };
  const spin = state === 'running' ? ' class="spin"' : '';
  return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--line,#eee)">
      <i data-lucide="${ICON[state] || 'circle'}"${spin} style="color:${COLOR[state]};margin-top:1px;flex-shrink:0"></i>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13.5px;color:${state === 'pending' ? 'var(--muted,#8A8178)' : 'inherit'}">${esc(s.label)}</div>
        <div class="muted" style="font-size:12px">${esc(s.hint)}</div>
        <div class="muted" id="step-note-${s.id}" style="font-size:11.5px;margin-top:2px"></div>
      </div>
    </div>`;
}

export async function renderResearchWorkspace(main) {
  main.innerHTML = `
    <div class="screen" style="max-width:760px;margin:0 auto;padding:18px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
        <i data-lucide="flask-conical" style="color:#1F5C99"></i>
        <h1 style="margin:0;font-size:20px">Research Workspace</h1>
      </div>
      <p class="muted" style="margin:4px 0 16px;font-size:13.5px">
        Give a research topic or question. Gap Map gathers the literature, reads it,
        finds connections nobody has made, and synthesises real conclusions — then
        opens the full workspace so you can draft and cite.</p>

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <input id="rw-topic" type="text" placeholder="e.g. graph neural networks for drug discovery"
          style="flex:1;min-width:260px;padding:10px 12px;border:1px solid var(--line,#ccc);border-radius:8px;font-size:14px" />
        <label class="muted" style="display:flex;align-items:center;gap:6px;font-size:12.5px">
          <input type="checkbox" id="rw-deep" checked /> Deep (max corpus)
        </label>
        <button class="btn btn-primary icon-btn" id="rw-start"><i data-lucide="play"></i> Start research</button>
      </div>
      <p class="muted" style="font-size:11.5px;margin:0 0 16px">
        A deep run searches every academic source and reads full text — it can take a few minutes.
        Needs an LLM key (Settings → API keys) for the connections + conclusions.</p>

      <div id="rw-stepper" hidden style="border:1px solid var(--line,#e5e0d8);border-radius:10px;padding:6px 14px;margin-bottom:14px"></div>
      <div id="rw-result"></div>
    </div>`;
  window.refreshIcons?.();

  const topicInput = main.querySelector('#rw-topic');
  const deepInput = main.querySelector('#rw-deep');
  const startBtn = main.querySelector('#rw-start');
  const stepperEl = main.querySelector('#rw-stepper');
  const resultEl = main.querySelector('#rw-result');

  const state = {};
  STEPS.forEach((s) => { state[s.id] = 'pending'; });

  const paint = () => {
    stepperEl.innerHTML = STEPS.map((s) => stepRow(s, state[s.id])).join('');
    window.refreshIcons?.();
  };
  const setStep = (id, st, note) => {
    state[id] = st;
    paint();
    if (note != null) {
      const n = main.querySelector(`#step-note-${id}`);
      if (n) n.textContent = note;
    }
  };

  // Resolve when a collect:done event fires for this topic, else after a long
  // fallback so the run never hangs forever.
  function waitForCollect(topic) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (reason) => { if (!settled) { settled = true; off?.(); resolve(reason); } };
      let off = null;
      try {
        off = api.onCollectDone((payload) => {
          const t = (payload && (payload.topic || payload.t)) || '';
          if (!t || t === topic) finish('done');
        });
      } catch { /* event API unavailable — fall back to the timer */ }
      // Fallback: resolve after 6 min so subsequent steps still run on what
      // was collected. Deep academic sweeps rarely exceed this.
      setTimeout(() => finish('timeout'), 6 * 60 * 1000);
    });
  }

  async function run() {
    const topic = (topicInput.value || '').trim();
    if (!topic) { topicInput.focus(); return; }
    const deep = !!deepInput.checked;
    startBtn.disabled = true; topicInput.disabled = true; deepInput.disabled = true;
    stepperEl.hidden = false; resultEl.innerHTML = '';
    paint();

    // 1 — Gather academic corpus
    setStep('collect', 'running', 'searching academic sources…');
    try {
      const donePromise = waitForCollect(topic);
      await api.startCollect(topic, /*aggressive*/ deep, ACADEMIC_SOURCES,
                             /*skipReddit*/ true, /*ifBusy*/ 'queue', /*deep*/ deep);
      const how = await donePromise;
      setStep('collect', 'done', how === 'timeout' ? 'continuing on what was collected' : 'corpus gathered');
    } catch (e) {
      setStep('collect', 'error', String(e?.message || e).slice(0, 80));
    }

    // 2 — Knowledge graph (entities + relations)
    setStep('graph', 'running', 'extracting entities + relations…');
    try { await api.buildGraph(topic); setStep('graph', 'done'); }
    catch (e) { setStep('graph', 'error', String(e?.message || e).slice(0, 80)); }

    // 3 — Read papers: full text → sections → gaps → insights
    setStep('knowledge', 'running', 'reading full text + detecting gaps…');
    try {
      const r = await api.buildPaperKnowledge(topic, deep ? 'all' : 'top50', false);
      const n = (r && (r.papers || r.fulltext || r.gaps)) ? '' : '';
      setStep('knowledge', 'done', n);
    } catch (e) { setStep('knowledge', 'error', String(e?.message || e).slice(0, 80)); }

    // 4 — Link the papers
    setStep('relations', 'running', 'building paper edges…');
    try { await api.paperRelationsBuild(topic, 'relates_to,cites,shared_finding,same_author'); setStep('relations', 'done'); }
    catch (e) { setStep('relations', 'skipped', 'skipped'); }

    // 5 — Connect the dots
    setStep('connections', 'running', 'finding novel connections…');
    let connTotal = 0;
    try {
      const c = await api.connectionsCompute(topic);
      connTotal = (c && c.data && c.data.total) || 0;
      setStep('connections', 'done', connTotal ? `${connTotal} novel connections` : 'no connections surfaced yet');
    } catch (e) { setStep('connections', 'error', String(e?.message || e).slice(0, 80)); }

    // 6 — Research conclusions
    setStep('conclusions', 'running', 'synthesising conclusions…');
    let concl = null;
    try {
      concl = await api.conclusionsCompute(topic);
      setStep('conclusions', concl && concl.computed ? 'done' : 'error',
              concl && concl.computed ? 'done' : (concl && concl.reason ? String(concl.reason).slice(0, 80) : 'no synthesis'));
    } catch (e) { setStep('conclusions', 'error', String(e?.message || e).slice(0, 80)); }

    renderResult(topic, concl, connTotal);
    startBtn.disabled = false; topicInput.disabled = false; deepInput.disabled = false;
  }

  function renderResult(topic, concl, connTotal) {
    const d = (concl && concl.data) || {};
    const sect = (title, items) => (items && items.length)
      ? `<div style="margin:12px 0"><div style="font-weight:600;font-size:13px;margin-bottom:3px">${esc(title)}</div>
         <ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.5">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`
      : '';
    resultEl.innerHTML = `
      <div style="border:1px solid var(--line,#e5e0d8);border-radius:10px;padding:14px 16px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
          <i data-lucide="sparkles" style="color:#1A7A4F"></i>
          <strong>Research synthesis — ${esc(topic)}</strong>
          <span class="muted" style="font-size:12px">· ${connTotal} connections</span>
        </div>
        ${d.thesis ? `<div style="background:var(--surface-2,#f6f3ee);border-left:3px solid #1F5C99;padding:10px 14px;border-radius:6px;margin:6px 0;font-size:14px;font-weight:500">${esc(d.thesis)}</div>` : '<p class="muted">No synthesis yet — open the workspace and check the Conclusions tab (an LLM key is required).</p>'}
        ${sect('Key findings', d.key_findings)}
        ${sect('Novel contributions (discoveries to pursue)', d.novel_contributions)}
        ${sect('Open questions', d.open_questions)}
        ${d.suggested_direction ? `<div style="margin:12px 0"><div style="font-weight:600;font-size:13px;margin-bottom:3px">Suggested next study</div>
          <div style="background:var(--surface-2,#f6f3ee);padding:10px 14px;border-radius:6px;font-size:13.5px">${esc(d.suggested_direction)}</div></div>` : ''}
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn btn-primary btn-sm icon-btn" href="#/topic/${encodeURIComponent(topic)}"><i data-lucide="arrow-right"></i> Open full workspace</a>
          <a class="btn btn-sm btn-bordered icon-btn" href="#/paper-map/${encodeURIComponent(topic)}"><i data-lucide="network"></i> Paper map</a>
        </div>
      </div>`;
    window.refreshIcons?.();
  }

  startBtn.addEventListener('click', run);
  topicInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  topicInput.focus();
}

export default renderResearchWorkspace;
