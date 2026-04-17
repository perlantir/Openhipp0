import { describe, expect, it } from 'vitest';

import { applyKindOverrides, detectForms } from '../../src/forms/form-intelligence.js';
import type { AxNode } from '../../src/forms/types.js';

function tree(children: AxNode[]): AxNode {
  return { role: 'form', children };
}

describe('detectForms', () => {
  it('collects textbox/combobox/checkbox fields and returns a signed form', async () => {
    const ax = tree([
      { role: 'textbox', name: 'Email' },
      { role: 'textbox', name: 'Password' },
      { role: 'checkbox', name: 'Remember me' },
      { role: 'button', name: 'Submit' },
    ]);
    const forms = await detectForms(ax);
    expect(forms).toHaveLength(1);
    expect(forms[0]!.signature).toMatch(/^[a-f0-9]{32}$/);
    expect(forms[0]!.submitRef).toBeTruthy();
    expect(forms[0]!.steps[0]!.fields).toHaveLength(3);
  });

  it('detects next / back / submit buttons by label', async () => {
    const ax = tree([
      { role: 'textbox', name: 'First' },
      { role: 'button', name: 'Continue' },
      { role: 'button', name: 'Back' },
      { role: 'button', name: 'Save' },
    ]);
    const forms = await detectForms(ax);
    const step = forms[0]!.steps[0]!;
    expect(step.nextRef).toBeTruthy();
    expect(step.backRef).toBeTruthy();
    expect(forms[0]!.submitRef).toBeTruthy();
  });

  it('applyKindOverrides updates field kinds and re-signs', async () => {
    const ax = tree([{ role: 'textbox', name: 'Birthday' }]);
    const forms = await detectForms(ax);
    const field = forms[0]!.steps[0]!.fields[0]!;
    const next = applyKindOverrides(forms[0]!, { [field.ref]: 'datepicker' });
    expect(next.steps[0]!.fields[0]!.kind).toBe('datepicker');
    expect(next.signature).not.toBe(forms[0]!.signature);
  });

  it('calls DOM accessor when provided for rich-text detection', async () => {
    const ax = tree([{ role: 'textbox', name: 'Body' }]);
    const outer = '<div class="ql-editor">content</div>';
    const forms = await detectForms(ax, {
      dom: { async outerHtml() { return outer; } },
    });
    expect(forms[0]!.steps[0]!.fields[0]!.kind).toBe('rich-text-quill');
  });
});
