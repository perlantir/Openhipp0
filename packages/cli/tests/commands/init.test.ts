import { describe, it, expect } from 'vitest';
import { runInit } from '../../src/commands/init.js';
import { Hipp0CliError, type PromptFn } from '../../src/types.js';
import { readConfig } from '../../src/config.js';
import { createMemoryFs } from '../helpers/memory-fs.js';

const CONFIG_PATH = '/tmp/hipp0-test/config.json';

/** Returns a prompt fn that yields the given answers in order. */
function scriptedPrompt(answers: string[]): PromptFn {
  let i = 0;
  return async () => {
    if (i >= answers.length) throw new Error(`prompt exhausted; asked ${i + 1} times`);
    return answers[i++]!;
  };
}

describe('runInit', () => {
  it('non-interactive mode writes default config', async () => {
    const fs = createMemoryFs();
    const result = await runInit({
      name: 'demo',
      nonInteractive: true,
      configPath: CONFIG_PATH,
      filesystem: fs,
    });
    expect(result.exitCode).toBe(0);
    const cfg = await readConfig(CONFIG_PATH, fs);
    expect(cfg.project?.name).toBe('demo');
    expect(cfg.llm?.provider).toBe('anthropic');
    expect(cfg.bridges).toEqual(['web', 'cli']);
    expect(cfg.database?.type).toBe('sqlite');
  });

  it('non-interactive mode requires a name', async () => {
    const fs = createMemoryFs();
    await expect(
      runInit({ nonInteractive: true, configPath: CONFIG_PATH, filesystem: fs }),
    ).rejects.toThrow(/Project name required/);
  });

  it('interactive mode prompts for name + uses answers', async () => {
    const fs = createMemoryFs();
    const prompt = scriptedPrompt(['myproj', 'openai', 'discord,web', 'postgres']);
    const result = await runInit({
      configPath: CONFIG_PATH,
      filesystem: fs,
      prompt,
    });
    expect(result.exitCode).toBe(0);
    const cfg = await readConfig(CONFIG_PATH, fs);
    expect(cfg.project?.name).toBe('myproj');
    expect(cfg.llm?.provider).toBe('openai');
    expect(cfg.bridges).toEqual(['discord', 'web']);
    expect(cfg.database?.type).toBe('postgres');
  });

  it('interactive mode: empty answer keeps default', async () => {
    const fs = createMemoryFs();
    const prompt = scriptedPrompt(['p2', '', '', '']);
    const result = await runInit({ configPath: CONFIG_PATH, filesystem: fs, prompt });
    expect(result.exitCode).toBe(0);
    const cfg = await readConfig(CONFIG_PATH, fs);
    expect(cfg.llm?.provider).toBe('anthropic');
    expect(cfg.bridges).toEqual(['web', 'cli']);
    expect(cfg.database?.type).toBe('sqlite');
  });

  it('rejects unknown provider', async () => {
    const fs = createMemoryFs();
    const prompt = scriptedPrompt(['p3', 'gemini']);
    await expect(
      runInit({ configPath: CONFIG_PATH, filesystem: fs, prompt }),
    ).rejects.toBeInstanceOf(Hipp0CliError);
  });

  it('rejects unknown bridge', async () => {
    const fs = createMemoryFs();
    const prompt = scriptedPrompt(['p4', '', 'signal,web']);
    await expect(runInit({ configPath: CONFIG_PATH, filesystem: fs, prompt })).rejects.toThrow(
      /Unknown bridge/,
    );
  });

  it('refuses to overwrite existing config without --force', async () => {
    const fs = createMemoryFs({ [CONFIG_PATH]: JSON.stringify({ agents: [], cronTasks: [] }) });
    await expect(
      runInit({ name: 'demo', nonInteractive: true, configPath: CONFIG_PATH, filesystem: fs }),
    ).rejects.toThrow(/already exists/);
  });

  it('overwrites existing config with --force', async () => {
    const fs = createMemoryFs({ [CONFIG_PATH]: JSON.stringify({ agents: [], cronTasks: [] }) });
    const result = await runInit({
      name: 'demo',
      force: true,
      nonInteractive: true,
      configPath: CONFIG_PATH,
      filesystem: fs,
    });
    expect(result.exitCode).toBe(0);
  });

  it('rejects empty project name in interactive mode', async () => {
    const fs = createMemoryFs();
    const prompt = scriptedPrompt(['   ']);
    await expect(runInit({ configPath: CONFIG_PATH, filesystem: fs, prompt })).rejects.toThrow(
      /cannot be empty/,
    );
  });
});
