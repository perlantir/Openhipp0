# GitHub

Interact with GitHub: search repositories, list issues, create new issues.

## Tools

- `github_search_repos` — `q` = GitHub search-query syntax (`language:ts org:openhipp0`)
- `github_list_issues` — `owner`, `repo`, optional `state` (default `open`)
- `github_create_issue` — `owner`, `repo`, `title`, optional `body`, `labels`

## Auth

Set `HIPP0_GITHUB_TOKEN` to either:
- A classic Personal Access Token (scopes: `repo`, `read:user`), or
- A fine-grained token scoped to the specific repos you want the agent to touch.

Alternatively, run the OAuth2 wizard (Phase 10+ `hipp0 auth add github`) and the
skill will pick up the stored token automatically.

## Guidance

- **When to create vs. list:** only create an issue if the user has explicitly
  asked for one. Listing is always safe.
- **Labels:** prefer the repo's existing label vocabulary. Call `list_issues`
  first to see what's common.
- **State:** default to `open` when summarizing; pass `all` only when the user
  asks about historical context.
