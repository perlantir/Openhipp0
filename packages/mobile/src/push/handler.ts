// packages/mobile/src/push/handler.ts
// Incoming notification + tap handlers. Subscriptions are installed in
// app/_layout.tsx via setupPushHandlers() and cleaned up on unmount.

import * as Notifications from "expo-notifications";
import { router } from "expo-router";

export interface PushPayload {
  /** Lowercase notification kind — drives deep-linking routing. */
  kind?: "chat" | "approval" | "automation" | "security" | "system";
  /** Opaque to mobile — the server uses it to fetch the full record later. */
  refId?: string;
  /** Optional deep-link path (overrides kind-based routing). */
  path?: string;
}

function routeForPayload(payload: PushPayload): string | null {
  if (payload.path) return payload.path;
  switch (payload.kind) {
    case "chat":
      return "/(tabs)/";
    case "approval":
      return payload.refId ? `/approval/${encodeURIComponent(payload.refId)}` : null;
    case "automation":
      return "/(tabs)/automations";
    case "security":
      return "/(tabs)/settings";
    case "system":
    default:
      return null;
  }
}

/** Install handlers for received + tapped notifications. */
export function setupPushHandlers(): { remove: () => void } {
  const receivedSub = Notifications.addNotificationReceivedListener(() => {
    // Foreground handler is already configured in register.ts — no-op here.
  });

  const responseSub = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const raw = response.notification.request.content.data as unknown;
      if (!raw || typeof raw !== "object") return;
      const payload = raw as PushPayload;
      const path = routeForPayload(payload);
      if (path) router.push(path as never);
    },
  );

  return {
    remove: () => {
      receivedSub.remove();
      responseSub.remove();
    },
  };
}
