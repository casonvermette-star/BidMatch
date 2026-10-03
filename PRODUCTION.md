# BidMatch AI V5 production checklist

V5 is a launch-candidate architecture: it can run entirely on local files for demos, or connect the same server to Supabase, Resend, Stripe, and OpenAI through environment variables.

## 1. Authentication and tenancy

Client authentication is enabled by default (`REQUIRE_LOGIN=true`). The first client browser session creates a workspace owner, who can invite admins, estimators, and viewers. Platform administration is separate at `/admin` and uses `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD_HASH`, and `PLATFORM_ADMIN_SESSION_SECRET`. Every project, imported contractor, setting, billing record, and job is scoped to the authenticated organization. The 58 bundled demo contractors are global demo records and are clearly labeled as such.

For a public deployment, always use HTTPS and set `APP_ENV=production`. Production mode marks the session cookie `Secure`; cookies are also HttpOnly and SameSite=Lax. Do not put `.env`, `data/auth.json`, service-role credentials, Stripe secrets, or API keys in source control.

## 2. Supabase persistence and document storage

1. Create a Supabase project.
2. Run `docs/supabase-setup.sql` in the SQL editor.
3. Put `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the server environment.
4. Keep `SUPABASE_STORAGE_BUCKET=bidmatch-documents` unless you deliberately use another private bucket.

V5 writes a server-side application snapshot to `public.bidmatch_state` and uploads project documents to the private Storage bucket. Local JSON/disk remains a fallback if cloud persistence is not configured or temporarily fails. The included `docs/postgres-schema.sql` is the normalized relational migration target for a later scale-out phase.

Never expose the Supabase service-role key to client-side JavaScript.

## 3. Email outreach

Set `RESEND_API_KEY` and a verified `EMAIL_FROM`. Invitations can then be sent from the Outreach screen. Successful sends enqueue two deterministic follow-up jobs (3 and 7 days) unless the contractor accepts, declines, or submits first. Demo `.example` addresses are deliberately never sent externally.

`OUTREACH_WEBHOOK_URL` remains available as a generic fallback integration.

## 4. Billing

Create a recurring Stripe Price and set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET`. Point a Stripe webhook at:

`POST /api/stripe/webhook`

Set production success/cancel URLs. Subscription events update the organization billing record. Billing does not automatically override human award/contract controls.

## 5. AI

OpenAI is optional. Without an API key or available API balance, BidMatch uses deterministic local scope extraction and the rest of the workflow still runs. With a working key, document analysis, project Q&A, bid parsing, and semantic similarity can use the live AI path.

Keep `OPENAI_API_KEY` on the server only.

## 6. Deployment

The server honors `HOST` and `PORT`; production defaults to `0.0.0.0`. A `Dockerfile` is included. Typical container settings are:

- `APP_ENV=production`
- `APP_URL=https://your-domain.example`
- `REQUIRE_LOGIN=true`
- Supabase / Resend / Stripe / OpenAI variables as needed

The service exposes `GET /api/health` for health checks. Do not use `/api/state` as an unauthenticated health check.

## 7. Backups and recovery

The Launch screen can create a local JSON backup containing app state and the local auth store. With Supabase enabled, the application state is also mirrored remotely. For a real production service, additionally configure provider-level database backups and persistent storage/retention for any local backup directory.

## 8. Security and operational checks before real customers

- Use HTTPS only.
- Rotate any credential that has ever been pasted into chat, a screenshot, source control, or a shared file.
- Verify sender domain and SPF/DKIM with the mail provider.
- Restrict access to production environment variables.
- Use a managed secret store on the hosting platform.
- Enable provider database backups and alerts.
- Review rate limits for your expected traffic.
- Add error/uptime monitoring.
- Verify licenses, insurance, bonding, and contractor identity with authoritative sources before relying on them.
- Keep award, price commitment, contract execution, and other legally binding actions behind explicit human approval.
- Complete legal/privacy/terms review before collecting real customer or subcontractor data.

## 9. Launch test

Run `npm test` before deployment. Then use a staging environment to test: client-owner setup, separate `/admin` login, team invite/role permissions, contractor import, project creation, scope editing/qualification, outreach, follow-up cancellation after a response, bid parsing/leveling, CSV export, backup, billing checkout, webhook delivery, document upload/download, and sign-out/sign-in.
