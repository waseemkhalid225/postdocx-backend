-- ForiForeign — 0019: job-mode filter columns (spec #9).
-- Additive and idempotent. Backs real filters: remote, visa sponsorship, job type,
-- experience level and salary note for work opportunities.

alter table if exists public.opportunities
  add column if not exists remote boolean,
  add column if not exists visa_sponsorship boolean,
  add column if not exists job_type text,          -- full_time | part_time | contract | internship
  add column if not exists experience_level text,  -- entry | mid | senior
  add column if not exists salary_note text;       -- salary/stipend exactly as stated, or empty

create index if not exists idx_opps_remote on public.opportunities (remote);
create index if not exists idx_opps_visa on public.opportunities (visa_sponsorship);
create index if not exists idx_opps_jobtype on public.opportunities (job_type);
