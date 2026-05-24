// Canonical empty-state primitive.
//
// The rich implementation + preset library lives in lib/empty.js. This
// module re-exports it under the components/ namespace so all four
// layout primitives (PageShell, EmptyState, LoadingSkeleton, ErrorCard)
// share one import home. New screens should import from here:
//
//   import { emptyState, EMPTY_PRESETS } from '../components/EmptyState.js';
//   contentEl.innerHTML = emptyState(EMPTY_PRESETS.posts_empty());
//
// `emptyState` is an alias of `renderEmpty`. Existing screens that
// import `renderEmpty` from '../lib/empty.js' keep working unchanged.

export { renderEmpty, renderEmpty as emptyState, EMPTY_PRESETS } from '../lib/empty.js';
