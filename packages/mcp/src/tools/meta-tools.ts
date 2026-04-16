/**
 * Meta tools: server identity, health, cron, agents.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDeps } from '../types.js';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from '../types.js';

function textResult(obj: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] };
}

export function registerMetaTools(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    'server_version',
    {
      description: 'Return the MCP server name + version.',
      inputSchema: {},
    },
    async () => textResult({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }),
  );

  if (deps.health) {
    server.registerTool(
      'health_check',
      {
        description: 'Run all registered health checks and return a compact report.',
        inputSchema: { autoFix: z.boolean().default(false) },
      },
      async (input) => {
        const report = await deps.health!.run({ autoFix: input.autoFix });
        return textResult(report);
      },
    );
  }

  if (deps.scheduler) {
    server.registerTool(
      'cron_list',
      {
        description: 'List every cron task known to the scheduler.',
        inputSchema: {},
      },
      async () => {
        const tasks = deps.scheduler!.listTasks().map((t) => ({
          id: t.config.id,
          schedule: t.config.schedule,
          cronExpression: t.cronExpression,
          nextFireAt: t.nextFireAt ?? null,
          enabled: t.config.enabled !== false,
          description: t.config.description ?? null,
        }));
        return textResult(tasks);
      },
    );

    server.registerTool(
      'cron_add',
      {
        description: 'Register a new cron task. The handler only logs — use @openhipp0/scheduler directly for real handlers.',
        inputSchema: {
          id: z.string().min(1),
          schedule: z.string().min(1),
          description: z.string().optional(),
        },
      },
      async (input) => {
        deps.scheduler!.addTask(
          {
            id: input.id,
            schedule: input.schedule,
            description: input.description ?? '',
            enabled: true,
          },
          async () => {
            /* noop — real handlers are wired host-side */
          },
        );
        return textResult({ ok: true });
      },
    );

    server.registerTool(
      'cron_remove',
      {
        description: 'Remove a cron task by id.',
        inputSchema: { id: z.string().min(1) },
      },
      async (input) => {
        const removed = deps.scheduler!.removeTask(input.id);
        return textResult({ removed });
      },
    );
  }

  // agent_list: returns a single-row stub until the config-driven agent
  // registry lands. Keeping the tool present now lets clients probe for it.
  server.registerTool(
    'agent_list',
    {
      description:
        'List agents configured on the server. In the current phase this returns the MCP server identity only.',
      inputSchema: {},
    },
    async () =>
      textResult([{ id: 'mcp-server', name: 'Hipp0 MCP', role: 'tool-host' }]),
  );
}
