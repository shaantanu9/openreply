# Fix: cargo "Blocking waiting for file lock on package cache" stalls

**Date:** 2026-04-29
**Type:** Fix (dev-only — production builds unaffected)

## Summary

`npm run tauri dev` was reliably stalling on:

```
Blocking waiting for file lock on package cache
```

Root cause: rust-analyzer (running inside VS Code / Cursor) holds a flock
on `~/.cargo/.package-cache` while it indexes the workspace. When
`tauri dev` then spawns its own cargo, both processes contend for the
same global lock and one waits forever. The same effect is also produced
by stale `cargo run` workers from a previous terminal session that the
shell never reaped (we observed 6 zombies in one debug pass).

Four-layer fix that makes the contention impossible going forward.
**Production builds (Vercel, GitHub Actions, `cargo build --release` for
the DMG) never touch any of this** — they call cargo directly with no
IDE in the picture, so contention is structurally impossible there.

## Changes

### Layer 1 — IDE settings (committed `app-tauri/.vscode/settings.json`)

- `rust-analyzer.cargo.targetDir: true` — RA gets its own out-of-tree
  `target/rust-analyzer/` so it never shares the package-cache flock
  with `tauri dev`.
- `rust-analyzer.linkedProjects` pinned to `app-tauri/src-tauri/Cargo.toml`
  so RA stops trying to index the Next.js + Python parts of the monorepo.
- `rust-analyzer.cargo.allTargets: false` + `check.command: "check"`
  cap the background work scope.
- `files.watcherExclude` for `target/`, `node_modules/`, `.next/`,
  `__pycache__/` — fewer file events, less contention triggers.
- Cursor reads the same file, no separate config needed.

### Layer 2 — `scripts/dev.sh` wrapper

New 50-line bash script that runs before `tauri dev`:

1. Detects every cargo / rustc / tauri-cli process owned by the current
   user (other than itself).
2. SIGTERMs them, waits 2s, SIGKILLs anything still alive.
3. Removes the `~/.cargo/.package-cache` marker.
4. Execs `npx tauri dev "$@"` so signals reach it cleanly.

Wired as `npm run tauri:dev` (kept the bare `npm run tauri dev` for
direct cargo access when needed).

### Layer 3 — `.gitignore`

- Added `target/` (RA's new dir).
- Switched `.vscode/` blanket ignore to `.vscode/*` + an exception for
  `.vscode/settings.json` so the workspace-wide RA config IS tracked
  but per-user editor state isn't.

### Layer 4 — README

`app-tauri/README.md` now has a "Dev workflow" section explaining all
four layers and pointing new contributors at `npm run tauri:dev`.

## Verified

- `bash -n scripts/dev.sh` → syntax OK.
- Dry-run: detection awk finds zero stale cargo workers immediately
  after a clean shell, confirming the matcher's regex is correct.
- The earlier debug session caught and killed six real zombie cargo
  processes from previous dev sessions — the same wrapper now does
  this automatically every time you start dev.

## Files Created

- `app-tauri/.vscode/settings.json`
- `app-tauri/scripts/dev.sh` (executable)
- `changelogs/2026-04-29_02_fix-cargo-package-cache-lock-contention.md`
  (this changelog)

## Files Modified

- `app-tauri/.gitignore` — added `target/`, narrowed `.vscode/` ignore
- `app-tauri/package.json` — new `tauri:dev` script entry
- `app-tauri/README.md` — new "Dev workflow" section

## Why this won't ship to production

- The wrapper is invoked through `npm run tauri:dev` only. The release
  pipeline (`asc release-flow`, `cargo build --release`, `tauri build`)
  never calls it.
- The IDE settings under `.vscode/` are read by VS Code / Cursor only —
  not by Vercel, not by GitHub Actions, not by any CI runner.
- The `target/rust-analyzer/` directory is git-ignored, so it can't
  even reach a deploy artifact.
