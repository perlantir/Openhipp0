// packages/mobile/metro.config.js
// Metro config wired for pnpm workspaces + NativeWind.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDefaultConfig } = require("expo/metro-config");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withNativeWind } = require("nativewind/metro");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// pnpm stores dependencies in a nested `node_modules/.pnpm/*` tree with symlinks.
// Metro needs the workspace root on its watchFolders + nodeModulesPaths so that
// cross-package imports (`@openhipp0/sdk`) resolve without flattening.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = false;

module.exports = withNativeWind(config, { input: "./src/theme/global.css" });
