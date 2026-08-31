
-- ===== 0007_commercial_redesign.sql =====
-- ForiForeign v0.7 — additive, idempotent migration.
-- Safe to run once in the Supabase SQL editor. Re-running is a no-op.
-- Nothing here drops or renames anything; existing rows keep working.

-- 1) Normalized funding bucket for the Study Abroad funding filter
--    Values: 'fully' | 'partial' | 'self'  (NULL = unknown, still shown)
alter table if exists public.opportunities
  add column if not exists funding_type text;

-- Backfill funding_type from existing free-text funding, best-effort.
-- Order matters: partial and self run first so 'fully' does not swallow them.
update public.opportunities set funding_type = 'partial'
  where funding_type is null
    and (
      funding ilike '%partial%'
      or funding ilike '%partially%'
      or funding ilike '%tuition waiver%'
    );

update public.opportunities set funding_type = 'self'
  where funding_type is null
    and (
      funding ilike '%self%'
      or funding ilike '%self-finance%'
      or funding ilike '%no funding%'
      or funding ilike '%tuition fee%'
    );

update public.opportunities set funding_type = 'fully'
  where funding_type is null
    and (
      funding ilike '%fully%'
      or funding ilike '%full scholarship%'
      or funding ilike '%salaried%'
      or funding ilike '%funded%'
      or (stipend is not null and stipend <> '')
    );

-- 2) Academic level for the BS -> Postdoc filter inside Study Abroad
--    Values: 'bachelors' | 'masters' | 'phd' | 'postdoc'  (NULL = unknown)
alter table if exists public.opportunities
  add column if not exists level text;

-- Best-effort backfill from title/kind
update public.opportunities set level = 'postdoc'
  where level is null and (kind = 'postdoc' or title ilike '%postdoc%' or title ilike '%post-doc%');

update public.opportunities set level = 'phd'
  where level is null and (title ilike '%phd%' or title ilike '%doctoral%' or title ilike '%doctorate%');

update public.opportunities set level = 'masters'
  where level is null and (title ilike '%master%' or title ilike '% ms %' or title ilike '%msc%' or title ilike '%mphil%');

update public.opportunities set level = 'bachelors'
  where level is null and (title ilike '%bachelor%' or title ilike '% bs %' or title ilike '%undergrad%');

-- 3) Helpful indexes for instant filtering (no-op if they exist)
create index if not exists idx_opps_kind_status on public.opportunities (kind, status);
create index if not exists idx_opps_funding_type on public.opportunities (funding_type);
create index if not exists idx_opps_level on public.opportunities (level);

-- ===== 0008_profile_fields.sql =====
-- ForiForeign Phase 2 — per-field provenance + cross-document verification.
-- Additive and idempotent. Run once in the Supabase SQL editor.
--
-- Stores each extracted profile fact as its own row, with the source document
-- and a status, so the UI can show "verified across N documents" or flag conflicts.
-- The existing profiles table is untouched and stays the canonical structured store;
-- profile_fields is the evidence/provenance layer on top of it.

create table if not exists public.profile_fields (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  field_key    text not null,               -- e.g. 'cgpa', 'headline', 'degree_msc'
  field_group  text not null default 'general', -- personal | education | experience | research | language | identity | general
  value        text,                         -- normalized string value
  status       text not null default 'extracted', -- extracted | verified | conflicting | provided | inferred
  sources      jsonb not null default '[]'::jsonb, -- [{document_id, name, value}]
  confidence   text default 'medium',        -- low | medium | high
  resolved     boolean not null default false, -- user has confirmed/resolved this field
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- one logical field per user (values/sources merged in code)
create unique index if not exists uq_profile_fields_user_key
  on public.profile_fields (user_id, field_key);

create index if not exists idx_profile_fields_user   on public.profile_fields (user_id);
create index if not exists idx_profile_fields_status on public.profile_fields (user_id, status);

-- keep updated_at fresh
create or replace function public.touch_profile_fields()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_profile_fields on public.profile_fields;
create trigger trg_touch_profile_fields
  before update on public.profile_fields
  for each row execute function public.touch_profile_fields();

-- ===== 0009_eligibility_criteria.sql =====
-- ForiForeign Phase 3 — structured eligibility criteria on opportunities.
-- Additive, idempotent. Run once in the Supabase SQL editor.
--
-- These columns are filled by the discovery agent ONLY from facts literally stated
-- on the official page. Anything not stated stays NULL and renders as "not specified"
-- in the match view — it is never treated as a satisfied requirement.

alter table if exists public.opportunities
  add column if not exists req_degree_level text,   -- bachelors | masters | phd | any
  add column if not exists req_field        text,   -- free text field/major requirement
  add column if not exists req_min_cgpa     numeric, -- e.g. 3.0  (on a 4.0 scale where known)
  add column if not exists req_cgpa_scale   numeric, -- e.g. 4.0  (scale the min is expressed on)
  add column if not exists req_language     text,   -- e.g. IELTS | TOEFL | none
  add column if not exists req_language_min numeric, -- e.g. 6.5
  add column if not exists req_nationality  text,   -- restriction if any, else NULL
  add column if not exists req_experience_years numeric, -- for work roles
  add column if not exists req_license      text,   -- e.g. DHA | SCFHS | NCLEX | PEBC (work)
  add column if not exists req_documents    jsonb default '[]'::jsonb; -- ["CV","transcript",...]

create index if not exists idx_opps_req_level on public.opportunities (req_degree_level);

-- ===== 0010_free_case_and_pricing.sql =====
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

-- ===== 0011_avatar_and_submission.sql =====
-- ForiForeign v0.7 — 0011: profile avatar + browser-agent-ready submission tracking.
-- Additive and idempotent. Run once after 0010.

-- 1) Profile photograph (stored in the private userdocs bucket; served via signed URL)
alter table if exists public.profiles
  add column if not exists avatar_key text;

-- 2) Future browser-agent submission workflow (item 13): the agent will later fill
--    official portals. These columns let it record its work without a rebuild.
alter table if exists public.applications
  add column if not exists submission_method text,          -- email | portal | agent
  add column if not exists portal_url text,                 -- official application portal
  add column if not exists submission_status text,          -- pending | in_progress | submitted | confirmed | failed
  add column if not exists submission_log jsonb default '[]'::jsonb, -- [{at, step, note}]
  add column if not exists submission_confirmation text;    -- reference number / receipt

-- ===== 0012_admin_controls.sql =====
-- ForiForeign v0.7 — 0012: admin control for countries + packages.
-- Additive and idempotent. Run once after 0011.

-- Country visibility controls (public list respects `enabled`)
alter table if exists public.countries
  add column if not exists enabled boolean not null default true,
  add column if not exists featured boolean not null default false,
  add column if not exists description text,
  add column if not exists flag_url text;

-- Existing rows should stay visible by default
update public.countries set enabled = true where enabled is null;

-- ===== 0013_support_tickets.sql =====
-- ForiForeign v0.7 — 0013: support tickets (Phase 7).
-- Additive and idempotent. Run once after 0012.

create table if not exists public.support_tickets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  email         text,
  subject       text not null,
  message       text not null,
  reply         text,
  internal_note text,
  status        text not null default 'new',  -- new | open | waiting | resolved | closed
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_support_status on public.support_tickets (status);
create index if not exists idx_support_user on public.support_tickets (user_id);

-- ===== 0014_rbac_and_gateways.sql =====
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

-- ===== 0015_opportunity_intelligence.sql =====
-- ForiForeign — 0015: opportunity intelligence upgrade.
-- Additive and idempotent. Run once after 0014.

-- Dedup fingerprint + stated financials (never invented; NULL = not stated on source)
alter table if exists public.opportunities
  add column if not exists fingerprint text,
  add column if not exists tuition text,
  add column if not exists application_fee text;
create index if not exists idx_opps_fingerprint on public.opportunities (fingerprint);
create index if not exists idx_opps_verified_at on public.opportunities (verified_at desc);

-- Configurable university database (admin-editable, guides discovery)
create table if not exists public.universities (
  id          uuid primary key default gen_random_uuid(),
  country_code text not null,
  name        text not null,
  priority    int  not null default 100,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (country_code, name)
);
create index if not exists idx_universities_cc on public.universities (country_code, enabled);

-- Per-user opportunity history (viewed / saved). Applied is tracked via applications.
create table if not exists public.user_opportunity_history (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  opportunity_id uuid not null,
  event          text not null,            -- viewed | saved | unsaved
  created_at     timestamptz not null default now()
);
create index if not exists idx_uoh_user on public.user_opportunity_history (user_id, event);
create index if not exists idx_apps_user_opp on public.applications (user_id, opportunity_id);

-- ===== 0016_case_editor.sql =====
-- ForiForeign — 0016: case editor (spec 27). Run once after 0015. Additive/idempotent.
alter table if exists public.application_documents
  add column if not exists status text not null default 'draft';   -- draft | under_review | approved
alter table if exists public.applications
  add column if not exists notes text;

-- ===== 0017_seed_54_countries.sql =====
-- ForiForeign — 0017: seed the full destination-country list (54). Idempotent: existing rows untouched.
alter table if exists public.countries add column if not exists enabled boolean default true;
insert into public.countries (code, name, enabled) values
('AU','Australia',true),('AT','Austria',true),('AZ','Azerbaijan',true),('BH','Bahrain',true),
('BE','Belgium',true),('BN','Brunei',true),('BG','Bulgaria',true),('CA','Canada',true),
('CN','China',true),('HR','Croatia',true),('CY','Cyprus',true),('CZ','Czechia',true),
('DK','Denmark',true),('EE','Estonia',true),('FI','Finland',true),('FR','France',true),
('GE','Georgia',true),('DE','Germany',true),('GR','Greece',true),('HK','Hong Kong',true),
('HU','Hungary',true),('IE','Ireland',true),('IT','Italy',true),('JP','Japan',true),
('KZ','Kazakhstan',true),('KW','Kuwait',true),('LV','Latvia',true),('LT','Lithuania',true),
('LU','Luxembourg',true),('MY','Malaysia',true),('MT','Malta',true),('NL','Netherlands',true),
('NZ','New Zealand',true),('NO','Norway',true),('OM','Oman',true),('PL','Poland',true),
('PT','Portugal',true),('QA','Qatar',true),('RO','Romania',true),('SA','Saudi Arabia',true),
('SG','Singapore',true),('SK','Slovakia',true),('SI','Slovenia',true),('KR','South Korea',true),
('ES','Spain',true),('SE','Sweden',true),('CH','Switzerland',true),('TW','Taiwan',true),
('TH','Thailand',true),('TR','Turkiye',true),('AE','United Arab Emirates',true),
('GB','United Kingdom',true),('US','United States',true),('UZ','Uzbekistan',true)
on conflict (code) do nothing;
update public.countries set enabled = true where enabled is null;

-- ===== 0018_recipient_discovery.sql =====
-- ForiForeign — 0018: RecipientDiscoveryService columns (spec #12/#13).
-- Additive and idempotent. Run once after 0017.
-- Stores the verified recipient for each opportunity: who to contact, their role,
-- how confident we are, and the official source the email was seen on.
-- All nullable; the engine degrades gracefully if this migration has not been run.

alter table if exists public.opportunities
  add column if not exists contact_name text,
  add column if not exists recipient_type text,
  add column if not exists recipient_role text,
  add column if not exists recipient_confidence text,
  add column if not exists recipient_source text;

-- Helpful when reviewing which opportunities still lack a verified recipient.
create index if not exists idx_opps_recipient_conf on public.opportunities (recipient_confidence);

-- ===== 0019_job_filters.sql =====
-- ForiForeign — 0019: job-mode filter columns (spec #9).
-- Additive and idempotent. Backs real filters: remote, visa sponsorship, job type,
-- experience level and salary note for work opportunities.

alter table if exists public.opportunities
  add column if not exists remote boolean,
  add column if not exists visa_sponsorship boolean,
  add column if not exists job_type text,          -- full_time | part_time | contract | internship
  add column if not exists experience_level text,  -- entry | mid | senior
  add column if not exists salary_note text;       -- salary/stipend exactly as stated, or empty

create index if not exists idx_opps_remote on public.opportunities (remote);
create index if not exists idx_opps_visa on public.opportunities (visa_sponsorship);
create index if not exists idx_opps_jobtype on public.opportunities (job_type);

-- ===== 0020_full_disclosure.sql =====
-- ForiForeign — 0020: full-disclosure fields for the applicant detail table.
-- Additive and idempotent. Everything stored EXACTLY as stated on official pages,
-- or left empty — never estimated, never invented.

alter table if exists public.opportunities
  add column if not exists fee_structure text,            -- semester/annual fee breakdown as stated
  add column if not exists bank_statement_note text,      -- proof-of-funds amount as stated
  add column if not exists post_admission_reqs jsonb default '[]'::jsonb; -- requirements after admission, literally listed

-- ===== 0021_prep_progress.sql =====
-- ForiForeign — 0021: genuine preparation progress for the waiting experience.
-- The engine writes each completed step here; the UI shows only real progress.
alter table if exists public.applications
  add column if not exists prep_progress jsonb default '[]'::jsonb,
  add column if not exists prep_started_at timestamptz;

-- ===== 0022_ops_hardening.sql =====
-- ForiForeign — 0022: operations hardening (error monitoring + background jobs)
create table if not exists public.error_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz default now(),
  request_id text, area text, user_id uuid, message text, detail text
);
create index if not exists idx_error_log_at on public.error_log (at desc);
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null, idem_key text unique, user_id uuid,
  status text default 'running',           -- running | done | failed
  attempts int default 0, last_error text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists idx_jobs_status on public.jobs (status, kind);
alter table if exists public.opportunities add column if not exists verification_confidence text;

-- ============================================================
-- ForiForeign — 0023: trust & visibility pack + ops safety net
-- Fully idempotent: safe to paste into the production Supabase SQL Editor as-is.

-- 1) Safety net: core tables the new code leans on harder.
--    (Exist in production since the early era; created here for completeness / fresh installs.)
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  delta integer not null,
  reason text,
  application_id uuid,
  payment_id uuid,
  note text,
  created_at timestamptz not null default now()
);

create or replace function public.credit_balance(uid uuid)
returns integer
language sql
stable
as $$
  select coalesce(sum(delta), 0)::integer from public.credit_ledger where user_id = uid;
$$;

-- 2) Performance indexes for the new hot paths:
--    /api/stats + freshness counts (status + created_at)
create index if not exists idx_opps_status_created on public.opportunities (status, created_at desc);
--    country-scoped fulfillment counting and SEO pages (status + country)
create index if not exists idx_opps_status_country on public.opportunities (status, country_code);
--    per-user entitlement + package meter
create index if not exists idx_credit_ledger_user on public.credit_ledger (user_id);
create index if not exists idx_applications_user on public.applications (user_id);
--    started-opportunity annotation
create index if not exists idx_applications_user_opp on public.applications (user_id, opportunity_id);

-- 3) app_settings hygiene: the table now also stores per-user keys
--    (lastRun:<uid>, discover:<uid>, prefs:<uid>). Keep updated_at fresh on upsert.
create or replace function public.touch_app_settings()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists trg_touch_app_settings on public.app_settings;
create trigger trg_touch_app_settings before update on public.app_settings
for each row execute function public.touch_app_settings();

-- 4) Optional monthly cleanup helper for stale per-user keys (call manually or via cron):
--    select public.cleanup_app_settings();
create or replace function public.cleanup_app_settings()
returns integer language sql as $$
  with del as (
    delete from public.app_settings
    where (key like 'lastRun:%' or key like 'discover:%')
      and updated_at < now() - interval '30 days'
    returning 1
  ) select count(*)::integer from del;
$$;

-- ============================================================
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

-- ============================================================
-- 0030: the live plan ladder (Basic / Smart / Premium)
-- ============================================================
-- ForiForeign — 0030: the live plan ladder.
--
-- WHY THIS EXISTS. The active pricing row still held the original ladder seeded by 0010
-- (1 case / Rs 2,000, 5 / Rs 8,500, 10 / Rs 17,500) with no plan name, no matches-shown
-- count and no promo price. Because /api/pricing lets the stored packs win over the
-- default tier config, a fresh deploy kept showing that old ladder on the buy page no
-- matter what the code said, and the new Basic / Smart / Premium plans never appeared.
--
-- The ladder below is the one the product actually sells:
--   Basic    2 cases, 5 matches to choose from   Rs  5,000
--   Smart    5 cases, 8 matches to choose from   Rs 15,000  (promo Rs 9,500, featured)
--   Premium 10 cases, 20 matches to choose from  Rs 30,000  (promo Rs 15,000)
--
-- Idempotent: it only writes when the active row is not already this ladder, so running
-- the bundle twice changes nothing. Prices remain fully editable in the admin panel
-- afterwards; this only fixes the starting point.

update public.pricing set active = false
where active = true
  and not (packs @> '[{"credits":2,"pkr":5000}]'::jsonb);

insert into public.pricing (version, active, packs, refund_policy)
select
  (coalesce((select max(version::int) from public.pricing where version ~ '^[0-9]+$'), 0) + 1)::text,
  true,
  '[
    {"credits":2,"view":5,"pkr":5000,"promo_pkr":null,"name":"Basic","featured":false,"visible":true,
     "description":"Five carefully matched opportunities. Choose any two and we prepare both applications completely."},
    {"credits":5,"view":8,"pkr":15000,"promo_pkr":9500,"name":"Smart","featured":true,"visible":true,
     "description":"Eight matched opportunities. Choose any five and we prepare every application for you."},
    {"credits":10,"view":20,"pkr":30000,"promo_pkr":15000,"name":"Premium","featured":false,"visible":true,
     "description":"Twenty high-relevance opportunities with complete applications for any ten, plus six months of re-searching."}
  ]'::jsonb,
  'Unused case credits are refundable within 14 days. Credits already spent on delivered work are not refundable, because the work has been done and you keep every document.'
where not exists (
  select 1 from public.pricing
  where active = true
    and packs @> '[{"credits":2,"pkr":5000}]'::jsonb
);
