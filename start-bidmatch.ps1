param(
  [ValidateSet('Client','Admin')]
  [string]$Mode = 'Client'
)

$ErrorActionPreference = 'Stop'
$AppDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $AppDir

function Pause-And-Exit([string]$Message, [int]$Code = 1) {
  Write-Host ""
  Write-Host $Message -ForegroundColor Red
  Write-Host ""
  Read-Host "Press Enter to close"
  exit $Code
}

function Get-NodePath {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) { return $node.Source }
  $candidates = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}

function Test-PortAvailable([int]$Port) {
  $script = "const net=require('net');const s=net.createServer();s.once('error',()=>process.exit(1));s.once('listening',()=>s.close(()=>process.exit(0)));s.listen($Port,'127.0.0.1');"
  & $NodePath -e $script *> $null
  return ($LASTEXITCODE -eq 0)
}

function Test-CompatibleServer([int]$Port) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 1
    if (-not $health.ok) { return $false }
    if ([string]$health.version -notmatch '^6\.1(\.[0-9]+)?$') { return $false }
    $page = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/admin" -TimeoutSec 1 -UseBasicParsing
    return ($page.Content -match 'SEPARATE ADMIN CONSOLE')
  } catch {
    return $false
  }
}

$NodePath = Get-NodePath
if (-not $NodePath) {
  Pause-And-Exit "Node.js was not found. Install Node.js 20 or newer from https://nodejs.org/ and then run this launcher again."
}

try {
  $NodeVersion = & $NodePath -p "process.versions.node"
  $NodeMajor = [int](& $NodePath -p "Number(process.versions.node.split('.')[0])")
} catch {
  Pause-And-Exit "Node.js was found, but its version could not be read."
}

if ($NodeMajor -lt 20) {
  Pause-And-Exit "BidMatch AI requires Node.js 20 or newer. Found Node.js $NodeVersion."
}

if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
}

if ($Mode -eq 'Admin') {
  foreach ($p in 3000..3010) {
    if (Test-CompatibleServer $p) {
      $url = "http://localhost:$p/admin"
      Write-Host "Using the existing BidMatch V6.1 admin server at $url" -ForegroundColor Green
      Start-Process $url
      exit 0
    }
  }
}

$Port = $null
foreach ($p in 3000..3010) {
  if (Test-PortAvailable $p) { $Port = $p; break }
}
if (-not $Port) {
  Pause-And-Exit "Could not find a free local port between 3000 and 3010. Close other local development servers and try again."
}

$env:PORT = [string]$Port
$baseUrl = "http://localhost:$Port"
$url = if ($Mode -eq 'Admin') { "$baseUrl/admin" } else { $baseUrl }

Write-Host "Starting BidMatch AI V6.1.2 ($Mode)..." -ForegroundColor Cyan
Write-Host "Node.js: $NodeVersion"
Write-Host "App folder: $AppDir"
Write-Host "URL: $url"
Write-Host ""

$process = $null
try {
  $process = Start-Process -FilePath $NodePath -ArgumentList @('server.mjs') -WorkingDirectory $AppDir -NoNewWindow -PassThru
  $ready = $false
  for ($i = 0; $i -lt 50; $i++) {
    if ($process.HasExited) {
      Pause-And-Exit "The BidMatch AI server stopped before it was ready."
    }
    try {
      $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 1
      if ($health.ok) { $ready = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 250
  }

  if (-not $ready) {
    Pause-And-Exit "The server started but did not answer its health check. Try opening $url manually."
  }

  if ($Mode -eq 'Admin') {
    try {
      $page = Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing
      if ($page.Content -notmatch 'SEPARATE ADMIN CONSOLE') {
        Pause-And-Exit "The server is running, but the separate admin application was not found at $url."
      }
    } catch {
      Pause-And-Exit "The server is running, but the admin page could not be verified."
    }
  }

  Write-Host "BidMatch AI is running. Keep this window open while using the app." -ForegroundColor Green
  Start-Process $url
  Write-Host ""
  Write-Host "Press Ctrl+C or close this window to stop the local server."
  Wait-Process -Id $process.Id
}
finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
}
