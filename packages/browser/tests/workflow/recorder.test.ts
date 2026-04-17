import { describe, expect, it } from 'vitest';

import { Recorder, substituteParameters } from '../../src/workflow/recorder.js';

describe('Recorder', () => {
  it('builds a versioned workflow with steps + parameters', () => {
    const rec = new Recorder({ name: 'login', description: 'Test' });
    rec.parameter({ name: 'email', kind: 'email' });
    rec.parameter({ name: 'password', kind: 'password' });
    rec.navigate('https://example.com/login');
    rec.type('#email', '${email}');
    rec.type('#password', '${password}');
    rec.click('button[type=submit]', 'Sign in', 'button');
    const wf = rec.build();
    expect(wf.version).toBe(1);
    expect(wf.name).toBe('login');
    expect(wf.steps).toHaveLength(4);
    expect(wf.parameters.map((p) => p.name)).toEqual(['email', 'password']);
    expect(wf.steps[1]!.value).toBe('${email}');
    expect(wf.steps[3]!.labelAtRecord).toBe('Sign in');
  });

  it('substituteParameters replaces ${...} and leaves unknown refs', () => {
    expect(substituteParameters('${a}:${b}:${c}', { a: '1', c: '3' })).toBe('1:${b}:3');
    expect(substituteParameters(undefined, {})).toBeUndefined();
  });
});
