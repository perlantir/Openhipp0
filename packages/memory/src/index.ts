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

/** Contradiction detection + edge recording. */
export * as contradict from './contradict/index.js';

/** Context compilation: 5-signal scoring + H0C compression (markdown/h0c/ultra). */
export * as compile from './compile/index.js';

/** Hermes self-learning: skill creation + improvement, memory nudging, session compression. */
export * as learning from './learning/index.js';

/** Honcho-style incremental user modeling. */
export * as userModel from './user-model/index.js';

/** Cross-session recall via FTS5. */
export * as recall from './recall/index.js';

/** @openhipp0/core MemoryAdapter implementation that wires all the above together. */
export * as adapter from './adapter/index.js';
