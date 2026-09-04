-- ForiForeign — 0032: credit_ledger.reason must accept every reason the platform writes.
-- The original CHECK constraint predates admin activation, promos and referrals; those
-- credits were rejected at the database and nobody was told. Idempotent.
alter table if exists public.credit_ledger drop constraint if exists credit_ledger_reason_check;
alter table if exists public.credit_ledger add constraint credit_ledger_reason_check
  check (reason is null or reason in (
    'purchase','consume','refund','grant','founder_restore','admin_bypass','admin_allowance',
    'promo_grant','support_grant','referral_reward','referral','bonus','adjustment','manual','test'
  ));
