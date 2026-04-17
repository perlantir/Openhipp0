import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { buildConfigRoutes } from '../../src/commands/serve.js';
import { buildApiAuth } from '../../src/commands/api-auth.js';

function findRoute(
  routes: readonly { method: string; path: string; handler: (...args: unknown[]) => unknown }[],
  method: string,
  p: string,
) {
  const r = routes.find((x) => x.method === method && x.path === p);
  if (!r) throw new Error(`route ${method} ${p} not found`);
  return r;
}

describe('POST /api/config/llm', () => {
  let dir: string;
  let envPath: string;
  let configPath: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'hipp0-config-route-'));
    envPath = path.join(dir, '.env');
    configPath = path.join(dir, 'config.json');
    env = {} as NodeJS.ProcessEnv;
    await fs.writeFile(
      configPath,
      JSON.stringify({ project: { name: 'test', createdAt: new Date().toISOString() } }, null, 2),
    );
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function makeRoutes(opts: { reloader?: (next: readonly unknown[]) => void } = {}) {
    return buildConfigRoutes(buildApiAuth({}), {
      agentReloadProviders: opts.reloader as never,
      paths: { envPath, configPath },
      env,
    });
  }

  it('rejects invalid body with 400 + issues array', async () => {
    const routes = makeRoutes();
    const h = findRoute(routes, 'POST', '/api/config/llm').handler;
    const res = (await h({ params: {}, query: {}, body: { provider: 'nope' } })) as {
      status?: number;
      body: { error: string; issues: unknown };
    };
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid body');
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('persists provider + model to config.json and returns the new shape', async () => {
    const routes = makeRoutes();
    const h = findRoute(routes, 'POST', '/api/config/llm').handler;
    const res = (await h({
      params: {},
      query: {},
      body: { provider: 'openai', model: 'gpt-4o-mini' },
    })) as { body: { ok: boolean; llm: { provider: string; model?: string } } };
    expect(res.body.ok).toBe(true);
    expect(res.body.llm.provider).toBe('openai');
    expect(res.body.llm.model).toBe('gpt-4o-mini');
    const saved = JSON.parse(await fs.readFile(configPath, 'utf8'));
    expect(saved.llm.provider).toBe('openai');
    expect(saved.llm.model).toBe('gpt-4o-mini');
  });

  it('writes the api key to .env (mode 600) and updates process.env proxy', async () => {
    const routes = makeRoutes();
    const h = findRoute(routes, 'POST', '/api/config/llm').handler;
    await h({
      params: {},
      query: {},
      body: { provider: 'anthropic', apiKey: 'sk-ant-api03-xxxxxxxxxxxxxxxxx' },
    });
    const envContent = await fs.readFile(envPath, 'utf8');
    expect(envContent).toContain('ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxx');
    const stat = await fs.stat(envPath);
    expect((stat.mode & 0o777).toString(8)).toBe('600');
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant-api03-xxxxxxxxxxxxxxxxx');
  });

  it('calls agentReloadProviders with providers derived from new config', async () => {
    const calls: unknown[][] = [];
    const routes = makeRoutes({
      reloader: (next) => {
        calls.push([...next]);
      },
    });
    const h = findRoute(routes, 'POST', '/api/config/llm').handler;
    const res = (await h({
      params: {},
      query: {},
      body: {
        provider: 'anthropic',
        apiKey: 'sk-ant-api03-abcdefghijklmnopqrs',
        model: 'claude-sonnet-4-6',
      },
    })) as { body: { hotSwapped: boolean } };
    expect(res.body.hotSwapped).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([{ type: 'anthropic', model: 'claude-sonnet-4-6' }]);
  });

  it('does not call reloader when no key is in env (no ladder to build)', async () => {
    const calls: unknown[][] = [];
    const routes = makeRoutes({
      reloader: (next) => {
        calls.push([...next]);
      },
    });
    const h = findRoute(routes, 'POST', '/api/config/llm').handler;
    await h({ params: {}, query: {}, body: { provider: 'openai', model: 'gpt-4o-mini' } });
    expect(calls).toHaveLength(0);
  });

  it('silently drops apiKey for ollama (local, no key)', async () => {
    const routes = makeRoutes();
    const h = findRoute(routes, 'POST', '/api/config/llm').handler;
    const res = (await h({
      params: {},
      query: {},
      body: { provider: 'ollama', apiKey: 'ignored-because-local' },
    })) as { body: { apiKeyUpdated: boolean } };
    expect(res.body.apiKeyUpdated).toBe(false);
    const envExists = await fs.stat(envPath).catch(() => null);
    expect(envExists).toBeNull();
  });

  it('returns 500 when reloader throws (bad ladder)', async () => {
    env['ANTHROPIC_API_KEY'] = 'x';
    const routes = makeRoutes({
      reloader: () => {
        throw new Error('ladder rejected: deprecated model');
      },
    });
    const h = findRoute(routes, 'POST', '/api/config/llm').handler;
    const res = (await h({
      params: {},
      query: {},
      body: { provider: 'anthropic', model: 'claude-deprecated' },
    })) as { status?: number; body: { error: string; detail: string } };
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('reload failed');
    expect(res.body.detail).toMatch(/deprecated/);
  });
});
