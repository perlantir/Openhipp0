/**
 * SQLite schema for @openhipp0/memory.
 *
 * 13 tables across 5 domains:
 *   - Hipp0 decision graph    : projects, decisions, decisionEdges, outcomes
 *   - Hermes self-learning    : skills, skillImprovements, memoryEntries, sessionHistory
 *   - User modeling           : userModels
 *   - Agent profiles          : agentSkillsProfile
 *   - Reliability + audit     : healthEvents, auditLog, llmUsage
 *
 * Conventions:
 *   - UUID v4 primary keys (text). `crypto.randomUUID()` at insert time.
 *   - Timestamps are ISO 8601 strings in UTC.
 *   - JSON columns store JSON strings; Drizzle's `mode: 'json'` handles parse/stringify.
 *   - Embeddings are JSON-encoded Float32 arrays (SQLite has no vector type).
 *     When DATABASE_URL points at Postgres + pgvector, a mirror schema uses vector(1536);
 *     that mirror is deferred to Phase 2.x.
 *
 * FTS5 on sessionHistory.full_text is declared via raw SQL in migrations,
 * not via Drizzle (Drizzle doesn't model virtual tables).
 */

import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

// ─────────────────────────────────────────────────────────────────────────────
// Column helpers
// ─────────────────────────────────────────────────────────────────────────────

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString());

const updatedAt = () =>
  text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString())
    .$onUpdateFn(() => new Date().toISOString());

// ─────────────────────────────────────────────────────────────────────────────
// Hipp0 — Decision Graph
// ─────────────────────────────────────────────────────────────────────────────

export const projects = sqliteTable('projects', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export const decisions = sqliteTable(
  'decisions',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    reasoning: text('reasoning').notNull(),
    madeBy: text('made_by').notNull(), // agent id or user id
    affects: text('affects', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    confidence: text('confidence', { enum: ['high', 'medium', 'low'] }).notNull(),
    tags: text('tags', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    // Embedding: JSON-encoded Float32[] of length 1536 (OpenAI text-embedding-3-small default).
    // Nullable because embeddings are generated asynchronously after insert.
    embedding: text('embedding'),
    supersededBy: text('superseded_by'),
    status: text('status', { enum: ['active', 'superseded', 'rejected'] })
      .notNull()
      .default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    projectIdx: index('decisions_project_idx').on(t.projectId),
    statusIdx: index('decisions_status_idx').on(t.status),
    madeByIdx: index('decisions_made_by_idx').on(t.madeBy),
  }),
);

export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;

export const decisionEdges = sqliteTable(
  'decision_edges',
  {
    id: id(),
    sourceId: text('source_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    targetId: text('target_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    relationship: text('relationship', {
      enum: ['supports', 'contradicts', 'extends', 'supersedes', 'related'],
    }).notNull(),
    weight: real('weight').notNull().default(1.0),
    createdAt: createdAt(),
  },
  (t) => ({
    sourceIdx: index('decision_edges_source_idx').on(t.sourceId),
    targetIdx: index('decision_edges_target_idx').on(t.targetId),
  }),
);

export type DecisionEdge = typeof decisionEdges.$inferSelect;
export type NewDecisionEdge = typeof decisionEdges.$inferInsert;

export const outcomes = sqliteTable(
  'outcomes',
  {
    id: id(),
    decisionId: text('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    result: text('result', { enum: ['validated', 'refuted', 'inconclusive'] }).notNull(),
    evidence: text('evidence').notNull(),
    recordedBy: text('recorded_by').notNull(),
    recordedAt: text('recorded_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => ({
    decisionIdx: index('outcomes_decision_idx').on(t.decisionId),
  }),
);

export type Outcome = typeof outcomes.$inferSelect;
export type NewOutcome = typeof outcomes.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Hermes — Self-Learning
// ─────────────────────────────────────────────────────────────────────────────

export const skills = sqliteTable(
  'skills',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    title: text('title').notNull(),
    contentMd: text('content_md').notNull(), // agentskills.io format
    triggerPattern: text('trigger_pattern'), // regex or literal
    timesUsed: integer('times_used').notNull().default(0),
    timesImproved: integer('times_improved').notNull().default(0),
    successRate: real('success_rate').notNull().default(0),
    autoGenerated: integer('auto_generated', { mode: 'boolean' }).notNull().default(false),
    version: integer('version').notNull().default(1),
    parentVersionId: text('parent_version_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    projectAgentIdx: index('skills_project_agent_idx').on(t.projectId, t.agentId),
    parentIdx: index('skills_parent_idx').on(t.parentVersionId),
  }),
);

export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;

export const skillImprovements = sqliteTable(
  'skill_improvements',
  {
    id: id(),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    previousVersion: integer('previous_version').notNull(),
    newVersion: integer('new_version').notNull(),
    diff: text('diff').notNull(),
    reason: text('reason').notNull(),
    triggeredBy: text('triggered_by', {
      enum: ['failure', 'deviation', 'manual', 'outcome'],
    }).notNull(),
    improvedBy: text('improved_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    skillIdx: index('skill_improvements_skill_idx').on(t.skillId),
  }),
);

export type SkillImprovement = typeof skillImprovements.$inferSelect;
export type NewSkillImprovement = typeof skillImprovements.$inferInsert;

export const memoryEntries = sqliteTable(
  'memory_entries',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    userId: text('user_id'),
    content: text('content').notNull(),
    category: text('category', {
      enum: ['fact', 'preference', 'context', 'other'],
    })
      .notNull()
      .default('other'),
    sourceSessionId: text('source_session_id'),
    embedding: text('embedding'),
    /** Phase 21 provenance tagging — nullable for back-compat with pre-21 rows. */
    origin: text('origin'),
    trust: text('trust', { enum: ['high', 'medium', 'low', 'untrusted'] }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    projectAgentIdx: index('memory_entries_project_agent_idx').on(t.projectId, t.agentId),
    userIdx: index('memory_entries_user_idx').on(t.userId),
    trustIdx: index('memory_entries_trust_idx').on(t.trust),
  }),
);

export type MemoryEntry = typeof memoryEntries.$inferSelect;
export type NewMemoryEntry = typeof memoryEntries.$inferInsert;

export const sessionHistory = sqliteTable(
  'session_history',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    userId: text('user_id'),
    summary: text('summary').notNull(),
    fullText: text('full_text').notNull(), // FTS5 virtual table mirrors this (see migration)
    toolCallsCount: integer('tool_calls_count').notNull().default(0),
    tokensUsed: integer('tokens_used').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    lineageParentId: text('lineage_parent_id'),
    /** Phase 21 provenance tagging — nullable for back-compat. */
    origin: text('origin'),
    trust: text('trust', { enum: ['high', 'medium', 'low', 'untrusted'] }),
    createdAt: createdAt(),
  },
  (t) => ({
    projectAgentIdx: index('session_history_project_agent_idx').on(t.projectId, t.agentId),
    lineageIdx: index('session_history_lineage_idx').on(t.lineageParentId),
    trustIdx: index('session_history_trust_idx').on(t.trust),
  }),
);

export type SessionHistory = typeof sessionHistory.$inferSelect;
export type NewSessionHistory = typeof sessionHistory.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Reflection events — Phase B1
//
// Row-per-event audit log for agent self-critique + outcome assessment. The
// runtime's `ReflectionAdapter` is where events originate; `persist` on the
// ReflectionConfig writes here.
// ─────────────────────────────────────────────────────────────────────────────

export const reflectionEvents = sqliteTable(
  'reflection_events',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    sessionId: text('session_id'),
    turnIndex: integer('turn_index').notNull(),
    kind: text('kind', { enum: ['critique', 'outcome'] }).notNull(),
    rubricIssues: text('rubric_issues', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    llmInvoked: integer('llm_invoked', { mode: 'boolean' }).notNull().default(false),
    critiqueScore: real('critique_score'),
    accept: integer('accept', { mode: 'boolean' }),
    revisionApplied: integer('revision_applied', { mode: 'boolean' }).notNull().default(false),
    outcomeScore: real('outcome_score'),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => ({
    projectAgentIdx: index('reflection_events_project_agent_idx').on(t.projectId, t.agentId),
    kindIdx: index('reflection_events_kind_idx').on(t.kind),
    sessionIdx: index('reflection_events_session_idx').on(t.sessionId),
  }),
);

export type ReflectionEvent = typeof reflectionEvents.$inferSelect;
export type NewReflectionEvent = typeof reflectionEvents.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Plans — Phase B2
//
// Explicit plan decomposition + progress tracking. `state` drives the
// lifecycle (draft / active / paused / completed / abandoned). `steps` live
// in a child table with FK back to plans.
// ─────────────────────────────────────────────────────────────────────────────

export const plans = sqliteTable(
  'plans',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sessionId: text('session_id'),
    goal: text('goal').notNull(),
    state: text('state', {
      enum: ['draft', 'active', 'paused', 'completed', 'abandoned'],
    })
      .notNull()
      .default('active'),
    currentStepId: text('current_step_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    projectIdx: index('plans_project_idx').on(t.projectId),
    stateIdx: index('plans_state_idx').on(t.state),
  }),
);

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;

export const planSteps = sqliteTable(
  'plan_steps',
  {
    id: id(),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    parentStepId: text('parent_step_id'),
    order: integer('order_index').notNull(),
    description: text('description').notNull(),
    status: text('status', {
      enum: ['pending', 'in_progress', 'blocked', 'completed', 'skipped'],
    })
      .notNull()
      .default('pending'),
    evidence: text('evidence', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    planIdx: index('plan_steps_plan_idx').on(t.planId),
    statusIdx: index('plan_steps_status_idx').on(t.status),
  }),
);

export type PlanStepRow = typeof planSteps.$inferSelect;
export type NewPlanStep = typeof planSteps.$inferInsert;

export const planRevisions = sqliteTable(
  'plan_revisions',
  {
    id: id(),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    delta: text('delta', { mode: 'json' })
      .$type<{ added: string[]; removed: string[] }>()
      .notNull()
      .default(sql`'{"added":[],"removed":[]}'`),
    createdAt: createdAt(),
  },
  (t) => ({
    planIdx: index('plan_revisions_plan_idx').on(t.planId),
  }),
);

export type PlanRevisionRow = typeof planRevisions.$inferSelect;
export type NewPlanRevision = typeof planRevisions.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// User Modeling
// ─────────────────────────────────────────────────────────────────────────────

export const userModels = sqliteTable(
  'user_models',
  {
    id: id(),
    userId: text('user_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    communicationStyle: text('communication_style'),
    expertiseDomains: text('expertise_domains', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    workflowPreferences: text('workflow_preferences', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    activeProjects: text('active_projects', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    toolPreferences: text('tool_preferences', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    riskTolerance: text('risk_tolerance', { enum: ['low', 'medium', 'high'] })
      .notNull()
      .default('medium'),
    interactionCount: integer('interaction_count').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => ({
    userProjectIdx: index('user_models_user_project_idx').on(t.userId, t.projectId),
  }),
);

export type UserModel = typeof userModels.$inferSelect;
export type NewUserModel = typeof userModels.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Agent Profiles
// ─────────────────────────────────────────────────────────────────────────────

export const agentSkillsProfile = sqliteTable(
  'agent_skills_profile',
  {
    id: id(),
    agentName: text('agent_name').notNull(),
    domain: text('domain').notNull(),
    successRate: real('success_rate').notNull().default(0),
    totalTasks: integer('total_tasks').notNull().default(0),
    lastUpdated: text('last_updated')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => ({
    agentDomainIdx: index('agent_skills_profile_agent_domain_idx').on(t.agentName, t.domain),
  }),
);

export type AgentSkillsProfile = typeof agentSkillsProfile.$inferSelect;
export type NewAgentSkillsProfile = typeof agentSkillsProfile.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Reliability
// ─────────────────────────────────────────────────────────────────────────────

export const healthEvents = sqliteTable(
  'health_events',
  {
    id: id(),
    eventType: text('event_type').notNull(),
    component: text('component').notNull(),
    severity: text('severity', { enum: ['info', 'warning', 'error', 'critical'] }).notNull(),
    details: text('details', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    actionTaken: text('action_taken'),
    createdAt: createdAt(),
  },
  (t) => ({
    componentIdx: index('health_events_component_idx').on(t.component),
    severityIdx: index('health_events_severity_idx').on(t.severity),
    createdIdx: index('health_events_created_idx').on(t.createdAt),
  }),
);

export type HealthEvent = typeof healthEvents.$inferSelect;
export type NewHealthEvent = typeof healthEvents.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Audit + Cost
// ─────────────────────────────────────────────────────────────────────────────

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: id(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    agentId: text('agent_id'),
    userId: text('user_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    details: text('details', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    costUsd: real('cost_usd').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => ({
    projectIdx: index('audit_log_project_idx').on(t.projectId),
    agentIdx: index('audit_log_agent_idx').on(t.agentId),
    actionIdx: index('audit_log_action_idx').on(t.action),
    createdIdx: index('audit_log_created_idx').on(t.createdAt),
  }),
);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;

export const llmUsage = sqliteTable(
  'llm_usage',
  {
    id: id(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    agentId: text('agent_id'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => ({
    projectIdx: index('llm_usage_project_idx').on(t.projectId),
    providerModelIdx: index('llm_usage_provider_model_idx').on(t.provider, t.model),
    createdIdx: index('llm_usage_created_idx').on(t.createdAt),
  }),
);

export type LLMUsage = typeof llmUsage.$inferSelect;
export type NewLLMUsage = typeof llmUsage.$inferInsert;
