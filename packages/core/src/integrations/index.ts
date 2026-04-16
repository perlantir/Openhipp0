/**
 * Integration tools — one module per third-party service.
 *
 * Phase 10 ships four representative integrations:
 *   - brave   (web search, API key)
 *   - github  (repos / issues, PAT or OAuth2)
 *   - gmail   (search / send, OAuth2 via GOOGLE_GMAIL provider)
 *   - linear  (issues, OAuth2 or personal API key)
 *
 * Remaining integrations from the Phase 10 plan (Outlook, Google Calendar,
 * Notion, Obsidian, Todoist, Trello, Drive, Dropbox, Slack-as-skill, Jira,
 * Home Assistant, Philips Hue, Spotify) are scaffolded in the handoff
 * prompt as "clone this pattern". Each one is <150 lines given this HTTP
 * + auth foundation.
 */

export { braveSearchTool, createBraveSearchTool, type BraveConfig } from './brave/tools.js';
export {
  createGithubSearchReposTool,
  createGithubListIssuesTool,
  createGithubCreateIssueTool,
  githubSearchReposTool,
  githubListIssuesTool,
  githubCreateIssueTool,
  type GitHubConfig,
} from './github/tools.js';
export {
  createGmailSearchTool,
  createGmailSendTool,
  type GmailConfig,
} from './gmail/tools.js';
export {
  createLinearListIssuesTool,
  createLinearCreateIssueTool,
  type LinearConfig,
} from './linear/tools.js';
export { authedFetch, RateLimiter, fetchWithRetry, type AuthedFetchOptions } from './http.js';
