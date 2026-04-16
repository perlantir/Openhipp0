# Self-Hosting

This guide covers running Open Hipp0 on your own hardware or cloud.
`deployment/` holds the ready-made configs.

## Option 1 — Docker Compose (recommended)

```bash
cd deployment
cp .env.example .env       # fill in POSTGRES_PASSWORD, ANTHROPIC_API_KEY, ...
docker compose -f docker-compose.prod.yml up -d
curl http://localhost:3100/health
```

Two containers:
- `postgres` — Postgres 17 + pgvector
- `hipp0` — the Open Hipp0 runtime

Data persists in two named volumes: `hipp0_pg` and `hipp0_home`.

## Option 2 — Bare metal with systemd

```bash
git clone https://github.com/openhipp0/openhipp0.git /opt/openhipp0
cd /opt/openhipp0
pnpm install --frozen-lockfile --prod
pnpm -r build

# Example systemd unit — adjust paths:
cat <<EOF | sudo tee /etc/systemd/system/hipp0.service
[Unit]
Description=Open Hipp0
After=network.target

[Service]
Type=simple
User=hipp0
WorkingDirectory=/opt/openhipp0
ExecStart=/usr/bin/node /opt/openhipp0/packages/cli/bin/hipp0.js serve
Environment=NODE_ENV=production
Environment=HIPP0_PORT=3100
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now hipp0
```

## Option 3 — DigitalOcean (1-click)

Use `deployment/do-1click/user_data.sh` as the cloud-init script when
creating a droplet. Everything is installed and running on first boot.

## Option 4 — Railway

Push the repo to Railway; `deployment/railway/railway.toml` configures the
Dockerfile builder and healthcheck. Attach the Postgres plugin so
`DATABASE_URL` is injected into the hipp0 service.

## Sizing

| Load                | CPU | RAM | Disk   |
| ------------------- | --- | --- | ------ |
| Single agent, dev   | 1   | 2GB | 5GB    |
| Small team (5–20)   | 2   | 4GB | 20GB   |
| Hundreds of agents  | 4+  | 8GB+ | 50GB+ |

Browser automation (Phase 9) raises the RAM floor — Chrome/Playwright wants
2GB+ per concurrent browser.

## Backups

Database:
```bash
docker compose exec postgres pg_dump -U hipp0 hipp0 > hipp0-$(date +%F).sql
# Or for SQLite installs:
cp ~/.hipp0/hipp0.db ~/.hipp0/hipp0-$(date +%F).db
```

Config + secrets: `~/.hipp0/` is a regular directory — snapshot the volume.

## Upgrading

```bash
cd /opt/openhipp0
git pull
pnpm install --frozen-lockfile --prod
pnpm -r build
sudo systemctl restart hipp0
```

Or with Docker: `docker compose pull && docker compose up -d`.

The watchdog's safe-update flow (`hipp0 update`, Phase 4c) automates this
with backup + rollback (placeholder in Phase 8; full functionality coming).
