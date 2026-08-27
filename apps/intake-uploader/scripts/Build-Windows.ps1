[CmdletBinding()]
param(
    [string]$PythonExecutable = "",
    [ValidateSet("hide", "force")]
    [string]$ConsoleMode = "hide"
)

$ErrorActionPreference = "Stop"

$uploaderRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$projectRoot = (Resolve-Path (Join-Path $uploaderRoot "..\..")).Path
$buildEnvironment = Join-Path $projectRoot ".venv-uploader-build"
$buildPythonExecutable = Join-Path $buildEnvironment "Scripts\python.exe"
$deployExecutable = Join-Path $buildEnvironment "Scripts\pyside6-deploy.exe"
$sourceRoot = Join-Path $uploaderRoot "src"
$packageRoot = Join-Path $sourceRoot "pandd_intake_uploader"
$entryPoint = Join-Path $packageRoot "main.py"
$deploySpec = Join-Path $packageRoot "pysidedeploy.spec"
$artifactRoot = Join-Path $uploaderRoot "artifacts"
$artifactExecutable = Join-Path $artifactRoot "PandDIntakeUploader.exe"
$schemaSource = (Join-Path $projectRoot "packages\contracts\schemas").Replace("\", "/")

if (-not (Test-Path -LiteralPath $buildPythonExecutable -PathType Leaf)) {
    if ($PythonExecutable) {
        & $PythonExecutable -m venv $buildEnvironment
    } else {
        $pythonLauncher = (Get-Command py.exe -ErrorAction Stop).Source
        & $pythonLauncher -3.12 -m venv $buildEnvironment
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Python 3.12 is required to create the Windows executable."
    }
}
& $buildPythonExecutable -m pip install --disable-pip-version-check -e $uploaderRoot
if ($LASTEXITCODE -ne 0) {
    throw "Could not prepare the Qt deployment environment."
}

$env:PYTHONPATH = $sourceRoot
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
if (Test-Path -LiteralPath $artifactExecutable) {
    Remove-Item -LiteralPath $artifactExecutable -Force
}
if (Test-Path -LiteralPath $deploySpec) {
    Remove-Item -LiteralPath $deploySpec -Force
}
& $deployExecutable $entryPoint --init --force --name PandDIntakeUploader --mode onefile
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $deploySpec -PathType Leaf)) {
    throw "Could not initialize the Qt deployment configuration."
}

$configuration = Get-Content -LiteralPath $deploySpec -Raw
$configuration = $configuration -replace '(?m)^project_dir = .*$', "project_dir = $packageRoot"
$configuration = $configuration -replace '(?m)^input_file = .*$', "input_file = main.py"
$configuration = $configuration -replace '(?m)^exec_directory = .*$', "exec_directory = $artifactRoot"
$configuration = $configuration.Replace(
    "extra_args = --quiet --noinclude-qt-translations",
    "extra_args = --quiet --noinclude-qt-translations --assume-yes-for-downloads --windows-console-mode=$ConsoleMode --include-data-dir=$schemaSource=packages/contracts/schemas"
)
Set-Content -LiteralPath $deploySpec -Value $configuration -Encoding utf8

& $deployExecutable $entryPoint -c $deploySpec --force
if ($LASTEXITCODE -ne 0) {
    throw "The Windows uploader build failed."
}
if (-not (Test-Path -LiteralPath $artifactExecutable -PathType Leaf)) {
    throw "The uploader executable was not generated."
}

$hash = (Get-FileHash -LiteralPath $artifactExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $artifactExecutable).Length
[pscustomobject]@{
    Path = $artifactExecutable
    SizeBytes = $size
    Sha256 = $hash
}
