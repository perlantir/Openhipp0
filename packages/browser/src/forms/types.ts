/**
 * Form-intelligence contracts. Shape is heuristic-over-a11y-tree.
 */

import type { browser } from '@openhipp0/core';

export type InferredFieldKind =
  | 'text'
  | 'email'
  | 'password'
  | 'search'
  | 'url'
  | 'phone'
  | 'number'
  | 'date'
  | 'datetime'
  | 'time'
  | 'datepicker' // role=textbox + aria-haspopup=dialog + date-shaped value
  | 'file'
  | 'checkbox'
  | 'radio'
  | 'select'
  | 'slider'
  | 'color'
  | 'masked'
  | 'rich-text-tinymce'
  | 'rich-text-ckeditor'
  | 'rich-text-quill'
  | 'rich-text-draftjs'
  | 'map-pin'
  | 'unknown';

export interface InferredField {
  readonly ref: string;
  readonly kind: InferredFieldKind;
  readonly label: string;
  readonly required: boolean;
  readonly currentValue?: string;
  readonly options?: readonly string[]; // for select/radio
  readonly min?: number;
  readonly max?: number;
  /** Evidence for future debugging. */
  readonly evidence: readonly string[];
}

export interface InferredFormStep {
  readonly index: number;
  readonly label?: string;
  readonly fields: readonly InferredField[];
  /** Selector / ref for the "Next" button. */
  readonly nextRef?: string;
  /** Selector / ref for the "Back" button. */
  readonly backRef?: string;
}

export interface InferredForm {
  readonly ref: string;
  readonly action?: string;
  readonly method?: string;
  readonly steps: readonly InferredFormStep[];
  readonly submitRef?: string;
  /** Stable hash for pattern-store lookups. */
  readonly signature: string;
}

export interface ValidationError {
  readonly fieldRef: string;
  readonly message: string;
  /** `aria-invalid`, `role=alert`, `aria-live=assertive`, `.error-text`, `.invalid-feedback`. */
  readonly source: string;
}

export interface FormDraft {
  readonly signature: string;
  readonly url: string;
  readonly values: Readonly<Record<string, string>>;
  readonly savedAt: string;
}

/** Pattern recorded after a successful fill-and-submit. */
export interface FormPattern {
  readonly signature: string;
  readonly host: string;
  readonly pathPrefix: string;
  /** Ordered step count. */
  readonly stepCount: number;
  /** How many successful applications. */
  readonly timesConfirmed: number;
  readonly lastSeenAt: string;
  /** Field-inference overrides — map from `ref` to InferredFieldKind. */
  readonly kindOverrides: Readonly<Record<string, InferredFieldKind>>;
}

// Re-export so consumers can wire a11y types.
export type AxNode = browser.AxNode;
