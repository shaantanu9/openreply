// Academic Mode — topic tab. Turns a topic into a grounded, cited research
// brief through research → synthesize → [grounding gate] → peer_review →
// finalize, with a live staged timeline, a visible grounding-gate badge, the
// rendered markdown brief, and DOCX/PDF export. Streaming mirrors fleetFlow.js:
// stage lines arrive via 'academic:progress' (sentinel __academic); the final
// brief arrives in the 'done' event. Backend: research/academic_mode.py.
import { api, esc } from '../api.js';
import { renderMarkdown } from '../lib/markdown.js';
import { readScreenCache, writeScreenCache } from '../lib/screenCache.js';

export const STAGES = [
  { name: 'research', label: 'Research' },
  { name: 'synthesize', label: 'Synthesize' },
  { name: 'grounding', label: 'Grounding gate' },
  { name: 'peer_review', label: 'Peer review panel' },
  { name: 'finalize', label: 'Finalize' },
  { name: 'integrity', label: 'Integrity gate' },
  { name: 'citation', label: 'Citation check' },
];
const ICON = { ok: '✓', error: '✕', attention: '⚠', running: '…', pending: '·' };

let _busy = false;

export async function loadAcademic(contentEl, topic) {
  const set = (html) => { if (contentEl.dataset.tab === 'academic') contentEl.innerHTML = html; };
  const KEY = `academic.${topic}`;

  // Instant paint from cache, then refresh in the background.
  const cached = readScreenCache(KEY);
  if (cached && cached.markdown) renderScreen(contentEl, topic, cached);
  else set(shell(topic, null, 'Loading…'));

  try {
    const brief = await api.academicBriefGet(topic);
    if (brief && brief.ok && brief.markdown) {
      writeScreenCache(KEY, brief);
      renderScreen(contentEl, topic, brief);
    } else if (!cached) {
      renderScreen(contentEl, topic, null);
    }
  } catch (e) {
    if (!cached) set(shell(topic, null, `Could not load: ${esc(e?.message || e)}`));
  }
}

// ── rendering ────────────────────────────────────────────────────────────────

function shell(topic, timelineHtml, note) {
  return `<div class="academic-wrap">
      <div class="academic-head">
        <div><b><i data-lucide="graduation-cap"></i> Academic Mode</b>
          <span class="academic-sub">grounded, cited research brief</span></div>
        <div class="academic-controls">
          <select id="acad-level" class="academic-select" title="Autopilot level">
            <option value="L3">L3 · auto</option>
            <option value="L2">L2 · gated</option>
            <option value="L1">L1 · suggest</option>
          </select>
          <select id="acad-format" class="academic-select" title="Export preference">
            <option value="markdown">Markdown</option>
            <option value="docx">DOCX</option>
            <option value="pdf">PDF</option>
          </select>
          <button class="btn btn-sm btn-primary" id="acad-run"><i data-lucide="play"></i> Run brief</button>
        </div>
      </div>
      ${note ? `<div class="academic-note">${esc(note)}</div>` : ''}
      <div id="acad-timeline">${timelineHtml || ''}</div>
      <div id="acad-brief"></div>
    </div>`;
}

function renderTimeline(stages, gate) {
  const items = stages.map((s) => {
    const ic = ICON[s.status] || '·';
    const spin = s.status === 'running' ? ' <span class="academic-spin"></span>' : '';
    return `<li class="academic-stage st-${esc(s.status)}">
        <span class="academic-stage-ic">${ic}</span>
        <span class="academic-stage-label">${esc(s.label)}</span>${spin}
        ${s.detail ? `<span class="academic-stage-detail">${esc(s.detail)}</span>` : ''}
      </li>`;
  }).join('');
  const badge = gate
    ? `<span class="academic-gate ${gate.passed ? 'pass' : 'block'}">${gate.passed ? '✓' : '⚠'} grounding ${esc(gate.text)}</span>`
    : '';
  return `<div class="academic-panel"><div class="academic-panel-head"><b>Flow</b>${badge}</div>
      <ul class="academic-timeline">${items}</ul></div>`;
}

// Sync render-from-data so the cache hit paints without re-checking backend state.
function renderScreen(contentEl, topic, brief) {
  const stages = STAGES.map((s) => ({ ...s, status: brief ? 'ok' : 'pending', detail: '' }));
  let gate = null;
  if (brief) {
    gate = { passed: true, text: `${brief.grounded_count || 0} papers` };
  }
  contentEl.innerHTML = shell(topic, renderTimeline(stages, gate),
    brief ? '' : 'No brief yet. Click “Run brief” to research, synthesize, peer-review, and write a cited brief.');
  if (brief && brief.markdown) paintBrief(contentEl, topic, brief);
  window.refreshIcons?.();
  wireControls(contentEl, topic);
}

// Multi-agent verdict chips — panel decision, integrity verdict, citation
// verification, and Material Passport integrity. Tolerates both the live
// run shape (decision/integrity/citations_check/passport) and the stored
// shape (review_decision/integrity_verdict/citations_verified/gate_status).
export function verdictsStrip(brief) {
  const decision = brief.decision || brief.review_decision;
  const integ = brief.integrity || (brief.integrity_verdict
    ? { verdict: brief.integrity_verdict, blocking: brief.gate_status === 'blocked' } : null);
  const cc = brief.citations_check
    || (brief.citations_verified != null ? { verified: brief.citations_verified } : null);
  const pp = brief.passport;
  const chips = [];
  if (decision) {
    const cls = decision === 'accept' ? 'pass' : (decision === 'reject' ? 'block' : 'warn');
    chips.push(`<span class="academic-verdict ${cls}" title="Peer-review panel decision">⚖ ${esc(String(decision).replace(/_/g, ' '))}</span>`);
  }
  if (integ && integ.verdict) {
    const cls = integ.blocking ? 'block' : (integ.verdict === 'PASS' ? 'pass' : 'warn');
    chips.push(`<span class="academic-verdict ${cls}" title="Integrity gate (7-mode AI-failure checklist)">🛡 integrity ${esc(integ.verdict)}${integ.blocking ? ' · blocked' : ''}</span>`);
  }
  if (cc) {
    const miss = cc.missing || 0;
    const cls = miss > 0 ? 'warn' : 'pass';
    chips.push(`<span class="academic-verdict ${cls}" title="Citation-existence verification">🔗 ${cc.verified || 0} verified${miss ? ` · ${miss} unresolved` : ''}</span>`);
  }
  if (pp && pp.length) {
    chips.push(`<span class="academic-verdict ${pp.verified ? 'pass' : 'warn'}" title="Material Passport — hash-chained provenance">🧾 passport ${pp.length}${pp.verified ? ' ✓' : ''}</span>`);
  }
  return chips.length ? `<div class="academic-verdicts">${chips.join('')}</div>` : '';
}

function paintBrief(contentEl, topic, brief) {
  const host = contentEl.querySelector('#acad-brief');
  if (!host) return;
  const cites = (brief.citations || []).length;
  const exportBtns = `<div class="academic-export">
      <span class="academic-export-lbl">Export:</span>
      <button class="btn btn-xs btn-bordered" data-acad-export="markdown"><i data-lucide="file-text"></i> .md</button>
      <button class="btn btn-xs btn-bordered" data-acad-export="docx"><i data-lucide="file"></i> .docx</button>
      <button class="btn btn-xs btn-bordered" data-acad-export="pdf"><i data-lucide="file-down"></i> .pdf</button>
      <span class="academic-export-out" id="acad-export-out"></span>
    </div>`;
  host.innerHTML = `<div class="academic-brief-head">
        <b>Research brief</b>
        <span class="academic-meta">${cites} grounded citation${cites === 1 ? '' : 's'} · ${esc(brief.generated_at || '')}</span>
        ${exportBtns}
      </div>
      ${verdictsStrip(brief)}
      <div class="academic-brief-body md-body">${renderMarkdown(brief.markdown)}</div>`;
  host.querySelectorAll('[data-acad-export]').forEach((b) => {
    b.addEventListener('click', () => doExport(topic, b.dataset.acadExport, host));
  });
  window.refreshIcons?.();
}

async function doExport(topic, format, host) {
  const out = host.querySelector('#acad-export-out');
  if (out) out.textContent = `Exporting ${format}…`;
  try {
    const r = await api.paperExportWithCitations(topic, null, format, 'IMRaD');
    if (out) out.textContent = r?.path ? `Saved: ${r.path}` : (r?.ok ? 'Done.' : (r?.error || 'Export failed'));
  } catch (e) {
    if (out) out.textContent = `Failed: ${e?.message || e}`;
  }
}

// ── controls + run ─────────────────────────────────────────────────────────────

function wireControls(contentEl, topic) {
  const runBtn = contentEl.querySelector('#acad-run');
  if (runBtn && !runBtn._wired) {
    runBtn._wired = true;
    runBtn.addEventListener('click', () => {
      const level = contentEl.querySelector('#acad-level')?.value || 'L3';
      const format = contentEl.querySelector('#acad-format')?.value || 'markdown';
      runBrief(contentEl, topic, { level, format });
    });
  }
}

async function runBrief(contentEl, topic, opts, approved = false) {
  if (_busy) return;
  _busy = true;
  const stages = STAGES.map((s) => ({ ...s, status: 'pending', detail: '' }));
  stages[0].status = 'running';
  let gate = null;
  const timelineEl = contentEl.querySelector('#acad-timeline');
  const briefEl = contentEl.querySelector('#acad-brief');
  if (briefEl) briefEl.innerHTML = '';
  const paint = () => { if (timelineEl) timelineEl.innerHTML = renderTimeline(stages, gate); window.refreshIcons?.(); };
  paint();
  const runBtn = contentEl.querySelector('#acad-run');
  if (runBtn) runBtn.disabled = true;

  let unP = null, unD = null, done = false;
  const cleanup = () => { try { unP && unP(); } catch {} try { unD && unD(); } catch {} };
  const settle = (result) => {
    if (done) return;
    done = true;
    cleanup();
    _busy = false;
    if (runBtn) runBtn.disabled = false;
    if (!result) return;
    if (result.gate === 'coverage') {
      gate = { passed: false, text: `${result.grounded_count || 0} papers (need 2)` };
      paint();
      const note = contentEl.querySelector('.academic-note');
      if (note) note.textContent = result.reason || 'Grounding gate blocked finalize — collect/analyze more papers.';
      return;
    }
    if (result.awaiting_approval) {
      gate = { passed: true, text: `${result.grounded_count || 0} papers` };
      paint();
      offerApproval(contentEl, topic, opts, result);
      return;
    }
    if (result.brief && result.brief.markdown) {
      const brief = {
        markdown: result.brief.markdown,
        citations: result.brief.citations || [],
        grounded_count: result.grounded_count,
        generated_at: result.generated_at,
        ok: true,
        // Multi-agent verdicts for the chips strip.
        decision: result.peer_review?.decision,
        integrity: result.integrity,
        citations_check: result.citations_check,
        passport: result.passport,
        gate_status: result.gate_status,
      };
      writeScreenCache(`academic.${topic}`, brief);
      // Mark all stages ok then paint the brief.
      stages.forEach((s) => { if (s.status === 'pending' || s.status === 'running') s.status = 'ok'; });
      gate = { passed: true, text: `${result.grounded_count || 0} papers` };
      paint();
      paintBrief(contentEl, topic, brief);
    }
  };

  try {
    unP = await api.onAcademicProgress((line) => {
      const obj = parseLine(line);
      if (!obj || !obj.__academic) return;
      if (obj.event === 'stage') {
        const i = stages.findIndex((s) => s.name === obj.stage);
        if (i >= 0) {
          if (obj.status === 'start') stages[i].status = 'running';
          else if (obj.stage === 'grounding') {
            stages[i].status = obj.passed ? 'ok' : 'attention';
            gate = { passed: !!obj.passed, text: `${obj.grounded_count || 0}/${obj.min || 2} papers` };
          } else {
            stages[i].status = (obj.ok === false) ? 'error' : 'ok';
            if (obj.summary) stages[i].detail = obj.summary;
          }
          const nxt = stages.find((s) => s.status === 'pending');
          if (nxt && obj.status !== 'start') nxt.status = 'running';
        }
        paint();
      } else if (obj.event === 'done') {
        settle(obj.result);
      }
    });
    unD = await api.onAcademicDone(() => {
      if (done) return;
      // Process exited without a result line — settle from the stored brief.
      api.academicBriefGet(topic).then((b) => settle(b && b.ok ? { brief: b, grounded_count: b.grounded_count, generated_at: b.generated_at } : null)).catch(() => settle(null));
    });
    await api.academicBriefRunStream(topic, { ...opts, approved });
  } catch (e) {
    cleanup();
    _busy = false;
    if (runBtn) runBtn.disabled = false;
    if (timelineEl) timelineEl.innerHTML = `<div class="academic-note">Run failed: ${esc(e?.message || e)}</div>`;
  }
}

function offerApproval(contentEl, topic, opts, result) {
  const tl = contentEl.querySelector('#acad-timeline');
  if (!tl) return;
  const div = document.createElement('div');
  div.className = 'academic-approve';
  div.innerHTML = `<span>⏸ L2 paused after grounding (${result.grounded_count || 0} papers).</span>
      <button class="btn btn-xs btn-primary" id="acad-approve">Approve · run peer review + finalize</button>`;
  tl.appendChild(div);
  div.querySelector('#acad-approve')?.addEventListener('click', () => runBrief(contentEl, topic, opts, true));
}

export function parseLine(line) {
  if (line && typeof line === 'object') return line;
  if (typeof line !== 'string') return null;
  try { return JSON.parse(line); } catch { return null; }
}
