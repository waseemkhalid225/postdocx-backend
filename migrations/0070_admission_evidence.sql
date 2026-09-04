-- ForiForeign — 0070 · Admission and fee evidence: the portal is where enrolment is proven; the share follows the proof.
create table if not exists public.admission_records (
  id uuid primary key default gen_random_uuid(),
  application_id uuid, user_id uuid, referral_id uuid, institution_id uuid, org_id uuid,
  admission_number text, programme text, intake text, tuition_usd numeric, deposit_usd numeric, deposit_on date, currency text,
  evidence_doc_id uuid, evidence_kind text,            -- admission_letter | fee_receipt | institution_confirmation | applicant_statement
  confirmed_by text,                                    -- applicant | institution | consultancy | reader
  confidence numeric, created_at timestamptz not null default now()
);
create index if not exists idx_adm_app on public.admission_records(application_id);
alter table if exists public.partner_referrals add column if not exists admission_number text;
alter table if exists public.partner_referrals add column if not exists evidence jsonb;
alter table if exists public.partner_invoices add column if not exists interest_usd numeric not null default 0;
alter table if exists public.partner_invoices add column if not exists pdf_path text;
alter table if exists public.institutions add column if not exists renewal_notified_at timestamptz;
alter table if exists public.institutions add column if not exists partner_kind text;   -- university | college | language_school | research_institute | employer | care_provider | hospital | licensed_recruiter
