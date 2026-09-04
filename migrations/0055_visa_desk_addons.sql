-- ForiForeign — 0055 · Visa desk (end-to-end visa processing in the platform), add-on packs, partner spotlight.
alter table if exists public.visa_cases add column if not exists appointment_at timestamptz;
alter table if exists public.visa_cases add column if not exists appointment_place text;
alter table if exists public.visa_cases add column if not exists tracking_ref text;
alter table if exists public.visa_cases add column if not exists decision_text text;
alter table if exists public.visa_cases add column if not exists steps jsonb not null default '{}'::jsonb;    -- {prepare:done, booked:done, submitted:done, tracking:done, decision:done}
create table if not exists public.user_addons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, addon_key text not null, payment_id uuid, granted_by uuid,
  expires_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists idx_user_addons on public.user_addons(user_id, addon_key);
alter table if exists public.payments add column if not exists addon_key text;
alter table if exists public.partner_openings add column if not exists spotlight boolean not null default false;
alter table if exists public.partner_openings add column if not exists spotlight_until date;
