/**
 * Batch trajectory runner — feeds a task list through N concurrent agent
 * workers, persists a checkpoint after each task completes (resume-safe),
 * and emits trajectories as they arrive.
 *
 * The runner is transport-agnostic: it takes an `executeTask` callback that
 * turns a task definition into a Trajectory. Production wires this to
 * AgentRuntime.handleMessage + decision memory snapshots; tests pass a stub.
 */

import type { Trajectory } from './types.js';

export interface Task<TInput = Record<string, unknown>> {
  id: string;
  input: TInput;
  /** Optional tags stored on the trajectory. */
  tags?: readonly string[];
}

export interface BatchCheckpoint {
  completedIds: readonly string[];
  failedIds: readonly string[];
  updatedAt: string;
}

export interface CheckpointStore {
  load(): Promise<BatchCheckpoint | null>;
  save(c: BatchCheckpoint): Promise<void>;
}

export interface BatchRunnerOptions<TInput> {
  tasks: readonly Task<TInput>[];
  executeTask: (task: Task<TInput>) => Promise<Trajectory>;
  concurrency?: number;
  checkpoint?: CheckpointStore;
  onTrajectory?: (t: Trajectory) => Promise<void> | void;
  onError?: (task: Task<TInput>, err: unknown) => Promise<void> | void;
  /** Optional — override Date.now for deterministic tests. */
  now?: () => Date;
}

export interface BatchRunnerResult {
  trajectories: Trajectory[];
  completed: number;
  skipped: number;
  failed: string[];
}

export async function runBatch<TInput>(
  opts: BatchRunnerOptions<TInput>,
): Promise<BatchRunnerResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const now = opts.now ?? (() => new Date());
  const loaded = (await opts.checkpoint?.load()) ?? null;
  const doneIds = new Set(loaded?.completedIds ?? []);
  const failedIds = new Set(loaded?.failedIds ?? []);

  const pending = opts.tasks.filter((t) => !doneIds.has(t.id));
  const trajectories: Trajectory[] = [];
  const failed: string[] = [...failedIds];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      const task = pending[cursor++]!;
      try {
        const t = await opts.executeTask(task);
        trajectories.push(t);
        doneIds.add(task.id);
        await opts.onTrajectory?.(t);
      } catch (err) {
        failedIds.add(task.id);
        failed.push(task.id);
        if (opts.onError) await opts.onError(task, err);
      }
      if (opts.checkpoint) {
        await opts.checkpoint.save({
          completedIds: [...doneIds],
          failedIds: [...failedIds],
          updatedAt: now().toISOString(),
        });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return {
    trajectories,
    completed: trajectories.length,
    skipped: opts.tasks.length - pending.length,
    failed,
  };
}

/** In-memory checkpoint store — useful for tests and ephemeral runs. */
export function createMemoryCheckpointStore(): CheckpointStore & { state: BatchCheckpoint | null } {
  return {
    state: null,
    async load() {
      return this.state;
    },
    async save(c) {
      this.state = c;
    },
  };
}
