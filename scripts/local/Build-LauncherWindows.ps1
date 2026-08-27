param(
    [Parameter(Mandatory = $true)][string]$QtRoot,
    [Parameter(Mandatory = $true)][string]$CubismSdkRoot,
    [Parameter(Mandatory = $true)][string]$VcpkgRoot,
    [ValidateSet('Debug', 'Release')][string]$Configuration = 'Debug'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vsRoot = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.14.44.17.14.x86.x64 -property installationPath
if (-not $vsRoot) {
    throw 'Install the MSVC v143 (14.44) x64/x86 build tools before building the launcher.'
}
Import-Module (Join-Path $vsRoot 'Common7/Tools/Microsoft.VisualStudio.DevShell.dll')
Enter-VsDevShell -VsInstallPath $vsRoot -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64 -vcvars_ver=14.44'
# Keep CMake's localized /showIncludes detection and Ninja on the same code page.
chcp 65001 > $null
$env:VSLANG = '1033'

$qtPath = (Resolve-Path -LiteralPath $QtRoot).Path
$sdkPath = (Resolve-Path -LiteralPath $CubismSdkRoot).Path
$vcpkgPath = (Resolve-Path -LiteralPath $VcpkgRoot).Path
$buildPath = Join-Path $projectRoot ('build/msvc-' + $Configuration.ToLowerInvariant())
& cmake -S $projectRoot -B $buildPath -G Ninja `
    "-DCMAKE_BUILD_TYPE=$Configuration" `
    "-DCMAKE_PREFIX_PATH=$qtPath" `
    "-DPANDD_CUBISM_SDK_ROOT=$sdkPath" `
    "-DCMAKE_TOOLCHAIN_FILE=$vcpkgPath/scripts/buildsystems/vcpkg.cmake" `
    '-DVCPKG_TARGET_TRIPLET=x64-windows' `
    '-DBUILD_TESTING=ON' '-DPANDD_DISTRIBUTION_ENV=staging'
if ($LASTEXITCODE -ne 0) { throw 'CMake configuration failed.' }
& cmake --build $buildPath --parallel
if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed.' }
& ctest --test-dir $buildPath --output-on-failure
if ($LASTEXITCODE -ne 0) { throw 'Launcher tests failed.' }
