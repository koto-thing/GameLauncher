$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExecutable = Join-Path $projectRoot ".venv\Scripts\python.exe"
$uploaderRoot = Join-Path $projectRoot "apps\intake-uploader"

if (-not (Test-Path -LiteralPath $pythonExecutable -PathType Leaf)) {
    throw ".venv was not found. Follow the setup steps in apps/intake-uploader/README_JA.md."
}

Push-Location $projectRoot
try {
    $env:PYTHONPATH = Join-Path $uploaderRoot "src"
    & $pythonExecutable -m pandd_intake_uploader.main
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
