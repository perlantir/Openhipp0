// Public surface of @openhipp0/core/auth.

export { OAuth2Client, type OAuth2ClientConfig } from './oauth2.js';
export {
  inMemoryTokenStore,
  fileTokenStore,
  type FileTokenStoreOptions,
} from './token-store.js';
export {
  PROVIDERS,
  GOOGLE,
  GOOGLE_GMAIL,
  GOOGLE_CALENDAR,
  MICROSOFT,
  GITHUB,
  SLACK,
  NOTION,
  LINEAR,
} from './providers.js';
export { createPkceVerifier, deriveChallenge } from './pkce.js';
export type {
  OAuth2Fetch,
  OAuth2Provider,
  OAuth2TokenSet,
  TokenStore,
} from './types.js';
