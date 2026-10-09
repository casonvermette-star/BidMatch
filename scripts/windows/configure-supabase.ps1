$ErrorActionPreference='Stop'
$AppDir=Split-Path -Parent (Split-Path -Parent $PSScriptRoot);Set-Location $AppDir
if(-not (Get-Command node -ErrorAction SilentlyContinue)){Write-Host 'Node.js 20+ was not found.' -ForegroundColor Red;Read-Host 'Press Enter to close';exit 1}
if(-not (Test-Path '.env')){Copy-Item '.env.example' '.env'}
Write-Host 'BidMatch AI V8 - Supabase connection setup' -ForegroundColor Cyan
Write-Host 'This stores the connection but leaves DATA_BACKEND=local until migration is complete.'
$env:BIDMATCH_CONFIG_MODE='supabase'
$env:BIDMATCH_SUPABASE_URL=Read-Host 'Supabase project URL'
$env:BIDMATCH_SUPABASE_BUCKET=Read-Host 'Private bucket (blank = bidmatch-documents)';if(-not $env:BIDMATCH_SUPABASE_BUCKET){$env:BIDMATCH_SUPABASE_BUCKET='bidmatch-documents'}
function Reveal([Security.SecureString]$Secure){$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure);try{return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}}
$env:BIDMATCH_SUPABASE_KEY=Reveal (Read-Host 'Supabase secret key (sb_secret_...)' -AsSecureString)
try{& node 'scripts/windows/update-config.mjs';if($LASTEXITCODE -ne 0){throw 'Configuration failed.'};Write-Host 'Saved. Next run npm run migrate:dry, then npm run migrate:apply.' -ForegroundColor Green}
finally{'BIDMATCH_CONFIG_MODE','BIDMATCH_SUPABASE_URL','BIDMATCH_SUPABASE_BUCKET','BIDMATCH_SUPABASE_KEY'|ForEach-Object{Remove-Item "Env:$_" -ErrorAction SilentlyContinue}}
Read-Host 'Press Enter to close'
