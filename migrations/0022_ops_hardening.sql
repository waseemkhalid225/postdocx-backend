-- ForiForeign — 0022: operations hardening (error monitoring + background jobs)
create table if not exists public.error_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz default now(),
  request_id text, area text, user_id uuid, message text, detail text
);
create index if not exists idx_error_log_at on public.error_log (at desc);
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null, idem_key text unique, user_id uuid,
  status text default 'running',           -- running | done | failed
  attempts int default 0, last_error text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists idx_jobs_status on public.jobs (status, kind);
alter table if exists public.opportunities add column if not exists verification_confidence text;
