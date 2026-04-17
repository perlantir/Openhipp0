/**
 * Read validation state from the current page — aria-invalid, aria-errormessage,
 * role=alert/aria-live=assertive neighbors, and common class signatures
 * (`.error`, `.invalid-feedback`, `.field-error`, `.ant-form-item-explain-error`).
 */

import type { AxNode, ValidationError } from './types.js';

export interface ValidationProbe {
  /** Returns true when the element has aria-invalid=true. */
  isInvalid?(ref: string): Promise<boolean>;
  /** Returns the accessible error text attached to the field (aria-errormessage / describedby). */
  errorTextFor?(ref: string): Promise<string | undefined>;
  /** Returns visible alerts (role=alert / aria-live=assertive) on the page. */
  readAlerts?(): Promise<readonly { message: string; sourceRef?: string }[]>;
  /** Returns visible text matching common error class signatures near `ref`. */
  classBasedErrorFor?(ref: string): Promise<string | undefined>;
}

export async function collectValidationErrors(
  fieldsByRef: readonly { ref: string; label: string; node?: AxNode }[],
  probe: ValidationProbe,
): Promise<readonly ValidationError[]> {
  const out: ValidationError[] = [];
  for (const f of fieldsByRef) {
    if (probe.isInvalid && (await probe.isInvalid(f.ref))) {
      const aria = probe.errorTextFor ? await probe.errorTextFor(f.ref) : undefined;
      if (aria) {
        out.push({ fieldRef: f.ref, message: aria, source: 'aria-invalid' });
        continue;
      }
    }
    if (probe.classBasedErrorFor) {
      const classErr = await probe.classBasedErrorFor(f.ref);
      if (classErr) {
        out.push({ fieldRef: f.ref, message: classErr, source: 'class-signature' });
        continue;
      }
    }
    // Fallback: check the field's own a11y description for aria-invalid hints.
    if (f.node?.invalid && f.node.invalid !== 'false') {
      out.push({
        fieldRef: f.ref,
        message: String(f.node.description ?? `${f.label} is invalid`),
        source: 'ax-invalid',
      });
    }
  }
  // Page-level alerts (e.g. toast errors with no field attribution).
  if (probe.readAlerts) {
    const alerts = await probe.readAlerts();
    for (const a of alerts) {
      out.push({
        fieldRef: a.sourceRef ?? 'page',
        message: a.message,
        source: 'aria-live-alert',
      });
    }
  }
  return out;
}

export interface SuggestionContext {
  readonly field: { ref: string; label: string; kind: string };
  readonly error: ValidationError;
}

/**
 * Heuristic: given an error message, produce a hint describing what a caller
 * should change (LLM-powered repair is orchestrator territory; this just
 * classifies the category so a higher layer can decide what to do).
 */
export function classifyValidationMessage(message: string): string {
  const msg = message.toLowerCase();
  if (msg.includes('required')) return 'required-missing';
  if (msg.includes('invalid email') || msg.includes('email address')) return 'invalid-email';
  if (msg.includes('match') || msg.includes('confirm')) return 'must-match';
  if (msg.includes('password')) return 'password-rule';
  if (msg.includes('too long')) return 'too-long';
  if (msg.includes('too short') || msg.includes('minimum')) return 'too-short';
  if (msg.includes('format') || msg.includes('pattern')) return 'format-mismatch';
  return 'unclassified';
}
