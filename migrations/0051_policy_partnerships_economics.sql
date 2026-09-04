-- ForiForeign — 0051 · policy watch with impact, partnership outreach + official documents registry with digital
-- signature, case-closure cleanup, economics. USD-only pricing (PKR paths retired from the interface).
alter table if exists public.rule_sources add column if not exists last_text text;
create table if not exists public.policy_updates (
  id uuid primary key default gen_random_uuid(),
  country_code text not null, source_url text not null, source_title text,
  summary text not null, impact text, affected_lanes text[] not null default '{}',
  severity text not null default 'info' check (severity in ('info','review','urgent')),
  detected_at timestamptz not null default now(), reviewed_by uuid, reviewed_at timestamptz, status text not null default 'new' check (status in ('new','reviewed','dismissed'))
);
create index if not exists idx_policy_updates_cc on public.policy_updates(country_code, detected_at desc);
create table if not exists public.official_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('partnership_proposal','mou','agency_agreement','service_partner_agreement','consent','other')),
  title text not null,
  counterparty_org_id uuid, counterparty_name text, counterparty_email text, counterparty_focal text,
  our_focal text, body_text text not null, variant text,
  storage_key text, sha256 text,
  status text not null default 'draft' check (status in ('draft','approved','signed','sent','countersigned','archived','void')),
  approved_by uuid, approved_at timestamptz, signed_by uuid, signed_at timestamptz, signature text, sent_at timestamptz, countersigned_at timestamptz,
  valid_from date, valid_until date, notes text,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_official_docs_status on public.official_documents(status, created_at desc);
alter table if exists public.visa_cases add column if not exists fee_amount numeric;
alter table if exists public.visa_cases add column if not exists fee_currency text;
alter table if exists public.visa_cases add column if not exists fee_paid_on date;
alter table if exists public.offers add column if not exists tuition_fee numeric;
alter table if exists public.offers add column if not exists tuition_currency text;
alter table if exists public.applications add column if not exists closed_at timestamptz;
alter table if exists public.applications add column if not exists purged_at timestamptz;
