-- ForiForeign — 0034 · Phase 1: Document Intelligence + Global Mobility Profile. Additive, idempotent.

-- Every uploaded document is read, classified, dated and cross-checked.
alter table if exists public.documents add column if not exists doc_type text;          -- passport, cnic, degree, transcript, cv, experience_letter, salary_slip, bank_statement, tax, language_test, offer_letter, admission_letter, sop, lor, police_certificate, insurance, visa, contract, other
alter table if exists public.documents add column if not exists extracted jsonb not null default '{}'::jsonb;
alter table if exists public.documents add column if not exists expiry_date date;
alter table if exists public.documents add column if not exists issue_date date;
alter table if exists public.documents add column if not exists doc_status text not null default 'uploaded';  -- uploaded, reading, read, needs_review, expired, failed
alter table if exists public.documents add column if not exists issues jsonb not null default '[]'::jsonb;
alter table if exists public.documents add column if not exists confidence numeric;
alter table if exists public.documents add column if not exists read_at timestamptz;
alter table if exists public.documents add column if not exists client_id uuid;
alter table if exists public.documents add column if not exists org_id uuid;
alter table if exists public.documents add column if not exists sensitive boolean not null default false;
create index if not exists idx_documents_user_type on public.documents (user_id, doc_type);
create index if not exists idx_documents_status on public.documents (doc_status);

-- The Global Mobility Profile: entered once, reused everywhere, every field with a source.
alter table if exists public.profiles add column if not exists mobility jsonb not null default '{}'::jsonb;
alter table if exists public.profiles add column if not exists mobility_provenance jsonb not null default '{}'::jsonb;
alter table if exists public.profiles add column if not exists mobility_updated_at timestamptz;
alter table if exists public.profiles add column if not exists consent_vault_sensitive boolean not null default false;
