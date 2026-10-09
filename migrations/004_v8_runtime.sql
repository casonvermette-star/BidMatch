-- BidMatch AI V8 normalized runtime hardening.
-- Supabase secret keys map to the service_role Postgres role. The Node backend
-- is the trusted data boundary; browser clients receive no database key.

grant usage on schema public to service_role;
grant all privileges on table organizations to service_role;
grant all privileges on table app_users to service_role;
grant all privileges on table app_sessions to service_role;
grant all privileges on table app_invites to service_role;
grant all privileges on table password_resets to service_role;
grant all privileges on table organization_settings to service_role;
grant all privileges on table projects to service_role;
grant all privileges on table project_documents to service_role;
grant all privileges on table contractors to service_role;
grant all privileges on table scopes to service_role;
grant all privileges on table contractor_matches to service_role;
grant all privileges on table invitations to service_role;
grant all privileges on table bids to service_role;
grant all privileges on table project_questions to service_role;
grant all privileges on table audit_events to service_role;
grant all privileges on table subscriptions to service_role;
grant all privileges on table background_jobs to service_role;

-- Keep the production bucket private and raise the storage-side ceiling to
-- match the V8 application default (50 MB files, with room for larger future
-- direct-upload workflows).
insert into storage.buckets (id, name, public, file_size_limit)
values ('bidmatch-documents','bidmatch-documents',false,104857600)
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit;
