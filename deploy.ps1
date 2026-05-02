# RepoInsight AI - single-command deploy script.
#
# Usage:
#   .\deploy.ps1                                     (uses ~\Downloads\repoinsight-ai.tar.gz)
#   .\deploy.ps1 C:\path\to\archive.tar.gz           (explicit archive path)
#   .\deploy.ps1 -NoCache                            (forces full Docker rebuild)
#   .\deploy.ps1 -WipeData                           (also runs `down -v`, wiping the DB)
#   .\deploy.ps1 -MakeOwner you@example.com          (grants Owner status to a user)
#
# What it does:
#   1. Stops running containers
#   2. Extracts the archive (verifies the file exists first)
#   3. Copies extracted files over your project (verifies key files made it)
#   4. Rebuilds Docker images (with --no-cache when requested)
#   5. Starts containers
#   6. Polls /health until the API responds OR 90 seconds pass
#   7. Hits /health/detail and prints the diagnostic report
#   8. Exits with a clear PASS or FAIL message
#
# This script uses ASCII characters only so encoding can't break it.

[CmdletBinding()]
param(
    [Parameter(Position=0)]
    [string]$ArchivePath = "$env:USERPROFILE\Downloads\repoinsight-ai.tar.gz",
    [switch]$NoCache,
    [switch]$WipeData,
    [string]$MakeOwner
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = (Get-Location).Path }
Set-Location $ProjectRoot

function Step($num, $msg) {
    Write-Host ""
    Write-Host "[Step $num] $msg" -ForegroundColor Cyan
}
function Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red; exit 1 }
function Warn($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }

# ---- 1. Verify archive exists ----
Step 1 "Verify archive"
if (-not (Test-Path $ArchivePath)) {
    Fail "Archive not found: $ArchivePath. Pass an explicit path: .\deploy.ps1 C:\path\to\file.tar.gz"
}
$archiveBytes = (Get-Item $ArchivePath).Length
$archiveKB = [math]::Round($archiveBytes / 1024)
Ok "Found $ArchivePath ($archiveKB KB)"

# ---- 2. Stop containers ----
Step 2 "Stop running containers"
if ($WipeData) {
    Warn "WipeData flag set - DB volumes will be removed (you will lose all data)"
    docker compose down -v 2>&1 | Out-Null
} else {
    docker compose down 2>&1 | Out-Null
}
Ok "Containers stopped"

# ---- 3. Extract archive ----
Step 3 "Extract archive"
if (Test-Path "$ProjectRoot\ri") {
    Remove-Item "$ProjectRoot\ri" -Recurse -Force
}
tar -xzf $ArchivePath -C $ProjectRoot
if (-not (Test-Path "$ProjectRoot\ri\backend\app\main.py")) {
    Fail "Extraction failed - ri\backend\app\main.py not found after extract"
}
Ok "Archive extracted to .\ri\"

# ---- 4. Sync extracted files into project root ----
Step 4 "Sync files into project"
xcopy /s /y /e "$ProjectRoot\ri\*" "$ProjectRoot\" | Out-Null
Remove-Item "$ProjectRoot\ri" -Recurse -Force

$mustExist = @(
    "backend\app\main.py",
    "backend\app\api\endpoints\billing.py",
    "backend\app\services\feature_gate.py",
    "frontend\src\lib\api.ts"
)
foreach ($f in $mustExist) {
    if (-not (Test-Path "$ProjectRoot\$f")) {
        Fail "Critical file missing after sync: $f"
    }
}
Ok "All critical files synced"

# ---- 5. Rebuild images ----
Step 5 "Build Docker images"
if ($NoCache) {
    Warn "NoCache flag set - full rebuild will take longer"
    docker compose build --no-cache api worker
} else {
    docker compose build api worker
}
if ($LASTEXITCODE -ne 0) { Fail "docker compose build failed (exit $LASTEXITCODE)" }
Ok "Images built"

# ---- 6. Start containers ----
Step 6 "Start containers"
docker compose up -d
if ($LASTEXITCODE -ne 0) { Fail "docker compose up failed (exit $LASTEXITCODE)" }
Ok "Containers started"

# ---- 7. Wait for API to actually respond ----
Step 7 "Wait for API to come up (max 90 seconds)"
$apiReady = $false
$startTime = Get-Date
$maxWait = 90
$attempts = 0

while (-not $apiReady -and ((Get-Date) - $startTime).TotalSeconds -lt $maxWait) {
    Start-Sleep -Seconds 2
    $attempts++
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($r.StatusCode -eq 200) {
            $apiReady = $true
            $elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)
            Ok "API responded after $elapsed seconds ($attempts attempts)"
        }
    } catch {
        Write-Host "  ... still waiting ($attempts)" -ForegroundColor DarkGray
    }
}

if (-not $apiReady) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host "  DEPLOYMENT FAILED - API never responded on port 8000" -ForegroundColor Red
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Container status:" -ForegroundColor Yellow
    docker compose ps
    Write-Host ""
    Write-Host "Last 50 lines of API logs:" -ForegroundColor Yellow
    docker compose logs api --tail 50
    Write-Host ""
    Write-Host "Most likely causes:" -ForegroundColor Yellow
    Write-Host "  - A Python import in the new code is broken (look for ModuleNotFoundError above)"
    Write-Host "  - A SQLAlchemy model has unresolvable FKs (look for NoReferencedTable)"
    Write-Host "  - The DB schema is incompatible (try: .\deploy.ps1 -WipeData)"
    exit 1
}

# ---- 8. Diagnostic check ----
Step 8 "Run diagnostic check"
try {
    $detail = Invoke-RestMethod -Uri "http://localhost:8000/health/detail" -TimeoutSec 5
    Ok "Diagnostic endpoint responded"

    Write-Host ""
    Write-Host "  Status:         $($detail.status)" -ForegroundColor White
    Write-Host "  Checks passed:  $($detail.checks_passed)" -ForegroundColor White
    Write-Host "  Warnings:       $($detail.warnings.Count)" -ForegroundColor White
    Write-Host "  Errors:         $($detail.errors.Count)" -ForegroundColor White

    if ($detail.errors.Count -gt 0) {
        Write-Host ""
        Write-Host "  Errors detected:" -ForegroundColor Red
        foreach ($e in $detail.errors) { Write-Host "    - $e" -ForegroundColor Red }
    }
    if ($detail.warnings.Count -gt 0) {
        Write-Host ""
        Write-Host "  Warnings:" -ForegroundColor Yellow
        foreach ($w in $detail.warnings) { Write-Host "    - $w" -ForegroundColor Yellow }
    }
} catch {
    Warn "Could not reach /health/detail (this endpoint requires the latest code; deploy may be on an older version)"
}

# ---- 9. Optional: grant owner status ----
if ($MakeOwner) {
    Step 9 "Grant Owner status to $MakeOwner"
    $sql = "UPDATE users SET is_owner = TRUE WHERE email = '$MakeOwner' RETURNING email, is_owner;"
    $result = docker compose exec -T db psql -U postgres -d repoinsight -c "$sql" 2>&1
    if ($LASTEXITCODE -eq 0 -and $result -match $MakeOwner) {
        Ok "$MakeOwner is now an Owner - sign out and back in to see the change"
    } else {
        Warn "Could not grant Owner status. The account may not exist yet (sign up first)."
        Write-Host "  Output: $result" -ForegroundColor DarkGray
    }
}

# ---- Summary ----
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DEPLOYMENT SUCCEEDED" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  API:      http://localhost:8000"
Write-Host "  Frontend: http://localhost:3000"
Write-Host "  Health:   http://localhost:8000/health/detail"
Write-Host ""
