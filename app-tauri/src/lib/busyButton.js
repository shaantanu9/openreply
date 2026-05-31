// Shared "button is working" helpers.
//
// Two tiers, matching the loader-progress-ux skill:
//
//   withButtonBusy(btn, fn, opts)
//     Inline busy state for ANY action button (Submit / Run / Generate /
//     Collect / Save). Disables the button, swaps its label for a spinner +
//     "Working…", runs the async fn, then restores — even on error. Use for
//     short-to-medium actions where the result lands in the same view.
//
//   withRichLoader(containerEl, fn, opts)
//     For genuinely slow (5s+) actions whose result fills a content area.
//     Mounts the full "Analyzing" hero (spinner + elapsed counter + cycling
//     stages + asymptotic bar + skeletons) from analyzingLoader.js into
//     containerEl, runs fn, snaps the bar to 100% and returns the result so
//     the caller can paint real content. Pair with a busy button via
//     `withButtonBusy(btn, () => withRichLoader(el, fn, …))`.
//
// Both are idempotent-safe: a null/missing button or container degrades to
// just running fn.

const SPINNER = '<span class="btn-spin" aria-hidden="true"></span>';

/**
 * Run `fn` while `btn` shows an inline spinner + busy label.
 * @param {HTMLElement|null} btn
 * @param {() => Promise<any>} fn
 * @param {{busyLabel?:string}} [opts]
 */
export async function withButtonBusy(btn, fn, { busyLabel = 'Working…' } = {}) {
  if (!btn) return fn();
  const origHtml = btn.innerHTML;
  const origDisabled = btn.disabled;
  const origWidth = btn.style.width;
  // Pin the current width so the button doesn't visibly resize when its label
  // shortens to "Working…", which otherwise causes a layout jump.
  btn.style.width = `${btn.offsetWidth}px`;
  btn.disabled = true;
  btn.classList.add('is-busy');
  btn.innerHTML = `${SPINNER}<span>${escapeText(busyLabel)}</span>`;
  try {
    return await fn();
  } finally {
    btn.classList.remove('is-busy');
    btn.disabled = origDisabled;
    btn.innerHTML = origHtml;
    btn.style.width = origWidth;
  }
}

/**
 * Run `fn` while `containerEl` shows the rich "Analyzing" hero.
 * Returns whatever `fn` resolves to (caller paints real content after).
 * @param {HTMLElement|null} containerEl
 * @param {() => Promise<any>} fn
 * @param {object} [opts]  forwarded to renderAnalyzingState (headline, stages,
 *                         medianRuntimeSec, skeletonCount, runKey, …)
 */
export async function withRichLoader(containerEl, fn, opts = {}) {
  if (!containerEl) return fn();
  const { renderAnalyzingState } = await import('./analyzingLoader.js');
  const stop = renderAnalyzingState(containerEl, opts);
  try {
    const result = await fn();
    stop({ snapToComplete: true });
    return result;
  } catch (e) {
    stop();
    throw e;
  }
}

function escapeText(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export default { withButtonBusy, withRichLoader };
