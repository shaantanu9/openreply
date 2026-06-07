// Gap digest — a scheduled brief of what's moving in a topic.
//
// Composes top pain scores, rising/new gaps, people to reach, and fired alerts
// into one readable + copyable markdown brief. Reached via #/digest/<topic>.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Minimal markdown → HTML for the digest (headings, bold, list items).
const mdToHtml = (md) => esc(md)
  .replace(/^### (.*)$/gm, '<h4 style="margin:12px 0 4px">$1</h4>')
  .replace(/^## (.*)$/gm, '<h3 style="margin:16px 0 6px;font-size:14px">$1</h3>')
  .replace(/^# (.*)$/gm, '<h2 style="margin:0 0 8px;font-size:18px">$1</h2>')
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/\*(.+?)\*/g, '<i>$1</i>')
  .replace(/^- (.*)$/gm, '<div style="margin:2px 0 2px 12px">• $1</div>')
  .replace(/^(\d+)\. (.*)$/gm, '<div style="margin:2px 0 2px 12px">$1. $2</div>')
  .replace(/\n{2,}/g, '<div style="height:8px"></div>');

export async function renderGapDigest(main, topicRaw) {
  const topic = decodeURIComponent(topicRaw || '');
  let period = 'daily';
  let current = null;

  main.innerHTML = `
    <div class="screen" style="max-width:820px;margin:0 auto;padding:16px 20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <button id="dg-back" class="btn btn-ghost btn-sm" type="button"><i data-lucide="arrow-left"></i></button>
        <i data-lucide="newspaper" style="color:var(--accent,#5B8DB8)"></i>
        <h2 style="margin:0;font-size:18px">Digest</h2>
        <span class="muted" style="font-size:12.5px">${esc(topic)}</span>
      </div>
      <p class="muted" style="font-size:12.5px;margin:4px 0 12px">
        One brief of everything moving — top pains, what's rising, who to reach, and recent alerts.
      </p>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
        <select id="dg-period" style="padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:inherit;font-size:13px">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
        <button class="btn btn-primary btn-sm" id="dg-gen" type="button"><i data-lucide="refresh-cw"></i> Generate</button>
        <button class="btn btn-sm btn-bordered" id="dg-copy" type="button"><i data-lucide="copy"></i> Copy markdown</button>
      </div>
      <div id="dg-status" class="muted" style="font-size:12px;margin-bottom:8px"></div>
      <div id="dg-body" style="border:1px solid var(--line);border-radius:12px;padding:16px;font-size:13px;line-height:1.5"><div class="muted">Loading…</div></div>
    </div>`;
  window.refreshIcons?.();

  const statusEl = main.querySelector('#dg-status');
  const body = main.querySelector('#dg-body');
  main.querySelector('#dg-back')?.addEventListener('click', () => history.back());
  main.querySelector('#dg-period')?.addEventListener('change', (e) => { period = e.target.value; load(); });

  async function load() {
    body.innerHTML = '<div class="muted">Loading…</div>';
    try {
      current = await api.gapDigest(topic, { period });
      body.innerHTML = current?.markdown ? mdToHtml(current.markdown)
        : '<div class="muted" style="font-size:12.5px">No digest content yet — build pain scores / people first.</div>';
    } catch (e) {
      body.innerHTML = `<div class="muted" style="font-size:12.5px;color:#B84747">${esc(e?.message || e)}</div>`;
    }
  }

  main.querySelector('#dg-gen')?.addEventListener('click', load);
  main.querySelector('#dg-copy')?.addEventListener('click', async () => {
    if (!current?.markdown) { statusEl.textContent = 'Nothing to copy yet.'; return; }
    await navigator.clipboard?.writeText(current.markdown).catch(() => {});
    statusEl.textContent = 'Markdown copied to clipboard.';
  });

  await load();
}
