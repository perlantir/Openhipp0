#!/bin/bash
# Open Hipp0 — one-line installer
# Usage:
#   curl -fsSL https://get.openhipp0.com/install | bash
#   curl -fsSL https://get.openhipp0.com/install | SKIP_ONBOARD=1 bash
#   curl -fsSL https://get.openhipp0.com/install | SKIP_ONBOARD=1 INSTALL_DAEMON=1 bash
#
# Environment variables:
#   HIPP0_VERSION       Override package version (default: latest)
#   SKIP_ONBOARD        If set, skip the interactive wizard
#   INSTALL_DAEMON      If set, also install a systemd / launchd service
#   ANTHROPIC_API_KEY   Pre-seed config for unattended installs
#   OPENAI_API_KEY      Pre-seed config for unattended installs
#   HIPP0_HOME          Override ~/.hipp0 location
#   HIPP0_DEFAULT_MODEL Pre-seed the default model
#   HTTP_PROXY / HTTPS_PROXY    Respected automatically
set -euo pipefail

HIPP0_VERSION="${HIPP0_VERSION:-latest}"
SKIP_ONBOARD="${SKIP_ONBOARD:-}"
INSTALL_DAEMON="${INSTALL_DAEMON:-}"
NONINTERACTIVE="${NONINTERACTIVE:-}"
if [[ ! -t 0 ]]; then
  # stdin is not a terminal → running under `curl | bash`, no prompts possible.
  NONINTERACTIVE=1
  SKIP_ONBOARD="${SKIP_ONBOARD:-1}"
fi

# Color helpers degrade gracefully.
if [[ -t 1 ]] && command -v tput >/dev/null 2>&1; then
  BOLD="$(tput bold || true)"
  GREEN="$(tput setaf 2 || true)"
  YELLOW="$(tput setaf 3 || true)"
  RED="$(tput setaf 1 || true)"
  DIM="$(tput dim || true)"
  RESET="$(tput sgr0 || true)"
else
  BOLD="" GREEN="" YELLOW="" RED="" DIM="" RESET=""
fi

info() { printf '%s➜%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
die()  { printf '%s✗%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

header() {
  printf '\n'
  printf '%s  🦛 Open Hipp0 installer%s\n' "$BOLD" "$RESET"
  printf '%s  --------------------%s\n' "$DIM" "$RESET"
}

# ── 1. DETECT PLATFORM ─────────────────────────────────────────────────────

detect_platform() {
  UNAME="$(uname -s)"
  case "$UNAME" in
    Linux*)
      if [[ -n "${TERMUX_VERSION:-}" ]]; then PLATFORM="termux"
      elif grep -qi microsoft /proc/version 2>/dev/null; then PLATFORM="wsl"
      else PLATFORM="linux"; fi
      ;;
    Darwin*) PLATFORM="macos" ;;
    *) die "Unsupported platform: $UNAME (supported: Linux, macOS, WSL2, Termux)" ;;
  esac
  ARCH="$(uname -m)"
  info "platform: $PLATFORM ($ARCH)"
}

# ── 2. CHECK / INSTALL PREREQS ─────────────────────────────────────────────

need_cmd() { command -v "$1" >/dev/null 2>&1; }

ensure_curl_git() {
  if ! need_cmd curl || ! need_cmd git; then
    info "installing curl + git"
    case "$PLATFORM" in
      linux|wsl)
        if need_cmd apt-get; then sudo apt-get update -qq && sudo apt-get install -y -qq curl git
        elif need_cmd dnf; then sudo dnf install -y -q curl git
        elif need_cmd pacman; then sudo pacman -Sy --noconfirm curl git
        elif need_cmd apk; then sudo apk add --quiet curl git
        else die "couldn't find apt/dnf/pacman/apk; please install curl + git manually"; fi
        ;;
      macos)
        need_cmd brew || die "Homebrew required on macOS. See https://brew.sh"
        brew install curl git
        ;;
      termux) pkg install -y curl git ;;
    esac
  fi
}

ensure_node() {
  if need_cmd node; then
    NODE_VER="$(node --version | sed 's/v//' | cut -d. -f1)"
    if [[ "$NODE_VER" -ge 22 ]]; then
      info "node $(node --version) ✓"
      return
    fi
    warn "node $(node --version) found but we need ≥ 22"
  fi
  info "installing Node.js 22 via nvm"
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  fi
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"
  nvm install 22 >/dev/null
  nvm use 22 >/dev/null
}

ensure_pnpm() {
  if need_cmd pnpm; then info "pnpm $(pnpm --version) ✓"; return; fi
  info "installing pnpm via corepack"
  corepack enable 2>/dev/null || npm install -g pnpm@10.33.0
}

# ── 3. INSTALL @openhipp0/cli ──────────────────────────────────────────────

install_cli() {
  info "installing @openhipp0/cli@$HIPP0_VERSION"
  npm install -g "@openhipp0/cli@$HIPP0_VERSION"
  if ! need_cmd hipp0; then
    die "hipp0 CLI not on PATH after install; check npm global prefix."
  fi
  info "hipp0 $(hipp0 --version) installed"
}

# ── 4. AUTO-DETECT EXISTING AGENTS ────────────────────────────────────────

detect_prior_agents() {
  detected=()
  for d in "$HOME/.openclaw" "$HOME/.clawdbot" "$HOME/.moltbot"; do
    [[ -d "$d" ]] && detected+=("OpenClaw:$d")
  done
  [[ -d "$HOME/.hermes" ]] && detected+=("Hermes:$HOME/.hermes")

  if [[ "${#detected[@]}" -gt 0 ]]; then
    info "existing agent data detected:"
    for item in "${detected[@]}"; do
      printf "    %s\n" "$item"
    done
    if [[ -z "$SKIP_ONBOARD" ]]; then
      printf "  → run %s%shipp0 migrate openclaw%s or %s%shipp0 migrate hermes%s to import.\n" \
        "$BOLD" "$GREEN" "$RESET" "$BOLD" "$GREEN" "$RESET"
    fi
  fi
}

# ── 5. LAUNCH WIZARD ──────────────────────────────────────────────────────

maybe_wizard() {
  if [[ -n "$SKIP_ONBOARD" ]]; then
    info "SKIP_ONBOARD set — skipping wizard"
    hipp0 init --non-interactive --force || warn "non-interactive init hit a warning; re-run 'hipp0 init' when ready"
    return
  fi
  info "launching onboarding wizard"
  hipp0 init
}

# ── 6. OPTIONAL DAEMON ────────────────────────────────────────────────────

maybe_install_daemon() {
  [[ -z "$INSTALL_DAEMON" ]] && return
  info "installing background service"
  case "$PLATFORM" in
    linux|wsl)
      if ! need_cmd systemctl; then warn "systemd not found — skipping daemon"; return; fi
      write_systemd_unit
      sudo systemctl daemon-reload
      sudo systemctl enable hipp0.service
      sudo systemctl start hipp0.service
      info "systemd unit enabled (hipp0.service)"
      ;;
    macos)
      write_launchd_plist
      launchctl load -w "$HOME/Library/LaunchAgents/com.openhipp0.hipp0.plist"
      info "launchd agent loaded"
      ;;
    *)
      warn "daemon install not supported on $PLATFORM"
      ;;
  esac
}

write_systemd_unit() {
  sudo tee /etc/systemd/system/hipp0.service >/dev/null <<UNIT
[Unit]
Description=Open Hipp0 agent daemon
After=network.target

[Service]
Type=simple
User=$USER
Environment=HIPP0_HOME=${HIPP0_HOME:-$HOME/.hipp0}
ExecStart=$(command -v hipp0) serve --host 0.0.0.0 --port 3100
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=default.target
UNIT
}

write_launchd_plist() {
  mkdir -p "$HOME/Library/LaunchAgents"
  cat >"$HOME/Library/LaunchAgents/com.openhipp0.hipp0.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.openhipp0.hipp0</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(command -v hipp0)</string><string>serve</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/hipp0.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/hipp0.err.log</string>
</dict>
</plist>
PLIST
}

# ── 7. PRINT SUCCESS ──────────────────────────────────────────────────────

finish() {
  cat <<BANNER

${BOLD}🦛 Open Hipp0 installed successfully${RESET}
   Version:   $(hipp0 --version 2>/dev/null || echo "(run hipp0 --version)")
   Config:    ${HIPP0_HOME:-$HOME/.hipp0}
   Dashboard: http://localhost:3200

   ${GREEN}Quick start${RESET}
     hipp0                           # chat in terminal
     hipp0 serve                     # production HTTP server on :3100
     hipp0 doctor                    # installation health check
     hipp0 migrate openclaw          # import OpenClaw data
     hipp0 migrate hermes            # import Hermes Agent data
BANNER
}

# ── MAIN ──────────────────────────────────────────────────────────────────

header
detect_platform
ensure_curl_git
ensure_node
ensure_pnpm
install_cli
detect_prior_agents
maybe_wizard
maybe_install_daemon
finish
