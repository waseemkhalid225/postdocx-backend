-- ForiForeign — 0080 · Smart visa status: decision from mail first, manual update second, one automated check after the country's usual time, never a second attempt.
alter table if exists public.visa_cases add column if not exists manual_status_at timestamptz;
alter table if exists public.visa_cases add column if not exists manual_note text;
alter table if exists public.visa_cases add column if not exists auto_checked_at timestamptz;
alter table if exists public.visa_cases add column if not exists auto_check_result text;
alter table if exists public.visa_cases add column if not exists decision_from_mail_at timestamptz;
alter table if exists public.profiles add column if not exists province text;
alter table if exists public.profiles add column if not exists postal_code text;
alter table if exists public.profiles add column if not exists birth_place text;
alter table if exists public.profiles add column if not exists passport_issue text;
alter table if exists public.profiles add column if not exists passport_expiry text;
alter table if exists public.profiles add column if not exists father_name text;
alter table if exists public.profiles add column if not exists mother_name text;
alter table if exists public.profiles add column if not exists previous_refusals text;
