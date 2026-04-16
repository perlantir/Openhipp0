# apple-calendar

List events on an Apple / iCloud CalDAV calendar.

## Tools

- `apple_calendar_list`

## Auth

Basic auth (APPLE_ID + app-specific password)

## Guidance

- **Destructive actions require approval.** Any tool that creates or modifies
  external state (send a message, create a task, control a device) should
  be gated by execution governance (Phase 5.3) with `requireApproval=true`.
- **Handle failures gracefully.** These tools return `ToolResult` with
  `ok: false` on API errors — surface the `errorCode` to the user instead
  of retrying blindly.
- **Respect rate limits.** Most of these APIs cap free-tier usage; wire a
  `RateLimiter` (from `@openhipp0/core/integrations/http`) in production.

## Tests

See `packages/core/tests/integrations/phase17.test.ts` — every tool has at
least three test cases covering missing-credential, happy-path, and HTTP
error paths. All external HTTP is mocked via an injected `fetch`.
