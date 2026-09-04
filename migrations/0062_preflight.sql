-- ===== 0062_preflight.sql =====
alter table if exists public.applications add column if not exists preflight_at timestamptz;
