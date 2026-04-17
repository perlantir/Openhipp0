import { describe, expect, it, vi } from 'vitest';

import { BridgeRegistry, type BridgeFactory } from '../src/registry.js';
import type { BridgeCapabilities, MessageBridge, OutgoingMessage } from '../src/types.js';

function fakeBridge(platform: string, caps?: Partial<BridgeCapabilities>): MessageBridge {
  return {
    platform: platform as MessageBridge['platform'],
    async connect() {},
    async disconnect() {},
    isConnected() { return true; },
    onMessage() {},
    onError() {},
    getCapabilities(): BridgeCapabilities {
      return {
        files: false,
        buttons: false,
        threads: false,
        slashCommands: false,
        maxMessageBytes: 4_000,
        ...(caps ?? {}),
      };
    },
    async send(_channelId: string, _content: OutgoingMessage) {},
  };
}

describe('BridgeRegistry', () => {
  it('loads a bridge and transitions to connected health', async () => {
    const onHealthChange = vi.fn();
    const reg = new BridgeRegistry({ onHealthChange });
    const factory: BridgeFactory<{ note: string }> = {
      platform: 'slack',
      async create() {
        return fakeBridge('slack');
      },
    };
    reg.register(factory);
    await reg.load('slack', { note: 'hi' });
    expect(reg.loaded()).toHaveLength(1);
    expect(reg.health().find((x) => x.platform === 'slack')?.state).toBe('connected');
    expect(onHealthChange).toHaveBeenCalled();
  });

  it('builds a capability matrix', async () => {
    const reg = new BridgeRegistry();
    reg.register({ platform: 'discord', async create() { return fakeBridge('discord', { buttons: true, threads: true }); } });
    reg.register({ platform: 'web', async create() { return fakeBridge('web', { files: true }); } });
    await reg.load('discord', {});
    await reg.load('web', {});
    const matrix = reg.capabilityMatrix();
    expect(matrix['discord']?.buttons).toBe(true);
    expect(matrix['web']?.files).toBe(true);
  });

  it('rejects double-load', async () => {
    const reg = new BridgeRegistry();
    reg.register({ platform: 'cli', async create() { return fakeBridge('cli'); } });
    await reg.load('cli', {});
    await expect(reg.load('cli', {})).rejects.toThrow(/already loaded/);
  });

  it('unload disconnects + clears instance', async () => {
    const reg = new BridgeRegistry();
    reg.register({ platform: 'email', async create() { return fakeBridge('email'); } });
    await reg.load('email', {});
    await reg.unload('email');
    expect(reg.loaded()).toHaveLength(0);
    expect(reg.health().find((x) => x.platform === 'email')?.state).toBe('disconnected');
  });
});
