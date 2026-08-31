-- ForiForeign — 0027: referral reward credits.
-- A proper ledger: every earned credit is its own row with an independent expiry,
-- so "5 referrals = 1 free Solo credit valid 6 months" is auditable per credit.

create table if not exists public.referral_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'referral_milestone',
  milestone integer not null,                    -- 5, 10, 15 ... which milestone earned it
  credits integer not null default 1,
  earned_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active',         -- active | used | expired | revoked
  used_at timestamptz,
  used_ref text,                                 -- application/payment reference
  created_at timestamptz not null default now()
);
create index if not exists idx_refcred_user on public.referral_credits (user_id, status);
create index if not exists idx_refcred_expiry on public.referral_credits (expires_at);
-- Idempotency: one credit per user per milestone, enforced by the database itself.
create unique index if not exists idx_refcred_user_milestone
  on public.referral_credits (user_id, milestone) where source = 'referral_milestone';

-- Referral qualification tracking on the referred user's profile.
alter table public.profiles add column if not exists referral_qualified_at timestamptz;
alter table public.profiles add column if not exists referral_status text default 'pending';
create index if not exists idx_profiles_referred_by on public.profiles (referred_by);
