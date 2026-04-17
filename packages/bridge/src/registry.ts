/**
 * Bridge registry — enables dynamic enable/disable, per-bridge health
 * monitoring, and a capability matrix introspectable by the dashboard.
 */

import type { BridgeCapabilities, ErrorHandler, MessageBridge, MessageHandler } from './types.js';

export type BridgeHealthState = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface BridgeHealth {
  readonly platform: string;
  readonly state: BridgeHealthState;
  readonly lastTransitionAt: string;
  readonly lastError?: string;
  readonly reconnectAttempts: number;
}

export interface BridgeFactory<O = unknown> {
  readonly platform: string;
  /** Free-form factory — creates a new bridge from opts. */
  readonly create: (opts: O) => Promise<MessageBridge> | MessageBridge;
}

export interface BridgeRegistryOptions {
  readonly onMessage?: MessageHandler;
  readonly onError?: ErrorHandler;
  readonly now?: () => string;
  /** Called on every health-state transition. */
  readonly onHealthChange?: (platform: string, health: BridgeHealth) => void;
  /** Max reconnect attempts before giving up (default 6). */
  readonly maxReconnectAttempts?: number;
  /** Delay schedule (ms) for reconnects (default exp-backoff 1/2/4/8/16/32s). */
  readonly reconnectDelays?: readonly number[];
}

export interface LoadedBridge {
  readonly bridge: MessageBridge;
  readonly platform: string;
  readonly capabilities: BridgeCapabilities;
}

export class BridgeRegistry {
  readonly #factories = new Map<string, BridgeFactory<unknown>>();
  readonly #instances = new Map<string, LoadedBridge>();
  readonly #health = new Map<string, BridgeHealth>();
  readonly #opts: BridgeRegistryOptions;
  readonly #reconnectDelays: readonly number[];
  readonly #maxReconnects: number;

  constructor(opts: BridgeRegistryOptions = {}) {
    this.#opts = opts;
    this.#reconnectDelays = opts.reconnectDelays ?? [1_000, 2_000, 4_000, 8_000, 16_000, 32_000];
    this.#maxReconnects = opts.maxReconnectAttempts ?? this.#reconnectDelays.length;
  }

  register<O>(factory: BridgeFactory<O>): void {
    this.#factories.set(factory.platform, factory as BridgeFactory<unknown>);
  }

  platforms(): readonly string[] {
    return [...this.#factories.keys()];
  }

  loaded(): readonly LoadedBridge[] {
    return [...this.#instances.values()];
  }

  async load<O>(platform: string, opts: O): Promise<LoadedBridge> {
    const factory = this.#factories.get(platform) as BridgeFactory<O> | undefined;
    if (!factory) throw new Error(`no factory registered for ${platform}`);
    if (this.#instances.has(platform)) throw new Error(`${platform} is already loaded`);
    this.#setHealth(platform, 'connecting', 0);
    const bridge = await factory.create(opts);
    const capabilities = bridge.getCapabilities();
    if (this.#opts.onMessage) bridge.onMessage(this.#opts.onMessage);
    bridge.onError((err) => {
      this.#setHealth(platform, 'error', this.#health.get(platform)?.reconnectAttempts ?? 0, (err as Error).message);
      this.#opts.onError?.(err);
      void this.#maybeReconnect(platform, bridge);
    });
    await bridge.connect();
    this.#setHealth(platform, 'connected', 0);
    const loaded: LoadedBridge = { bridge, platform, capabilities };
    this.#instances.set(platform, loaded);
    return loaded;
  }

  async unload(platform: string): Promise<void> {
    const loaded = this.#instances.get(platform);
    if (!loaded) return;
    try {
      await loaded.bridge.disconnect();
    } catch {
      /* ignore */
    }
    this.#instances.delete(platform);
    this.#setHealth(platform, 'disconnected', 0);
  }

  capabilityMatrix(): Readonly<Record<string, BridgeCapabilities>> {
    const out: Record<string, BridgeCapabilities> = {};
    for (const [platform, loaded] of this.#instances) out[platform] = loaded.capabilities;
    return out;
  }

  health(): readonly BridgeHealth[] {
    return [...this.#health.values()];
  }

  async #maybeReconnect(platform: string, bridge: MessageBridge): Promise<void> {
    const current = this.#health.get(platform);
    if (!current) return;
    if (current.reconnectAttempts >= this.#maxReconnects) return;
    const nextAttempt = current.reconnectAttempts + 1;
    const delay = this.#reconnectDelays[Math.min(nextAttempt - 1, this.#reconnectDelays.length - 1)] ?? 0;
    this.#setHealth(platform, 'connecting', nextAttempt);
    await new Promise((r) => setTimeout(r, delay));
    try {
      await bridge.connect();
      this.#setHealth(platform, 'connected', 0);
    } catch (err) {
      this.#setHealth(platform, 'error', nextAttempt, (err as Error).message);
    }
  }

  #setHealth(
    platform: string,
    state: BridgeHealthState,
    reconnectAttempts: number,
    lastError?: string,
  ): void {
    const now = this.#opts.now?.() ?? new Date().toISOString();
    const health: BridgeHealth = {
      platform,
      state,
      lastTransitionAt: now,
      reconnectAttempts,
      ...(lastError ? { lastError } : {}),
    };
    this.#health.set(platform, health);
    this.#opts.onHealthChange?.(platform, health);
  }
}
