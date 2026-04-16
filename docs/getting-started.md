# Getting Started

Open Hipp0 is a local-first autonomous AI agent platform with persistent
decision memory and self-learning. This guide gets a single-node install
up and running.

## Requirements

- Node.js 22+
- pnpm 10.33+
- Docker 24+ (optional — only needed for sandboxed shell execution)
- macOS, Linux, or WSL2

## Install (from source)

```bash
git clone https://github.com/openhipp0/openhipp0.git
cd openhipp0
pnpm install
pnpm -r build
```

## Initialize a project

```bash
node packages/cli/bin/hipp0.js init my-project --non-interactive
```

This writes `~/.hipp0/config.json`. For an interactive wizard (pick LLM
provider, bridges, database), omit `--non-interactive`.

## Start the server

```bash
node packages/cli/bin/hipp0.js serve
# → 🦛 hipp0 listening on http://0.0.0.0:3100
```

Probe the health endpoint:

```bash
curl http://localhost:3100/health
# {"status":"ok","checks":[],"uptime":1.2,"version":"0.0.0"}
```

## Next steps

- [CLI reference](./cli.md)
- [Architecture](./architecture.md)
- [Self-hosting](./self-hosting.md)
- [API reference](./api-reference.md)
- [Framework integrations](./framework-guides/) — CrewAI, LangGraph, LangChain, AutoGen, OpenAI Agents SDK

## What's where

| Package                  | What it does                                      |
| ------------------------ | ------------------------------------------------- |
| `@openhipp0/core`        | Agent runtime, LLM abstraction, tool execution    |
| `@openhipp0/memory`      | Decision graph, self-learning, user modeling      |
| `@openhipp0/bridge`      | Discord/Telegram/Slack/Web/CLI + unified gateway  |
| `@openhipp0/scheduler`   | Heartbeat cron + natural-language triggers        |
| `@openhipp0/watchdog`    | Self-healing: health, updates, circuit breakers   |
| `@openhipp0/cli`         | `hipp0` CLI (init, serve, doctor, skill, …)       |
| `@openhipp0/dashboard`   | React 19 + Tailwind v4 web dashboard              |
| `@openhipp0/mcp`         | Model Context Protocol server for Claude/Cursor/… |
| `@openhipp0/e2e`         | End-to-end test harness                           |
