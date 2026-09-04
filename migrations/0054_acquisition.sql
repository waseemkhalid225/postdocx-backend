-- ForiForeign — 0054 · Acquisition engine: professions from ESCO, regulated-profession registry, institution and job
-- acquisition from authoritative registries and open job APIs, with verification state on every entity.
create table if not exists public.professions (
  id uuid primary key default gen_random_uuid(),
  esco_uri text unique, isco text, title text not null, alt_labels text[] not null default '{}', description text,
  regulated_in text[] not null default '{}', skills text[] not null default '{}', source text not null default 'esco', updated_at timestamptz not null default now()
);
create index if not exists idx_professions_isco on public.professions(isco);
create index if not exists idx_professions_title on public.professions using gin (to_tsvector('simple', title));
alter table if exists public.institutions add column if not exists registry text;
alter table if exists public.institutions add column if not exists registry_id text;
alter table if exists public.institutions add column if not exists city text;
alter table if exists public.institutions add column if not exists sector text;          -- public | private | for_profit
alter table if exists public.institutions add column if not exists verified_at timestamptz;
alter table if exists public.institutions add column if not exists domain_ok boolean;
alter table if exists public.institutions add column if not exists careers_feed text;    -- greenhouse:token | lever:slug | workable:slug | rss:url
alter table if exists public.institutions add column if not exists last_checked_at timestamptz;
alter table if exists public.institutions add column if not exists industry text;
create index if not exists idx_institutions_registry on public.institutions(registry, registry_id);
alter table if exists public.sources add column if not exists params jsonb not null default '{}'::jsonb;
alter table if exists public.sources drop constraint if exists sources_kind_check;
alter table if exists public.sources add constraint sources_kind_check check (kind in ('greenhouse','lever','workable','rss','json','arbeitnow','adzuna','jooble','reed','usajobs','esco','eu_regprof','college_scorecard','registry_csv','ats_discover'));
alter table if exists public.opportunities add column if not exists employer_verified boolean;
alter table if exists public.opportunities add column if not exists institution_id uuid;
