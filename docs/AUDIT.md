# BidMatch AI V8 cloud-runtime audit

Automated checks cover:

- client/admin auth separation
- tenant isolation
- project/document workflow
- contractor matching and qualification gates
- secure subcontractor portal
- bid submission and leveling
- normalized Supabase state round-trip
- row deletion synchronization
- `sb_secret_*` API-key header handling
- complete server startup in Supabase runtime mode
- cloud persistence of workspace/user/project records

Known remaining hardening work is documented in `V8_CLOUD_RUNTIME.md` and `PRODUCTION.md`.
