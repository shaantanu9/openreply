# Bundled binaries for the Tauri sidecar

Two binaries ship alongside the Tauri app:

| File | Source | Size | Purpose |
|---|---|---|---|
| `reddit-cli-aarch64-apple-darwin` | `pyinstaller reddit-cli.spec` | ~65 MB | Python sidecar (the CLI powering every feature) |
| `ffmpeg-aarch64-apple-darwin` | `scripts/fetch-ffmpeg.sh` | ~30 MB | Static ffmpeg for yt-dlp audio extraction (video ingest) |

## `ffmpeg-aarch64-apple-darwin` — not in git

Too big to commit. Run once on a fresh clone:

```bash
bash scripts/fetch-ffmpeg.sh
```

Downloads a static arm64 build into this directory. The Rust side (`cli.rs::resolve_ffmpeg_path`) picks it up automatically at sidecar spawn time and sets `GAPMAP_FFMPEG_PATH` so yt-dlp uses it instead of a system install.

Resolution order when the sidecar spawns:

1. `GAPMAP_FFMPEG_PATH` env (dev override — e.g. `/opt/homebrew/bin/ffmpeg`).
2. Bundled path inside the Tauri resource dir (shipped DMG).
3. This dir under `app-tauri/src-tauri/binaries/` (dev layout).
4. System PATH (`/opt/homebrew/bin/ffmpeg`, `/usr/local/bin/ffmpeg`, `/usr/bin/ffmpeg`).

If nothing resolves, the Python side raises a clean error and the UI surfaces a "bundled ffmpeg missing — run `scripts/fetch-ffmpeg.sh`" toast.

## To include ffmpeg in the DMG

After `scripts/fetch-ffmpeg.sh` drops the binary here, add it to `tauri.conf.json`:

```json
"bundle": {
  "externalBin": [
    "binaries/reddit-cli",
    "binaries/ffmpeg"
  ]
}
```

Tauri auto-appends the triple suffix (`-aarch64-apple-darwin`) when picking the file. Codesigning runs against both binaries as part of `tauri build`.
