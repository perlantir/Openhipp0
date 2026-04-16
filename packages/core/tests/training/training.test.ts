import { describe, it, expect, vi } from 'vitest';
import {
  toJsonl,
  fromJsonl,
  toSftExamples,
  toDpoExamples,
  toAtropos,
  compressTrajectory,
  runBatch,
  createMemoryCheckpointStore,
  type Task,
  type Trajectory,
  type TrajectoryMessage,
} from '../../src/training/index.js';

function trajectory(
  id: string,
  messages: TrajectoryMessage[],
  outcome: Trajectory['outcome'] = 'success',
): Trajectory {
  return {
    id,
    agent: { id: 'a', name: 'A' },
    projectId: 'p',
    messages,
    decisionsActive: [],
    skillsLoaded: [],
    outcome,
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(1).toISOString(),
  };
}

describe('toJsonl / fromJsonl', () => {
  it('round-trips through JSONL', () => {
    const t = trajectory('t1', [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    const text = toJsonl([t]);
    expect(text).not.toContain('\n');
    const back = fromJsonl(text);
    expect(back).toEqual([t]);
  });

  it('handles multiple trajectories', () => {
    const a = trajectory('a', [{ role: 'user', content: 'a' }]);
    const b = trajectory('b', [{ role: 'user', content: 'b' }]);
    const text = toJsonl([a, b]);
    expect(fromJsonl(text)).toHaveLength(2);
  });
});

describe('toSftExamples', () => {
  it('includes only successful trajectories', () => {
    const good = trajectory('g', [{ role: 'user', content: 'a' }], 'success');
    const bad = trajectory('b', [{ role: 'user', content: 'a' }], 'failure');
    const ex = toSftExamples([good, bad]);
    expect(ex).toHaveLength(1);
  });

  it('stripToolResults drops tool messages', () => {
    const t = trajectory('t', [
      { role: 'user', content: 'do' },
      { role: 'assistant', content: 'calling', tool_calls: [{ id: 'c1', name: 'fetch', arguments: {} }] },
      { role: 'tool', content: 'huge result', tool_call_id: 'c1' },
      { role: 'assistant', content: 'answer' },
    ]);
    const ex = toSftExamples([t], { stripToolResults: true });
    expect(ex[0]!.messages.every((m) => m.role !== 'tool')).toBe(true);
  });
});

describe('toDpoExamples', () => {
  it('pairs successful and failed trajectories that share a prefix', () => {
    const win = trajectory(
      'w',
      [
        { role: 'user', content: 'pick the cat' },
        { role: 'assistant', content: 'selected cat' },
      ],
      'success',
    );
    const lose = trajectory(
      'l',
      [
        { role: 'user', content: 'pick the cat' },
        { role: 'assistant', content: 'selected dog' },
      ],
      'failure',
    );
    const examples = toDpoExamples([win, lose]);
    expect(examples).toHaveLength(1);
    expect(examples[0]!.chosen.content).toBe('selected cat');
    expect(examples[0]!.rejected.content).toBe('selected dog');
    expect(examples[0]!.prompt[0]!.content).toBe('pick the cat');
  });
});

describe('toAtropos', () => {
  it('maps (system,user,tool)→observation and assistant→action', () => {
    const t = trajectory('t', [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task' },
      { role: 'assistant', content: 'step1', tool_calls: [{ id: 'c', name: 'n', arguments: {} }] },
      { role: 'tool', content: 'result', tool_call_id: 'c' },
      { role: 'assistant', content: 'final' },
    ]);
    const atropos = toAtropos(t);
    expect(atropos.steps).toHaveLength(2);
    expect(atropos.steps[0]!.done).toBe(false);
    expect(atropos.steps[1]!.done).toBe(true);
    expect(atropos.total_reward).toBe(1); // success default
  });

  it('emits -1 reward on failure', () => {
    const t = trajectory(
      'x',
      [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'wrong' },
      ],
      'failure',
    );
    expect(toAtropos(t).total_reward).toBe(-1);
  });
});

describe('compressTrajectory', () => {
  it('keeps system + first user + tool-call pairs + last assistant', () => {
    const t = trajectory('t', [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'thinking' },
      { role: 'assistant', content: 'call', tool_calls: [{ id: 'c1', name: 'f', arguments: {} }] },
      { role: 'tool', content: 'r', tool_call_id: 'c1' },
      { role: 'assistant', content: 'still' },
      { role: 'assistant', content: 'answer' },
    ]);
    const c = compressTrajectory(t, { targetRatio: 1 });
    const roles = c.messages.map((m) => m.role);
    expect(roles[0]).toBe('system');
    expect(roles.includes('user')).toBe(true);
    expect(roles.includes('tool')).toBe(true);
    // Last assistant kept
    expect(c.messages[c.messages.length - 1]!.content).toBe('answer');
    // The non-tool intermediate "thinking" assistant is dropped.
    expect(c.messages.map((m) => m.content)).not.toContain('thinking');
  });

  it('applies toolResultMaxChars cap to tool messages', () => {
    const t = trajectory('t', [
      { role: 'assistant', content: 'call', tool_calls: [{ id: 'c', name: 'f', arguments: {} }] },
      { role: 'tool', content: 'X'.repeat(500), tool_call_id: 'c' },
      { role: 'assistant', content: 'done' },
    ]);
    const c = compressTrajectory(t, { toolResultMaxChars: 10, targetRatio: 1 });
    const tool = c.messages.find((m) => m.role === 'tool')!;
    expect(tool.content.length).toBeLessThan(500);
    expect(tool.content.endsWith('[truncated]')).toBe(true);
  });
});

describe('runBatch', () => {
  it('runs all tasks with concurrency and persists checkpoints', async () => {
    const tasks: Task[] = [{ id: 't1', input: {} }, { id: 't2', input: {} }, { id: 't3', input: {} }];
    const store = createMemoryCheckpointStore();
    const r = await runBatch({
      tasks,
      concurrency: 2,
      checkpoint: store,
      async executeTask(task) {
        return trajectory(task.id, [{ role: 'user', content: task.id }]);
      },
    });
    expect(r.completed).toBe(3);
    expect(r.failed).toHaveLength(0);
    expect(new Set(store.state!.completedIds)).toEqual(new Set(['t1', 't2', 't3']));
  });

  it('resumes from an existing checkpoint, skipping completed tasks', async () => {
    const tasks: Task[] = [{ id: 't1', input: {} }, { id: 't2', input: {} }];
    const store = createMemoryCheckpointStore();
    store.state = {
      completedIds: ['t1'],
      failedIds: [],
      updatedAt: new Date().toISOString(),
    };
    const execute = vi.fn(async (task: Task) => trajectory(task.id, [{ role: 'user', content: task.id }]));
    const r = await runBatch({ tasks, checkpoint: store, executeTask: execute });
    expect(r.completed).toBe(1);
    expect(r.skipped).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0].id).toBe('t2');
  });

  it('collects failures without stopping', async () => {
    const tasks: Task[] = [{ id: 't1', input: {} }, { id: 't2', input: {} }];
    const r = await runBatch({
      tasks,
      async executeTask(task) {
        if (task.id === 't1') throw new Error('boom');
        return trajectory(task.id, [{ role: 'user', content: 'ok' }]);
      },
    });
    expect(r.failed).toEqual(['t1']);
    expect(r.completed).toBe(1);
  });
});
