#!/usr/bin/env bash
# Gap Map — one-command setup + run for the Tauri dev app.
#
# Usage:
#   ./scripts/dev.sh            # doctor + (install if needed) + launch
#   ./scripts/dev.sh setup      # install deps only, don't launch
#   ./scripts/dev.sh doctor     # sidecar health check only
#   ./scripts/dev.sh kill       # stop any running gapmap/tauri/vite
#   ./scripts/dev.sh clean      # kill + remove build artifacts (safe)
#   ./scripts/dev.sh reset-db   # wipe the app's SQLite DB (destructive — asks)
#
# Fails loud on any preflight issue instead of starting a broken app.

set -euo pipefail

cd "$(dirname "$0")/.."

GREEN=$'\033[32m'
RED=$'\033[31m'
YELLOW=$'\033[33m'
CYAN=$'\033[36m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

hdr()  { printf '\n%s── %s ──%s\n' "${CYAN}${BOLD}" "$1" "${RESET}"; }
ok()   { printf '  %s✓%s %s\n' "${GREEN}" "${RESET}" "$1"; }
warn() { printf '  %s!%s %s\n' "${YELLOW}" "${RESET}" "$1"; }
die()  { printf '  %s✗%s %s\n' "${RED}" "${RESET}" "$1" >&2; exit 1; }

# ────────────────────────────────────────────────────────────── preflight ──

preflight() {
  hdr "preflight"
  command -v node  >/dev/null 2>&1 || die "node not found — install Node 18+"
  command -v cargo >/dev/null 2>&1 || die "cargo not found — install Rust via rustup"
  ok "node  $(node --version)"
  ok "cargo $(cargo --version | cut -d' ' -f2)"

  # Prefer the venv Python if it exists; otherwise require system Python 3.11+.
  # pyproject.toml declares `requires-python = ">=3.11"`, so 3.9/3.10 can't
  # even build the venv.
  local py
  if [ -x .venv/bin/python ]; then
    py=.venv/bin/python
    ok "python (venv) $($py --version | cut -d' ' -f2)"
  else
    # Pick the first available python that's >= 3.11
    for cand in python3.13 python3.12 python3.11 python3; do
      if command -v "$cand" >/dev/null 2>&1; then
        local ver
        ver=$("$cand" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")' 2>/dev/null || echo "0.0")
        # shellcheck disable=SC2072
        if [[ "$ver" > "3.10" ]] || [[ "$ver" == "3.11" ]]; then
          py="$cand"
          ok "python $ver ($cand)"
          break
        fi
      fi
    done
    if [ -z "${py:-}" ]; then
      die "no Python 3.11+ found — install Python 3.11 or later (brew install python@3.12)"
    fi
  fi
  # Expose for install_python so it uses the same interpreter we just validated.
  export GAPMAP_BOOTSTRAP_PYTHON="$py"

  if ! command -v ollama >/dev/null 2>&1; then
    warn "ollama not in PATH — local LLM will fail (fine if you use BYOK cloud keys)"
  else
    ok "ollama $(ollama --version 2>/dev/null | head -1 || echo 'installed')"
  fi
}

# ───────────────────────────────────────────────────────── kill stray procs ──

kill_running() {
  hdr "stop any running instances"
  local killed=0
  # Tauri dev wrapper + its spawned gapmap binary + vite + esbuild
  for pattern in "npm run tauri dev" "node.*\.bin/tauri" "node.*\.bin/vite" "target/debug/gapmap" "esbuild.*service" ; do
    local pids
    pids=$(pgrep -f "$pattern" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      # shellcheck disable=SC2086
      kill $pids 2>/dev/null || true
      killed=$((killed + $(echo "$pids" | wc -w)))
    fi
  done
  sleep 1
  # Second pass with SIGKILL for anything that ignored SIGTERM
  for pattern in "target/debug/gapmap" "node.*\.bin/vite" ; do
    local pids
    pids=$(pgrep -f "$pattern" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  done
  # Free port 1420 if anything is still holding it (Vite's default)
  if command -v lsof >/dev/null 2>&1; then
    local port_pid
    port_pid=$(lsof -ti :1420 2>/dev/null || true)
    if [ -n "$port_pid" ]; then
      # shellcheck disable=SC2086
      kill -9 $port_pid 2>/dev/null || true
      killed=$((killed + 1))
    fi
  fi
  if [ "$killed" -gt 0 ]; then
    ok "stopped $killed process(es)"
  else
    ok "nothing was running"
  fi
}

# ─────────────────────────────────────────────────────────── dependencies ──

install_python() {
  hdr "python deps"
  if [ ! -d .venv ]; then
    local bootstrap="${GAPMAP_BOOTSTRAP_PYTHON:-python3}"
    ok "creating .venv ($bootstrap -m venv .venv)"
    "$bootstrap" -m venv .venv || die ".venv creation failed (tried $bootstrap)"
  else
    ok ".venv exists"
  fi
  # Install project + ALL optional extras used by the app (sources, ingest-rich,
  # analyze). Editable install so Python edits are picked up on next sidecar
  # restart with no reinstall needed.
  # Check if gapmap is importable first — skip heavy pip work if so.
  if ! .venv/bin/python -c "import gapmap, feedparser, pypdf, google_play_scraper, pytrends, networkx" 2>/dev/null; then
    ok "installing package + extras (this can take ~30s first time)…"
    .venv/bin/pip install -e '.[sources,ingest-rich,analyze]' --quiet || \
      die "pip install failed — re-run: .venv/bin/pip install -e '.[sources,ingest-rich,analyze]'"
  else
    ok "python package + extras already installed"
  fi
}

install_node() {
  hdr "node deps"
  if [ ! -d app-tauri/node_modules ]; then
    ok "running npm install in app-tauri/"
    (cd app-tauri && npm install --silent) || die "npm install failed"
  else
    ok "app-tauri/node_modules present"
  fi
}

# ──────────────────────────────────────────────────────── sidecar doctor ──

run_doctor() {
  hdr "sidecar doctor"
  if ! .venv/bin/python scripts/doctor.py; then
    die "doctor reported critical issues — fix them before launching (see output above)"
  fi
}

# ─────────────────────────────────────────────────────── reset / clean ──

reset_db() {
  hdr "reset the Tauri app's SQLite DB"
  local app_db="$HOME/Library/Application Support/com.shantanu.gapmap/gapmap"
  if [ ! -d "$app_db" ]; then
    ok "no DB found at $app_db (already clean)"
    return
  fi
  printf '  ! This will delete %s (all collected data).\n  Type YES to confirm: ' "$app_db"
  read -r reply
  if [ "$reply" = "YES" ]; then
    rm -rf "$app_db"
    ok "DB wiped"
  else
    warn "aborted — nothing deleted"
  fi
}

clean_build() {
  hdr "clean build artifacts (non-destructive — keeps deps)"
  rm -rf app-tauri/src-tauri/target/debug/build app-tauri/dist 2>/dev/null || true
  ok "removed target/debug/build + dist/"
}

# ─────────────────────────────────────────────────────────────── launch ──

launch() {
  hdr "launch"
  # The tauri-python-sidecar-app skill recommends a dev venv bypass so macOS
  # Gatekeeper doesn't hang the bundled PyInstaller binary for 2+ minutes on
  # first run. Rust `cli.rs` checks for GAPMAP_DEV_PYTHON and uses it when set.
  export GAPMAP_DEV_PYTHON="$(pwd)/.venv/bin/python"
  ok "GAPMAP_DEV_PYTHON=$GAPMAP_DEV_PYTHON"
  # cli.rs walks up 5 parent dirs looking for .venv/bin/python, so the explicit
  # override above is belt-and-braces. Setting it means the sidecar uses the
  # dev venv even if you launch Tauri from a different cwd.
  printf '\n%s→ starting `npm run tauri dev` (Ctrl-C to stop)…%s\n\n' "${CYAN}" "${RESET}"
  cd app-tauri && exec npm run tauri dev
}

# ──────────────────────────────────────────────────────────────── main ──

cmd="${1:-dev}"
case "$cmd" in
  dev|"")
    preflight
    kill_running
    install_python
    install_node
    run_doctor
    launch
    ;;
  setup)
    preflight
    install_python
    install_node
    run_doctor
    hdr "done"
    ok "setup complete — run './scripts/dev.sh' to launch"
    ;;
  doctor)
    run_doctor
    ;;
  kill|stop)
    kill_running
    ;;
  clean)
    kill_running
    clean_build
    ;;
  reset-db)
    kill_running
    reset_db
    ;;
  *)
    printf 'unknown command: %s\n' "$cmd" >&2
    printf 'usage: %s {dev|setup|doctor|kill|clean|reset-db}\n' "$0" >&2
    exit 2
    ;;
esac
