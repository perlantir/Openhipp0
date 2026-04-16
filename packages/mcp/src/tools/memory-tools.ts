/**
 * Memory-surface tools exposed over MCP.
 *
 * Each tool is a direct wrapper over @openhipp0/memory's functions. The db
 * handle comes from ServerDeps; if the caller didn't supply one, none of
 * these tools register (they all early-return in registerMemoryTools).
 *
 * Tools registered:
 *   decision_create       — insert a new decision row
 *   decision_get          — fetch a decision by id
 *   decision_list         — list decisions by project (status/limit filters)
 *   decision_update       — patch title/reasoning/confidence/tags
 *   decision_supersede    — mark one decision superseded by another
 *   decision_search_tags  — tag-overlap search
 *   memory_search         — FTS5 over session_history.full_text
 *   memory_stats          — row counts for the main tables
 *   skill_list            — list skills rows from DB (manifests on disk are skill_list_manifests)
 *   session_get_recent    — most recent N sessions for a project
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  db as memoryDb,
  decisions as memoryDecisions,
  recall as memoryRecall,
} from '@openhipp0/memory';
import type { ServerDeps } from '../types.js';

type DB = memoryDb.HipppoDb;

function textResult(
  obj: unknown,
): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

export function registerMemoryTools(server: McpServer, deps: ServerDeps): void {
  if (!deps.db) return;
  const db: DB = deps.db;
  const defaultProjectId = deps.defaultProjectId ?? 'default';

  // ── decision_create ──────────────────────────────────────────────────────
  server.registerTool(
    'decision_create',
    {
      description: 'Record a new architectural/product decision in the Hipp0 decision graph.',
      inputSchema: {
        projectId: z.string().optional(),
        title: z.string().min(1),
        reasoning: z.string().min(1),
        madeBy: z.string().min(1),
        confidence: z.enum(['high', 'medium', 'low']).default('medium'),
        affects: z.array(z.string()).default([]),
        tags: z.array(z.string()).default([]),
      },
    },
    async (input) => {
      const d = await memoryDecisions.createDecision(db, {
        projectId: input.projectId ?? defaultProjectId,
        title: input.title,
        reasoning: input.reasoning,
        madeBy: input.madeBy,
        confidence: input.confidence,
        affects: input.affects,
        tags: input.tags,
      });
      return textResult({ id: d.id, createdAt: d.createdAt });
    },
  );

  // ── decision_get ─────────────────────────────────────────────────────────
  server.registerTool(
    'decision_get',
    {
      description: 'Fetch a decision by id.',
      inputSchema: { id: z.string().min(1) },
    },
    async (input) => {
      const d = await memoryDecisions.getDecision(db, input.id);
      if (!d) {
        return { isError: true, content: [{ type: 'text', text: `not found: ${input.id}` }] };
      }
      return textResult(d);
    },
  );

  // ── decision_list ────────────────────────────────────────────────────────
  server.registerTool(
    'decision_list',
    {
      description: 'List decisions in a project. Filters on status and caps at `limit`.',
      inputSchema: {
        projectId: z.string().optional(),
        status: z.enum(['active', 'superseded', 'rejected']).optional(),
        limit: z.number().int().positive().max(200).default(50),
      },
    },
    async (input) => {
      const rows = await memoryDecisions.listByProject(db, input.projectId ?? defaultProjectId, {
        ...(input.status && { status: input.status }),
        limit: input.limit,
      });
      return textResult(rows);
    },
  );

  // ── decision_update ──────────────────────────────────────────────────────
  server.registerTool(
    'decision_update',
    {
      description: 'Patch a decision. Null/undefined fields are left as-is.',
      inputSchema: {
        id: z.string().min(1),
        title: z.string().optional(),
        reasoning: z.string().optional(),
        confidence: z.enum(['high', 'medium', 'low']).optional(),
        tags: z.array(z.string()).optional(),
        status: z.enum(['active', 'superseded', 'rejected']).optional(),
      },
    },
    async (input) => {
      const { id, ...patch } = input;
      const d = await memoryDecisions.updateDecision(db, id, patch);
      return textResult(d);
    },
  );

  // ── decision_supersede ───────────────────────────────────────────────────
  server.registerTool(
    'decision_supersede',
    {
      description: 'Mark an existing decision as superseded by a newer one. Both must exist.',
      inputSchema: {
        oldId: z.string().min(1),
        newId: z.string().min(1),
      },
    },
    async (input) => {
      await memoryDecisions.supersedeDecision(db, input.oldId, input.newId);
      return textResult({ ok: true });
    },
  );

  // ── decision_search_tags ─────────────────────────────────────────────────
  server.registerTool(
    'decision_search_tags',
    {
      description: 'Find decisions whose tags overlap the supplied set.',
      inputSchema: {
        projectId: z.string().optional(),
        tags: z.array(z.string()).min(1),
        limit: z.number().int().positive().max(200).default(50),
      },
    },
    async (input) => {
      const hits = await memoryDecisions.filterByTags(
        db,
        input.projectId ?? defaultProjectId,
        input.tags,
        { limit: input.limit },
      );
      return textResult(hits);
    },
  );

  // ── memory_search (FTS5) ─────────────────────────────────────────────────
  server.registerTool(
    'memory_search',
    {
      description:
        'FTS5 full-text search over persisted session_history.full_text. Returns ranked sessions.',
      inputSchema: {
        projectId: z.string().optional(),
        query: z.string().min(1),
        limit: z.number().int().positive().max(50).default(10),
        agentId: z.string().optional(),
        userId: z.string().optional(),
      },
    },
    async (input) => {
      const safe = memoryRecall.escapeFts5(input.query);
      const hits = memoryRecall.searchSessions(
        db,
        input.projectId ?? defaultProjectId,
        safe,
        {
          limit: input.limit,
          ...(input.agentId && { agentId: input.agentId }),
          ...(input.userId && { userId: input.userId }),
        },
      );
      return textResult(hits);
    },
  );

  // ── memory_stats ─────────────────────────────────────────────────────────
  server.registerTool(
    'memory_stats',
    {
      description: 'Row counts for the main memory tables (decisions, skills, memory_entries, sessions).',
      inputSchema: {},
    },
    async () => {
      const one = (table: string) => {
        const row = db.$client.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
        return row.n;
      };
      return textResult({
        decisions: one('decisions'),
        skills: one('skills'),
        memoryEntries: one('memory_entries'),
        sessionHistory: one('session_history'),
        userModels: one('user_models'),
      });
    },
  );

  // ── skill_list ───────────────────────────────────────────────────────────
  server.registerTool(
    'skill_list',
    {
      description: 'List DB-tracked skill rows (workspace manifests are on disk).',
      inputSchema: {
        projectId: z.string().optional(),
        limit: z.number().int().positive().max(200).default(50),
      },
    },
    async (input) => {
      const projectId = input.projectId ?? defaultProjectId;
      const rows = db.$client
        .prepare(
          'SELECT id, agent_id AS agentId, title, trigger_pattern AS triggerPattern, times_used AS timesUsed, success_rate AS successRate, version ' +
            'FROM skills WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?',
        )
        .all(projectId, input.limit);
      return textResult(rows);
    },
  );

  // ── session_get_recent ───────────────────────────────────────────────────
  server.registerTool(
    'session_get_recent',
    {
      description: 'Fetch the N most-recent session_history rows for a project.',
      inputSchema: {
        projectId: z.string().optional(),
        limit: z.number().int().positive().max(100).default(10),
      },
    },
    async (input) => {
      const projectId = input.projectId ?? defaultProjectId;
      const rows = db.$client
        .prepare(
          'SELECT id, agent_id AS agentId, user_id AS userId, summary, tool_calls_count AS toolCallsCount, tokens_used AS tokensUsed, created_at AS createdAt ' +
            'FROM session_history WHERE project_id = ? ORDER BY created_at DESC LIMIT ?',
        )
        .all(projectId, input.limit);
      return textResult(rows);
    },
  );
}
