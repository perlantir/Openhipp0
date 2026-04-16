// @openhipp0/core/browser — browser automation primitives.
//
// Phase 9: BrowserEngine, page analyzer, action executor, credential vault,
// stealth primitives, 6 browser_* tools, and a scriptable planner. Playwright
// is a peer dependency — install `playwright` + run `npx playwright install
// chromium` before using the default driver in production.

export { BrowserEngine } from './engine.js';
export { ActionExecutor } from './action-executor.js';
export { analyzePage, resolveRefToSelector, type AnalyzeOptions } from './page-analyzer.js';
export {
  CredentialVault,
  inMemoryBackend,
  secureEqual,
  type SiteCredentials,
  type VaultBackend,
  type EncryptedVault,
} from './credential-vault.js';
export {
  applyStealth,
  pickUserAgent,
  jitter,
  humanType,
  DEFAULT_USER_AGENTS,
} from './stealth.js';
export {
  ScriptedPlanner,
  heuristicPlan,
  type Planner,
} from './planner.js';
export { createBrowserTools } from './tools.js';
export type {
  ActionResult,
  AxNode,
  BrowserAction,
  BrowserContext,
  BrowserDriver,
  BrowserEngineConfig,
  BrowserLaunchOptions,
  BrowserPage,
  FormDefinition,
  InteractiveElement,
  NavigationState,
  PageState,
} from './types.js';
