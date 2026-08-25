-- ForiForeign — 0015: opportunity intelligence upgrade.
-- Additive and idempotent. Run once after 0014.

-- Dedup fingerprint + stated financials (never invented; NULL = not stated on source)
alter table if exists public.opportunities
  add column if not exists fingerprint text,
  add column if not exists tuition text,
  add column if not exists application_fee text;
create index if not exists idx_opps_fingerprint on public.opportunities (fingerprint);
create index if not exists idx_opps_verified_at on public.opportunities (verified_at desc);

-- Configurable university database (admin-editable, guides discovery)
create table if not exists public.universities (
  id          uuid primary key default gen_random_uuid(),
  country_code text not null,
  name        text not null,
  priority    int  not null default 100,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (country_code, name)
);
create index if not exists idx_universities_cc on public.universities (country_code, enabled);

-- Per-user opportunity history (viewed / saved). Applied is tracked via applications.
create table if not exists public.user_opportunity_history (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  opportunity_id uuid not null,
  event          text not null,            -- viewed | saved | unsaved
  created_at     timestamptz not null default now()
);
create index if not exists idx_uoh_user on public.user_opportunity_history (user_id, event);
create index if not exists idx_apps_user_opp on public.applications (user_id, opportunity_id);
