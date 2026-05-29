#!/usr/bin/env bash
# rename-public-release-assets.sh — rename release assets in-place on
# GitHub via the API, without re-uploading them.
#
# Used to retroactively re-name the v0.1.4 assets from the
# tauri-action default convention (Gap.Map_0.1.4_arm64.dmg) to the
# user-friendly convention (Gap-Map-0.1.4-macOS-Apple-Silicon.dmg).
# Future releases get the friendly name at upload time via the
# `Rename for friendly download` step inside each per-platform
# release workflow — this script is the migration tool, not the
# steady-state path.
#
# Usage:
#   scripts/rename-public-release-assets.sh <tag> [owner/repo]
#
#   $ scripts/rename-public-release-assets.sh v0.1.4
#   $ scripts/rename-public-release-assets.sh v0.1.4 myind-ai/gapmap
#
# Requires:
#   - gh CLI authenticated with write access to <owner/repo>
#   - The release must exist on <owner/repo>
#   - jq
#
# Idempotent: re-running on an already-renamed release is a no-op.
# Unknown asset names are reported but not touched.
#
# Implementation note: uses a `case` statement instead of `declare -A`
# so the script runs on macOS's bash 3.2 (no associative array
# support there). The full mapping is duplicated in 3 places below:
# in `compute_newname` (the active lookup) and in the docstring map
# above (for grep-ability). Keep both in sync when adding new
# patterns.

set -euo pipefail

VER="${1:?tag required (e.g. v0.1.4)}"
PUBLIC="${2:-myind-ai/gapmap}"
NUM="${VER#v}"

echo "── rename-public-release-assets ──"
echo "  tag:  $VER (num=$NUM)"
echo "  repo: $PUBLIC"
echo

# Mapping (case statement form). Each case-arm produces the friendly
# name for the matched old name. Returns "" for unrecognized inputs;
# the caller treats "" as "leave the asset alone".
#
# OLD pattern → NEW pattern:
#   Gap.Map_<NUM>_arm64.dmg          → Gap-Map-<NUM>-macOS-Apple-Silicon.dmg
#   Gap.Map_<NUM>_arm64.zip          → Gap-Map-<NUM>-macOS-Apple-Silicon.zip
#   Gap.Map_<NUM>_x64.dmg            → Gap-Map-<NUM>-macOS-Intel.dmg
#   Gap.Map_<NUM>_x64.zip            → Gap-Map-<NUM>-macOS-Intel.zip
#   Gap.Map_<NUM>_x64-setup.exe      → Gap-Map-<NUM>-Windows-Installer.exe
#   Gap.Map_<NUM>_x64_en-US.msi      → Gap-Map-<NUM>-Windows.msi
#   Gap.Map_<NUM>_amd64.AppImage     → Gap-Map-<NUM>-Linux.AppImage
#   Gap.Map_<NUM>_amd64.deb          → Gap-Map-<NUM>-Linux.deb
#   Gap.Map_aarch64.app.tar.gz       → Gap-Map-<NUM>-macOS-Apple-Silicon.app.tar.gz
#   Gap.Map_x64.app.tar.gz           → Gap-Map-<NUM>-macOS-Intel.app.tar.gz
compute_newname() {
  local name="$1"
  case "$name" in
    "Gap.Map_${NUM}_arm64.dmg")          echo "Gap-Map-${NUM}-macOS-Apple-Silicon.dmg" ;;
    "Gap.Map_${NUM}_arm64.zip")          echo "Gap-Map-${NUM}-macOS-Apple-Silicon.zip" ;;
    "Gap.Map_${NUM}_x64.dmg")            echo "Gap-Map-${NUM}-macOS-Intel.dmg" ;;
    "Gap.Map_${NUM}_x64.zip")            echo "Gap-Map-${NUM}-macOS-Intel.zip" ;;
    "Gap.Map_${NUM}_x64-setup.exe")      echo "Gap-Map-${NUM}-Windows-Installer.exe" ;;
    "Gap.Map_${NUM}_x64_en-US.msi")      echo "Gap-Map-${NUM}-Windows.msi" ;;
    "Gap.Map_${NUM}_amd64.AppImage")     echo "Gap-Map-${NUM}-Linux.AppImage" ;;
    "Gap.Map_${NUM}_amd64.deb")          echo "Gap-Map-${NUM}-Linux.deb" ;;
    "Gap.Map_aarch64.app.tar.gz")        echo "Gap-Map-${NUM}-macOS-Apple-Silicon.app.tar.gz" ;;
    "Gap.Map_x64.app.tar.gz")            echo "Gap-Map-${NUM}-macOS-Intel.app.tar.gz" ;;
    *) echo "" ;;
  esac
}

# Pull asset list with IDs as a tab-separated stream.
ASSETS_JSON=$(gh api "repos/$PUBLIC/releases/tags/$VER")
if [ -z "$ASSETS_JSON" ]; then
  echo "::error::release $VER not found on $PUBLIC"
  exit 1
fi

renamed=0
skipped=0
unknown_count=0

while IFS=$'\t' read -r id name; do
  newname="$(compute_newname "$name")"
  if [ -z "$newname" ]; then
    echo "  ? $name (unrecognized — leaving alone)"
    unknown_count=$((unknown_count + 1))
    continue
  fi
  if [ "$name" = "$newname" ]; then
    echo "  ✓ $name (already correct)"
    skipped=$((skipped + 1))
    continue
  fi
  echo "  → $name  →  $newname"
  gh api -X PATCH "repos/$PUBLIC/releases/assets/$id" -f name="$newname" >/dev/null
  renamed=$((renamed + 1))
done < <(echo "$ASSETS_JSON" | jq -r '.assets[] | "\(.id)\t\(.name)"')

echo
echo "── summary ──"
echo "  renamed:           $renamed"
echo "  already-correct:   $skipped"
echo "  unrecognized:      $unknown_count"
