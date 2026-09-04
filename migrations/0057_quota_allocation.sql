-- ForiForeign — 0057 · agency quota allocation down the tree (branch → sub-branch → member), organisation search counters,
-- resale locks.
create table if not exists public.quota_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  scope_kind text not null check (scope_kind in ('branch','member')),
  scope_key text not null,                 -- branch path ("Lahore" or "Lahore/DHA") or user id
  cases_month integer not null default 0,
  searches_day integer not null default 0,
  set_by uuid, updated_at timestamptz not null default now(),
  unique (org_id, scope_kind, scope_key)
);
alter table if exists public.usage_meter add column if not exists scope_key text;
create index if not exists idx_usage_org_cap on public.usage_meter(org_id, capability, created_at desc);
alter table if exists public.org_subscriptions add column if not exists searches_day integer;
alter table if exists public.org_subscriptions add column if not exists searches_month integer;
alter table if exists public.org_subscriptions add column if not exists billing_period text not null default 'month';
alter table if exists public.clients add column if not exists origin_org_locked boolean not null default true;
