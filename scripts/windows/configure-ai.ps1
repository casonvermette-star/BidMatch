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

Write-Host "BidMatch AI — Windows AI setup" -ForegroundColor Cyan
Write-Host "The key is saved only in this local folder's .env file."
Write-Host ""
$secure = Read-Host "Paste your OpenAI API key" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
if (-not $key) {
  Write-Host "No key entered. Nothing changed."
  Read-Host "Press Enter to close"
  exit 0
}

try {
  $env:BIDMATCH_CONFIG_MODE = 'ai'
  $env:BIDMATCH_OPENAI_KEY = $key
  & node 'scripts/windows/update-config.mjs'
  if ($LASTEXITCODE -ne 0) { throw 'Configuration helper failed.' }
  Write-Host ""
  Write-Host "AI configuration saved. Restart BidMatch AI." -ForegroundColor Green
} finally {
  Remove-Item Env:BIDMATCH_OPENAI_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:BIDMATCH_CONFIG_MODE -ErrorAction SilentlyContinue
  $key = $null
}
Read-Host "Press Enter to close"
