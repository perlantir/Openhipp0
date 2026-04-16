import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createEvidenceValidator } from '../../src/planning/evidence.js';
import type { EvidenceRecord } from '../../src/planning/types.js';

describe('createEvidenceValidator', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'hipp0-evidence-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const vHonoringGuard = (allowed: string): ((p: string) => boolean) => {
    return (p) => p.startsWith(allowed);
  };

  it('file-exists accepts when path is present', async () => {
    const p = path.join(dir, 'ok.txt');
    writeFileSync(p, 'hello');
    const validator = createEvidenceValidator();
    const out = await validator({
      kind: 'file-exists',
      detail: { path: p },
      valid: false,
    });
    expect(out.valid).toBe(true);
  });

  it('file-exists rejects when path missing', async () => {
    const validator = createEvidenceValidator();
    const out = await validator({
      kind: 'file-exists',
      detail: { path: path.join(dir, 'nope.txt') },
      valid: false,
    });
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/does not exist/);
  });

  it('file-exists respects pathGuard', async () => {
    const p = path.join(dir, 'in.txt');
    writeFileSync(p, 'x');
    const validator = createEvidenceValidator({ pathGuard: vHonoringGuard('/etc') });
    const out = await validator({
      kind: 'file-exists',
      detail: { path: p },
      valid: false,
    });
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/blocked by policy/);
  });

  it('file-content-matches accepts when substring present', async () => {
    const p = path.join(dir, 'content.txt');
    writeFileSync(p, 'build succeeded ok');
    const validator = createEvidenceValidator();
    const out = await validator({
      kind: 'file-content-matches',
      detail: { path: p, contains: 'succeeded' },
      valid: false,
    });
    expect(out.valid).toBe(true);
  });

  it('exit-code-zero only accepts 0', async () => {
    const validator = createEvidenceValidator();
    const accepted: EvidenceRecord = {
      kind: 'exit-code-zero',
      detail: { exitCode: 0 },
      valid: false,
    };
    const rejected: EvidenceRecord = {
      kind: 'exit-code-zero',
      detail: { exitCode: 1 },
      valid: false,
    };
    expect((await validator(accepted)).valid).toBe(true);
    expect((await validator(rejected)).valid).toBe(false);
  });

  it('http-2xx range', async () => {
    const validator = createEvidenceValidator();
    expect((await validator({ kind: 'http-2xx', detail: { status: 200 }, valid: false })).valid).toBe(true);
    expect((await validator({ kind: 'http-2xx', detail: { status: 299 }, valid: false })).valid).toBe(true);
    expect((await validator({ kind: 'http-2xx', detail: { status: 300 }, valid: false })).valid).toBe(false);
    expect((await validator({ kind: 'http-2xx', detail: { status: 199 }, valid: false })).valid).toBe(false);
  });

  it('tool-result-ok needs boolean true', async () => {
    const validator = createEvidenceValidator();
    expect((await validator({ kind: 'tool-result-ok', detail: { ok: true }, valid: false })).valid).toBe(true);
    expect((await validator({ kind: 'tool-result-ok', detail: { ok: false }, valid: false })).valid).toBe(false);
    expect((await validator({ kind: 'tool-result-ok', detail: {}, valid: false })).valid).toBe(false);
  });

  it('manual always accepts (noted in reason)', async () => {
    const validator = createEvidenceValidator();
    const out = await validator({ kind: 'manual', detail: {}, valid: false });
    expect(out.valid).toBe(true);
    expect(out.reason).toMatch(/manual/i);
  });

  it('assertion-passed', async () => {
    const validator = createEvidenceValidator();
    expect(
      (await validator({ kind: 'assertion-passed', detail: { passed: true }, valid: false })).valid,
    ).toBe(true);
    expect(
      (await validator({ kind: 'assertion-passed', detail: { passed: false }, valid: false })).valid,
    ).toBe(false);
  });

  it('ignores dir that falls outside pathGuard', async () => {
    const outsideDir = path.join(dir, '..', 'outside');
    mkdirSync(outsideDir, { recursive: true });
    try {
      const p = path.join(outsideDir, 'x.txt');
      writeFileSync(p, 'x');
      const validator = createEvidenceValidator({ pathGuard: (p2) => p2.startsWith(dir) });
      const out = await validator({
        kind: 'file-exists',
        detail: { path: p },
        valid: false,
      });
      expect(out.valid).toBe(false);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
