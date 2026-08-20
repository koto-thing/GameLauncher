[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Path = ".env"
)

$resolvedPath = Resolve-Path -LiteralPath $Path -ErrorAction Stop

foreach ($line in [System.IO.File]::ReadAllLines($resolvedPath)) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) {
        continue
    }

    if ($trimmed.StartsWith('export ')) {
        $trimmed = $trimmed.Substring(7).TrimStart()
    }

    $separator = $trimmed.IndexOf('=')
    if ($separator -lt 1) {
        throw "Invalid .env line (expected NAME=value): $line"
    }

    $name = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()
    if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
        throw "Invalid environment variable name: $name"
    }

    if ($value.Length -ge 2) {
        $first = $value[0]
        $last = $value[$value.Length - 1]
        if (($first -eq '"' -and $last -eq '"') -or
            ($first -eq "'" -and $last -eq "'")) {
            $value = $value.Substring(1, $value.Length - 2)
        }
    }

    [System.Environment]::SetEnvironmentVariable($name, $value, 'Process')
}

Write-Host "Loaded environment variables from $resolvedPath"
