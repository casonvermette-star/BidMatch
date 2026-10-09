-- Defense-in-depth for Supabase deployments.
-- BidMatch V8 accesses data through its Node server with a server-only Supabase secret key (service_role privileges).
-- RLS is enabled with no public policies so anon/authenticated browser clients cannot
-- directly query tenant data if a Supabase URL leaks into client code.

alter table organizations enable row level security;
alter table app_users enable row level security;
alter table app_sessions enable row level security;
alter table app_invites enable row level security;
alter table password_resets enable row level security;
alter table organization_settings enable row level security;
alter table projects enable row level security;
alter table project_documents enable row level security;
alter table contractors enable row level security;
alter table scopes enable row level security;
alter table contractor_matches enable row level security;
alter table invitations enable row level security;
alter table bids enable row level security;
alter table project_questions enable row level security;
alter table audit_events enable row level security;
alter table subscriptions enable row level security;
alter table background_jobs enable row level security;

-- Create a private bucket if it does not already exist. The server secret maps to service_role privileges and bypasses RLS.
insert into storage.buckets (id, name, public, file_size_limit)
values ('bidmatch-documents','bidmatch-documents',false,104857600)
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit;
