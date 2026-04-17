/**
 * Corpus loader — reads benchmark task files from `HIPP0_EVAL_CORPUS_DIR`
 * (or the explicit `corpusDir` override) and yields them to each
 * benchmark's `taskToCase` mapper.
 *
 * Expected layout under `<corpusDir>/`:
 *   tau-bench/<split>/*.json     — task dicts with id/domain/userGoal
 *   swe-bench-lite/<split>/*.json — SWE-bench Lite instance files
 *   gaia/<split>/*.json           — GAIA question files
 *   agentbench/<domain>/*.json    — AgentBench task files
 *
 * We don't ship the corpora (too large + HF auth). `scripts/download-corpora.sh`
 * fetches them.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface CorpusLoaderOptions {
  readonly corpusDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Max tasks to return (useful for regression tier). */
  readonly limit?: number;
}

export async function resolveCorpusDir(opts: CorpusLoaderOptions = {}): Promise<string> {
  if (opts.corpusDir) return opts.corpusDir;
  const env = opts.env ?? process.env;
  const val = env['HIPP0_EVAL_CORPUS_DIR'];
  if (!val) {
    throw new Error(
      'HIPP0_EVAL_CORPUS_DIR is not set. Run `packages/eval/scripts/download-corpora.sh` first.',
    );
  }
  return val;
}

export async function loadJsonl<T>(filePath: string): Promise<T[]> {
  const raw = await fs.readFile(filePath, 'utf8');
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    out.push(JSON.parse(trimmed) as T);
  }
  return out;
}

export async function loadBenchmark<T>(
  bench: 'tau-bench' | 'swe-bench-lite' | 'gaia' | 'agentbench',
  split: string,
  opts: CorpusLoaderOptions = {},
): Promise<T[]> {
  const root = await resolveCorpusDir(opts);
  const dir = path.join(root, bench, split);
  const entries = await fs.readdir(dir).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`corpus split not found: ${dir} (run scripts/download-corpora.sh)`);
    }
    throw err;
  });
  const out: T[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json') && !name.endsWith('.jsonl')) continue;
    const full = path.join(dir, name);
    if (name.endsWith('.jsonl')) {
      out.push(...(await loadJsonl<T>(full)));
    } else {
      const raw = await fs.readFile(full, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) out.push(item as T);
      } else {
        out.push(parsed as T);
      }
    }
    if (opts.limit && out.length >= opts.limit) return out.slice(0, opts.limit);
  }
  return out;
}

export async function assertCorpusHealthy(opts: CorpusLoaderOptions = {}): Promise<{
  readonly perBenchmark: Readonly<Record<string, number>>;
  readonly total: number;
}> {
  const root = await resolveCorpusDir(opts);
  const benches = ['tau-bench', 'swe-bench-lite', 'gaia', 'agentbench'] as const;
  const perBenchmark: Record<string, number> = {};
  for (const b of benches) {
    const dir = path.join(root, b);
    try {
      const splits = await fs.readdir(dir);
      let count = 0;
      for (const s of splits) {
        try {
          const files = await fs.readdir(path.join(dir, s));
          count += files.filter((f) => f.endsWith('.json') || f.endsWith('.jsonl')).length;
        } catch {
          /* ignore non-dirs */
        }
      }
      perBenchmark[b] = count;
    } catch {
      perBenchmark[b] = 0;
    }
  }
  const total = Object.values(perBenchmark).reduce((a, b) => a + b, 0);
  return { perBenchmark, total };
}
