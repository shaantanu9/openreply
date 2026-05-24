#!/usr/bin/env bash
# CSS consistency guard.
#
# Counts hardcoded `padding`/`margin` px values in style.css and fails if
# the count rises above CEILING. The GUI consistency migration replaces
# these with var(--space-N) tokens — so the count only ever goes DOWN.
# Lower CEILING as each screen batch lands; never raise it.
#
# Usage:  bash app-tauri/scripts/check_css_consistency.sh
# CI:     run from repo root or app-tauri/.

set -euo pipefail

# Resolve style.css relative to this script (works from any CWD).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSS="$HERE/../src/style.css"

# Baseline at the start of the migration (2026-05-18). Ratchet down only.
CEILING=1142

if [[ ! -f "$CSS" ]]; then
  echo "check_css_consistency: style.css not found at $CSS" >&2
  exit 2
fi

COUNT=$(grep -oE '(padding|margin)[a-z-]*:[^;{}]*[0-9]+px' "$CSS" | wc -l | tr -d ' ')

echo "hardcoded padding/margin px in style.css: $COUNT (ceiling: $CEILING)"

if (( COUNT > CEILING )); then
  echo "FAIL: hardcoded px count rose above the ceiling — tokenize new values" >&2
  echo "      with var(--space-N) instead of raw px." >&2
  exit 1
fi

if (( COUNT < CEILING )); then
  echo "note: count is below the ceiling — lower CEILING in this script to $COUNT to ratchet."
fi

echo "OK"
