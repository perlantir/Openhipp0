---
name: Bug report
about: Something is broken and the fix isn't obvious.
title: ''
labels: bug
assignees: ''
---

## Summary

<!-- One sentence. What is broken? -->

## Reproduction

<!--
Smallest sequence of commands / code that reproduces. If you can paste
a 10-line repro, do that. If it takes a full environment, describe the
environment precisely.
-->

```bash
# commands / code
```

## Expected vs. actual

- **Expected:**
- **Actual:**

## Environment

- OS + version:
- Node version (`node -v`):
- pnpm version (`pnpm -v`):
- Open Hipp0 commit / version:
- Database: SQLite / Postgres?

## Debug bundle

<!--
Run `hipp0 debug` and paste the redacted output here.
Open Hipp0 runs no upload endpoint; you paste, we read.
-->

<details>
<summary>hipp0 debug output</summary>

```
<paste here>
```

</details>

## Error code (if any)

<!-- HIPP0-XXXX or HIPP0_XXX from stderr. See `hipp0 debug codes`. -->

## Additional context

<!-- Screenshots, links to failing CI runs, related issues. -->
