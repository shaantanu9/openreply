// Tracks the last enrichment tick timestamp per topic so tab headers can
// render a small "Updated Xs ago" freshness string. Shared module so every
// tab (Findings / Map / Gaps / Solutions) reads the same state.
//
// The `gapmap:changed` listener below is fed by main.js, which translates
// `enrich:tick` Tauri events into `mutated('findings', {topics: [...]})`
// calls via api.js. We key freshness per-topic when the payload includes a
// `topics` array; otherwise we only bump the global last-tick timestamp.
//
// `wireFreshnessBadge(el, topic, opts)` mounts a 1-Hz refresh into `el` —
// the caller must pass a DOM element that lives inside the topic-page
// render; once that element is detached from the document, the interval
// self-clears.

const _state = { byTopic: new Map(), lastGlobalTick: 0 };

if (typeof window !== 'undefined') {
  window.addEventListener('gapmap:changed', (e) => {
    if (e.detail?.kind !== 'findings') return;
    _state.lastGlobalTick = Date.now();
    if (Array.isArray(e.detail?.topics)) {
      for (const t of e.detail.topics) _state.byTopic.set(t, Date.now());
    } else if (typeof e.detail?.topic === 'string') {
      _state.byTopic.set(e.detail.topic, Date.now());
    }
  });
}

export function lastTick(topic) {
  return topic ? (_state.byTopic.get(topic) || 0) : _state.lastGlobalTick;
}

export function formatAge(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5)    return 'just now';
  if (s < 60)   return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

/**
 * Mount a freshness-badge updater into `el`. Writes
 * `Updated <age>[ · <counts>]` once and then every `interval` ms while `el`
 * is still attached. Returns a teardown fn the caller can ignore — when the
 * element is removed from the DOM, the interval self-clears on the next tick.
 */
export function wireFreshnessBadge(el, topic, { interval = 1000, getCounts } = {}) {
  if (!el) return () => {};
  let lastCounts = '';
  const tick = async () => {
    if (!el.isConnected) { clearInterval(id); return; }
    const age = formatAge(lastTick(topic));
    if (typeof getCounts === 'function') {
      try {
        const c = await getCounts();
        if (typeof c === 'string') lastCounts = c;
      } catch { /* keep last counts; sidecar hiccup is non-fatal */ }
    }
    el.textContent = `Updated ${age}${lastCounts ? ' · ' + lastCounts : ''}`;
  };
  tick();
  const id = setInterval(tick, interval);
  return () => clearInterval(id);
}
