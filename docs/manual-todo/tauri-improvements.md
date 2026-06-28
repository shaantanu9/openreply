# Tauri App Improvements — OpenReply

Tracking list for applying Tauri skills to `app-tauri/`. Check items off as completed.

**Last updated:** 2026-04-19

---

## Phase 1 — Security

- [x] **CSP configuration** (`tauri-csp`) — 2026-04-19
  - Replaced `"csp": null` with strict directives
  - Allowed: self scripts, Google Fonts, asset: protocol for reports, ipc: for IPC, http(s): for Ollama
  - Blocked: object-src, inline scripts, external scripts, frame-ancestors
  - File: `src-tauri/tauri.conf.json`

- [x] **Capabilities tightening** (`tauri-capabilities` + `tauri-permissions`) — 2026-04-19
  - Removed broad `dialog:default` → `dialog:allow-open` only
  - Removed `shell:default` entirely (frontend doesn't use plugin-shell directly)
  - Kept scoped `shell:allow-execute` + `shell:allow-spawn` for `binaries/reddit-cli`
  - File: `src-tauri/capabilities/default.json`

---

## Phase 2 — Sidecar + Reliability

- [x] **Sidecar code review** (`tauri-sidecar`) — 2026-04-19
  - `cli.rs` is already well-structured: plugin-shell usage correct, streaming via `CommandEvent`, cancellation via shared state, bounded memory (VecDeque cap 40), error classification
  - No code changes needed

- [x] **Cross-platform sidecar builds** — 2026-04-19 (via CI)
  - GitHub Actions workflow builds sidecar on each platform's runner (see Phase 4)
  - Local dev still only needs aarch64 Mac binary

---

## Phase 3 — UX + Binary

- [x] **Binary size optimization** (`tauri-binary-size`) — 2026-04-19
  - Added `[profile.release]`: `codegen-units = 1`, `lto = true`, `opt-level = "s"`, `panic = "abort"`, `strip = true`
  - Added `"removeUnusedCommands": true` (Tauri 2.4+ ACL-based dead-code elimination)
  - Files: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`

- [x] **Splashscreen** (`tauri-splashscreen`) — 2026-04-19
  - Main window now starts hidden (`visible: false`); splash covers cold-start gap
  - Dark gradient splash branded as OpenReply with sliding progress bar
  - Closes as soon as first route renders (`api.closeSplash()` after `route()`)
  - Files: new `splash.html`, `vite.config.js` rollupOptions input, `src-tauri/tauri.conf.json` windows[], `src-tauri/src/commands.rs` (`close_splash`), `src-tauri/src/main.rs` invoke handler, `src/api.js`, `src/main.js`

- [ ] **Window customization** (`tauri-window-customization`) — NOT DONE
  - Opinionated UI change — skipped to avoid regressing recent welcome polish
  - Revisit only if the standard window chrome feels wrong

---

## Phase 4 — Ship readiness

- [x] **Distribution config stubs** (`tauri-macos-distribution`) — 2026-04-19
  - Added `bundle.category = "DeveloperTool"`, `copyright`, descriptions
  - Added `bundle.macOS.minimumSystemVersion = "10.15"` (Catalina, earliest supported by Tauri v2)
  - Added `bundle.macOS.entitlements = "./Entitlements.plist"` with hardened-runtime exceptions for PyInstaller sidecar (allow-unsigned-executable-memory, disable-library-validation, allow-dyld-env-vars) + network.client + user-selected files
  - Files: `src-tauri/tauri.conf.json`, new `src-tauri/Entitlements.plist`

- [x] **GitHub Actions release pipeline** (`tauri-pipeline-github`) — 2026-04-19
  - Cross-platform matrix: `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`, `x86_64-pc-windows-msvc`
  - Each platform builds its own PyInstaller sidecar → stages to `app-tauri/src-tauri/binaries/`
  - Runs `tauri-action@v0` to produce bundle + draft release
  - Triggers: tag push `v*` or manual `workflow_dispatch`
  - Signing env vars (`APPLE_*`, `TAURI_SIGNING_*`) wired but optional — unsigned output if secrets unset
  - File: `.github/workflows/release.yml`

- [ ] **Code signing credentials** (`tauri-code-signing`) — BLOCKED on user
  - Need: Apple Developer ID cert (export as base64 → `APPLE_CERTIFICATE` secret + `APPLE_CERTIFICATE_PASSWORD`)
  - Need: `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), `APPLE_TEAM_ID`
  - Without these, CI still builds but artifacts are unsigned — Gatekeeper will block end users on download
  - See: https://v2.tauri.app/distribute/sign/macos

---

## Phase 6 — Accessibility + focus management (2026-04-19)

- [x] **Aria-labels on icon-only buttons** — copy-log, clear-log, byok-model-delete
- [x] **Modal focus traps** — new-topic modal (main.js) and BYOK modal: Tab cycles within dialog, first input auto-focused on open, focus returned to caller on close
- [x] **SWR dashboard cache** — home.js paints from `openreply.dashboard.cache.v1` localStorage instantly on mount, then background-refreshes (covered by `tauri-python-sidecar-app` skill Phase 6)

## Phase 5 — UI responsiveness + polish (from full-app audit 2026-04-19)

- [x] **Utility button classes** — added `.btn-sm`, `.btn-xs`, `.btn-bordered`, `.btn-danger`, `.btn-danger-ghost` to style.css
- [x] **Inline-style sweep** — replaced all 44 inline `style="padding:...;font-size:..."` declarations across 9 screens (settings, home, welcome, science, byok, topic, reports, collect, database) with the new utility classes
- [x] **Responsive grid fixes** (per `tauri-python-sidecar-app` Phase 7):
  - `.stat-grid` → `repeat(4, minmax(0, 1fr))`
  - `.topic-grid` → `repeat(auto-fit, minmax(min(260px, 100%), 1fr))` (was fixed 4 cols)
  - `.settings-profile-fields` → `repeat(2, minmax(0, 1fr))`
  - `.hero` → `minmax(0, 1.4fr) minmax(0, 1fr)`
  - `.two-col` → `minmax(0, 1.5fr) minmax(0, 1fr)`
  - `.ingest-wrap` → `minmax(0, 1.6fr) minmax(0, 1fr)`
  - `.db-grid`, `.reports-layout` → right column now `minmax(0, 1fr)` (was raw `1fr`, causing squish)
- [x] **Flex min-width:0 fixes**:
  - `.kv-row` — gap + align-items baseline + span truncation (no more file-path overflow)
  - `.settings-profile-head` — inner div shrinks cleanly; name/email ellipses instead of overflow
- [x] **Settings stale-route race** — every async card fill now gated by `alive()` (checks `root.dataset.routeGen` + `isConnected`), dedup'd the double `api.byokStatus()` fetch into one

- [ ] **Debugging** (`tauri-debugging`) — use when hitting issues
- [ ] **Testing** (`tauri-testing`) — add Tauri-side tests
- [ ] **Updating dependencies** (`tauri-updating-dependencies`) — periodic

---

## Summary — what was shipped

| Skill | Status | Impact |
|-------|--------|--------|
| tauri-csp | ✅ | XSS hardening |
| tauri-capabilities + tauri-permissions | ✅ | Principle of least privilege |
| tauri-sidecar | ✅ (review) | No changes — already solid |
| tauri-binary-size | ✅ | Smaller Rust binary (sidecar still dominates total size) |
| tauri-splashscreen | ✅ | Hides cold-start blank webview |
| tauri-macos-distribution | ✅ | Entitlements + bundle metadata |
| tauri-pipeline-github | ✅ | Cross-platform CI produces draft releases |
| tauri-code-signing | ⏸ | Blocked on Apple Dev credentials |
| tauri-window-customization | ⏸ | Skipped — avoid regressing recent UI polish |

## Next actions (for the user)

1. **Verify local dev still works:** `npm run tauri dev` in `app-tauri/` — splash appears, main window opens after first render, no CSP errors in devtools
2. **Verify splash.html is found:** Vite dev server serves it at `http://localhost:1420/splash.html`
3. **To ship v0.1.0:** `git tag v0.1.0 && git push origin v0.1.0` → CI builds all 4 platforms → draft release appears in GitHub UI
4. **To sign macOS builds:** add the `APPLE_*` secrets to the repo (Settings → Secrets → Actions)
