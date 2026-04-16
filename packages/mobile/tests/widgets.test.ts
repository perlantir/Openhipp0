// Widget datasource tests — pure shape transform + refresh flow.

import { describe, expect, it, vi } from "vitest";
import {
  toSnapshot,
  refreshWidgets,
  NullWidgetStore,
  type RemoteWidgetPayload,
} from "../src/widgets/datasource.js";

const FIXED = new Date("2026-04-16T12:00:00Z");
const REMOTE: RemoteWidgetPayload = {
  agents: [
    { id: "a1", name: "Claude", status: "online", pendingApprovals: 2 },
    { id: "a2", name: "Researcher", status: "offline", pendingApprovals: 0 },
  ],
  cost: { today: 0.42, week: 3.31, month: 18.9, currency: "USD" },
  nextAutomation: { id: "t1", name: "Morning digest", nextRunIso: "2026-04-17T13:00:00Z" },
};

describe("toSnapshot", () => {
  it("stamps generated timestamp + normalises every agent field", () => {
    const snap = toSnapshot(REMOTE, FIXED);
    expect(snap.generatedAtIso).toBe("2026-04-16T12:00:00.000Z");
    expect(snap.agents).toHaveLength(2);
    expect(snap.agents[0]).toEqual({ id: "a1", name: "Claude", status: "online", pendingApprovals: 2 });
  });

  it("rounds cost to two decimals and defaults currency", () => {
    const snap = toSnapshot(
      { ...REMOTE, cost: { today: 1.23456, week: 9.0001, month: 0.1, currency: "" } },
      FIXED,
    );
    expect(snap.cost).toEqual({ today: 1.23, week: 9, month: 0.1, currency: "USD" });
  });

  it("clamps negative + non-finite costs to zero", () => {
    const snap = toSnapshot(
      { ...REMOTE, cost: { today: -5, week: Number.NaN, month: Number.POSITIVE_INFINITY, currency: "EUR" } },
      FIXED,
    );
    expect(snap.cost).toEqual({ today: 0, week: 0, month: 0, currency: "EUR" });
  });

  it("clamps negative pendingApprovals to zero", () => {
    const snap = toSnapshot(
      {
        ...REMOTE,
        agents: [{ id: "a1", name: "Claude", status: "online", pendingApprovals: -3 }],
      },
      FIXED,
    );
    expect(snap.agents[0]?.pendingApprovals).toBe(0);
  });

  it("leaves nextAutomation undefined when the remote has none", () => {
    const snap = toSnapshot({ ...REMOTE, nextAutomation: undefined }, FIXED);
    expect(snap.nextAutomation).toBeUndefined();
  });

  it("preserves nextAutomation without nextRunIso", () => {
    const snap = toSnapshot(
      { ...REMOTE, nextAutomation: { id: "t9", name: "Someday" } },
      FIXED,
    );
    expect(snap.nextAutomation).toEqual({ id: "t9", name: "Someday" });
  });
});

describe("refreshWidgets", () => {
  it("fetches /api/widgets, writes the store, returns the snapshot", async () => {
    const api = {
      request: vi.fn(async (path: string) => {
        expect(path).toBe("/api/widgets");
        return REMOTE;
      }),
    };
    const store = new NullWidgetStore();
    const snap = await refreshWidgets(api as unknown as Parameters<typeof refreshWidgets>[0], store);
    expect(store.written).not.toBeNull();
    expect(store.written?.agents[0]?.name).toBe("Claude");
    expect(snap.cost.month).toBe(18.9);
  });

  it("calls reloadTimelines when the store supports it (WidgetKit)", async () => {
    const api = { request: vi.fn(async () => REMOTE) };
    const reload = vi.fn(async () => undefined);
    const store = {
      write: async () => undefined,
      reloadTimelines: reload,
    };
    await refreshWidgets(api as unknown as Parameters<typeof refreshWidgets>[0], store);
    expect(reload).toHaveBeenCalledOnce();
  });
});
