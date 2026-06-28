# Fix: convert PyInstaller sidecar from onefile → onedir (the real cause of "chat not working")

**Date:** 2026-06-01
**Type:** Fix

## Summary

Root-caused and fixed the actual reason chat (and the whole app) felt broken on
the installed build. The Python sidecar was shipped as a PyInstaller **onefile**
binary. A onefile binary re-extracts its entire ~390 MB archive to a fresh
`/var/folders/…/_MEI…` temp dir on **every single spawn** — measured at **~36 s
per spawn** on macOS (Gatekeeper re-verifies every `.so`), plus a ~390 MB temp
leak on any crash/kill.

The Tauri app spawns the sidecar many times (collect/chat/enrich streams +
one-shot fallbacks + the warm daemon), so:
- the frontend's 15 s timeout on chat conversation calls fired long before the
  36 s sidecar replied → the Chat sidebar stuck on "Loading…",
- the boot herd of cold one-shot spawns each leaked a 390 MB `_MEI` dir →
  filled the disk → `ENOSPC` / "Could not create temporary directory" → every
  sidecar call (chat included) failed.

The earlier `_09` changelog correctly identified the *storm + disk-fill
symptoms* and added pre-warm/reaper/timeout mitigations, but the underlying
36 s-per-spawn cost remained. **onedir** eliminates it: nothing is extracted at
runtime (the interpreter + every `.so` live on disk next to the exe under
`_internal/`), so a cold spawn drops to **~5 s** and a warm one to **~3 s**, with
**zero** `_MEI` extraction → no temp leak, no disk-fill.

Measured (bundled sidecar, same Mac, same data dir):

| | onefile (before) | onedir (after) |
|---|---|---|
| cold spawn | ~36–43 s | ~5–6 s |
| warm spawn | ~36 s | ~3 s |
| `_MEI` temp extraction | ~390 MB every spawn | none |

## How onedir is shipped (no changes to the complex Rust spawn/cancel logic)

Tauri's `externalBin`/sidecar mechanism only supports single files, not a
onedir folder. Rather than rewrite the streaming/cancel/daemon code, a tiny
**launcher script** is shipped as the externalBin (`openreply-cli-aarch64-apple-darwin`).
Tauri copies it to `Contents/MacOS/openreply-cli`, so both spawn paths resolve
"openreply-cli" exactly as before:
- streaming: `app.shell().sidecar("openreply-cli")`
- warm daemon: `resolve_bundled_sidecar()` → `current_exe` dir

The launcher `exec`s the real onedir exe shipped under
`Contents/Resources/binaries/openreply-cli-onedir/openreply-cli`. `exec` replaces the
process image, so the PID Rust tracks for cancel and the piped
stdin/stdout/stderr are all preserved (verified: daemon `_daemon_ready`
handshake works through the launcher).

## Changes

- **`openreply-cli.spec`** — `EXE(..., exclude_binaries=True)` + new `COLLECT(...)`
  → onedir output (`dist/openreply-cli/{openreply-cli, _internal/}`) instead of a
  single onefile EXE.
- **`app-tauri/src-tauri/binaries/openreply-cli-aarch64-apple-darwin`** — replaced
  the 190 MB onefile binary with a bash launcher that `exec`s the onedir exe
  from Resources (explicit `OPENREPLY_ONEDIR_EXE` override → known candidate paths
  → bounded `find` fallback). Old onefile kept as `*.onefile.bak`.
- **`app-tauri/src-tauri/binaries/openreply-cli-onedir/`** — the staged onedir
  bundle (exe + `_internal/`).
- **`app-tauri/src-tauri/tauri.conf.json`** — added
  `bundle.resources: ["binaries/openreply-cli-onedir/**/*"]` so the onedir ships
  under `Contents/Resources/`.

## Verification

- onedir spawn timing: 36 s → ~3 s warm, no `_MEI` extraction, no process leak.
- launcher resolves the onedir through a simulated bundle layout (rc=0).
- daemon handshake `{"_daemon_ready": true}` works through the launcher `exec`.
- `npm test` — 50/50 JS tests pass.
- Full `.app` rebuild + ad-hoc deep-sign + chat E2E — see below.

## Files Created

- `app-tauri/src-tauri/binaries/openreply-cli-aarch64-apple-darwin` (launcher script)
- `app-tauri/src-tauri/binaries/openreply-cli-onedir/` (onedir bundle)
- `changelogs/2026-06-01_10_sidecar-onefile-to-onedir-fixes-chat.md`

## Files Modified

- `openreply-cli.spec` — onefile → onedir (EXE exclude_binaries + COLLECT).
- `app-tauri/src-tauri/tauri.conf.json` — added `bundle.resources` for the onedir.

## Relationship to other changelogs

- `_09` added daemon pre-warm + reaper + raised lock timeouts (mitigations for
  the cold-one-shot storm). This (`_10`) removes the underlying 36 s-per-spawn
  cost that made those mitigations necessary in the first place. Together: warm
  daemon pre-paid at boot in ~5 s, every spawn cheap, no disk-fill.

## Follow-up

- Rebuild the `x86_64` onedir + launcher before any universal/Intel release
  (only `aarch64` was rebuilt for the dev machine).
- A new signed DMG is still required for already-installed users to receive
  this fix.
- Optional: lazy-import the heavy deps (chromadb/sklearn/scipy) to push the
  ~3 s warm spawn lower.
