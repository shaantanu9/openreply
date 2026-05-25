#!/usr/bin/env bash
# Local DMG build for Gap Map — one-button publish pipeline.
#
# Steps (all idempotent):
#   1. Vite frontend build              (~2 s)
#   2. PyInstaller sidecar build        (~2 min)
#   3. Ad-hoc codesign on sidecar       (Gatekeeper cache warm)
#   4. Fetch ffmpeg static binary       (~5 s, cached)
#   5. cargo tauri build --bundles dmg  (~5-10 min cold, ~1-2 min warm)
#   6. Optional: Developer ID sign + notarize if APPLE_* env is set
#
# Usage:
#   scripts/publish-mac.sh                       # ad-hoc DMG for local testing
#   scripts/publish-mac.sh --arch arm64          # default — current host
#   scripts/publish-mac.sh --arch x86_64         # cross-compile for Intel
#   scripts/publish-mac.sh --skip-sidecar        # reuse cached PyInstaller
#   scripts/publish-mac.sh --bundles app,dmg     # also emit .app bundle
#   scripts/publish-mac.sh --sign                # require Developer ID +
#                                                # APPLE_* env (fails otherwise)
#
# Required env for --sign (Developer ID + notarization):
#   APPLE_SIGNING_IDENTITY   "Developer ID Application: Your Name (TEAMID)"
#   APPLE_ID                 your Apple ID email
#   APPLE_PASSWORD           app-specific password from appleid.apple.com
#   APPLE_TEAM_ID            10-char team identifier
# OR (API key alternative — Apple recommends this for CI):
#   APPLE_API_ISSUER, APPLE_API_KEY, APPLE_API_KEY_PATH
#
# Output:
#   app-tauri/src-tauri/target/<triple>/release/bundle/dmg/Gap Map_<ver>_<arch>.dmg
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ARCH="arm64"
BUNDLES="dmg"
SKIP_SIDECAR=0
REQUIRE_SIGN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)            ARCH="$2"; shift 2 ;;
    --bundles)         BUNDLES="$2"; shift 2 ;;
    --skip-sidecar)    SKIP_SIDECAR=1; shift ;;
    --sign)            REQUIRE_SIGN=1; shift ;;
    -h|--help)         sed -n '2,30p' "$0"; exit 0 ;;
    *)                 echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

case "$ARCH" in
  arm64|aarch64) RUST_TRIPLE="aarch64-apple-darwin" ;;
  x86_64|intel)  RUST_TRIPLE="x86_64-apple-darwin" ;;
  *)             echo "Unknown arch: $ARCH" >&2; exit 2 ;;
esac

echo "▶ Gap Map publish-mac"
echo "   arch     : $ARCH ($RUST_TRIPLE)"
echo "   bundles  : $BUNDLES"
echo "   sign     : $REQUIRE_SIGN"
echo

# ─── 1. Vite frontend build ─────────────────────────────────────────────
echo "▶ Step 1/5 — Vite frontend build"
(cd app-tauri && npm install --silent && npm run build)
echo "✓ frontend dist/ ready"
echo

# ─── 2. PyInstaller sidecar build ───────────────────────────────────────
SIDECAR="app-tauri/src-tauri/binaries/gapmap-cli-${RUST_TRIPLE}"
if [[ $SKIP_SIDECAR -eq 1 && -x "$SIDECAR" ]]; then
  echo "▶ Step 2/5 — Reusing existing sidecar at $SIDECAR (--skip-sidecar)"
else
  echo "▶ Step 2/5 — PyInstaller sidecar build (~2 min)"
  rm -rf build dist
  # Use the .spec which bundles ONNX + prompts + every lazy-imported dep.
  uv run pyinstaller gapmap-cli.spec
  if [[ ! -x dist/gapmap-cli ]]; then
    echo "✗ PyInstaller failed — dist/gapmap-cli not present" >&2
    exit 1
  fi
  mkdir -p app-tauri/src-tauri/binaries
  cp dist/gapmap-cli "$SIDECAR"
  chmod +x "$SIDECAR"
  echo "✓ sidecar at $SIDECAR ($(du -sh "$SIDECAR" | cut -f1))"
fi
echo

# ─── 3. Ad-hoc codesign the sidecar ─────────────────────────────────────
# Even on a signed/notarized DMG, the sidecar inside Resources/ must be
# signed separately. The Tauri bundler will re-sign with Developer ID if
# APPLE_SIGNING_IDENTITY is exported, but ad-hoc keeps Gatekeeper cache
# warm in dev mode (so a re-run isn't a 2-minute first-launch hang).
echo "▶ Step 3/5 — Ad-hoc codesign sidecar (Gatekeeper-cache warmup)"
codesign --force --deep --sign - "$SIDECAR"
echo "✓ ad-hoc signed"
echo

# ─── 4. Fetch ffmpeg ────────────────────────────────────────────────────
echo "▶ Step 4/5 — Fetch ffmpeg static binary ($ARCH)"
bash scripts/fetch-ffmpeg.sh "$ARCH"
echo

# ─── 5. Tauri bundle ────────────────────────────────────────────────────
echo "▶ Step 5/5 — cargo tauri build --target $RUST_TRIPLE --bundles $BUNDLES"
# JWT_DESKTOP_SECRET is required for release builds (build.rs panics
# without it). MUST match Vercel's TOKEN_SIGNING_SECRET on gapmap.myind.ai
# or every activation will fail with `invalid-signature` on the desktop.
#
# Auto-extract JUST JWT_DESKTOP_SECRET from .env.publish if it exists.
# We deliberately do NOT auto-export the whole file — APPLE_SIGNING_IDENTITY
# would then trigger Tauri's Developer-ID code path even on local ad-hoc
# builds, failing with "no identity found" if the Developer ID cert isn't
# loaded in the keychain. The Apple vars are sourced only when --sign is
# explicitly requested (block below).
if [[ -z "${JWT_DESKTOP_SECRET:-}" && -f .env.publish ]]; then
  jwt_line=$(grep -E '^[[:space:]]*JWT_DESKTOP_SECRET[[:space:]]*=' .env.publish | head -1 || true)
  if [[ -n "$jwt_line" ]]; then
    # Strip leading whitespace + the var name + optional quotes.
    jwt_value="${jwt_line#*=}"
    jwt_value="${jwt_value%\"}"
    jwt_value="${jwt_value#\"}"
    jwt_value="${jwt_value%\'}"
    jwt_value="${jwt_value#\'}"
    export JWT_DESKTOP_SECRET="$jwt_value"
    echo "   ✓ JWT_DESKTOP_SECRET loaded from .env.publish (${#JWT_DESKTOP_SECRET} chars)"
  fi
fi
if [[ -z "${JWT_DESKTOP_SECRET:-}" ]]; then
  echo "   ⚠ JWT_DESKTOP_SECRET not set and no .env.publish — using random."
  echo "     This DMG WILL NOT activate against gapmap.myind.ai."
  echo "     Fix: copy .env.publish.example → .env.publish, paste the same"
  echo "     secret you set in Vercel as TOKEN_SIGNING_SECRET, retry."
  export JWT_DESKTOP_SECRET="local-dev-$(openssl rand -hex 32 | head -c 32)"
fi

if [[ $REQUIRE_SIGN -eq 1 ]]; then
  : "${APPLE_SIGNING_IDENTITY:?APPLE_SIGNING_IDENTITY not set — see header comment}"
  echo "   → Developer ID signing enabled: $APPLE_SIGNING_IDENTITY"
  if [[ -n "${APPLE_API_KEY:-}" ]]; then
    echo "   → notarize via App Store Connect API key: $APPLE_API_KEY"
  elif [[ -n "${APPLE_ID:-}" ]]; then
    : "${APPLE_PASSWORD:?APPLE_PASSWORD (app-specific) required for notarization}"
    : "${APPLE_TEAM_ID:?APPLE_TEAM_ID required for notarization}"
    echo "   → notarize via Apple ID: $APPLE_ID (team $APPLE_TEAM_ID)"
  else
    echo "   ⚠ no notarization credentials — DMG will be signed but not notarized."
    echo "     Gatekeeper will block on first launch until user explicitly approves."
  fi
fi

# Split the Tauri build into two passes so we can re-sign the nested
# sidecar binaries (gapmap-cli, ffmpeg) BETWEEN .app assembly and DMG
# packaging. Without this, the inner binaries inside Contents/MacOS/
# end up unsigned — and macOS Gatekeeper SIGKILLs them on first launch
# with no output (exit 137), which surfaces in the UI as "every card
# stays on a loading skeleton forever" because every sidecar invoke
# returns nothing.
#
# Pass 1: build only the .app
(cd app-tauri && npx tauri build --target "$RUST_TRIPLE" --bundles app)

APP_PATH="app-tauri/src-tauri/target/${RUST_TRIPLE}/release/bundle/macos/Gap Map.app"
if [[ -d "$APP_PATH" ]]; then
  echo "▶ Step 5b — re-sign nested sidecar binaries inside the .app"
  # Identity for nested binaries: Developer ID if --sign was passed,
  # else ad-hoc. Tauri itself signs the .app bundle wrapper, but its
  # `--deep` pass apparently doesn't sign these PyInstaller / static
  # binaries (we've observed `codesign -d -vvv` reports "not signed at
  # all" for gapmap-cli inside the .app), so we do it explicitly.
  SIGN_ID="-"
  if [[ $REQUIRE_SIGN -eq 1 && -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    SIGN_ID="$APPLE_SIGNING_IDENTITY"
  fi
  for bin in "$APP_PATH/Contents/MacOS"/gapmap-cli "$APP_PATH/Contents/MacOS"/ffmpeg; do
    if [[ -x "$bin" ]]; then
      codesign --force --options runtime --sign "$SIGN_ID" "$bin" 2>&1 | sed 's/^/   /'
    fi
  done
  # Re-sign the outer .app wrapper too, since modifying nested binaries
  # invalidates the bundle's sealed-resources signature. --deep makes
  # codesign verify (and re-attach if missing) every nested signature.
  codesign --force --deep --options runtime --sign "$SIGN_ID" "$APP_PATH" 2>&1 | sed 's/^/   /'
  echo "✓ inner binaries signed (identity: $SIGN_ID)"
fi

# Pass 2: package the now-signed .app into the requested $BUNDLES
# (defaults to dmg). Tauri sees an existing .app and packages it
# without rebuilding from scratch.
(cd app-tauri && npx tauri build --target "$RUST_TRIPLE" --bundles "$BUNDLES")

DMG=$(ls -t app-tauri/src-tauri/target/"$RUST_TRIPLE"/release/bundle/dmg/*.dmg 2>/dev/null | head -1 || true)
if [[ -n "$DMG" ]]; then
  echo
  echo "🎉 DMG: $DMG"
  ls -lh "$DMG"
  echo
  echo "Verify the signature:"
  echo "  codesign -vvv --deep --strict \"$DMG\""
  echo "  spctl -a -vv \"$DMG\""
fi
