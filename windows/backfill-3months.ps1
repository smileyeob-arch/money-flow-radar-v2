param([switch]$NoPush)
# One-time historical backfill on a Kiwoom-registered Windows PC. No order submission.
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dir = Join-Path $env:LOCALAPPDATA "MoneyFlowRadar"

function Read-Secret([string]$filename) {
    $path = Join-Path $dir $filename
    if (!(Test-Path $path)) { throw "Encrypted local API credential missing: $filename" }
    $secure = (Get-Content -Encoding UTF8 $path | Select-Object -First 1) | ConvertTo-SecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

if (!(Get-Command git -ErrorAction SilentlyContinue)) { throw "Git for Windows is not installed" }
if (!(Get-Command python -ErrorAction SilentlyContinue)) { throw "Python 3.11+ is not installed" }
if (!(Test-Path (Join-Path $repo ".git"))) { throw "Use an existing git clone (not a ZIP download)" }

Push-Location $repo
try {
    if (!$NoPush) {
        if (git status --porcelain --untracked-files=no) {
            throw "Working tree contains local edits. Resolve them before backfilling."
        }
        git pull --ff-only origin main
        if ($LASTEXITCODE -ne 0) { throw "Git pull failed; nothing published" }
    }
    $env:KIWOOM_APP_KEY = Read-Secret "appkey.dpapi"
    $env:KIWOOM_APP_SECRET = Read-Secret "secret.dpapi"
    try {
        python -m pip install -q -r requirements.txt
        if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed" }
        Write-Host "Historical scan uses local Kiwoom API. Progress is checkpointed under LOCALAPPDATA."
        python -u scripts/backfill.py
        if ($LASTEXITCODE -ne 0) { throw "Historical reconstruction failed; GitHub data unchanged. Re-run this command to resume." }
    } finally {
        Remove-Item Env:\KIWOOM_APP_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:\KIWOOM_APP_SECRET -ErrorAction SilentlyContinue
    }
    if ($NoPush) { Write-Host "Backfill calculated locally. NoPush selected."; return }
    git add -- data/radar-history.json
    if ($LASTEXITCODE -ne 0) { throw "Unable to stage radar-history.json" }
    git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) { Write-Host "Historical journal unchanged. No upload required."; return }
    if ($LASTEXITCODE -ne 1) { throw "Git diff failed" }
    git -c user.name="Money Flow Radar Local" -c user.email="local-collector@users.noreply.github.com" commit -m "Reconstruct 92-day historical theme watchlist"
    if ($LASTEXITCODE -ne 0) { throw "Local commit failed; keep generated journal safe" }
    git push origin main
    if ($LASTEXITCODE -ne 0) { throw "GitHub push failed; journal remains committed locally" }
    Write-Host "BACKFILL PUBLISHED: radar-history.json; Pages deployment triggered."
} finally { Pop-Location }
