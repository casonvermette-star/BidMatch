-- BidMatch AI V5 minimal Supabase setup.
-- Run in the Supabase SQL editor for the snapshot/storage adapter used by V5.
-- The service-role key belongs ONLY on the server; never expose it to browser code.

create table if not exists public.bidmatch_state (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.bidmatch_state enable row level security;

create table if not exists public.bidmatch_auth_state (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.bidmatch_auth_state enable row level security;
-- No browser policies are intentionally created. The Node server uses the
-- service-role key and therefore remains the only writer/reader for this table.

insert into storage.buckets (id, name, public, file_size_limit)
values ('bidmatch-documents', 'bidmatch-documents', false, 12582912)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

-- Optional normalized production tables used as the long-term migration target.
-- The current V5 adapter persists a server-side snapshot in bidmatch_state so the
-- app can switch between local JSON and Supabase without changing UI workflows.
create table if not exists public.outreach_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  project_id text not null,
  invitation_id text,
  job_type text not null,
  run_at timestamptz not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.subscription_status (
  organization_id text primary key,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
