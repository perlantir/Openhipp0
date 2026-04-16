# Gmail

OAuth2-authenticated access to the authenticated user's Gmail account.

## Tools

- `gmail_search` — Gmail search syntax (`from:`, `subject:`, `after:`, etc.)
- `gmail_send` — send a plain-text email

## Auth

This skill uses the `GOOGLE_GMAIL` OAuth2 provider. Set up once with:

```bash
hipp0 auth add google-gmail    # Phase 10+ wizard
```

The skill instantiates an `OAuth2Client` keyed on `google-gmail` + the
authenticated account name. Refresh tokens are stored under
`~/.hipp0/auth/google-gmail__<account>.json` with 0o600 perms.

## Guidance

- **Never send without approval.** For any `gmail_send` call, first reply to
  the user with the draft (To / Subject / Body) and wait for explicit
  confirmation. The execution governance layer (Phase 5.3) can enforce this
  automatically when `send` is listed as an approved-action.
- **Search first.** Before drafting a follow-up, search for the original
  thread so the reply preserves context.
- **Subject lines:** prefer the original subject with `Re:` prefix on replies.
