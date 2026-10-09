# BidMatch AI V8 cloud-runtime checkpoint

## Completed

- normalized PostgreSQL runtime loader
- normalized row-level persistence diff
- current Supabase secret-key header behavior
- private Storage integration
- local-to-normalized migration tooling
- explicit local/cloud backend switch
- full cloud-runtime server regression test

## Runtime modes

`DATA_BACKEND=local` keeps the audited local JSON/auth workflow.

`DATA_BACKEND=supabase` loads organizations, users, projects, documents, contractors, scopes, matches, invitations, bids, questions, audit events, subscriptions, and jobs from normalized PostgreSQL tables. Auth and application changes are written back to those tables.

Local JSON files remain as a diagnostic/cache copy in cloud mode, but they are not the startup source of truth.

## Safety rules for migration

For an existing workspace:

1. keep `DATA_BACKEND=local`
2. create the Supabase schema
3. configure the server secret
4. dry-run export
5. inspect the normalized export
6. apply migration
7. switch to `DATA_BACKEND=supabase`
8. restart and verify counts

Never switch first and assume local records will be imported automatically.

## Remaining production work

- durable job queue / worker
- direct or resumable large-file uploads
- malware/file scanning
- AI indexing with page-level citations
- Stripe plan/usage enforcement
- admin MFA and final security review
- restore-tested backups and operational monitoring
- eventual multi-instance concurrency/transaction hardening
