// packages/mobile/app/_layout.tsx
// Root layout. Wraps every screen in providers: SafeArea, TanStack Query,
// theme root. Uses Expo Router's typed-routes Stack.

import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";
import { useColorScheme, View } from "react-native";
import { colorsDark, colorsLight } from "../src/theme/index.js";

export default function RootLayout() {
  const scheme = useColorScheme() ?? "light";
  const palette = scheme === "dark" ? colorsDark : colorsLight;
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: 1,
          },
        },
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: palette.background }}>
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: palette.background },
              animation: "slide_from_right",
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="pairing" options={{ animation: "fade" }} />
          </Stack>
        </View>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
