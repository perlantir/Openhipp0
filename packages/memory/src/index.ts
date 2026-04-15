// @openhipp0/memory — Decision graph, self-learning, user modeling, recall
//
// Phase 1d ships the DB layer. Higher-level modules (decisions/, compile/,
// learning/, user-model/, recall/, contradict/) land in Phase 2.

export const packageName = '@openhipp0/memory' as const;
export const version = '0.0.0' as const;

/** Drizzle schema, client factory, migration runner. */
export * as db from './db/index.js';
