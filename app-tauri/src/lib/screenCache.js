// Universal stale-while-revalidate cache for screen / tab loaders.
//
// Why this exists: every loader that does
//   root.innerHTML = '<div>loading…</div>';
//   const data = await api.someCall(...);
//   root.innerHTML = renderResult(data);
// pays the sidecar latency (500-2000 ms cold) on every visit. After a full
// app restart the localStorage cache survives, so a re-visit can paint in
// <10 ms while the fresh fetch runs in the background.
//
// Pattern:
//   const KEY = `insights.${topic}`;
//   const cached = readScreenCache(KEY);
//   if (cached) renderImmediately(cached);          // sync paint
//   const fresh = await api.realCall(topic);        // background refresh
//   writeScreenCache(KEY, fresh);
//   if (host.dataset.tab !== 'insights') return;   // user navigated away
//   renderImmediately(fresh);
//
// See docs/perf-audit.md for the per-screen rollout plan.
//
// Quotas: macOS WKWebView gives ~10 MB per origin. Each entry is small
// (typical insights payload < 50 KB), so we can keep ~200 entries before
// pressure. Eviction is by timestamp — we drop the oldest 25% when over
// MAX_ENTRIES.

const PREFIX = 'gapmap.screen.cache.';
const MAX_ENTRIES = 200;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days — long enough to bridge
                                          // app restarts; short enough that
                                          // a removed topic stops surfacing.

function _allKeys() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) out.push(k);
  }
  return out;
}

function _evictIfOverCap() {
  const keys = _allKeys();
  if (keys.length <= MAX_ENTRIES) return;
  // Sort by ts ascending; drop the oldest 25%.
  const dated = keys.map(k => {
    let ts = 0;
    try { ts = JSON.parse(localStorage.getItem(k))?.ts || 0; } catch {}
    return [k, ts];
  }).sort((a, b) => a[1] - b[1]);
  const drop = Math.ceil(MAX_ENTRIES * 0.25);
  for (let i = 0; i < drop && i < dated.length; i++) {
    try { localStorage.removeItem(dated[i][0]); } catch {}
  }
}

/** Read the cached payload for `key`. Returns `null` if missing, expired,
 *  or unparseable. Sync, fast, safe for first-paint. */
export function readScreenCache(key) {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    const ts = Number(obj.ts || 0);
    if (!ts || Date.now() - ts > TTL_MS) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return ('data' in obj) ? obj.data : null;
  } catch { return null; }
}

/** Persist `data` for `key`. No-op on quota errors (we'd rather miss a
 *  cache than crash). Triggers eviction if we cross the cap. */
export function writeScreenCache(key, data) {
  if (!key) return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
    _evictIfOverCap();
  } catch {}
}

/** Drop a single entry. */
export function clearScreenCache(key) {
  if (!key) return;
  try { localStorage.removeItem(PREFIX + key); } catch {}
}

/** Drop every entry whose key contains the substring `tag`. Used by the
 *  global mutation listener in main.js — e.g. on a `gapmap:changed`
 *  event of kind `findings`, we drop every `*findings*` cache so the
 *  next visit re-fetches fresh data. */
export function clearScreenCacheBy(tag) {
  if (!tag) return;
  for (const k of _allKeys()) {
    if (k.includes(tag)) {
      try { localStorage.removeItem(k); } catch {}
    }
  }
}

/** Drop every screen cache entry. */
export function clearAllScreenCache() {
  for (const k of _allKeys()) {
    try { localStorage.removeItem(k); } catch {}
  }
}
