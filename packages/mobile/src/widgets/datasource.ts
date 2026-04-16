// packages/mobile/src/widgets/datasource.ts
//
// Writes the widget snapshot that iOS WidgetKit + Android AppWidgets read
// at refresh time. The mobile app hits `/api/widgets` whenever the foreground
// handler receives a "refresh-widgets" push (or on app open), serialises the
// payload as JSON, and hands it off to the platform-specific store:
//
//   iOS      FileManager containerURL(forSecurityApplicationGroupIdentifier:)
//            → Documents/widgets.json  (shared App Group)
//   Android  SharedPreferences("openhipp0_widgets").edit().putString("snapshot", …)
//
// Both stores are hidden behind an injectable `WidgetStore` so the pure
// data-shape logic here stays testable.

import type { ApiClient } from "../api/client.js";

export interface WidgetAgent {
  id: string;
  name: string;
  status: "online" | "busy" | "offline";
  pendingApprovals: number;
}
export interface WidgetCost {
  today: number;
  week: number;
  month: number;
  currency: string;
}
export interface WidgetAutomation {
  id: string;
  name: string;
  nextRunIso?: string;
}

export interface WidgetSnapshot {
  generatedAtIso: string;
  agents: readonly WidgetAgent[];
  cost: WidgetCost;
  nextAutomation: WidgetAutomation | undefined;
}

export interface WidgetStore {
  write(snapshot: WidgetSnapshot): Promise<void>;
  /** Platforms that support forcing a timeline reload wire this (WidgetKit). */
  reloadTimelines?(): Promise<void>;
}

export interface RemoteWidgetPayload {
  agents: readonly WidgetAgent[];
  cost: WidgetCost;
  nextAutomation?: WidgetAutomation;
}

/**
 * Pure shape transform — takes whatever /api/widgets returned, stamps the
 * current timestamp, and normalises missing fields to zeros/empties so the
 * native widget code never has to branch on `undefined`.
 */
export function toSnapshot(
  remote: RemoteWidgetPayload,
  now: Date = new Date(),
): WidgetSnapshot {
  return {
    generatedAtIso: now.toISOString(),
    agents: remote.agents.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      pendingApprovals: Math.max(0, Math.floor(a.pendingApprovals)),
    })),
    cost: {
      today: clampNumber(remote.cost.today),
      week: clampNumber(remote.cost.week),
      month: clampNumber(remote.cost.month),
      currency: remote.cost.currency || "USD",
    },
    nextAutomation: remote.nextAutomation
      ? {
          id: remote.nextAutomation.id,
          name: remote.nextAutomation.name,
          ...(remote.nextAutomation.nextRunIso && { nextRunIso: remote.nextAutomation.nextRunIso }),
        }
      : undefined,
  };
}

function clampNumber(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.round(v * 100) / 100;
}

/**
 * Fetch + write + reload. Call this on app open, on foreground pushes, and
 * whenever settings related to widgets (agent rename, cron edit) change.
 */
export async function refreshWidgets(
  api: ApiClient,
  store: WidgetStore,
): Promise<WidgetSnapshot> {
  const remote = await (
    api as unknown as { request: <T>(path: string) => Promise<T> }
  ).request<RemoteWidgetPayload>("/api/widgets");
  const snap = toSnapshot(remote);
  await store.write(snap);
  await store.reloadTimelines?.();
  return snap;
}

/**
 * No-op store for tests + hosts that don't yet have native widget support.
 */
export class NullWidgetStore implements WidgetStore {
  public written: WidgetSnapshot | null = null;
  async write(snapshot: WidgetSnapshot): Promise<void> {
    this.written = snapshot;
  }
}
