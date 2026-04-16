// packages/mobile/src/push/register.ts
// Request + register Expo push token. The token is sent to the paired
// server (encrypted under the device public key) so the server can push
// agent-initiated notifications.

import * as Notifications from "expo-notifications";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

export interface PushRegistration {
  token: string;
  platform: "ios" | "android";
}

/**
 * Request notification permission + get the Expo push token. Returns null
 * if permission denied or running on a simulator where push isn't available.
 */
export async function registerForPushAsync(): Promise<PushRegistration | null> {
  // Expo Go + simulators don't issue real FCM/APNS tokens. Skip gracefully.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return null;
  }
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return null;
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const next = await Notifications.requestPermissionsAsync();
    status = next.status;
  }
  if (status !== "granted") return null;

  // Android requires an explicit notification channel before getting a token.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Open Hipp0",
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: "#D97757",
    });
  }

  const token = (await Notifications.getExpoPushTokenAsync()).data;
  return {
    token,
    platform: Platform.OS === "ios" ? "ios" : "android",
  };
}

/** Configure how notifications appear when the app is foregrounded. */
export function configureForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
}
