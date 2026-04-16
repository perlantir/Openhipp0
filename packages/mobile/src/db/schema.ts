// packages/mobile/src/db/schema.ts
// Local SQLite cache schema. Mirrors the subset of server data the app
// needs offline: decisions, skills, agents, cron tasks, user facts,
// outbound actions, sync cursors.
//
// Schema is applied by openDatabase() at boot; expo-sqlite's transactional
// API handles the migration. Storing the DDL as constants keeps the
// schema visible at a glance and cross-referenceable with server schemas
// in @openhipp0/memory.

export const SCHEMA_VERSION = 1;

export const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    agent_id TEXT,
    outcome TEXT CHECK (outcome IN ('positive','negative','neutral') OR outcome IS NULL),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,

  `CREATE INDEX IF NOT EXISTS idx_decisions_updated_at ON decisions(updated_at);`,

  `CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    description TEXT,
    origin TEXT,
    updated_at TEXT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    model TEXT,
    updated_at TEXT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS cron_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    next_fire_at TEXT,
    updated_at TEXT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS user_facts (
    id TEXT PRIMARY KEY,
    fact TEXT NOT NULL,
    source TEXT,
    updated_at TEXT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS outbound_queue (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );`,

  `CREATE INDEX IF NOT EXISTS idx_outbound_queue_seq ON outbound_queue(seq);`,

  `CREATE TABLE IF NOT EXISTS sync_cursors (
    kind TEXT PRIMARY KEY,
    cursor TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`,

  `CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at);`,
] as const;

export type MirroredKind = "decision" | "skill" | "agent" | "cron" | "user-fact";

export const KIND_TO_TABLE: Record<MirroredKind, string> = {
  decision: "decisions",
  skill: "skills",
  agent: "agents",
  cron: "cron_tasks",
  "user-fact": "user_facts",
};

/** Apply schema on first run. `exec` is provided by expo-sqlite. */
export async function applySchema(exec: (sql: string) => Promise<void>): Promise<void> {
  for (const stmt of CREATE_STATEMENTS) {
    await exec(stmt);
  }
  await exec(
    `INSERT INTO meta(key, value) VALUES('schema_version', '${SCHEMA_VERSION}')
     ON CONFLICT(key) DO UPDATE SET value='${SCHEMA_VERSION}';`,
  );
}
