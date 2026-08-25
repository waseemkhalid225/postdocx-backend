-- ForiForeign Phase 3 — structured eligibility criteria on opportunities.
-- Additive, idempotent. Run once in the Supabase SQL editor.
--
-- These columns are filled by the discovery agent ONLY from facts literally stated
-- on the official page. Anything not stated stays NULL and renders as "not specified"
-- in the match view — it is never treated as a satisfied requirement.

alter table if exists public.opportunities
  add column if not exists req_degree_level text,   -- bachelors | masters | phd | any
  add column if not exists req_field        text,   -- free text field/major requirement
  add column if not exists req_min_cgpa     numeric, -- e.g. 3.0  (on a 4.0 scale where known)
  add column if not exists req_cgpa_scale   numeric, -- e.g. 4.0  (scale the min is expressed on)
  add column if not exists req_language     text,   -- e.g. IELTS | TOEFL | none
  add column if not exists req_language_min numeric, -- e.g. 6.5
  add column if not exists req_nationality  text,   -- restriction if any, else NULL
  add column if not exists req_experience_years numeric, -- for work roles
  add column if not exists req_license      text,   -- e.g. DHA | SCFHS | NCLEX | PEBC (work)
  add column if not exists req_documents    jsonb default '[]'::jsonb; -- ["CV","transcript",...]

create index if not exists idx_opps_req_level on public.opportunities (req_degree_level);
