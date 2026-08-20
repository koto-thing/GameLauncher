$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$lupdate = Get-Command lupdate.exe -ErrorAction SilentlyContinue
if (-not $lupdate) {
    $configuredQt = Get-ChildItem "D:\ProgramFiles\Qt" -Recurse -Filter lupdate.exe `
        -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $configuredQt) {
        throw "lupdate.exe was not found. Install Qt Linguist Tools first."
    }
    $lupdatePath = $configuredQt.FullName
} else {
    $lupdatePath = $lupdate.Source
}

Push-Location $projectRoot
try {
    & $lupdatePath client\src -ts client\translations\launcher_en-US.ts
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
