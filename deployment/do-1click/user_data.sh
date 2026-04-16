#!/usr/bin/env bash
# DigitalOcean 1-click droplet cloud-init.
# Assumes a fresh Ubuntu 24.04 droplet.
set -euxo pipefail

apt-get update
apt-get install -y curl ca-certificates gnupg git

# Docker CE
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Repo + compose up
mkdir -p /opt/openhipp0
cd /opt/openhipp0
git clone --depth=1 https://github.com/openhipp0/openhipp0.git .
cp deployment/.env.example deployment/.env

cd deployment
docker compose -f docker-compose.prod.yml up -d
