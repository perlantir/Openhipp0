#!/usr/bin/env bash
# scripts/build-mobile.sh
# Unified driver for Phase 19E sideload builds. No App Store submission.
#
# Examples:
#   scripts/build-mobile.sh ios            # TestFlight external-track build
#   scripts/build-mobile.sh android        # Signed APK for direct download
#   scripts/build-mobile.sh both           # Both
#   scripts/build-mobile.sh android --local # Local Gradle build (no EAS cloud)
#
# Output: the built .ipa / .apk URL (EAS) or the local path.
#
# Environment:
#   EAS_PROJECT_ID     — populates app.json's expo.extra.eas.projectId
#   APPLE_TEAM_ID      — iOS signing identity (passed to eas)
#   HIPP0_SIDELOAD_URL — where the generated install landing page points

set -euo pipefail

CMD="${1:-both}"
LOCAL=false
if [[ "${2:-}" == "--local" ]]; then LOCAL=true; fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/packages/mobile"

if ! command -v eas >/dev/null 2>&1; then
  echo "✖ EAS CLI not found. Install: npm i -g eas-cli" >&2
  exit 1
fi

run_ios() {
  echo "→ iOS build (TestFlight external-track profile)"
  if $LOCAL; then
    echo "  local iOS builds require Xcode + a Mac — skipping local mode for iOS" >&2
    exit 2
  fi
  eas build --platform ios --profile testflight-external --non-interactive
  echo "→ submit to TestFlight external track (no App Store review required after first approval)"
  eas submit --platform ios --profile testflight-external --latest --non-interactive
}

run_android() {
  echo "→ Android build (signed APK, direct-download profile)"
  if $LOCAL; then
    eas build --platform android --profile sideload --local
  else
    eas build --platform android --profile sideload --non-interactive
  fi
  echo ""
  echo "✓ APK built. Host it at \$HIPP0_SIDELOAD_URL/openhipp0-latest.apk"
  echo "  The landing page at deployment/mobile-install/ reads that filename."
}

case "$CMD" in
  ios)     run_ios ;;
  android) run_android ;;
  both)    run_android; run_ios ;;
  *)
    echo "Usage: $0 {ios|android|both} [--local]" >&2
    exit 1
    ;;
esac
