# Skill Template

Copy `skills/_template/` to `skills/<your-skill>/` and edit this file + the
manifest. The skill loader skips `_`-prefixed directories so this template
won't accidentally register itself.

## Sections agent operators expect

- **When to use** — the shape of user intent that should activate this skill.
- **Auth** — any env vars or OAuth flows the tools require.
- **Guidance** — decision rules the agent should follow before calling tools.
- **Examples** — a short dialog illustrating correct usage.
