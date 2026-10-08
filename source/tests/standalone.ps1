param([string]$Executable = (Join-Path $PSScriptRoot '..\..\Perk Finder.exe'))
$ErrorActionPreference = 'Stop'
$exe = (Resolve-Path -LiteralPath $Executable).Path
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('perk-finder-standalone-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
Copy-Item -LiteralPath $exe -Destination "$testDir\Perk Finder.exe"
$info = New-Object Diagnostics.ProcessStartInfo
$info.FileName = "$testDir\Perk Finder.exe"
$info.WorkingDirectory = $testDir
$info.Arguments = 'serve --no-browser --address-file address.txt'
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.EnvironmentVariables['PATH'] = ''
$process = [Diagnostics.Process]::Start($info)
try {
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while (!(Test-Path -LiteralPath "$testDir\address.txt")) {
        if ($process.HasExited -or [DateTime]::UtcNow -gt $deadline) { throw 'Standalone server did not start.' }
        Start-Sleep -Milliseconds 100
    }
    $url = Get-Content -LiteralPath "$testDir\address.txt" -Raw
    foreach ($asset in @('/','/boot.js','/THIRD-PARTY-NOTICES.txt','/vendor/runescape/perkfinder-native-worker.js')) {
        $response = Invoke-WebRequest -UseBasicParsing -Uri ($url+$asset)
        if ($response.StatusCode -ne 200) { throw "Missing embedded asset $asset" }
    }
    $request = Get-Content -LiteralPath "$PSScriptRoot\..\benchmarks\impatient-mobile.json" -Raw
    $result = Invoke-RestMethod -Uri "$url/api/search" -Method Post -ContentType 'application/json' -Body $request
    if ($result.cancelled -or $result.rows.Count -ne 5050) { throw 'Benchmark result count mismatch.' }
    $best = ($result.rows | Measure-Object -Property probPerGizmo -Maximum).Maximum
    if ([Math]::Abs($best - 0.3157822691005798) -gt 1e-12) { throw 'Benchmark probability mismatch.' }
    Write-Output "PASS: EXE-only copy; empty PATH; embedded assets/notices; 5050 results; search $($result.searchMs) ms."
    Write-Output "Temporary test copy retained: $testDir"
} finally {
    if (!$process.HasExited) { $process.Kill(); $process.WaitForExit() }
    $process.Dispose()
}
