#!/usr/bin/env bash
# Run the Python SDK test suite. Not part of `pnpm test` since it requires
# a Python venv with the dev-extras installed; use this script from CI or
# locally when working on python-sdk/.
#
# Usage:
#   scripts/test-python.sh                # run every package's tests
#   scripts/test-python.sh openhipp0-sdk  # one package only
#
# Env:
#   HIPP0_PY_VENV   path to the venv (default: /tmp/hipp0-venv)

set -euo pipefail

HIPP0_PY_VENV="${HIPP0_PY_VENV:-/tmp/hipp0-venv}"
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PYSDK="$REPO_ROOT/python-sdk"

if [ ! -d "$HIPP0_PY_VENV" ]; then
  python3 -m venv "$HIPP0_PY_VENV"
  for pkg in openhipp0-sdk openhipp0-crewai openhipp0-langgraph openhipp0-langchain openhipp0-autogen openhipp0-openai-agents; do
    "$HIPP0_PY_VENV/bin/pip" install -q -e "$PYSDK/$pkg[dev]"
  done
fi

PKGS=("$@")
if [ ${#PKGS[@]} -eq 0 ]; then
  PKGS=(openhipp0-sdk openhipp0-crewai openhipp0-langgraph openhipp0-langchain openhipp0-autogen openhipp0-openai-agents)
fi

TOTAL=0
for pkg in "${PKGS[@]}"; do
  # Clean stale caches so pytest doesn't collide across packages.
  rm -rf "$PYSDK/$pkg/tests/__pycache__" || true
  out=$("$HIPP0_PY_VENV/bin/pytest" -q --rootdir "$PYSDK/$pkg" "$PYSDK/$pkg/tests" 2>&1 | tail -3)
  echo "  $pkg:"
  echo "$out" | sed 's/^/    /'
  count=$(echo "$out" | grep -oE '[0-9]+ passed' | head -1 | awk '{print $1}' || echo 0)
  TOTAL=$((TOTAL + ${count:-0}))
done
echo "=== Python SDK total: $TOTAL tests passed ==="
