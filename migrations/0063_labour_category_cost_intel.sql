-- ===== 0063_labour_category_cost_intel.sql =====
alter table if exists public.opportunities add column if not exists category text;   -- labour | care | skilled | academic
create index if not exists idx_opps_category on public.opportunities(category, country_code);
alter table if exists public.applications add column if not exists success_estimate jsonb;
