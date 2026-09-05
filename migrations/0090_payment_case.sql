-- ForiForeign — 0090 · Phase 7 · DISC-003 · a case opened automatically after payment is marked; ledger rows link to their payment.
alter table if exists public.applications add column if not exists opened_by text;
alter table if exists public.credit_ledger add column if not exists payment_id uuid;
alter table if exists public.payments add column if not exists intent jsonb;
-- (no DB unique index on user×opportunity: legitimate re-applications after a refusal exist; duplicates are prevented in code and tested)
