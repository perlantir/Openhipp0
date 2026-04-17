import { describe, expect, it } from 'vitest';

import {
  createProfileManager,
  Hipp0BrowserError,
  PROFILE_EXPORT_ENVELOPE_VERSION,
  PROFILE_MANIFEST_VERSION,
  ProfileManager,
  ProfileStore,
} from '../src/index.js';

describe('@openhipp0/browser smoke', () => {
  it('exports the public surface', () => {
    expect(PROFILE_MANIFEST_VERSION).toBe(1);
    expect(PROFILE_EXPORT_ENVELOPE_VERSION).toBe(1);
    expect(typeof ProfileStore).toBe('function');
    expect(typeof ProfileManager).toBe('function');
    expect(typeof createProfileManager).toBe('function');
    expect(typeof Hipp0BrowserError).toBe('function');
  });
});
