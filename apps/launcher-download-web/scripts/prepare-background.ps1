<#
.SYNOPSIS
Creates the background MP4 and poster from the three supplied clips, preserving all originals.
.PARAMETER SourceDirectory
Directory containing 紹介PV.mp4, douga.mp4 and 10PV.mov. Requires FFmpeg on PATH.
#>
param([Parameter(Mandatory = $true)][string]$SourceDirectory)
$ErrorActionPreference = 'Stop'
$sources = @('紹介PV.mp4', 'douga.mp4', '10PV.mov') | ForEach-Object {
    (Resolve-Path -LiteralPath (Join-Path $SourceDirectory $_)).Path
}
$mediaDirectory = Join-Path $PSScriptRoot '../public/media'
$videoOutput = Join-Path $mediaDirectory 'showreel-202609-v1.mp4'
$posterOutput = Join-Path $mediaDirectory 'showreel-202609-v1.jpg'
# Normalize size, pixel aspect and frame rate before joining; drop audio entirely.
$filters = 0..2 | ForEach-Object {
    "[$($_):v]fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS[v$_]"
}
$filterGraph = ($filters -join ';') + ';[v0][v1][v2]concat=n=3:v=1:a=0[v]'
& ffmpeg -hide_banner -loglevel warning -y -i $sources[0] -i $sources[1] -i $sources[2] -filter_complex $filterGraph -map '[v]' -an -c:v libx264 -preset medium -crf 24 -pix_fmt yuv420p -movflags +faststart $videoOutput
if ($LASTEXITCODE -ne 0) { throw 'Background encoding failed' }
& ffmpeg -hide_banner -loglevel error -y -ss 2 -i $videoOutput -frames:v 1 -q:v 3 $posterOutput
if ($LASTEXITCODE -ne 0) { throw 'Poster extraction failed' }
