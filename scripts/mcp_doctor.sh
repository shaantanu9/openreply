#!/usr/bin/env bash
# mcp_doctor.sh — diagnose every common reason "MCP keeps failing / losing connection"
# for the gapmap server across all 3 MCP clients (Claude Code, Claude
# Desktop, Cursor). No fixes — just reports. Run this whenever a client says
# the server disconnected.
#
# Usage:  bash scripts/mcp_doctor.sh
#
# What it checks:
#   1. The configured `command` for each client (must exist + be executable).
#   2. The PID file under the data dir + whether that PID is alive.
#   3. The token file matches the env block in each client config.
#   4. Recent stderr from each client's MCP log (if it exists).
#   5. A 5-second smoke launch of the server to confirm it actually starts
#      (without holding it open — clean SIGTERM after the handshake).

set -u

DATA_DIR="${GAPMAP_DATA_DIR:-$HOME/Library/Application Support/com.shantanu.gapmap/gapmap}"
PROJECT_DIR="${GAPMAP_PROJECT_DIR:-$HOME/Documents/GitHub/reddit-myind}"

# Colors for readability — unset when piped (CI safety).
if [ -t 1 ]; then
  R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; Z=$'\033[0m'; B=$'\033[1m'
else
  R=""; G=""; Y=""; C=""; Z=""; B=""
fi

ok()   { echo "${G}✅${Z} $1"; }
warn() { echo "${Y}⚠ ${Z} $1"; }
err()  { echo "${R}❌${Z} $1"; }
info() { echo "${C}ℹ ${Z} $1"; }
hdr()  { echo ""; echo "${B}=== $1 ===${Z}"; }

hdr "1. Data dir + pid file"
echo "   data_dir = $DATA_DIR"
if [ ! -d "$DATA_DIR" ]; then
  err "data_dir does not exist — run the desktop app once to create it"
else
  ok "data_dir exists"
fi

PIDFILE="$DATA_DIR/mcp-server.pid"
if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE" | tr -d ' \n\r')
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    INFO=$(ps -p "$PID" -o etime=,rss=,command= 2>/dev/null | tr -s ' ')
    ok "pid file → $PID is ALIVE${INFO:+ ·$INFO}"
  else
    warn "pid file → $PID is DEAD (stale lock; will be auto-cleaned next start)"
  fi
else
  info "no pid file — no MCP server running for this data dir"
fi

TOKFILE="$DATA_DIR/mcp_token"
if [ -f "$TOKFILE" ]; then
  TOK=$(head -c 80 "$TOKFILE")
  ok "token file present ($(wc -c < "$TOKFILE" | tr -d ' ') bytes)"
else
  warn "no token file — server will refuse authenticated tool calls"
  TOK=""
fi

hdr "2. Running 'mcp serve' processes"
PROCS=$(pgrep -af "mcp serve" 2>/dev/null | grep -v doctor || true)
if [ -z "$PROCS" ]; then
  info "no mcp serve processes running"
else
  echo "$PROCS"
  N=$(echo "$PROCS" | wc -l | tr -d ' ')
  if [ "$N" -gt 1 ]; then
    warn "$N processes running — duplicates can race on the pidfile lock"
  fi
fi

hdr "3. Client configs"
for f in "$HOME/.claude.json" "$HOME/.cursor/mcp.json" "$HOME/Library/Application Support/Claude/claude_desktop_config.json"; do
  if [ ! -f "$f" ]; then continue; fi
  echo "${B}— $f${Z}"
  python3 - "$f" "$TOK" <<'PY'
import json, os, sys, shutil
fp, expected_tok = sys.argv[1], sys.argv[2]
try:
  d = json.load(open(fp))
except Exception as e:
  print(f"  ❌ unparseable JSON: {e}"); sys.exit(0)
e = (d.get("mcpServers") or {}).get("gapmap")
if not e:
  print("  ℹ no gapmap entry"); sys.exit(0)
cmd = e.get("command") or ""
args = e.get("args") or []
env = e.get("env") or {}

# 1. command exists?
if cmd and cmd.startswith("/"):
  if os.path.isfile(cmd) and os.access(cmd, os.X_OK):
    print(f"  ✅ command: {cmd}")
  else:
    print(f"  ❌ command not found / not executable: {cmd}")
elif cmd:
  resolved = shutil.which(cmd)
  if resolved:
    print(f"  ⚠  bare command '{cmd}' — GUI clients may not find it. Resolves in shell to: {resolved}")
  else:
    print(f"  ❌ command '{cmd}' not on PATH at all")
else:
  print("  ❌ command field missing")

# 2. uv vs direct binary
if "uv" in cmd:
  print(f"  ⚠  uses 'uv run' — adds 1-3s startup overhead per reconnect, can hit 10s client timeouts")
  print(f"     consider: command={os.path.expanduser('~/Documents/GitHub/reddit-myind/.venv/bin/gapmap')}, args=['mcp','serve']")

# 3. env block sanity
takeover = (env.get("MCP_TAKEOVER_STALE_LOCK") or "").lower() in ("1","true","yes")
if takeover: print("  ✅ MCP_TAKEOVER_STALE_LOCK=1 — survives client restarts")
else: print("  ⚠  MCP_TAKEOVER_STALE_LOCK not set — client restart will hit 'another_mcp_server_running'")

# Per-client pidfile tag — without this, all 3 clients share one lock and
# SIGTERM each other on every reconnect (root cause of "lost connection").
expected_tag = {
    "/Users/" + os.environ.get("USER","") + "/.claude.json": "claude-code",
    "/Users/" + os.environ.get("USER","") + "/.cursor/mcp.json": "cursor",
    "/Users/" + os.environ.get("USER","") + "/Library/Application Support/Claude/claude_desktop_config.json": "claude-desktop",
}.get(fp, "")
tag = (env.get("MCP_CLIENT_TAG") or "").strip().lower()
if expected_tag and tag == expected_tag:
  print(f"  ✅ MCP_CLIENT_TAG={tag} — per-client pidfile, no cross-client thrash")
elif expected_tag and not tag:
  print(f"  ❌ MCP_CLIENT_TAG missing — this client shares a pidfile with the others. Cross-client SIGTERM will disconnect mid-tool-call. Re-run: gapmap mcp install --client {expected_tag}")
elif expected_tag and tag != expected_tag:
  print(f"  ⚠  MCP_CLIENT_TAG={tag!r} but expected {expected_tag!r} — stale tag from a prior install. Re-sync.")

dd = env.get("GAPMAP_DATA_DIR") or ""
if dd: print(f"  ✅ data_dir env: {dd}")
else: print("  ⚠  GAPMAP_DATA_DIR unset — server uses fallback path, may not see your DB")

tok = env.get("GAPMAP_TOKEN") or ""
if expected_tok and tok and expected_tok.strip() != tok.strip():
  print(f"  ❌ token mismatch — config token does not match {os.path.dirname(fp)}/mcp_token")
elif tok and expected_tok:
  print("  ✅ token in env matches token file")
elif tok:
  print("  ⚠  token in env but no token file — server will reject calls until file is regenerated")
PY
done

hdr "4. Client-side MCP logs (last 8 lines each, only if present)"
for log in \
  "$HOME/Library/Logs/Claude/mcp.log" \
  "$HOME/Library/Logs/Claude/mcp-server-gapmap.log" \
  "$HOME/Library/Application Support/Cursor/logs"/*/exthost*/anysphere.cursor-fetch \
  "$HOME/.claude/logs/mcp.log"; do
  if [ -f "$log" ]; then
    echo "${B}— $log${Z}"
    tail -8 "$log" 2>/dev/null | sed 's/^/   /'
  fi
done

hdr "5. Smoke launch (verify server reaches startup:ready)"
if [ -x "$PROJECT_DIR/.venv/bin/gapmap" ]; then
  CMD="$PROJECT_DIR/.venv/bin/gapmap"
  # Use a throwaway data dir so we don't pollute the real mcp_events table
  # AND don't fight the real PID lock. Then check the temp log.
  SMOKE_DD=$(mktemp -d)
  echo "   launching: $CMD mcp serve  (data_dir=$SMOKE_DD)"
  # Background launch with /dev/null stdin — FastMCP reads stdin in run()
  # and would exit on real EOF; we just want to verify imports + startup
  # logging succeed before mcp.run() starts. Wait up to 8s for the
  # `startup:ready` event to appear in the temp log, then SIGTERM.
  ( GAPMAP_DATA_DIR="$SMOKE_DD" MCP_TAKEOVER_STALE_LOCK=1 \
    "$CMD" mcp serve < /dev/null > /tmp/mcp_smoke.out 2>&1 & echo $! > /tmp/mcp_smoke.pid )
  for i in 1 2 3 4 5 6 7 8; do
    sleep 1
    if [ -f "$SMOKE_DD/logs/mcp-server.log" ] && grep -q startup:ready "$SMOKE_DD/logs/mcp-server.log" 2>/dev/null; then
      break
    fi
  done
  SPID=$(cat /tmp/mcp_smoke.pid 2>/dev/null)
  [ -n "$SPID" ] && kill -TERM "$SPID" 2>/dev/null
  sleep 1
  if [ -f "$SMOKE_DD/logs/mcp-server.log" ] && grep -q startup:ready "$SMOKE_DD/logs/mcp-server.log"; then
    READY_MS=$(grep startup:ready "$SMOKE_DD/logs/mcp-server.log" | head -1 | python3 -c "import json,sys; r=json.loads(sys.stdin.read()); print(r.get('details',{}).get('startup_ms','?'))" 2>/dev/null)
    ok "server reached startup:ready in ${READY_MS} ms"
    if [ -f "$SMOKE_DD/logs/mcp-server.log" ]; then
      echo "   recent events:"
      tail -5 "$SMOKE_DD/logs/mcp-server.log" | python3 -c "
import json, sys
for line in sys.stdin:
  try:
    r = json.loads(line)
    print(f\"     {r['ts'][:19]}  {r['severity']:<5}  {r['kind']}\")
  except: pass
"
    fi
  else
    err "server did not reach startup:ready — likely an import error"
    head -30 /tmp/mcp_smoke.out 2>/dev/null | sed 's/^/   /'
  fi
  rm -rf "$SMOKE_DD" /tmp/mcp_smoke.out /tmp/mcp_smoke.pid
else
  warn "no $PROJECT_DIR/.venv/bin/gapmap — run 'uv sync' or 'pip install -e .' in $PROJECT_DIR"
fi

echo ""
info "Next steps if any ❌ above:"
info "  1. To rewrite all 3 client configs to use the venv binary directly (recommended):"
info "       $PROJECT_DIR/.venv/bin/gapmap mcp install --client claude-code"
info "       $PROJECT_DIR/.venv/bin/gapmap mcp install --client claude-desktop"
info "       $PROJECT_DIR/.venv/bin/gapmap mcp install --client cursor"
info "  2. Then restart the relevant client app."
