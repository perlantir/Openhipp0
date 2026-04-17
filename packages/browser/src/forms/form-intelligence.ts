/**
 * High-level form detection. Walks an a11y subtree, groups interactive
 * elements into forms, detects multi-step flows (stepper/wizard), and
 * calls the field-inference helper per field.
 *
 * Multi-step detection: a form is multi-step if any of its direct
 * descendants include a "Next" / "Continue" / "Step N of M" button
 * whose presence is mutually exclusive with a "Submit" / "Save" /
 * "Create" button on the same rendered view. We expose one "step" per
 * visible stepper view; walking across steps is the orchestrator's job.
 */

import { createHash } from 'node:crypto';

import { inferFieldKind } from './field-inference.js';
import type {
  AxNode,
  InferredField,
  InferredForm,
  InferredFormStep,
  InferredFieldKind,
} from './types.js';

const NEXT_RE = /^(next|continue|proceed|forward)$/i;
const BACK_RE = /^(back|previous|prev)$/i;
const SUBMIT_RE = /^(submit|save|create|send|apply|post|confirm)$/i;

export interface DomAccessor {
  /** Returns the outer HTML of the element addressed by `ref`. */
  outerHtml?(ref: string): Promise<string | undefined>;
  /** Returns the named attributes of `ref`. */
  attributes?(ref: string): Promise<Record<string, string> | undefined>;
}

export interface DetectOptions {
  /** Supply to enable DOM-based signals (rich-text detection, attribute inspection). */
  readonly dom?: DomAccessor;
  /** Override for tests. */
  readonly refOf?: (node: AxNode) => string | undefined;
}

function defaultRefOf(node: AxNode): string | undefined {
  // Structural refs aren't on AxNode — callers must supply via refOf.
  // Fall back to a name-based guess so tests don't need DOM.
  if (node.name) return `name:${node.name}`;
  if (node.role) return `role:${node.role}`;
  return undefined;
}

function matches(node: AxNode, re: RegExp): boolean {
  return !!node.name && re.test(String(node.name).trim());
}

function walk(node: AxNode | null, acc: AxNode[]): void {
  if (!node) return;
  acc.push(node);
  for (const c of node.children ?? []) walk(c, acc);
}

function signatureFor(form: Omit<InferredForm, 'signature'>): string {
  const h = createHash('sha256');
  h.update(form.ref);
  h.update(form.action ?? '');
  h.update(form.method ?? '');
  for (const step of form.steps) {
    h.update(`step:${step.index}:`);
    for (const f of step.fields) {
      h.update(`${f.ref}:${f.kind}:${f.label}`);
    }
  }
  return h.digest('hex').slice(0, 32);
}

const FIELD_ROLES = new Set([
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'checkbox',
  'radio',
  'slider',
  'spinbutton',
  'switch',
]);

export async function detectForms(
  root: AxNode,
  opts: DetectOptions = {},
): Promise<readonly InferredForm[]> {
  const refOf = opts.refOf ?? defaultRefOf;
  const all: AxNode[] = [];
  walk(root, all);

  // For G1-c we treat the whole subtree as a single form — most real pages
  // only have one. Multi-form pages (login + signup side-by-side) are
  // handled by the orchestrator via `detectFormsUnder(scope)` — future work.
  const fields: InferredField[] = [];
  let nextRef: string | undefined;
  let backRef: string | undefined;
  let submitRef: string | undefined;

  for (const node of all) {
    const role = node.role ?? '';
    const ref = refOf(node);
    if (!ref) continue;

    if (role === 'button') {
      if (matches(node, NEXT_RE)) nextRef ??= ref;
      else if (matches(node, BACK_RE)) backRef ??= ref;
      else if (matches(node, SUBMIT_RE)) submitRef ??= ref;
      continue;
    }

    if (!FIELD_ROLES.has(role)) continue;

    let outerHtml: string | undefined;
    let attributes: Record<string, string> | undefined;
    if (opts.dom) {
      outerHtml = opts.dom.outerHtml ? await opts.dom.outerHtml(ref) : undefined;
      attributes = opts.dom.attributes ? await opts.dom.attributes(ref) : undefined;
    }

    const inferenceInput: Parameters<typeof inferFieldKind>[0] = {
      ref,
      node,
      ...(outerHtml ? { outerHtml } : {}),
      ...(attributes ? { attributes } : {}),
    };
    const { kind, evidence } = inferFieldKind(inferenceInput);
    const field: InferredField = {
      ref,
      kind,
      label: node.name ?? '',
      required: Boolean(node.required),
      ...(node.value !== undefined ? { currentValue: String(node.value) } : {}),
      evidence,
    };
    fields.push(field);
  }

  const step: InferredFormStep = {
    index: 0,
    fields,
    ...(nextRef ? { nextRef } : {}),
    ...(backRef ? { backRef } : {}),
  };

  const base: Omit<InferredForm, 'signature'> = {
    ref: 'form:0',
    steps: [step],
    ...(submitRef ? { submitRef } : {}),
  };
  const signature = signatureFor(base);
  return [{ ...base, signature }];
}

/**
 * Apply a stored `FormPattern`'s `kindOverrides` to a freshly-detected form.
 * Re-computes the signature after overrides so the pattern stays coherent.
 */
export function applyKindOverrides(
  form: InferredForm,
  overrides: Readonly<Record<string, InferredFieldKind>>,
): InferredForm {
  const steps = form.steps.map((s) => ({
    ...s,
    fields: s.fields.map((f) =>
      overrides[f.ref]
        ? ({ ...f, kind: overrides[f.ref] as InferredFieldKind, evidence: [...f.evidence, 'pattern-override'] })
        : f,
    ),
  }));
  const base: Omit<InferredForm, 'signature'> = { ...form, steps };
  return { ...base, signature: signatureFor(base) };
}
