#!/usr/bin/env bash
# One-command setup for reddit-myind.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -d .venv ]]; then
  echo "→ creating .venv"
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

echo "→ upgrading pip"
pip install -q --upgrade pip

echo "→ installing reddit-myind[all]"
pip install -e ".[all]"

echo
echo "Done. Next steps:"
echo "  source .venv/bin/activate"
echo "  reddit-cli auth login          # one-time OAuth"
echo "  reddit-cli auth check          # verify"
echo "  reddit-cli fetch posts --sub python --limit 10"
