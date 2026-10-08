param([switch]$Test)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$previousFlags = $env:CARGO_ENCODED_RUSTFLAGS
$previousTarget = $env:CARGO_TARGET_DIR
$buildDir = Join-Path ([IO.Path]::GetTempPath()) ('perk-finder-build-' + [Guid]::NewGuid().ToString('N'))
# Remap every Windows drive prefix, including dependencies and build-script paths.
# Encoded flags preserve paths containing spaces without shell quoting hazards.
$flags = @()
if ($previousFlags) { $flags += $previousFlags.Split([char]31) }
foreach ($drive in [IO.DriveInfo]::GetDrives()) {
    $flags += '--remap-path-prefix=' + $drive.Name + '=/build/'
    $flags += '--remap-path-prefix=' + $drive.Name.Replace('\','/') + '=/build/'
}
if ($env:USERPROFILE) {
    $flags += '--remap-path-prefix=' + $env:USERPROFILE + '=/builder'
    $flags += '--remap-path-prefix=' + $env:USERPROFILE.Replace('\','/') + '=/builder'
}
$flags += '--remap-path-prefix=' + $PSScriptRoot + '=/project/source'
$flags += '--remap-path-prefix=' + $PSScriptRoot.Replace('\','/') + '=/project/source'
$env:CARGO_ENCODED_RUSTFLAGS = $flags -join [char]31
$env:CARGO_TARGET_DIR = $buildDir
Push-Location $PSScriptRoot
try {
    if ($Test) {
        cargo test --release --locked
        if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed.' }
    }
    cargo build --release --locked
    if ($LASTEXITCODE -ne 0) { throw 'Rust build failed.' }
    & "$PSScriptRoot\tests\privacy.ps1" -Executable "$buildDir\release\perk-finder.exe" -BinaryOnly
    Copy-Item -LiteralPath "$buildDir\release\perk-finder.exe" -Destination "$repoRoot\Perk Finder.exe"
    Write-Output 'Built sanitized Perk Finder.exe.'
} finally {
    Pop-Location
    $env:CARGO_ENCODED_RUSTFLAGS = $previousFlags
    $env:CARGO_TARGET_DIR = $previousTarget
}
