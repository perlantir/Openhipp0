/**
 * End-to-end scenario: `hipp0 init <name> --non-interactive` produces a
 * valid config that readConfig() can load back. Runs against an in-memory
 * filesystem so nothing hits real disk.
 */

import { describe, it, expect } from 'vitest';
import { runInit, readConfig, type FileSystem } from '@openhipp0/cli';

/** Minimal in-memory FileSystem for the test — matches the contract in @openhipp0/cli. */
function createMemoryFs(initial: Record<string, string> = {}): FileSystem {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    async readFile(path) {
      const v = store.get(path);
      if (v === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      return v;
    },
    async writeFile(path, content) {
      store.set(path, content);
    },
    async mkdir(_path, _opts) {
      /* no-op — the flat map doesn't model directories */
    },
    async exists(path) {
      return store.has(path);
    },
  };
}

describe('E2E — hipp0 init --non-interactive', () => {
  it('creates a config that the CLI can subsequently read', async () => {
    const fs = createMemoryFs();
    const configPath = '/tmp/hipp0/config.json';

    const result = await runInit({
      name: 'e2e-project',
      nonInteractive: true,
      filesystem: fs,
      configPath,
    });

    expect(result.exitCode).toBe(0);

    const cfg = await readConfig(configPath, fs);
    expect(cfg.project.name).toBe('e2e-project');
    expect(cfg.llm.provider).toBe('anthropic');
    expect(cfg.bridges).toEqual(['web', 'cli']);
    expect(cfg.database.type).toBe('sqlite');
  });

  it('rejects non-interactive mode without a name', async () => {
    const fs = createMemoryFs();
    await expect(
      runInit({ nonInteractive: true, filesystem: fs, configPath: '/tmp/hipp0/config.json' }),
    ).rejects.toThrow(/project name required/i);
  });
});
