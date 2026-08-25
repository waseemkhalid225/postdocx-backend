-- ForiForeign v0.7 — 0014: RBAC + payment gateway support.
-- Additive and idempotent. Run once after 0013.

-- Payment gateway: provider transaction id for idempotency + reconciliation.
-- (The manual bank-transfer flow does not use this; it is for future automated gateways.)
alter table if exists public.payments
  add column if not exists provider_txn text;
create index if not exists idx_payments_provider_txn on public.payments (provider_txn);

-- RBAC uses the existing profiles.role text column; no schema change needed.
-- Valid roles (enforced in code, not DB): super_admin, admin, content_admin,
-- support_admin, finance_admin, operations_admin, opportunity_admin, ai_admin,
-- security_admin, staff, user.
-- To make yourself a super admin explicitly (optional; 'admin' already has full access):
--   update public.profiles set role = 'super_admin' where id = '<your-user-id>';
