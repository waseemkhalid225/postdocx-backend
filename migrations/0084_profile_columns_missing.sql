-- ForiForeign — 0084 · BLUNDER FIX: the profile extractor wrote columns that did not exist (methods, languages, target_countries,
-- current_salary, summary), so PostgREST rejected the whole update and NOTHING from the CV reached the profile. These columns now exist.
alter table if exists public.profiles add column if not exists methods text;
alter table if exists public.profiles add column if not exists languages jsonb;
alter table if exists public.profiles add column if not exists target_countries jsonb;
alter table if exists public.profiles add column if not exists current_salary text;
alter table if exists public.profiles add column if not exists summary text;
alter table if exists public.profiles add column if not exists highest_degree text;
alter table if exists public.profiles add column if not exists lane_pref text;
alter table if exists public.profiles add column if not exists origin_country text;
alter table if exists public.profiles add column if not exists arrival_date date;
alter table if exists public.profiles add column if not exists links jsonb;
