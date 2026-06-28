#!/usr/bin/env bash
# promote-release-if-complete.sh — runs at the end of every per-platform
# release workflow (release-mac.yml, release-windows.yml, release-linux.yml).
# Whichever workflow finishes last and finds all required platform
# artifacts uploaded to the public release will flip it from draft →
# latest published.
#
# MAC IS THE ONLY GATE. The release goes live the moment both mac DMGs
# are present (they land together when the mac job finishes). Windows and
# Linux are OPTIONAL — their builds can take much longer and we don't want
# mac users to wait. As each finishes later, its workflow re-runs this,
# sees the release already published, and the `gh release edit --latest`
# no-op is idempotent while its own upload step appends the new assets.
#
# Usage: promote-release-if-complete.sh <tag> <owner/repo>
# Env:   GH_TOKEN must be set to a PAT with write access to <owner/repo>.

set -uo pipefail

VER="${1:?tag required (e.g. v0.1.4)}"
PUBLIC="${2:?owner/repo required}"

echo "── promote-if-complete: $VER on $PUBLIC ──"

# What we MUST have before promoting: BOTH mac installers. Windows + Linux
# artifacts are bonus and append after the release is already live.
# Patterns match the user-friendly names produced by the rename step in
# each per-platform release workflow. Keep in sync with the inlined
# REQUIRED arrays inside release-{mac,windows,linux}.yml and with
# scripts/rename-public-release-assets.sh.
REQUIRED_PATTERNS=(
  '-macOS-Apple-Silicon\.dmg$'
  '-macOS-Intel\.dmg$'
)

# Pull asset name list once.
ASSETS=$(gh release view "$VER" --repo "$PUBLIC" --json assets --jq '.assets[].name' 2>/dev/null) || {
  echo "  release $VER not found on $PUBLIC — nothing to promote"
  exit 0
}

echo "  current assets:"
echo "$ASSETS" | sed 's/^/    - /'

MISSING=()
for pattern in "${REQUIRED_PATTERNS[@]}"; do
  if ! echo "$ASSETS" | grep -qE -- "$pattern"; then
    MISSING+=("$pattern")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "  ⏳ waiting on missing platforms:"
  for m in "${MISSING[@]}"; do echo "    - $m"; done
  echo "  release stays draft until those land. NOT promoting."
  exit 0
fi

# All required present — flip to published + latest if still draft.
IS_DRAFT=$(gh release view "$VER" --repo "$PUBLIC" --json isDraft --jq '.isDraft' 2>/dev/null)
if [ "$IS_DRAFT" = "true" ]; then
  echo "  ✓ all required platforms present — flipping draft → latest published"
  gh release edit "$VER" --repo "$PUBLIC" --draft=false --latest
  echo "  ✓ promoted $VER to latest on $PUBLIC"
else
  echo "  already published — nothing to do"
fi
