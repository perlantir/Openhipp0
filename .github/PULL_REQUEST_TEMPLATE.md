## Summary

<!-- 1–3 bullets: what changed, why, what tradeoff. -->

## Change kind

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor (no behavior change)
- [ ] Documentation
- [ ] Security
- [ ] Breaking change (describe migration below)

## Test plan

<!-- Paste real output. "I think it passes" is not enough. -->

```
$ pnpm -r test
# (paste result)

$ pnpm -r typecheck
# (paste result)

$ pnpm -r lint
# (paste result)
```

## CLAUDE.md updated

- [ ] This PR adds / modifies a Decision Log entry.
- [ ] N/A — pure bug fix or doc change.

## Breaking change migration

<!-- Only required if "Breaking change" is checked. Describe the
migration path for existing users. -->

## Error codes touched

<!-- List any HIPP0-XXXX added or modified in
`packages/core/src/debuggability/error-codes.ts`. -->
