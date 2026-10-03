$ErrorActionPreference = 'Stop'
$AppDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $AppDir

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js was not found. Install Node.js 20+ from https://nodejs.org/." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}
if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env' }

Write-Host "BidMatch AI — Windows platform-admin setup" -ForegroundColor Cyan
Write-Host "This changes only the separate /admin login, not a client workspace password."
Write-Host ""
$email = Read-Host "Platform admin email"
$secure1 = Read-Host "New admin password (10+ characters)" -AsSecureString
$secure2 = Read-Host "Confirm admin password" -AsSecureString

function Reveal([Security.SecureString]$Secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$password1 = Reveal $secure1
$password2 = Reveal $secure2
if ($password1 -ne $password2) {
  Write-Host "Passwords do not match." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}
if ($password1.Length -lt 10) {
  Write-Host "Password must be at least 10 characters." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

try {
  $env:BIDMATCH_CONFIG_MODE = 'admin'
  $env:BIDMATCH_ADMIN_EMAIL = $email
  $env:BIDMATCH_ADMIN_PASSWORD = $password1
  & node 'scripts/windows/update-config.mjs'
  if ($LASTEXITCODE -ne 0) { throw 'Configuration helper failed.' }
  Write-Host ""
  Write-Host "Admin login updated. Use start-admin-windows.bat to open the console." -ForegroundColor Green
} finally {
  Remove-Item Env:BIDMATCH_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:BIDMATCH_ADMIN_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:BIDMATCH_CONFIG_MODE -ErrorAction SilentlyContinue
  $password1 = $null
  $password2 = $null
}
Read-Host "Press Enter to close"
