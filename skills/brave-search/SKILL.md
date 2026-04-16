# Brave Search

When you need current web information, call the `brave_search` tool. It
queries the Brave Search API and returns a ranked JSON list of results.

## When to use

- Anything that requires fresh information the LLM's training data is unlikely
  to cover.
- Verifying claims against a live source before recording them as decisions.
- Competitive / market research where multiple results help triangulate.

## Setup

Set `HIPP0_BRAVE_API_KEY` in the environment (free tier at
https://brave.com/search/api/). The skill's tool rate-limits to 1 req/sec with
a burst of 3 so the free-tier monthly quota isn't exhausted accidentally.

## Pattern

1. Call `brave_search` with a focused query (Brave's ranking rewards specificity).
2. Prefer 5–10 results, then re-summarize.
3. For any result you act on, cite the URL verbatim in your reply.
