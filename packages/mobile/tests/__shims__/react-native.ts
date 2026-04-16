// packages/mobile/tests/__shims__/react-native.ts
// Minimal React Native shim for vitest/jsdom. Real RN requires the Metro
// runtime + native bridge; our tests only need the export shapes + Platform.
// This lets us unit-test theme/utility code without spinning up Expo.

export const Platform = {
  OS: "ios" as "ios" | "android" | "web",
  select: <T>(options: { ios?: T; android?: T; default?: T }): T | undefined =>
    options.ios ?? options.default,
};

export const StyleSheet = {
  create<T extends object>(styles: T): T {
    return styles;
  },
  absoluteFillObject: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const,
};

// Hook — defaults to light for tests
export function useColorScheme(): "light" | "dark" {
  return "light";
}

export const AppState = {
  addEventListener: (_type: string, _cb: (s: string) => void) => ({ remove: () => undefined }),
};

export const Alert = {
  alert: (..._args: unknown[]) => undefined,
};

export const Linking = {
  openURL: async (_url: string) => undefined,
};

// Minimal View/Text/Pressable/ActivityIndicator/FlatList/ScrollView/TextInput stubs
// — they render nothing under jsdom, but satisfy type & import resolution.
export const View = "View";
export const Text = "Text";
export const Pressable = "Pressable";
export const ActivityIndicator = "ActivityIndicator";
export const FlatList = "FlatList";
export const ScrollView = "ScrollView";
export const TextInput = "TextInput";
export const KeyboardAvoidingView = "KeyboardAvoidingView";

export type TextStyle = Record<string, unknown>;
export type ViewStyle = Record<string, unknown>;
export type PressableProps = Record<string, unknown>;
