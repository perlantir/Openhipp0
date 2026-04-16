// packages/mobile/src/theme/useTheme.ts
// `useTheme()` hook — resolves the active ColorScheme from the OS and
// returns the memoized Theme. Components should always read tokens via
// this hook (not by importing colorsLight/colorsDark directly) so they
// re-render correctly on Dynamic Type / appearance changes.

import { useMemo } from "react";
import { useColorScheme } from "react-native";
import { buildTheme, type Theme } from "./index.js";

export function useTheme(): Theme {
  const scheme = useColorScheme() ?? "light";
  return useMemo(() => buildTheme(scheme), [scheme]);
}
