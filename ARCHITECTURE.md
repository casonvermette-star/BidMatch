# BidMatch AI V5 architecture

## Request path

Browser UI → Node HTTP server → authentication/authorization → organization-scoped domain logic → local state plus optional cloud adapters.

The browser never receives provider secret keys. OpenAI, Supabase service-role, Resend, and Stripe secret operations are server-side only.

## Data modes

### Local mode

- `data/db.json`: project, contractor, bid, workflow, job, settings, billing state.
- `data/auth.json`: password hashes, sessions, invitations, organizations/users.
- `data/uploads/`: project files.
- `backups/`: manually generated backup snapshots.

This is the easiest mode for demos and development.

### Cloud-adapter mode

When Supabase is configured, the server mirrors application state into `bidmatch_state` and stores project documents in a private Storage bucket. This gives a deployable persistence layer without changing the UI or domain model. `docs/postgres-schema.sql` documents the normalized relational schema intended for later migration when query volume or reporting needs justify decomposing the snapshot.

## Trust boundaries

Deterministic code owns qualification gates, authorization, arithmetic, dates, money, workflow state, rate limiting, and delivery state. AI may extract, summarize, classify, answer questions, and assist matching; it does not silently override hard qualification rules or make legal awards.

## Roles

- Owner: all permissions including billing.
- Admin: settings, team roles/invites, imports, backups, project mutation.
- Estimator: project/scope/bid/outreach workflow mutation.
- Viewer: read-only access.

## External adapters

- OpenAI: document analysis, Q&A, proposal parsing, optional embeddings.
- Supabase: remote state persistence and private object storage.
- Resend: transactional bid invitations/follow-ups.
- Stripe: subscription checkout and webhook-driven billing status.

Each adapter is optional. Failure is surfaced in Launch/System Health instead of making the core local workflow unusable.
