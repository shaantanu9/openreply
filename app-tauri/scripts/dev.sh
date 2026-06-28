#!/usr/bin/env bash
# Tauri-dev wrapper that prevents the "Blocking waiting for file lock on
# package cache" stall.
#
# Root cause: every cargo invocation (rust-analyzer, a leftover `tauri
# dev` from a previous session, a stale `cargo run` from a crashed
# terminal) takes a flock on ~/.cargo/.package-cache. Exiting an IDE
# tab does not always reap the worker. The next `tauri dev` then waits
# forever because the dead process never released its lock.
#
# This script:
#   1. Detects every cargo / rustc / tauri-cli process owned by the
#      current user that is NOT this script's pid.
#   2. SIGTERMs them, gives them 2s, then SIGKILLs anything still alive.
#   3. Removes the stale ~/.cargo/.package-cache marker file (cargo
#      recreates it on next start; an empty file with no flock holder
#      is harmless but we clear it so its mtime reflects this session).
#   4. Execs the real `tauri dev` so signals reach it cleanly.
#
# DEV-ONLY. Production builds (Vercel, GH Actions, asc release) never
# call this — they invoke `cargo build --release` directly with no IDE
# in the picture, so contention is impossible there.

set -euo pipefail

SELF_PID=$$
USER_ID=$(id -u)

# ── 1. find every cargo / rustc / tauri-cli we own ─────────────────────────
# Bash 3.2 (macOS default) has no mapfile; use a portable read loop.
STALE=()
while IFS= read -r _pid; do
  [[ -n "$_pid" ]] && STALE+=("$_pid")
done < <(ps -u "$USER_ID" -o pid=,comm= 2>/dev/null \
  | awk '$2 ~ /(cargo|rustc|tauri-cli)$/ { print $1 }' \
  | grep -v "^${SELF_PID}\$" || true)

if (( ${#STALE[@]} )); then
  echo "→ killing ${#STALE[@]} stale cargo/rustc process(es): ${STALE[*]}"
  kill -TERM "${STALE[@]}" 2>/dev/null || true
  sleep 2
  # SIGKILL anything still alive
  for pid in "${STALE[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
fi

# ── 2. clear the stale marker (the flock itself died with the process) ────
if [[ -f "$HOME/.cargo/.package-cache" ]]; then
  rm -f "$HOME/.cargo/.package-cache"
fi

cd "$(dirname "$0")/.."

# ── 3. self-heal the onedir sidecar resource ──────────────────────────────
# The bundled onedir engine is gitignored, so `git clean -fdx` / disk cleanups
# wipe it; the Tauri `resources` glob (openreply-cli-onedir/**/*) then matches
# nothing and the build dies with "path not found". Dev runs the sidecar via the
# .venv python anyway, so: restore the real engine from a prior build if present,
# and ALWAYS guarantee at least one file in the dir so the build can never crash.
ONEDIR="src-tauri/binaries/openreply-cli-onedir"
if [[ ! -x "$ONEDIR/openreply-cli" && -x ../dist/openreply-cli/openreply-cli ]]; then
  echo "→ restoring onedir sidecar from ../dist/openreply-cli"
  rm -rf "$ONEDIR"; cp -R ../dist/openreply-cli "$ONEDIR" 2>/dev/null || true
fi
mkdir -p "$ONEDIR"
[[ -e "$ONEDIR/.keep" ]] || : > "$ONEDIR/.keep"

# ── 4. hand off to the real tauri dev ─────────────────────────────────────
if [[ -x ./node_modules/.bin/tauri ]]; then
  exec ./node_modules/.bin/tauri dev "$@"
fi
exec npx tauri dev "$@"
