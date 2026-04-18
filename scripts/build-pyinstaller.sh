#!/usr/bin/env bash
# Build the reddit-cli single-file binary via PyInstaller.
# Output: dist/reddit-cli + dist/reddit-cli-<target-triple> (Tauri sidecar)
set -euo pipefail

cd "$(dirname "$0")/.."

TRIPLE="${TARGET_TRIPLE:-$(rustc -vV 2>/dev/null | grep host | cut -d' ' -f2 || echo 'aarch64-apple-darwin')}"
OUT_NAME="reddit-cli"

echo "→ cleaning previous build"
rm -rf build/ dist/ reddit-cli.spec

echo "→ running pyinstaller (~2 min)"
uv run pyinstaller \
  --onefile \
  --name "${OUT_NAME}" \
  --paths=src \
  --collect-all reddit_research \
  --collect-submodules praw \
  --collect-submodules prawcore \
  --collect-submodules sqlite_utils \
  --collect-submodules openai \
  --collect-submodules anthropic \
  --collect-submodules httpx \
  --hidden-import openai \
  --hidden-import anthropic \
  --add-data "prompts:prompts" \
  --log-level WARN \
  scripts/pyinstaller-entrypoint.py

if [[ ! -f "dist/${OUT_NAME}" ]]; then
  echo "× build failed: dist/${OUT_NAME} not found"
  exit 1
fi

SIZE=$(du -sh "dist/${OUT_NAME}" | cut -f1)
cp "dist/${OUT_NAME}" "dist/${OUT_NAME}-${TRIPLE}"

echo "✓ built dist/${OUT_NAME} (${SIZE})"
echo "✓ tagged: dist/${OUT_NAME}-${TRIPLE}"
echo
echo "Smoke test:"
"dist/${OUT_NAME}" info 2>&1 | head -5
echo
echo "Next: cp dist/${OUT_NAME}-${TRIPLE} <tauri-app>/src-tauri/binaries/"
