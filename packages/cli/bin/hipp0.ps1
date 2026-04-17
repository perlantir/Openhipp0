# hipp0 CLI PowerShell wrapper with tab completion.
#
# Install: put this file on PATH (the MSI installer does it), or dot-source
# it from your PowerShell profile. Invoke: `hipp0 <subcommand>`.
#
# Node.js 22+ required.

$ErrorActionPreference = "Stop"

function hipp0 {
    $binDir = Split-Path -Parent $PSCommandPath
    $entry = Join-Path $binDir 'hipp0.js'
    & node $entry @args
    exit $LASTEXITCODE
}

# Tab-completion for the top-level subcommands. The list is static —
# commander handles nested completion at runtime.
Register-ArgumentCompleter -CommandName hipp0 -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $tokens = @(
        'init', 'config', 'status', 'start', 'stop', 'restart', 'serve',
        'doctor', 'skill', 'agent', 'cron', 'memory', 'benchmark',
        'migrate', 'update', 'browser', 'debug', 'marketplace', 'backup'
    )
    $tokens | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
}

Export-ModuleMember -Function hipp0
