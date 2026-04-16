# Open Hipp0 Relay — tiny stateless WebSocket router.
# Bring-your-own-VPS. The project publishes no public relay.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/relay ./packages/relay
RUN corepack enable && pnpm install --filter @openhipp0/relay... --frozen-lockfile \
    && pnpm --filter @openhipp0/relay build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Non-root — security-first per CLAUDE.md
RUN addgroup -S relay && adduser -S relay -G relay
COPY --from=build --chown=relay:relay /app/packages/relay/dist ./dist
COPY --from=build --chown=relay:relay /app/packages/relay/bin ./bin
COPY --from=build --chown=relay:relay /app/packages/relay/package.json ./
COPY --from=build --chown=relay:relay /app/node_modules ./node_modules
USER relay
EXPOSE 3101
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('net').connect(3101,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
CMD ["node", "bin/relay.js"]
