# Starts the bundled worker briefly and asserts it boots cleanly.
# Useful after changing the worker's module graph: a broken bundle or a circular
# import shows up here immediately rather than on the VPS.
$outFile = Join-Path $env:TEMP 'adcrevia-worker-smoke-out.txt'
$errFile = Join-Path $env:TEMP 'adcrevia-worker-smoke-err.txt'
Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue

if (-not (Test-Path 'dist/worker.mjs')) {
    Write-Output 'dist/worker.mjs missing - run: node scripts/build-worker.mjs'
    exit 1
}

$proc = Start-Process -FilePath 'node' `
    -ArgumentList 'dist/worker.mjs' `
    -RedirectStandardOutput $outFile `
    -RedirectStandardError $errFile `
    -PassThru -NoNewWindow

Start-Sleep -Seconds 5
if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
Start-Sleep -Seconds 1

$all = ''
if (Test-Path $outFile) { $all += (Get-Content $outFile -Raw) }
if (Test-Path $errFile) { $all += (Get-Content $errFile -Raw) }

Write-Output '=== stdout ==='
if (Test-Path $outFile) { Get-Content $outFile -TotalCount 8 }

Write-Output '=== checks ==='
Write-Output ('boots                   : ' + $(if ($all -match '\[worker\] starting') { 'yes' } else { 'NO' }))
Write-Output ('handlers registered     : ' + $(if ($all -match 'IMAGE_GENERATE') { 'yes' } else { 'NO' }))
Write-Output ('ESM loaded cleanly      : ' + $(if ($all -match 'MODULE_TYPELESS') { 'NO - warning present' } else { 'yes' }))
Write-Output ('no import/cycle crash   : ' + $(if ($all -match 'Cannot access|is not a function|before initialization') { 'NO - cycle symptom' } else { 'yes' }))

Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue
