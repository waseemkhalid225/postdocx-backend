-- ForiForeign — 0038 · Day 4: Visa Intelligence. Every rule carries its source, dates, version and
-- verification state. Nothing here is presented as fact until an admin verifies it. Additive, idempotent.
create table if not exists public.visa_rules (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  route_key text not null,             -- e.g. uk_student, de_national_study, ca_study_permit, au_500, uk_skilled_worker
  route_name text not null,
  lane text not null default 'both' check (lane in ('study','work','both')),
  rule_type text not null check (rule_type in ('eligibility','document','financial','language','fee','processing','work_rights','dependants','post_arrival','pr_path','note')),
  text text not null,
  value jsonb not null default '{}'::jsonb,   -- machine-readable: {doc_type}, {amount, currency, per}, {test, min}, {days}
  source_url text,
  source_title text,
  published_date date,
  effective_date date,
  last_verified_at timestamptz,
  verified_by uuid,
  version integer not null default 1,
  confidence numeric not null default 0.5,
  status text not null default 'unverified' check (status in ('unverified','verified','superseded','disputed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_visa_rules_route on public.visa_rules(country_code, route_key, status);
create table if not exists public.visa_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  client_id uuid,
  org_id uuid,
  offer_id uuid,
  country_code text not null,
  route_key text not null,
  status text not null default 'draft' check (status in ('draft','preparing','ready','submitted','decision_pending','granted','refused','withdrawn')),
  prefill jsonb not null default '{}'::jsonb,
  checklist jsonb not null default '{}'::jsonb,
  submitted_on date,
  decision_on date,
  refusal jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_visa_cases_user on public.visa_cases(user_id, status);
alter table public.visa_cases enable row level security;
drop policy if exists visa_cases_owner_read on public.visa_cases;
create policy visa_cases_owner_read on public.visa_cases for select using (user_id = auth.uid());
alter table public.visa_rules enable row level security;
drop policy if exists visa_rules_public_read on public.visa_rules;
create policy visa_rules_public_read on public.visa_rules for select using (true);
