-- BidMatch AI V8 combined Supabase production setup.
-- Prefer running /migrations files individually in order.

-- BidMatch AI V8 cloud runtime
-- Run in a NEW Supabase/PostgreSQL project before migrating local data.
create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role text not null check (role in ('owner','admin','estimator','viewer')),
  password_hash text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists app_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner','admin','estimator','viewer')),
  token_hash text not null unique,
  created_by text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz
);

create table if not exists password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists organization_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by uuid references app_users(id) on delete set null,
  name text not null,
  location text not null default '',
  state text,
  project_type text,
  estimated_value numeric(16,2),
  bid_due date,
  description text not null default '',
  status text not null default 'draft',
  workflow_stage text not null default 'intake',
  analysis jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  file_size bigint not null default 0,
  storage_provider text not null default 'supabase',
  storage_path text not null,
  parsed_text text,
  kind text not null default 'project-document',
  bid_id uuid,
  invitation_id uuid,
  contractor_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists contractors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  company_name text not null,
  email text,
  city text,
  home_state text,
  service_states text[] not null default '{}',
  license_states text[] not null default '{}',
  markets text[] not null default '{}',
  trades text[] not null default '{}',
  capabilities text[] not null default '{}',
  min_package numeric(16,2),
  max_package numeric(16,2),
  insurance_limit numeric(16,2),
  bond_capacity numeric(16,2),
  response_rate numeric,
  avg_response_hours numeric,
  employees integer,
  years_in_business integer,
  avg_annual_volume numeric(16,2),
  current_backlog numeric(16,2),
  backlog_utilization numeric,
  quality_score numeric,
  on_time_rate numeric,
  relationship_score numeric,
  prequal_status text,
  safety_data jsonb not null default '{}'::jsonb,
  insurance_expiry date,
  bonding_status text,
  certifications text[] not null default '{}',
  description text,
  past_projects jsonb not null default '[]'::jsonb,
  qualification_data jsonb not null default '{}'::jsonb,
  profile_embedding vector(1536),
  demo_data boolean not null default false,
  last_verified timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists scopes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  trade text not null,
  csi_division text,
  summary text,
  requirements jsonb not null default '[]'::jsonb,
  keywords jsonb not null default '[]'::jsonb,
  confidence numeric,
  estimated_package numeric(16,2),
  manual_estimate boolean not null default false,
  qualification jsonb,
  source text not null default 'automation',
  scope_embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists contractor_matches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  scope_id uuid not null references scopes(id) on delete cascade,
  contractor_id uuid not null references contractors(id) on delete cascade,
  eligible boolean not null default false,
  qualification_status text not null default 'conditional',
  score numeric not null default 0,
  recommendation text,
  components jsonb not null default '{}'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  qualification jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(scope_id, contractor_id)
);

create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  scope_id uuid not null references scopes(id) on delete cascade,
  contractor_id uuid not null references contractors(id) on delete cascade,
  status text not null default 'queued',
  message text,
  manual boolean not null default false,
  sent_externally boolean not null default false,
  external_message_id text,
  public_token_hash text unique,
  public_token_expires_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique(scope_id, contractor_id)
);

create table if not exists bids (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  scope_id uuid not null references scopes(id) on delete cascade,
  contractor_id uuid not null references contractors(id) on delete cascade,
  raw_proposal text,
  parsed jsonb not null default '{}'::jsonb,
  manual_adjustment numeric(16,2) not null default 0,
  manual_adjustment_reason text,
  proposal_document_id uuid references project_documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique(scope_id, contractor_id)
);

create table if not exists project_questions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid references app_users(id) on delete set null,
  question text not null,
  answer text not null,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  actor_user_id uuid references app_users(id) on delete set null,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  organization_id uuid primary key references organizations(id) on delete cascade,
  status text not null default 'not-configured',
  plan text not null default 'none',
  customer_id text,
  subscription_id text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists background_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  job_type text not null,
  status text not null default 'queued',
  run_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Performance and operational indexes.
create index if not exists idx_users_org on app_users(organization_id);
create unique index if not exists uq_app_users_email_lower on app_users(lower(email));
create index if not exists idx_sessions_user on app_sessions(user_id);
create index if not exists idx_sessions_expiry on app_sessions(expires_at);
create index if not exists idx_invites_org on app_invites(organization_id);
create index if not exists idx_invites_expiry on app_invites(expires_at);
create index if not exists idx_password_resets_user on password_resets(user_id);
create index if not exists idx_password_resets_expiry on password_resets(expires_at);
create index if not exists idx_projects_org on projects(organization_id);
create index if not exists idx_projects_due on projects(bid_due);
create index if not exists idx_docs_project on project_documents(project_id);
create index if not exists idx_docs_kind on project_documents(project_id, kind);
create index if not exists idx_contractors_org on contractors(organization_id);
create index if not exists idx_contractors_trades on contractors using gin(trades);
create index if not exists idx_contractors_states on contractors using gin(service_states);
create index if not exists idx_scopes_project on scopes(project_id);
create index if not exists idx_matches_project on contractor_matches(project_id);
create index if not exists idx_matches_scope_score on contractor_matches(scope_id, score desc);
create index if not exists idx_invitations_project on invitations(project_id);
create index if not exists idx_invitations_status on invitations(status);
create index if not exists idx_invitations_public_expiry on invitations(public_token_expires_at);
create index if not exists idx_bids_project on bids(project_id);
create index if not exists idx_qa_project on project_questions(project_id);
create index if not exists idx_audit_org_created on audit_events(organization_id, created_at desc);
create index if not exists idx_audit_project_created on audit_events(project_id, created_at desc);
create index if not exists idx_jobs_due on background_jobs(status, run_at);

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
