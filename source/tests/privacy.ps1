param(
    [string]$Executable = (Join-Path $PSScriptRoot '..\..\Perk Finder.exe'),
    [switch]$BinaryOnly
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$files = @((Resolve-Path -LiteralPath $Executable).Path)
if (!$BinaryOnly) {
    # Git quotes filenames with spaces; disable quoting by enumerating NUL-delimited output.
    $raw = & git -c "safe.directory=$repoRoot" -C $repoRoot -c core.quotepath=false ls-files --cached --others --exclude-standard -z
    if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate publishable files.' }
    $files += (($raw -join "`n").Split([char]0) | Where-Object { $_ } | ForEach-Object { Join-Path $repoRoot $_ })
}
$patterns = @{
    'personal build path' = '(?i)(?:[a-z]:[\\/]+Users[\\/]+|/(?:Users|home)/[^/\s]+/)'
    'private key or credential' = '(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})'
}
if ($env:COMPUTERNAME -and $env:COMPUTERNAME.Length -gt 4) {
    $patterns['local computer name'] = '(?i)' + [regex]::Escape($env:COMPUTERNAME)
}
$problems = @()
$files = @($files | Sort-Object -Unique)
foreach ($file in $files) {
    $bytes = [IO.File]::ReadAllBytes($file)
    foreach ($encoding in @([Text.Encoding]::UTF8, [Text.Encoding]::Unicode)) {
        $text = $encoding.GetString($bytes)
        foreach ($entry in $patterns.GetEnumerator()) {
            if ([regex]::IsMatch($text,$entry.Value)) {
                # Report categories and relative filenames, never secret contents.
                $label = if ($file.StartsWith($repoRoot)) { $file.Substring($repoRoot.Length) } else { [IO.Path]::GetFileName($file) }
                $problems += "$label : $($entry.Key)"
            }
        }
    }
}
if ($problems.Count) { throw ('Privacy scan failed: ' + (($problems | Sort-Object -Unique) -join '; ')) }
Write-Output "PASS: privacy patterns absent from $($files.Count) files (UTF-8 and UTF-16)."
