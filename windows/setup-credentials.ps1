$ErrorActionPreference = "Stop"
$dir = Join-Path $env:LOCALAPPDATA "MoneyFlowRadar"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Write-Host "Enter Kiwoom keys for THIS Windows user/PC. They will be locally encrypted."
$key = Read-Host "Kiwoom App Key" -AsSecureString
$secret = Read-Host "Kiwoom Secret Key" -AsSecureString
if ($key.Length -eq 0 -or $secret.Length -eq 0) { throw "Both keys are required" }
$key | ConvertFrom-SecureString | Set-Content -Encoding UTF8 (Join-Path $dir "appkey.dpapi")
$secret | ConvertFrom-SecureString | Set-Content -Encoding UTF8 (Join-Path $dir "secret.dpapi")
Write-Host "Encrypted keys saved to LOCALAPPDATA\MoneyFlowRadar; never upload them to GitHub."
