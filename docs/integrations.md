# Integrations (Phases 10 + 17)

Open Hipp0 ships 20 integrations as agentskills.io-format skills. Each
pairs a JSON manifest (`skills/<name>/manifest.json`) with a natural-
language spec (`SKILL.md`) and one or more tool factories under
`packages/core/src/integrations/<name>/tools.ts`.

## Catalog

| Skill | Auth | Tools |
|---|---|---|
| **brave-search** | `HIPP0_BRAVE_API_KEY` | `brave_search` |
| **github** | GitHub PAT or OAuth2 | `github_search_repos`, `github_list_issues`, `github_create_issue` |
| **gmail** | Google OAuth2 | `gmail_search`, `gmail_send` |
| **linear** | Linear OAuth2 or `HIPP0_LINEAR_KEY` | `linear_list_issues`, `linear_create_issue` |
| **todoist** | `HIPP0_TODOIST_TOKEN` | `todoist_list_tasks`, `todoist_add_task` |
| **outlook** | Microsoft OAuth2 | `outlook_search` |
| **apple-calendar** | Basic auth (CalDAV) | `apple_calendar_list` |
| **google-calendar** | Google OAuth2 | `google_calendar_list`, `google_calendar_create` |
| **notion** | `NOTION_TOKEN` | `notion_search` |
| **obsidian** | Local vault path | `obsidian_read_note` |
| **trello** | `TRELLO_API_KEY` + `TRELLO_TOKEN` | `trello_list_boards` |
| **google-drive** | Google OAuth2 | `google_drive_search` |
| **dropbox** | `DROPBOX_ACCESS_TOKEN` | `dropbox_search` |
| **jira** | `JIRA_EMAIL` + `JIRA_API_TOKEN` | `jira_search_issues` |
| **home-assistant** | `HOMEASSISTANT_TOKEN` | `home_assistant_call_service` |
| **philips-hue** | `HUE_APPLICATION_KEY` | `hue_list_lights`, `hue_set_light` |
| **spotify** | Spotify OAuth2 | `spotify_search` |
| **twilio-sms** | `TWILIO_ACCOUNT_SID` / `..._TOKEN` / `..._FROM` | `twilio_send_sms` |
| **mattermost** | `MATTERMOST_TOKEN` | `mattermost_post` |

## Pattern: add a new integration in ~120 LOC

1. Create `packages/core/src/integrations/<name>/tools.ts` exporting one
   or more tool factories. Use the shared helpers in
   `_helpers.ts` (`httpErr`, `missingKey`, `runSafely`) and
   `http.ts` (`fetchWithRetry`, `authedFetch`, `RateLimiter`).
2. Wire it through `packages/core/src/integrations/index.ts`.
3. Add the skill folder under `skills/<slug>/` with `manifest.json` +
   `SKILL.md` — copy the shape from `skills/gmail/`.
4. Add at least three tests in
   `packages/core/tests/integrations/<name>.test.ts` mocking `fetch`:
   missing-credential guard, happy-path, HTTP error.
5. Re-run `hipp0 skill audit` to verify the manifest.

## OAuth2 flow

Phase 10 ships `packages/core/src/auth/` with:

- `OAuth2Client` — authorization-code + PKCE, token refresh.
- `TokenStore` — in-memory + file-backed (encrypted at rest).
- Provider presets for Google (Gmail / Calendar / Drive), Microsoft,
  GitHub, Slack, Notion, Linear, Spotify.

Integrations receive an `OAuth2Client` in their config; the client resolves
the per-account token and refreshes automatically when it expires.

## Real-API tests

All in-tree tests mock `fetch`. Add real-API tests behind an env-gated
`test.skipIf(!process.env.FOO_API_KEY, '…')` per integration.
