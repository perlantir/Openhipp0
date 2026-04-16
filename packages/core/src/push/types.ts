/**
 * Push notification types — kind-tagged events the server can raise toward a
 * paired mobile device. The mobile app's push handler (see
 * @openhipp0/mobile/src/push/handler.ts) branches on `kind` to route the
 * notification tap.
 */

export type PushKind = 'chat' | 'approval' | 'automation' | 'security' | 'system';

export interface PushEvent {
  /** Routes the notification tap on the mobile side. */
  kind: PushKind;
  title: string;
  body: string;
  /** Opaque id the mobile app fetches later via REST (approval, run, etc). */
  refId?: string;
  /** Optional deep-link override. */
  path?: string;
  /** Kind-specific category (Expo/APNS actions). */
  categoryIdentifier?: string;
  /** Free-form data object delivered to the mobile handler verbatim. */
  data?: Record<string, unknown>;
  /**
   * When true (default), high priority on Android + high interruption on iOS.
   * Security + approval events set this; system notices don't.
   */
  urgent?: boolean;
}

export interface PushDeviceRecord {
  deviceId: string;
  /** Expo push token (ExponentPushToken[...]). */
  pushToken: string;
  platform: 'ios' | 'android';
  updatedAt: string;
}

export interface PushRegistry {
  list(): Promise<readonly PushDeviceRecord[]>;
  get(deviceId: string): Promise<PushDeviceRecord | undefined>;
  upsert(record: PushDeviceRecord): Promise<void>;
  remove(deviceId: string): Promise<void>;
}

export interface PushTransport {
  /** Deliver a batch of prepared Expo push messages. */
  send(messages: readonly ExpoPushMessage[]): Promise<readonly ExpoPushTicket[]>;
}

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
  categoryId?: string;
  sound?: 'default' | null;
  badge?: number;
}

export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  /** Present only on error; `DeviceNotRegistered` means the token is dead. */
  details?: { error?: string };
  message?: string;
}
