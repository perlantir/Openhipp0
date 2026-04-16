// @openhipp0/e2e — Phase 8 end-to-end test harness.
//
// This package ships no runtime exports; it exists only to host the
// integrated scenario tests that exercise the full stack:
//
//   WebBridge ⟶ Gateway ⟶ AgentRuntime ⟶ LLMClient (scripted)
//                                   ⟶ ToolRegistry (real tools, sandboxed)
//                                   ⟶ Hipp0MemoryAdapter ⟶ SQLite (:memory:)
//
// The helpers under src/ are importable from the test files in tests/.

export const packageName = '@openhipp0/e2e' as const;
export const version = '0.0.0' as const;

export { FakeLLMProvider, type LLMScriptStep } from './fake-llm.js';
export { createFullStack, type FullStack, type FullStackOptions } from './fixture.js';
