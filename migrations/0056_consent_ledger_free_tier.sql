-- ForiForeign — 0056 · consent ledger (retrievable, producible), free-tier economics, stage offers.
create table if not exists public.consent_ledger (
  id bigserial primary key,
  user_id uuid not null,
  kind text not null,                 -- terms | privacy | mailbox | portal_watch | share_with_partner | package_purchase | addon_purchase | refund_policy | agency_plan | mou_countersign | data_export | account_deletion | consultant_acting
  version text not null,              -- legal text version (Settings → legal.versions) or product version
  text_hash text not null,            -- SHA-256 of the exact wording shown
  wording text not null,              -- the exact wording shown, kept verbatim
  evidence jsonb not null default '{}'::jsonb,   -- ids: payment, org, connection, application, amount, provider
  ip text, user_agent text, locale text,
  recorded_at timestamptz not null default now()
);
create index if not exists idx_consent_user on public.consent_ledger(user_id, recorded_at desc);
alter table if exists public.profiles add column if not exists free_searches_used integer not null default 0;
