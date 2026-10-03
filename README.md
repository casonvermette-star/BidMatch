# BidMatch AI V6.1.1 — Client Portal + Separate Platform Admin

BidMatch AI is a portfolio-ready construction procurement SaaS prototype with two deliberately separate applications served by the same backend:

- **Client Portal** (`/`) — general-contractor workspace for projects, bid documents, scope packages, subcontractor qualification/matching, outreach, bid leveling, exports, team access, and workspace settings.
- **Platform Admin** (`/admin`) — isolated platform-owner console for organizations, users, cross-workspace usage metrics, subscription status, integration health, and audit activity.

A client workspace owner is **not** a platform administrator. Client login credentials cannot access the platform-admin API. The admin console has its own email/password configuration and its own signed session cookie.

## Windows quick start

This build includes native Windows launchers. After installing Node.js 20+, extract the ZIP and double-click `start-windows.bat` for the client app. To test the separate platform admin console on a Windows computer, run `configure-admin-windows.bat` once and then `start-admin-windows.bat`. See `README-WINDOWS.md` for the complete instructions.

The shareable ZIP intentionally excludes `.env`, so private local admin credentials and API keys are not transferred to another computer.

## Run locally

Requirements: Node.js 20+.

### Client portal

```bash
npm start
```

or on macOS double-click `start.command`.

Open `http://localhost:3000`.

### Platform admin

With the BidMatch server running, open:

```text
http://localhost:3000/admin
```

On macOS you can also double-click `start-admin.command`. It will reuse an already-running BidMatch server when possible.

The downloadable local package includes a private `.env` with the initial admin account configured. `.env` is excluded by `.gitignore`, so the admin credential is not pushed when you upload the repo to GitHub.

To change the separate platform-admin email/password, double-click:

```text
configure-admin.command
```

Then restart the app.

## Authentication model

### Client roles

- **Owner** — full workspace control and billing.
- **Admin** — team/settings/import/backup administration.
- **Estimator** — project/scoping/bidding workflow.
- **Viewer** — read-only workspace access.

These roles exist only inside a client organization.

### Platform owner

The platform owner is configured separately with:

```text
PLATFORM_ADMIN_EMAIL
PLATFORM_ADMIN_PASSWORD_HASH
PLATFORM_ADMIN_SESSION_SECRET
```

The browser receives a separate HttpOnly admin session cookie after a successful `/admin` login. No client signup, invite, or workspace role can grant platform-admin access.

## Test

```bash
npm test
```

The smoke suite verifies:

- project workflow
- contractor qualification and bid leveling
- contractor CSV import
- team roles
- tenant isolation
- client accounts being blocked from platform-admin APIs
- separate platform-admin authentication
- cross-workspace admin aggregation

## Portfolio / GitHub setup

This repo is ready to upload to GitHub. Important files:

- `.gitignore` — keeps `.env`, auth data, uploads, and backups out of source control.
- `.github/workflows/ci.yml` — runs the smoke test on pushes and pull requests.
- `docs/index.html` — static portfolio page for GitHub Pages.
- `LINKEDIN_PROJECT.md` — concise project description for a LinkedIn Projects entry/post.
- `Dockerfile` and `render.yaml` — deployment starting points for a public live demo.

### GitHub Pages portfolio

GitHub Pages can host the **static portfolio page**, not the Node backend.

1. Push the repository to GitHub.
2. Open **Settings → Pages** in the repository.
3. Choose **Deploy from a branch**.
4. Select your default branch and the `/docs` folder.
5. Save.

For the interactive client portal and `/admin` console, deploy the Node application to a host that runs server-side JavaScript.

See `docs/GITHUB_AND_DEPLOY.md`.

## Platform Admin metrics

The separate admin console exposes aggregate operational visibility such as:

- total client workspaces
- platform users
- projects, documents, invitations, and bids
- workspace-level subscription status
- imported contractor counts
- AI/database/email/billing integration health
- queued background jobs
- recent cross-platform audit activity

Ordinary client users remain tenant-scoped and cannot use this admin API.

## Optional integrations

The app runs without paid services in local fallback mode. Optional production integrations are configured in `.env` using `.env.example`:

- OpenAI — document analysis / Q&A hooks
- Supabase — Postgres persistence and document storage
- Resend — invitation/follow-up email delivery
- Stripe — subscription checkout/webhook hooks

Never commit `.env`, API keys, real customer files, or production auth data.

## Repository structure

```text
public/
  index.html          Client portal
  app.js              Client application
  admin.html          Separate platform-admin application
  admin.js            Admin application
  styles.css          Shared UI styling
lib/
  auth.mjs            Client/workspace auth
  admin-auth.mjs      Separate platform-admin auth
  integrations.mjs    External services
server.mjs            API + workflow engine
data/                  Local demo datastore
docs/                  Architecture + GitHub Pages portfolio
.github/workflows/     CI
configure-admin.command
start.command
start-admin.command
Dockerfile
render.yaml
LINKEDIN_PROJECT.md
```

## Portfolio positioning

This is best presented as a **full-stack multi-tenant SaaS prototype / engineering portfolio project**, not as a production construction marketplace with verified real contractors. Bundled contractor identities and prequalification values are fictional demo data.
