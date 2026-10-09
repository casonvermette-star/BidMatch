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
