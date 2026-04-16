# Training Data Pipeline (Phase 15)

Open Hipp0 captures agent runs as `Trajectory` objects you can export to
JSONL for SFT, convert to DPO preference pairs, or reshape into Atropos
RL episodes. Downstream: axolotl / transformers / the Atropos trainer.

## Shape

A `Trajectory` is:

```ts
{
  id: string;
  agent: { id, name };
  projectId: string;
  messages: TrajectoryMessage[]; // OpenAI chat shape w/ tool_calls
  decisionsActive: TrajectoryDecision[];
  skillsLoaded: TrajectorySkill[];
  userModelState?: Record<string, unknown>;
  outcome: 'success' | 'failure' | 'mixed' | 'unknown';
  reward?: number;
  startedAt: string; completedAt: string;
}
```

## Batch runner

`runBatch` executes a task list with configurable concurrency, writes
checkpoints after every completion so a rerun skips finished tasks, and
collects failures without aborting.

```ts
import { runBatch, createMemoryCheckpointStore } from '@openhipp0/core';

const store = createMemoryCheckpointStore(); // or a file-backed store
const r = await runBatch({
  tasks: taskList,
  concurrency: 4,
  checkpoint: store,
  async executeTask(task) {
    return runAgentAndCapture(task);
  },
  onTrajectory: (t) => writeJsonl(t),
});
```

## Compression

`compressTrajectory` keeps system + first user + tool-call/result pairs +
last assistant turn. Pass a `pinTurn(msg, i, src)` callback to keep
additional turns (e.g. ones that modified a decision).

## SFT / DPO / Atropos

```ts
import { toJsonl, toSftExamples, toDpoExamples, toAtropos } from '@openhipp0/core';

writeFile('sft.jsonl', toSftExamples(trajectories).map(JSON.stringify).join('\n'));
writeFile('dpo.jsonl', toDpoExamples(trajectories).map(JSON.stringify).join('\n'));
const atropos = trajectories.map((t) => toAtropos(t, 'hipp0-browser'));
writeFile('episodes.jsonl', toJsonl(atropos as never));
```

SFT picks only `outcome==='success'` rollouts. DPO pairs success + failure
trajectories that share a prompt prefix. Atropos emits the Nous
{observation, action, reward, done} schema with reward derived from outcome.
