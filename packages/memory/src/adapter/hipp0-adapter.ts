/**
 * Hipp0MemoryAdapter — implementation of @openhipp0/core's MemoryAdapter
 * interface, wiring the agent runtime loop into the decision graph,
 * compiler, self-learning, user modeling, and recall modules.
 *
 * Responsibilities split:
 *   compileContext(req)  — assemble the system-prompt sections
 *     → decision compiler (topN relevant + H0C compression)
 *     → user model snippet (if userId + model found)
 *     → recall via FTS5 (optional; dependent on query-as-FTS5 friendliness)
 *
 *   recordSession(session) — fire-and-forget side effects
 *     → write a session_history row
 *     → maybeCreateSkill  (if tool calls ≥ threshold)
 *     → maybeNudge        (if turns ≥ threshold)
 *     → maybeCompressSession (if tokens over threshold)
 *     → applyUpdate on user model (if userId present)
 *
 * All LLM-backed callbacks (writer, extractor, summarizer, updater) are
 * injected via the constructor. Omitting one disables that side effect —
 * the adapter still functions, with the remaining behaviors active.
 */

import type {
  AgentIdentity,
  CompileContextRequest,
  CompiledContext,
  MemoryAdapter,
  SessionSummary,
} from '@openhipp0/core';
import type { Message } from '@openhipp0/core';
import { security } from '@openhipp0/core';
import { tagRecallHits } from '../injection/tag.js';
import type { HipppoDb } from '../db/client.js';
import { sessionHistory, type NewSessionHistory } from '../db/schema.js';
import { compileFromDecisions, type CompressionFormat } from '../compile/index.js';
import { listByProject, type EmbeddingProvider } from '../decisions/index.js';
import {
  maybeCompressSession,
  maybeCreateSkill,
  maybeNudge,
  type ConversationSummarizer,
  type FactExtractor,
  type SkillWriter,
  type Turn,
} from '../learning/index.js';
import { searchSessions, escapeFts5 } from '../recall/index.js';
import {
  applyUpdate,
  getUserModel,
  renderUserModelSnippet,
  type UserModelUpdater,
} from '../user-model/index.js';

export interface Hipp0MemoryAdapterOptions {
  db: HipppoDb;
  embeddingProvider?: EmbeddingProvider;
  /** LLM-backed fact extractor for memory nudges. */
  factExtractor?: FactExtractor;
  /** LLM-backed skill writer. */
  skillWriter?: SkillWriter;
  /** LLM-backed user model updater. */
  userModelUpdater?: UserModelUpdater;
  /** LLM-backed session compressor. */
  sessionSummarizer?: ConversationSummarizer;
  /** Context-compilation tuning. */
  compile?: {
    topN?: number;
    format?: CompressionFormat;
    tokenBudget?: number;
    recencyHalfLifeDays?: number;
  };
  /** Include recall hits in compiled context. Default: true. */
  enableRecall?: boolean;
  /** Max recall hits to include. Default: 3. */
  recallLimit?: number;
}

export class Hipp0MemoryAdapter implements MemoryAdapter {
  constructor(private readonly opts: Hipp0MemoryAdapterOptions) {}

  async compileContext(req: CompileContextRequest): Promise<CompiledContext> {
    const { db, embeddingProvider, compile: cmp } = this.opts;
    const sections: CompiledContext['sections'] = [];

    // --- Decision section (semantic + scored + compressed) ---
    if (embeddingProvider) {
      const queryVec = await embeddingProvider.embed(req.query);
      const candidates = await listByProject(db, req.projectId, { status: 'active', limit: 200 });
      const result = compileFromDecisions(candidates, queryVec, {
        topN: cmp?.topN ?? 30,
        format: cmp?.format ?? 'h0c',
        tokenBudget: cmp?.tokenBudget ?? 2000,
        recencyHalfLifeDays: cmp?.recencyHalfLifeDays ?? 30,
        agent: req.agent,
      });
      for (const s of result.sections) sections.push(s);
    }

    // --- User model snippet ---
    if (req.userId) {
      try {
        const um = await getUserModel(db, req.userId, req.projectId);
        if (um) {
          const snippet = renderUserModelSnippet(um);
          if (snippet) sections.push({ title: 'User Model', body: snippet });
        }
      } catch {
        /* swallow */
      }
    }

    // --- Recall (FTS5) ---
    // Phase 21 wiring: every recall hit is tagged with ProvenanceTag and
    // low/untrusted hits are wrapped with spotlighting delimiters before
    // they reach the LLM. This is the load-bearing injection defense —
    // previously exported but never called.
    if (this.opts.enableRecall !== false) {
      try {
        const hits = searchSessions(db, req.projectId, escapeFts5(req.query), {
          limit: this.opts.recallLimit ?? 3,
          agentId: req.agent.id,
        });
        if (hits.length > 0) {
          const tagged = tagRecallHits(hits);
          const anyUntrusted = tagged.some((t) => security.injection.isQuarantinedTrust(t.tag.trust));
          const parts = tagged.map((t) => {
            const body = `- ${t.hit.session.summary}`;
            return security.injection.renderFragment({ tag: t.tag, text: body });
          });
          const header = anyUntrusted ? `${security.injection.SPOTLIGHT_HEADER}\n\n` : '';
          sections.push({
            title: 'Past Sessions (recalled)',
            body: `${header}${parts.join('\n')}`,
          });
        }
      } catch {
        /* swallow */
      }
    }

    return { sections };
  }

  async recordSession(session: SessionSummary): Promise<void> {
    const { db } = this.opts;
    const fullText = serializeMessages(session.messages);

    // 1. Persist the session_history row
    const payload: NewSessionHistory = {
      projectId: session.projectId,
      agentId: session.agent.id,
      ...(session.userId && { userId: session.userId }),
      summary: session.finalText.slice(0, 500),
      fullText,
      toolCallsCount: session.toolCallsCount,
      tokensUsed: session.tokensUsed.input + session.tokensUsed.output,
      costUsd: 0, // cost tracking happens via LLMClient.onUsage hook, not here
    };
    const [sessionRow] = await db.insert(sessionHistory).values(payload).returning();

    // 2. Skill creation (if tool calls warranted)
    if (this.opts.skillWriter) {
      try {
        await maybeCreateSkill(
          db,
          {
            projectId: session.projectId,
            agentId: session.agent.id,
            toolCallsCount: session.toolCallsCount,
            summary: session.finalText,
            fullText,
          },
          this.opts.skillWriter,
          { embeddingProvider: this.opts.embeddingProvider },
        );
      } catch {
        /* skill creation is advisory — never fail the session */
      }
    }

    // 3. Memory nudge (fact extraction)
    if (this.opts.factExtractor) {
      try {
        await maybeNudge(
          db,
          {
            projectId: session.projectId,
            agentId: session.agent.id,
            ...(session.userId && { userId: session.userId }),
            turns: session.messages.length,
            text: fullText,
          },
          this.opts.factExtractor,
          { embeddingProvider: this.opts.embeddingProvider },
        );
      } catch {
        /* swallow */
      }
    }

    // 4. User model update
    if (session.userId && this.opts.userModelUpdater) {
      try {
        await applyUpdate(db, session.userId, session.projectId, this.opts.userModelUpdater, {
          projectId: session.projectId,
          userId: session.userId,
          text: fullText,
          toolCallsCount: session.toolCallsCount,
        });
      } catch {
        /* swallow */
      }
    }

    // 5. Session compression
    if (this.opts.sessionSummarizer && sessionRow) {
      try {
        await maybeCompressSession(
          db,
          {
            projectId: session.projectId,
            agentId: session.agent.id,
            ...(session.userId && { userId: session.userId }),
            turns: messagesToTurns(session.messages),
            parentSessionId: sessionRow.id,
            toolCallsCount: session.toolCallsCount,
            tokensUsed: session.tokensUsed.input + session.tokensUsed.output,
          },
          this.opts.sessionSummarizer,
        );
      } catch {
        /* swallow */
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function serializeMessages(messages: readonly Message[]): string {
  return messages.map((m) => `[${m.role}]\n${messageToText(m)}`).join('\n\n');
}

function messageToText(m: Message): string {
  if (typeof m.content === 'string') return m.content;
  return m.content
    .map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'tool_use') return `(tool_use ${b.name}: ${JSON.stringify(b.input)})`;
      if (b.type === 'tool_result') return `(tool_result ${b.toolUseId}: ${b.content})`;
      return '';
    })
    .filter((s) => s.length > 0)
    .join('\n');
}

export function messagesToTurns(messages: readonly Message[]): Turn[] {
  return messages.map((m) => ({
    role: m.role,
    content: messageToText(m),
  }));
}

/**
 * Convenience constructor. Most callers can use this with only `db` +
 * optionally an embedding provider.
 */
export function createHipp0MemoryAdapter(opts: Hipp0MemoryAdapterOptions): Hipp0MemoryAdapter {
  return new Hipp0MemoryAdapter(opts);
}

// Re-export AgentIdentity for consumers that don't want to pull core directly.
export type { AgentIdentity };
