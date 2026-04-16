# syntax=docker/dockerfile:1.7
# Multi-stage build for Open Hipp0.
#
# Stage 1 (builder): installs deps, compiles all TS packages via turbo build.
# Stage 2 (runtime): copies only the compiled output + production deps.
# Stage 3 (final):   slim image running `hipp0 serve` on :3100.

# ── Builder ────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Copy workspace manifest + lockfile first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages

# pnpm uses the lockfile to install workspace deps deterministically.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

RUN pnpm -r build


# ── Runtime deps only ──────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages

# Production-only install — skips devDependencies across the workspace.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod


# ── Final image ────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS final

LABEL org.opencontainers.image.title="Open Hipp0" \
      org.opencontainers.image.description="Local-first autonomous AI agent platform" \
      org.opencontainers.image.source="https://github.com/openhipp0/openhipp0" \
      org.opencontainers.image.licenses="Apache-2.0"

ENV NODE_ENV=production \
    HIPP0_PORT=3100 \
    HIPP0_HOST=0.0.0.0

RUN groupadd --system hipp0 && \
    useradd --system --gid hipp0 --create-home --home-dir /home/hipp0 hipp0

WORKDIR /app

# Copy production node_modules + compiled dist/ for every workspace package.
COPY --from=deps --chown=hipp0:hipp0 /app/node_modules ./node_modules
COPY --from=builder --chown=hipp0:hipp0 /app/packages ./packages

USER hipp0

EXPOSE 3100
VOLUME ["/home/hipp0/.hipp0"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3100/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# `hipp0 serve` starts the HTTP health+API server on HIPP0_PORT.
CMD ["node", "/app/packages/cli/bin/hipp0.js", "serve"]
