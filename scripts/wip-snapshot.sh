#!/usr/bin/env bash
# wip-snapshot.sh — triple-redundant backup of ALL uncommitted work so nothing
# is ever lost during a commit/reset/rebase. Safe to run any time; never
# modifies the working tree.
#
#   1. File copies   → ~/reddit-myind-wip-backups/<ts>/files/<path>   (full content of every WIP file)
#   2. Patch         → ~/reddit-myind-wip-backups/<ts>/all-tracked-changes.patch
#   3. Git branch    → wip-safety-<ts>   (permanent ref, survives in reflog)
#
# Usage:
#   scripts/wip-snapshot.sh            # snapshot now
#   KEEP=20 scripts/wip-snapshot.sh    # keep last 20 backups (default 30)
#
# Recover a single file later:
#   cp ~/reddit-myind-wip-backups/<ts>/files/<path> <path>
# Or inspect a whole snapshot:
#   git show wip-safety-<ts> --stat
set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"
cd "$REPO"

# Nothing to back up? exit quietly (keeps the pre-commit hook fast on clean trees).
if [ -z "$(git status --porcelain)" ]; then
  exit 0
fi

TS="$(date +%Y%m%d_%H%M%S)"
ROOT="$HOME/reddit-myind-wip-backups"
DIR="$ROOT/$TS"
mkdir -p "$DIR/files"

# 1. file-level copies (modified + untracked, excluding gitignored), preserving paths
git ls-files -m -o --exclude-standard | rsync -aR --files-from=- . "$DIR/files/" 2>/dev/null || true

# 2. patch + manifests
git diff HEAD               > "$DIR/all-tracked-changes.patch" 2>/dev/null || true
git ls-files -m --exclude-standard > "$DIR/MODIFIED-tracked.txt" 2>/dev/null || true
git ls-files -o --exclude-standard > "$DIR/UNTRACKED.txt"        2>/dev/null || true
git rev-parse HEAD          > "$DIR/HEAD-was.txt" 2>/dev/null || true

# 3. permanent git branch via a stash round-trip that leaves the tree untouched
if git stash push -u -q -m "wip-safety-$TS" 2>/dev/null; then
  git stash apply -q 2>/dev/null || true
  git branch "wip-safety-$TS" "stash@{0}" 2>/dev/null || true
  git stash drop -q 2>/dev/null || true
fi

# prune old backups (dirs + branches), keep the newest $KEEP
KEEP="${KEEP:-30}"
ls -1dt "$ROOT"/*/ 2>/dev/null | tail -n +$((KEEP+1)) | xargs -I{} rm -rf "{}" 2>/dev/null || true
git for-each-ref --format='%(refname:short)' refs/heads/wip-safety-* 2>/dev/null \
  | sort -r | tail -n +$((KEEP+1)) | xargs -r -I{} git branch -D {} >/dev/null 2>&1 || true

echo "[wip-snapshot] backed up to $DIR  (+ branch wip-safety-$TS)" >&2
