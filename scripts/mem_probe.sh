#!/usr/bin/env bash
# mem_probe.sh — sample RSS of every gap-map process every N seconds and print
# a CSV row per tick. Run while reproducing the leak; pipe to a file and graph.
#
#   bash scripts/mem_probe.sh                  # 5s tick, runs forever, csv to stdout
#   bash scripts/mem_probe.sh 2 60             # 2s tick, 60 ticks (~2 min)
#   bash scripts/mem_probe.sh 5 0 leak.csv     # 5s tick, forever, write to leak.csv
#
# Output columns: ts,name,pid,rss_mb
# Names sampled: gapmap (Tauri host), gapmap (Python sidecar), uv,
#                ollama (LLM), node (vite if running).
#
# Tip: open the app, run `await window.__gapmapMemStats()` in DevTools to also
# see the JS heap + Rust slot counts that this shell probe can't reach.

# Intentionally NOT `set -e` — this is a tolerant probe. Some pgrep matches
# return non-numeric tokens or processes that exit between pgrep + ps; we want
# to skip those, not abort the whole sampling loop. `set -u` for typo safety
# but keep pipefail off (pgrep returning no matches is fine, not an error).
set -u

INTERVAL="${1:-5}"
TICKS="${2:-0}"   # 0 = forever
OUTFILE="${3:-/dev/stdout}"

declare -a NAMES=("gapmap" "gapmap" "uv" "ollama" "node")

echo "ts,name,pid,rss_mb" > "$OUTFILE"

i=0
while :; do
  ts=$(date +%s)
  for name in "${NAMES[@]}"; do
    # `pgrep -lf` returns "PID name" lines; some matches are noisy (the script
    # itself, terminal helpers). Filter to just our targets.
    while read -r pid cmd; do
      # First token must be a number — pgrep -lf gives "PID command…", but
      # multi-word commands sometimes get parsed across iterations on
      # different shell versions; skip non-numeric pids defensively.
      if [[ -z "$pid" || ! "$pid" =~ ^[0-9]+$ ]]; then continue; fi
      # Skip self / pgrep itself / shell scripts named after the target.
      if [[ "$cmd" == *mem_probe.sh* ]]; then continue; fi
      if [[ "$cmd" == *grep* ]]; then continue; fi
      rss_kb=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ')
      if [[ -z "$rss_kb" ]]; then continue; fi
      rss_mb=$((rss_kb / 1024))
      printf '%s,%s,%s,%s\n' "$ts" "$name" "$pid" "$rss_mb" >> "$OUTFILE"
    done < <(pgrep -lf "$name" 2>/dev/null || true)
  done
  i=$((i + 1))
  if [ "$TICKS" != "0" ] && [ "$i" -ge "$TICKS" ]; then break; fi
  sleep "$INTERVAL"
done
