import { defineConfig } from "vitest/config";

// Vitest runs in a jsdom env so we can unit-test React components, hooks,
// and pure TS modules without spinning up Metro or a device. Tests that
// depend on native modules mock them via vi.mock() + the `__mocks__/`
// pattern at the repo root.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: {
      // Tests import React Native via a light shim because the real package
      // requires the Metro runtime. See tests/setup.ts for the stub.
      "react-native": new URL("./tests/__shims__/react-native.ts", import.meta.url).pathname,
    },
  },
});
