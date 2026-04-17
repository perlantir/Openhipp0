import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertCorpusHealthy,
  loadBenchmark,
  loadJsonl,
  resolveCorpusDir,
} from '../../src/corpus/loader.js';

describe('corpus loader', () => {
  let root: string;
  beforeEach(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'hipp0-corpus-'));
    await fs.mkdir(path.join(root, 'tau-bench', 'test'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'tau-bench', 'test', 'task-1.json'),
      JSON.stringify({ id: 't1', userGoal: 'book a flight', domain: 'airline' }),
    );
    await fs.writeFile(
      path.join(root, 'tau-bench', 'test', 'tasks.jsonl'),
      `${JSON.stringify({ id: 'j1', domain: 'retail' })}\n${JSON.stringify({ id: 'j2', domain: 'retail' })}\n`,
    );
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolveCorpusDir reads HIPP0_EVAL_CORPUS_DIR', async () => {
    const dir = await resolveCorpusDir({ env: { HIPP0_EVAL_CORPUS_DIR: root } });
    expect(dir).toBe(root);
  });

  it('resolveCorpusDir throws when unset', async () => {
    await expect(resolveCorpusDir({ env: {} })).rejects.toThrow(/HIPP0_EVAL_CORPUS_DIR/);
  });

  it('loadJsonl reads newline-delimited entries', async () => {
    const entries = await loadJsonl<{ id: string }>(path.join(root, 'tau-bench', 'test', 'tasks.jsonl'));
    expect(entries.map((e) => e.id)).toEqual(['j1', 'j2']);
  });

  it('loadBenchmark returns both .json and .jsonl entries', async () => {
    const items = await loadBenchmark<{ id: string }>('tau-bench', 'test', { corpusDir: root });
    expect(items.map((e) => e.id).sort()).toEqual(['j1', 'j2', 't1']);
  });

  it('loadBenchmark respects limit', async () => {
    const items = await loadBenchmark('tau-bench', 'test', { corpusDir: root, limit: 2 });
    expect(items).toHaveLength(2);
  });

  it('assertCorpusHealthy reports per-benchmark counts', async () => {
    const report = await assertCorpusHealthy({ corpusDir: root });
    expect(report.perBenchmark['tau-bench']).toBeGreaterThanOrEqual(2);
    expect(report.total).toBeGreaterThanOrEqual(2);
  });
});
