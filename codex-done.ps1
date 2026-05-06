# Helper script to manually trigger Codex Notifier by writing into `.codex-notify`.
# Usage:
#   .\codex-done.ps1
#   .\codex-done.ps1 -Kind error
#   .\codex-done.ps1 -Kind complete -Message "custom text"
param(
  [ValidateSet("complete", "error")]
  [string]$Kind = "complete",
  [string]$Message = ""
)

# Use this script's folder as workspace root for predictable behavior.
$workspaceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$notifyFile = Join-Path $workspaceRoot ".codex-notify"
$ts = Get-Date -Format o

# Default message includes kind + timestamp so file changes are always unique.
if ([string]::IsNullOrWhiteSpace($Message)) {
  $Message = "$Kind $ts"
}

# Writing this file is what the extension watcher listens for.
Set-Content -LiteralPath $notifyFile -Value $Message -Encoding utf8
Write-Output "Wrote: $notifyFile -> $Message"
