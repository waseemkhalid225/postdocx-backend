-- ForiForeign — 0020: full-disclosure fields for the applicant detail table.
-- Additive and idempotent. Everything stored EXACTLY as stated on official pages,
-- or left empty — never estimated, never invented.

alter table if exists public.opportunities
  add column if not exists fee_structure text,            -- semester/annual fee breakdown as stated
  add column if not exists bank_statement_note text,      -- proof-of-funds amount as stated
  add column if not exists post_admission_reqs jsonb default '[]'::jsonb; -- requirements after admission, literally listed
