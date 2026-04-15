/**
 * Honcho-style user modeling.
 *
 * Six dimensions tracked per (user, project):
 *   - communicationStyle     (short free-form string)
 *   - expertiseDomains       (string[])
 *   - workflowPreferences    (Record<string, unknown>)
 *   - activeProjects         (string[])
 *   - toolPreferences        (Record<string, unknown>)
 *   - riskTolerance          ('low' | 'medium' | 'high')
 *
 * Updates are incremental: each interaction hands the current model to an
 * `UserModelUpdater` which returns a dimension patch. We merge the patch
 * (set semantics for arrays, object merge for dict-like dimensions,
 * overwrite for scalars).
 *
 * `interactionCount` monotonically increments on every applyUpdate call.
 */

import { and, eq } from 'drizzle-orm';
import type { HipppoDb } from '../db/client.js';
import { userModels, type NewUserModel, type UserModel } from '../db/schema.js';

export type RiskTolerance = NonNullable<UserModel['riskTolerance']>;

export interface UserModelPatch {
  communicationStyle?: string | null;
  expertiseDomainsAdd?: readonly string[];
  expertiseDomainsRemove?: readonly string[];
  workflowPreferencesSet?: Record<string, unknown>;
  workflowPreferencesDelete?: readonly string[];
  activeProjectsAdd?: readonly string[];
  activeProjectsRemove?: readonly string[];
  toolPreferencesSet?: Record<string, unknown>;
  toolPreferencesDelete?: readonly string[];
  riskTolerance?: RiskTolerance;
}

export interface UpdaterSessionSnapshot {
  projectId: string;
  userId: string;
  /** Flat text representation of the interaction (messages / summary). */
  text: string;
  toolCallsCount: number;
}

export type UserModelUpdater = (
  current: UserModel | null,
  session: UpdaterSessionSnapshot,
) => Promise<UserModelPatch | null>;

// ─────────────────────────────────────────────────────────────────────────────

export async function getUserModel(
  db: HipppoDb,
  userId: string,
  projectId: string,
): Promise<UserModel | null> {
  const rows = await db
    .select()
    .from(userModels)
    .where(and(eq(userModels.userId, userId), eq(userModels.projectId, projectId)))
    .limit(1);
  return rows[0] ?? null;
}

async function ensureUserModel(
  db: HipppoDb,
  userId: string,
  projectId: string,
): Promise<UserModel> {
  const existing = await getUserModel(db, userId, projectId);
  if (existing) return existing;
  const payload: NewUserModel = { userId, projectId };
  const [row] = await db.insert(userModels).values(payload).returning();
  if (!row) throw new Error('ensureUserModel: insert returned no row');
  return row;
}

/**
 * Fetch current model, invoke the updater, merge the patch, bump
 * interactionCount. Returns the updated row.
 */
export async function applyUpdate(
  db: HipppoDb,
  userId: string,
  projectId: string,
  updater: UserModelUpdater,
  session: UpdaterSessionSnapshot,
): Promise<UserModel> {
  const current = await getUserModel(db, userId, projectId);
  const patch = await updater(current, session);

  // Even if updater returned null, we still bump interactionCount.
  const target = current ?? (await ensureUserModel(db, userId, projectId));
  const next = mergePatch(target, patch);

  const [row] = await db
    .update(userModels)
    .set({
      ...(patch?.communicationStyle !== undefined && {
        communicationStyle: patch.communicationStyle,
      }),
      expertiseDomains: next.expertiseDomains,
      workflowPreferences: next.workflowPreferences,
      activeProjects: next.activeProjects,
      toolPreferences: next.toolPreferences,
      ...(patch?.riskTolerance && { riskTolerance: patch.riskTolerance }),
      interactionCount: target.interactionCount + 1,
    })
    .where(eq(userModels.id, target.id))
    .returning();
  if (!row) throw new Error('applyUpdate: update returned no row');
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure merge — exposed for tests
// ─────────────────────────────────────────────────────────────────────────────

export interface MergedModel {
  expertiseDomains: string[];
  workflowPreferences: Record<string, unknown>;
  activeProjects: string[];
  toolPreferences: Record<string, unknown>;
}

export function mergePatch(current: UserModel, patch: UserModelPatch | null): MergedModel {
  const expertise = new Set(current.expertiseDomains ?? []);
  for (const v of patch?.expertiseDomainsAdd ?? []) expertise.add(v);
  for (const v of patch?.expertiseDomainsRemove ?? []) expertise.delete(v);

  const active = new Set(current.activeProjects ?? []);
  for (const v of patch?.activeProjectsAdd ?? []) active.add(v);
  for (const v of patch?.activeProjectsRemove ?? []) active.delete(v);

  const workflow = { ...((current.workflowPreferences as Record<string, unknown>) ?? {}) };
  Object.assign(workflow, patch?.workflowPreferencesSet ?? {});
  for (const k of patch?.workflowPreferencesDelete ?? []) delete workflow[k];

  const tools = { ...((current.toolPreferences as Record<string, unknown>) ?? {}) };
  Object.assign(tools, patch?.toolPreferencesSet ?? {});
  for (const k of patch?.toolPreferencesDelete ?? []) delete tools[k];

  return {
    expertiseDomains: [...expertise],
    workflowPreferences: workflow,
    activeProjects: [...active],
    toolPreferences: tools,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt snippet renderer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render a user model into a concise prompt section the agent can read at
 * the top of each turn. Returns null if the model is empty / irrelevant.
 */
export function renderUserModelSnippet(model: UserModel): string | null {
  const parts: string[] = [];
  if (model.communicationStyle) parts.push(`Style: ${model.communicationStyle}`);
  if (model.expertiseDomains && model.expertiseDomains.length > 0) {
    parts.push(`Expertise: ${model.expertiseDomains.join(', ')}`);
  }
  // Only surface risk tolerance when it's been explicitly set away from the
  // default — otherwise it adds noise without information.
  if (model.riskTolerance && model.riskTolerance !== 'medium') {
    parts.push(`Risk tolerance: ${model.riskTolerance}`);
  }
  if (model.activeProjects && model.activeProjects.length > 0) {
    parts.push(`Active projects: ${model.activeProjects.join(', ')}`);
  }
  if (parts.length === 0) return null;
  return parts.join('\n');
}
