-- ===== 0067_channel_identity.sql =====
alter table if exists public.applications add column if not exists channel_kind text;      -- direct | agency
alter table if exists public.applications add column if not exists channel_org_id uuid;
create index if not exists idx_apps_channel on public.applications(channel_org_id);
