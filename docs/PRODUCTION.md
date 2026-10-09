# BidMatch AI V8 production checklist

Before a controlled pilot:

- [ ] dedicated Supabase staging project
- [ ] V8 SQL migrations applied
- [ ] local data migration dry-run reviewed
- [ ] migration applied successfully
- [ ] `DATA_BACKEND=supabase`
- [ ] `/api/health` reports Supabase backend
- [ ] private document upload/download tested
- [ ] client tenant isolation tested
- [ ] separate platform-admin login tested
- [ ] password reset tested
- [ ] subcontractor secure portal tested
- [ ] HTTPS app URL + trusted origins configured
- [ ] Resend domain/sender verified before real outreach
- [ ] backup/recovery process documented
- [ ] monitoring/error reporting added before broader paid launch

V8 is appropriate for development, staging, and a tightly controlled single-server pilot after the checklist is completed. It is not yet the final horizontally scaled enterprise architecture.
