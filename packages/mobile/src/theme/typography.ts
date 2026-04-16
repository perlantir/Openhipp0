// packages/mobile/src/theme/typography.ts
// Type ramp ported from claude-ai-mobile-design/design-model.yaml.
// Font family resolves to native system (SF Pro on iOS, Roboto on Android).

import { Platform, type TextStyle } from "react-native";

const sansFamily = Platform.select({
  ios: "System",
  android: "Roboto",
  default: "System",
}) as string;

const monoFamily = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
}) as string;

export const families = {
  sans: sansFamily,
  mono: monoFamily,
} as const;

// Letter-spacing in RN is expressed in points (RN scales to em internally).
// Conversion table: -0.01em at 32px ≈ -0.32pt, 0.04em at 13px ≈ 0.52pt.
export const typography = {
  display: {
    fontFamily: sansFamily,
    fontSize: 32,
    lineHeight: 37,
    letterSpacing: -0.32,
    fontWeight: "600",
  },
  h1: {
    fontFamily: sansFamily,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.28,
    fontWeight: "600",
  },
  h2: {
    fontFamily: sansFamily,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.11,
    fontWeight: "600",
  },
  h3: {
    fontFamily: sansFamily,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: 0,
    fontWeight: "600",
  },
  body: {
    fontFamily: sansFamily,
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 0,
    fontWeight: "400",
  },
  bodySm: {
    fontFamily: sansFamily,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0,
    fontWeight: "400",
  },
  caption: {
    fontFamily: sansFamily,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0,
    fontWeight: "400",
  },
  label: {
    fontFamily: sansFamily,
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.52,
    fontWeight: "500",
  },
  mono: {
    fontFamily: monoFamily,
    fontSize: 14,
    lineHeight: 21,
    letterSpacing: 0,
    fontWeight: "400",
  },
} as const satisfies Record<string, TextStyle>;

export type TypographyTokens = typeof typography;
