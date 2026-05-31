// Merge two topics into one — shared modal used by the topic-card merge
// action (preset source) and the Settings → "Merge two topics" panel
// (pick both). Reuses the .modal-backdrop / .modal-card vocabulary from
// lib/topicConfirm.js so it inherits existing modal styling.
//
// Flow: pick target (and source if not preset) → live dry-run preview of
// exactly what would move → confirm → api.mergeTopics(apply=true) in one
// transaction → optional re-enrichment of the merged topic → navigate to it.
import { api } from '../api.js';
import { showToast } from '../lib/toast.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

async function fetchTopics() {
  try {
    const rows = await api.runQuery(
      'SELECT topic, COUNT(*) AS posts FROM topic_posts '
      + 'GROUP BY topic ORDER BY posts DESC'
    );
    return (Array.isArray(rows) ? rows : []).filter((r) => r && r.topic);
  } catch {
    return [];
  }
}

function optionList(topics, exclude) {
  return topics
    .filter((t) => t.topic !== exclude)
    .map((t) => `<option value="${esc(t.topic)}">${esc(t.topic)} (${t.posts} posts)</option>`)
    .join('');
}

/**
 * Open the merge dialog.
 * @param {string} presetSource - if set, the source is fixed (card action);
 *   otherwise the user picks both topics (Settings panel).
 */
export async function openMergeModal(presetSource = '') {
  const topics = await fetchTopics();
  if (topics.length < 2) {
    showToast('Need at least two topics to merge.', 'info');
    return;
  }

  const hasPreset = !!presetSource && topics.some((t) => t.topic === presetSource);

  const sourceField = hasPreset
    ? `<div class="mg-label">Source (will be removed)</div>
       <div class="mg-fixed">${esc(presetSource)}</div>
       <input type="hidden" id="mg-source" value="${esc(presetSource)}">`
    : `<label class="mg-label" for="mg-source">Source topic (will be removed)</label>
       <select class="mg-input" id="mg-source"><option value="">Select…</option>${optionList(topics, '')}</select>`;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" style="max-width:520px;width:calc(100vw - 40px);max-height:calc(100vh - 40px);overflow-y:auto;">
      <h3 class="modal-title"><i data-lucide="git-merge"></i> Merge topics</h3>
      <div class="modal-body">
        ${sourceField}
        <label class="mg-label" for="mg-target" style="margin-top:10px;">Merge into (target — kept)</label>
        <select class="mg-input" id="mg-target"><option value="">Select…</option>${optionList(topics, hasPreset ? presetSource : '')}</select>
        ${hasPreset ? '' : `<div style="margin-top:8px;">
          <button class="btn btn-ghost btn-sm" id="mg-swap" type="button"><i data-lucide="arrow-up-down"></i> Swap</button>
        </div>`}
        <div id="mg-preview" class="mg-preview"></div>
        <label class="mg-toggle">
          <input type="checkbox" id="mg-reenrich" checked>
          <span>Re-run enrichment on the merged topic afterwards (rebuilds graph &amp; insights on the combined corpus)</span>
        </label>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
        <button class="btn btn-danger" data-act="confirm" disabled>Merge</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const $ = (sel) => backdrop.querySelector(sel);
  const srcEl = $('#mg-source');
  const tgtEl = $('#mg-target');
  const prev = $('#mg-preview');
  const confirmBtn = $('[data-act="confirm"]');
  let busy = false;

  const close = () => backdrop.remove();
  const setEnabled = (on) => { if (confirmBtn) confirmBtn.disabled = !on; };

  const refresh = async () => {
    const source = (srcEl?.value || '').trim();
    const target = (tgtEl?.value || '').trim();
    if (!source || !target) { prev.textContent = ''; setEnabled(false); return; }
    if (source === target) {
      prev.innerHTML = '<span class="mg-err">Pick two different topics.</span>';
      setEnabled(false);
      return;
    }
    prev.textContent = 'Calculating…';
    setEnabled(false);
    try {
      const r = await api.mergeTopics(source, target, false);
      if (!r || r.ok === false) {
        prev.innerHTML = `<span class="mg-err">${esc(r?.error || 'Cannot merge these topics.')}</span>`;
        return;
      }
      const dupNote = r.duplicate_posts_skipped
        ? `<br><span class="mg-dim">${r.duplicate_posts_skipped} duplicate posts already in the target will be skipped.</span>`
        : '';
      prev.innerHTML =
        `Will move <b>${r.posts_to_move}</b> posts, <b>${r.nodes_to_move}</b> graph nodes, `
        + `and <b>${r.chats_to_move}</b> chats into <b>${esc(target)}</b>.${dupNote}`
        + `<br><span class="mg-dim">“${esc(source)}” will be removed — this cannot be undone.</span>`;
      setEnabled(true);
    } catch (e) {
      prev.innerHTML = `<span class="mg-err">Preview failed: ${esc(e?.message || e)}</span>`;
    }
  };

  const doMerge = async () => {
    if (busy) return;
    const source = (srcEl?.value || '').trim();
    const target = (tgtEl?.value || '').trim();
    const reEnrich = !!$('#mg-reenrich')?.checked;
    if (!source || !target || source === target) return;
    busy = true;
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Merging…'; }
    try {
      const r = await api.mergeTopics(source, target, true);
      if (!r || r.ok === false) {
        showToast('Merge failed: ' + (r?.error || 'unknown error'), 'error');
        busy = false;
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Merge'; }
        return;
      }
      showToast(`Merged “${source}” into “${target}”.`, 'success');
      close();
      if (reEnrich) {
        try {
          api.enrichGraph(target);
          showToast(`Re-running enrichment on “${target}”…`, 'info');
        } catch { /* enrichment is best-effort; merge already succeeded */ }
      }
      location.hash = `#/topic/${encodeURIComponent(target)}`;
    } catch (e) {
      showToast('Merge failed: ' + (e?.message || e), 'error');
      busy = false;
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Merge'; }
    }
  };

  $('[data-act="cancel"]')?.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  confirmBtn?.addEventListener('click', doMerge);
  srcEl?.addEventListener('change', refresh);
  tgtEl?.addEventListener('change', refresh);
  $('#mg-swap')?.addEventListener('click', () => {
    if (!srcEl || srcEl.tagName !== 'SELECT') return;
    const a = srcEl.value; srcEl.value = tgtEl.value; tgtEl.value = a;
    refresh();
  });

  if (hasPreset) refresh();
  window.refreshIcons?.();
}

// Global click-delegation so any element with `data-open-merge="<source>"`
// opens the modal — lets the Settings card (and any future entry point)
// wire up with HTML alone, no per-screen import/handler. Registered once
// on module load (this module is imported by home.js at app startup).
if (typeof window !== 'undefined' && !window.__mergeDelegationWired) {
  window.__mergeDelegationWired = true;
  document.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('[data-open-merge]');
    if (!btn) return;
    e.preventDefault();
    openMergeModal(btn.getAttribute('data-open-merge') || '');
  });
}
