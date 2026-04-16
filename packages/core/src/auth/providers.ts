/**
 * Built-in OAuth2 provider presets. Each entry is a minimal, spec-accurate
 * description of the authorization and token endpoints plus the default
 * scopes that most callers want. Callers override scopes per call.
 */

import type { OAuth2Provider } from './types.js';

export const GOOGLE: OAuth2Provider = {
  id: 'google',
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  defaultScopes: ['openid', 'email', 'profile'],
  requiresOfflineConsent: true,
};

export const GOOGLE_GMAIL: OAuth2Provider = {
  ...GOOGLE,
  id: 'google-gmail',
  defaultScopes: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
  ],
};

export const GOOGLE_CALENDAR: OAuth2Provider = {
  ...GOOGLE,
  id: 'google-calendar',
  defaultScopes: ['https://www.googleapis.com/auth/calendar.events'],
};

export const MICROSOFT: OAuth2Provider = {
  id: 'microsoft',
  authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  defaultScopes: ['openid', 'profile', 'offline_access'],
  requiresOfflineConsent: true,
};

export const GITHUB: OAuth2Provider = {
  id: 'github',
  authorizationEndpoint: 'https://github.com/login/oauth/authorize',
  tokenEndpoint: 'https://github.com/login/oauth/access_token',
  defaultScopes: ['read:user', 'repo'],
};

export const SLACK: OAuth2Provider = {
  id: 'slack',
  authorizationEndpoint: 'https://slack.com/oauth/v2/authorize',
  tokenEndpoint: 'https://slack.com/api/oauth.v2.access',
  defaultScopes: ['chat:write', 'channels:read'],
};

export const NOTION: OAuth2Provider = {
  id: 'notion',
  authorizationEndpoint: 'https://api.notion.com/v1/oauth/authorize',
  tokenEndpoint: 'https://api.notion.com/v1/oauth/token',
  defaultScopes: [], // Notion scopes are configured in the Notion app settings
  authorizeExtraParams: { owner: 'user' },
};

export const LINEAR: OAuth2Provider = {
  id: 'linear',
  authorizationEndpoint: 'https://linear.app/oauth/authorize',
  tokenEndpoint: 'https://api.linear.app/oauth/token',
  defaultScopes: ['read', 'write'],
};

/** Lookup table for `hipp0 skill install`'s OAuth setup wizard. */
export const PROVIDERS: Record<string, OAuth2Provider> = {
  google: GOOGLE,
  'google-gmail': GOOGLE_GMAIL,
  'google-calendar': GOOGLE_CALENDAR,
  microsoft: MICROSOFT,
  github: GITHUB,
  slack: SLACK,
  notion: NOTION,
  linear: LINEAR,
};
