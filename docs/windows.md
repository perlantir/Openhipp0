# Open Hipp0 on Windows

Open Hipp0 runs natively on Windows 10/11 and Windows Server 2022+.
This guide covers install options, path conventions, limitations,
and troubleshooting.

## Install options

1. **MSI** (recommended for operators). Download `openhipp0.msi` from
   the release, run as admin. Adds `hipp0.cmd` to PATH and creates a
   Start Menu shortcut. Uninstall via *Apps & features*.
2. **PowerShell**: `.\scripts\install.ps1 -TargetDir "C:\Program Files\OpenHipp0"`.
3. **pnpm** (dev): `pnpm install && pnpm -r build`; invoke
   `.\packages\cli\bin\hipp0.cmd`.

Node.js 22+ must be installed first (`winget install OpenJS.NodeJS.LTS`).
The MSI does not bundle Node.

## Path conventions

| Linux / macOS | Windows |
|---|---|
| `~/.hipp0/config.json` | `%LOCALAPPDATA%\OpenHipp0\config.json` |
| `~/.hipp0/data/` | `%LOCALAPPDATA%\OpenHipp0\data\` |
| `~/.hipp0/logs/` | `%LOCALAPPDATA%\OpenHipp0\logs\` |
| `~/.hipp0/browser-profiles/` | `%LOCALAPPDATA%\OpenHipp0\browser-profiles\` |

Override with `HIPP0_HOME=<absolute path>`. Helpers in
`packages/cli/src/platform-paths.ts` centralize this so downstream
code doesn't accidentally hard-code POSIX assumptions.

## Shells

- **cmd.exe**: `hipp0 --version`
- **PowerShell 5+ / 7+**: load the module with
  `Import-Module "<install>\bin\hipp0.ps1"` once (MSI installer does
  this for you). Tab completion for top-level subcommands included.
- **WSL2**: use the Linux binary inside WSL; paths follow Linux
  conventions (`~/.hipp0/`) there.

## Limitations on Windows

- **iMessage bridge** (`imessage`) is unavailable on Windows — the
  BlueBubbles relay requires macOS. Document-only.
- **Docker-dependent features** (sandboxed shell / skill install
  execution) require Docker Desktop with the WSL2 backend.
- **Some symlinks** used by the Linux browser-profile tmpfs override
  are skipped; Windows always uses on-disk `.active/`.
- **PowerShell `-File` execution-policy** may need
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` the first time.
- **Long paths**: Windows 10 1607+ supports paths > 260 chars only if
  the `LongPathsEnabled` registry flag is set. Installer sets it as a
  post-install step; manual installs may need to flip it.

## Code-signing the MSI

Releases are signed with a code-signing cert configured in CI:

```
signtool sign `
  /f $env:OPENHIPP0_SIGN_CERT `
  /p $env:OPENHIPP0_SIGN_CERT_PASSWORD `
  /t http://timestamp.digicert.com `
  openhipp0.msi
```

For non-release builds (dev / CI smoke), leave the MSI unsigned;
SmartScreen will warn on first run.

## Troubleshooting

- **`node: not recognized`** — Node isn't on PATH. Open a new shell
  after installing, or verify with `where node`.
- **`hipp0 --version` runs Node but errors** — CLI `dist/` may be
  missing. Reinstall or run `pnpm build` if installed from source.
- **`HIPP0-0502` profile busy after crash** — Windows can't signal
  the old PID; `hipp0 browser profile status <id>` shows
  `lockStaleness: unknown`. Force-release with
  `hipp0 browser profile delete <id> --kill-lock` (when available;
  file a BFW if missing).
- **Long-path errors** — enable `LongPathsEnabled` via
  `New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem"
  -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force`.
