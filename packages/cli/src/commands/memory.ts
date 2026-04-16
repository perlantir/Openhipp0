/**
 * `hipp0 memory stats|search` — read-only introspection over the memory DB.
 *
 *   stats           — row counts across decisions / skills / memory / sessions
 *   search <query>  — FTS5 search over session_history (requires --project)
 *
 * The DB handle is injectable so tests can run against an in-memory SQLite
 * with migrations applied. Production callers get a handle from
 * @openhipp0/memory's createClient() and are responsible for running
 * migrations at install time (or via the Phase 8 `migrate` command).
 */

import { db as memoryDb, recall } from '@openhipp0/memory';
import { Hipp0CliError, type CommandResult } from '../types.js';

type HipppoDb = ReturnType<typeof memoryDb.createClient>;
type RecallOptions = Parameters<typeof recall.searchSessions>[3];

export interface MemoryCommandOptions {
  /** Factory returning an opened DB. Defaults to memory's createClient(). */
  dbFactory?: () => HipppoDb;
  /** Whether to close the DB handle after the command (default true). */
  closeAfter?: boolean;
}

export interface MemorySearchOptions extends MemoryCommandOptions {
  projectId: string;
  limit?: number;
  agentId?: string;
  userId?: string;
}

function defaultDbFactory(): HipppoDb {
  return memoryDb.createClient();
}

const MAIN_TABLES = [
  'projects',
  'decisions',
  'skills',
  'memory_entries',
  'session_history',
] as const;

export async function runMemoryStats(opts: MemoryCommandOptions = {}): Promise<CommandResult> {
  const db = (opts.dbFactory ?? defaultDbFactory)();
  const closeAfter = opts.closeAfter ?? true;
  try {
    const counts: Record<string, number> = {};
    for (const table of MAIN_TABLES) {
      try {
        const row = db.$client
          .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
          .get() as { n: number } | undefined;
        counts[table] = row?.n ?? 0;
      } catch {
        // Table doesn't exist (migration not run) — report -1.
        counts[table] = -1;
      }
    }
    const lines: string[] = ['Memory statistics:'];
    for (const [table, n] of Object.entries(counts)) {
      lines.push(`  ${table.padEnd(20)} ${n < 0 ? '(missing)' : n}`);
    }
    return { exitCode: 0, stdout: lines, data: { counts } };
  } finally {
    if (closeAfter) memoryDb.closeClient(db);
  }
}

export async function runMemorySearch(
  query: string,
  opts: MemorySearchOptions,
): Promise<CommandResult> {
  if (!query || !query.trim()) {
    throw new Hipp0CliError('Search query is required.', 'HIPP0_CLI_MEMORY_EMPTY_QUERY');
  }
  if (!opts.projectId) {
    throw new Hipp0CliError(
      'Memory search requires --project <id>.',
      'HIPP0_CLI_MEMORY_NO_PROJECT',
    );
  }
  const db = (opts.dbFactory ?? defaultDbFactory)();
  const closeAfter = opts.closeAfter ?? true;
  try {
    const escaped = recall.escapeFts5(query);
    const searchOpts: NonNullable<RecallOptions> = { limit: opts.limit ?? 10 };
    if (opts.agentId !== undefined) searchOpts.agentId = opts.agentId;
    if (opts.userId !== undefined) searchOpts.userId = opts.userId;
    const hits = recall.searchSessions(db, opts.projectId, escaped, searchOpts);
    const lines: string[] = [];
    if (hits.length === 0) {
      lines.push(`No session matches for "${query}".`);
    } else {
      lines.push(`Found ${hits.length} session${hits.length === 1 ? '' : 's'} for "${query}":`);
      for (const hit of hits) {
        const summary = hit.session.summary ?? '(no summary)';
        lines.push(
          `  [rank ${hit.rank.toFixed(3)}] ${hit.session.id} — ${truncate(summary, 80)}`,
        );
      }
    }
    return { exitCode: 0, stdout: lines, data: { hits, query, projectId: opts.projectId } };
  } finally {
    if (closeAfter) memoryDb.closeClient(db);
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
