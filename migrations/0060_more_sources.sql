-- ForiForeign — 0060 · more keyless job sources, OpenAlex enrichment, university page probe, legal versions, reranker cache.
alter table if exists public.sources drop constraint if exists sources_kind_check;
alter table if exists public.sources add constraint sources_kind_check check (kind in ('greenhouse','lever','workable','rss','json','arbeitnow','adzuna','jooble','reed','usajobs','esco','eu_regprof','college_scorecard','registry_csv','ats_discover','remotive','jobicy','himalayas','themuse','nhs_jobs','openalex','uni_pages'));
alter table if exists public.institutions add column if not exists scholarships_url text;
create table if not exists public.legal_versions (id uuid primary key default gen_random_uuid(), kind text not null, version text not null, summary text, effective_from date not null default current_date, created_by uuid, created_at timestamptz not null default now(), unique (kind, version));
alter table if exists public.visa_rules add column if not exists assist jsonb;
