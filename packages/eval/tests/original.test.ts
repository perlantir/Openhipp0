import { describe, expect, it } from 'vitest';
import { runCase } from '../src/runner.js';
import * as recall from '../src/original/memory-recall.js';
import * as learn from '../src/original/self-learning.js';

describe('memory-recall original benchmark', () => {
  it('reference agent retrieves expected decisions', async () => {
    const c = recall.taskToCase(recall.BUILTIN_RECALL_TASKS[0]!, {
      agent: recall.REFERENCE_RECALL_AGENT,
    });
    const result = await runCase(c);
    expect(result.metrics.success).toBe(true);
  });

  it('fails when agent returns unrelated ids', async () => {
    const c = recall.taskToCase(recall.BUILTIN_RECALL_TASKS[0]!, {
      agent: { async recall() { return { ids: ['zzz'] }; } },
    });
    const result = await runCase(c);
    expect(result.metrics.success).toBe(false);
  });
});

describe('self-learning original benchmark', () => {
  it('reference learner creates one skill + invokes it', async () => {
    const learner = learn.createReferenceLearner();
    const c = learn.taskToCase(learn.BUILTIN_SELF_LEARNING_TASKS[0]!, { learner });
    const result = await runCase(c);
    expect(result.metrics.success).toBe(true);
  });

  it('fails when learner creates too many skills', async () => {
    const noisyLearner: learn.SkillLearner = {
      async ingest() {},
      async skills() {
        return [
          { id: 's1', trigger: 'a', hits: 0 },
          { id: 's2', trigger: 'b', hits: 0 },
        ];
      },
      async invoke() { return 's1'; },
      async reset() {},
    };
    const c = learn.taskToCase(learn.BUILTIN_SELF_LEARNING_TASKS[0]!, { learner: noisyLearner });
    const result = await runCase(c);
    expect(result.metrics.success).toBe(false);
  });
});
