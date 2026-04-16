import { describe, it, expect, vi } from 'vitest';
import {
  setSessionContext,
  resetSessionContext,
  enableRlsSql,
  disableRlsSql,
  generateRlsMigrationSql,
  sqliteToPostgresMigrationGuide,
  RLS_SESSION_VARS,
} from '../../src/enterprise/rls.js';

describe('RLS', () => {
  it('setSessionContext issues set_config for every provided key', async () => {
    const db = { execute: vi.fn(async () => undefined) };
    await setSessionContext(db, {
      tenantId: 't1',
      projectId: 'p1',
      userId: 'u1',
      role: 'owner',
    });
    expect(db.execute).toHaveBeenCalledTimes(4);
    const calls = db.execute.mock.calls.map((c) => c[1] as unknown[]);
    expect(calls[0]).toEqual([RLS_SESSION_VARS.tenant, 't1']);
    expect(calls[1]).toEqual([RLS_SESSION_VARS.project, 'p1']);
    expect(calls[2]).toEqual([RLS_SESSION_VARS.user, 'u1']);
    expect(calls[3]).toEqual([RLS_SESSION_VARS.role, 'owner']);
  });

  it('resetSessionContext clears all session vars', async () => {
    const db = { execute: vi.fn(async () => undefined) };
    await resetSessionContext(db);
    expect(db.execute).toHaveBeenCalledTimes(Object.keys(RLS_SESSION_VARS).length);
    // Every call resets to empty string.
    db.execute.mock.calls.forEach((c) => {
      expect((c[1] as unknown[])[1]).toBe('');
    });
  });

  it('enableRlsSql emits ENABLE + FORCE + two policies', () => {
    const sql = enableRlsSql('decisions');
    expect(sql.length).toBe(6);
    expect(sql.join('\n')).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql.join('\n')).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql.join('\n')).toContain('p_decisions_tenant');
    expect(sql.join('\n')).toContain('p_decisions_project');
  });

  it('rejects unsafe table identifiers', () => {
    expect(() => enableRlsSql("decisions; DROP TABLE users; --")).toThrow();
    expect(() => disableRlsSql("t'1")).toThrow();
  });

  it('generateRlsMigrationSql concatenates every table', () => {
    const sql = generateRlsMigrationSql(['decisions', 'skills', 'sessions']);
    expect(sql).toContain('"decisions"');
    expect(sql).toContain('"skills"');
    expect(sql).toContain('"sessions"');
  });

  it('sqliteToPostgresMigrationGuide returns documented steps', () => {
    const guide = sqliteToPostgresMigrationGuide();
    expect(guide).toContain('pgvector');
    expect(guide).toContain('hipp0 migrate dump');
  });
});
