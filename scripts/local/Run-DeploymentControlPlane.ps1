[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$controlPlaneRoot = Join-Path $projectRoot "apps\admin-web"
$node = (Get-Command node.exe -ErrorAction Stop).Source
$npmCli = Join-Path (Split-Path $node) "node_modules\npm\bin\npm-cli.js"

if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) {
    $npmCli = "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"
}
if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) {
    throw "npm-cli.js was not found. Install Node.js 22 or later."
}

$developmentVariables = Join-Path $controlPlaneRoot ".dev.vars"
if (-not (Test-Path -LiteralPath $developmentVariables)) {
    $randomBytes = New-Object byte[] 32
    $randomNumberGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $randomNumberGenerator.GetBytes($randomBytes)
    }
    finally {
        $randomNumberGenerator.Dispose()
    }
    $sessionSecret = -join ($randomBytes | ForEach-Object { $_.ToString("x2") })
    @(
        "LOCAL_DEV_AUTH=true"
        "SESSION_SECRET=$sessionSecret"
        "GITHUB_CLIENT_ID="
        "GITHUB_CLIENT_SECRET="
    ) | Set-Content -LiteralPath $developmentVariables -Encoding utf8
}

Push-Location $controlPlaneRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $controlPlaneRoot "node_modules"))) {
        & $node $npmCli ci --ignore-scripts --no-audit --no-fund --cache .npm-cache
        if ($LASTEXITCODE -ne 0) {
            throw "Could not prepare the control-plane dependencies."
        }
    }
    & $node $npmCli run dev
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
