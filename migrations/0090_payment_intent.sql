-- ForiForeign — 0090 · Phase 7 · DISC-003 · A payment remembers what the person was trying to open, and settles into it.
alter table if exists public.payments add column if not exists intent jsonb;          -- {opportunity_id, addon}
alter table if exists public.payments add column if not exists case_id uuid;          -- the application opened by this payment
alter table if exists public.payments add column if not exists settled_source text;   -- webhook | return | safepay | lemon | paddle | admin
alter table if exists public.payments add column if not exists abandoned_at timestamptz;
create index if not exists idx_payments_user_status on public.payments(user_id, status);
