/**
 * Classify a field's kind from its a11y + DOM signals.
 *
 * Inputs: an AxNode subtree (from `page.accessibility.snapshot`) and an
 * optional HTML blob of the immediate surrounding DOM (caller passes
 * `getOuterHtml(ref)` if they want rich-text detection). Signals:
 *
 *   - role: primary discriminator (textbox / button / checkbox / …)
 *   - ariaHaspopup: textbox + aria-haspopup=dialog suggests datepicker
 *   - value shape: `\d{4}-\d{2}-\d{2}` with textbox → date
 *   - autocomplete attr: email / tel / current-password → email / phone / password
 *   - data-testid / class names: tinymce / ckeditor / quill / draft-js
 *   - input[type]: date / email / password / search / url / tel / number / file / color / range
 *
 * When unsure → 'text'.
 */

import type { AxNode, InferredFieldKind } from './types.js';

export interface InferenceInput {
  readonly ref: string;
  readonly node: AxNode;
  /** Optional DOM blob for the node + descendants. Enables rich-text detection. */
  readonly outerHtml?: string;
  /** Optional attributes map: autocomplete, inputmode, type, etc. */
  readonly attributes?: Readonly<Record<string, string>>;
}

export interface InferenceResult {
  readonly kind: InferredFieldKind;
  readonly evidence: readonly string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/;
const TIME_RE = /^\d{2}:\d{2}(?::\d{2})?$/;

export function inferFieldKind(input: InferenceInput): InferenceResult {
  const evidence: string[] = [];
  const node = input.node;
  const attrs = input.attributes ?? {};
  const push = (s: string): void => {
    evidence.push(s);
  };

  // Rich-text editors are often a contenteditable div; a11y role may be
  // 'textbox' but the real behavior is rich. Key off the surrounding DOM.
  if (input.outerHtml) {
    const html = input.outerHtml;
    if (/class="[^"]*ql-editor/.test(html) || /data-testid="quill-editor"/.test(html)) {
      push('quill signature');
      return { kind: 'rich-text-quill', evidence };
    }
    if (/cke_editable|cke_contents/.test(html) || /\bdata-ckeditor\b/.test(html)) {
      push('ckeditor signature');
      return { kind: 'rich-text-ckeditor', evidence };
    }
    if (/\btox-edit-area|\btinymce\b/.test(html)) {
      push('tinymce signature');
      return { kind: 'rich-text-tinymce', evidence };
    }
    if (/class="[^"]*DraftEditor-editorContainer|public-DraftEditor-content/.test(html)) {
      push('draft-js signature');
      return { kind: 'rich-text-draftjs', evidence };
    }
    if (/leaflet-container|gm-style|mapboxgl-map/.test(html)) {
      push('map container signature');
      return { kind: 'map-pin', evidence };
    }
  }

  // Input type wins when present and unambiguous.
  const type = (attrs['type'] ?? '').toLowerCase();
  if (type === 'email') return { kind: 'email', evidence: ['type=email'] };
  if (type === 'password') return { kind: 'password', evidence: ['type=password'] };
  if (type === 'search') return { kind: 'search', evidence: ['type=search'] };
  if (type === 'url') return { kind: 'url', evidence: ['type=url'] };
  if (type === 'tel') return { kind: 'phone', evidence: ['type=tel'] };
  if (type === 'number') return { kind: 'number', evidence: ['type=number'] };
  if (type === 'date') return { kind: 'date', evidence: ['type=date'] };
  if (type === 'datetime-local') return { kind: 'datetime', evidence: ['type=datetime-local'] };
  if (type === 'time') return { kind: 'time', evidence: ['type=time'] };
  if (type === 'color') return { kind: 'color', evidence: ['type=color'] };
  if (type === 'range') return { kind: 'slider', evidence: ['type=range'] };
  if (type === 'file') return { kind: 'file', evidence: ['type=file'] };
  if (type === 'checkbox') return { kind: 'checkbox', evidence: ['type=checkbox'] };
  if (type === 'radio') return { kind: 'radio', evidence: ['type=radio'] };

  // Autocomplete attribute.
  const ac = (attrs['autocomplete'] ?? '').toLowerCase();
  if (ac === 'email') return { kind: 'email', evidence: ['autocomplete=email'] };
  if (ac === 'tel') return { kind: 'phone', evidence: ['autocomplete=tel'] };
  if (ac.endsWith('password')) return { kind: 'password', evidence: [`autocomplete=${ac}`] };

  // Role-driven classification.
  const role = node.role ?? '';
  if (role === 'slider') return { kind: 'slider', evidence: ['role=slider'] };
  if (role === 'checkbox') return { kind: 'checkbox', evidence: ['role=checkbox'] };
  if (role === 'radio') return { kind: 'radio', evidence: ['role=radio'] };
  if (role === 'combobox' || role === 'listbox')
    return { kind: 'select', evidence: [`role=${role}`] };

  // Datepicker: textbox + aria-haspopup=dialog + date-shaped value
  if (role === 'textbox' || role === '') {
    const hasDialog = (attrs['aria-haspopup'] ?? '') === 'dialog';
    const value = String(node.value ?? '');
    if (hasDialog && DATE_RE.test(value)) {
      push('textbox + aria-haspopup=dialog + date-shaped value');
      return { kind: 'datepicker', evidence };
    }
    if (DATE_RE.test(value)) return { kind: 'date', evidence: ['date-shaped value'] };
    if (TIME_RE.test(value)) return { kind: 'time', evidence: ['time-shaped value'] };
  }

  // Masked inputs — inputmode or aria-describedby referencing a mask hint.
  const inputMode = (attrs['inputmode'] ?? '').toLowerCase();
  if (inputMode === 'numeric' || inputMode === 'decimal')
    return { kind: 'number', evidence: [`inputmode=${inputMode}`] };
  if (inputMode && inputMode !== 'text') {
    push(`inputmode=${inputMode}`);
    return { kind: 'masked', evidence };
  }

  return { kind: 'text', evidence: ['fallback'] };
}
