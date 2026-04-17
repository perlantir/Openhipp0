# Browser profile management

Open Hipp0 keeps browser profiles encrypted at rest so that cookies,
localStorage, IndexedDB, extensions, and saved passwords survive across
runs without sitting plaintext on disk. Each profile launches its own
Chromium process (fingerprint isolation) and is recoverable via
WAL-style checkpoints if the daemon crashes mid-session.

## Quick start

```bash
# Set a master passphrase once per shell session.
export HIPP0_BROWSER_PASSPHRASE='<your strong passphrase>'

# Create a fresh profile.
hipp0 browser profile create ops-account --tags ops --notes "shared ops login"

# List profiles.
hipp0 browser profile list

# Check whether a profile is open or closed.
hipp0 browser profile status <id>

# Delete a profile (fails if currently open).
hipp0 browser profile delete <id>
```

## Passphrase handling

On every profile operation the CLI resolves a passphrase from, in order:

1. `HIPP0_BROWSER_PASSPHRASE` environment variable — preferred in CI /
   systemd / automation.
2. Interactive TTY prompt (coming with BFW-002).
3. Hard failure with `HIPP0-0503` when neither is available.

**Never** hard-code the passphrase in scripts; use an env source
(shell export, systemd `EnvironmentFile`, or your secrets manager).

## Importing an existing Chrome profile

```bash
# Default — import the system Chrome 'Default' profile:
hipp0 browser profile import my-chrome --accept-cookie-limitation

# Override the source:
hipp0 browser profile import work \
  --user-data-dir "$HOME/custom-chrome-user-data" \
  --profile-name "Profile 1" \
  --accept-cookie-limitation
```

### Known limitations

Chrome encrypts every cookie value with an OS-specific keyring:

- **macOS:** Keychain
- **Windows:** DPAPI
- **Linux:** libsecret / kwallet

Open Hipp0 G1-a imports the profile **structurally** — files are copied
verbatim into the managed store and re-encrypted with your Open Hipp0
passphrase. Those OS-keyring-encrypted cookie values remain encrypted;
Chromium on the same OS user + same machine will still read them,
but moving the profile to another user or machine will break any
cookie whose value depended on the OS keyring.

This is why `--accept-cookie-limitation` is required (or an interactive
confirmation). The underlying follow-up to decrypt the OS-keyring
cookies at import time is tracked as **BFW-001** in
`docs/browser/followups.md`.

What **does** travel correctly even without BFW-001:

- `localStorage`, `sessionStorage`, `IndexedDB`
- Extensions + their state
- Saved passwords (re-encrypted after Chromium logs in; same-user-machine)
- History, bookmarks, downloads list
- Site preferences, permissions

## Export + import (backup / transfer)

```bash
# Export to a portable bundle. A random recipient passphrase is generated
# and printed unless you pass --recipient-passphrase.
hipp0 browser profile export <id> ./work.hipp0profile

# Import on another machine:
hipp0 browser profile import-bundle ./work.hipp0profile restored \
  --recipient-passphrase '<from exporter>'
```

The bundle is a single JSON envelope carrying:

- Envelope version (`PROFILE_EXPORT_ENVELOPE_VERSION = 1`) for
  forward-compat when scrypt params change
- Explicit KDF params (`scrypt` N / r / p / salt)
- AES-256-GCM ciphertext of the packed profile tree
- The manifest in plaintext — inspect before decrypting

## Storage layout

```
~/.hipp0/browser-profiles/
├── <id>/
│   ├── manifest.json             plaintext, versioned
│   ├── data.enc                  last clean-close encrypted archive
│   ├── data.wal-00001.enc        in-session checkpoints (retention = 3)
│   ├── LOCK                      present only during an open session
│   ├── .active-path              physical location of `.active/` when on tmpfs
│   ├── .active/                  decrypted live Chromium user-data-dir
│   └── recovered/<iso>/          orphan-scrub artifact after a crash
```

On Linux with `$XDG_RUNTIME_DIR` or `/dev/shm` writable, `.active/`
lives on tmpfs — plaintext profile state never hits the block device.
macOS / Windows / Linux-without-tmpfs keep `.active/` on disk with
mode 0o700 instead. The `.active-path` pointer makes the physical
location discoverable to the orphan-scrub on restart.

## Crash recovery

A session writes an encrypted WAL checkpoint every 60 s (or after
500 filesystem mutations, whichever comes first). The three most
recent checkpoints are kept. On clean close the latest checkpoint
is consolidated into `data.enc` and the WAL entries are shredded.

If the daemon crashes, `ProfileManager.scrubOrphans()` at next start
replays the highest-seq checkpoint into `<profile>/recovered/<iso>/`
and marks `lastUncleanExitAt` on the manifest. You'll see
`HIPP0-0505` in logs with a pointer to the recovered artifact.

## Error codes

Browser profile errors are registered in the `HIPP0-05XX` range. See
`packages/core/src/debuggability/error-codes.ts`, or
`hipp0 debug codes | grep HIPP0-05`:

- `HIPP0-0501` profile not found
- `HIPP0-0502` profile busy (includes structured diagnostic with
  owning PID, host, session-started timestamp, and `lockStaleness`)
- `HIPP0-0503` passphrase required but no TTY + no env var
- `HIPP0-0504` archive auth failure (wrong passphrase or tampering)
- `HIPP0-0505` unclean shutdown detected — advisory, state recovered
- `HIPP0-0506` chrome import attempted without cookie-limitation ack

## Tracked follow-ups

- **BFW-001** OS-keyring cookie decrypt on import (per-OS bridges)
- **BFW-002** OS-keyring integration for the profile passphrase itself
