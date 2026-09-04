-- ForiForeign — 0041 · Days 8-10: origin markets & language, performance indexes, security. Additive, idempotent.
alter table if exists public.profiles add column if not exists origin_country text not null default 'PK';
alter table if exists public.profiles add column if not exists locale text not null default 'en';
alter table if exists public.profiles add column if not exists deletion_requested_at timestamptz;
alter table if exists public.profiles add column if not exists mobility_enc jsonb;      -- encrypted sensitive identifiers (AES-256-GCM), see lib/crypto.js
-- Day 9 · indexes on every hot path
create index if not exists idx_opps_cc_kind_status_deadline on public.opportunities (country_code, kind, status, deadline);
create index if not exists idx_opps_level on public.opportunities (level);
create index if not exists idx_apps_user_status on public.applications (user_id, status);
create index if not exists idx_apps_opp on public.applications (opportunity_id);
create index if not exists idx_clients_org_updated on public.clients (org_id, updated_at desc);
create index if not exists idx_docs_user_status on public.documents (user_id, doc_status);
create index if not exists idx_payments_user_created on public.payments (user_id, created_at desc);
create index if not exists idx_ledger_user on public.credit_ledger (user_id);
create index if not exists idx_audit_actor_created on public.audit_log (actor, created_at desc);
-- Day 10 · per-organisation API keys (hash only; the plain key is shown once)
create table if not exists public.org_api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  prefix text not null,
  scopes text[] not null default '{read}',
  created_by uuid,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_org_api_keys_org on public.org_api_keys(org_id);
alter table public.org_api_keys enable row level security;
drop policy if exists api_keys_owner_read on public.org_api_keys;
create policy api_keys_owner_read on public.org_api_keys for select using (exists (select 1 from public.org_members m where m.org_id = org_api_keys.org_id and m.user_id = auth.uid() and m.role = 'owner'));
