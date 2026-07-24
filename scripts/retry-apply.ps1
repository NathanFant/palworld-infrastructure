# Retries `terraform apply` against infrastructure/terraform until it succeeds or
# -MaxAttempts is hit. For working around Oracle Cloud's Always Free "Out of host
# capacity" / capacity-exhaustion errors, which are transient and clear on their own
# as capacity frees up in a given availability domain - sometimes within minutes,
# sometimes over hours. Safe to leave running unattended; each attempt runs a fresh
# `terraform apply -auto-approve` (not a stale saved plan) so it only ever tries to
# create whatever's still missing from state.
#
# Usage: powershell -File scripts/retry-apply.ps1 [-IntervalSeconds 60] [-MaxAttempts 500]

param(
    [int]$IntervalSeconds = 60,
    [int]$MaxAttempts = 500,
    [string]$TerraformPath = "$env:LOCALAPPDATA\Microsoft\WinGet\Links\terraform.exe"
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\infrastructure\terraform")

for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    Write-Host "=== Attempt $attempt at $(Get-Date -Format o) ===" -ForegroundColor Cyan
    & $TerraformPath apply -auto-approve

    if ($LASTEXITCODE -eq 0) {
        Write-Host "Apply succeeded on attempt $attempt." -ForegroundColor Green
        exit 0
    }

    Write-Host "Attempt $attempt failed (exit $LASTEXITCODE) - likely capacity. Retrying in ${IntervalSeconds}s..." -ForegroundColor Yellow
    Start-Sleep -Seconds $IntervalSeconds
}

Write-Host "Gave up after $MaxAttempts attempts." -ForegroundColor Red
exit 1
