#!/usr/bin/env bash
# One-command validation pipeline for a topic.
# Usage: bash scripts/validate.sh "TOPIC" [data-dir]
#
# Runs: aggressive multi-source collect → graph build → export HTML + text findings.
# Target: ~2000-4000 posts across 8+ sources in ~10-20 min.

set -euo pipefail

TOPIC="${1:-}"
DATA_DIR="${2:-./data-validate-$(echo "${TOPIC}" | tr ' ' '-' | tr '[:upper:]' '[:lower:]')}"

if [[ -z "$TOPIC" ]]; then
  echo "usage: bash scripts/validate.sh \"your topic here\" [optional-data-dir]"
  echo ""
  echo "Example: bash scripts/validate.sh \"ATS resume tools\""
  exit 1
fi

export OPENREPLY_DATA_DIR="$(cd "$(dirname "$0")/.." && pwd)/${DATA_DIR#./}"
mkdir -p "$OPENREPLY_DATA_DIR"
OUT_HTML="${OPENREPLY_DATA_DIR}/openreply-map.html"
OUT_MD="${OPENREPLY_DATA_DIR}/findings.md"
TWEET_MD="${OPENREPLY_DATA_DIR}/tweet.md"

echo "============================================================"
echo " validating: \"$TOPIC\""
echo " data dir:   $OPENREPLY_DATA_DIR"
echo "============================================================"
echo ""

cd "$(dirname "$0")/.."

echo "→ [1/4] collecting (aggressive mode: Reddit + HN + App Store + Play Store + arXiv + OpenAlex + Scholar + gnews)"
uv run openreply research collect \
    --topic "$TOPIC" \
    --aggressive \
    --sources "hn,appstore,playstore,arxiv,openalex,scholar,gnews,github_issues,lemmy"

echo ""
echo "→ [2/4] building structural graph"
uv run openreply research graph build --topic "$TOPIC"

echo ""
echo "→ [3/4] source breakdown:"
uv run openreply query "
  SELECT coalesce(p.source_type,'reddit') source, count(*) n
  FROM posts p JOIN topic_posts tp ON tp.post_id=p.id
  WHERE tp.topic='$TOPIC' GROUP BY source ORDER BY n DESC"

echo ""
echo "→ [4/4] generating artifacts"
uv run openreply research graph export --topic "$TOPIC" --out "$OUT_HTML"
uv run openreply research findings --topic "$TOPIC" --out "$OUT_MD"
uv run openreply research findings --topic "$TOPIC" --tweet --out "$TWEET_MD"

echo ""
echo "============================================================"
echo " ✓ artifacts written:"
echo "   • $OUT_HTML"
echo "   • $OUT_MD"
echo "   • $TWEET_MD"
echo ""
echo " open the HTML:  open \"$OUT_HTML\""
echo ""
echo " NOTE: semantic enrichment (painpoints/products/workarounds)"
echo "   was NOT run — Claude-in-MCP will do that interactively, or"
echo "   set ANTHROPIC_API_KEY and run:"
echo "     uv run openreply research graph enrich --topic \"$TOPIC\" --provider anthropic"
echo "============================================================"
