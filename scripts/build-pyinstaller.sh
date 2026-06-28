#!/usr/bin/env bash
# Build the openreply-cli single-file binary via PyInstaller (the Tauri sidecar).
# Output: dist/openreply-cli + dist/openreply-cli-<target-triple>
# (User-facing CLI name remains `openreply` when installed via pip/uv.)
set -euo pipefail

cd "$(dirname "$0")/.."

TRIPLE="${TARGET_TRIPLE:-$(rustc -vV 2>/dev/null | grep host | cut -d' ' -f2 || echo 'aarch64-apple-darwin')}"
OUT_NAME="openreply-cli"

echo "→ cleaning build/dist (keeping the .spec file — it's the source of truth)"
rm -rf build/ dist/

echo "→ running pyinstaller via openreply-cli.spec (~2 min)"
# Use the .spec file so build-pyinstaller, publish-mac, and CI all share one
# canonical configuration (collect_all list, hidden imports, lazy-dep deps).
# DO NOT pass `--name` / `--paths` flags here — they conflict with the spec.
uv run pyinstaller --log-level WARN openreply-cli.spec

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
