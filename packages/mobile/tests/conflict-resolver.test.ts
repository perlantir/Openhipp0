import { describe, expect, it } from "vitest";
import { resolveConflict, strategyForKind } from "../src/sync/conflict-resolver.js";

const base = { id: "x", updatedAt: "2026-04-16T00:00:00Z" } as const;

describe("resolveConflict extras", () => {
  it("throws when ids don't match", () => {
    expect(() =>
      resolveConflict(
        { id: "a", updatedAt: "2026-04-16T00:00:00Z" },
        { id: "b", updatedAt: "2026-04-16T00:00:00Z" },
      ),
    ).toThrow(/different ids/);
  });

  it("falls back to server-wins on malformed local timestamp", () => {
    const res = resolveConflict(
      { ...base, updatedAt: "not-a-date" },
      { ...base, updatedAt: "2026-04-16T10:00:00Z" },
      "last-write-wins",
    );
    expect(res.strategy).toBe("server-wins");
  });

  it("server-wins when timestamps tie", () => {
    const res = resolveConflict(
      { ...base, updatedAt: "2026-04-16T10:00:00Z" },
      { ...base, updatedAt: "2026-04-16T10:00:00Z" },
      "last-write-wins",
    );
    expect(res.winner.id).toBe("x");
    expect(res.reason).toMatch(/remote newer or equal/);
  });

  it("exhaustive kind → strategy mapping", () => {
    expect(strategyForKind("decision")).toBe("server-wins");
    expect(strategyForKind("skill")).toBe("server-wins");
    expect(strategyForKind("session")).toBe("server-wins");
    expect(strategyForKind("preference")).toBe("last-write-wins");
    expect(strategyForKind("agent-config")).toBe("last-write-wins");
    expect(strategyForKind("user-note")).toBe("last-write-wins");
  });
});
