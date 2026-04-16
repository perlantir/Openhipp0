#!/usr/bin/env bash
# Single source of truth for the turbo filter that excludes client-only
# packages from the server image build.
#
# @openhipp0/mobile — shipped via EAS to iOS + Android, never runs on the
#                     server. Requires react-native / expo toolchains.
# @openhipp0/relay  — has its own Dockerfile under packages/relay/; runs
#                     standalone on a small VPS, not alongside hipp0 serve.
#
# Anything else should live in the server image.
#
# Consumed by:
#   - Dockerfile (`RUN pnpm exec turbo run build ${SERVER_FILTER}`)
#   - .github/workflows/*.yml (CI matrix for server-only jobs)
#   - future-ops scripts

set -euo pipefail

TURBO_SERVER_FILTER=(
  "--filter=!@openhipp0/mobile"
  "--filter=!@openhipp0/relay"
)

# When sourced (common case), export the joined string for shell consumers
# and the array for callers that want to splat into argv.
export TURBO_SERVER_FILTER_STR="${TURBO_SERVER_FILTER[*]}"

# When run directly, just print the joined string so Dockerfile can
# `$(./scripts/turbo-server-filter.sh)` it.
if [[ "${BASH_SOURCE[0]:-}" == "${0}" ]]; then
  echo "${TURBO_SERVER_FILTER_STR}"
fi
