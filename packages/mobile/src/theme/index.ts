// packages/mobile/src/theme/index.ts
// Theme entrypoint. Everything in the app reads from `useTheme()` or the
// exports below — never hardcode tokens.

import { colorsDark, colorsLight } from "./colors.js";
import { typography, families } from "./typography.js";

export { colorsLight, colorsDark, typography, families };
export type { ColorTokens } from "./colors.js";
export type { TypographyTokens } from "./typography.js";

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  xxxxl: 64,
} as const;

export const radii = {
  element: 6,
  control: 10,
  component: 16,
  container: 20,
  pill: 999,
} as const;

export const elevationLight = {
  shadow1: {
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  shadow2: {
    // Observed authoritative shadow: 0 4px 24px rgba(0,0,0,.05)
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  shadow3: {
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 48,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
} as const;

export const elevationDark = {
  shadow1: { ...elevationLight.shadow1, shadowOpacity: 0.25 },
  shadow2: { ...elevationLight.shadow2, shadowOpacity: 0.35 },
  shadow3: { ...elevationLight.shadow3, shadowOpacity: 0.5 },
} as const;

export const motion = {
  // Observed signature easing: cubic-bezier(0.16, 1, 0.3, 1)
  easing: {
    standard: [0.16, 1, 0.3, 1] as readonly [number, number, number, number],
    ios: [0.25, 0.1, 0.25, 1] as readonly [number, number, number, number],
  },
  duration: {
    micro: 120,
    fast: 200,
    normal: 400,
    slow: 500,
  },
} as const;

export type ColorScheme = "light" | "dark";

export function buildTheme(mode: ColorScheme) {
  const colors = mode === "dark" ? colorsDark : colorsLight;
  const elevation = mode === "dark" ? elevationDark : elevationLight;
  return {
    mode,
    colors,
    spacing,
    radii,
    typography,
    families,
    elevation,
    motion,
  } as const;
}

export type Theme = ReturnType<typeof buildTheme>;
