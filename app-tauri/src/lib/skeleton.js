// Shared skeleton-loader builders.
//
// Every sidebar screen paints its chrome (topbar) synchronously, then fetches
// its data and fills an inner container. Historically that inner container
// showed a dead `loading…` text line. These builders replace that with
// layout-shaped skeletons so the wait reads as "this is loading, here's the
// shape of what's coming" instead of a frozen word.
//
// They reuse the existing `.skel` shimmer class (see style.css) — no new
// keyframes. Each returns an HTML string, so adoption in a screen is a
// one-line swap:  `el.innerHTML = skelGrid(6)`  instead of  `…>loading…</div>`.
//
// Variants:
//   skelGrid(count, {lines})  — responsive card grid (concepts, solutions,
//                               audience, personas, products, competitors…)
//   skelRows(count)           — list / table rows (database, tasks, activity,
//                               collects, reports, find, search, watch…)
//   skelStats(count)          — stat tiles (dashboards, overview headers)
//   skelDetail({paras})       — single detail panel (prd, why, launch brief…)
//   skelInline(label)         — tiny inline spinner + text for small slots
//
// See the loader-progress-ux skill for the design rationale.

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const LINE_WIDTHS = [92, 80, 68, 74, 60];

/** One skeleton card: a heading bar, N body lines, two chip placeholders. */
function skelCard(lines = 3) {
  const body = Array.from({ length: lines }, (_, i) =>
    `<div class="skel skel-line" style="width:${LINE_WIDTHS[i % LINE_WIDTHS.length]}%"></div>`
  ).join('');
  return `
    <div class="sk-card" aria-hidden="true">
      <div class="skel skel-h2" style="margin-bottom:12px"></div>
      ${body}
      <div class="sk-card-meta">
        <span class="skel" style="width:58px;height:18px;border-radius:999px"></span>
        <span class="skel" style="width:44px;height:18px;border-radius:999px"></span>
      </div>
    </div>`;
}

/** Responsive card-grid skeleton. Mirrors the app's `minmax(0,1fr)` grids. */
export function skelGrid(count = 6, { lines = 3 } = {}) {
  return `<div class="sk-grid" aria-busy="true">${skelCard(lines).repeat(count)}</div>`;
}

/** List / table row skeleton: round avatar + label + trailing value. */
export function skelRows(count = 6) {
  const row = `
    <div class="sk-row" aria-hidden="true">
      <span class="skel skel-round" style="margin:0"></span>
      <span class="skel skel-line" style="width:42%;margin:0"></span>
      <span class="skel skel-line" style="width:18%;margin:0 0 0 auto"></span>
    </div>`;
  return `<div class="sk-rows" aria-busy="true">${row.repeat(count)}</div>`;
}

/** Stat-tile skeleton row (dashboards / overview headers). */
export function skelStats(count = 4) {
  const tile = `
    <div class="sk-stat" aria-hidden="true">
      <div class="skel" style="width:40%;height:12px;border-radius:6px;margin-bottom:10px"></div>
      <div class="skel" style="width:64%;height:26px;border-radius:8px"></div>
    </div>`;
  return `<div class="sk-stats" aria-busy="true">${tile.repeat(count)}</div>`;
}

/** Single detail-panel skeleton: heading + paragraphs. */
export function skelDetail({ paras = 5 } = {}) {
  const lines = Array.from({ length: paras }, (_, i) =>
    `<div class="skel skel-line" style="width:${[96, 88, 92, 70, 84, 60][i % 6]}%"></div>`
  ).join('');
  return `
    <div class="sk-detail" aria-busy="true" aria-hidden="true">
      <div class="skel skel-h1" style="width:46%;margin-bottom:18px"></div>
      ${lines}
    </div>`;
}

/** Tiny inline spinner + label for small in-flow slots (chips, sub-panels). */
export function skelInline(label = 'Loading…') {
  return `<span class="sk-inline" aria-busy="true"><span class="sk-inline-spin" aria-hidden="true"></span>${esc(label)}</span>`;
}

export default { skelGrid, skelRows, skelStats, skelDetail, skelInline };
