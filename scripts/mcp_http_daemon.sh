#!/usr/bin/env bash
# mcp_http_daemon.sh — start/stop/status for the openreply MCP server in
# HTTP transport mode. Cursor's stdio MCP client cycles servers every ~5 min,
# which kills any in-flight long tool call. HTTP transport sidesteps this:
# Cursor reconnects without ever signalling the server.
#
# Usage:
#   bash scripts/mcp_http_daemon.sh start    # launch in background
#   bash scripts/mcp_http_daemon.sh stop     # SIGTERM the daemon
#   bash scripts/mcp_http_daemon.sh restart
#   bash scripts/mcp_http_daemon.sh status
#   bash scripts/mcp_http_daemon.sh logs     # tail the stderr log
#
# Endpoint after start: http://127.0.0.1:8765/mcp

set -u

PROJECT_DIR="${OPENREPLY_PROJECT_DIR:-$HOME/Documents/GitHub/reddit-myind}"
DATA_DIR="${OPENREPLY_DATA_DIR:-$HOME/Library/Application Support/com.shantanu.openreply/openreply}"
PORT="${OPENREPLY_HTTP_PORT:-8765}"
HOST="${OPENREPLY_HTTP_HOST:-127.0.0.1}"
BIN="$PROJECT_DIR/.venv/bin/openreply"
LOG_DIR="$DATA_DIR/logs"
LOG_FILE="$LOG_DIR/mcp-http.stderr.log"
PID_FILE="$DATA_DIR/mcp-http.pid"
TOKEN_FILE="$DATA_DIR/mcp_token"

mkdir -p "$LOG_DIR" "$DATA_DIR"

is_alive() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null
}

cmd_start() {
  if is_alive; then
    echo "already running, pid=$(cat "$PID_FILE")"
    return 0
  fi
  if [ ! -x "$BIN" ]; then
    echo "ERROR: $BIN not found or not executable" >&2
    exit 1
  fi
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "ERROR: port $PORT already in use by another process" >&2
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
    exit 1
  fi
  TOKEN=""
  [ -f "$TOKEN_FILE" ] && TOKEN=$(cat "$TOKEN_FILE")
  # Export env (instead of inlining before nohup) so $! captures the actual
  # nohup-detached child reliably across bash + zsh.
  export OPENREPLY_DATA_DIR="$DATA_DIR"
  export OPENREPLY_TOKEN="$TOKEN"
  export OPENREPLY_PALACE_EAGER=1
  export MCP_TAKEOVER_STALE_LOCK=1
  export MCP_CLIENT_TAG=http-daemon
  export OPENREPLY_NO_IDLE_GUARD=1
  nohup "$BIN" mcp serve --transport http --host "$HOST" --port "$PORT" \
    >>"$LOG_FILE" 2>&1 &
  PID=$!
  disown "$PID" 2>/dev/null || true
  # Wait up to 8s for the listener to come up (uvicorn boot + palace init).
  ALIVE=""
  for i in 1 2 3 4 5 6 7 8; do
    sleep 1
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      ALIVE=1
      break
    fi
    if ! kill -0 "$PID" 2>/dev/null; then
      break  # process died early
    fi
  done
  # Resolve the actual listener PID — under some shells, $! captures a
  # transient parent and the real server runs as a child.
  REAL_PID=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
  REAL_PID="${REAL_PID:-$PID}"
  if [ -n "$ALIVE" ] && kill -0 "$REAL_PID" 2>/dev/null; then
    echo "$REAL_PID" > "$PID_FILE"
    echo "started, pid=$REAL_PID, http://$HOST:$PORT/mcp"
  else
    echo "FAILED to start. Last 20 lines of log:" >&2
    tail -20 "$LOG_FILE" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
}

cmd_stop() {
  if ! is_alive; then
    echo "not running"
    rm -f "$PID_FILE"
    return 0
  fi
  PID=$(cat "$PID_FILE")
  kill "$PID" 2>/dev/null
  for _ in 1 2 3 4 5; do
    sleep 1
    if ! kill -0 "$PID" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "stopped, pid=$PID"
      return 0
    fi
  done
  echo "still alive after 5s, sending SIGKILL" >&2
  kill -9 "$PID" 2>/dev/null
  rm -f "$PID_FILE"
}

cmd_status() {
  if is_alive; then
    PID=$(cat "$PID_FILE")
    INFO=$(ps -p "$PID" -o etime=,rss=,command= 2>/dev/null | tr -s ' ')
    echo "running pid=$PID${INFO:+ ·$INFO}"
    echo "endpoint: http://$HOST:$PORT/mcp"
  else
    echo "not running"
    rm -f "$PID_FILE" 2>/dev/null
  fi
}

cmd_logs() {
  if [ -f "$LOG_FILE" ]; then
    tail -F "$LOG_FILE"
  else
    echo "no log yet at $LOG_FILE"
  fi
}

case "${1:-status}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_stop; cmd_start ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  *)       echo "usage: $0 {start|stop|restart|status|logs}"; exit 2 ;;
esac
