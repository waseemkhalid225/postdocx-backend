-- ForiForeign — 0031: payment screenshots + credit ledger hardening.
-- Additive and idempotent. Run once after 0030.

-- Customers now send a screenshot of their transfer instead of typing a reference.
alter table if exists public.payments add column if not exists proof_path text;
alter table if exists public.payments add column if not exists proof_uploaded_at timestamptz;
alter table if exists public.payments add column if not exists rejected_reason text;
alter table if exists public.payments add column if not exists confirmed_by uuid;
alter table if exists public.payments add column if not exists confirmed_at timestamptz;
alter table if exists public.payments add column if not exists discount_pkr integer not null default 0;
create index if not exists idx_payments_user_status on public.payments (user_id, status);

-- The ledger predates 0023 on live databases, so "create table if not exists" never
-- added these columns; a confirmed payment's ledger row then failed on payment_id and
-- the customer received nothing. Every column the server writes is guaranteed here.
alter table if exists public.credit_ledger add column if not exists reason text;
alter table if exists public.credit_ledger add column if not exists application_id uuid;
alter table if exists public.credit_ledger add column if not exists payment_id uuid;
alter table if exists public.credit_ledger add column if not exists note text;
alter table if exists public.credit_ledger add column if not exists created_at timestamptz not null default now();

create or replace function public.credit_balance(uid uuid)
returns integer
language sql
stable
as $$
  select coalesce(sum(delta), 0)::integer from public.credit_ledger where user_id = uid;
$$;
