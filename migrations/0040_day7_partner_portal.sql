-- ForiForeign — 0040 · Day 7: institution / employer partner portal and service partners. Additive, idempotent.
create table if not exists public.partner_openings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  created_by uuid,
  kind text not null default 'study' check (kind in ('study','postdoc','phd','masters','work')),
  title text not null,
  level text,
  field text,
  country_code text not null,
  city text,
  description text,
  requirements text,
  funding_or_salary text,
  deadline date,
  url text,
  contact_email text,
  status text not null default 'draft' check (status in ('draft','live','closed')),
  opportunity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_partner_openings_org on public.partner_openings(org_id, status);
create table if not exists public.application_shares (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  user_id uuid not null,
  org_id uuid not null references public.organisations(id) on delete cascade,
  opening_id uuid,
  consent boolean not null default false,
  shared_at timestamptz,
  partner_status text not null default 'received' check (partner_status in ('received','reviewing','shortlisted','interview','offer','rejected')),
  partner_note text,
  created_at timestamptz not null default now(),
  unique (application_id, org_id)
);
create index if not exists idx_app_shares_org on public.application_shares(org_id, partner_status);
create table if not exists public.service_partners (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  slot text not null check (slot in ('insurance','sim','housing','pickup','bank','forex','attestation','flights','finance','visa_desk','translation','other')),
  name text not null,
  url text,
  whatsapp text,
  countries text[] not null default '{}',
  description text,
  status text not null default 'live' check (status in ('draft','live','paused')),
  created_at timestamptz not null default now()
);
create index if not exists idx_service_partners_slot on public.service_partners(slot, status);
alter table if exists public.opportunities add column if not exists partner_org_id uuid;
alter table if exists public.opportunities add column if not exists is_partner boolean not null default false;
alter table public.partner_openings enable row level security;
drop policy if exists openings_member_read on public.partner_openings;
create policy openings_member_read on public.partner_openings for select using (exists (select 1 from public.org_members m where m.org_id = partner_openings.org_id and m.user_id = auth.uid()));
alter table public.application_shares enable row level security;
drop policy if exists shares_read on public.application_shares;
create policy shares_read on public.application_shares for select using (user_id = auth.uid() or exists (select 1 from public.org_members m where m.org_id = application_shares.org_id and m.user_id = auth.uid()));
alter table public.service_partners enable row level security;
drop policy if exists service_partners_public on public.service_partners;
create policy service_partners_public on public.service_partners for select using (status = 'live');
