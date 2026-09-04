-- ForiForeign — 0078 · FF-CRM full-solution: the consultancy's own partner universities (priority + terms), finance (bank accounts,
-- expenses, disputes, P&L by branch), lead capture (own WhatsApp number and AI key, lead email address, public API).
create table if not exists public.org_partners (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  name text not null, country_code text, domain text, kind text not null default 'university',   -- university | college | employer | other
  contact_name text, contact_email text, contact_phone text,
  terms jsonb not null default '{}'::jsonb,      -- {fee_pct, fixed, currency, payment_days, intakes}
  agreement_from date, agreement_to date, priority integer not null default 1, status text not null default 'active',
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_org_partners_org on public.org_partners(org_id, status);
create table if not exists public.org_bank_accounts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, label text, bank text, account_title text, account_no text, iban text, swift text, currency text not null default 'PKR', is_default boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.org_expenses (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, branch text, category text, amount numeric not null default 0, currency text not null default 'PKR', occurred_on date not null default current_date, note text, created_by uuid, created_at timestamptz not null default now()
);
create index if not exists idx_org_expenses_org on public.org_expenses(org_id, occurred_on);
create table if not exists public.org_disputes (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, ref text, with_kind text not null default 'client',   -- client | partner | staff
  client_id uuid, partner_id uuid, amount numeric, currency text, reason text, status text not null default 'open', resolution text, opened_at timestamptz not null default now(), resolved_at timestamptz
);
alter table if exists public.client_finance add column if not exists branch text;
alter table if exists public.client_finance add column if not exists bank_account_id uuid;
alter table if exists public.commission_ledger add column if not exists partner_id uuid;
alter table if exists public.commission_ledger add column if not exists received_on date;
alter table if exists public.commission_ledger add column if not exists branch text;
alter table if exists public.clients add column if not exists source text;          -- whatsapp | email | web | walk-in | referral | api | csv
alter table if exists public.clients add column if not exists source_detail text;
