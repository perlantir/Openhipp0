import { describe, expect, it } from 'vitest';

import { classifyValidationMessage, collectValidationErrors } from '../../src/forms/validation-handler.js';

describe('collectValidationErrors', () => {
  it('surfaces aria-invalid + errorTextFor', async () => {
    const errs = await collectValidationErrors(
      [{ ref: 'email', label: 'Email' }],
      {
        async isInvalid(ref) { return ref === 'email'; },
        async errorTextFor() { return 'Email is required'; },
      },
    );
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toBe('Email is required');
    expect(errs[0]!.source).toBe('aria-invalid');
  });

  it('falls back to class-based signature when aria-invalid is absent', async () => {
    const errs = await collectValidationErrors(
      [{ ref: 'pw', label: 'Password' }],
      {
        async isInvalid() { return false; },
        async classBasedErrorFor() { return 'Too short'; },
      },
    );
    expect(errs[0]!.source).toBe('class-signature');
    expect(errs[0]!.message).toBe('Too short');
  });

  it('includes page-level alerts via readAlerts', async () => {
    const errs = await collectValidationErrors(
      [{ ref: 'name', label: 'Name' }],
      {
        async isInvalid() { return false; },
        async readAlerts() {
          return [{ message: 'Server rejected the submission' }];
        },
      },
    );
    expect(errs).toHaveLength(1);
    expect(errs[0]!.source).toBe('aria-live-alert');
  });

  it('infers from ax.invalid when probe returns no signal', async () => {
    const errs = await collectValidationErrors(
      [{ ref: 'ax1', label: 'Age', node: { invalid: 'true', description: 'Must be 18+' } }],
      {
        async isInvalid() { return false; },
      },
    );
    expect(errs).toHaveLength(1);
    expect(errs[0]!.source).toBe('ax-invalid');
    expect(errs[0]!.message).toBe('Must be 18+');
  });
});

describe('classifyValidationMessage', () => {
  it.each([
    ['Field is required', 'required-missing'],
    ['Enter a valid email address', 'invalid-email'],
    ['Password must contain a number', 'password-rule'],
    ['Value is too short', 'too-short'],
    ['Value is too long', 'too-long'],
    ['Invalid format', 'format-mismatch'],
    ['Passwords must match', 'must-match'],
    ['Something went wrong', 'unclassified'],
  ])('classifies "%s" as %s', (msg, expected) => {
    expect(classifyValidationMessage(msg)).toBe(expected);
  });
});
