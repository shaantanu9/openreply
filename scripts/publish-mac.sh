#!/usr/bin/env bash
# Local DMG build for OpenReply — one-button publish pipeline.
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
#   app-tauri/src-tauri/target/<triple>/release/bundle/dmg/OpenReply_<ver>_<arch>.dmg
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

echo "▶ OpenReply publish-mac"
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
SIDECAR="app-tauri/src-tauri/binaries/openreply-cli-${RUST_TRIPLE}"
if [[ $SKIP_SIDECAR -eq 1 && -x "$SIDECAR" ]]; then
  echo "▶ Step 2/5 — Reusing existing sidecar at $SIDECAR (--skip-sidecar)"
else
  echo "▶ Step 2/5 — PyInstaller sidecar build (~2 min)"
  rm -rf build dist
  # Use the .spec which bundles ONNX + prompts + every lazy-imported dep.
  uv run pyinstaller openreply-cli.spec
  # ONEDIR build: PyInstaller produces dist/openreply-cli/ (engine + _internal/),
  # NOT a single file. The Tauri sidecar is a launcher SCRIPT at $SIDECAR (kept
  # in git) that exec's this onedir engine from
  # Contents/Resources/binaries/openreply-cli-onedir/ (shipped via the
  # tauri.conf.json `resources` glob). So: refresh that resources folder from
  # the fresh build and LEAVE the launcher script intact (do NOT cp the dir
  # over it). See binaries/openreply-cli-aarch64-apple-darwin (the launcher).
  if [[ ! -x dist/openreply-cli/openreply-cli ]]; then
    echo "✗ PyInstaller failed — dist/openreply-cli/openreply-cli not present" >&2
    exit 1
  fi
  mkdir -p app-tauri/src-tauri/binaries
  ONEDIR_DEST="app-tauri/src-tauri/binaries/openreply-cli-onedir"
  rm -rf "$ONEDIR_DEST"
  cp -R dist/openreply-cli "$ONEDIR_DEST"
  if [[ ! -f "$SIDECAR" ]]; then
    echo "✗ launcher script missing at $SIDECAR — the onedir sidecar needs it (it's tracked in git)" >&2
    exit 1
  fi
  chmod +x "$SIDECAR" "$ONEDIR_DEST/openreply-cli"
  echo "✓ onedir engine → $ONEDIR_DEST ($(du -sh "$ONEDIR_DEST" | cut -f1)); launcher: $SIDECAR"
fi
# Path to the onedir engine + its nested Mach-O (needed by codesign + notarization).
ONEDIR_DEST="${ONEDIR_DEST:-app-tauri/src-tauri/binaries/openreply-cli-onedir}"
echo

# ─── 3. Ad-hoc codesign the sidecar ─────────────────────────────────────
# Even on a signed/notarized DMG, the sidecar inside Resources/ must be
# signed separately. The Tauri bundler will re-sign with Developer ID if
# APPLE_SIGNING_IDENTITY is exported, but ad-hoc keeps Gatekeeper cache
# warm in dev mode (so a re-run isn't a 2-minute first-launch hang).
echo "▶ Step 3/5 — Ad-hoc codesign sidecar (Gatekeeper-cache warmup)"
# Launcher script (externalBin → Contents/MacOS/openreply-cli).
codesign --force --sign - "$SIDECAR" 2>/dev/null || true
# Onedir engine + every nested Mach-O (.so / .dylib / the engine itself). For
# a plain directory codesign --deep does NOT recurse, so sign each Mach-O so
# notarization (Step 6) doesn't choke on unsigned nested code shipped under
# Contents/Resources/. Developer ID + hardened runtime is re-applied to these
# in Step 5a (after the identity is sourced); this ad-hoc pass keeps dev
# Gatekeeper warm and gives the bundle a valid baseline.
if [[ -d "$ONEDIR_DEST" ]]; then
  # Detect Mach-O by CONTENT (file), not by name — a *.so/*.dylib/openreply-cli
  # filter misses the extensionless `_internal/Python` interpreter and the
  # `_internal/Python.framework` binaries (both rejected by notarization).
  while IFS= read -r macho; do
    [[ -z "$macho" ]] && continue
    case "$(file -b "$macho" 2>/dev/null)" in *Mach-O*) ;; *) continue ;; esac
    codesign --force --sign - "$macho" 2>/dev/null || true
  done < <(find "$ONEDIR_DEST" -type f 2>/dev/null)
  echo "✓ ad-hoc signed launcher + onedir engine/nested Mach-O"
else
  echo "✓ ad-hoc signed launcher (onedir dir absent — --skip-sidecar reuse)"
fi
echo

# ─── 4. Fetch ffmpeg ────────────────────────────────────────────────────
echo "▶ Step 4/5 — Fetch ffmpeg static binary ($ARCH)"
bash scripts/fetch-ffmpeg.sh "$ARCH"
echo

# ─── 5. Tauri bundle ────────────────────────────────────────────────────
echo "▶ Step 5/5 — cargo tauri build --target $RUST_TRIPLE --bundles $BUNDLES"

if [[ $REQUIRE_SIGN -eq 1 ]]; then
  # Auto-source the Developer-ID + notarization vars from .env.publish so
  # users don't have to `export` them by hand. ONLY pulls the known keys
  # (no blanket `source` — that would also export JWT etc. and we already
  # handle JWT above).
  if [[ -f .env.publish ]]; then
    # Tauri-bundler convention (per tauri.app/distribute/sign/macos):
    #   APPLE_API_KEY        — the 10-char KEY ID
    #   APPLE_API_ISSUER     — the issuer UUID
    #   APPLE_API_KEY_PATH   — file path to AuthKey_<id>.p8
    # Tauri reads these directly during --bundles dmg|app to auto-notarize,
    # so we MUST use exactly these names — anything else (e.g. APPLE_API_KEY_ID)
    # collides and 401s.
    for k in APPLE_SIGNING_IDENTITY APPLE_TEAM_ID APPLE_ID APPLE_PASSWORD \
             APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH; do
      if [[ -z "${!k:-}" ]]; then
        v=$(grep -E "^[[:space:]]*${k}[[:space:]]*=" .env.publish | head -1 || true)
        if [[ -n "$v" ]]; then
          v="${v#*=}"
          v="${v#\"}"; v="${v%\"}"
          v="${v#\'}"; v="${v%\'}"
          # Expand $HOME / ~ in paths
          v="${v/#\~/$HOME}"
          export "$k=$v"
        fi
      fi
    done
  fi

  : "${APPLE_SIGNING_IDENTITY:?APPLE_SIGNING_IDENTITY not set in env or .env.publish}"
  : "${APPLE_TEAM_ID:?APPLE_TEAM_ID not set in env or .env.publish}"
  echo "   → Developer ID signing: $APPLE_SIGNING_IDENTITY"

  # Two notarization auth paths — API key preferred (no app-specific
  # password, no Apple-ID rotation pain).
  if [[ -n "${APPLE_API_KEY_PATH:-}" && -f "$APPLE_API_KEY_PATH" ]]; then
    : "${APPLE_API_ISSUER:?APPLE_API_ISSUER required with APPLE_API_KEY_PATH}"
    : "${APPLE_API_KEY:?APPLE_API_KEY (the 10-char KEY ID, e.g. GP8F78A74R) required}"
    NOTARY_AUTH=(--key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER")
    echo "   → notarize via ASC API key: $APPLE_API_KEY (issuer ${APPLE_API_ISSUER:0:8}…)"
  elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" ]]; then
    NOTARY_AUTH=(--apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID")
    echo "   → notarize via Apple ID: $APPLE_ID (team $APPLE_TEAM_ID)"
  else
    echo "   ✗ --sign requires either APPLE_API_KEY_PATH+APPLE_API_KEY+APPLE_API_ISSUER" >&2
    echo "     OR APPLE_ID+APPLE_PASSWORD+APPLE_TEAM_ID. None found." >&2
    exit 1
  fi

  # Confirm the Developer ID cert is actually in the keychain before we
  # waste a Tauri build on a doomed run.
  if ! security find-identity -v -p codesigning | grep -q "$APPLE_SIGNING_IDENTITY"; then
    echo "   ✗ Developer ID cert not in keychain: $APPLE_SIGNING_IDENTITY" >&2
    echo "     Run: security find-identity -v -p codesigning" >&2
    exit 1
  fi
fi

# Run Tauri's standard bundle pipeline — produces .app and (when DMG is
# requested) the DMG. Tauri's bundler signs the .app wrapper.
#
# IMPORTANT (macOS 26.5+ / Tahoe): Tahoe's strict code-signing enforcement
# rejects unsigned/ad-hoc binaries inside DMGs during file-copy. Symptom:
# users dragging OpenReply.app from the DMG mount to /Applications end up
# with 0-byte / truncated inner binaries (cp returns success but reads
# fail silently). The realistic fix is Developer ID + notarization
# (--sign flag + notarytool). For ad-hoc beta builds we ship a .zip
# alongside the .dmg — extracted files from a .zip don't carry the
# from-DMG provenance check and copy cleanly.
# ── Pre-sign the ONEDIR engine + nested Mach-O with Developer ID ──────────
# Tauri copies binaries/openreply-cli-onedir/** into Contents/Resources via the
# `resources` glob, but its --deep sign does NOT cover loose Mach-O in
# Resources. Without signing them here (with the SAME identity + hardened
# runtime + secure timestamp the wrapper uses), notarization rejects all ~128
# .so + the engine: "not signed with a valid Developer ID / no secure
# timestamp / hardened runtime not enabled". Signing in binaries/ BEFORE the
# bundle means the signatures ride along into Resources (Tauri's deep-sign
# leaves Resources Mach-O untouched, verified 2026-06-02).
if [[ $REQUIRE_SIGN -eq 1 && -d "$ONEDIR_DEST" ]]; then
  echo "▶ Pre-signing onedir frameworks + nested Mach-O (Developer ID + hardened runtime + timestamp)"
  n_pre=0; n_fail=0
  # STEP A — frameworks as BUNDLES (sign each Versions/<X> dir). Signing a
  # framework's inner binary LOOSE makes Apple reject it "signature of the
  # binary is invalid" (OpenReply v0.1.10) — frameworks need a bundle-level seal.
  while IFS= read -r fw; do
    [[ -z "$fw" ]] && continue
    signed=0
    if [[ -d "$fw/Versions" ]]; then
      while IFS= read -r vdir; do
        [[ -z "$vdir" ]] && continue
        [[ "$(basename "$vdir")" == "Current" ]] && continue
        codesign --force --timestamp --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$vdir" 2>/dev/null \
          && { n_pre=$((n_pre + 1)); signed=1; } || { n_fail=$((n_fail + 1)); echo "   ! framework ver failed: $vdir" >&2; }
      done < <(find "$fw/Versions" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)
    fi
    [[ $signed -eq 0 ]] && { codesign --force --timestamp --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$fw" 2>/dev/null \
      && n_pre=$((n_pre + 1)) || { n_fail=$((n_fail + 1)); echo "   ! framework failed: $fw" >&2; }; }
  done < <(find "$ONEDIR_DEST" -type d -name '*.framework' 2>/dev/null | awk '{print length"\t"$0}' | sort -rn | cut -f2-)
  # STEP B — loose Mach-O OUTSIDE frameworks, detected by CONTENT not name
  # (catches the extensionless _internal/Python interpreter + .so/.dylib/engine).
  while IFS= read -r macho; do
    [[ -z "$macho" ]] && continue
    case "$macho" in */*.framework/*) continue ;; esac
    case "$(file -b "$macho" 2>/dev/null)" in *Mach-O*) ;; *) continue ;; esac
    if codesign --force --timestamp --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$macho" 2>/dev/null; then
      n_pre=$((n_pre + 1))
    else
      n_fail=$((n_fail + 1)); echo "   ! failed to sign $macho" >&2
    fi
  done < <(find "$ONEDIR_DEST" -type f 2>/dev/null | awk '{print length"\t"$0}' | sort -rn | cut -f2-)
  echo "   ✓ pre-signed $n_pre onedir Mach-O + frameworks ($n_fail failed)"
  [[ $n_fail -gt 0 ]] && { echo "   ✗ some onedir Mach-O failed to sign — notarization would reject" >&2; exit 1; }
  # STEP C — verify before notarization: frameworks --deep --strict, loose --strict.
  bad=0
  while IFS= read -r fw; do [[ -z "$fw" ]] && continue
    codesign --verify --deep --strict "$fw" 2>/dev/null || { echo "   ✗ framework invalid: $fw" >&2; bad=$((bad + 1)); }
  done < <(find "$ONEDIR_DEST" -type d -name '*.framework' 2>/dev/null)
  while IFS= read -r macho; do [[ -z "$macho" ]] && continue
    case "$macho" in */*.framework/*) continue ;; esac
    case "$(file -b "$macho" 2>/dev/null)" in *Mach-O*) ;; *) continue ;; esac
    codesign --verify --strict "$macho" 2>/dev/null || { echo "   ✗ Mach-O invalid: $macho" >&2; bad=$((bad + 1)); }
  done < <(find "$ONEDIR_DEST" -type f 2>/dev/null)
  [[ $bad -gt 0 ]] && { echo "   ✗ $bad signatures invalid — aborting before notarization" >&2; exit 1; }
  echo "   ✓ verified all onedir signatures valid"
fi

# Build .app first (so we can zip it) — Tauri deletes the .app dir after
# the DMG step, so we need .app present before .dmg gets created.
# Sign-only: unset the notarization creds for THIS subshell so Tauri's bundler
# signs but does NOT auto-notarize. We notarize explicitly in Step 6 AFTER all
# nested code (incl. the onedir in Resources) and the wrapper are signed —
# Tauri's mid-build notarization fired BEFORE the nested Resources Mach-O were
# Developer-ID signed and rejected the whole bundle (fix 2026-06-02).
(cd app-tauri && env -u APPLE_API_KEY -u APPLE_API_ISSUER -u APPLE_API_KEY_PATH \
   -u APPLE_ID -u APPLE_PASSWORD \
   npx tauri build --target "$RUST_TRIPLE" --bundles app)

APP_PATH="app-tauri/src-tauri/target/${RUST_TRIPLE}/release/bundle/macos/OpenReply.app"
if [[ -d "$APP_PATH" ]]; then
  # ── Step 5a — re-sign the .app bundle ad-hoc (CRITICAL) ────────────────
  # With `signingIdentity` unset, Tauri leaves the .app with only the Rust
  # LINKER's automatic ad-hoc signature on the main Mach-O
  # (flags=0x20002 adhoc,linker-signed, Sealed Resources=none). That is NOT
  # a valid bundle signature: `codesign --verify` fails with
  #   "code has no resources but signature indicates they must be present"
  # On the build machine it launches anyway (Gatekeeper trusts local +
  # no quarantine). But once the app is zipped, downloaded (→ quarantine
  # xattr), and extracted on another Mac, Gatekeeper evaluates the broken
  # signature and HARD-BLOCKS the launch — the app simply won't open.
  #
  # Fix: re-sign the WHOLE bundle ad-hoc so it gets a real
  # `_CodeSignature/CodeResources` seal. --deep also re-signs the inner
  # sidecar binaries. After this, `codesign --verify` passes and the seal
  # survives the zip→download→extract round-trip, so right-click→Open
  # works on any Mac. Verified on OpenReply 2026-05-27.
  # Step 5a — re-sign the bundle. Two paths:
  #   --sign present → Developer ID Application + hardened runtime + timestamp
  #                    (this is what notarization REQUIRES).
  #   no --sign      → ad-hoc seal (works for local + right-click→Open; will
  #                    show "could not verify malware" on first launch).
  if [[ $REQUIRE_SIGN -eq 1 ]]; then
    echo "▶ Step 5a — Developer ID re-sign (hardened runtime + timestamp)"
    SIGN_ARGS=(--force --deep --sign "$APPLE_SIGNING_IDENTITY"
               --options runtime --timestamp)
    # Entitlements: pull from Tauri's default location if it exists.
    if [[ -f app-tauri/src-tauri/Entitlements.plist ]]; then
      SIGN_ARGS+=(--entitlements app-tauri/src-tauri/Entitlements.plist)
    fi
    # INSIDE-OUT: sign the onedir engine's nested Mach-O (.so/.dylib + the
    # engine) under Contents/Resources/ with Developer ID + hardened runtime
    # FIRST. `codesign --deep` on the .app does NOT reliably recurse into loose
    # Mach-O sitting in Resources/, so without this notarization rejects them as
    # "not signed with a valid Developer ID". Search wherever Tauri placed the
    # onedir (…/Resources/binaries/openreply-cli-onedir or …/Resources/_up_/…).
    onedir_machos=$(find "$APP_PATH/Contents/Resources" -type f \
                      \( -name '*.so' -o -name '*.dylib' -o -name 'openreply-cli' \) \
                      -path '*openreply-cli-onedir*' 2>/dev/null)
    if [[ -n "$onedir_machos" ]]; then
      n_signed=0
      while IFS= read -r macho; do
        [[ -z "$macho" ]] && continue
        if codesign --force --timestamp --options runtime \
             --sign "$APPLE_SIGNING_IDENTITY" "$macho" 2>/dev/null; then
          n_signed=$((n_signed + 1))
        else
          echo "   ! failed to Developer-ID sign $macho" >&2
        fi
      done <<< "$onedir_machos"
      echo "   • inside-out signed $n_signed onedir Mach-O files under Resources"
    else
      echo "   ⚠ no onedir Mach-O found under Resources — sidecar may be missing from the bundle" >&2
    fi
    codesign "${SIGN_ARGS[@]}" "$APP_PATH"
  else
    echo "▶ Step 5a — ad-hoc re-sign the .app bundle (seal CodeResources)"
    codesign --force --deep --sign - "$APP_PATH"
  fi
  if codesign --verify --deep --strict "$APP_PATH" 2>/dev/null; then
    echo "✓ bundle signature verifies (sealed resources present)"
  else
    echo "✗ bundle signature STILL invalid after re-sign — investigate" >&2
    codesign --verify --deep --strict "$APP_PATH" 2>&1 | head -3 >&2
    exit 1
  fi

  # Read app version from tauri.conf.json so renames track the real
  # release version (don't ever hardcode — three releases got bitten
  # by a stale 0.1.0 fallback here).
  APP_VERSION=$(python3 -c "import json; print(json.load(open('app-tauri/src-tauri/tauri.conf.json'))['version'])" 2>/dev/null || echo "0.0.0")
  ZIP_OUT="app-tauri/src-tauri/target/${RUST_TRIPLE}/release/bundle/zip"
  mkdir -p "$ZIP_OUT"
  ZIP_PATH="${ZIP_OUT}/OpenReply_${APP_VERSION}_${ARCH}.zip"
  rm -f "$ZIP_PATH"
  echo "▶ Step 5b — produce .zip (recommended path on macOS 26.5+ Tahoe)"
  # Apple's canonical way to zip a SIGNED .app for distribution /
  # notarization is plain `ditto -c -k --keepParent` — nothing else.
  #
  # DO NOT add --sequesterRsrc / --rsrc here. Those split resource forks
  # into AppleDouble sidecar files (the `__MACOSX/._*` entries). When the
  # recipient extracts with Archive Utility or `unzip`, those sidecars are
  # NOT reattached, so the .app's sealed CodeResources manifest no longer
  # matches what's on disk. Gatekeeper then refuses to launch with:
  #   "OpenReply.app: code has no resources but signature indicates they
  #    must be present"
  # i.e. the app silently fails to open. Plain `ditto -c -k --keepParent`
  # round-trips the signature intact through both Archive Utility and
  # `unzip`.
  ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"
  echo "✓ ZIP: $ZIP_PATH ($(du -sh "$ZIP_PATH" | cut -f1))"
fi

# Build the DMG from the SAME re-signed .app (NOT via Tauri's --bundles
# dmg, which would regenerate an unsigned .app and reintroduce the
# broken-signature bug fixed in Step 5a). We stage the re-signed .app +
# an /Applications symlink and make a compressed read-only DMG with
# hdiutil. `ditto` is used for the copy because plain `cp -R` can strip
# the code signature's extended attributes.
if [[ "$BUNDLES" == *dmg* && -d "$APP_PATH" ]]; then
  echo "▶ Step 5c — DMG from the re-signed .app (hdiutil, not Tauri)"
  DMG_OUT="app-tauri/src-tauri/target/${RUST_TRIPLE}/release/bundle/dmg"
  mkdir -p "$DMG_OUT"
  # Same version-from-config trick as Step 5b. APP_VERSION is set above
  # iff we entered the zip branch; re-resolve here for the dmg-only path.
  APP_VERSION="${APP_VERSION:-$(python3 -c "import json; print(json.load(open('app-tauri/src-tauri/tauri.conf.json'))['version'])" 2>/dev/null || echo "0.0.0")}"
  DMG_PATH="${DMG_OUT}/OpenReply_${APP_VERSION}_${ARCH}.dmg"
  rm -f "$DMG_PATH"

  STAGE="$(mktemp -d)"
  ditto "$APP_PATH" "$STAGE/OpenReply.app"
  ln -s /Applications "$STAGE/Applications"
  hdiutil create -volname "OpenReply" -srcfolder "$STAGE" \
    -ov -format UDZO "$DMG_PATH" >/dev/null
  rm -rf "$STAGE"
  echo "✓ DMG: $DMG_PATH ($(du -sh "$DMG_PATH" | cut -f1))"

  # Verify the .app INSIDE the DMG still has a valid signature.
  MNT="$(mktemp -d)"
  hdiutil attach "$DMG_PATH" -nobrowse -mountpoint "$MNT" >/dev/null
  if codesign --verify --deep --strict "$MNT/OpenReply.app" 2>/dev/null; then
    echo "✓ DMG .app signature verifies"
  else
    echo "⚠ DMG .app signature did not verify cleanly" >&2
  fi
  hdiutil detach "$MNT" >/dev/null 2>&1 || true
  rm -rf "$MNT"
fi

DMG=$(ls -t app-tauri/src-tauri/target/"$RUST_TRIPLE"/release/bundle/dmg/*.dmg 2>/dev/null | head -1 || true)

# ─── Step 6 — Notarize + staple (only when --sign was passed) ─────────────
# Apple's notarization service scans the bundle and returns a ticket. We
# staple the ticket onto BOTH the .zip-extracted app AND the DMG so the
# recipient's Gatekeeper can verify offline.
if [[ $REQUIRE_SIGN -eq 1 ]]; then
  echo
  echo "▶ Step 6/6 — notarize + staple"

  notarize_and_staple() {
    local what="$1"        # human label
    local artifact="$2"    # path to .zip or .dmg
    local target="$3"      # path to .app (for stapling) OR same as artifact for DMG
    [[ -f "$artifact" ]] || { echo "   (skipping $what — not present)"; return 0; }
    echo "   • submit $what → notarytool (waits, ~2-15 min)"
    if ! xcrun notarytool submit "$artifact" "${NOTARY_AUTH[@]}" --wait --output-format json \
         > /tmp/notarize-$$.json 2>&1; then
      echo "     ✗ notarization submit failed:" >&2
      cat /tmp/notarize-$$.json >&2
      return 1
    fi
    STATUS=$(python3 -c "import json; print(json.load(open('/tmp/notarize-$$.json')).get('status','?'))" 2>/dev/null || echo "?")
    SUB_ID=$(python3 -c "import json; print(json.load(open('/tmp/notarize-$$.json')).get('id','?'))" 2>/dev/null || echo "?")
    rm -f /tmp/notarize-$$.json
    echo "     status=$STATUS  id=$SUB_ID"
    if [[ "$STATUS" != "Accepted" ]]; then
      echo "     ✗ notarization NOT accepted — fetch log:" >&2
      xcrun notarytool log "$SUB_ID" "${NOTARY_AUTH[@]}" >&2
      return 1
    fi
    echo "   • staple ticket onto $target"
    xcrun stapler staple "$target" || return 1
    xcrun stapler validate "$target" >/dev/null && echo "   ✓ stapled OK" || return 1
  }

  # Notarize the ZIP (since it contains the .app). Apple staples are
  # applied to the .APP inside the zip dir, then we re-zip.
  if [[ -d "$APP_PATH" && -f "${ZIP_PATH:-}" ]]; then
    notarize_and_staple "ZIP" "$ZIP_PATH" "$APP_PATH" || exit 1
    # Re-zip so the stapled .app ships inside the .zip artifact.
    rm -f "$ZIP_PATH"
    ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"
    echo "   ✓ re-zipped stapled .app: $ZIP_PATH"
  fi

  # Notarize the DMG (DMGs are stapled in-place — no re-build needed)
  if [[ -n "$DMG" ]]; then
    notarize_and_staple "DMG" "$DMG" "$DMG" || exit 1
  fi

  echo
  echo "✓ Notarized + stapled. Gatekeeper will accept on every Mac:"
  echo "  spctl -a -vvv \"$APP_PATH\"        # expect 'accepted source=Notarized Developer ID'"
fi

if [[ -n "$DMG" ]]; then
  echo
  echo "🎉 DMG: $DMG"
  ls -lh "$DMG"
  echo
  echo "Verify the signature:"
  echo "  codesign -vvv --deep --strict \"$DMG\""
  echo "  spctl -a -vv \"$DMG\""
fi
