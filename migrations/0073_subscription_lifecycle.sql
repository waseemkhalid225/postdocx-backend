-- ForiForeign — 0073 · Subscription lifecycle for FF-CRM: renewal reminders, 3-day grace, invoices, renewals, all traceable.
alter table if exists public.org_subscriptions add column if not exists reminded_7 timestamptz;
alter table if exists public.org_subscriptions add column if not exists reminded_3 timestamptz;
alter table if exists public.org_subscriptions add column if not exists reminded_0 timestamptz;
alter table if exists public.org_subscriptions add column if not exists grace_until timestamptz;
alter table if exists public.org_subscriptions add column if not exists renewed_from uuid;
alter table if exists public.org_subscriptions add column if not exists gateway_subscription_id text;
create table if not exists public.org_invoices (
  id uuid primary key default gen_random_uuid(), ref text unique,
  org_id uuid, subscription_id uuid, payment_id uuid,
  tier_key text, tier_name text, billing_period text, amount_usd numeric not null default 0, currency text not null default 'USD',
  period_start timestamptz, period_end timestamptz, status text not null default 'paid',   -- paid | refunded | void
  gateway text, gateway_ref text, pdf_path text, emailed_to text, emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_org_invoices_org on public.org_invoices(org_id, created_at desc);
