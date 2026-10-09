# BidMatch AI V8 — Windows

Install Node.js 20+ and extract the ZIP completely.

Client portal: `start-windows.bat`

Platform admin: configure once with `configure-admin-windows.bat`, then run `start-admin-windows.bat`.

AI setup: `configure-ai-windows.bat`.

## Supabase cloud runtime

1. Run `docs/supabase-production-v8.sql` in the Supabase SQL Editor.
2. Run `configure-supabase-windows.bat`.
3. Open Terminal/PowerShell in the project folder and run `npm run migrate:dry`.
4. Review `data/normalized-export.json`.
5. Run `npm run migrate:apply`.
6. Run `switch-to-supabase-windows.bat`.
7. Restart `start-windows.bat`.

Production configuration: `configure-production-windows.bat`.

Verification: `node scripts/verify-production.mjs`.

Diagnostics: `diagnose-windows.bat`.

Do not share `.env`, `data/auth.json`, uploaded customer files, or any private keys.
