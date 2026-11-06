$ErrorActionPreference = "Stop"
$script = (Resolve-Path (Join-Path $PSScriptRoot "run-and-publish.ps1")).Path
$taskName = "MoneyFlowRadar-Daily-1730"
$command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $script + '"'
schtasks.exe /Create /SC DAILY /ST 17:30 /TN $taskName /TR $command /F
if ($LASTEXITCODE -ne 0) { throw "Task creation failed; add task manually via Task Scheduler." }
Write-Host "Scheduled $taskName at local 17:30. Run this on ONE PC only."
Write-Host "PC must be powered on, awake and online at collection time."
