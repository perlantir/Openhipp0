# Deployment

## Docker Compose (production)

```bash
cd deployment
cp .env.example .env          # fill in POSTGRES_PASSWORD + API keys
docker compose -f docker-compose.prod.yml up -d
curl http://localhost:3100/health
```

Services:
- `postgres` — Postgres 17 + pgvector extension, persisted in the `hipp0_pg` volume.
- `hipp0`    — The Open Hipp0 runtime, HTTP on `:3100`. Config persists in `hipp0_home`.

## DigitalOcean 1-click

`do-1click/user_data.sh` is a cloud-init script a DO Droplet can run at first
boot. It installs Docker, clones the repo, and brings the compose stack up.

Use it as the **User Data** field when creating a Droplet (Ubuntu 24.04):

```bash
# On the local machine:
doctl compute droplet create hipp0 \
  --size s-2vcpu-4gb \
  --region nyc3 \
  --image ubuntu-24-04-x64 \
  --user-data-file deployment/do-1click/user_data.sh
```

## Railway

Push the repo to Railway; the platform auto-detects `Dockerfile` and
`deployment/railway/railway.toml`. Attach the Postgres plugin so Railway
wires `DATABASE_URL` to the hipp0 service.

## Bare metal / systemd

```bash
pnpm install --frozen-lockfile --prod
pnpm -r build
node packages/cli/bin/hipp0.js serve
```

A `systemd` unit template lives alongside this doc (add one later when a
distro-specific path stabilizes).

## GitHub Actions

- `.github/workflows/ci.yml`     — runs on every push: build → test → lint → typecheck.
- `.github/workflows/release.yml` — on a `v*` tag: builds + pushes the Docker image to GHCR.
