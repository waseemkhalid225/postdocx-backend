-- ForiForeign — 0069 · Partner system: reputation, priority tier, office contacts, negotiation, onboarding, referrals, receivables, disputes.
alter table if exists public.institutions add column if not exists partner_tier text;            -- mou | pilot | null
alter table if exists public.institutions add column if not exists partner_since date;
alter table if exists public.institutions add column if not exists partner_terms jsonb;          -- {fee_pct, fixed_usd, currency, payment_days, valid_until, document_id}
alter table if exists public.institutions add column if not exists reputation numeric;           -- 0-100 per country
alter table if exists public.institutions add column if not exists reputation_meta jsonb;        -- {works, cited, rank, verified}
alter table if exists public.institutions add column if not exists office jsonb;                 -- {email, name, title, url, confidence, found_at}
create index if not exists idx_inst_partner on public.institutions(country_code, partner_tier, reputation desc);
alter table if exists public.opportunities add column if not exists partner_tier text;
create table if not exists public.partner_referrals (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid, institution_name text, country_code text,
  application_id uuid, user_id uuid, org_id uuid,              -- org_id = consultancy channel (null = direct)
  stage text not null default 'sent',                           -- sent | reply | offer | accepted | enrolled | withdrawn | rejected
  tuition_usd numeric, share_usd numeric, share_basis text,     -- pct:15 | fixed:500
  invoice_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_ref_inst on public.partner_referrals(institution_id, stage);
create table if not exists public.partner_invoices (
  id uuid primary key default gen_random_uuid(), ref text unique,
  institution_id uuid, institution_name text, period text, amount_usd numeric not null default 0, lines jsonb,
  status text not null default 'pending',                       -- pending | sent | reminded | paid | disputed | written_off
  due_on date, sent_at timestamptz, paid_at timestamptz, paid_ref text, reminders integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.partner_disputes (
  id uuid primary key default gen_random_uuid(), ref text unique,
  institution_id uuid, invoice_id uuid, referral_id uuid, raised_by text, reason text, evidence jsonb,
  status text not null default 'open',                          -- open | evidence_sent | resolved | escalated
  resolution text, opened_at timestamptz not null default now(), resolved_at timestamptz
);
create table if not exists public.partner_liaison_log (
  id bigserial primary key, institution_id uuid, kind text, detail text, created_at timestamptz not null default now()
);
alter table if exists public.prospects add column if not exists negotiation jsonb;               -- {rounds:[], terms:{}, state}
alter table if exists public.prospects add column if not exists institution_id uuid;
