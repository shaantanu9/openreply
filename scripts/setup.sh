#!/usr/bin/env bash
# One-command setup for openreply via uv.
# uv manages the Python toolchain, creates .venv, installs deps, and writes uv.lock.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v uv >/dev/null 2>&1; then
  echo "uv not found. Install: curl -LsSf https://astral.sh/uv/install.sh | sh"
  echo "Or: pip install uv"
  exit 1
fi

echo "→ uv sync --all-extras"
uv sync --all-extras

echo
echo "Done. Next steps:"
echo "  uv run openreply auth login      # one-time OAuth"
echo "  uv run openreply auth check      # verify"
echo "  uv run openreply fetch posts --sub python --limit 10"
echo
echo "Or activate the venv once:   source .venv/bin/activate"
