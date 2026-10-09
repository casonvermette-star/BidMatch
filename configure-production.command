#!/bin/bash
set -u
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR" || exit 1
[ -f .env ] || cp .env.example .env

find_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do [ -x "$candidate" ] && { echo "$candidate"; return 0; }; done
  if [ -d "$HOME/.nvm/versions/node" ]; then
    candidate="$(find "$HOME/.nvm/versions/node" -type f -path '*/bin/node' 2>/dev/null | sort -V | tail -n 1)"
    [ -n "${candidate:-}" ] && [ -x "$candidate" ] && { echo "$candidate"; return 0; }
  fi
  return 1
}
NODE_BIN="$(find_node || true)"
if [ -z "$NODE_BIN" ]; then echo "Node.js 20+ was not found."; read -r -p "Press Return to close..." _; exit 1; fi

echo "BidMatch AI V8.0.0 production integration helper"
echo "Leave any field blank to keep its current value."
echo
read -r -p "App URL (for example https://app.example.com): " APP_URL_INPUT
read -r -p "Trusted origins (comma-separated; blank uses App URL): " TRUSTED_ORIGINS_INPUT
[ -n "$TRUSTED_ORIGINS_INPUT" ] || TRUSTED_ORIGINS_INPUT="$APP_URL_INPUT"
read -r -p "Allow self-service workspace signup? (true/false, blank keeps current): " SELF_SIGNUP_INPUT
read -r -p "Data backend (local/supabase; production should be supabase): " DATA_BACKEND_INPUT
[ -n "$DATA_BACKEND_INPUT" ] || DATA_BACKEND_INPUT="supabase"
read -r -p "Supabase project URL: " SUPABASE_URL_INPUT
read -r -p "Supabase private storage bucket (blank = bidmatch-documents): " SUPABASE_BUCKET_INPUT
[ -n "$SUPABASE_BUCKET_INPUT" ] || SUPABASE_BUCKET_INPUT="bidmatch-documents"
read -r -s -p "Supabase secret key (sb_secret_...): " SUPABASE_KEY_INPUT; echo
read -r -s -p "Resend API key: " RESEND_KEY_INPUT; echo
read -r -p "Verified email sender (for example BidMatch <bids@yourdomain.com>): " EMAIL_FROM_INPUT
read -r -s -p "Stripe secret key: " STRIPE_KEY_INPUT; echo
read -r -p "Stripe recurring price ID: " STRIPE_PRICE_INPUT
read -r -s -p "Stripe webhook signing secret: " STRIPE_WEBHOOK_INPUT; echo

BIDMATCH_CONFIG_MODE=production \
BIDMATCH_APP_URL="$APP_URL_INPUT" \
BIDMATCH_TRUSTED_ORIGINS="$TRUSTED_ORIGINS_INPUT" \
BIDMATCH_MAX_FILE_MB="50" \
BIDMATCH_MAX_BODY_MB="80" \
BIDMATCH_MAX_PROJECT_FILES="30" \
BIDMATCH_ALLOW_SELF_SIGNUP="$SELF_SIGNUP_INPUT" \
BIDMATCH_DATA_BACKEND="$DATA_BACKEND_INPUT" \
BIDMATCH_SUPABASE_URL="$SUPABASE_URL_INPUT" \
BIDMATCH_SUPABASE_BUCKET="$SUPABASE_BUCKET_INPUT" \
BIDMATCH_SUPABASE_KEY="$SUPABASE_KEY_INPUT" \
BIDMATCH_RESEND_KEY="$RESEND_KEY_INPUT" \
BIDMATCH_EMAIL_FROM="$EMAIL_FROM_INPUT" \
BIDMATCH_STRIPE_KEY="$STRIPE_KEY_INPUT" \
BIDMATCH_STRIPE_PRICE_ID="$STRIPE_PRICE_INPUT" \
BIDMATCH_STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_INPUT" \
"$NODE_BIN" scripts/windows/update-config.mjs
STATUS=$?
unset SUPABASE_KEY_INPUT RESEND_KEY_INPUT STRIPE_KEY_INPUT STRIPE_WEBHOOK_INPUT

echo
if [ "$STATUS" -eq 0 ]; then echo "Saved integration settings to .env. Restart BidMatch AI to apply them."; else echo "Configuration failed."; fi
read -r -p "Press Return to close..." _
exit "$STATUS"
