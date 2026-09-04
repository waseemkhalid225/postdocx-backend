-- ForiForeign — 0080 · Visa status strategy: email first, manual second, one portal check after the country's usual processing time, never daily, never a second attempt.
alter table if exists public.visa_cases add column if not exists check_after date;
alter table if exists public.visa_cases add column if not exists check_attempts integer not null default 0;
alter table if exists public.visa_cases add column if not exists decision_source text;      -- email | manual | portal | none
alter table if exists public.visa_cases add column if not exists check_note text;
alter table if exists public.visa_cases add column if not exists manual_note text;
