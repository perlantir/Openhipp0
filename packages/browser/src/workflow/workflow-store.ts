/**
 * JSON-on-disk workflow library. One file per workflow at
 * `<root>/<name>.workflow.json`. Files are portable — export/import is
 * literal file copy. No encryption (workflows contain no secrets by
 * design; parameters are supplied at play time).
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type { Workflow } from './types.js';

export interface WorkflowStoreOptions {
  readonly root?: string;
}

function defaultRoot(): string {
  const home = process.env['HIPP0_HOME'];
  const base = home && home.length > 0 ? home : path.join(homedir(), '.hipp0');
  return path.join(base, 'workflows');
}

export class WorkflowStore {
  readonly #root: string;

  constructor(opts: WorkflowStoreOptions = {}) {
    this.#root = opts.root ?? defaultRoot();
  }

  #file(name: string): string {
    if (!/^[a-z0-9_-]+$/i.test(name)) {
      throw new Error(`invalid workflow name: ${name}`);
    }
    return path.join(this.#root, `${name}.workflow.json`);
  }

  async save(workflow: Workflow): Promise<string> {
    await fs.mkdir(this.#root, { recursive: true, mode: 0o700 });
    const file = this.#file(workflow.name);
    await fs.writeFile(file, JSON.stringify(workflow, null, 2), { mode: 0o600 });
    return file;
  }

  async load(name: string): Promise<Workflow | null> {
    try {
      const raw = await fs.readFile(this.#file(name), 'utf8');
      return JSON.parse(raw) as Workflow;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async list(): Promise<readonly string[]> {
    try {
      const entries = await fs.readdir(this.#root);
      return entries
        .filter((e) => e.endsWith('.workflow.json'))
        .map((e) => e.replace(/\.workflow\.json$/, ''));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async delete(name: string): Promise<void> {
    await fs.rm(this.#file(name), { force: true });
  }
}
