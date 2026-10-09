# BidMatch AI V8.0.0 — Cloud Runtime

BidMatch AI is a personal full-stack SaaS project exploring AI-assisted construction preconstruction workflows: project/document intake, scope generation, subcontractor qualification and matching, bid-list management, outreach, proposal submission, bid leveling, team roles, and a separate platform-admin console.

V8 is the cloud-runtime checkpoint. It keeps local mode for development, but adds a normalized Supabase/PostgreSQL runtime so the cloud database can become the live source of truth.

## What changed in V8

- `DATA_BACKEND=local|supabase` runtime switch
- normalized Supabase tables load directly into the application runtime
- row-level normalized persistence instead of the old single-row JSON snapshot mirror
- current Supabase `sb_secret_...` server-key support
- legacy `service_role` compatibility only for migration
- private Supabase Storage remains server-only
- explicit migration workflow before switching an existing workspace to cloud mode
- full-server cloud-runtime regression test
- local mode still works without any paid service

## Run locally

Requires Node.js 20+.

### macOS

Double-click `start.command`.

Admin: `start-admin.command`.

### Windows

Double-click `start-windows.bat`.

Admin: `start-admin-windows.bat`.

### Terminal

```bash
npm start
```

Client: `http://localhost:3000`

Admin: `http://localhost:3000/admin`

## Tests

```bash
npm test
```

The V8 test suite checks the original end-to-end client/admin workflow plus normalized Supabase round-tripping and a full server boot against a Supabase-compatible cloud runtime.

## Supabase setup — existing local workspace

### 1. Create a Supabase project

Use a dedicated staging project first.

### 2. Create the schema

In Supabase → SQL Editor, run:

```text
docs/supabase-production-v8.sql
```

Or run the files in `/migrations` in numeric order.

### 3. Save the Supabase connection

macOS:

```text
configure-supabase.command
```

Windows:

```text
configure-supabase-windows.bat
```

This saves `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and the private bucket name while deliberately leaving `DATA_BACKEND=local`.

### 4. Dry-run the migration

```bash
npm run migrate:dry
```

Review:

```text
data/normalized-export.json
```

### 5. Apply the migration

```bash
npm run migrate:apply
```

This writes normalized rows and uploads local project-document bytes that are still available.

### 6. Switch the runtime

macOS:

```text
switch-to-supabase.command
```

Windows:

```text
switch-to-supabase-windows.bat
```

Or set:

```text
DATA_BACKEND=supabase
```

### 7. Restart BidMatch

After restart, `/api/health` should report:

```json
{"dataBackend":"supabase"}
```

The client Launch screen should report the database as `Supabase normalized · live`.

## Fresh cloud workspace

For a brand-new project with no local data, run the SQL schema, configure the connection, set `DATA_BACKEND=supabase`, and start the app. The first client owner can then be created normally. A fresh cloud workspace will not contain the fictional demo contractor directory unless you migrate/seed it.

## Production verification

```bash
npm run verify:production
```

Production should use:

```text
APP_ENV=production
DATA_BACKEND=supabase
REQUIRE_LOGIN=true
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_STORAGE_BUCKET=bidmatch-documents
```

Never place `SUPABASE_SECRET_KEY`, Stripe secrets, OpenAI keys, Resend keys, admin password hashes, or session secrets in frontend JavaScript or GitHub.

## Important scaling note

V8 makes normalized PostgreSQL the live cloud persistence model and performs row-level writes. The Node process still keeps a working in-memory representation of the active dataset, and multi-table changes are not wrapped in one database transaction. For the first controlled beta, run **one application server instance**. Horizontal multi-instance scaling and a durable background worker are later hardening steps.

## Repository structure

```text
public/                 client + separate admin UI
lib/                    auth, Supabase runtime, integrations
migrations/             versioned PostgreSQL migrations
scripts/                migration + production verification
server.mjs              API + workflow engine
data/                    local development/cache data
docs/                    architecture + production setup
tests/                   local + cloud-runtime regression tests
Dockerfile               container deployment starter
render.yaml              deployment starter
```

## Current positioning

This remains an active personal software-engineering / SaaS portfolio project. The bundled demo contractor records and synthetic bids are fictional test data and are not verified real-company records.
