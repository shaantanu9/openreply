# Splash Safety Net — Tauri Boot Never Gets Stuck

**Date:** 2026-04-24
**Type:** Fix

## Summary

Cold starts were sometimes leaving users stuck on the splash screen: the
frontend's `closeSplash()` call is gated on `await route()` returning, so
any early-boot throw (HMR disconnect, missing command binding after a
refactor, slow sidecar bindings) left the splash `alwaysOnTop:true`
window permanently on screen while the main window stayed
`visible:false`.

Two independent safety nets now guarantee the main window reveals on
every launch.

## Changes

1. **Rust — 6 s hard fallback timer.** `main.rs::setup()` now spawns a
   `tokio::time::sleep(6)` task that closes the splash + shows + focuses
   the main window regardless of what the frontend does. 6 s is longer
   than any healthy cold-start render and shorter than a user's "is it
   broken?" patience threshold. Idempotent with the frontend's explicit
   `close_splash` invoke — whichever fires first wins; the other becomes
   a no-op because `splash.close()` on a closed window is silent.

2. **Frontend — parallel closeSplash on next tick.** `src/main.js` now
   calls `setTimeout(() => api.closeSplash(), 0)` before `await
   route()` so the splash dismisses as soon as main.js runs, not when
   the first render returns. The existing post-route call stays as a
   double-dismiss safety net.

Both are idempotent. Normal boot: frontend fires closeSplash at T+0 of
its event loop, splash closes and main window shows. Unhealthy boot:
Rust fires closeSplash at T+6 s. Worst case: user waits 6 s instead of
staring at the splash forever.

### Third safety net — cold-boot webview heal

Added afterwards because the splash-dismiss alone left the main window
*visible but blank* in the dev-rebuild-racing-vite scenario. At T+6 s
Rust also runs:

```rust
main.eval("if(!document.querySelector('.app *')){location.reload();}");
```

If the initial navigation to `http://localhost:1420` happened before
vite had bound its socket, the webview stays blank. The reload forces a
re-navigation after vite is confirmed up. Idempotent with a populated
DOM — the selector check means already-rendered webviews aren't
disturbed.

## Files Modified

- `app-tauri/src-tauri/src/main.rs` — splash-safety spawn in `setup()`.
- `app-tauri/src/main.js` — `setTimeout(() => api.closeSplash(), 0)`
  before `await route()`.
