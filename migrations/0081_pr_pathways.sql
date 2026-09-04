-- ForiForeign — 0081 · PR pathways: one structured, sourced row per destination; nightly policy watch re-verifies the source page.
create table if not exists public.pr_pathways (
  id uuid primary key default gen_random_uuid(), country_code text not null unique,
  pr_route text, years_to_pr numeric, years_to_citizenship numeric, language text, requirement text, absence_rule text, dependants text, dual_nationality text, notes text,
  source_url text, confidence text not null default 'verify', status text not null default 'active', last_verified_at timestamptz, changed_at timestamptz, updated_at timestamptz not null default now()
);
