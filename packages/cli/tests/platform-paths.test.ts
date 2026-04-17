import { describe, expect, it } from 'vitest';

import {
  expandTilde,
  hipp0Config,
  hipp0Data,
  hipp0Home,
  hipp0Logs,
  safeNormalize,
  safeSlug,
} from '../src/platform-paths.js';

describe('platform-paths', () => {
  it('hipp0Home honors HIPP0_HOME override', () => {
    expect(hipp0Home({ env: { HIPP0_HOME: '/tmp/hz' } })).toBe('/tmp/hz');
  });

  it('hipp0Home on darwin / linux uses ~/.hipp0', () => {
    expect(hipp0Home({ platform: 'darwin', env: {} })).toMatch(/\.hipp0$/);
    expect(hipp0Home({ platform: 'linux', env: {} })).toMatch(/\.hipp0$/);
  });

  it('hipp0Home on win32 uses LOCALAPPDATA/OpenHipp0', () => {
    const r = hipp0Home({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\X\\AppData\\Local' } });
    expect(r).toContain('OpenHipp0');
    expect(r).toContain('Local');
  });

  it('hipp0Config / hipp0Data / hipp0Logs nest under hipp0Home', () => {
    const env = { HIPP0_HOME: '/x' };
    expect(hipp0Config({ env })).toBe('/x/config.json');
    expect(hipp0Data({ env })).toBe('/x/data');
    expect(hipp0Logs({ env })).toBe('/x/logs');
  });

  it('expandTilde uses HOME / USERPROFILE', () => {
    expect(expandTilde('~', { env: { HOME: '/h' } })).toBe('/h');
    expect(expandTilde('~/file', { env: { HOME: '/h' } })).toBe('/h/file');
    expect(expandTilde('/abs', { env: { HOME: '/h' } })).toBe('/abs');
  });

  it('safeNormalize strips trailing CR/LF and normalizes', () => {
    expect(safeNormalize('a/b\r\n')).toBe('a/b');
  });

  it('safeSlug strips path separators + reserved chars', () => {
    expect(safeSlug('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(safeSlug('spaces and  spaces')).toBe('spaces-and-spaces');
    expect(safeSlug('.hidden').startsWith('.')).toBe(false);
  });
});
