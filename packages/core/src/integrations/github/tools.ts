/**
 * GitHub integration — the three most useful calls:
 *   github_search_repos   → search public + private repos
 *   github_list_issues    → list issues in a repo (open/closed/state filter)
 *   github_create_issue   → create an issue in a repo
 *
 * Auth: either a classic PAT / fine-grained PAT via HIPP0_GITHUB_TOKEN, or an
 * OAuth2 access token supplied via the GITHUB provider (see auth/providers.ts).
 * When both are present the explicit config wins.
 */

import { z } from 'zod';
import type { Tool } from '../../tools/types.js';
import { authedFetch, fetchWithRetry } from '../http.js';

const API = 'https://api.github.com';

export interface GitHubConfig {
  /** PAT / OAuth access token. Falls back to HIPP0_GITHUB_TOKEN env. */
  token?: string;
}

function tokenOr(config: GitHubConfig): string | undefined {
  return config.token ?? process.env['HIPP0_GITHUB_TOKEN'];
}

export function createGithubSearchReposTool(config: GitHubConfig = {}): Tool<{ q: string }> {
  return {
    name: 'github_search_repos',
    description: 'Search GitHub repositories.',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['q'],
      properties: { q: { type: 'string' } },
    },
    validator: z.object({ q: z.string().min(1) }),
    async execute(input) {
      const token = tokenOr(config);
      if (!token) {
        return { ok: false, output: 'GitHub token missing', errorCode: 'HIPP0_GITHUB_NO_TOKEN' };
      }
      const resp = await fetchWithRetry(() =>
        authedFetch(`${API}/search/repositories?q=${encodeURIComponent(input.q)}`, {}, { token }),
      );
      if (!resp.ok) {
        return { ok: false, output: `GitHub ${resp.status}: ${await resp.text()}`, errorCode: 'HIPP0_GITHUB_HTTP' };
      }
      return { ok: true, output: await resp.text() };
    },
  };
}

export function createGithubListIssuesTool(config: GitHubConfig = {}): Tool<{
  owner: string;
  repo: string;
  state?: 'open' | 'closed' | 'all';
}> {
  return {
    name: 'github_list_issues',
    description: 'List issues in a GitHub repo.',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['owner', 'repo'],
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' },
      },
    },
    validator: z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      state: z.enum(['open', 'closed', 'all']).optional(),
    }),
    async execute(input) {
      const token = tokenOr(config);
      if (!token) {
        return { ok: false, output: 'GitHub token missing', errorCode: 'HIPP0_GITHUB_NO_TOKEN' };
      }
      const url = `${API}/repos/${input.owner}/${input.repo}/issues?state=${input.state ?? 'open'}`;
      const resp = await fetchWithRetry(() => authedFetch(url, {}, { token }));
      if (!resp.ok) {
        return { ok: false, output: `GitHub ${resp.status}: ${await resp.text()}`, errorCode: 'HIPP0_GITHUB_HTTP' };
      }
      return { ok: true, output: await resp.text() };
    },
  };
}

export function createGithubCreateIssueTool(config: GitHubConfig = {}): Tool<{
  owner: string;
  repo: string;
  title: string;
  body?: string;
  labels?: string[];
}> {
  return {
    name: 'github_create_issue',
    description: 'Create a new issue in a GitHub repo.',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['owner', 'repo', 'title'],
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
      },
    },
    validator: z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      title: z.string().min(1),
      body: z.string().optional(),
      labels: z.array(z.string()).optional(),
    }),
    async execute(input) {
      const token = tokenOr(config);
      if (!token) {
        return { ok: false, output: 'GitHub token missing', errorCode: 'HIPP0_GITHUB_NO_TOKEN' };
      }
      const body = { title: input.title, body: input.body, labels: input.labels };
      const resp = await fetchWithRetry(() =>
        authedFetch(
          `${API}/repos/${input.owner}/${input.repo}/issues`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
          { token },
        ),
      );
      if (!resp.ok) {
        return { ok: false, output: `GitHub ${resp.status}: ${await resp.text()}`, errorCode: 'HIPP0_GITHUB_HTTP' };
      }
      return { ok: true, output: await resp.text() };
    },
  };
}

export const githubSearchReposTool = createGithubSearchReposTool();
export const githubListIssuesTool = createGithubListIssuesTool();
export const githubCreateIssueTool = createGithubCreateIssueTool();
