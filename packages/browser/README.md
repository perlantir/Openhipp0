# @openhipp0/browser

Higher-level browser automation for Open Hipp0.

This package builds on the primitives in `@openhipp0/core/browser`
(`BrowserDriver`, `BrowserEngine`, SSRF guard, stealth helpers, credential
vault) and adds the capabilities that make browser automation a first-class
strength: encrypted per-task profiles, page snapshots, workflow recording,
multi-tab orchestration, network inspection, and site memory.

**G1-a (this sub-phase)** ships profile management only:

- Encrypted-at-rest profile storage (AES-256-GCM, scrypt-derived keys)
- One Chromium process per open profile (isolation)
- Periodic encrypted checkpoints during a session (WAL-style, 60s cadence)
- Orphan scrub on startup (unclean-shutdown recovery)
- Import from a system Chrome profile
- Portable export / import as `.hipp0profile` bundle

See `docs/browser/profile-management.md` for the user guide,
`docs/browser/followups.md` for tracked deferred work, and `CLAUDE.md`
(section "Phase G1-a") for the decision log.
