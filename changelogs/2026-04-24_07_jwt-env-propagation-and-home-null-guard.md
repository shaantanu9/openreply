# JWT Env Propagation + Home Stale-Render Guard

**Date:** 2026-04-24
**Type:** Fix + Infrastructure

## Summary

Two issues from a single dev session:

1. Tauri rebuild warned `JWT_DESKTOP_SECRET missing; using debug fallback`.
   A Tauri binary built with the fallback secret would refuse to verify any
   JWT the Next.js server signs — silent cross-app activation failure.
2. Home screen crashed with `TypeError: null is not an object (evaluating
   'heroRoot.innerHTML = …')` when the user navigated away before the
   async overview_stats call resolved.

## Fix 1 — JWT env reaches cargo

The `build.rs` has two modes: use `JWT_DESKTOP_SECRET` from env, or fall
back to a hardcoded dev string (with a cargo warning) in debug profile.
The fallback fires when cargo can't see the env var — usually because
`npm run tauri dev` was launched from a shell that didn't export it.

Clean fix: kill the dangling tauri dev, source the server's `.env` to
get `TOKEN_SIGNING_SECRET`, export it as `JWT_DESKTOP_SECRET`, and
relaunch. The shell `export` propagates to cargo's build.rs subprocess.

Verified the new build:

```
fallback-warning fired 0 time(s) this session
```

Any stale `license_state.json` from a fallback-built binary would hold
a JWT signed with the fallback but verified with the real secret — a
guaranteed signature-mismatch wipe on next launch. Cleared it
defensively (was absent on this run anyway).

The runbook `docs/licence/tauri-activation-runbook.md` §2 already
documents the correct launch command; adding a note that the export
MUST be in the same shell as the `npm run tauri dev` or the fallback
silently wins.

## Fix 2 — Home screen null-deref

`renderHero(heroRoot, …)` writes to `heroRoot.innerHTML` without
checking whether the passed-in element still exists. The caller is
`root.querySelector('#hero-slot')` — which returns `null` if the route
changed between render start and the `overview_stats` resolve.

Added a single-line guard at the top:

```js
function renderHero(heroRoot, topTopic, stats, dailyCounts) {
  if (!heroRoot) return;
  …
}
```

This covers both call sites (lines 388 and 504 in `home.js`). Other
null-deref risks in the file are all inside sync event handlers (click
on a button that doesn't exist is safe — browser just drops the event),
so they don't need guards.

## Files Modified

- `app-tauri/src/screens/home.js`

## Tauri state after fix

- pid 75244 uptime 15 s, no fallback warning
- Vite HMR served the updated `home.js` (`Stale-render guard` comment
  present in the bundle).
- `docs/licence/tauri-activation-runbook.md` still the authoritative
  runbook for relaunching.
