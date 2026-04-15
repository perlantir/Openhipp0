// @openhipp0/memory — Decision graph, self-learning, user modeling, recall
//
// Phase 1d: DB layer (schema, client, migrations).
// Phase 2a: Decision graph (CRUD, embeddings, tags, semantic search).
// Later phases add: compile/, contradict/, learning/, user-model/, recall/.

export const packageName = '@openhipp0/memory' as const;
export const version = '0.0.0' as const;

/** Drizzle schema, client factory, migration runner. */
export * as db from './db/index.js';

/** Hipp0 decision graph: CRUD, embeddings, tags, semantic/tag search. */
export * as decisions from './decisions/index.js';
