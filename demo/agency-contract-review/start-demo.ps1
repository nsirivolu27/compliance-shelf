param([ValidateRange(1024, 65000)][int]$Port = 5017)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$nodePath = Join-Path $repoRoot '.local\tools\node-v22.23.5-win-x64\node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) {
    throw 'The portable Node 22 runtime is missing from .local\tools. Restore it before starting this demo.'
}
$previousPort = $env:PORT
Push-Location -LiteralPath $repoRoot
try {
    $env:PORT = [string]$Port
    & $nodePath services/contract-review-demo.mjs
    if ($LASTEXITCODE -ne 0) { throw "Demo exited with code $LASTEXITCODE. Check the messages above." }
} finally {
    $env:PORT = $previousPort
    Pop-Location
}
