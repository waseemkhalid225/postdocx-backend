-- ForiForeign — 0037 · Day 3: agency subscriptions, offers & conditions, interview preparation. Additive, idempotent.
create table if not exists public.org_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  tier_key text not null,
  tier_name text,
  usd_month numeric not null default 0,
  cases_month integer not null default 0,
  cases_used integer not null default 0,
  status text not null default 'pending' check (status in ('pending','active','past_due','cancelled','expired')),
  period_start timestamptz,
  period_end timestamptz,
  gateway_ref text,
  payment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_org_subs_org on public.org_subscriptions(org_id, status);
alter table if exists public.payments add column if not exists kind text not null default 'package';   -- package | agency_subscription
alter table if exists public.payments add column if not exists subscription_id uuid;
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  client_id uuid,
  org_id uuid,
  application_id uuid,
  opportunity_id uuid,
  kind text not null default 'admission' check (kind in ('admission','job','scholarship','other')),
  offer_type text not null default 'conditional' check (offer_type in ('conditional','unconditional','verbal','written')),
  issuer text,
  title text,
  country_code text,
  received_on date,
  decision_deadline date,
  deposit_usd numeric,
  deposit_deadline date,
  salary_or_funding text,
  conditions jsonb not null default '[]'::jsonb,   -- [{text, met:boolean, due:date, evidence_document_id}]
  status text not null default 'received' check (status in ('received','accepted','declined','expired','withdrawn')),
  notes text,
  document_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_offers_user on public.offers(user_id, status);
create table if not exists public.interview_preps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  application_id uuid,
  opportunity_id uuid,
  offer_id uuid,
  role_title text,
  content jsonb not null default '{}'::jsonb,
  model text,
  created_at timestamptz not null default now()
);
create index if not exists idx_interview_user on public.interview_preps(user_id, created_at desc);
alter table public.offers enable row level security;
drop policy if exists offers_owner_read on public.offers;
create policy offers_owner_read on public.offers for select using (user_id = auth.uid());
alter table public.interview_preps enable row level security;
drop policy if exists interview_owner_read on public.interview_preps;
create policy interview_owner_read on public.interview_preps for select using (user_id = auth.uid());
