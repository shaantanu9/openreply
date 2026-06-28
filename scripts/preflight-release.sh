#!/usr/bin/env bash
# Pre-tag release checklist — runs BEFORE `git tag` so the version-mismatch
# and signing-creds-missing traps get caught while they're still easy to fix.
#
# Without this guard we hit the same 3 mistakes on 3 different releases:
#   1. Push tag without bumping tauri.conf.json → CI uploads artifacts
#      labeled with OLD version, to the OLD release object. Recovery is
#      ~60 min of CI re-runs + tag dance.
#   2. CI build succeeds but DMG is ad-hoc signed (no APPLE_CERTIFICATE
#      secret set), then we publish + tell users "notarized by Apple".
#      Discover the lie weeks later; loss of trust, no easy recovery.
#   3. .env.publish or Developer ID cert missing from this machine when
#      we go to sign locally; have to re-acquire creds mid-release.
#
# Usage:
#   scripts/preflight-release.sh v0.1.1
#
# Exits non-zero on ANY failed check. Pre-push git hook calls this for
# any v* tag push (see .git/hooks/pre-push).

set -uo pipefail

VERSION_TAG="${1:-}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── colors ─────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  red() { printf '\033[31m%s\033[0m\n' "$*"; }
  green() { printf '\033[32m%s\033[0m\n' "$*"; }
  yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
  bold() { printf '\033[1m%s\033[0m\n' "$*"; }
else
  red() { echo "$*"; }; green() { echo "$*"; }; yellow() { echo "$*"; }; bold() { echo "$*"; }
fi

FAIL=0
WARN=0
ok()    { green "  ok    $*"; }
fail()  { red   "  FAIL  $*"; FAIL=$((FAIL+1)); }
warn()  { yellow "  warn  $*"; WARN=$((WARN+1)); }

bold "── Release preflight ──"

# ── 0. argument check ───────────────────────────────────────────────────────
if [ -z "$VERSION_TAG" ]; then
  red "USAGE: $0 v<X.Y.Z>"
  red "   e.g.  $0 v0.1.1"
  exit 2
fi
if [[ ! "$VERSION_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  fail "tag '$VERSION_TAG' doesn't match vX.Y.Z"
fi
VERSION_NUM="${VERSION_TAG#v}"
echo "  target version: $VERSION_TAG  (numeric: $VERSION_NUM)"

# ── 1. version pins match the tag ──────────────────────────────────────────
bold "1. Version pins"
TAURI_CONF="app-tauri/src-tauri/tauri.conf.json"
PKG_JSON="app-tauri/package.json"
CARGO_TOML="app-tauri/src-tauri/Cargo.toml"
PYPROJECT_TOML="pyproject.toml"

# Use python3 (guaranteed on macOS + Linux) for JSON parsing — BSD sed
# regex flavors differ from GNU and made the value strings come out dirty.
extract_json_version() {
  python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$1" 2>/dev/null
}

if [ ! -f "$TAURI_CONF" ]; then
  fail "$TAURI_CONF not found"
else
  CONF_VER=$(extract_json_version "$TAURI_CONF")
  if [ "$CONF_VER" = "$VERSION_NUM" ]; then
    ok "tauri.conf.json version = $CONF_VER"
  else
    fail "tauri.conf.json version = '$CONF_VER'  (expected '$VERSION_NUM')"
    yellow "        fix: edit $TAURI_CONF → \"version\": \"$VERSION_NUM\""
  fi
fi

if [ ! -f "$PKG_JSON" ]; then
  fail "$PKG_JSON not found"
else
  PKG_VER=$(extract_json_version "$PKG_JSON")
  if [ "$PKG_VER" = "$VERSION_NUM" ]; then
    ok "package.json version = $PKG_VER"
  else
    fail "package.json version = '$PKG_VER'  (expected '$VERSION_NUM')"
    yellow "        fix: edit $PKG_JSON → \"version\": \"$VERSION_NUM\""
  fi
fi

if [ ! -f "$CARGO_TOML" ]; then
  fail "$CARGO_TOML not found"
else
  # First `^version =` line after a [package] header (TOML)
  CARGO_VER=$(awk '/^\[package\]/{p=1; next} /^\[/{p=0} p && /^version[[:space:]]*=/{
    sub(/^version[[:space:]]*=[[:space:]]*"/,"")
    sub(/".*$/,"")
    print; exit
  }' "$CARGO_TOML")
  if [ "$CARGO_VER" = "$VERSION_NUM" ]; then
    ok "Cargo.toml version = $CARGO_VER"
  else
    fail "Cargo.toml version = '$CARGO_VER'  (expected '$VERSION_NUM')"
    yellow "        fix: edit $CARGO_TOML → version = \"$VERSION_NUM\""
  fi
fi

if [ ! -f "$PYPROJECT_TOML" ]; then
  fail "$PYPROJECT_TOML not found"
else
  # First `^version =` line after a [project] header (TOML)
  PYPROJECT_VER=$(awk '/^\[project\]/{p=1; next} /^\[/{p=0} p && /^version[[:space:]]*=/{
    sub(/^version[[:space:]]*=[[:space:]]*"/,"")
    sub(/".*$/,"")
    print; exit
  }' "$PYPROJECT_TOML")
  if [ "$PYPROJECT_VER" = "$VERSION_NUM" ]; then
    ok "pyproject.toml version = $PYPROJECT_VER"
  else
    fail "pyproject.toml version = '$PYPROJECT_VER'  (expected '$VERSION_NUM')"
    yellow "        fix: edit $PYPROJECT_TOML → version = \"$VERSION_NUM\""
  fi
fi

# ── 2. tag uniqueness ──────────────────────────────────────────────────────
bold "2. Tag uniqueness"
if git rev-parse "$VERSION_TAG" >/dev/null 2>&1; then
  fail "tag '$VERSION_TAG' already exists locally"
  yellow "        fix: git tag -d $VERSION_TAG && git push origin :refs/tags/$VERSION_TAG"
else
  ok "tag '$VERSION_TAG' is free locally"
fi

if git ls-remote --exit-code --tags origin "refs/tags/$VERSION_TAG" >/dev/null 2>&1; then
  fail "tag '$VERSION_TAG' already exists on origin"
  yellow "        fix: git push origin :refs/tags/$VERSION_TAG"
else
  ok "tag '$VERSION_TAG' is free on origin"
fi

# ── 3. working tree is clean ───────────────────────────────────────────────
bold "3. Working tree"
if [ -n "$(git status --porcelain)" ]; then
  fail "uncommitted changes — tagging a dirty tree will tag whatever is staged"
  git status --short | head -10 | sed 's/^/        /'
  yellow "        fix: commit or stash before tagging"
else
  ok "clean working tree"
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
case "$BRANCH" in
  main|master|multi-source)
    ok "on release branch: $BRANCH"
    ;;
  *)
    warn "on branch '$BRANCH' — release branches are usually main/master/multi-source"
    ;;
esac

# ── 4. .env.publish exists with Apple creds (for signing pipeline) ─────────
bold "4. Apple signing credentials (.env.publish)"
ENV_PUBLISH=".env.publish"
if [ ! -f "$ENV_PUBLISH" ]; then
  fail ".env.publish not found — local signing pipeline can't run"
  yellow "        fix: create .env.publish with APPLE_SIGNING_IDENTITY,"
  yellow "             APPLE_TEAM_ID, APPLE_API_KEY, APPLE_API_ISSUER,"
  yellow "             APPLE_API_KEY_PATH"
else
  ok ".env.publish exists"
  # shellcheck disable=SC1091
  set -a; source "$ENV_PUBLISH"; set +a
  for var in APPLE_SIGNING_IDENTITY APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH; do
    if [ -z "${!var:-}" ]; then
      fail ".env.publish missing $var"
    else
      ok "$var is set"
    fi
  done
  if [ -n "${APPLE_API_KEY_PATH:-}" ] && [ ! -f "$APPLE_API_KEY_PATH" ]; then
    fail "APPLE_API_KEY_PATH=$APPLE_API_KEY_PATH — file does not exist"
  elif [ -n "${APPLE_API_KEY_PATH:-}" ]; then
    ok "AuthKey .p8 file readable: $APPLE_API_KEY_PATH"
  fi
fi

# ── 5. Developer ID cert in keychain ────────────────────────────────────────
bold "5. Developer ID cert in keychain"
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  if security find-identity -v -p codesigning 2>/dev/null | grep -qF "$APPLE_SIGNING_IDENTITY"; then
    ok "Developer ID Application cert present"
    ok "  identity: $APPLE_SIGNING_IDENTITY"
  else
    fail "cert '$APPLE_SIGNING_IDENTITY' NOT in keychain"
    yellow "        fix: import the .p12 with"
    yellow "             security import path/to/DevID.p12 -P <password> -T /usr/bin/codesign"
  fi
else
  warn "APPLE_SIGNING_IDENTITY unset — skipping cert keychain check"
fi

# ── 6. publish script presence ─────────────────────────────────────────────
bold "6. Local signing scripts"
for f in scripts/publish-mac.sh scripts/verify-dmg.sh; do
  if [ -x "$f" ]; then
    ok "$f is executable"
  elif [ -f "$f" ]; then
    warn "$f exists but is not executable — chmod +x $f"
  else
    if [ "$f" = "scripts/verify-dmg.sh" ]; then
      warn "$f not present — post-build verification will be manual"
    else
      fail "$f not present"
    fi
  fi
done

# ── summary ─────────────────────────────────────────────────────────────────
echo
bold "── Summary ──"
if [ "$FAIL" -gt 0 ]; then
  red "  $FAIL check(s) failed. Fix above before tagging."
  exit 1
elif [ "$WARN" -gt 0 ]; then
  yellow "  $WARN warning(s). Tag at your own risk."
  green  "  All hard checks passed — safe to:"
  echo   "    git tag -a $VERSION_TAG -m \"<title>\""
  echo   "    git push origin $VERSION_TAG"
  exit 0
else
  green "  All checks passed. Safe to tag:"
  echo  "    git tag -a $VERSION_TAG -m \"<title>\""
  echo  "    git push origin $VERSION_TAG"
  exit 0
fi
