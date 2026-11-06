$ErrorActionPreference = "Stop"
$script = (Resolve-Path (Join-Path $PSScriptRoot "run-and-publish.ps1")).Path
$taskName = "MoneyFlowRadar-Daily-1730"
$command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $script + '"'
schtasks.exe /Create /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 17:30 /TN $taskName /TR $command /F
if ($LASTEXITCODE -ne 0) { throw "Task creation failed; add task manually via Task Scheduler." }
Write-Host "Scheduled $taskName at 17:30 local time, Monday-Friday. Run this on ONE PC only."
Write-Host "PC must be powered on, awake and online at collection time."
