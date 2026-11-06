param([switch]$NoPush)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dir = Join-Path $env:LOCALAPPDATA "MoneyFlowRadar"
function Read-Secret([string]$filename) {
    $file = Join-Path $dir $filename
    if (!(Test-Path $file)) { throw "Run windows/setup-credentials.ps1 first: missing $filename" }
    $secure = (Get-Content -Encoding UTF8 $file | Select-Object -First 1) | ConvertTo-SecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
if (!(Get-Command git -ErrorAction SilentlyContinue)) { throw "Install Git for Windows first" }
if (!(Get-Command python -ErrorAction SilentlyContinue)) { throw "Install Python 3.11+ first" }
if (!(Test-Path (Join-Path $repo ".git"))) { throw "Use git clone, not Download ZIP. See LOCAL-PC-SETUP.md" }
Push-Location $repo
try {
    if (!$NoPush) {
        if (git status --porcelain --untracked-files=no) {
            throw "Uncommitted changes present. Resolve them before publishing."
        }
        git pull --ff-only origin main
        if ($LASTEXITCODE -ne 0) { throw "Git pull failed. Data not published." }
    }
    $env:KIWOOM_APP_KEY = Read-Secret "appkey.dpapi"
    $env:KIWOOM_APP_SECRET = Read-Secret "secret.dpapi"
    try {
        python -m pip install -q -r requirements.txt
        if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
        python -u scripts/collect.py
        if ($LASTEXITCODE -ne 0) { throw "Kiwoom collection failed; existing data preserved" }
    } finally {
        Remove-Item Env:\KIWOOM_APP_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:\KIWOOM_APP_SECRET -ErrorAction SilentlyContinue
    }
    if ($NoPush) { Write-Host "Collected locally; no upload requested."; return }
    git add -- data/latest.json data/radar-history.json
    if ($LASTEXITCODE -ne 0) { throw "Git stage failed" }
    git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) { Write-Host "Data unchanged; no push necessary"; return }
    git -c user.name="Money Flow Radar Local" -c user.email="local-collector@users.noreply.github.com" commit -m "Update EOD snapshot from registered PC"
    if ($LASTEXITCODE -ne 0) { throw "Git commit failed" }
    git push origin main
    if ($LASTEXITCODE -ne 0) { throw "Git push failed; check GitHub login and sync conflicts" }
    Write-Host "SUCCESS: latest.json + radar-history.json published; Pages deployment triggered."
} finally { Pop-Location }
