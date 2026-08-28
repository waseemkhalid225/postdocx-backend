-- ForiForeign — 0023: trust & visibility pack + ops safety net
-- Fully idempotent: safe to paste into the production Supabase SQL Editor as-is.

-- 1) Safety net: core tables the new code leans on harder.
--    (Exist in production since the early era; created here for completeness / fresh installs.)
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  delta integer not null,
  reason text,
  application_id uuid,
  payment_id uuid,
  note text,
  created_at timestamptz not null default now()
);

create or replace function public.credit_balance(uid uuid)
returns integer
language sql
stable
as $$
  select coalesce(sum(delta), 0)::integer from public.credit_ledger where user_id = uid;
$$;

-- 2) Performance indexes for the new hot paths:
--    /api/stats + freshness counts (status + created_at)
create index if not exists idx_opps_status_created on public.opportunities (status, created_at desc);
--    country-scoped fulfillment counting and SEO pages (status + country)
create index if not exists idx_opps_status_country on public.opportunities (status, country_code);
--    per-user entitlement + package meter
create index if not exists idx_credit_ledger_user on public.credit_ledger (user_id);
create index if not exists idx_applications_user on public.applications (user_id);
--    started-opportunity annotation
create index if not exists idx_applications_user_opp on public.applications (user_id, opportunity_id);

-- 3) app_settings hygiene: the table now also stores per-user keys
--    (lastRun:<uid>, discover:<uid>, prefs:<uid>). Keep updated_at fresh on upsert.
create or replace function public.touch_app_settings()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists trg_touch_app_settings on public.app_settings;
create trigger trg_touch_app_settings before update on public.app_settings
for each row execute function public.touch_app_settings();

-- 4) Optional monthly cleanup helper for stale per-user keys (call manually or via cron):
--    select public.cleanup_app_settings();
create or replace function public.cleanup_app_settings()
returns integer language sql as $$
  with del as (
    delete from public.app_settings
    where (key like 'lastRun:%' or key like 'discover:%')
      and updated_at < now() - interval '30 days'
    returning 1
  ) select count(*)::integer from del;
$$;
