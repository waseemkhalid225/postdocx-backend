-- ForiForeign — 0043 · Days 16-20: notifications, sponsor register, dependants, PR tracker, Lemon Squeezy. Additive, idempotent.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  org_id uuid,
  kind text not null,                 -- task_due, offer_deadline, payment_approved, applicant_status, visa_rule_verified, journey_reminder, system
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user on public.notifications(user_id, read_at, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists notifications_owner on public.notifications;
create policy notifications_owner on public.notifications for select using (user_id = auth.uid());
create table if not exists public.sponsor_register (
  id bigserial primary key,
  country_code text not null,
  org_name text not null,
  org_norm text not null,
  town text,
  route text,
  rating text,
  source_url text,
  imported_at timestamptz not null default now()
);
create index if not exists idx_sponsor_norm on public.sponsor_register(country_code, org_norm);
alter table if exists public.opportunities add column if not exists sponsor_verified boolean;
alter table if exists public.opportunities add column if not exists sponsor_checked_at timestamptz;
alter table if exists public.profiles add column if not exists arrival_date date;
alter table if exists public.profiles add column if not exists dependants jsonb not null default '[]'::jsonb;
alter table if exists public.payments add column if not exists provider text;
