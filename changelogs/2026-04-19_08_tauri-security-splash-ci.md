# Tauri security, splashscreen, distribution config, and GitHub Actions release pipeline

**Date:** 2026-04-19
**Type:** Infrastructure + Security

## Summary

Hardened the Tauri app security posture (CSP, scoped capabilities), added a branded splashscreen to cover cold-start, optimised the release binary, added macOS bundle + entitlements config for the PyInstaller sidecar's hardened-runtime needs, and set up a cross-platform GitHub Actions release pipeline that builds the Python sidecar on each runner before invoking `tauri-action`.

## Changes

- **CSP** — replaced `"csp": null` with a strict policy allowing self-hosted scripts, Google Fonts, Tauri asset protocol, ipc:, and user-configurable HTTP/HTTPS for Ollama fetches.
- **Capabilities** — removed broad `dialog:default` and `shell:default`; kept only scoped `shell:allow-execute` + `shell:allow-spawn` for the `reddit-cli` sidecar and `dialog:allow-open` for the file picker.
- **Splashscreen** — new `splash.html` (cream + orange OpenReply branding matching the app); main window starts hidden and is revealed by a new `close_splash` Rust command after the first route renders.
- **Binary size** — added `[profile.release]` with `lto = true`, `opt-level = "s"`, `codegen-units = 1`, `panic = "abort"`, `strip = true`; enabled Tauri 2.4+ `removeUnusedCommands`.
- **macOS bundle** — added `bundle.category = "DeveloperTool"`, copyright, descriptions, `minimumSystemVersion = "10.15"`; new `Entitlements.plist` permits `com.apple.security.cs.allow-unsigned-executable-memory` / `disable-library-validation` / `allow-dyld-environment-variables` (required for PyInstaller sidecar under hardened runtime) plus `network.client` and `files.user-selected.read-write`.
- **GitHub Actions release pipeline** — `.github/workflows/release.yml` triggers on `v*` tags / `workflow_dispatch`; 4-platform matrix (aarch64-apple-darwin, x86_64-apple-darwin, x86_64-unknown-linux-gnu, x86_64-pc-windows-msvc); each runner builds its own PyInstaller sidecar, stages it into `app-tauri/src-tauri/binaries/`, then runs `tauri-action@v0` with optional Apple / Tauri-updater signing env vars wired to repo secrets.

## Files Created

- `app-tauri/splash.html`
- `app-tauri/src-tauri/Entitlements.plist`
- `.github/workflows/release.yml`
- `docs/manual-todo/tauri-improvements.md` (tracking file)

## Files Modified

- `app-tauri/src-tauri/tauri.conf.json` — CSP, splash window, macOS bundle config, `removeUnusedCommands`
- `app-tauri/src-tauri/capabilities/default.json` — scoped permissions
- `app-tauri/src-tauri/Cargo.toml` — release profile
- `app-tauri/src-tauri/src/main.rs` — registered `close_splash` command
- `app-tauri/src-tauri/src/commands.rs` — new `close_splash` command
- `app-tauri/src/main.js` — `await route()` then `api.closeSplash()`
- `app-tauri/src/api.js` — `closeSplash` binding
- `app-tauri/vite.config.js` — rollupOptions with `main` + `splash` inputs
