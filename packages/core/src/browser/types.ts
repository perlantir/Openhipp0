/**
 * Browser automation types — a narrow subset of Playwright's surface,
 * structural rather than nominal so tests can inject lightweight fakes
 * without the Playwright package installed.
 *
 * The real Playwright adapter lives in `playwright-driver.ts` and is
 * lazy-imported; nothing in this file depends on the `playwright` module.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Page state / accessibility tree
// ─────────────────────────────────────────────────────────────────────────────

/** A compact, LLM-friendly reference to an interactive element on the page. */
export interface InteractiveElement {
  /** Stable compact handle the LLM cites when asking us to click / type. */
  ref: string;
  type: 'button' | 'link' | 'input' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'other';
  /** Accessible name — label / aria-label / visible text. */
  label: string;
  value?: string;
  enabled: boolean;
  visible: boolean;
  /** Pass-through attributes (aria-*, data-*, name, id). */
  attributes: Record<string, string>;
}

export interface FormDefinition {
  ref: string;
  action?: string;
  method?: string;
  fields: InteractiveElement[];
  submitRef?: string;
}

export interface NavigationState {
  currentStep?: number;
  totalSteps?: number;
  /** Breadcrumb-style location ("Cart > Shipping > Payment"). */
  breadcrumbs?: string[];
}

export interface PageState {
  url: string;
  title: string;
  elements: InteractiveElement[];
  /** Visible text content, truncated. */
  text: string;
  forms: FormDefinition[];
  navigation: NavigationState;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action types
// ─────────────────────────────────────────────────────────────────────────────

export type BrowserAction =
  | { kind: 'navigate'; url: string }
  | { kind: 'click'; ref: string }
  | { kind: 'type'; ref: string; text: string; clear?: boolean }
  | { kind: 'select'; ref: string; value: string }
  | { kind: 'scroll'; deltaY: number }
  | { kind: 'wait'; ms: number }
  | { kind: 'screenshot' }
  | { kind: 'extract'; what: 'state' | 'text' | 'html' };

export interface ActionResult {
  ok: boolean;
  /** When kind is 'screenshot' — base64 PNG. */
  screenshot?: string;
  /** When kind is 'extract' — the requested content. */
  extracted?: string | PageState;
  error?: string;
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Structural Playwright-like driver surface
// ─────────────────────────────────────────────────────────────────────────────

export interface BrowserPage {
  url(): string;
  title(): Promise<string>;
  goto(url: string, options?: { timeout?: number; waitUntil?: string }): Promise<void>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  type(selector: string, text: string, options?: { delay?: number }): Promise<void>;
  selectOption(selector: string, value: string): Promise<void>;
  content(): Promise<string>;
  innerText(selector: string): Promise<string>;
  screenshot(options?: { fullPage?: boolean }): Promise<Buffer>;
  evaluate<T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T>;
  mouse: { wheel(deltaX: number, deltaY: number): Promise<void> };
  waitForTimeout(ms: number): Promise<void>;
  accessibility: {
    snapshot(options?: { interestingOnly?: boolean }): Promise<AxNode | null>;
  };
  close(): Promise<void>;
}

export interface AxNode {
  role?: string;
  name?: string;
  value?: string | number;
  description?: string;
  keyshortcuts?: string;
  checked?: boolean | 'mixed';
  disabled?: boolean;
  focused?: boolean;
  modal?: boolean;
  multiline?: boolean;
  multiselectable?: boolean;
  readonly?: boolean;
  required?: boolean;
  selected?: boolean;
  expanded?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  level?: number;
  valuemin?: number;
  valuemax?: number;
  autocomplete?: string;
  haspopup?: string;
  invalid?: string;
  orientation?: string;
  children?: AxNode[];
}

export interface BrowserContext {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
  cookies(): Promise<Record<string, unknown>[]>;
  addCookies(cookies: Record<string, unknown>[]): Promise<void>;
}

export interface BrowserDriver {
  launch(options?: BrowserLaunchOptions): Promise<BrowserContext>;
}

export interface BrowserLaunchOptions {
  headless?: boolean;
  /** 'chromium' | 'firefox' | 'webkit' — default 'chromium'. */
  engine?: 'chromium' | 'firefox' | 'webkit';
  userDataDir?: string;
  viewport?: { width: number; height: number };
  timeout?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine config
// ─────────────────────────────────────────────────────────────────────────────

export interface BrowserEngineConfig {
  /** Override the default Playwright driver. */
  driver?: BrowserDriver;
  launch?: BrowserLaunchOptions;
}
