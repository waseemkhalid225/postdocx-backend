-- ForiForeign — 0072 · the applicant's chosen lane (study | work) drives navigation, search and recommendations.
alter table if exists public.profiles add column if not exists lane_pref text;
