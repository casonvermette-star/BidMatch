#!/bin/bash
set -u
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR" || exit 1
[ -f .env ] || cp .env.example .env

echo "BidMatch AI V6.1 production integration helper"
echo "Leave any field blank to keep the current value."
echo
read -r -p "App URL (for example https://bidmatch.example.com): " APP_URL_INPUT
read -r -p "Allow self-service workspace signup? (true/false, blank keeps current): " SELF_SIGNUP_INPUT
read -r -p "Supabase project URL: " SUPABASE_URL_INPUT
read -r -s -p "Supabase service-role key: " SUPABASE_KEY_INPUT; echo
read -r -s -p "Resend API key: " RESEND_KEY_INPUT; echo
read -r -p "Verified email sender (for example BidMatch <bids@yourdomain.com>): " EMAIL_FROM_INPUT
read -r -s -p "Stripe secret key: " STRIPE_KEY_INPUT; echo
read -r -p "Stripe recurring price ID: " STRIPE_PRICE_INPUT
read -r -s -p "Stripe webhook signing secret: " STRIPE_WEBHOOK_INPUT; echo

python3 - "$APP_URL_INPUT" "$SELF_SIGNUP_INPUT" "$SUPABASE_URL_INPUT" "$SUPABASE_KEY_INPUT" "$RESEND_KEY_INPUT" "$EMAIL_FROM_INPUT" "$STRIPE_KEY_INPUT" "$STRIPE_PRICE_INPUT" "$STRIPE_WEBHOOK_INPUT" <<'PY'
from pathlib import Path
import sys
path=Path('.env')
lines=path.read_text().splitlines() if path.exists() else []
vals=dict(x.split('=',1) for x in lines if '=' in x and not x.lstrip().startswith('#'))
keys=['APP_URL','ALLOW_SELF_SIGNUP','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','RESEND_API_KEY','EMAIL_FROM','STRIPE_SECRET_KEY','STRIPE_PRICE_ID','STRIPE_WEBHOOK_SECRET']
for k,v in zip(keys,sys.argv[1:]):
    if v: vals[k]=v
order=[]
for line in lines:
    if '=' in line and not line.lstrip().startswith('#'):
        k=line.split('=',1)[0]
        order.append(k)
        line=f'{k}={vals.get(k,"")}'
    print(line)
missing=[k for k in keys if k not in order and k in vals]
with path.open('w') as f:
    for line in lines:
        if '=' in line and not line.lstrip().startswith('#'):
            k=line.split('=',1)[0]; line=f'{k}={vals.get(k,"")}'
        f.write(line+'\n')
    for k in missing:f.write(f'{k}={vals[k]}\n')
PY

echo
echo "Saved integration settings to .env. Restart start.command to apply them."
read -r -p "Press Return to close..." _
