-- ForiForeign — 0044 · Days 21-25: email preference, partner pilots. Additive, idempotent.
alter table if exists public.profiles add column if not exists notify_email boolean not null default true;
alter table if exists public.organisations add column if not exists pilot boolean not null default false;
alter table if exists public.organisations add column if not exists pilot_started_at timestamptz;
alter table if exists public.organisations add column if not exists pilot_notes text;
