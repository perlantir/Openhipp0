/**
 * Credential pool — round-robin over multiple API keys for a single
 * provider, with per-key health tracking. On failure, the pool marks
 * a key as degraded and skips it until cooldown. Used alongside the
 * Anthropic / OpenAI / Gemini providers when operators have bought
 * rate-limit capacity across several keys.
 */

export interface Credential {
  readonly id: string;
  readonly key: string;
  readonly tags?: readonly string[];
}

export interface CredentialHealth {
  readonly id: string;
  readonly consecutiveFailures: number;
  readonly disabledUntil: number; // epoch ms; 0 = healthy
  readonly totalUses: number;
}

export interface CredentialPoolOptions {
  readonly now?: () => number;
  readonly cooldownMs?: number;
  readonly maxFailuresBeforeDisable?: number;
}

export class CredentialPool {
  readonly #pool: Credential[];
  readonly #health = new Map<string, CredentialHealth>();
  readonly #now: () => number;
  readonly #cooldown: number;
  readonly #threshold: number;
  #cursor = 0;

  constructor(pool: readonly Credential[], opts: CredentialPoolOptions = {}) {
    this.#pool = [...pool];
    this.#now = opts.now ?? (() => Date.now());
    this.#cooldown = opts.cooldownMs ?? 60_000;
    this.#threshold = opts.maxFailuresBeforeDisable ?? 3;
    for (const c of this.#pool) {
      this.#health.set(c.id, { id: c.id, consecutiveFailures: 0, disabledUntil: 0, totalUses: 0 });
    }
  }

  get size(): number {
    return this.#pool.length;
  }

  next(tags?: readonly string[]): Credential | null {
    if (this.#pool.length === 0) return null;
    const now = this.#now();
    const eligible = this.#pool.filter((c) => {
      if (tags && !tags.every((t) => (c.tags ?? []).includes(t))) return false;
      const h = this.#health.get(c.id)!;
      return h.disabledUntil <= now;
    });
    if (eligible.length === 0) return null;
    const picked = eligible[this.#cursor % eligible.length]!;
    this.#cursor = (this.#cursor + 1) % Math.max(eligible.length, 1);
    const h = this.#health.get(picked.id)!;
    this.#health.set(picked.id, { ...h, totalUses: h.totalUses + 1 });
    return picked;
  }

  reportSuccess(id: string): void {
    const h = this.#health.get(id);
    if (!h) return;
    this.#health.set(id, { ...h, consecutiveFailures: 0 });
  }

  reportFailure(id: string): void {
    const h = this.#health.get(id);
    if (!h) return;
    const consecutiveFailures = h.consecutiveFailures + 1;
    const disabledUntil =
      consecutiveFailures >= this.#threshold ? this.#now() + this.#cooldown : h.disabledUntil;
    this.#health.set(id, { ...h, consecutiveFailures, disabledUntil });
  }

  health(): readonly CredentialHealth[] {
    return [...this.#health.values()];
  }
}
