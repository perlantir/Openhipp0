import { describe, it, expect } from 'vitest';
import { packageName, version } from '../src/index.js';

describe('@openhipp0/cli stub', () => {
  it('exports packageName and version', () => {
    expect(packageName).toBe('@openhipp0/cli');
    expect(version).toBe('0.0.0');
  });
});
