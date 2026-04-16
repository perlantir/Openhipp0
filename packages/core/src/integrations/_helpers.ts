/**
 * Phase 17 integration helpers — small utilities shared across the 15
 * new skill integrations (Outlook, Google Calendar, Todoist, etc.) to
 * keep each tool file under ~120 lines.
 */

import type { ToolResult } from '../tools/types.js';

export function httpErr(service: string, resp: Response, body?: string): ToolResult {
  return {
    ok: false,
    output: `${service} ${resp.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
    errorCode: `HIPP0_${service.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_HTTP`,
  };
}

export function missingKey(service: string, envVar: string): ToolResult {
  return {
    ok: false,
    output: `${service}: no API key (set ${envVar}).`,
    errorCode: `HIPP0_${service.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_NO_KEY`,
  };
}

export async function runSafely<T>(
  service: string,
  fn: () => Promise<T>,
): Promise<ToolResult & { result?: T }> {
  try {
    const result = await fn();
    return { ok: true, output: typeof result === 'string' ? result : JSON.stringify(result), result };
  } catch (err) {
    return {
      ok: false,
      output: err instanceof Error ? err.message : String(err),
      errorCode: `HIPP0_${service.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_ERR`,
    };
  }
}
