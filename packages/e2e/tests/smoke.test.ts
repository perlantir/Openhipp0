import { describe, it, expect } from 'vitest';
import { packageName, version, FakeLLMProvider, createFullStack } from '../src/index.js';

describe('@openhipp0/e2e smoke', () => {
  it('exports identity metadata', () => {
    expect(packageName).toBe('@openhipp0/e2e');
    expect(version).toBe('0.0.0');
  });

  it('exports the core fixtures', () => {
    expect(typeof FakeLLMProvider).toBe('function');
    expect(typeof createFullStack).toBe('function');
  });
});
