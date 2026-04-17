import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Recorder } from '../../src/workflow/recorder.js';
import { WorkflowStore } from '../../src/workflow/workflow-store.js';

describe('WorkflowStore', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'hipp0-wf-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('saves + loads a workflow by name', async () => {
    const store = new WorkflowStore({ root });
    const wf = new Recorder({ name: 'login' }).build();
    await store.save(wf);
    const loaded = await store.load('login');
    expect(loaded?.name).toBe('login');
  });

  it('lists saved workflows', async () => {
    const store = new WorkflowStore({ root });
    await store.save(new Recorder({ name: 'a' }).build());
    await store.save(new Recorder({ name: 'b' }).build());
    const list = await store.list();
    expect(new Set(list)).toEqual(new Set(['a', 'b']));
  });

  it('rejects unsafe names', async () => {
    const store = new WorkflowStore({ root });
    await expect(store.save({ ...new Recorder({ name: '../escape' }).build() })).rejects.toThrow();
  });
});
