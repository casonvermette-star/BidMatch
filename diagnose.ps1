$ErrorActionPreference = 'Continue'
$AppDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $AppDir
Write-Host "BidMatch AI Windows diagnostics" -ForegroundColor Cyan
Write-Host "==============================="
Write-Host "Folder: $AppDir"
Write-Host "Windows: $([Environment]::OSVersion.VersionString)"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
Write-Host ""

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  Write-Host "Node: $($node.Source)"
  Write-Host "Version: $(& node --version)"
  Write-Host ""
  Write-Host "Checking JavaScript syntax..."
  & node --check server.mjs
  & node --check public/app.js
  & node --check public/admin.js
  if ($LASTEXITCODE -eq 0) { Write-Host "Syntax: OK" -ForegroundColor Green }
} else {
  Write-Host "Node: NOT FOUND" -ForegroundColor Red
}

Write-Host ""
foreach ($p in 3000..3002) {
  $available = $false
  if ($node) {
    & node -e "const net=require('net');const s=net.createServer();s.once('error',()=>process.exit(1));s.once('listening',()=>s.close(()=>process.exit(0)));s.listen($p,'127.0.0.1');" *> $null
    $available = ($LASTEXITCODE -eq 0)
  }
  if ($available) { Write-Host "Port $p: available" }
  else { Write-Host "Port $p: IN USE or could not be tested" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "Client launcher: start-windows.bat"
Write-Host "Admin launcher: start-admin-windows.bat"
Write-Host "If Node is missing, install Node.js 20+ and reopen this tool."
Read-Host "Press Enter to close"
