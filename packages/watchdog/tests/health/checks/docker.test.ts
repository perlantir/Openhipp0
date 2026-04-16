import { describe, expect, it } from 'vitest';
import { DockerCheck } from '../../../src/index.js';

describe('DockerCheck', () => {
  it('ok when probe resolves', async () => {
    const r = await new DockerCheck({ probe: async () => {} }).run();
    expect(r.status).toBe('ok');
  });

  it('warn when probe throws (default required=false)', async () => {
    const r = await new DockerCheck({
      probe: async () => {
        throw new Error('connect ENOENT /var/run/docker.sock');
      },
    }).run();
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/docker.sock/);
  });

  it('fail when probe throws and required=true', async () => {
    const r = await new DockerCheck({
      required: true,
      probe: async () => {
        throw new Error('not running');
      },
    }).run();
    expect(r.status).toBe('fail');
  });

  it('honors custom name', () => {
    expect(new DockerCheck({ probe: async () => {}, name: 'docker-engine' }).name).toBe(
      'docker-engine',
    );
  });
});
