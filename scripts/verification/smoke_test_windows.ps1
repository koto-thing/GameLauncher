param(
    [Parameter(Mandatory = $true)]
    [string]$Executable
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$resolvedExecutable = (Resolve-Path -LiteralPath $Executable).Path
$diagnosticDirectory = Join-Path $env:RUNNER_TEMP 'pandd-smoke-test'
New-Item -ItemType Directory -Path $diagnosticDirectory -Force | Out-Null
$standardOutput = Join-Path $diagnosticDirectory 'stdout.log'
$standardError = Join-Path $diagnosticDirectory 'stderr.log'

$env:PANDD_SMOKE_TEST = '1'
$env:QT_DEBUG_PLUGINS = '1'
$process = Start-Process -FilePath $resolvedExecutable `
    -ArgumentList '--smoke-test' `
    -RedirectStandardOutput $standardOutput `
    -RedirectStandardError $standardError `
    -Wait `
    -PassThru

Write-Host "Launcher smoke-test exit code: $($process.ExitCode)"
if ($process.ExitCode -eq 0) {
    exit 0
}

Write-Host 'Deployed Windows files:'
Get-ChildItem -LiteralPath (Split-Path -Parent $resolvedExecutable) -Recurse -File |
    Sort-Object FullName |
    ForEach-Object { Write-Host "  $($_.FullName) ($($_.Length) bytes)" }

foreach ($stream in @($standardOutput, $standardError)) {
    if ((Test-Path -LiteralPath $stream) -and (Get-Item -LiteralPath $stream).Length -gt 0) {
        Write-Host "Contents of ${stream}:"
        Get-Content -LiteralPath $stream
    }
}

$applicationData = Join-Path $env:LOCALAPPDATA 'PandD_org\GameLauncher'
if (Test-Path -LiteralPath $applicationData) {
    Get-ChildItem -LiteralPath $applicationData -Recurse -File -Filter '*.log' |
        Sort-Object FullName |
        ForEach-Object {
            Write-Host "Contents of $($_.FullName):"
            Get-Content -LiteralPath $_.FullName
        }
}

throw "Launcher smoke test failed with exit code $($process.ExitCode)"
