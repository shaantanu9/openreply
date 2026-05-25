# Bundled binaries for the Tauri sidecar

Two binaries ship inside the built Tauri app. **Neither is committed to git** —
they are large build artifacts (the Python sidecar alone is ~230 MB), and
committing them once bloated the repo history to 1.5 GB. Build them locally on
a fresh clone; CI rebuilds both fresh on every tagged release (see
`.github/workflows/release.yml`).

| File | Build with | Size | Purpose |
|---|---|---|---|
| `gapmap-cli-aarch64-apple-darwin` | `pyinstaller gapmap-cli.spec` | ~230 MB | Python sidecar (the CLI powering every feature) |
| `ffmpeg-aarch64-apple-darwin` | `scripts/fetch-ffmpeg.sh` | ~48 MB | Static ffmpeg for yt-dlp audio extraction (video ingest) |

Both are listed in `.gitignore`.

## `gapmap-cli-aarch64-apple-darwin` — build the Python sidecar

```bash
# From the repo root, with the project installed (`uv sync --all-extras`):
pyinstaller gapmap-cli.spec
cp dist/gapmap-cli app-tauri/src-tauri/binaries/gapmap-cli-aarch64-apple-darwin
chmod +x app-tauri/src-tauri/binaries/gapmap-cli-aarch64-apple-darwin
codesign --force --deep --sign - \
  app-tauri/src-tauri/binaries/gapmap-cli-aarch64-apple-darwin   # ad-hoc, dev only
```

`scripts/build-pyinstaller.sh` / `scripts/publish-mac.sh` wrap this. The `.spec`
bundles the 83 MB ONNX MiniLM embedding model so semantic search works offline.

## `ffmpeg-aarch64-apple-darwin` — fetch ffmpeg

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

After `scripts/fetch-ffmpeg.sh` drops the binary here, `tauri.conf.json` already references it:

```json
"bundle": {
  "externalBin": [
    "binaries/gapmap",
    "binaries/ffmpeg"
  ]
}
```

Tauri auto-appends the triple suffix (`-aarch64-apple-darwin`) when picking the file. Codesigning runs against both binaries as part of `tauri build`.
