# Read locally DPAPI-encrypted credentials and check the Infostock API schema only.
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dir = Join-Path $env:LOCALAPPDATA "MoneyFlowRadar"
function Secret([string]$filename) {
    $path = Join-Path $dir $filename
    if (!(Test-Path $path)) { throw "Missing local encrypted credential: $filename" }
    $secure = (Get-Content -Encoding UTF8 $path | Select-Object -First 1) | ConvertTo-SecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
Push-Location $root
try {
    git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw "Cannot pull latest code" }
    $env:KIWOOM_APP_KEY = Secret "appkey.dpapi"
    $env:KIWOOM_APP_SECRET = Secret "secret.dpapi"
    try {
        python -u scripts/probe_infostock.py
        if ($LASTEXITCODE -ne 0) { throw "Infostock API probe failed; show error after hiding any secrets" }
    } finally {
        Remove-Item Env:\KIWOOM_APP_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:\KIWOOM_APP_SECRET -ErrorAction SilentlyContinue
    }
} finally { Pop-Location }
