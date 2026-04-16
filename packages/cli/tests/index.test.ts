import { describe, it, expect } from 'vitest';
import { createProgram } from '../src/index.js';

describe('createProgram', () => {
  it('registers all top-level commands', () => {
    const program = createProgram();
    const names = program.commands.map((c) => c.name());
    // Commands listed in the Phase 7 spec.
    for (const expected of [
      'init',
      'config',
      'status',
      'start',
      'stop',
      'doctor',
      'skill',
      'agent',
      'cron',
      'memory',
      'migrate',
      'benchmark',
      'update',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('registers skill subcommands', () => {
    const program = createProgram();
    const skill = program.commands.find((c) => c.name() === 'skill')!;
    const subs = skill.commands.map((c) => c.name());
    for (const sub of ['list', 'search', 'audit', 'create', 'install', 'test', 'remove']) {
      expect(subs).toContain(sub);
    }
  });

  it('registers agent subcommands', () => {
    const program = createProgram();
    const agent = program.commands.find((c) => c.name() === 'agent')!;
    const subs = agent.commands.map((c) => c.name());
    expect(subs).toEqual(expect.arrayContaining(['add', 'list', 'remove']));
  });

  it('registers cron subcommands', () => {
    const program = createProgram();
    const cron = program.commands.find((c) => c.name() === 'cron')!;
    const subs = cron.commands.map((c) => c.name());
    expect(subs).toEqual(expect.arrayContaining(['add', 'list', 'remove']));
  });

  it('registers memory subcommands', () => {
    const program = createProgram();
    const mem = program.commands.find((c) => c.name() === 'memory')!;
    const subs = mem.commands.map((c) => c.name());
    expect(subs).toEqual(expect.arrayContaining(['stats', 'search']));
  });

  it('registers migrate subcommands', () => {
    const program = createProgram();
    const mig = program.commands.find((c) => c.name() === 'migrate')!;
    const subs = mig.commands.map((c) => c.name());
    expect(subs).toEqual(expect.arrayContaining(['dump', 'restore', 'copy']));
  });
});
