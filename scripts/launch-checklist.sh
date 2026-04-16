#!/usr/bin/env bash
# Launch checklist — runs all the gates that must pass before cutting a
# release. Exits non-zero on any failure; prints a final summary.
#
# Usage: bash scripts/launch-checklist.sh
# Env:
#   SKIP_E2E=1   skip the Playwright phase-sweep (slow)
#   SKIP_DOCKER=1 skip the docker compose build

set -u
pipefail_supported=$(set -o 2>/dev/null | grep -q '^pipefail' && echo 1 || echo 0)
[ "$pipefail_supported" = "1" ] && set -o pipefail

cd "$(dirname "$0")/.."

PASS=()
FAIL=()
gate() {
  local name="$1"
  shift
  printf '\n═══ %s ═══\n' "$name"
  if "$@"; then
    PASS+=("$name")
  else
    FAIL+=("$name")
  fi
}

gate "pnpm -r build"       pnpm -r build
gate "pnpm -r typecheck"   pnpm -r typecheck
gate "pnpm -r lint"        pnpm -r lint
gate "pnpm -r test"        pnpm -r test
gate "Python SDK tests"    bash scripts/test-python.sh
if [ "${SKIP_E2E:-0}" != "1" ]; then
  gate "Playwright phase sweep" pnpm --filter @openhipp0/e2e exec playwright test
fi
if [ "${SKIP_DOCKER:-0}" != "1" ]; then
  gate "docker compose build" docker compose -f deployment/docker-compose.prod.yml build
fi
gate "pnpm audit (production)" pnpm audit --prod

printf '\n═══ Summary ═══\n'
printf 'Passed: %d\n' "${#PASS[@]}"
for g in "${PASS[@]}"; do printf '  ✓ %s\n' "$g"; done
printf 'Failed: %d\n' "${#FAIL[@]}"
for g in "${FAIL[@]}"; do printf '  ✗ %s\n' "$g"; done

[ ${#FAIL[@]} -eq 0 ]
