/**
 * ConfigCheck — verifies the hipp0 config file exists, parses as JSON, and
 * (optionally) passes a caller-supplied schema validator.
 *
 * The validator is injected (not hard-coded to a specific Zod schema here)
 * because the watchdog package sits below the layer that owns the config
 * shape — keeping that contract on the caller's side avoids a circular
 * dependency and lets each consumer enforce its own schema.
 */

import * as fs from 'node:fs/promises';
import type { HealthCheck, HealthCheckOutput } from '../types.js';

export interface ConfigCheckOptions {
  /** Absolute path to the config file. */
  configPath: string;
  /**
   * Optional validator. Returns null/undefined when valid; an array of issue
   * strings when invalid. Issues surface in the result's `details.issues`.
   */
  validate?: (parsed: unknown) => readonly string[] | null | undefined;
  /** Override the default check name. */
  name?: string;
}

export class ConfigCheck implements HealthCheck {
  readonly name: string;
  readonly description = 'Config file is present, parseable, and schema-valid';
  readonly category = 'config';

  constructor(private readonly opts: ConfigCheckOptions) {
    this.name = opts.name ?? 'config';
  }

  async run(): Promise<HealthCheckOutput> {
    let raw: string;
    try {
      raw = await fs.readFile(this.opts.configPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          status: 'fail',
          message: `Config file not found at ${this.opts.configPath}`,
          details: { configPath: this.opts.configPath },
        };
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return {
        status: 'fail',
        message: `Config file is not valid JSON: ${(err as Error).message}`,
        details: { configPath: this.opts.configPath },
      };
    }

    if (this.opts.validate) {
      const issues = this.opts.validate(parsed);
      if (issues && issues.length > 0) {
        return {
          status: 'fail',
          message: `Config validation failed (${issues.length} issue${issues.length > 1 ? 's' : ''})`,
          details: { configPath: this.opts.configPath, issues },
        };
      }
    }

    return {
      status: 'ok',
      message: `Config OK at ${this.opts.configPath}`,
      details: { configPath: this.opts.configPath },
    };
  }
}
