/**
 * Public surface of @openhipp0/memory/decisions.
 */

export {
  OpenAIEmbeddingProvider,
  DeterministicEmbeddingProvider,
  EMBEDDING_DIM,
  cosineSimilarity,
  normalize,
  serializeEmbedding,
  deserializeEmbedding,
  type EmbeddingProvider,
  type OpenAIEmbeddingOptions,
} from './embeddings.js';

export { normalizeTag, normalizeTags, tagSimilarity, tagOverlapCount } from './tags.js';

export {
  createDecision,
  getDecision,
  updateDecision,
  supersedeDecision,
  deleteDecision,
  decodeEmbedding,
  type CreateDecisionInput,
  type CreateDecisionOptions,
  type UpdateDecisionInput,
} from './record.js';

export {
  insertEdge,
  outgoingEdges,
  incomingEdges,
  deleteEdge,
  type InsertEdgeInput,
  type Relationship,
} from './edges.js';

export {
  listByProject,
  semanticSearch,
  semanticSearchByVector,
  filterByTags,
  type DecisionStatus,
  type SemanticHit,
  type SemanticSearchOptions,
  type TagHit,
  type FilterByTagsOptions,
  type ListByProjectOptions,
} from './query.js';
