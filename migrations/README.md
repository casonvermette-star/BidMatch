# BidMatch AI V8 database migrations

Run these files in order in the Supabase SQL Editor for a new staging/production project:

1. `001_core.sql`
2. `002_indexes.sql`
3. `003_security.sql`
4. `004_v8_runtime.sql`

V8 can run in two modes:

- `DATA_BACKEND=local` — local JSON/auth files remain the source of truth.
- `DATA_BACKEND=supabase` — these normalized PostgreSQL tables become the live source of truth.

For an existing V7/local workspace, do **not** switch the backend first. Configure the Supabase URL/secret, run `npm run migrate:dry`, inspect `data/normalized-export.json`, then run `npm run migrate:apply`. Only after the migration succeeds should you set `DATA_BACKEND=supabase` and restart the app.

The Node backend is the trusted authorization boundary. Browser JavaScript never receives `SUPABASE_SECRET_KEY`. RLS remains enabled with no public tenant-data policies as defense in depth.
