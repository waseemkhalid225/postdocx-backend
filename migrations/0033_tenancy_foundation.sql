-- ForiForeign — 0033: Phase 0 tenancy foundation (Global Mobility OS).
-- Backward-compatible: every existing user becomes the owner of a personal organisation,
-- so the B2C product keeps working unchanged while agencies, consultants, institutions,
-- employers and partners get real homes. Fully idempotent.

create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'personal'
    check (kind in ('personal','agency','institution','employer','partner','platform')),
  name text not null,
  slug text unique,
  country_code text,
  owner_user_id uuid,
  plan text not null default 'free',            -- free | agency_starter | agency_growth | enterprise
  settings jsonb not null default '{}'::jsonb,   -- white-label, branding, commission rules
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'consultant'
    check (role in ('owner','branch_manager','consultant','sub_agent','referral_partner','recruiter','viewer')),
  branch text,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists idx_org_members_user on public.org_members (user_id);

-- A client is the person an organisation is moving abroad. For a personal org the
-- client IS the user; for an agency it is the applicant the consultant created.
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid,                                  -- linked login, if the client has one
  owner_user_id uuid,                            -- consultant who owns the relationship
  origin_partner_id uuid,                        -- referral / sub-agent attribution
  full_name text,
  email text,
  phone text,
  identity_hash text,                            -- sha256(CNIC|passport) for duplicate detection
  stage text not null default 'discover'
    check (stage in ('lead','discover','qualify','match','decide','prepare','apply','secured','visa','travel','arrived','settled','pr')),
  profile jsonb not null default '{}'::jsonb,    -- Global Mobility Profile (Phase 1 fills this)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_clients_org on public.clients (org_id, stage);
create index if not exists idx_clients_identity on public.clients (identity_hash);
create index if not exists idx_clients_user on public.clients (user_id);

-- Every fact will know where it came from (Phase 0 columns, Phase 1 fills them).
alter table if exists public.opportunities add column if not exists source_class text;      -- live_api | live_feed | partner | government | permitted_web | manual | static | unverified
alter table if exists public.opportunities add column if not exists source_fetched_at timestamptz;
alter table if exists public.opportunities add column if not exists provenance jsonb not null default '{}'::jsonb;
alter table if exists public.applications  add column if not exists client_id uuid;
alter table if exists public.applications  add column if not exists org_id uuid;
alter table if exists public.payments      add column if not exists org_id uuid;

-- Backfill: one personal organisation per existing profile, owner = the user.
insert into public.organisations (kind, name, owner_user_id)
select 'personal', coalesce(nullif(p.full_name,''), 'Personal'), p.id
from public.profiles p
where not exists (select 1 from public.organisations o where o.owner_user_id = p.id and o.kind = 'personal');

insert into public.org_members (org_id, user_id, role)
select o.id, o.owner_user_id, 'owner' from public.organisations o
where o.kind = 'personal' and o.owner_user_id is not null
  and not exists (select 1 from public.org_members m where m.org_id = o.id and m.user_id = o.owner_user_id);

insert into public.clients (org_id, user_id, owner_user_id, full_name, email, stage)
select o.id, p.id, p.id, p.full_name, p.email, 'discover'
from public.organisations o join public.profiles p on p.id = o.owner_user_id
where o.kind = 'personal'
  and not exists (select 1 from public.clients c where c.org_id = o.id and c.user_id = p.id);

-- Row-level security: members see their organisation only. Service role bypasses.
alter table public.organisations enable row level security;
alter table public.org_members  enable row level security;
alter table public.clients      enable row level security;
drop policy if exists org_member_read on public.organisations;
create policy org_member_read on public.organisations for select
  using (exists (select 1 from public.org_members m where m.org_id = organisations.id and m.user_id = auth.uid()));
drop policy if exists org_members_self on public.org_members;
create policy org_members_self on public.org_members for select
  using (user_id = auth.uid() or exists (select 1 from public.org_members m where m.org_id = org_members.org_id and m.user_id = auth.uid() and m.role in ('owner','branch_manager')));
drop policy if exists clients_member_read on public.clients;
create policy clients_member_read on public.clients for select
  using (exists (select 1 from public.org_members m where m.org_id = clients.org_id and m.user_id = auth.uid()));
