-- ForiForeign — 0033 · Phase 0 of the Global Mobility OS.
-- Additive and idempotent. Existing B2C behaviour is untouched: every user keeps working
-- exactly as before; a "personal" organisation is created lazily on first use.

-- 1. Organisations: the tenancy root (personal, agency, institution, employer, partner).
create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'personal' check (kind in ('personal','agency','institution','employer','partner')),
  owner_id uuid not null,
  country_code text not null default 'PK',
  slug text unique,
  settings jsonb not null default '{}'::jsonb,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);
create index if not exists idx_orgs_owner on public.organisations(owner_id);

-- 2. Membership with an org-level role (separate from the platform role in profiles).
create table if not exists public.org_members (
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'consultant' check (role in ('owner','manager','consultant','sub_agent','viewer')),
  branch text,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists idx_org_members_user on public.org_members(user_id);

-- 3. Clients: a person a consultant works for. May or may not have their own login yet.
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  owner_user_id uuid not null,
  user_id uuid,
  full_name text not null,
  email text,
  phone text,
  whatsapp text,
  nationality text not null default 'PK',
  lane text not null default 'both' check (lane in ('study','work','both')),
  stage text not null default 'discover' check (stage in ('lead','discover','qualify','match','decide','prepare','apply','offer','visa','travel','arrive','settle','pr','closed')),
  profile jsonb not null default '{}'::jsonb,
  identity_hash text,
  origin_partner uuid,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_clients_identity on public.clients(org_id, identity_hash) where identity_hash is not null;
create index if not exists idx_clients_org_stage on public.clients(org_id, stage);

-- 4. Job queue: long work (discovery, preparation, OCR) leaves the request thread.
create table if not exists public.job_queue (
  id bigserial primary key,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','done','failed','dead')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  result jsonb,
  org_id uuid,
  user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_job_queue_ready on public.job_queue(status, run_after);

-- 5. Provenance on every opportunity fact row.
alter table if exists public.opportunities add column if not exists source_kind text;
alter table if exists public.opportunities add column if not exists confidence numeric;
alter table if exists public.opportunities add column if not exists last_verified_at timestamptz;

-- 6. Row-level security: members see their own organisation only. The server uses the
--    service role; these policies protect direct client access.
alter table public.organisations enable row level security;
alter table public.org_members enable row level security;
alter table public.clients enable row level security;
drop policy if exists org_member_read on public.organisations;
create policy org_member_read on public.organisations for select using (
  owner_id = auth.uid() or exists (select 1 from public.org_members m where m.org_id = organisations.id and m.user_id = auth.uid()));
drop policy if exists org_members_read on public.org_members;
create policy org_members_read on public.org_members for select using (user_id = auth.uid() or exists (select 1 from public.org_members m where m.org_id = org_members.org_id and m.user_id = auth.uid()));
drop policy if exists clients_member_read on public.clients;
create policy clients_member_read on public.clients for select using (
  user_id = auth.uid() or exists (select 1 from public.org_members m where m.org_id = clients.org_id and m.user_id = auth.uid()));
