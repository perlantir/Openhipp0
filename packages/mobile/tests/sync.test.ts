import { describe, expect, it, vi } from "vitest";
import {
  OutboundActionQueue,
  type QueuePersistence,
  type QueuedAction,
} from "../src/sync/sync-manager.js";
import {
  resolveConflict,
  strategyForKind,
} from "../src/sync/sync-manager.js";
import { SyncManager, type LocalCacheWriter, type RemotePullClient } from "../src/sync/sync-manager.js";

function mkPersistence(): { store: QueuedAction[]; p: QueuePersistence } {
  let store: QueuedAction[] = [];
  return {
    get store() {
      return store;
    },
    p: {
      load: async () => store,
      save: async (actions) => {
        store = [...actions];
      },
    },
  };
}

describe("OutboundActionQueue", () => {
  it("enqueues, drains in FIFO order, and persists state", async () => {
    const { p } = mkPersistence();
    const q = new OutboundActionQueue({}, p);

    await q.enqueue("send-message", { text: "hi" });
    await q.enqueue("send-message", { text: "again" });
    expect(q.size()).toBe(2);

    const processed: unknown[] = [];
    await q.drain(async (a) => {
      processed.push(a.payload);
    });
    expect(processed).toEqual([{ text: "hi" }, { text: "again" }]);
    expect(q.size()).toBe(0);
  });

  it("stops draining on first failure and increments attempts", async () => {
    const { p } = mkPersistence();
    const q = new OutboundActionQueue({}, p);
    await q.enqueue("fail-me", { n: 1 });
    await q.enqueue("fail-me", { n: 2 });

    const handler = vi.fn(async () => {
      throw new Error("nope");
    });
    const { processed, failed } = await q.drain(handler, { stopOnFirstFailure: true });
    expect(processed).toBe(0);
    expect(failed).toBe(1);
    expect(q.size()).toBe(2);
    expect(q.peek()[0]?.attempts).toBe(1);
    expect(q.peek()[0]?.lastError).toBe("nope");
    expect(handler).toHaveBeenCalledTimes(1); // stops on first fail
  });

  it("drops oldest when over maxSize", async () => {
    const { p } = mkPersistence();
    const q = new OutboundActionQueue({ maxSize: 2 }, p);
    await q.enqueue("a", 1);
    await q.enqueue("a", 2);
    await q.enqueue("a", 3);
    const payloads = q.peek().map((a) => a.payload);
    expect(payloads).toEqual([2, 3]);
  });

  it("restores across instances", async () => {
    const { p } = mkPersistence();
    const q1 = new OutboundActionQueue({}, p);
    await q1.enqueue("x", "one");
    await q1.enqueue("x", "two");

    const q2 = new OutboundActionQueue({}, p);
    await q2.restore();
    expect(q2.size()).toBe(2);
    expect(q2.peek()[0]?.payload).toBe("one");
  });
});

describe("conflict resolution", () => {
  const base = { id: "r1", field: "" } as const;

  it("server-wins ignores local changes", () => {
    const local = { ...base, field: "local", updatedAt: "2026-04-16T10:00:00Z" };
    const remote = { ...base, field: "remote", updatedAt: "2026-04-16T09:00:00Z" };
    const res = resolveConflict(local, remote, "server-wins");
    expect(res.winner).toBe(remote);
  });

  it("last-write-wins respects timestamps", () => {
    const local = { ...base, field: "local", updatedAt: "2026-04-16T10:00:00Z" };
    const remote = { ...base, field: "remote", updatedAt: "2026-04-16T09:00:00Z" };
    const res = resolveConflict(local, remote, "last-write-wins");
    expect(res.winner).toBe(local);
  });

  it("maps record kind → strategy", () => {
    expect(strategyForKind("decision")).toBe("server-wins");
    expect(strategyForKind("preference")).toBe("last-write-wins");
    expect(strategyForKind("unknown-kind")).toBe("server-wins");
  });
});

describe("SyncManager.pullKind", () => {
  function makeCache(): LocalCacheWriter & { store: Map<string, Map<string, Record<string, unknown>>> } {
    const store = new Map<string, Map<string, Record<string, unknown>>>();
    const cursors = new Map<string, string>();
    return {
      store,
      upsert: async (kind, record) => {
        let m = store.get(kind);
        if (!m) {
          m = new Map();
          store.set(kind, m);
        }
        m.set(record.id, record as Record<string, unknown>);
      },
      get: async (kind, id) => {
        return store.get(kind)?.get(id) as never;
      },
      list: async (kind) => {
        return Array.from(store.get(kind)?.values() ?? []) as never;
      },
      remove: async (kind, id) => {
        store.get(kind)?.delete(id);
      },
      getCursor: async (k) => cursors.get(k),
      setCursor: async (k, v) => {
        cursors.set(k, v);
      },
    };
  }

  it("pulls deltas and applies server-wins on conflict", async () => {
    const cache = makeCache();
    await cache.upsert("decision", {
      id: "d1",
      title: "local edit",
      updatedAt: "2026-04-16T10:00:00Z",
    });

    const remote: RemotePullClient = {
      async pullDelta() {
        return {
          records: [
            { id: "d1", title: "server version", updatedAt: "2026-04-16T09:00:00Z" },
            { id: "d2", title: "new", updatedAt: "2026-04-16T11:00:00Z" },
          ],
          nextCursor: "2026-04-16T11:00:00Z",
        };
      },
    };

    const onConflict = vi.fn();
    const mgr = new SyncManager({
      cache,
      remote,
      actionHandler: async () => {},
      onConflict,
    });
    await mgr.start();
    const result = await mgr.pullKind("decision");
    expect(result.pulled).toBe(2);
    expect(result.conflicts).toBe(1);

    // server-wins → local was overwritten
    const d1 = cache.store.get("decision")?.get("d1");
    expect(d1?.title).toBe("server version");
    // new record inserted
    expect(cache.store.get("decision")?.get("d2")?.title).toBe("new");
    // cursor advanced
    expect(await cache.getCursor("decision")).toBe("2026-04-16T11:00:00Z");
    expect(onConflict).toHaveBeenCalledOnce();
  });
});
