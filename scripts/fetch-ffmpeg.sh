#!/usr/bin/env bash
# Download a static ffmpeg binary for the Tauri DMG bundle.
#
# macOS arm64 static builds come from https://www.osxexperts.net/ (the
# de-facto go-to for notarized static ffmpeg; mirrors evermeet.cx builds).
# We keep this out of git because it's ~30 MB — run this script before
# `tauri build` on a fresh clone.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${HERE}/../app-tauri/src-tauri/binaries"
mkdir -p "$TARGET_DIR"
TARGET="${TARGET_DIR}/ffmpeg-aarch64-apple-darwin"

if [[ -x "$TARGET" ]]; then
    echo "ffmpeg already present at $TARGET — skipping download."
    echo "Delete the file and re-run to force a refresh."
    exit 0
fi

# Try a list of known mirror names in order. osxexperts often renames
# between FFmpeg major releases; if every mirror 404s, fall back to a
# symlink of the system ffmpeg so dev-mode at least works.
URLS=(
  "${FFMPEG_DOWNLOAD_URL:-}"
  "https://www.osxexperts.net/ffmpeg711arm.zip"
  "https://www.osxexperts.net/ffmpeg71arm.zip"
  "https://www.osxexperts.net/ffmpeg7arm.zip"
  "https://www.osxexperts.net/ffmpeg8arm.zip"
)
TMPZIP="$(mktemp /tmp/gapmap-ffmpeg.XXXXXX.zip)"
trap 'rm -f "$TMPZIP"' EXIT

success=0
for u in "${URLS[@]}"; do
  [[ -z "$u" ]] && continue
  echo "Trying $u …"
  if curl --fail --silent --location "$u" -o "$TMPZIP" 2>/dev/null; then
    if unzip -o -j "$TMPZIP" -d "$TARGET_DIR" ffmpeg 2>/dev/null; then
      mv "$TARGET_DIR/ffmpeg" "$TARGET"
      chmod +x "$TARGET"
      xattr -c "$TARGET" 2>/dev/null || true
      echo "✓ Installed $TARGET from $u"
      file "$TARGET" | head -1
      success=1
      break
    fi
  fi
  echo "  … failed, trying next mirror"
done

if [[ $success -eq 0 ]]; then
  echo
  echo "All static-build mirrors failed. Falling back to a symlink of the"
  echo "system ffmpeg so dev-mode works. For the shipped DMG you'll need a"
  echo "real static binary — re-run this script once the mirrors are back,"
  echo "or pass FFMPEG_DOWNLOAD_URL=<url> for a custom source."
  SYS_FFMPEG="$(command -v ffmpeg || true)"
  if [[ -z "$SYS_FFMPEG" ]]; then
    echo "❌ system ffmpeg not found either. Install with: brew install ffmpeg"
    exit 1
  fi
  ln -sf "$SYS_FFMPEG" "$TARGET"
  echo "✓ Symlinked $TARGET → $SYS_FFMPEG"
  file "$TARGET" | head -1
fi

echo
echo "Next step: add \"binaries/ffmpeg-aarch64-apple-darwin\" to"
echo "tauri.conf.json → bundle.externalBin (alongside binaries/reddit-cli)."
