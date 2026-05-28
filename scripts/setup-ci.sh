#!/usr/bin/env bash
# One-shot setup for autonomous tag → release flow.
#
# Reads .env.publish (Apple creds) + a few interactive prompts, then sets
# every secret CI needs so a future `git push origin v0.1.X` produces a
# signed, notarized, published release on the public repo with zero
# further human action.
#
# Required from you (one-time):
#   • Export Developer ID Application .p12 from Keychain Access
#     (right-click cert → Export → format=.p12 → choose a password)
#   • Generate a GitHub PAT with `contents: write` on the public release
#     repo (https://github.com/settings/tokens?type=beta — fine-grained
#     is preferred, classic with `repo` scope also works)
#
# Usage:
#   scripts/setup-ci.sh
#
# Re-runnable. Will overwrite existing secret values with what you
# provide (safe if you're rotating any of them).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

SRC_REPO="${SRC_REPO:-shaantanu9/gap-map-pro}"
PUBLIC_REPO="${PUBLIC_REPO:-myind-ai/gapmap}"

if [ -t 1 ]; then
  bold() { printf '\033[1m%s\033[0m\n' "$*"; }
  green() { printf '\033[32m%s\033[0m\n' "$*"; }
  red() { printf '\033[31m%s\033[0m\n' "$*"; }
  yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
else
  bold() { echo "$*"; }; green() { echo "$*"; }; red() { echo "$*"; }; yellow() { echo "$*"; }
fi

set_secret() {
  local name="$1"
  local value="$2"
  if [ -z "$value" ]; then
    yellow "  ⚠ $name skipped (empty value)"
    return
  fi
  echo -n "$value" | gh secret set "$name" --repo "$SRC_REPO" >/dev/null \
    && green "  ✓ $name set" \
    || red   "  ✗ $name FAILED to set"
}

bold "── 0. Auth check ──"
if ! gh auth status >/dev/null 2>&1; then
  red "gh is not logged in. Run: gh auth login"
  exit 1
fi
GH_USER=$(gh api user --jq .login)
echo "  authenticated as $GH_USER → setting secrets on $SRC_REPO"
echo "  public release target: $PUBLIC_REPO"

# ── 1. Load Apple creds from .env.publish ───────────────────────────────────
bold "── 1. Load .env.publish ──"
if [ ! -f .env.publish ]; then
  red "  .env.publish not found at repo root — required."
  exit 1
fi
set -a; source .env.publish; set +a
echo "  loaded APPLE_TEAM_ID + APPLE_SIGNING_IDENTITY + APPLE_API_*"

# ── 2. Prompt for items not in .env.publish ─────────────────────────────────
bold "── 2. Items you need to provide ──"

# 2a. .p12 export
echo ""
echo "  STEP A — Developer ID .p12 export from Keychain Access:"
echo "    1. Open Keychain Access"
echo "    2. login keychain → search for: $APPLE_SIGNING_IDENTITY"
echo "    3. Right-click the certificate → Export"
echo "    4. File format: 'Personal Information Exchange (.p12)'"
echo "    5. Save as: ~/dev-id-application.p12"
echo "    6. Set a password (you'll paste it in next)"
echo ""
read -rp "  Path to exported .p12 [~/dev-id-application.p12]: " P12_PATH
P12_PATH="${P12_PATH:-$HOME/dev-id-application.p12}"
P12_PATH="${P12_PATH/#\~/$HOME}"
if [ ! -f "$P12_PATH" ]; then
  red "  .p12 file not found at $P12_PATH — export it first then re-run."
  exit 1
fi
read -rsp "  Password you set on the .p12 export: " P12_PASS; echo
if [ -z "$P12_PASS" ]; then
  red "  empty password — Apple requires one on .p12 export. Re-run."
  exit 1
fi

# 2b. App-specific password OR rely on API key
echo ""
echo "  STEP B — App-specific password for notarytool"
echo "    (Apple ID alternative — leave blank if you'll use the API key only)"
echo "    Generate at https://appleid.apple.com → Sign-In and Security → App-Specific Passwords"
echo ""
read -rsp "  APPLE_PASSWORD (leave blank to use API key only): " APP_PASS; echo

# 2c. PAT for cross-repo write
echo ""
echo "  STEP C — Personal access token with write access to $PUBLIC_REPO"
echo "    Easiest: https://github.com/settings/tokens?type=beta"
echo "    Scope: contents: write on $PUBLIC_REPO (fine-grained, repo-scoped)"
echo "    OR classic PAT with 'repo' scope works too."
echo ""
read -rsp "  PAT for $PUBLIC_REPO writes: " PUBLIC_PAT; echo
if [ -z "$PUBLIC_PAT" ]; then
  yellow "  ⚠ Empty PAT — publish-public CI job will fail. Re-run setup when you have one."
fi

# ── 3. Encode + push secrets via gh CLI ──────────────────────────────────────
bold "── 3. Push secrets to $SRC_REPO ──"

# .p12 → base64 (single line)
P12_B64=$(base64 -i "$P12_PATH" | tr -d '\n')
set_secret APPLE_CERTIFICATE          "$P12_B64"
set_secret APPLE_CERTIFICATE_PASSWORD "$P12_PASS"
set_secret APPLE_SIGNING_IDENTITY     "${APPLE_SIGNING_IDENTITY:-}"
set_secret APPLE_TEAM_ID              "${APPLE_TEAM_ID:-}"
set_secret APPLE_ID                   "${APPLE_ID:-}"
[ -n "$APP_PASS" ] && set_secret APPLE_PASSWORD "$APP_PASS"

# API-key path: inline the .p8 content so CI doesn't need a file path.
if [ -n "${APPLE_API_KEY_PATH:-}" ] && [ -f "$APPLE_API_KEY_PATH" ]; then
  set_secret APPLE_API_KEY    "${APPLE_API_KEY:-}"
  set_secret APPLE_API_ISSUER "${APPLE_API_ISSUER:-}"
  P8_CONTENT=$(cat "$APPLE_API_KEY_PATH")
  set_secret APPLE_API_KEY_CONTENT "$P8_CONTENT"
  yellow "  ℹ stored .p8 content as APPLE_API_KEY_CONTENT (release.yml writes it to a file at job start)"
else
  yellow "  ⚠ APPLE_API_KEY_PATH not set or file missing — skipping API-key secrets"
fi

# JWT desktop secret — used by build.rs. If unset locally, generate one
# stable per-repo value and reuse forever (the activation system needs a
# stable secret to validate signed licenses).
if [ -z "${JWT_DESKTOP_SECRET:-}" ]; then
  JWT_DESKTOP_SECRET=$(openssl rand -hex 32)
  yellow "  ℹ generated new JWT_DESKTOP_SECRET (32 bytes hex). Save to .env.publish."
fi
set_secret JWT_DESKTOP_SECRET "$JWT_DESKTOP_SECRET"

# Cross-repo publish token
set_secret PUBLIC_RELEASE_TOKEN "$PUBLIC_PAT"

# Public repo target — exposed as a `vars`-level variable so changing
# org/repo doesn't require code edits in release.yml.
echo -n "$PUBLIC_REPO" | gh variable set PUBLIC_RELEASE_REPO --repo "$SRC_REPO" \
  && green "  ✓ PUBLIC_RELEASE_REPO variable set to $PUBLIC_REPO"

# ── 4. Verify state ──────────────────────────────────────────────────────────
bold "── 4. Verify ──"
gh secret list --repo "$SRC_REPO" | grep -E "APPLE|JWT|PUBLIC_RELEASE" | head -20

echo ""
bold "── Done ──"
green "  Push any v* tag from now on and the full pipeline runs autonomously:"
echo  "    git tag -a v0.1.2 -m 'Gap Map v0.1.2'"
echo  "    git push origin v0.1.2"
echo
echo  "  CI will:"
echo  "    1. Build + sign + notarize mac arm64 + mac x64 + windows"
echo  "    2. Upload to the gap-map-pro draft release"
echo  "    3. Publish-public job: rename, rezip, upload to $PUBLIC_REPO,"
echo  "       apply labels, flip draft → latest"
echo  ""
echo  "  Track the run live:"
echo  "    gh run watch --repo $SRC_REPO"
