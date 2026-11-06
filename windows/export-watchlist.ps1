# Export HTS saved watchlist groups to LOCALAPPDATA only; never to GitHub.
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dir = Join-Path $env:LOCALAPPDATA "MoneyFlowRadar"
function Read-Secret([string]$filename) {
    $file = Join-Path $dir $filename
    if (!(Test-Path $file)) { throw "Run windows/setup-credentials.ps1 first: $filename missing" }
    $secure = (Get-Content -Encoding UTF8 $file | Select-Object -First 1) | ConvertTo-SecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
if (!(Get-Command git -ErrorAction SilentlyContinue)) { throw "Git for Windows missing" }
if (!(Get-Command python -ErrorAction SilentlyContinue)) { throw "Python missing" }
Push-Location $repo
try {
    if (git status --porcelain --untracked-files=no) {
        throw "Working tree has uncommitted changes; resolve before syncing scripts"
    }
    git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw "Git pull failed; no data exported" }
    $env:KIWOOM_APP_KEY = Read-Secret "appkey.dpapi"
    $env:KIWOOM_APP_SECRET = Read-Secret "secret.dpapi"
    try {
        python -m pip install -q -r requirements.txt
        if ($LASTEXITCODE -ne 0) { throw "Dependency install failed" }
        python -u scripts/export_kiwoom_watchlist.py
        if ($LASTEXITCODE -ne 0) { throw "Private local watchlist export failed" }
    } finally {
        Remove-Item Env:\KIWOOM_APP_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:\KIWOOM_APP_SECRET -ErrorAction SilentlyContinue
    }
    Write-Host "PRIVATE FILE: $dir\watchlist-export.json"
    Write-Host "Open Money Flow Radar > 3-month tracker > Kiwoom watchlist, and import this local JSON."
    Write-Host "Nothing was uploaded or committed to GitHub."
} finally { Pop-Location }
