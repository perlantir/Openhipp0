# Linear

Interact with Linear's GraphQL API: list assigned issues, create new issues.

## Tools

- `linear_list_issues` — returns the authenticated user's assigned issues
  (id, identifier, title, state, priority, URL).
- `linear_create_issue` — creates an issue in the given team (`teamId`,
  `title`, optional `description`).

## Auth

Two options:

1. **Personal API key** — set `HIPP0_LINEAR_KEY` to a key minted at
   https://linear.app/settings/api. Linear accepts it directly in the
   `Authorization` header (no Bearer prefix).
2. **OAuth2** — use the `LINEAR` provider (`linear:read`, `linear:write`
   scopes). The Phase 10+ wizard handles the consent flow.

## Guidance

- **Never create without approval.** Put the exact `title` + `description`
  in your reply first and wait for explicit confirmation.
- **Team IDs:** `linear_list_issues` surfaces each issue's team identifier
  (e.g. `ENG-123`). The team ID for `linear_create_issue` is the UUID, not
  the slug — list first, then mint.
