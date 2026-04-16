/**
 * CLI-wide types: command result envelope + error class.
 *
 * Commands are pure-ish functions that return a CommandResult. The top-level
 * commander wiring in index.ts translates the result into console output +
 * process exit code. This shape lets every command be unit-tested without
 * spawning a child process or stubbing process.exit.
 */

import { z } from 'zod';

export interface CommandResult {
  /** Exit code: 0 = success, non-zero = failure. */
  exitCode: number;
  /** Human-readable lines to print on stdout. */
  stdout?: string[];
  /** Human-readable lines to print on stderr. */
  stderr?: string[];
  /** Structured payload (available on stdout as JSON when --json is passed). */
  data?: unknown;
}

export class Hipp0CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  constructor(message: string, code = 'HIPP0_CLI_ERROR', exitCode = 1) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.exitCode = exitCode;
  }
}

/**
 * Persisted ~/.hipp0/config.json shape.
 *
 * The CLI is intentionally conservative here — only fields we actually read/
 * write today are defined. Fields are optional to keep old configs forward-
 * compatible when we add new features.
 */
export const Hipp0ConfigSchema = z.object({
  project: z
    .object({
      name: z.string().min(1),
      createdAt: z.string(),
    })
    .optional(),
  llm: z
    .object({
      provider: z.enum(['anthropic', 'openai', 'ollama']),
      model: z.string().optional(),
    })
    .optional(),
  bridges: z.array(z.enum(['discord', 'telegram', 'slack', 'web', 'cli'])).optional(),
  database: z
    .object({
      /** 'sqlite' uses ~/.hipp0/hipp0.db; 'postgres' expects DATABASE_URL env. */
      type: z.enum(['sqlite', 'postgres']),
    })
    .optional(),
  agents: z
    .array(
      z.object({
        name: z.string().min(1),
        domain: z.string().default(''),
        skills: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  cronTasks: z
    .array(
      z.object({
        id: z.string().min(1),
        schedule: z.string().min(1),
        description: z.string().default(''),
        enabled: z.boolean().default(true),
      }),
    )
    .default([]),
});

export type Hipp0Config = z.infer<typeof Hipp0ConfigSchema>;

/** Async prompt function — injected in tests to provide canned answers. */
export type PromptFn = (question: string) => Promise<string>;
