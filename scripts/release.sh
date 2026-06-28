#!/usr/bin/env bash
# One-command release orchestrator. The intended user-facing flow:
#
#   scripts/release.sh v0.1.2
#
# Walks the entire pipeline:
#   1. Run preflight (catches every version-bump / cred / cert trap)
#   2. Push the tag (CI starts the mac+windows builds; ~12 min)
#   3. While CI runs: sign + notarize locally for arm64 + x86_64
#   4. Verify each signed DMG with verify-dmg.sh
#   5. Rename DMG / zip to public-convention filenames
#   6. Upload signed artifacts to the public release repo (myind-ai/openreply)
#   7. Apply friendly asset labels (Apple Silicon / Intel / Windows ...)
#   8. Publish (--draft=false --latest)
#
# Idempotent at every step — re-run after fixing a failure and it resumes
# where you left off.
#
# Flags:
#   --yes         non-interactive (default asks for confirmation between phases)
#   --skip-tag    tag is already pushed; resume from sign step
#   --skip-sign   sign step already done; resume from upload step
#   --public-repo OWNER/REPO   override public repo (default: myind-ai/openreply)
#
# Pre-reqs (all checked by preflight):
#   tauri.conf.json + package.json + Cargo.toml all at the new version
#   clean working tree, on multi-source/main/master
#   .env.publish has APPLE_* creds; Developer ID cert in keychain
#   .git/hooks/pre-push enforces preflight too as a safety net

set -uo pipefail

VERSION_TAG=""
YES=0
SKIP_TAG=0
SKIP_SIGN=0
PUBLIC_REPO="myind-ai/openreply"
BUNDLE_ID="com.shantanu.openreply"

while [ $# -gt 0 ]; do
  case "$1" in
    --yes)         YES=1; shift ;;
    --skip-tag)    SKIP_TAG=1; shift ;;
    --skip-sign)   SKIP_SIGN=1; shift ;;
    --public-repo) PUBLIC_REPO="$2"; shift 2 ;;
    -h|--help)
      sed -n '1,38p' "$0"; exit 0 ;;
    v*) VERSION_TAG="$1"; shift ;;
    *)  echo "unknown arg: $1"; exit 2 ;;
  esac
done

if [ -z "$VERSION_TAG" ]; then
  echo "USAGE: $0 v<X.Y.Z> [--yes] [--skip-tag] [--skip-sign]"
  exit 2
fi
VERSION_NUM="${VERSION_TAG#v}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ -t 1 ]; then
  bold() { printf '\033[1m%s\033[0m\n' "$*"; }
  green() { printf '\033[32m%s\033[0m\n' "$*"; }
  red() { printf '\033[31m%s\033[0m\n' "$*"; }
  yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
else
  bold() { echo "$*"; }; green() { echo "$*"; }; red() { echo "$*"; }; yellow() { echo "$*"; }
fi

confirm() {
  [ "$YES" -eq 1 ] && return 0
  read -p "▸ $1 [y/N] " -n 1 -r REPLY
  echo
  [[ "$REPLY" =~ ^[Yy]$ ]]
}

die() { red "✗ $*"; exit 1; }

bold "╔══════════════════════════════════════════════════════════════╗"
bold "║  OpenReply release — $VERSION_TAG"
bold "╚══════════════════════════════════════════════════════════════╝"

# ── 1. preflight ────────────────────────────────────────────────────────────
bold "── 1. Preflight ──"
if ! "$REPO_ROOT/scripts/preflight-release.sh" "$VERSION_TAG"; then
  die "preflight failed — fix above and re-run"
fi

# Make sure .env.publish creds are available to subsequent steps.
set -a; source .env.publish; set +a

# ── 2. push tag ─────────────────────────────────────────────────────────────
if [ "$SKIP_TAG" -eq 0 ]; then
  bold "── 2. Push tag ──"
  if confirm "create + push tag $VERSION_TAG?"; then
    git tag -a "$VERSION_TAG" -m "OpenReply $VERSION_TAG"
    git push origin "$VERSION_TAG"
    green "  ✓ tag pushed; release.yml is now firing on origin"
  else
    yellow "  skipped"
  fi
else
  bold "── 2. Push tag (SKIPPED, --skip-tag) ──"
fi

# ── 3. wait for CI mac+windows ──────────────────────────────────────────────
bold "── 3. Wait for CI (release.yml) ──"
echo "  poll every 60s until run completes"
ORIGIN_REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
sleep 5
RUN_ID=""
for _ in $(seq 1 12); do
  RUN_ID=$(gh run list --repo "$ORIGIN_REPO" --limit 5 --workflow=release.yml --json databaseId,headBranch --jq ".[] | select(.headBranch == \"$VERSION_TAG\") | .databaseId" | head -1)
  [ -n "$RUN_ID" ] && break
  sleep 5
done
if [ -z "$RUN_ID" ]; then
  yellow "  no CI run found for $VERSION_TAG yet — manual wait required"
else
  green "  watching run: $RUN_ID"
  gh run watch "$RUN_ID" --repo "$ORIGIN_REPO" --exit-status || die "CI run $RUN_ID did not succeed"
fi

# ── 4. local sign + notarize ────────────────────────────────────────────────
if [ "$SKIP_SIGN" -eq 0 ]; then
  bold "── 4. Local sign + notarize ──"
  if confirm "run publish-mac.sh --sign --arch arm64 (~20-30 min)?"; then
    "$REPO_ROOT/scripts/publish-mac.sh" --sign --arch arm64 || die "arm64 sign failed"
  fi
  if confirm "run publish-mac.sh --sign --arch x86_64 (~25-30 min)?"; then
    "$REPO_ROOT/scripts/publish-mac.sh" --sign --arch x86_64 || die "x86_64 sign failed"
  fi
else
  bold "── 4. Local sign + notarize (SKIPPED, --skip-sign) ──"
fi

# ── 5. verify each signed DMG ───────────────────────────────────────────────
bold "── 5. Verify signed DMGs ──"
ARM64_DMG=$(ls -t "app-tauri/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/"*.dmg 2>/dev/null | head -1)
X64_DMG=$(ls -t   "app-tauri/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/"*.dmg 2>/dev/null | head -1)
[ -f "$ARM64_DMG" ] || die "arm64 DMG missing at expected path"
[ -f "$X64_DMG" ]   || die "x86_64 DMG missing at expected path"
"$REPO_ROOT/scripts/verify-dmg.sh" "$ARM64_DMG" --expected-arch arm64 \
  --expected-version "$VERSION_NUM" --expected-bundle-id "$BUNDLE_ID" \
  || die "arm64 verification failed"
"$REPO_ROOT/scripts/verify-dmg.sh" "$X64_DMG" --expected-arch x86_64 \
  --expected-version "$VERSION_NUM" --expected-bundle-id "$BUNDLE_ID" \
  || die "x86_64 verification failed"
green "  ✓ both signed DMGs verified"

# ── 6. rename to public-convention filenames ────────────────────────────────
bold "── 6. Stage upload artifacts ──"
STAGE="$(mktemp -d)"
trap "rm -rf $STAGE" EXIT

cp "$ARM64_DMG" "$STAGE/Gap.Map_${VERSION_NUM}_arm64.dmg"
cp "$X64_DMG"   "$STAGE/Gap.Map_${VERSION_NUM}_x64.dmg"

# Companion .zip files — same source bundles, ditto -c -k --keepParent
# (publish-mac.sh already produces these in the right form using Apple's
# canonical zip technique — copy + rename).
ARM64_ZIP=$(ls -t "app-tauri/src-tauri/target/aarch64-apple-darwin/release/bundle/zip/"*.zip 2>/dev/null | head -1)
X64_ZIP=$(ls -t   "app-tauri/src-tauri/target/x86_64-apple-darwin/release/bundle/zip/"*.zip 2>/dev/null | head -1)
[ -f "$ARM64_ZIP" ] || die "arm64 zip missing"
[ -f "$X64_ZIP" ]   || die "x86_64 zip missing"
cp "$ARM64_ZIP" "$STAGE/Gap.Map_${VERSION_NUM}_arm64.zip"
cp "$X64_ZIP"   "$STAGE/Gap.Map_${VERSION_NUM}_x64.zip"

# Windows MSI + EXE come from origin CI's draft release (we don't sign these locally)
echo "  pulling Windows artifacts from $ORIGIN_REPO v$VERSION_NUM..."
WIN_DRAFT_AVAILABLE=1
gh release download "$VERSION_TAG" --repo "$ORIGIN_REPO" \
  --dir "$STAGE" \
  --pattern "Gap.Map_${VERSION_NUM}_x64-setup.exe" \
  --pattern "Gap.Map_${VERSION_NUM}_x64_en-US.msi" 2>&1 | tail -3 \
  || { yellow "  ⚠ Windows artifacts not found on origin draft — releasing macOS only"; WIN_DRAFT_AVAILABLE=0; }

ls -lh "$STAGE"/*.dmg "$STAGE"/*.zip "$STAGE"/*.msi "$STAGE"/*.exe 2>&1 | head -10

# ── 7. upload to public release ─────────────────────────────────────────────
bold "── 7. Upload to public release ($PUBLIC_REPO) ──"
# Ensure the public draft exists (create if first run)
if ! gh release view "$VERSION_TAG" --repo "$PUBLIC_REPO" >/dev/null 2>&1; then
  yellow "  no $VERSION_TAG release on $PUBLIC_REPO — creating draft"
  gh release create "$VERSION_TAG" --repo "$PUBLIC_REPO" --target main --draft \
    --title "OpenReply $VERSION_TAG" \
    --notes "(release notes filled in below)" \
    || die "couldn't create draft on $PUBLIC_REPO"
fi

if confirm "upload all artifacts to $PUBLIC_REPO $VERSION_TAG (--clobber)?"; then
  UPLOAD_ARGS=("$STAGE/Gap.Map_${VERSION_NUM}_arm64.dmg"
               "$STAGE/Gap.Map_${VERSION_NUM}_arm64.zip"
               "$STAGE/Gap.Map_${VERSION_NUM}_x64.dmg"
               "$STAGE/Gap.Map_${VERSION_NUM}_x64.zip")
  if [ "$WIN_DRAFT_AVAILABLE" -eq 1 ]; then
    UPLOAD_ARGS+=("$STAGE/Gap.Map_${VERSION_NUM}_x64-setup.exe"
                  "$STAGE/Gap.Map_${VERSION_NUM}_x64_en-US.msi")
  fi
  gh release upload "$VERSION_TAG" --repo "$PUBLIC_REPO" "${UPLOAD_ARGS[@]}" --clobber \
    || die "upload failed"
  green "  ✓ uploaded $(echo "${UPLOAD_ARGS[@]}" | wc -w | tr -d ' ') artifacts"
fi

# ── 8. friendly labels ─────────────────────────────────────────────────────
bold "── 8. Apply friendly asset labels ──"
declare -A LABELS=(
  ["_arm64.dmg"]="macOS — Apple Silicon (.dmg, signed)"
  ["_arm64.zip"]="macOS — Apple Silicon (.app, zipped)"
  ["_x64.dmg"]="macOS — Intel (.dmg, signed)"
  ["_x64.zip"]="macOS — Intel (.app, zipped)"
  ["_x64-setup.exe"]="Windows — installer (.exe)"
  ["_x64_en-US.msi"]="Windows — installer (.msi)"
)
gh release view "$VERSION_TAG" --repo "$PUBLIC_REPO" --json assets \
  --jq '.assets[] | "\(.apiUrl)\t\(.name)"' \
| while IFS=$'\t' read -r url name; do
  for suffix in "${!LABELS[@]}"; do
    if [[ "$name" == *"$suffix" ]]; then
      asset_id="${url##*/}"
      gh api -X PATCH "repos/$PUBLIC_REPO/releases/assets/$asset_id" \
        -f label="${LABELS[$suffix]}" >/dev/null \
        && green "  ✓ labeled $name → ${LABELS[$suffix]}"
      break
    fi
  done
done

# ── 9. publish ──────────────────────────────────────────────────────────────
bold "── 9. Publish release on $PUBLIC_REPO ──"
if confirm "flip $VERSION_TAG from draft → published + mark as --latest?"; then
  gh release edit "$VERSION_TAG" --repo "$PUBLIC_REPO" --draft=false --latest \
    || die "publish failed"
  green "  ✓ published: https://github.com/$PUBLIC_REPO/releases/tag/$VERSION_TAG"
else
  yellow "  publish skipped — release is still a draft"
fi

bold "── done ──"
gh release view "$VERSION_TAG" --repo "$PUBLIC_REPO" --json url,isDraft,assets \
  --jq '{url, isDraft, asset_count: (.assets|length)}'
