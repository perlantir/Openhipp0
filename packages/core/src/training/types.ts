/**
 * Training data types.
 *
 * A "trajectory" is a single agent run captured in a form amenable to SFT /
 * DPO fine-tuning or RL training. We keep the schema intentionally close to
 * what transformers / axolotl consume so scripts don't need custom loaders.
 */

export interface TrajectoryMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** For assistant messages that used tools. */
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** For tool messages, the tool call this is a response to. */
  tool_call_id?: string;
  /** For tool messages, whether the call succeeded. */
  tool_result_ok?: boolean;
  /** Timestamp (ms since epoch) when this turn happened. */
  timestamp?: number;
}

export interface TrajectoryDecision {
  id: string;
  title: string;
  /** Whether the decision was active at the time of the message turn. */
  activeAtTurn: number;
}

export interface TrajectorySkill {
  name: string;
  /** Turn index where the skill was available. */
  loadedAtTurn: number;
}

export type TrajectoryOutcome = 'success' | 'failure' | 'mixed' | 'unknown';

export interface Trajectory {
  id: string;
  /** Agent identity at the time of the run. */
  agent: { id: string; name: string; role?: string };
  /** Project / org / user that initiated the run. */
  projectId: string;
  userId?: string;
  /** All turns in order. */
  messages: readonly TrajectoryMessage[];
  decisionsActive: readonly TrajectoryDecision[];
  skillsLoaded: readonly TrajectorySkill[];
  userModelState?: Record<string, unknown>;
  outcome: TrajectoryOutcome;
  /** Reward signal — caller-assigned; defaults to 1/-1/0 based on outcome. */
  reward?: number;
  startedAt: string; // ISO 8601
  completedAt: string;
  /** Metadata for the batch / experiment this came from. */
  tags?: readonly string[];
  metadata?: Record<string, unknown>;
}

export interface SftExample {
  messages: readonly TrajectoryMessage[];
  tools?: readonly { name: string; description: string; schema: Record<string, unknown> }[];
}

export interface DpoExample {
  prompt: readonly TrajectoryMessage[];
  chosen: TrajectoryMessage;
  rejected: TrajectoryMessage;
  reward_margin?: number;
}
