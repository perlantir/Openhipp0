/**
 * Linear integration — uses Linear's GraphQL API.
 *
 *   linear_list_issues   → viewer.assignedIssues (or a team filter)
 *   linear_create_issue  → issueCreate mutation
 *
 * Auth: OAuth2 (LINEAR provider) or a personal API key via HIPP0_LINEAR_KEY.
 * Linear passes both via the Authorization header — OAuth2 uses Bearer,
 * personal keys are passed raw.
 */

import { z } from 'zod';
import type { Tool } from '../../tools/types.js';
import type { OAuth2Client } from '../../auth/index.js';
import { fetchWithRetry } from '../http.js';

const API = 'https://api.linear.app/graphql';

export interface LinearConfig {
  oauth?: OAuth2Client;
  account?: string;
  apiKey?: string;
}

async function authHeaderValue(cfg: LinearConfig): Promise<string> {
  if (cfg.oauth && cfg.account) {
    const tok = await cfg.oauth.getAccessToken(cfg.account);
    return `Bearer ${tok}`;
  }
  const k = cfg.apiKey ?? process.env['HIPP0_LINEAR_KEY'];
  if (!k) throw new Error('Linear: no OAuth client + no HIPP0_LINEAR_KEY');
  return k;
}

async function gql(
  cfg: LinearConfig,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<Response> {
  const auth = await authHeaderValue(cfg);
  return fetchWithRetry(() =>
    fetch(API, {
      method: 'POST',
      headers: {
        authorization: auth,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    }),
  );
}

export function createLinearListIssuesTool(cfg: LinearConfig): Tool<{ limit?: number }> {
  return {
    name: 'linear_list_issues',
    description: "List issues assigned to the authenticated Linear user.",
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
    },
    validator: z.object({ limit: z.number().int().min(1).max(100).optional() }),
    async execute(input) {
      const query = `
        query($first: Int!) {
          viewer {
            assignedIssues(first: $first) {
              nodes {
                id
                identifier
                title
                state { name type }
                priority
                url
              }
            }
          }
        }
      `;
      try {
        const resp = await gql(cfg, query, { first: input.limit ?? 25 });
        if (!resp.ok) {
          return { ok: false, output: `Linear ${resp.status}`, errorCode: 'HIPP0_LINEAR_HTTP' };
        }
        return { ok: true, output: await resp.text() };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, output: msg, errorCode: 'HIPP0_LINEAR_ERR' };
      }
    },
  };
}

export function createLinearCreateIssueTool(cfg: LinearConfig): Tool<{
  teamId: string;
  title: string;
  description?: string;
}> {
  return {
    name: 'linear_create_issue',
    description: 'Create a new Linear issue in the given team.',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['teamId', 'title'],
      properties: {
        teamId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
      },
    },
    validator: z.object({
      teamId: z.string().min(1),
      title: z.string().min(1),
      description: z.string().optional(),
    }),
    async execute(input) {
      const query = `
        mutation($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue { id identifier url }
          }
        }
      `;
      try {
        const resp = await gql(cfg, query, { input });
        if (!resp.ok) {
          return { ok: false, output: `Linear ${resp.status}`, errorCode: 'HIPP0_LINEAR_HTTP' };
        }
        return { ok: true, output: await resp.text() };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, output: msg, errorCode: 'HIPP0_LINEAR_ERR' };
      }
    },
  };
}
