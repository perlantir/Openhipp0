import { describe, it, expect } from 'vitest';
import { packageName, version } from '../src/index.js';

describe('@openhipp0/watchdog stub', () => {
  it('exports packageName and version', () => {
    expect(packageName).toBe('@openhipp0/watchdog');
    expect(version).toBe('0.0.0');
  });
});
