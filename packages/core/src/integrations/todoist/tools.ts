/**
 * Todoist — REST v2. Personal API key via HIPP0_TODOIST_TOKEN (or config).
 *
 *   todoist_list_tasks   → GET /rest/v2/tasks
 *   todoist_add_task     → POST /rest/v2/tasks
 */

import { z } from 'zod';
import type { Tool } from '../../tools/types.js';
import { fetchWithRetry } from '../http.js';
import { httpErr, missingKey, runSafely } from '../_helpers.js';

const BASE = 'https://api.todoist.com/rest/v2';

export interface TodoistConfig {
  apiKey?: string;
  fetch?: typeof fetch;
}

function auth(cfg: TodoistConfig): { token: string; fetch: typeof fetch } | null {
  const token = cfg.apiKey ?? process.env['HIPP0_TODOIST_TOKEN'];
  if (!token) return null;
  return { token, fetch: cfg.fetch ?? fetch };
}

export function createTodoistListTasksTool(cfg: TodoistConfig = {}): Tool<{ projectId?: string; filter?: string }> {
  return {
    name: 'todoist_list_tasks',
    description: 'List open Todoist tasks, optionally filtered by project or a natural-language filter.',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        filter: { type: 'string', description: 'e.g. "today", "overdue"' },
      },
    },
    validator: z.object({ projectId: z.string().optional(), filter: z.string().optional() }),
    async execute(input) {
      const a = auth(cfg);
      if (!a) return missingKey('todoist', 'HIPP0_TODOIST_TOKEN');
      const url = new URL(`${BASE}/tasks`);
      if (input.projectId) url.searchParams.set('project_id', input.projectId);
      if (input.filter) url.searchParams.set('filter', input.filter);
      return runSafely('todoist', async () => {
        const resp = await fetchWithRetry(() =>
          a.fetch(url.toString(), { headers: { authorization: `Bearer ${a.token}` } }),
        );
        if (!resp.ok) throw new Error(`${resp.status}`);
        return await resp.text();
      });
    },
  };
}

export function createTodoistAddTaskTool(
  cfg: TodoistConfig = {},
): Tool<{ content: string; projectId?: string; dueString?: string; priority?: number }> {
  return {
    name: 'todoist_add_task',
    description: 'Create a new Todoist task. Natural-language due date accepted via dueString.',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string' },
        projectId: { type: 'string' },
        dueString: { type: 'string' },
        priority: { type: 'integer', minimum: 1, maximum: 4 },
      },
    },
    validator: z.object({
      content: z.string().min(1),
      projectId: z.string().optional(),
      dueString: z.string().optional(),
      priority: z.number().int().min(1).max(4).optional(),
    }),
    async execute(input) {
      const a = auth(cfg);
      if (!a) return missingKey('todoist', 'HIPP0_TODOIST_TOKEN');
      const body: Record<string, unknown> = { content: input.content };
      if (input.projectId) body['project_id'] = input.projectId;
      if (input.dueString) body['due_string'] = input.dueString;
      if (input.priority) body['priority'] = input.priority;
      try {
        const resp = await fetchWithRetry(() =>
          a.fetch(`${BASE}/tasks`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${a.token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(body),
          }),
        );
        if (!resp.ok) return httpErr('todoist', resp, await resp.text().catch(() => ''));
        return { ok: true, output: await resp.text() };
      } catch (err) {
        return { ok: false, output: err instanceof Error ? err.message : String(err), errorCode: 'HIPP0_TODOIST_ERR' };
      }
    },
  };
}
