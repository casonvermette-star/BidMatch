$ErrorActionPreference = 'Stop'
$AppDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $AppDir
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host "Node.js 20+ was not found." -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }
if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env' }
Write-Host "BidMatch AI V8.0.0 production integration helper" -ForegroundColor Cyan
Write-Host "Leave optional fields blank to keep their current value."
$env:BIDMATCH_CONFIG_MODE='production'
$env:BIDMATCH_APP_URL=Read-Host 'App URL'
$env:BIDMATCH_TRUSTED_ORIGINS=Read-Host 'Trusted origins (comma-separated; blank uses App URL)'
if (-not $env:BIDMATCH_TRUSTED_ORIGINS) { $env:BIDMATCH_TRUSTED_ORIGINS=$env:BIDMATCH_APP_URL }
$env:BIDMATCH_DATA_BACKEND=Read-Host 'Data backend (local/supabase; production should be supabase)'
if (-not $env:BIDMATCH_DATA_BACKEND) { $env:BIDMATCH_DATA_BACKEND='supabase' }
$env:BIDMATCH_MAX_FILE_MB='50'
$env:BIDMATCH_MAX_BODY_MB='80'
$env:BIDMATCH_MAX_PROJECT_FILES='30'
$env:BIDMATCH_ALLOW_SELF_SIGNUP=Read-Host 'Allow self-service workspace signup? (true/false)'
$env:BIDMATCH_SUPABASE_URL=Read-Host 'Supabase project URL'
$env:BIDMATCH_SUPABASE_BUCKET=Read-Host 'Supabase private storage bucket (blank = bidmatch-documents)'
if (-not $env:BIDMATCH_SUPABASE_BUCKET) { $env:BIDMATCH_SUPABASE_BUCKET='bidmatch-documents' }
$env:BIDMATCH_EMAIL_FROM=Read-Host 'Verified email sender'
$env:BIDMATCH_STRIPE_PRICE_ID=Read-Host 'Stripe recurring price ID'
function Reveal([Security.SecureString]$Secure) { $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure); try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) } }
$env:BIDMATCH_SUPABASE_KEY=Reveal (Read-Host 'Supabase secret key (sb_secret_...)' -AsSecureString)
$env:BIDMATCH_RESEND_KEY=Reveal (Read-Host 'Resend API key' -AsSecureString)
$env:BIDMATCH_STRIPE_KEY=Reveal (Read-Host 'Stripe secret key' -AsSecureString)
$env:BIDMATCH_STRIPE_WEBHOOK_SECRET=Reveal (Read-Host 'Stripe webhook signing secret' -AsSecureString)
try { & node 'scripts/windows/update-config.mjs'; if ($LASTEXITCODE -ne 0) { throw 'Configuration helper failed.' }; Write-Host 'Saved integration settings. Run the migration before switching an existing local workspace to Supabase.' -ForegroundColor Green }
finally { 'BIDMATCH_CONFIG_MODE','BIDMATCH_APP_URL','BIDMATCH_TRUSTED_ORIGINS','BIDMATCH_DATA_BACKEND','BIDMATCH_MAX_FILE_MB','BIDMATCH_MAX_BODY_MB','BIDMATCH_MAX_PROJECT_FILES','BIDMATCH_ALLOW_SELF_SIGNUP','BIDMATCH_SUPABASE_URL','BIDMATCH_SUPABASE_BUCKET','BIDMATCH_SUPABASE_KEY','BIDMATCH_RESEND_KEY','BIDMATCH_EMAIL_FROM','BIDMATCH_STRIPE_KEY','BIDMATCH_STRIPE_PRICE_ID','BIDMATCH_STRIPE_WEBHOOK_SECRET' | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue } }
Read-Host 'Press Enter to close'
