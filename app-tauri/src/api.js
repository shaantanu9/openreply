// Thin wrapper over Tauri's invoke + event API.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// One-time runtime diagnostic — logs once at load so we know if we're
// inside the webview. The previous pre-flight guard was producing false
// positives, so we trust Tauri's own invoke() to surface real errors.
if (typeof window !== 'undefined') {
  const inTauri = typeof isTauri === 'function' ? isTauri() : !!window.__TAURI_INTERNALS__;
  console.info('[api] tauri runtime:', inTauri ? 'yes' : 'NO');
}

export const api = {
  cliInfo:         ()        => invoke('cli_info'),
  listTopics:      ()        => invoke('list_topics'),
  overviewStats:   ()        => invoke('overview_stats'),
  recentActivity:  ()        => invoke('recent_activity'),
  discoverSubs:    (topic, limit = 10) => invoke('discover_subs', { topic, limit }),
  startCollect:    (topic, aggressive = true) => invoke('start_collect', { topic, aggressive }),
  cancelCollect:   ()        => invoke('cancel_collect'),
  collectStatus:   ()        => invoke('collect_status'),
  buildGraph:      (topic)   => invoke('build_graph', { topic }),
  exportHtml:      (topic)   => invoke('export_html', { topic }),
  exportReportPro: (topic)   => invoke('export_report_pro', { topic }),
  getFindings:     (topic, kind) => invoke('get_findings', { topic, kind }),
  ingestFile:      (path, topic, sourceType) => invoke('ingest_file', { path, topic, sourceType }),
  listExports:     ()        => invoke('list_exports'),
  deleteTopic:     (topic)   => invoke('delete_topic', { topic }),
  revealInFinder:  (path)    => invoke('reveal_in_finder', { path }),
  appDataDir:      ()        => invoke('app_data_dir'),
  openUrl:         (url)     => invoke('open_url', { url }),
  byokStatus:      ()        => invoke('byok_status'),
  byokSet:         (name, value) => invoke('byok_set', { name, value }),
  runQuery:        (sql)     => invoke('run_query', { sql }),
  startChat:       (topic, question, mode) => invoke('start_chat', { topic, question, mode }),
  cancelChat:      ()        => invoke('cancel_chat'),
  chatStatus:      ()        => invoke('chat_status'),
  onCollectProgress: (cb) => listen('collect:progress', e => cb(e.payload)),
  onCollectDone:     (cb) => listen('collect:done',     e => cb(e.payload)),
  onChatProgress:    (cb) => listen('chat:progress',    e => cb(e.payload)),
  onChatDone:        (cb) => listen('chat:done',        e => cb(e.payload)),
};

// ---------- tiny DOM helpers ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') el.className = v;
    else if (k === 'onClick') el.addEventListener('click', v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v != null) el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
export function fmtN(n) {
  if (n == null) return '—';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}
export function timeAgo(ts) {
  if (!ts) return '—';
  let d;
  try { d = new Date(ts); } catch { return '—'; }
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs/60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs/3600)}h ago`;
  return `${Math.floor(secs/86400)}d ago`;
}
