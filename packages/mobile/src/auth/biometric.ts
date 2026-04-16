// packages/mobile/src/auth/biometric.ts
// Face ID / Touch ID / PIN gate via expo-local-authentication.

import * as LocalAuthentication from "expo-local-authentication";

export type BiometricAvailability =
  | { available: true; supportedTypes: LocalAuthentication.AuthenticationType[] }
  | { available: false; reason: "no-hardware" | "not-enrolled" | "unknown" };

export async function probeBiometricAvailability(): Promise<BiometricAvailability> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return { available: false, reason: "no-hardware" };
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!enrolled) return { available: false, reason: "not-enrolled" };
  const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();
  return { available: true, supportedTypes };
}

export interface AuthenticateOptions {
  promptMessage?: string;
  /** Whether to allow a device PIN / pattern as a fallback. Default true. */
  disableDeviceFallback?: boolean;
}

export async function authenticate(options: AuthenticateOptions = {}): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: options.promptMessage ?? "Unlock Open Hipp0",
    disableDeviceFallback: options.disableDeviceFallback ?? false,
    cancelLabel: "Cancel",
  });
  return result.success === true;
}
