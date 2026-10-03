-- Production-oriented schema starter for PostgreSQL / Supabase.
-- The local prototype does not require this file to run.

create extension if not exists pgcrypto;
create extension if not exists vector;

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table memberships (
  organization_id uuid references organizations(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role text not null check (role in ('owner','admin','estimator','viewer')),
  primary key (organization_id, user_id)
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  location text,
  project_type text,
  estimated_value numeric,
  bid_due date,
  description text,
  status text not null default 'draft',
  analysis jsonb,
  created_at timestamptz not null default now()
);

create table project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  file_name text not null,
  mime_type text,
  storage_path text not null,
  file_size bigint,
  parsed_text text,
  created_at timestamptz not null default now()
);

create table contractors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete set null,
  company_name text not null,
  email text,
  city text,
  service_states text[] not null default '{}',
  markets text[] not null default '{}',
  trades text[] not null default '{}',
  capabilities text[] not null default '{}',
  min_package numeric,
  max_package numeric,
  insurance_limit numeric,
  bond_capacity numeric,
  response_rate numeric,
  avg_response_hours numeric,
  employees integer,
  avg_annual_volume numeric,
  current_backlog numeric,
  backlog_utilization numeric,
  quality_score numeric,
  on_time_rate numeric,
  prequal_status text,
  safety_data jsonb not null default '{}',
  insurance_expiry date,
  bonding_status text,
  profile_embedding vector(1536),
  qualification_data jsonb,
  created_at timestamptz not null default now()
);

create table scopes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  trade text not null,
  csi_division text,
  summary text,
  requirements jsonb not null default '[]',
  confidence numeric,
  estimated_package numeric,
  manual_estimate boolean not null default false,
  source text not null default 'automation',
  scope_embedding vector(1536),
  created_at timestamptz not null default now()
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  scope_id uuid not null references scopes(id) on delete cascade,
  contractor_id uuid not null references contractors(id) on delete cascade,
  eligible boolean not null,
  score numeric not null,
  components jsonb not null default '{}',
  reasons jsonb not null default '[]',
  risks jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique(scope_id, contractor_id)
);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  scope_id uuid not null references scopes(id) on delete cascade,
  contractor_id uuid not null references contractors(id) on delete cascade,
  status text not null default 'queued',
  external_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique(scope_id, contractor_id)
);

create table bids (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  scope_id uuid not null references scopes(id) on delete cascade,
  contractor_id uuid not null references contractors(id) on delete cascade,
  raw_proposal text,
  parsed jsonb not null default '{}',
  manual_adjustment numeric not null default 0,
  manual_adjustment_reason text,
  created_at timestamptz not null default now(),
  unique(scope_id, contractor_id)
);

create table project_questions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  question text not null,
  answer text not null,
  sources jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  actor_user_id uuid references profiles(id) on delete set null,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
