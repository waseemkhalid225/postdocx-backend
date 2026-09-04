-- ForiForeign — 0071 · Trust-based partner terms (no interest, no penalties), MOU terms stored on the document, institution kinds widened.
alter table if exists public.official_documents add column if not exists terms jsonb;
alter table if exists public.official_documents add column if not exists country_code text;
alter table if exists public.official_documents add column if not exists share_pct numeric;
alter table if exists public.institutions drop constraint if exists institutions_kind_check;
alter table if exists public.institutions add constraint institutions_kind_check check (kind in ('university','college','language_school','research_institute','employer','care_provider','hospital','recruiter','funder','other'));
alter table if exists public.partner_invoices drop column if exists interest_usd;
