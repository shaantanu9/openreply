# Follow-ups: bundled-CLI startup hang & MCP liveness (2026-06-01)

Context: `changelogs/2026-06-01_10_fix-bundled-binary-onefile-meipass-hang.md`.
Root cause was PyInstaller **onefile** per-launch `_MEI` extraction leaking dirs
(93 dirs / 29 GB) that filled the disk to 100% → bootloader hung on every launch.
The shipped code fix (auto-sweep orphaned `_MEI` + truthful MCP status) is a
safety net. The items below need a build/dashboard and were intentionally deferred.

## Build-required (next release)

- [ ] **CRITICAL — rebuild to ship the chromadb bundling fix** (`changelogs/2026-06-01_11`).
  The bundled `gapmap-cli` is missing `chromadb.telemetry.product.posthog` (dynamic
  import PyInstaller can't trace), so **chat RAG / semantic search / graph / mempalace
  are broken in the current installed app** (chat shows `✗ Error: No module named
  'chromadb.telemetry.product.posthog'` or, when disk was full, the 5-min timeout).
  Fix already applied to `gapmap-cli.spec` (added `'chromadb'` to the collect_all loop).
  Rebuild `gapmap-cli` + reinstall to deliver it. This is independent of (and more urgent
  than) the onedir change below.


- [ ] **Convert `gapmap-cli.spec` from onefile → onedir** (the real fix).
  - Add a `COLLECT(exe, a.binaries, a.datas, name='gapmap-cli')` after `EXE(...)`.
  - Result: `dist/gapmap-cli/gapmap-cli` + `dist/gapmap-cli/_internal/`. **No runtime
    extraction → no `_MEI`, no leak, no disk-full hang, ~1 s startup instead of 37–50 s.**
  - ⚠️ Tauri sidecar packaging change: the app bundles a single binary at
    `Gap Map.app/Contents/MacOS/gapmap-cli`. With onedir you must copy the whole
    `gapmap-cli/` folder into the app and have Rust spawn the inner binary. Update
    the Tauri build script / `tauri.conf.json` `externalBin` handling and re-test
    `npm run tauri:build` end-to-end before release.
  - Why deferred: can't verify packaging without a full app rebuild.

- [ ] **Verify the shipped `_MEI` sweep runs in the bundled build.** After the next
  build, launch the bundled `gapmap-cli` a few times, kill some mid-run, then confirm
  `/var/folders/.../T/_MEI*` count stays bounded (older orphans removed on next launch).

- [ ] **Consider tightening `DAEMON_HANDSHAKE_TIMEOUT_SECS` interaction.** It's 45 s
  while a cold onefile extraction was measured at ~49 s on a busy disk — a borderline
  case that kills the spawn and leaks an `_MEI`. Onedir makes this moot (startup ~1 s).
  Until onedir ships, the `_MEI` sweep keeps the disk healthy so extraction stays fast.

## UI wiring (frontend, next build)

- [ ] **Make the MCP card's "Connected" badge call `status(probe=True)`** (e.g. behind a
  "Verify connection" button / on Re-sync), so it reflects a real handshake instead of
  mere config presence. The Python/CLI side is done: `gapmap mcp status --probe --json`
  returns `live` / `handshake_ms` / `probe_error`. Wire the Rust command + JS to surface
  `live` and show "Configured but not responding" when `installed && !live`.

## One-time machine hygiene (done 2026-06-01, may recur until onedir ships)

- [x] Reclaimed 29 GB of leaked `_MEI` dirs; disk 100% → 97%.
- [ ] If the installed (onefile) app is used heavily before the onedir build ships,
  periodically check disk and clear orphaned `_MEI` dirs while the app is closed:
  `pkill -9 -f "Gap Map.app/Contents/MacOS/gapmap-cli" && rm -rf /var/folders/*/*/T/_MEI*`
