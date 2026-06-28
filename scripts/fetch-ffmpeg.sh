#!/usr/bin/env bash
# Download a static ffmpeg binary for the Tauri DMG bundle.
#
# Pass an arch arg ("arm64" or "x86_64") to pick the target, or call it with
# no arg to default to the host arch. Both binaries are needed for a
# universal-DMG release (release.yml builds both via the CI matrix).
#
# macOS static builds come from https://www.osxexperts.net/ (the de-facto
# notarized-static mirror). Kept out of git because each binary is ~30 MB —
# run this script before `tauri build` on a fresh clone.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${HERE}/../app-tauri/src-tauri/binaries"
mkdir -p "$TARGET_DIR"

ARG_ARCH="${1:-}"
if [[ -z "$ARG_ARCH" ]]; then
  case "$(uname -m)" in
    arm64|aarch64) ARG_ARCH="arm64" ;;
    x86_64)        ARG_ARCH="x86_64" ;;
    *)             ARG_ARCH="arm64" ;;
  esac
fi

case "$ARG_ARCH" in
  arm64|aarch64)
    RUST_TRIPLE="aarch64-apple-darwin"
    URLS=(
      "${FFMPEG_DOWNLOAD_URL:-}"
      "https://www.osxexperts.net/ffmpeg711arm.zip"
      "https://www.osxexperts.net/ffmpeg71arm.zip"
      "https://www.osxexperts.net/ffmpeg7arm.zip"
      "https://www.osxexperts.net/ffmpeg8arm.zip"
    )
    ;;
  x86_64|intel)
    RUST_TRIPLE="x86_64-apple-darwin"
    # Intel static builds: evermeet.cx is the canonical source. They publish
    # current + prior FFmpeg releases. URL stays stable for the latest.
    URLS=(
      "${FFMPEG_DOWNLOAD_URL:-}"
      "https://evermeet.cx/ffmpeg/getrelease/zip"
      "https://www.osxexperts.net/ffmpeg711intel.zip"
      "https://www.osxexperts.net/ffmpeg71intel.zip"
      "https://www.osxexperts.net/ffmpeg7intel.zip"
    )
    ;;
  *)
    echo "Unknown arch: $ARG_ARCH (use arm64 or x86_64)" >&2
    exit 2
    ;;
esac

TARGET="${TARGET_DIR}/ffmpeg-${RUST_TRIPLE}"

if [[ -x "$TARGET" ]]; then
    echo "ffmpeg already present at $TARGET — skipping download."
    echo "Delete the file and re-run to force a refresh."
    exit 0
fi

TMPZIP="$(mktemp /tmp/openreply-ffmpeg.XXXXXX.zip)"
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
  echo "All static-build mirrors failed for $ARG_ARCH. Falling back to a"
  echo "symlink of the system ffmpeg so dev-mode works. For the shipped DMG"
  echo "you'll need a real static binary of the matching arch — re-run once"
  echo "the mirrors are back, or pass FFMPEG_DOWNLOAD_URL=<url>."
  SYS_FFMPEG="$(command -v ffmpeg || true)"
  if [[ -z "$SYS_FFMPEG" ]]; then
    echo "❌ system ffmpeg not found either. Install with: brew install ffmpeg" >&2
    exit 1
  fi
  ln -sf "$SYS_FFMPEG" "$TARGET"
  echo "✓ Symlinked $TARGET → $SYS_FFMPEG"
  file "$TARGET" | head -1
fi

echo
echo "Next step: confirm \"binaries/ffmpeg\" is in tauri.conf.json →"
echo "bundle.externalBin. Tauri will pick the matching <triple> suffix at"
echo "build time."
