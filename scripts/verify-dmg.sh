#!/usr/bin/env bash
# Verify a built DMG is properly Developer ID signed + Apple notarized +
# stapled. Run this BEFORE uploading a DMG to a public release — turns the
# "we published it and only later realised it's unsigned" failure mode into
# an automated check.
#
# Usage:
#   scripts/verify-dmg.sh path/to/release.dmg [--expected-arch arm64|x86_64]
#                                              [--expected-version 0.1.1]
#                                              [--expected-bundle-id com.shantanu.gapmap]
#
# Exit codes:
#   0   all checks passed — safe to upload
#   1   one or more checks failed — DO NOT upload
#   2   bad arguments

set -uo pipefail

DMG=""
EXPECTED_ARCH=""
EXPECTED_VERSION=""
EXPECTED_BUNDLE_ID=""
KEEP_MOUNTED=0

while [ $# -gt 0 ]; do
  case "$1" in
    --expected-arch)       EXPECTED_ARCH="$2"; shift 2 ;;
    --expected-version)    EXPECTED_VERSION="$2"; shift 2 ;;
    --expected-bundle-id)  EXPECTED_BUNDLE_ID="$2"; shift 2 ;;
    --keep-mounted)        KEEP_MOUNTED=1; shift ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    -*)
      echo "unknown flag: $1"; exit 2 ;;
    *)
      DMG="$1"; shift ;;
  esac
done

if [ -z "$DMG" ] || [ ! -f "$DMG" ]; then
  echo "USAGE: $0 path/to/release.dmg [--expected-arch arm64|x86_64] [--expected-version X.Y.Z]"
  exit 2
fi

if [ -t 1 ]; then
  red() { printf '\033[31m%s\033[0m\n' "$*"; }
  green() { printf '\033[32m%s\033[0m\n' "$*"; }
  yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
  bold() { printf '\033[1m%s\033[0m\n' "$*"; }
else
  red() { echo "$*"; }; green() { echo "$*"; }; yellow() { echo "$*"; }; bold() { echo "$*"; }
fi

FAIL=0
ok()    { green "  ok    $*"; }
fail()  { red   "  FAIL  $*"; FAIL=$((FAIL+1)); }
warn()  { yellow "  warn  $*"; }

bold "── DMG verification: $DMG ──"

# ── 0. clean any stale "<App>" mount points that would confuse the per-path
#       checks below (zombie mounts are common after CI debug). We don't
#       know the app name yet, so just enumerate /Volumes/* and detach any
#       that aren't system-mounted.
shopt -s nullglob 2>/dev/null || true
for vol in /Volumes/*; do
  # Skip the Macintosh HD-style root mounts.
  [ "$vol" = "/Volumes/Macintosh HD" ] && continue
  [ "$vol" = "/Volumes/Data" ] && continue
  case "$(basename "$vol")" in
    Gap*Map*|*App*)
      hdiutil detach -force "$vol" >/dev/null 2>&1 || true
      ;;
  esac
done

# ── 1. mount the DMG and locate the .app inside ─────────────────────────────
bold "1. Mount DMG"
MOUNT_OUTPUT=$(hdiutil attach -nobrowse -plist "$DMG" 2>&1) || {
  fail "hdiutil attach failed:"
  echo "$MOUNT_OUTPUT" | sed 's/^/        /' | head -5
  exit 1
}
MOUNT_PATH=$(echo "$MOUNT_OUTPUT" | python3 -c '
import sys, plistlib
data = plistlib.loads(sys.stdin.read().encode("utf-8"))
for entry in data["system-entities"]:
    if "mount-point" in entry:
        print(entry["mount-point"]); break
' 2>/dev/null)
if [ -z "$MOUNT_PATH" ] || [ ! -d "$MOUNT_PATH" ]; then
  fail "could not parse mount path"
  exit 1
fi
ok "mounted at: $MOUNT_PATH"

cleanup() {
  if [ "$KEEP_MOUNTED" -eq 0 ] && [ -n "${MOUNT_PATH:-}" ]; then
    hdiutil detach -force "$MOUNT_PATH" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Find the .app
APP=$(find "$MOUNT_PATH" -maxdepth 2 -name "*.app" -type d | head -1)
if [ -z "$APP" ]; then
  fail "no .app bundle found inside $MOUNT_PATH"
  exit 1
fi
ok "app bundle: $APP"

# ── 2. bundle metadata (Info.plist) ─────────────────────────────────────────
bold "2. Bundle metadata"
PLIST="$APP/Contents/Info.plist"
if [ ! -f "$PLIST" ]; then
  fail "Contents/Info.plist missing"
else
  ok "Info.plist present"
  VER=$(defaults read "$PLIST" CFBundleShortVersionString 2>/dev/null || echo "")
  ID=$(defaults read "$PLIST" CFBundleIdentifier 2>/dev/null || echo "")
  EXE=$(defaults read "$PLIST" CFBundleExecutable 2>/dev/null || echo "")
  if [ -n "$VER" ]; then ok "CFBundleShortVersionString = $VER"
  else fail "CFBundleShortVersionString missing"; fi
  if [ -n "$ID" ];  then ok "CFBundleIdentifier         = $ID"
  else fail "CFBundleIdentifier missing"; fi
  if [ -n "$EXE" ]; then ok "CFBundleExecutable         = $EXE"
  else fail "CFBundleExecutable missing"; fi

  if [ -n "$EXPECTED_VERSION" ] && [ "$VER" != "$EXPECTED_VERSION" ]; then
    fail "version mismatch: got '$VER', expected '$EXPECTED_VERSION'"
  fi
  if [ -n "$EXPECTED_BUNDLE_ID" ] && [ "$ID" != "$EXPECTED_BUNDLE_ID" ]; then
    fail "bundle id mismatch: got '$ID', expected '$EXPECTED_BUNDLE_ID'"
  fi
fi

# ── 3. architecture ─────────────────────────────────────────────────────────
bold "3. Architecture"
if [ -n "${EXE:-}" ] && [ -f "$APP/Contents/MacOS/$EXE" ]; then
  ARCH_INFO=$(lipo -info "$APP/Contents/MacOS/$EXE" 2>/dev/null || echo "lipo failed")
  ok "lipo -info: $ARCH_INFO"
  if [ -n "$EXPECTED_ARCH" ]; then
    case "$EXPECTED_ARCH" in
      arm64|aarch64) WANT="arm64" ;;
      x86_64|x64)    WANT="x86_64" ;;
      *)             WANT="$EXPECTED_ARCH" ;;
    esac
    if echo "$ARCH_INFO" | grep -q "$WANT"; then
      ok "arch matches expected ($WANT)"
    else
      fail "arch mismatch: expected $WANT, got '$ARCH_INFO'"
    fi
  fi
else
  warn "no MacOS/$EXE binary to lipo"
fi

# ── 4. codesign — must be Developer ID, NOT ad-hoc ─────────────────────────
bold "4. Codesignature (must be Developer ID, NOT ad-hoc)"
CODESIGN_OUT=$(codesign -dv --verbose=2 "$APP" 2>&1 || true)
echo "$CODESIGN_OUT" | grep -E "Authority|TeamIdentifier|Signature=|Identifier=" \
  | sed 's/^/        /' | head -8

if echo "$CODESIGN_OUT" | grep -q "Signature=adhoc"; then
  fail "DMG is ad-hoc signed — NOT Developer ID. Will fail Gatekeeper."
fi
if echo "$CODESIGN_OUT" | grep -q "TeamIdentifier=not set"; then
  fail "no TeamIdentifier — definitely unsigned."
fi
if echo "$CODESIGN_OUT" | grep -q "Authority=Developer ID Application"; then
  ok "Developer ID Application authority present"
else
  fail "no 'Developer ID Application' authority — not properly signed"
fi
if echo "$CODESIGN_OUT" | grep -q "Authority=Developer ID Certification Authority"; then
  ok "Developer ID CA chain present"
fi
if echo "$CODESIGN_OUT" | grep -q "Authority=Apple Root CA"; then
  ok "Apple Root CA chain present"
fi

# codesign --verify (strict)
VERIFY_OUT=$(codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 || true)
if echo "$VERIFY_OUT" | grep -qiE "valid on disk|satisfies its Designated Requirement"; then
  ok "codesign --verify --deep --strict passes"
elif [ -z "$VERIFY_OUT" ]; then
  # silent success on macOS
  ok "codesign --verify --deep --strict passes (silent)"
else
  fail "codesign --verify reported issues:"
  echo "$VERIFY_OUT" | sed 's/^/        /' | head -3
fi

# ── 5. Gatekeeper assessment ───────────────────────────────────────────────
bold "5. Gatekeeper assessment (spctl)"
SPCTL_OUT=$(spctl --assess --type execute --verbose "$APP" 2>&1 || true)
echo "$SPCTL_OUT" | sed 's/^/        /' | head -3
if echo "$SPCTL_OUT" | grep -qi "accepted"; then
  ok "Gatekeeper accepts the bundle"
  if echo "$SPCTL_OUT" | grep -qi "Notarized Developer ID"; then
    ok "  source: Notarized Developer ID"
  elif echo "$SPCTL_OUT" | grep -qi "Developer ID"; then
    warn "  source: Developer ID (not yet notarized?)"
  fi
else
  fail "Gatekeeper rejected the bundle"
fi

# ── 6. stapled notarization ticket ─────────────────────────────────────────
bold "6. Stapled notarization ticket"
STAPLER_OUT=$(stapler validate "$APP" 2>&1 || true)
echo "$STAPLER_OUT" | sed 's/^/        /' | head -3
if echo "$STAPLER_OUT" | grep -qi "validate action worked"; then
  ok "Apple notarization ticket stapled and valid"
elif echo "$STAPLER_OUT" | grep -qi "does not have a ticket"; then
  fail "no notarization ticket stapled — Gatekeeper will block first launch on Macs without internet"
else
  warn "unexpected stapler output (see above)"
fi

# ── 7. quarantine attr — should be clean inside DMG ────────────────────────
bold "7. Quarantine attribute"
QXATTR=$(xattr -p com.apple.quarantine "$APP" 2>&1 || true)
if echo "$QXATTR" | grep -qi "No such xattr"; then
  ok "no com.apple.quarantine attr on the .app inside DMG"
else
  warn "quarantine attr present: $QXATTR  (will be set on download, removed on first launch)"
fi

# ── summary ─────────────────────────────────────────────────────────────────
echo
bold "── Summary ──"
if [ "$FAIL" -gt 0 ]; then
  red "  $FAIL check(s) failed. DO NOT upload this DMG."
  exit 1
fi
green "  All checks passed. Safe to upload:"
echo  "    $DMG"
exit 0
