-- ForiForeign — 0024: referrals, institution intelligence, dormant hygiene, brighter growth
-- Fully idempotent; safe to paste into the production Supabase SQL Editor as-is.
alter table public.universities add column if not exists official_email text;
alter table public.universities add column if not exists info jsonb;
alter table public.universities add column if not exists info_updated_at timestamptz;
alter table public.profiles add column if not exists referral_code text;
alter table public.profiles add column if not exists referred_by uuid;
alter table public.profiles add column if not exists referral_balance_pkr integer not null default 0;
create unique index if not exists idx_profiles_referral_code on public.profiles (referral_code) where referral_code is not null;
alter table public.payments add column if not exists discount_pkr integer not null default 0;
