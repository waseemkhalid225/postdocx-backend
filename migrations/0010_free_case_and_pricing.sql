-- ForiForeign v0.7 — 0010: free first case + duplicate-CV flagging + new pricing.
-- Additive and idempotent. Run once in the Supabase SQL editor after 0007-0009.
-- v2: pricing.version is TEXT in your schema, so the version bump casts safely.

-- 1) One free unlocked opportunity per account
alter table if exists public.profiles
  add column if not exists free_case_used boolean not null default false,
  add column if not exists free_case_used_at timestamptz;

-- 2) CV fingerprint for duplicate detection across accounts (admin flag, never auto-block)
alter table if exists public.documents
  add column if not exists content_hash text;
create index if not exists idx_documents_hash on public.documents (content_hash);

-- Admin review queue for suspected duplicate free-trial use
create table if not exists public.abuse_flags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  matched_user_id uuid,
  reason      text not null default 'duplicate_cv',
  detail      text,
  status      text not null default 'open',
  created_at  timestamptz not null default now()
);
create index if not exists idx_abuse_flags_status on public.abuse_flags (status);

-- 3) New pricing packs: 1 = PKR 2,000 · 5 = PKR 8,500 · 10 = PKR 17,500
--    version column is text: take the highest numeric-looking version, +1, store as text.
update public.pricing set active = false where active = true;
insert into public.pricing (version, active, packs, refund_policy)
select
  (coalesce((select max(version::int) from public.pricing where version ~ '^[0-9]+$'), 0) + 1)::text,
  true,
  '[{"credits":1,"pkr":2000},{"credits":5,"pkr":8500},{"credits":10,"pkr":17500}]'::jsonb,
  'Credits are consumed one per prepared application case. Unused credits do not expire.'
where not exists (
  select 1 from public.pricing
  where active = true
    and packs @> '[{"credits":1,"pkr":2000}]'::jsonb
);
