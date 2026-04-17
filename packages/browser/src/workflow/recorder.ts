/**
 * Recorder — programmatic step capture.
 *
 * Production wires this to CDP Input events; this module just holds the
 * accumulator + the `Workflow` builder. Callers push `RecordedStep`s as
 * they observe browser interactions.
 */

import { WORKFLOW_SCHEMA_VERSION, type RecordedStep, type Workflow, type WorkflowParameter } from './types.js';

export interface RecorderOptions {
  readonly name: string;
  readonly description?: string;
  readonly now?: () => string;
}

export class Recorder {
  readonly #name: string;
  readonly #description: string | undefined;
  readonly #now: () => string;
  readonly #steps: RecordedStep[] = [];
  readonly #parameters = new Map<string, WorkflowParameter>();

  constructor(opts: RecorderOptions) {
    this.#name = opts.name;
    this.#description = opts.description;
    this.#now = opts.now ?? (() => new Date().toISOString());
  }

  parameter(param: WorkflowParameter): void {
    this.#parameters.set(param.name, param);
  }

  push(step: Omit<RecordedStep, 'at'>): void {
    this.#steps.push({ ...step, at: this.#now() });
  }

  navigate(url: string, meta?: Record<string, unknown>): void {
    this.push({ kind: 'navigate', url, ...(meta ? { meta } : {}) });
  }

  click(target: string, labelAtRecord?: string, roleAtRecord?: string): void {
    this.push({
      kind: 'click',
      target,
      ...(labelAtRecord ? { labelAtRecord } : {}),
      ...(roleAtRecord ? { roleAtRecord } : {}),
    });
  }

  type(target: string, value: string, labelAtRecord?: string): void {
    this.push({
      kind: 'type',
      target,
      value,
      ...(labelAtRecord ? { labelAtRecord } : {}),
    });
  }

  select(target: string, value: string): void {
    this.push({ kind: 'select', target, value });
  }

  scroll(deltaY: number): void {
    this.push({ kind: 'scroll', magnitude: deltaY });
  }

  wait(ms: number): void {
    this.push({ kind: 'wait', magnitude: ms });
  }

  extract(target?: string): void {
    this.push({ kind: 'extract', ...(target ? { target } : {}) });
  }

  build(): Workflow {
    return {
      version: WORKFLOW_SCHEMA_VERSION,
      name: this.#name,
      ...(this.#description ? { description: this.#description } : {}),
      createdAt: this.#now(),
      parameters: [...this.#parameters.values()],
      steps: [...this.#steps],
    };
  }
}

/** Replace `${paramName}` with supplied values. Leaves unmatched refs intact. */
export function substituteParameters(
  text: string | undefined,
  params: Readonly<Record<string, string>>,
): string | undefined {
  if (!text) return text;
  return text.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? params[key]! : match,
  );
}
