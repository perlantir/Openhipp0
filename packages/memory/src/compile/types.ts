/**
 * Shared types for the compile module.
 *
 * `AgentSystemPromptSection` intentionally mirrors the same shape in
 * @openhipp0/core/agent so the MemoryAdapter (Phase 2f) can return these
 * directly. Kept local to avoid a core → memory → core cycle; both sides
 * are trivially structural.
 */

export interface AgentSystemPromptSection {
  title: string;
  body: string;
}
