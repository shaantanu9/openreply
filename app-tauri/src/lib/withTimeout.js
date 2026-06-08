// withTimeout — reject a long-running promise after a hard ceiling so a hung
// backend LLM job surfaces as a normal error+retry in the UI instead of an
// infinite "analyzing…" spinner.
//
// The blocking topic pipelines (Concept Agent, insights synthesis, etc.) legit
// take 30-90s, but on big topics / cold sidecar daemon / a stalled LLM call
// they can hang indefinitely. The loaders only clear when their `await api.*`
// settles, so without a timeout a hang = forever loading. We can't cancel the
// Python-side job from here (it keeps running and may still persist results, so
// a later re-open shows them), but we CAN stop the UI from waiting forever.
//
// Default ceiling is deliberately well above the normal 30-90s range so it only
// trips on a true hang, not a slow-but-healthy run.

export const LLM_TAB_TIMEOUT_MS = 180_000; // 3 minutes

export class TimeoutError extends Error {
  constructor(label, ms) {
    super(`${label || 'This step'} timed out after ${Math.round(ms / 1000)}s. The job may still be running in the background — try again, or re-open the tab in a minute.`);
    this.name = 'TimeoutError';
    this.code = 'timeout';
  }
}

/**
 * Race `promise` against a timeout. Resolves with the promise's value if it
 * settles first; otherwise rejects with a TimeoutError.
 * @param {Promise<any>} promise the in-flight work (e.g. api.runConcepts(topic))
 * @param {number} [ms] ceiling in milliseconds (default LLM_TAB_TIMEOUT_MS)
 * @param {string} [label] human label for the error message
 */
export function withTimeout(promise, ms = LLM_TAB_TIMEOUT_MS, label = '') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
