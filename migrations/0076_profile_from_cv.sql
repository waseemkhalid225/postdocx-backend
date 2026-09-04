-- ForiForeign — 0076 · Thirty more profile facts read from the CV and documents (never the CV's email address).
alter table if exists public.profiles add column if not exists highest_degree_year text;
alter table if exists public.profiles add column if not exists skills jsonb;
alter table if exists public.profiles add column if not exists certifications jsonb;
alter table if exists public.profiles add column if not exists language_tests jsonb;
alter table if exists public.profiles add column if not exists awards jsonb;
alter table if exists public.profiles add column if not exists memberships jsonb;
alter table if exists public.profiles add column if not exists projects jsonb;
alter table if exists public.profiles add column if not exists volunteering jsonb;
alter table if exists public.profiles add column if not exists gender text;
alter table if exists public.profiles add column if not exists marital_status text;
alter table if exists public.profiles add column if not exists current_employer text;
alter table if exists public.profiles add column if not exists notice_period text;
alter table if exists public.profiles add column if not exists driving_licence text;
-- Applicant "plus" packages: after an offer, one payment covers the whole rest of the journey.
alter table if exists public.user_addons add column if not exists bundle text;
