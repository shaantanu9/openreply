// Topic-recon card shown at the top of every collect screen.
//
// Runs three calls IN PARALLEL the moment a collect starts:
//   1. canonicalize_topic — gives us the canonical name + the 5–10
//      LLM-generated search keywords the sidecar will expand against.
//   2. discover_subs       — top N relevant subreddits (with subscriber
//      counts + relevance score) before any actual fetch.
//   3. collect_source_catalog — static list of every external source
//      the sidecar will sweep on this collect (HN, GitHub, App Store,
//      arXiv, OpenAlex, PubMed, GNews, Dev.to, Stack Overflow, etc.).
//
// As the collect progresses we listen for the sidecar's per-source log
// lines (`[hn] ✓ 23 posts`, `[r/Mortgages] ✓ 45 posts`, …) and flip the
// matching chip from "queued" → "fetched: N" so the user sees real
// numbers crystallising next to the predictions.
//
// Self-contained — uses esc() from api.js and the brand tokens already in
// style.css. mount() returns an unmount() so the screen can clean up.

import { api, esc } from '../api.js';
import { listen } from '@tauri-apps/api/event';

const STORE = new Map(); // topic → { subs, sources, canon, fetched }

function fmtSubscribers(n) {
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function chipHTML({ id, label, meta, fetched, failed }) {
  // Three visual states: failed (red, hover-tooltip = error reason),
  // fetched (accent + count pill), queued (gray hollow dot).
  let status = 'queued';
  if (failed) status = 'failed';
  else if (fetched != null) status = 'fetched';
  const idAttr = esc(String(id));
  const titleAttr = failed ? ` title="Failed: ${esc(String(failed))}"` : '';
  const countCell = failed
    ? '<span class="recon-chip-count recon-chip-count--err">!</span>'
    : (fetched != null ? `<span class="recon-chip-count">${fetched}</span>` : '');
  return `
    <span class="recon-chip recon-chip--${status}" data-source-id="${idAttr}"${titleAttr}>
      <span class="recon-chip-dot"></span>
      <span class="recon-chip-label">${esc(label)}</span>
      ${meta ? `<span class="recon-chip-meta">${esc(meta)}</span>` : ''}
      ${countCell}
    </span>`;
}

// Collapsed-by-default state. Click the header to expand. The choice is
// stashed on `state` (per-topic, lives in the module-level STORE) so a
// re-render preserves the user's pick.
function render(host, state) {
  const { canon, subs, sources, fetched, failed, expanded } = state;
  const isOpen = !!expanded;
  const failedMap = failed || new Map();

  const canonicalLine = canon
    ? (canon.canonical && canon.canonical !== canon.original
        ? `<span class="recon-canon"><b>${esc(canon.canonical)}</b><span class="recon-canon-from"> ← ${esc(canon.original)}</span></span>`
        : `<span class="recon-canon"><b>${esc(canon.original || '')}</b></span>`)
    : '<span class="recon-canon recon-skel">canonicalising…</span>';

  const keywordChips = canon?.search_keywords?.length
    ? canon.search_keywords.slice(0, 10).map((k) => {
        const txt = typeof k === 'string' ? k : (k.keyword || '');
        const rel = typeof k === 'object' ? (k.relevance || '') : '';
        return `<span class="recon-kw recon-kw--${esc(rel)}">${esc(txt)}</span>`;
      }).join('')
    : '';

  const subChips = subs == null
    ? '<span class="recon-skel">finding subreddits…</span>'
    : subs.length === 0
      ? '<span class="recon-empty">no high-relevance subreddits</span>'
      : subs.map((s) => {
          const key = `r/${(s.display_name || s.name || '').toLowerCase()}`;
          return chipHTML({
            id: `r/${s.display_name || s.name || ''}`,
            label: `r/${s.display_name || s.name || ''}`,
            meta: fmtSubscribers(s.subscribers),
            fetched: fetched.get(key),
            failed: failedMap.get(key),
          });
        }).join('');

  const sourceChips = sources == null
    ? '<span class="recon-skel">resolving sources…</span>'
    : sources.map((s) => chipHTML({
        id: s.id,
        label: s.label,
        fetched: fetched.get(s.id),
        failed: failedMap.get(s.id),
      })).join('');

  const subCount = subs?.length || 0;
  const srcCount = sources?.length || 0;
  const subText = subCount === 1 ? 'subreddit' : 'subreddits';
  const srcText = srcCount === 1 ? 'source' : 'sources';

  host.classList.toggle('is-open', isOpen);
  host.innerHTML = `
    <button type="button" class="recon-head" aria-expanded="${isOpen}" data-recon-toggle>
      <span class="recon-eyebrow">Sources we'll sweep</span>
      ${canonicalLine}
      <span class="recon-totals">${subCount} ${subText} · ${srcCount} external ${srcText}</span>
      <span class="recon-caret" aria-hidden="true">${isOpen ? '▾' : '▸'}</span>
    </button>
    <div class="recon-body" ${isOpen ? '' : 'hidden'}>
      ${keywordChips ? `<div class="recon-section recon-keywords"><span class="recon-section-label">Search expansions</span><div class="recon-row">${keywordChips}</div></div>` : ''}
      <div class="recon-section">
        <span class="recon-section-label">Reddit</span>
        <div class="recon-row recon-row--subs">${subChips}</div>
      </div>
      <div class="recon-section">
        <span class="recon-section-label">External</span>
        <div class="recon-row recon-row--sources">${sourceChips}</div>
      </div>
    </div>
  `;

  // Delegate the toggle to the host once — innerHTML inside re-renders wipes
  // child listeners but keeps host listeners intact, so we bind only on the
  // first render. (`__reconBound` flag guards against double-binding when
  // the same host is re-mounted.)
  if (!host.__reconBound) {
    host.__reconBound = true;
    host.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-recon-toggle]')) {
        state.expanded = !state.expanded;
        render(host, state);
      }
    });
  }
}

// Best-effort parser for the sidecar's per-source progress lines.
// Recognised shapes (collect.py emits these around line 600-650):
//   [k/N] [src] ✓ <N> posts (<elapsed>s)        →  source succeeded
//   [k/N] [src] ✗ <reason> (<elapsed>s)         →  source failed
//   [r/SubName] ✓ <N> posts                     →  reddit sub succeeded
//   pullpush <sub>: <reason>                    →  historical pull failed
// Returns either { id, count } for success, { id, failed: <reason> } for
// failure, or null if the line isn't a per-source signal.
function parseProgressLine(line) {
  if (!line || typeof line !== 'string') return null;

  // Failure first — `[..] [src] ✗ <reason>`
  const fail = line.match(/\[([^\]]+)\]\s*✗\s*(.+?)(?:\s*\(\d+\.?\d*s\))?$/);
  if (fail) {
    const id = fail[1].trim();
    const reason = fail[2].trim();
    // Skip the `[k/N]` step counter prefix — pick the LAST [..] before ✗.
    // Walk all `[…]` matches; take the last that doesn't look like "k/N".
    const all = [...line.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
    const stepLike = /^\d+\/\d+$/;
    const realId = [...all].reverse().find((s) => !stepLike.test(s)) || id;
    return realId.toLowerCase().startsWith('r/')
      ? { id: realId.toLowerCase(), failed: reason }
      : { id: realId, failed: reason };
  }

  // Success — `[..] ✓ N posts` or `[..] N posts`
  const ok = line.match(/^\s*\[([^\]]+)\]/);
  if (!ok) return null;
  const all = [...line.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
  const stepLike = /^\d+\/\d+$/;
  const realId = [...all].reverse().find((s) => !stepLike.test(s));
  if (!realId) return null;
  const count = line.match(/(\d+)\s*posts?\b/i);
  if (!count) return null;
  const n = parseInt(count[1], 10);
  if (!Number.isFinite(n)) return null;
  return realId.toLowerCase().startsWith('r/')
    ? { id: realId.toLowerCase(), count: n }
    : { id: realId, count: n };
}

// Bound the in-memory STORE so a long session doesn't accumulate per-topic
// state objects + Maps forever. Eight slots, evict-oldest. Each entry is
// small (a few hundred bytes plus per-source Maps); the cap is mostly
// defensive against a runaway-mount loop.
const STORE_MAX = 8;
function rememberState(topic, state) {
  STORE.set(topic, state);
  if (STORE.size > STORE_MAX) {
    const oldest = STORE.keys().next().value;
    if (oldest && oldest !== topic) STORE.delete(oldest);
  }
}

export async function mountReconCard(host, { topic, aggressive = true }) {
  if (!host) return () => {};
  host.classList.add('recon-card');
  host.innerHTML = '<div class="recon-loading">Reading topic…</div>';

  // Race-safety. If the screen unmounts while we're still `await`-ing
  // any of the parallel calls below, mark cancelled so any later
  // resolution (especially the `await listen(...)`) tears itself down
  // instead of leaking. Without this guard, fast nav A → B → A leaked
  // one listener per round-trip — each captured `host`, `state.fetched`,
  // and the full DOM, and each fired on every collect:progress line
  // (thousands per collect). This was the source of the 119 GB blow-up.
  let cancelled = false;
  let unlisten = null;

  const state = STORE.get(topic) || {
    canon: null, subs: null, sources: null,
    fetched: new Map(),  // id → post count (success)
    failed:  new Map(),  // id → error reason (failure)
  };
  if (!state.failed) state.failed = new Map();
  rememberState(topic, state);

  // Render-once even before promises resolve so the card is never blank.
  render(host, state);

  // Kick all three calls in parallel. Each settles independently.
  const promises = [
    api.canonicalizeTopic(topic).then((c) => { state.canon = c; render(host, state); })
      .catch((e) => console.warn('[recon] canonicalize failed:', e)),
    api.discoverSubs(topic, 10).then((res) => {
      state.subs = Array.isArray(res) ? res : (res?.subs || []);
      render(host, state);
    }).catch((e) => {
      console.warn('[recon] discover_subs failed:', e);
      state.subs = [];
      render(host, state);
    }),
    api.collectSourceCatalog(aggressive).then((cat) => {
      state.sources = Array.isArray(cat) ? cat : [];
      render(host, state);
    }).catch((e) => {
      console.warn('[recon] source catalog failed:', e);
      state.sources = [];
      render(host, state);
    }),
  ];

  // Live update: each progress line that names a source bumps its chip.
  // Success (`✓ N posts`) writes to state.fetched; failure (`✗ reason`)
  // writes to state.failed and the chip turns red with a hover tooltip
  // showing the reason ("HTTP 503", "rate limited", etc.).
  try {
    unlisten = await listen('collect:progress', (e) => {
      const parsed = parseProgressLine(e?.payload || '');
      if (!parsed) return;
      if (parsed.failed) {
        state.failed.set(parsed.id, parsed.failed);
        // Clear any prior success count for this id — the source's final
        // word was a failure (e.g. retried but ultimately gave up).
        state.fetched.delete(parsed.id);
      } else if (parsed.count != null) {
        state.fetched.set(parsed.id, parsed.count);
        // If a prior failure was logged but a later success arrived
        // (unusual, but possible on retry), clear the red flag.
        state.failed.delete(parsed.id);
      }
      render(host, state);
    });
  } catch (e) {
    console.warn('[recon] could not subscribe to collect:progress:', e);
  }

  await Promise.allSettled(promises);

  return function unmount() {
    try { unlisten?.(); } catch {}
    // Don't clear STORE — if user navigates back to the same topic the
    // already-fetched chip counts persist for nicer UX.
  };
}
