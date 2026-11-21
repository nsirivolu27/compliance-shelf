param(
    [ValidateSet('va-ssa', 'va-audit')][string]$Scenario = 'va-ssa',
    [ValidateRange(1024, 65000)][int]$Port = 5217
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodePath = Join-Path $repoRoot '.local\tools\node-v22.23.5-win-x64\node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) {
    throw 'Portable Node 22 is missing. With Node 22.18+ configured, use npm run demo:agencies or npm run demo:va instead.'
}
$runner = if ($Scenario -eq 'va-audit') { 'services/contract-review-demo.mjs' } else { 'services/pitch-demo.mjs' }
$previousPort = $env:PORT
$previousDataRoot = $env:DEMO_DATA_ROOT
Push-Location -LiteralPath $repoRoot
try {
    $env:PORT = [string]$Port
    # Rehearsal writes stay outside the synced source folder. Every launch still gets a new directory.
    $env:DEMO_DATA_ROOT = Join-Path ([IO.Path]::GetTempPath()) "compliance-platform-demos\$Scenario"
    & $nodePath $runner
    if ($LASTEXITCODE -ne 0) { throw "Demo exited with code $LASTEXITCODE. Check the messages above." }
} finally {
    $env:PORT = $previousPort
    $env:DEMO_DATA_ROOT = $previousDataRoot
    Pop-Location
}
