/**
 * Adapter: wrap a Hipp0 Tool<P> so it registers cleanly on an MCP McpServer.
 *
 * Strategy:
 *   - The Hipp0 Tool already owns a Zod validator (raw schema → P); we reuse
 *     its .shape so MCP's `inputSchema` gets the same shape the tool itself
 *     expects.
 *   - Errors are formatted into MCP's error content so the LLM client sees
 *     them as tool errors rather than protocol faults.
 *
 * Shell / filesystem / web tools use the Hipp0 ExecutionContext supplied by
 * the caller so the MCP transport inherits the same allow-lists the host
 * process would apply.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { tools as coreTools } from '@openhipp0/core';

type ExecutionContext = coreTools.ExecutionContext;
type Tool<P> = coreTools.Tool<P>;

export interface ToolAdapterOptions<P> {
  tool: Tool<P>;
  execContext: Omit<ExecutionContext, 'agent' | 'projectId'>;
  agent: { id: string; name: string; role: string };
  projectId: string;
  /** Rename the MCP tool. Defaults to tool.name. */
  mcpName?: string;
}

export function registerHipp0Tool<P extends Record<string, unknown>>(
  server: McpServer,
  opts: ToolAdapterOptions<P>,
): void {
  const { tool, execContext, agent, projectId, mcpName } = opts;
  const shape = extractZodShape(tool.validator);

  server.registerTool(
    mcpName ?? tool.name,
    {
      description: tool.description,
      ...(shape ? { inputSchema: shape } : {}),
    },
    async (input: unknown) => {
      try {
        const result = await tool.execute(input as P, {
          ...execContext,
          agent,
          projectId,
        });
        if (!result.ok) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `${result.errorCode ?? 'HIPP0_TOOL_ERROR'}: ${result.output}`,
              },
            ],
          };
        }
        return { content: [{ type: 'text', text: String(result.output ?? '') }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text', text: `exception: ${msg}` }] };
      }
    },
  );
}

/**
 * Zod objects expose their field map via `.shape`; Zod wrappers (`.default`,
 * `.optional`) don't. If the validator isn't a plain object schema, return
 * undefined — the MCP tool is registered schema-less and the Hipp0 tool's
 * own validator still runs on execute().
 */
function extractZodShape(validator: Tool<unknown>['validator']): z.ZodRawShape | undefined {
  const unwrapped = unwrap(validator);
  if (unwrapped instanceof z.ZodObject) {
    return unwrapped.shape as z.ZodRawShape;
  }
  return undefined;
}

function unwrap(s: unknown): z.ZodTypeAny | undefined {
  let cur = s as z.ZodTypeAny | undefined;
  for (let i = 0; i < 8 && cur; i++) {
    const def = (cur as unknown as { _def?: { innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny } })
      ._def;
    const inner = def?.innerType ?? def?.schema;
    if (!inner) return cur;
    cur = inner;
  }
  return cur;
}
