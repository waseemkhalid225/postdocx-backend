-- ===== 0065_staff_processing.sql =====
alter table if exists public.profiles add column if not exists allow_staff_processing boolean not null default false;
