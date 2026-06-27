// Shared skeleton screens for OpenReply. Pure markup (Tailwind `animate-pulse`),
// no JS — drop into a container while real data loads so screens never show a
// blank frame or a bare "Loading…". Route-aware via `skeletonFor(key)`.

const BAR = "animate-pulse rounded bg-zinc-200/80 dark:bg-zinc-800";
const blk = (h, w = "100%", cls = "") => `<div class="${BAR} ${cls}" style="height:${h};width:${w}"></div>`;
const CARD = "rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5";

// Header (title + subtitle + optional action button placeholder).
export function skelHead(action = true) {
  return `<div class="mb-6 flex items-start justify-between gap-4">
    <div class="space-y-2">${blk("1.5rem", "12rem")}${blk("0.9rem", "20rem")}</div>
    ${action ? blk("2.25rem", "10rem", "rounded-full") : ""}</div>`;
}

// A single content card (title line + a few body lines).
export function skelCard(lines = 3) {
  return `<div class="${CARD} space-y-3">${blk("1rem", "40%")}
    ${Array.from({ length: lines }, () => blk("0.8rem", `${70 + Math.round(20)}%`)).join("")}</div>`;
}

// A KPI tile (label + big number).
function skelKpi() {
  return `<div class="${CARD} space-y-3">${blk("0.8rem", "50%")}${blk("2rem", "40%")}</div>`;
}

// N list rows (opportunity / inbox / queue cards).
export function skelList(rows = 4) {
  return `<div class="space-y-3">${Array.from({ length: rows }, () => `<div class="${CARD} space-y-3">
    <div class="flex items-center justify-between">${blk("1rem", "8rem")}${blk("1.5rem", "2.5rem")}</div>
    ${blk("0.9rem", "75%")}${blk("0.8rem", "55%")}
    <div class="flex gap-2 pt-1">${blk("1.75rem", "5rem", "rounded-full")}${blk("1.75rem", "5rem", "rounded-full")}</div></div>`).join("")}</div>`;
}

function skelGrid(n = 4) {
  return `<div class="grid gap-5 sm:grid-cols-2">${Array.from({ length: n }, () => skelCard(2)).join("")}</div>`;
}

function skelKpiRow(n = 4) {
  return `<div class="grid grid-cols-2 gap-4 lg:grid-cols-${n}">${Array.from({ length: n }, skelKpi).join("")}</div>`;
}

function skelDashboard() {
  return skelHead() + skelKpiRow(4) +
    `<div class="mt-5 grid gap-4 lg:grid-cols-2">${skelCard(3)}${skelCard(3)}</div>`;
}

function skelAnalytics() {
  return skelHead(false) + skelKpiRow(4) +
    `<div class="mt-5 ${CARD}">${blk("0.9rem", "30%")}<div class="mt-3">${blk("7rem")}</div></div>`;
}

function skelToolbarList(rows = 5) {
  return skelHead() + `<div class="mb-4 flex gap-2">${blk("2rem", "5rem", "rounded-full")}${blk("2rem", "5rem", "rounded-full")}${blk("2rem", "5rem", "rounded-full")}</div>` + skelList(rows);
}

// Route → skeleton. Falls back to a generic header + cards.
const MAP = {
  agents: () => skelHead() + skelGrid(4),
  agent: skelDashboard,
  inbox: () => skelToolbarList(5),
  opportunities: () => skelToolbarList(5),
  queue: () => skelHead() + skelList(4),
  analytics: skelAnalytics,
  learning: () => skelHead() + skelKpiRow(4) + `<div class="mt-5 grid gap-4 lg:grid-cols-2">${skelCard(4)}${skelCard(4)}</div>`,
  knowledge: () => skelHead(false) + skelKpiRow(3) + `<div class="mt-5">${skelCard(4)}</div>`,
  connections: () => skelHead() + skelGrid(6),
  settings: () => skelHead(false) + `<div class="grid gap-5 lg:grid-cols-2">${skelCard(4)}${skelCard(3)}${skelCard(3)}${skelCard(2)}</div>`,
  keywords: () => skelHead() + `<div class="grid gap-5 lg:grid-cols-2">${skelCard(4)}${skelCard(4)}</div>`,
  subreddit: () => skelHead() + skelList(4),
  geo: () => skelHead() + skelList(3),
  compose: () => skelHead() + `<div class="grid gap-5 lg:grid-cols-[1fr,1.2fr]">${skelCard(5)}${skelCard(6)}</div>`,
};

// Inner skeleton markup (no page wrapper) — for screens that own their own
// container and only want to fill the data region while loading.
export function skeletonBody(key) {
  const fn = MAP[key];
  return fn ? fn() : skelHead() + skelCard(3) + `<div class="mt-4">${skelCard(3)}</div>`;
}

// Full-page skeleton (wrapper + body) — used by the router on navigation.
export function skeletonFor(key) {
  return `<div class="w-full max-w-6xl flex-1 px-8 py-7">${skeletonBody(key)}</div>`;
}
