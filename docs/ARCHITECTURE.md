# BidMatch AI V8 architecture

## Client boundary

The browser talks only to the BidMatch Node API. Provider secrets never ship to frontend JavaScript.

## Authentication

Client workspace auth and platform-admin auth remain separate security domains. Client owner/admin/estimator/viewer roles are organization-scoped. The platform admin has a separate credential/session path under `/admin`.

## Persistence

### Local mode

`DATA_BACKEND=local`

`data/db.json` and `data/auth.json` are authoritative. This mode is intended for development/demo use.

### Supabase mode

`DATA_BACKEND=supabase`

The Node server loads normalized PostgreSQL tables at startup and persists row-level changes back through the Supabase REST API using a server-only secret key. The secret key never reaches the browser.

The process keeps an in-memory working set for the current single-server runtime. V8 should therefore be deployed as one application instance for controlled beta use; multi-instance conflict handling is a later hardening step.

## Storage

Project files and bid proposals are stored in a private `bidmatch-documents` bucket when Supabase is configured. Downloads are proxied through the authenticated Node boundary or the secure bidder-token workflow.

## External services

- Supabase: normalized PostgreSQL + private object storage
- Resend: transactional invitations/reset mail
- Stripe: checkout/webhook hooks
- OpenAI: optional document intelligence
