-- ForiForeign — 0050 · the 20-gap fix pass: attachments, journey engine, consent confirmation, licences, refunds,
-- session revocation, change detection, metering, retention, sources, work-permit tracks.
alter table if exists public.case_messages add column if not exists confidence numeric;
alter table if exists public.case_messages add column if not exists needs_confirmation boolean not null default false;
alter table if exists public.profiles add column if not exists next_action jsonb;              -- the ONE next action (journey engine)
alter table if exists public.profiles add column if not exists journey_stage text;
alter table if exists public.profiles add column if not exists role_changed_at timestamptz;      -- tokens issued before this are rejected
alter table if exists public.portal_connections add column if not exists applicant_confirmed boolean not null default false;
alter table if exists public.portal_connections add column if not exists confirm_token text;
alter table if exists public.portal_connections add column if not exists connected_by uuid;
create table if not exists public.consultant_licences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null,
  body text not null,                 -- OISC, MARA, RCIC (CICC), IAA (NZ), Bar/Law Society, Other
  jurisdiction text not null,         -- GB, AU, CA, NZ, ...
  number text not null,
  expires_on date,
  evidence_document_id uuid,
  status text not null default 'declared' check (status in ('declared','verified','expired','rejected')),
  verified_by uuid, verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_licences_user on public.consultant_licences(user_id, status);
create table if not exists public.usage_meter (
  id bigserial primary key,
  user_id uuid not null, org_id uuid,
  capability text not null,           -- interview_prep, refusal_analysis, doc_read, case_brain, discovery, portal_watch
  units integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists idx_usage_user_cap on public.usage_meter(user_id, capability, created_at desc);
create table if not exists public.rule_sources (
  source_url text primary key,
  last_hash text, last_checked_at timestamptz, last_changed_at timestamptz, status text not null default 'ok'
);
alter table if exists public.visa_rules add column if not exists source_changed boolean not null default false;
create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('greenhouse','lever','workable','rss','json')),
  key text not null,                  -- board token / company slug / feed URL
  org_name text, country_code text, lane text not null default 'work' check (lane in ('study','work')),
  enabled boolean not null default true,
  last_run_at timestamptz, last_count integer, last_error text,
  created_at timestamptz not null default now(),
  unique (kind, key)
);
alter table if exists public.opportunities add column if not exists posted_at timestamptz;
alter table if exists public.opportunities add column if not exists source_key text;
alter table if exists public.payments add column if not exists refunded_at timestamptz;
alter table if exists public.payments add column if not exists refund_ref text;
-- Multi-instance safe job claim: one row, locked, skipped by other workers.
create or replace function public.claim_job(worker text) returns setof public.job_queue language plpgsql as $$
declare j public.job_queue;
begin
  select * into j from public.job_queue where status = 'queued' and run_after <= now() order by id for update skip locked limit 1;
  if not found then return; end if;
  update public.job_queue set status = 'running', locked_at = now(), locked_by = worker, attempts = attempts + 1, updated_at = now() where id = j.id returning * into j;
  return next j;
end $$;
