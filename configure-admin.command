#!/bin/bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"
[ -f .env ] || cp .env.example .env

echo "BidMatch AI V6.1 — platform admin credentials"
echo "This changes only the separate /admin login. It does not change any client workspace password."
echo
read -r -p "Platform admin email: " ADMIN_EMAIL
read -r -s -p "New admin password (12+ chars recommended): " ADMIN_PASSWORD; echo
read -r -s -p "Confirm admin password: " ADMIN_PASSWORD_2; echo

if [ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_2" ]; then
  echo "Passwords do not match."
  read -r -p "Press Return to close..." _
  exit 1
fi
if [ ${#ADMIN_PASSWORD} -lt 10 ]; then
  echo "Password must be at least 10 characters."
  read -r -p "Press Return to close..." _
  exit 1
fi

node - "$ADMIN_EMAIL" "$ADMIN_PASSWORD" <<'NODE'
const fs=require('fs');
const crypto=require('crypto');
const [email,password]=process.argv.slice(2);
const path='.env';
let text=fs.existsSync(path)?fs.readFileSync(path,'utf8'):'';
const salt=crypto.randomBytes(16).toString('hex');
const hash=crypto.scryptSync(password,salt,64).toString('hex');
const secret=crypto.randomBytes(32).toString('hex');
const vals={
  PLATFORM_ADMIN_EMAIL:String(email||'').trim().toLowerCase(),
  PLATFORM_ADMIN_PASSWORD_HASH:`${salt}:${hash}`,
  PLATFORM_ADMIN_SESSION_SECRET:secret
};
for(const [key,value] of Object.entries(vals)){
  const re=new RegExp(`^${key}=.*$`,'m');
  if(re.test(text)) text=text.replace(re,`${key}=${value}`);
  else text += `${text.endsWith('\n')||!text?'':'\n'}${key}=${value}\n`;
}
fs.writeFileSync(path,text);
NODE

echo
echo "Admin login updated. Restart start.command, then open: http://localhost:3000/admin"
read -r -p "Press Return to close..." _
