-- ===== 0061_more_sources.sql =====
alter table if exists public.sources drop constraint if exists sources_kind_check;
alter table if exists public.sources add constraint sources_kind_check check (kind in ('greenhouse','lever','workable','rss','json','arbeitnow','adzuna','jooble','reed','usajobs','esco','eu_regprof','college_scorecard','registry_csv','ats_discover','remotive','jobicy','himalayas','themuse','nhs_jobs','openalex','uni_pages'));
