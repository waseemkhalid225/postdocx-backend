-- ForiForeign v0.7 — additive, idempotent migration.
-- Safe to run once in the Supabase SQL editor. Re-running is a no-op.
-- Nothing here drops or renames anything; existing rows keep working.

-- 1) Normalized funding bucket for the Study Abroad funding filter
--    Values: 'fully' | 'partial' | 'self'  (NULL = unknown, still shown)
alter table if exists public.opportunities
  add column if not exists funding_type text;

-- Backfill funding_type from existing free-text funding, best-effort.
update public.opportunities set funding_type = 'fully'
  where funding_type is null
    and (funding ilike '%fully%' or funding ilike '%full scholarship%'
      or funding ilike '%stipend%' or stipend <> '' and stipend is not null
      or funding ilike '%salaried%' or funding ilike '%funded%' and funding not ilike '%partial%');

update public.opportunities set funding_type = 'partial'
  where funding_type is null
    and (funding ilike '%partial%' or funding ilike '%tuition waiver%'
      or funding ilike '%partially%' or funding ilike '%50%%');

update public.opportunities set funding_type = 'self'
  where funding_type is null
    and (funding ilike '%self%' or funding ilike '%self-finance%'
      or funding ilike '%no funding%' or funding ilike '%tuition fee%');

-- 2) Academic level for the BS -> Postdoc filter inside Study Abroad
--    Values: 'bachelors' | 'masters' | 'phd' | 'postdoc'  (NULL = unknown)
alter table if exists public.opportunities
  add column if not exists level text;

-- Best-effort backfill from title/kind
update public.opportunities set level = 'postdoc'
  where level is null and (kind = 'postdoc' or title ilike '%postdoc%' or title ilike '%post-doc%');
update public.opportunities set level = 'phd'
  where level is null and (title ilike '%phd%' or title ilike '%doctoral%' or title ilike '%doctorate%');
update public.opportunities set level = 'masters'
  where level is null and (title ilike '%master%' or title ilike '% ms %' or title ilike '%msc%' or title ilike '%mphil%');
update public.opportunities set level = 'bachelors'
  where level is null and (title ilike '%bachelor%' or title ilike '% bs %' or title ilike '%undergrad%');

-- 3) Helpful indexes for instant filtering (no-op if they exist)
create index if not exists idx_opps_kind_status on public.opportunities (kind, status);
create index if not exists idx_opps_funding_type on public.opportunities (funding_type);
create index if not exists idx_opps_level on public.opportunities (level);
