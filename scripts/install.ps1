$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'dsh-plugin.mjs') install @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
