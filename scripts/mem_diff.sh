#!/usr/bin/env bash
# mem_diff.sh — sample memory NOW and again after N seconds, print the diff.
# Cheaper to run than starting/stopping a long probe when you already know
# what bad workflow you're about to do.
#
#   bash scripts/mem_diff.sh 60        # 60s window
#   bash scripts/mem_diff.sh 120 leak  # 120s window, save baseline as ./leak-{before,after}.txt
#
# Output: a table of (process → before → after → delta_mb) for every openreply
# host, sidecar, ollama and node helper currently running.

set -u

DURATION="${1:-60}"
TAG="${2:-}"

snapshot() {
  local out=$1
  : > "$out"
  for name in openreply openreply uv ollama node; do
    while read -r pid cmd; do
      if [[ -z "$pid" || ! "$pid" =~ ^[0-9]+$ ]]; then continue; fi
      if [[ "$cmd" == *mem_diff.sh* || "$cmd" == *mem_probe.sh* || "$cmd" == *grep* ]]; then continue; fi
      rss_kb=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ')
      if [[ -z "$rss_kb" ]]; then continue; fi
      rss_mb=$((rss_kb / 1024))
      printf '%s\t%s\t%s\n' "$pid" "$name" "$rss_mb" >> "$out"
    done < <(pgrep -lf "$name" 2>/dev/null || true)
  done
}

before=$(mktemp)
after=$(mktemp)

echo "[mem-diff] sampling baseline…"
snapshot "$before"
echo "[mem-diff] running workflow for ${DURATION}s — go reproduce the leak now"
sleep "$DURATION"
echo "[mem-diff] sampling again…"
snapshot "$after"

if [ -n "$TAG" ]; then
  cp "$before" "./${TAG}-before.txt"
  cp "$after" "./${TAG}-after.txt"
  echo "[mem-diff] saved baselines: ./${TAG}-before.txt ./${TAG}-after.txt"
fi

# Join on PID, print delta. Processes that vanished or appeared show as N/A.
printf '\n%-8s %-12s %10s %10s %10s\n' PID NAME BEFORE_MB AFTER_MB DELTA_MB
printf '%s\n' "----------------------------------------------------------"
awk -v before="$before" -v after="$after" '
  BEGIN {
    while ((getline line < before) > 0) {
      split(line, f, "\t"); b[f[1]] = f[3]; n[f[1]] = f[2];
    }
    while ((getline line < after) > 0) {
      split(line, f, "\t"); a[f[1]] = f[3]; n[f[1]] = f[2];
    }
    for (pid in n) {
      bv = (pid in b) ? b[pid] : "—";
      av = (pid in a) ? a[pid] : "—";
      delta = (pid in b && pid in a) ? (a[pid] - b[pid]) : "—";
      printf "%-8s %-12s %10s %10s %10s\n", pid, n[pid], bv, av, delta;
    }
  }
' | sort -k5 -rn

rm -f "$before" "$after"
