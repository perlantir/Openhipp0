# Open Hipp0 Windows installer script. Run as Administrator.
#
# Usage (from a release zip):
#   .\install.ps1 -TargetDir "C:\Program Files\OpenHipp0"
#
# Requires Node.js 22+ on PATH before installing (we don't bundle Node).

[CmdletBinding()]
param(
    [string]$TargetDir = "$env:ProgramFiles\OpenHipp0"
)

$ErrorActionPreference = "Stop"

function Assert-NodeVersion {
    try { $ver = (node --version) } catch { throw "Node.js not found on PATH. Install Node 22+ first." }
    if (-not ($ver -match '^v(\d+)')) { throw "Unexpected node --version output: $ver" }
    $major = [int]$Matches[1]
    if ($major -lt 22) { throw "Node.js $ver is too old; Open Hipp0 requires Node 22+." }
    Write-Host "Using Node $ver"
}

function Install-CliFiles {
    param([string]$TargetDir)
    if (-not (Test-Path $TargetDir)) { New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null }
    $binDir = Join-Path $TargetDir "bin"
    if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }

    $sourceCli = Join-Path $PSScriptRoot "..\packages\cli"
    if (-not (Test-Path $sourceCli)) { throw "Source CLI not found at $sourceCli. Run from the release root." }

    Copy-Item -Path (Join-Path $sourceCli "bin\*") -Destination $binDir -Force
    Copy-Item -Path (Join-Path $sourceCli "dist") -Destination $TargetDir -Recurse -Force
    Write-Host "Installed CLI files to $TargetDir"
}

function Add-BinDirToPath {
    param([string]$BinDir)
    $current = [Environment]::GetEnvironmentVariable("PATH", "Machine")
    if ($current -like "*$BinDir*") {
        Write-Host "$BinDir already on PATH"
        return
    }
    $next = "$current;$BinDir"
    [Environment]::SetEnvironmentVariable("PATH", $next, "Machine")
    Write-Host "Added $BinDir to PATH (machine-wide)"
}

Assert-NodeVersion
Install-CliFiles -TargetDir $TargetDir
Add-BinDirToPath -BinDir (Join-Path $TargetDir "bin")
Write-Host "Done. Open a new shell and run: hipp0 --version"
