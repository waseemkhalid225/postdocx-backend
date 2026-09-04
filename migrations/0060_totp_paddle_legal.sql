-- ForiForeign — 0060 · admin TOTP (second factor inside the app), Paddle gateway, legal re-acceptance, scholarship probes.
alter table if exists public.profiles add column if not exists totp_secret_enc text;
alter table if exists public.profiles add column if not exists totp_enabled boolean not null default false;
alter table if exists public.profiles add column if not exists legal_version_accepted text;
create table if not exists public.totp_sessions (token text primary key, user_id uuid not null, expires_at timestamptz not null);
alter table if exists public.institutions add column if not exists scholarship_probe_at timestamptz;
alter table if exists public.opportunities add column if not exists eligibility_flag text;   -- citizens_only | clearance | local_only | null
