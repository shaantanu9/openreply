# Onboarding Step 3 — Never Block The User

**Date:** 2026-04-24
**Type:** Fix + UX

## Summary

User reported "configure LLM provider in onboarding is not working and keeps
loading". Root cause: Step 3's system-check orchestration disabled the
Continue button while it waited on a cold Python sidecar health check
(up to 15 s) and then sequentially awaited provider tests (up to 12 s
each via `Promise.all`). On a fresh DMG or first-dev `uv run` spawn the
combined wait could feel like a hang even though the code did eventually
recover via `try/catch` → enable.

Two related issues were also sitting on Step 3:
- Button text flipped to "Running checks…" mid-check, so the user saw a
  disabled button with changing text and reasonably concluded "stuck".
- A hard block (`continueBtn.disabled = mandatoryFailed`) could leave a
  user with a legitimate broken sidecar trapped on Step 3 forever.

## Fix

`renderStep3` in `app-tauri/src/screens/welcome.js`:

1. **Continue is enabled from the start.** No button-disabled moment
   during the async checks. The button text stays stable
   (`Continue →` / `Continue without AI →`).
2. **Checks surfaced as supplementary info**, not as gating. The health
   card + LLM grid still paint red/green markers so the user knows what
   needs fixing, but they can continue whenever.
3. **Tighter timeouts.** `runHealthCheck()` drops from 15 s → 8 s;
   per-provider `api.testLlm()` drops from 12 s → 6 s. With `Promise.all`
   running tests in parallel, the bounded wait is ~6 s regardless of how
   many providers are configured.
4. **Inline-status copy** now reassures: `"… (you can continue whenever)"`
   instead of the alarmed "Running checks…" banner.
5. **Mandatory-failure path is advisory, not blocking.** If sidecar / DB
   / palace report issues, the status strip says so but the button still
   works — Settings can fix it post-onboarding.

## Files Modified

- `app-tauri/src/screens/welcome.js` — non-blocking `runOnce`, timeout
  reductions, copy updates.

## Verified

- Vite HMR served the updated file (`grep -c "never block the user"` → 1).
- Tauri app pid 75244 still running, no fallback JWT warnings.
- tsc/Rust compile clean.

## Side-note — future tuning

If Python sidecar cold-start on a DMG install consistently exceeds 8 s,
bump the health-check timeout back up to 12 s rather than lowering
further; 8 s is already the lower edge of "user tolerable".

If provider /v1/models calls become a common hang point, also wrap
`api.listProviderModels()` in `byok.js` with a similar timeout (it's
called from the BYOK modal's model-picker, which can feel stuck the
same way).
