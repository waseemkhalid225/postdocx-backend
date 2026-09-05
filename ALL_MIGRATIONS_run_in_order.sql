-- ===== 0000_profiles_baseline.sql =====
-- ForiForeign — 0000 · PROFILES BASELINE. Runs first. Every column the code reads or writes on public.profiles is created if
-- missing (the table itself pre-exists from the original app and may lack some). email is filled from auth.users and kept in
-- sync by a trigger. Idempotent.
create table if not exists public.profiles (id uuid primary key, created_at timestamptz not null default now());
alter table public.profiles
  add column if not exists email text,
  add column if not exists full_name text,
  add column if not exists role text not null default 'user',
  add column if not exists phone text,
  add column if not exists whatsapp text,
  add column if not exists city text,
  add column if not exists address text,
  add column if not exists country_code text,
  add column if not exists nationality text,
  add column if not exists date_of_birth date,
  add column if not exists national_id text,
  add column if not exists passport_number text,
  add column if not exists headline text,
  add column if not exists field text,
  add column if not exists profession text,
  add column if not exists degree text,
  add column if not exists degree_level text,
  add column if not exists education jsonb,
  add column if not exists experience jsonb,
  add column if not exists experience_years numeric,
  add column if not exists total_experience_years numeric,
  add column if not exists cgpa text,
  add column if not exists last_institution text,
  add column if not exists publications jsonb,
  add column if not exists language_scores jsonb,
  add column if not exists licenses jsonb,
  add column if not exists license_number text,
  add column if not exists license_authority text,
  add column if not exists linkedin text,
  add column if not exists notify_whatsapp boolean not null default true,
  add column if not exists send_mode text,
  add column if not exists referral_status text,
  add column if not exists referral_qualified_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();
-- Fill email from auth.users and keep it in sync.
update public.profiles p set email = u.email from auth.users u where u.id = p.id and (p.email is null or p.email = '');
create or replace function public.ff_sync_profile_email() returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name) values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;
drop trigger if exists ff_sync_profile_email on auth.users;
create trigger ff_sync_profile_email after insert or update of email on auth.users for each row execute function public.ff_sync_profile_email();

-- ===== 0000b_base_tables_baseline.sql =====
-- ForiForeign — 0000b · BASE TABLES BASELINE. The original app created opportunities, applications, payments, documents,
-- audit_log and a few others with its own columns; every column the platform's code reads or writes on them is created here
-- if missing. applications.status and applications.stage are kept equal by a trigger (the old app used stage, the platform
-- uses status). Idempotent; runs right after the profiles baseline.
create table if not exists public.opportunities (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now());
alter table public.opportunities
  add column if not exists title text, add column if not exists institution text, add column if not exists country_code text,
  add column if not exists city text, add column if not exists kind text, add column if not exists level text, add column if not exists field text,
  add column if not exists description text, add column if not exists requirements text, add column if not exists req_degree text,
  add column if not exists funding text, add column if not exists funding_type text, add column if not exists stipend text, add column if not exists salary_note text,
  add column if not exists contract_type text, add column if not exists deadline text, add column if not exists url text, add column if not exists apply_via text,
  add column if not exists contact_emails jsonb, add column if not exists intelligence jsonb, add column if not exists status text not null default 'pending',
  add column if not exists verified_at timestamptz, add column if not exists closed boolean not null default false, add column if not exists updated_at timestamptz not null default now();
create table if not exists public.applications (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now());
alter table public.applications
  add column if not exists user_id uuid, add column if not exists opportunity_id uuid, add column if not exists case_no text,
  add column if not exists stage text, add column if not exists status text, add column if not exists prep_status text,
  add column if not exists credits_consumed integer not null default 0, add column if not exists sent_at timestamptz, add column if not exists authorized_at timestamptz,
  add column if not exists outcome text, add column if not exists outcome_at timestamptz, add column if not exists updated_at timestamptz not null default now();
update public.applications set status = coalesce(status, stage), stage = coalesce(stage, status) where status is null or stage is null;
create or replace function public.ff_sync_app_status() returns trigger language plpgsql as $$
begin
  if new.status is null then new.status := new.stage; end if;
  if new.stage is null then new.stage := new.status; end if;
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status and new.stage is not distinct from old.stage then new.stage := new.status; end if;
    if new.stage is distinct from old.stage and new.status is not distinct from old.status then new.status := new.stage; end if;
  end if;
  return new;
end $$;
drop trigger if exists ff_sync_app_status on public.applications;
create trigger ff_sync_app_status before insert or update on public.applications for each row execute function public.ff_sync_app_status();
create table if not exists public.payments (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now());
alter table public.payments
  add column if not exists user_id uuid, add column if not exists credits integer not null default 0, add column if not exists amount_pkr numeric not null default 0,
  add column if not exists amount_usd numeric, add column if not exists status text not null default 'pending', add column if not exists reference text,
  add column if not exists pricing_version text, add column if not exists confirmed_at timestamptz, add column if not exists updated_at timestamptz not null default now();
create table if not exists public.documents (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now());
alter table public.documents
  add column if not exists user_id uuid, add column if not exists application_id uuid, add column if not exists name text, add column if not exists kind text,
  add column if not exists mime text, add column if not exists size_bytes bigint, add column if not exists storage_key text, add column if not exists text text,
  add column if not exists generated boolean not null default false, add column if not exists retention_until timestamptz, add column if not exists updated_at timestamptz not null default now();
create table if not exists public.audit_log (id bigserial primary key, created_at timestamptz not null default now());
alter table public.audit_log add column if not exists actor uuid, add column if not exists event text, add column if not exists detail text, add column if not exists org_id uuid;
create table if not exists public.notifications (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now());
alter table public.notifications add column if not exists user_id uuid, add column if not exists kind text, add column if not exists title text, add column if not exists body text, add column if not exists link text, add column if not exists read_at timestamptz, add column if not exists org_id uuid;
alter table if exists public.support_tickets add column if not exists handled_by text;
alter table if exists public.offers add column if not exists deadline text;
alter table if exists public.prospects add column if not exists email text, add column if not exists document_id uuid, add column if not exists source_url text;
alter table if exists public.visa_cases add column if not exists application_id uuid, add column if not exists flags jsonb;
alter table if exists public.universities add column if not exists priority integer;

-- Timestamps the code and the indexes rely on; the original tables may lack them.
alter table if exists public.profiles add column if not exists created_at timestamptz not null default now();
alter table if exists public.opportunities add column if not exists created_at timestamptz not null default now();
alter table if exists public.applications add column if not exists created_at timestamptz not null default now();
alter table if exists public.payments add column if not exists created_at timestamptz not null default now();
alter table if exists public.documents add column if not exists created_at timestamptz not null default now();
alter table if exists public.audit_log add column if not exists created_at timestamptz not null default now();
alter table if exists public.notifications add column if not exists created_at timestamptz not null default now();
alter table if exists public.credits_ledger add column if not exists created_at timestamptz not null default now();
alter table if exists public.universities add column if not exists created_at timestamptz not null default now();
alter table if exists public.support_tickets add column if not exists created_at timestamptz not null default now();
alter table if exists public.support_tickets add column if not exists updated_at timestamptz not null default now();
alter table if exists public.credits_ledger add column if not exists user_id uuid;
alter table if exists public.credits_ledger add column if not exists delta integer not null default 0;
alter table if exists public.credits_ledger add column if not exists reason text;
alter table if exists public.credits_ledger add column if not exists note text;
alter table if exists public.universities add column if not exists updated_at timestamptz not null default now();

alter table if exists public.support_tickets add column if not exists user_id uuid;
alter table if exists public.support_tickets add column if not exists status text not null default 'open';
alter table if exists public.support_tickets add column if not exists subject text;
alter table if exists public.support_tickets add column if not exists message text;
alter table if exists public.support_tickets add column if not exists email text;
alter table if exists public.universities add column if not exists country_code text;
alter table if exists public.universities add column if not exists enabled boolean not null default true;
alter table if exists public.universities add column if not exists name text;

-- Tables the original app created that later migrations update or index (created here if a database never had them).
create table if not exists public.pricing (id bigserial primary key, version text, active boolean not null default false, packs jsonb, refund_policy text, created_at timestamptz not null default now());
create table if not exists public.countries (code text primary key, name text, enabled boolean not null default true, created_at timestamptz not null default now());
create table if not exists public.application_documents (id uuid primary key default gen_random_uuid(), application_id uuid, user_id uuid, kind text, name text, content text, storage_key text, created_at timestamptz not null default now());
create table if not exists public.credits_ledger (id bigserial primary key, user_id uuid, delta integer not null default 0, reason text, note text, created_at timestamptz not null default now());
create table if not exists public.support_tickets (id uuid primary key default gen_random_uuid(), user_id uuid, email text, subject text, message text, status text not null default 'open', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.universities (id uuid primary key default gen_random_uuid(), name text, country_code text, enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.app_settings (key text primary key, value jsonb, updated_at timestamptz not null default now());

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
alter table if exists public.profile_fields add column if not exists user_id uuid;
alter table if exists public.profile_fields add column if not exists field_key text;
alter table if exists public.profile_fields add column if not exists field_group text default 'general' not null;
alter table if exists public.profile_fields add column if not exists value text;
alter table if exists public.profile_fields add column if not exists status text default 'extracted' not null;
alter table if exists public.profile_fields add column if not exists sources jsonb default '[]'::jsonb not null;
alter table if exists public.profile_fields add column if not exists confidence text default 'medium';
alter table if exists public.profile_fields add column if not exists resolved boolean default false not null;
alter table if exists public.profile_fields add column if not exists created_at timestamptz default now() not null;
alter table if exists public.profile_fields add column if not exists updated_at timestamptz default now() not null;

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
alter table if exists public.abuse_flags add column if not exists user_id uuid;
alter table if exists public.abuse_flags add column if not exists matched_user_id uuid;
alter table if exists public.abuse_flags add column if not exists reason text default 'duplicate_cv' not null;
alter table if exists public.abuse_flags add column if not exists detail text;
alter table if exists public.abuse_flags add column if not exists status text default 'open' not null;
alter table if exists public.abuse_flags add column if not exists created_at timestamptz default now() not null;
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
alter table if exists public.support_tickets add column if not exists user_id uuid;
alter table if exists public.support_tickets add column if not exists email text;
alter table if exists public.support_tickets add column if not exists subject text;
alter table if exists public.support_tickets add column if not exists message text;
alter table if exists public.support_tickets add column if not exists reply text;
alter table if exists public.support_tickets add column if not exists internal_note text;
alter table if exists public.support_tickets add column if not exists status text default 'new' not null;
alter table if exists public.support_tickets add column if not exists created_at timestamptz default now() not null;
alter table if exists public.support_tickets add column if not exists updated_at timestamptz default now() not null;
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
alter table if exists public.universities add column if not exists country_code text;
alter table if exists public.universities add column if not exists name text;
alter table if exists public.universities add column if not exists priority int default 100 not null;
alter table if exists public.universities add column if not exists enabled boolean default true not null;
alter table if exists public.universities add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_universities_cc on public.universities (country_code, enabled);

-- Per-user opportunity history (viewed / saved). Applied is tracked via applications.
create table if not exists public.user_opportunity_history (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  opportunity_id uuid not null,
  event          text not null,            -- viewed | saved | unsaved
  created_at     timestamptz not null default now()
);
alter table if exists public.user_opportunity_history add column if not exists user_id uuid;
alter table if exists public.user_opportunity_history add column if not exists opportunity_id uuid;
alter table if exists public.user_opportunity_history add column if not exists event text;
alter table if exists public.user_opportunity_history add column if not exists created_at timestamptz default now() not null;
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
alter table if exists public.error_log add column if not exists at timestamptz default now();
alter table if exists public.error_log add column if not exists request_id text;
alter table if exists public.error_log add column if not exists area text;
alter table if exists public.error_log add column if not exists user_id uuid;
alter table if exists public.error_log add column if not exists message text;
alter table if exists public.error_log add column if not exists detail text;
create index if not exists idx_error_log_at on public.error_log (at desc);
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null, idem_key text unique, user_id uuid,
  status text default 'running',           -- running | done | failed
  attempts int default 0, last_error text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table if exists public.jobs add column if not exists kind text;
alter table if exists public.jobs add column if not exists idem_key text;
alter table if exists public.jobs add column if not exists user_id uuid;
alter table if exists public.jobs add column if not exists status text default 'running';
alter table if exists public.jobs add column if not exists attempts int default 0;
alter table if exists public.jobs add column if not exists last_error text;
alter table if exists public.jobs add column if not exists created_at timestamptz default now();
alter table if exists public.jobs add column if not exists updated_at timestamptz default now();
create index if not exists idx_jobs_status on public.jobs (status, kind);
alter table if exists public.opportunities add column if not exists verification_confidence text;

-- ===== 0023_trust_and_ops.sql =====
-- ForiForeign — 0023: trust & visibility pack + ops safety net
-- Fully idempotent: safe to paste into the production Supabase SQL Editor as-is.

-- 1) Safety net: core tables the new code leans on harder.
--    (Exist in production since the early era; created here for completeness / fresh installs.)
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table if exists public.app_settings add column if not exists value jsonb default '{}'::jsonb not null;
alter table if exists public.app_settings add column if not exists updated_at timestamptz default now() not null;

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
alter table if exists public.credit_ledger add column if not exists user_id uuid;
alter table if exists public.credit_ledger add column if not exists delta integer;
alter table if exists public.credit_ledger add column if not exists reason text;
alter table if exists public.credit_ledger add column if not exists application_id uuid;
alter table if exists public.credit_ledger add column if not exists payment_id uuid;
alter table if exists public.credit_ledger add column if not exists note text;
alter table if exists public.credit_ledger add column if not exists created_at timestamptz default now() not null;

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

-- ===== 0024_referrals_unis_intel.sql =====
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

-- ===== 0025_themed_cv.sql =====
-- 12b: store a pointer to the theme-preserved tailored CV (.docx) per application document
alter table if exists application_documents add column if not exists themed_key text;

-- ===== 0026_perf_indexes.sql =====
-- Performance: app_settings is now read on every dashboard load (prefs:, profilex:,
-- licjourney:) and scanned by prefix for the admin demand report.
create index if not exists idx_app_settings_key on public.app_settings (key);

-- Applications are counted per user on every dashboard load.
create index if not exists idx_applications_user on public.applications (user_id);
create index if not exists idx_applications_user_stage on public.applications (user_id, stage);

-- Credit ledger notes are checked for promo idempotency.
create index if not exists idx_credit_ledger_user_note on public.credit_ledger (user_id, note);

-- Documents are looked up per user for the themed-CV and vault features.
create index if not exists idx_documents_user on public.documents (user_id);
create index if not exists idx_documents_user_generated on public.documents (user_id, generated);

-- Application documents are fetched per application repeatedly.
create index if not exists idx_appdocs_app on public.application_documents (application_id);

-- ===== 0027_referral_rewards.sql =====
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
alter table if exists public.referral_credits add column if not exists user_id uuid;
alter table if exists public.referral_credits add column if not exists source text default 'referral_milestone' not null;
alter table if exists public.referral_credits add column if not exists milestone integer;
alter table if exists public.referral_credits add column if not exists credits integer default 1 not null;
alter table if exists public.referral_credits add column if not exists earned_at timestamptz default now() not null;
alter table if exists public.referral_credits add column if not exists expires_at timestamptz;
alter table if exists public.referral_credits add column if not exists status text default 'active' not null;
alter table if exists public.referral_credits add column if not exists used_at timestamptz;
alter table if exists public.referral_credits add column if not exists used_ref text;
alter table if exists public.referral_credits add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_refcred_user on public.referral_credits (user_id, status);
create index if not exists idx_refcred_expiry on public.referral_credits (expires_at);
-- Idempotency: one credit per user per milestone, enforced by the database itself.
create unique index if not exists idx_refcred_user_milestone
  on public.referral_credits (user_id, milestone) where source = 'referral_milestone';

-- Referral qualification tracking on the referred user's profile.
alter table public.profiles add column if not exists referral_qualified_at timestamptz;
alter table public.profiles add column if not exists referral_status text default 'pending';
create index if not exists idx_profiles_referred_by on public.profiles (referred_by);

-- ===== 0028_outcomes.sql =====
-- Outcome tracking: learn which applications actually succeed so ranking can improve.
alter table public.applications add column if not exists outcome text;
alter table public.applications add column if not exists outcome_at timestamptz;
alter table public.applications add column if not exists outcome_note text;
create index if not exists idx_applications_outcome on public.applications (outcome);

-- ===== 0029_role_constraint.sql =====
-- Fix: the profiles.role CHECK constraint predates the role system and rejects
-- 'super_admin', so promoting an owner account fails. Rebuild it to allow every role
-- the application actually uses, and keep it as a constraint so typos are still caught.
do $$
declare c record;
begin
  -- Drop any existing check constraint on profiles.role, whatever it is named.
  for c in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_role_check check (role in (
    'user','staff','admin','super_admin',
    'content_admin','support_admin','finance_admin','operations_admin',
    'opportunity_admin','ai_admin','security_admin'
  ));

alter table public.profiles alter column role set default 'user';
update public.profiles set role = 'user' where role is null;

-- ===== 0030_plan_ladder_basic_smart_premium.sql =====
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

-- ===== 0031_payment_screenshots.sql =====
-- ForiForeign — 0031: payment screenshots + credit ledger hardening.
-- Additive and idempotent. Run once after 0030.

-- Customers now send a screenshot of their transfer instead of typing a reference.
alter table if exists public.payments add column if not exists proof_path text;
alter table if exists public.payments add column if not exists proof_uploaded_at timestamptz;
alter table if exists public.payments add column if not exists rejected_reason text;
alter table if exists public.payments add column if not exists confirmed_by uuid;
alter table if exists public.payments add column if not exists confirmed_at timestamptz;
alter table if exists public.payments add column if not exists discount_pkr integer not null default 0;
create index if not exists idx_payments_user_status on public.payments (user_id, status);

-- The ledger predates 0023 on live databases, so "create table if not exists" never
-- added these columns; a confirmed payment's ledger row then failed on payment_id and
-- the customer received nothing. Every column the server writes is guaranteed here.
alter table if exists public.credit_ledger add column if not exists reason text;
alter table if exists public.credit_ledger add column if not exists application_id uuid;
alter table if exists public.credit_ledger add column if not exists payment_id uuid;
alter table if exists public.credit_ledger add column if not exists note text;
alter table if exists public.credit_ledger add column if not exists created_at timestamptz not null default now();

create or replace function public.credit_balance(uid uuid)
returns integer
language sql
stable
as $$
  select coalesce(sum(delta), 0)::integer from public.credit_ledger where user_id = uid;
$$;

-- ===== 0032_ledger_reason_constraint.sql =====
-- ForiForeign — 0032: credit_ledger.reason must accept every reason the platform writes.
-- The original CHECK constraint predates admin activation, promos and referrals; those
-- credits were rejected at the database and nobody was told. Idempotent.
alter table if exists public.credit_ledger drop constraint if exists credit_ledger_reason_check;
alter table if exists public.credit_ledger add constraint credit_ledger_reason_check
  check (reason is null or reason in (
    'purchase','consume','refund','grant','founder_restore','admin_bypass','admin_allowance',
    'promo_grant','support_grant','referral_reward','referral','bonus','adjustment','manual','test'
  ));

-- ===== 0032b_organisations_compat.sql =====
create table if not exists public.organisations (id uuid primary key default gen_random_uuid(), name text not null default '', kind text not null default 'personal', created_at timestamptz not null default now());
create table if not exists public.clients (id uuid primary key default gen_random_uuid(), org_id uuid, full_name text, created_at timestamptz not null default now());
-- Two generations of the organisations table used different owner column names (owner_user_id, owner_id). Both exist from
-- here on and are kept equal by a trigger, so every index, policy and code path works whichever name it uses.
alter table if exists public.organisations add column if not exists owner_user_id uuid;
alter table if exists public.organisations add column if not exists owner_id uuid;
alter table if exists public.organisations add column if not exists slug text;
alter table if exists public.organisations add column if not exists country_code text;
alter table if exists public.organisations add column if not exists plan text not null default 'free';
alter table if exists public.organisations add column if not exists settings jsonb not null default '{}'::jsonb;
alter table if exists public.organisations add column if not exists updated_at timestamptz not null default now();
update public.organisations set owner_id = coalesce(owner_id, owner_user_id), owner_user_id = coalesce(owner_user_id, owner_id) where owner_id is null or owner_user_id is null;
create or replace function public.ff_sync_org_owner() returns trigger language plpgsql as $$
begin
  if new.owner_id is null then new.owner_id := new.owner_user_id; end if;
  if new.owner_user_id is null then new.owner_user_id := new.owner_id; end if;
  if tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id and new.owner_user_id is not distinct from old.owner_user_id then new.owner_user_id := new.owner_id; end if;
    if new.owner_user_id is distinct from old.owner_user_id and new.owner_id is not distinct from old.owner_id then new.owner_id := new.owner_user_id; end if;
  end if;
  return new;
end $$;
drop trigger if exists ff_sync_org_owner on public.organisations;
create trigger ff_sync_org_owner before insert or update on public.organisations for each row execute function public.ff_sync_org_owner();


alter table if exists public.clients add column if not exists whatsapp text;
alter table if exists public.clients add column if not exists nationality text;
alter table if exists public.clients add column if not exists lane text;
alter table if exists public.clients add column if not exists origin_partner text;
alter table if exists public.clients add column if not exists status text not null default 'active';
alter table if exists public.clients add column if not exists user_id uuid;
alter table if exists public.clients add column if not exists owner_user_id uuid;
alter table if exists public.clients add column if not exists email text;
alter table if exists public.clients add column if not exists phone text;
alter table if exists public.clients add column if not exists stage text;
alter table if exists public.clients add column if not exists branch text;
alter table if exists public.clients add column if not exists notes text;

-- ===== 0033_phase0_tenancy_queue_provenance.sql =====
-- ForiForeign — 0033 · Phase 0 of the Global Mobility OS.
-- Additive and idempotent. Existing B2C behaviour is untouched: every user keeps working
-- exactly as before; a "personal" organisation is created lazily on first use.

-- 1. Organisations: the tenancy root (personal, agency, institution, employer, partner).
create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'personal' check (kind in ('personal','agency','institution','employer','partner')),
  owner_id uuid not null,
  country_code text not null default 'PK',
  slug text unique,
  settings jsonb not null default '{}'::jsonb,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);
alter table if exists public.organisations add column if not exists name text;
alter table if exists public.organisations add column if not exists kind text default 'personal' not null;
alter table if exists public.organisations add column if not exists owner_id uuid;
alter table if exists public.organisations add column if not exists country_code text default 'PK' not null;
alter table if exists public.organisations add column if not exists slug text;
alter table if exists public.organisations add column if not exists settings jsonb default '{}'::jsonb not null;
alter table if exists public.organisations add column if not exists plan text default 'free' not null;
alter table if exists public.organisations add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_orgs_owner on public.organisations(owner_id);

-- 2. Membership with an org-level role (separate from the platform role in profiles).
create table if not exists public.org_members (
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'consultant' check (role in ('owner','manager','consultant','sub_agent','viewer')),
  branch text,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
alter table if exists public.org_members add column if not exists org_id uuid;
alter table if exists public.org_members add column if not exists user_id uuid;
alter table if exists public.org_members add column if not exists role text default 'consultant' not null;
alter table if exists public.org_members add column if not exists branch text;
alter table if exists public.org_members add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_org_members_user on public.org_members(user_id);

-- 3. Clients: a person a consultant works for. May or may not have their own login yet.
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  owner_user_id uuid not null,
  user_id uuid,
  full_name text not null,
  email text,
  phone text,
  whatsapp text,
  nationality text not null default 'PK',
  lane text not null default 'both' check (lane in ('study','work','both')),
  stage text not null default 'discover' check (stage in ('lead','discover','qualify','match','decide','prepare','apply','offer','visa','travel','arrive','settle','pr','closed')),
  profile jsonb not null default '{}'::jsonb,
  identity_hash text,
  origin_partner uuid,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table if exists public.clients add column if not exists org_id uuid;
alter table if exists public.clients add column if not exists owner_user_id uuid;
alter table if exists public.clients add column if not exists user_id uuid;
alter table if exists public.clients add column if not exists full_name text;
alter table if exists public.clients add column if not exists email text;
alter table if exists public.clients add column if not exists phone text;
alter table if exists public.clients add column if not exists whatsapp text;
alter table if exists public.clients add column if not exists nationality text default 'PK' not null;
alter table if exists public.clients add column if not exists lane text default 'both' not null;
alter table if exists public.clients add column if not exists stage text default 'discover' not null;
alter table if exists public.clients add column if not exists profile jsonb default '{}'::jsonb not null;
alter table if exists public.clients add column if not exists identity_hash text;
alter table if exists public.clients add column if not exists origin_partner uuid;
alter table if exists public.clients add column if not exists status text default 'active' not null;
alter table if exists public.clients add column if not exists created_at timestamptz default now() not null;
alter table if exists public.clients add column if not exists updated_at timestamptz default now() not null;
create unique index if not exists idx_clients_identity on public.clients(org_id, identity_hash) where identity_hash is not null;
create index if not exists idx_clients_org_stage on public.clients(org_id, stage);

-- 4. Job queue: long work (discovery, preparation, OCR) leaves the request thread.
create table if not exists public.job_queue (
  id bigserial primary key,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','done','failed','dead')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  result jsonb,
  org_id uuid,
  user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table if exists public.job_queue add column if not exists kind text;
alter table if exists public.job_queue add column if not exists payload jsonb default '{}'::jsonb not null;
alter table if exists public.job_queue add column if not exists status text default 'queued' not null;
alter table if exists public.job_queue add column if not exists attempts int default 0 not null;
alter table if exists public.job_queue add column if not exists max_attempts int default 3 not null;
alter table if exists public.job_queue add column if not exists run_after timestamptz default now() not null;
alter table if exists public.job_queue add column if not exists locked_at timestamptz;
alter table if exists public.job_queue add column if not exists locked_by text;
alter table if exists public.job_queue add column if not exists last_error text;
alter table if exists public.job_queue add column if not exists result jsonb;
alter table if exists public.job_queue add column if not exists org_id uuid;
alter table if exists public.job_queue add column if not exists user_id uuid;
alter table if exists public.job_queue add column if not exists created_at timestamptz default now() not null;
alter table if exists public.job_queue add column if not exists updated_at timestamptz default now() not null;
create index if not exists idx_job_queue_ready on public.job_queue(status, run_after);

-- 5. Provenance on every opportunity fact row.
alter table if exists public.opportunities add column if not exists source_kind text;
alter table if exists public.opportunities add column if not exists confidence numeric;
alter table if exists public.opportunities add column if not exists last_verified_at timestamptz;

-- 6. Row-level security: members see their own organisation only. The server uses the
--    service role; these policies protect direct client access.
alter table public.organisations enable row level security;
alter table public.org_members enable row level security;
alter table public.clients enable row level security;
drop policy if exists org_member_read on public.organisations;
create policy org_member_read on public.organisations for select using (
  owner_id = auth.uid() or exists (select 1 from public.org_members m where m.org_id = organisations.id and m.user_id = auth.uid()));
drop policy if exists org_members_read on public.org_members;
create policy org_members_read on public.org_members for select using (user_id = auth.uid() or exists (select 1 from public.org_members m where m.org_id = org_members.org_id and m.user_id = auth.uid()));
drop policy if exists clients_member_read on public.clients;
create policy clients_member_read on public.clients for select using (
  user_id = auth.uid() or exists (select 1 from public.org_members m where m.org_id = clients.org_id and m.user_id = auth.uid()));

-- ===== 0033_tenancy_foundation.sql =====
-- ForiForeign — 0033: Phase 0 tenancy foundation (Global Mobility OS).
-- Backward-compatible: every existing user becomes the owner of a personal organisation,
-- so the B2C product keeps working unchanged while agencies, consultants, institutions,
-- employers and partners get real homes. Fully idempotent.

create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'personal'
    check (kind in ('personal','agency','institution','employer','partner','platform')),
  name text not null,
  slug text unique,
  country_code text,
  owner_user_id uuid,
  plan text not null default 'free',            -- free | agency_starter | agency_growth | enterprise
  settings jsonb not null default '{}'::jsonb,   -- white-label, branding, commission rules
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table if exists public.organisations add column if not exists kind text default 'personal' not null;
alter table if exists public.organisations add column if not exists name text;
alter table if exists public.organisations add column if not exists slug text;
alter table if exists public.organisations add column if not exists country_code text;
alter table if exists public.organisations add column if not exists owner_user_id uuid;
alter table if exists public.organisations add column if not exists plan text default 'free' not null;
alter table if exists public.organisations add column if not exists settings jsonb default '{}'::jsonb not null;
alter table if exists public.organisations add column if not exists created_at timestamptz default now() not null;
alter table if exists public.organisations add column if not exists updated_at timestamptz default now() not null;

create table if not exists public.org_members (
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'consultant'
    check (role in ('owner','branch_manager','consultant','sub_agent','referral_partner','recruiter','viewer')),
  branch text,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
alter table if exists public.org_members add column if not exists org_id uuid;
alter table if exists public.org_members add column if not exists user_id uuid;
alter table if exists public.org_members add column if not exists role text default 'consultant' not null;
alter table if exists public.org_members add column if not exists branch text;
alter table if exists public.org_members add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_org_members_user on public.org_members (user_id);

-- A client is the person an organisation is moving abroad. For a personal org the
-- client IS the user; for an agency it is the applicant the consultant created.
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid,                                  -- linked login, if the client has one
  owner_user_id uuid,                            -- consultant who owns the relationship
  origin_partner_id uuid,                        -- referral / sub-agent attribution
  full_name text,
  email text,
  phone text,
  identity_hash text,                            -- sha256(CNIC|passport) for duplicate detection
  stage text not null default 'discover'
    check (stage in ('lead','discover','qualify','match','decide','prepare','apply','secured','visa','travel','arrived','settled','pr')),
  profile jsonb not null default '{}'::jsonb,    -- Global Mobility Profile (Phase 1 fills this)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table if exists public.clients add column if not exists org_id uuid;
alter table if exists public.clients add column if not exists user_id uuid;
alter table if exists public.clients add column if not exists owner_user_id uuid;
alter table if exists public.clients add column if not exists origin_partner_id uuid;
alter table if exists public.clients add column if not exists full_name text;
alter table if exists public.clients add column if not exists email text;
alter table if exists public.clients add column if not exists phone text;
alter table if exists public.clients add column if not exists identity_hash text;
alter table if exists public.clients add column if not exists stage text default 'discover' not null;
alter table if exists public.clients add column if not exists profile jsonb default '{}'::jsonb not null;
alter table if exists public.clients add column if not exists created_at timestamptz default now() not null;
alter table if exists public.clients add column if not exists updated_at timestamptz default now() not null;
create index if not exists idx_clients_org on public.clients (org_id, stage);
create index if not exists idx_clients_identity on public.clients (identity_hash);
create index if not exists idx_clients_user on public.clients (user_id);

-- Every fact will know where it came from (Phase 0 columns, Phase 1 fills them).
alter table if exists public.opportunities add column if not exists source_class text;      -- live_api | live_feed | partner | government | permitted_web | manual | static | unverified
alter table if exists public.opportunities add column if not exists source_fetched_at timestamptz;
alter table if exists public.opportunities add column if not exists provenance jsonb not null default '{}'::jsonb;
alter table if exists public.applications  add column if not exists client_id uuid;
alter table if exists public.applications  add column if not exists org_id uuid;
alter table if exists public.payments      add column if not exists org_id uuid;

-- Backfill: one personal organisation per existing profile, owner = the user.
insert into public.organisations (kind, name, owner_user_id)
select 'personal', coalesce(nullif(p.full_name,''), 'Personal'), p.id
from public.profiles p
where not exists (select 1 from public.organisations o where o.owner_user_id = p.id and o.kind = 'personal');

insert into public.org_members (org_id, user_id, role)
select o.id, o.owner_user_id, 'owner' from public.organisations o
where o.kind = 'personal' and o.owner_user_id is not null
  and not exists (select 1 from public.org_members m where m.org_id = o.id and m.user_id = o.owner_user_id);

insert into public.clients (org_id, user_id, owner_user_id, full_name, email, stage)
select o.id, p.id, p.id, p.full_name, p.email, 'discover'
from public.organisations o join public.profiles p on p.id = o.owner_user_id
where o.kind = 'personal'
  and not exists (select 1 from public.clients c where c.org_id = o.id and c.user_id = p.id);

-- Row-level security: members see their organisation only. Service role bypasses.
alter table public.organisations enable row level security;
alter table public.org_members  enable row level security;
alter table public.clients      enable row level security;
drop policy if exists org_member_read on public.organisations;
create policy org_member_read on public.organisations for select
  using (exists (select 1 from public.org_members m where m.org_id = organisations.id and m.user_id = auth.uid()));
drop policy if exists org_members_self on public.org_members;
create policy org_members_self on public.org_members for select
  using (user_id = auth.uid() or exists (select 1 from public.org_members m where m.org_id = org_members.org_id and m.user_id = auth.uid() and m.role in ('owner','branch_manager')));
drop policy if exists clients_member_read on public.clients;
create policy clients_member_read on public.clients for select
  using (exists (select 1 from public.org_members m where m.org_id = clients.org_id and m.user_id = auth.uid()));

-- ===== 0034_phase1_document_intelligence_mobility_profile.sql =====
-- ForiForeign — 0034 · Phase 1: Document Intelligence + Global Mobility Profile. Additive, idempotent.

-- Every uploaded document is read, classified, dated and cross-checked.
alter table if exists public.documents add column if not exists doc_type text;          -- passport, cnic, degree, transcript, cv, experience_letter, salary_slip, bank_statement, tax, language_test, offer_letter, admission_letter, sop, lor, police_certificate, insurance, visa, contract, other
alter table if exists public.documents add column if not exists extracted jsonb not null default '{}'::jsonb;
alter table if exists public.documents add column if not exists expiry_date date;
alter table if exists public.documents add column if not exists issue_date date;
alter table if exists public.documents add column if not exists doc_status text not null default 'uploaded';  -- uploaded, reading, read, needs_review, expired, failed
alter table if exists public.documents add column if not exists issues jsonb not null default '[]'::jsonb;
alter table if exists public.documents add column if not exists confidence numeric;
alter table if exists public.documents add column if not exists read_at timestamptz;
alter table if exists public.documents add column if not exists client_id uuid;
alter table if exists public.documents add column if not exists org_id uuid;
alter table if exists public.documents add column if not exists sensitive boolean not null default false;
create index if not exists idx_documents_user_type on public.documents (user_id, doc_type);
create index if not exists idx_documents_status on public.documents (doc_status);

-- The Global Mobility Profile: entered once, reused everywhere, every field with a source.
alter table if exists public.profiles add column if not exists mobility jsonb not null default '{}'::jsonb;
alter table if exists public.profiles add column if not exists mobility_provenance jsonb not null default '{}'::jsonb;
alter table if exists public.profiles add column if not exists mobility_updated_at timestamptz;
alter table if exists public.profiles add column if not exists consent_vault_sensitive boolean not null default false;

-- ===== 0035_phase2_command_center.sql =====
-- ForiForeign — 0035 · Phase 2: Consultant Command Center foundations. Additive, idempotent.
create table if not exists public.client_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  assignee_user_id uuid,
  title text not null,
  owner text not null default 'us' check (owner in ('us','client','them')),   -- who must act: consultant, client, institution/embassy
  due_date date,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
alter table if exists public.client_tasks add column if not exists org_id uuid;
alter table if exists public.client_tasks add column if not exists client_id uuid;
alter table if exists public.client_tasks add column if not exists assignee_user_id uuid;
alter table if exists public.client_tasks add column if not exists title text;
alter table if exists public.client_tasks add column if not exists owner text default 'us' not null;
alter table if exists public.client_tasks add column if not exists due_date date;
alter table if exists public.client_tasks add column if not exists status text default 'open' not null;
alter table if exists public.client_tasks add column if not exists created_by uuid;
alter table if exists public.client_tasks add column if not exists created_at timestamptz default now() not null;
alter table if exists public.client_tasks add column if not exists done_at timestamptz;
create index if not exists idx_client_tasks_org on public.client_tasks(org_id, status, due_date);
create table if not exists public.client_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  author_user_id uuid,
  channel text not null default 'note' check (channel in ('note','whatsapp','email','call','meeting','system')),
  body text not null,
  created_at timestamptz not null default now()
);
alter table if exists public.client_notes add column if not exists org_id uuid;
alter table if exists public.client_notes add column if not exists client_id uuid;
alter table if exists public.client_notes add column if not exists author_user_id uuid;
alter table if exists public.client_notes add column if not exists channel text default 'note' not null;
alter table if exists public.client_notes add column if not exists body text;
alter table if exists public.client_notes add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_client_notes_client on public.client_notes(client_id, created_at desc);
-- Commissions: every package sold through an organisation earns the organisation a share.
create table if not exists public.commission_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  client_id uuid,
  payment_id uuid,
  amount_pkr integer not null,
  rate_pct numeric not null,
  status text not null default 'accrued' check (status in ('accrued','payable','paid','void')),
  note text,
  created_at timestamptz not null default now()
);
alter table if exists public.commission_ledger add column if not exists org_id uuid;
alter table if exists public.commission_ledger add column if not exists client_id uuid;
alter table if exists public.commission_ledger add column if not exists payment_id uuid;
alter table if exists public.commission_ledger add column if not exists amount_pkr integer;
alter table if exists public.commission_ledger add column if not exists rate_pct numeric;
alter table if exists public.commission_ledger add column if not exists status text default 'accrued' not null;
alter table if exists public.commission_ledger add column if not exists note text;
alter table if exists public.commission_ledger add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_commission_org on public.commission_ledger(org_id, status);
alter table if exists public.payments add column if not exists org_id uuid;
alter table if exists public.payments add column if not exists client_id uuid;
alter table public.client_tasks enable row level security;
alter table public.client_notes enable row level security;
alter table public.commission_ledger enable row level security;
drop policy if exists tasks_member_read on public.client_tasks;
create policy tasks_member_read on public.client_tasks for select using (exists (select 1 from public.org_members m where m.org_id = client_tasks.org_id and m.user_id = auth.uid()));
drop policy if exists notes_member_read on public.client_notes;
create policy notes_member_read on public.client_notes for select using (exists (select 1 from public.org_members m where m.org_id = client_notes.org_id and m.user_id = auth.uid()));
drop policy if exists commission_member_read on public.commission_ledger;
create policy commission_member_read on public.commission_ledger for select using (exists (select 1 from public.org_members m where m.org_id = commission_ledger.org_id and m.user_id = auth.uid() and m.role in ('owner','manager')));

-- ===== 0036_day2_team_branches_invites.sql =====
-- ForiForeign — 0036 · Day 2: team invites, branches, sub-agent isolation. Additive, idempotent.
alter table if exists public.clients add column if not exists branch text;
create index if not exists idx_clients_branch on public.clients(org_id, branch);
create table if not exists public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  email text not null,
  role text not null default 'consultant' check (role in ('owner','manager','consultant','sub_agent','viewer')),
  branch text,
  invited_by uuid,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_user_id uuid
);
alter table if exists public.org_invites add column if not exists org_id uuid;
alter table if exists public.org_invites add column if not exists email text;
alter table if exists public.org_invites add column if not exists role text default 'consultant' not null;
alter table if exists public.org_invites add column if not exists branch text;
alter table if exists public.org_invites add column if not exists invited_by uuid;
alter table if exists public.org_invites add column if not exists created_at timestamptz default now() not null;
alter table if exists public.org_invites add column if not exists accepted_at timestamptz;
alter table if exists public.org_invites add column if not exists accepted_user_id uuid;
create unique index if not exists idx_org_invites_pending on public.org_invites(org_id, lower(email)) where accepted_at is null;
alter table public.org_invites enable row level security;
drop policy if exists invites_member_read on public.org_invites;
create policy invites_member_read on public.org_invites for select using (exists (select 1 from public.org_members m where m.org_id = org_invites.org_id and m.user_id = auth.uid() and m.role in ('owner','manager')));

-- ===== 0037_day3_billing_offers_interviews.sql =====
-- ForiForeign — 0037 · Day 3: agency subscriptions, offers & conditions, interview preparation. Additive, idempotent.
create table if not exists public.org_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  tier_key text not null,
  tier_name text,
  usd_month numeric not null default 0,
  cases_month integer not null default 0,
  cases_used integer not null default 0,
  status text not null default 'pending' check (status in ('pending','active','past_due','cancelled','expired')),
  period_start timestamptz,
  period_end timestamptz,
  gateway_ref text,
  payment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table if exists public.org_subscriptions add column if not exists org_id uuid;
alter table if exists public.org_subscriptions add column if not exists tier_key text;
alter table if exists public.org_subscriptions add column if not exists tier_name text;
alter table if exists public.org_subscriptions add column if not exists usd_month numeric default 0 not null;
alter table if exists public.org_subscriptions add column if not exists cases_month integer default 0 not null;
alter table if exists public.org_subscriptions add column if not exists cases_used integer default 0 not null;
alter table if exists public.org_subscriptions add column if not exists status text default 'pending' not null;
alter table if exists public.org_subscriptions add column if not exists period_start timestamptz;
alter table if exists public.org_subscriptions add column if not exists period_end timestamptz;
alter table if exists public.org_subscriptions add column if not exists gateway_ref text;
alter table if exists public.org_subscriptions add column if not exists payment_id uuid;
alter table if exists public.org_subscriptions add column if not exists created_at timestamptz default now() not null;
alter table if exists public.org_subscriptions add column if not exists updated_at timestamptz default now() not null;
create index if not exists idx_org_subs_org on public.org_subscriptions(org_id, status);
alter table if exists public.payments add column if not exists kind text not null default 'package';   -- package | agency_subscription
alter table if exists public.payments add column if not exists subscription_id uuid;
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  client_id uuid,
  org_id uuid,
  application_id uuid,
  opportunity_id uuid,
  kind text not null default 'admission' check (kind in ('admission','job','scholarship','other')),
  offer_type text not null default 'conditional' check (offer_type in ('conditional','unconditional','verbal','written')),
  issuer text,
  title text,
  country_code text,
  received_on date,
  decision_deadline date,
  deposit_usd numeric,
  deposit_deadline date,
  salary_or_funding text,
  conditions jsonb not null default '[]'::jsonb,   -- [{text, met:boolean, due:date, evidence_document_id}]
  status text not null default 'received' check (status in ('received','accepted','declined','expired','withdrawn')),
  notes text,
  document_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table if exists public.offers add column if not exists user_id uuid;
alter table if exists public.offers add column if not exists client_id uuid;
alter table if exists public.offers add column if not exists org_id uuid;
alter table if exists public.offers add column if not exists application_id uuid;
alter table if exists public.offers add column if not exists opportunity_id uuid;
alter table if exists public.offers add column if not exists kind text default 'admission' not null;
alter table if exists public.offers add column if not exists offer_type text default 'conditional' not null;
alter table if exists public.offers add column if not exists issuer text;
alter table if exists public.offers add column if not exists title text;
alter table if exists public.offers add column if not exists country_code text;
alter table if exists public.offers add column if not exists received_on date;
alter table if exists public.offers add column if not exists decision_deadline date;
alter table if exists public.offers add column if not exists deposit_usd numeric;
alter table if exists public.offers add column if not exists deposit_deadline date;
alter table if exists public.offers add column if not exists salary_or_funding text;
alter table if exists public.offers add column if not exists conditions jsonb default '[]'::jsonb not null;
alter table if exists public.offers add column if not exists status text default 'received' not null;
alter table if exists public.offers add column if not exists notes text;
alter table if exists public.offers add column if not exists document_id uuid;
alter table if exists public.offers add column if not exists created_at timestamptz default now() not null;
alter table if exists public.offers add column if not exists updated_at timestamptz default now() not null;
create index if not exists idx_offers_user on public.offers(user_id, status);
create table if not exists public.interview_preps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  application_id uuid,
  opportunity_id uuid,
  offer_id uuid,
  role_title text,
  content jsonb not null default '{}'::jsonb,
  model text,
  created_at timestamptz not null default now()
);
alter table if exists public.interview_preps add column if not exists user_id uuid;
alter table if exists public.interview_preps add column if not exists application_id uuid;
alter table if exists public.interview_preps add column if not exists opportunity_id uuid;
alter table if exists public.interview_preps add column if not exists offer_id uuid;
alter table if exists public.interview_preps add column if not exists role_title text;
alter table if exists public.interview_preps add column if not exists content jsonb default '{}'::jsonb not null;
alter table if exists public.interview_preps add column if not exists model text;
alter table if exists public.interview_preps add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_interview_user on public.interview_preps(user_id, created_at desc);
alter table public.offers enable row level security;
drop policy if exists offers_owner_read on public.offers;
create policy offers_owner_read on public.offers for select using (user_id = auth.uid());
alter table public.interview_preps enable row level security;
drop policy if exists interview_owner_read on public.interview_preps;
create policy interview_owner_read on public.interview_preps for select using (user_id = auth.uid());

-- ===== 0038_day4_visa_intelligence.sql =====
-- ForiForeign — 0038 · Day 4: Visa Intelligence. Every rule carries its source, dates, version and
-- verification state. Nothing here is presented as fact until an admin verifies it. Additive, idempotent.
create table if not exists public.visa_rules (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  route_key text not null,             -- e.g. uk_student, de_national_study, ca_study_permit, au_500, uk_skilled_worker
  route_name text not null,
  lane text not null default 'both' check (lane in ('study','work','both')),
  rule_type text not null check (rule_type in ('eligibility','document','financial','language','fee','processing','work_rights','dependants','post_arrival','pr_path','note')),
  text text not null,
  value jsonb not null default '{}'::jsonb,   -- machine-readable: {doc_type}, {amount, currency, per}, {test, min}, {days}
  source_url text,
  source_title text,
  published_date date,
  effective_date date,
  last_verified_at timestamptz,
  verified_by uuid,
  version integer not null default 1,
  confidence numeric not null default 0.5,
  status text not null default 'unverified' check (status in ('unverified','verified','superseded','disputed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table if exists public.visa_rules add column if not exists country_code text;
alter table if exists public.visa_rules add column if not exists route_key text;
alter table if exists public.visa_rules add column if not exists route_name text;
alter table if exists public.visa_rules add column if not exists lane text default 'both' not null;
alter table if exists public.visa_rules add column if not exists rule_type text;
alter table if exists public.visa_rules add column if not exists text text;
alter table if exists public.visa_rules add column if not exists value jsonb default '{}'::jsonb not null;
alter table if exists public.visa_rules add column if not exists source_url text;
alter table if exists public.visa_rules add column if not exists source_title text;
alter table if exists public.visa_rules add column if not exists published_date date;
alter table if exists public.visa_rules add column if not exists effective_date date;
alter table if exists public.visa_rules add column if not exists last_verified_at timestamptz;
alter table if exists public.visa_rules add column if not exists verified_by uuid;
alter table if exists public.visa_rules add column if not exists version integer default 1 not null;
alter table if exists public.visa_rules add column if not exists confidence numeric default 0.5 not null;
alter table if exists public.visa_rules add column if not exists status text default 'unverified' not null;
alter table if exists public.visa_rules add column if not exists created_at timestamptz default now() not null;
alter table if exists public.visa_rules add column if not exists updated_at timestamptz default now() not null;
create index if not exists idx_visa_rules_route on public.visa_rules(country_code, route_key, status);
create table if not exists public.visa_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  client_id uuid,
  org_id uuid,
  offer_id uuid,
  country_code text not null,
  route_key text not null,
  status text not null default 'draft' check (status in ('draft','preparing','ready','submitted','decision_pending','granted','refused','withdrawn')),
  prefill jsonb not null default '{}'::jsonb,
  checklist jsonb not null default '{}'::jsonb,
  submitted_on date,
  decision_on date,
  refusal jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table if exists public.visa_cases add column if not exists user_id uuid;
alter table if exists public.visa_cases add column if not exists client_id uuid;
alter table if exists public.visa_cases add column if not exists org_id uuid;
alter table if exists public.visa_cases add column if not exists offer_id uuid;
alter table if exists public.visa_cases add column if not exists country_code text;
alter table if exists public.visa_cases add column if not exists route_key text;
alter table if exists public.visa_cases add column if not exists status text default 'draft' not null;
alter table if exists public.visa_cases add column if not exists prefill jsonb default '{}'::jsonb not null;
alter table if exists public.visa_cases add column if not exists checklist jsonb default '{}'::jsonb not null;
alter table if exists public.visa_cases add column if not exists submitted_on date;
alter table if exists public.visa_cases add column if not exists decision_on date;
alter table if exists public.visa_cases add column if not exists refusal jsonb;
alter table if exists public.visa_cases add column if not exists notes text;
alter table if exists public.visa_cases add column if not exists created_at timestamptz default now() not null;
alter table if exists public.visa_cases add column if not exists updated_at timestamptz default now() not null;
create index if not exists idx_visa_cases_user on public.visa_cases(user_id, status);
alter table public.visa_cases enable row level security;
drop policy if exists visa_cases_owner_read on public.visa_cases;
create policy visa_cases_owner_read on public.visa_cases for select using (user_id = auth.uid());
alter table public.visa_rules enable row level security;
drop policy if exists visa_rules_public_read on public.visa_rules;
create policy visa_rules_public_read on public.visa_rules for select using (true);

-- ===== 0039_day5_journey_after_visa.sql =====
-- ForiForeign — 0039 · Day 5: the journey after the visa (pre-departure, arrival, settlement, family, PR). Additive, idempotent.
create table if not exists public.journey_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  client_id uuid,
  country_code text not null,
  lane text not null default 'study',
  phase text not null check (phase in ('pre_departure','arrival','settlement','family','pr')),
  title text not null,
  detail text,
  due_hint text,
  partner_slot text,          -- insurance | sim | housing | pickup | bank | forex | attestation | flights
  source_url text,
  done boolean not null default false,
  done_at timestamptz,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
alter table if exists public.journey_tasks add column if not exists user_id uuid;
alter table if exists public.journey_tasks add column if not exists client_id uuid;
alter table if exists public.journey_tasks add column if not exists country_code text;
alter table if exists public.journey_tasks add column if not exists lane text default 'study' not null;
alter table if exists public.journey_tasks add column if not exists phase text;
alter table if exists public.journey_tasks add column if not exists title text;
alter table if exists public.journey_tasks add column if not exists detail text;
alter table if exists public.journey_tasks add column if not exists due_hint text;
alter table if exists public.journey_tasks add column if not exists partner_slot text;
alter table if exists public.journey_tasks add column if not exists source_url text;
alter table if exists public.journey_tasks add column if not exists done boolean default false not null;
alter table if exists public.journey_tasks add column if not exists done_at timestamptz;
alter table if exists public.journey_tasks add column if not exists sort integer default 0 not null;
alter table if exists public.journey_tasks add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_journey_user on public.journey_tasks(user_id, phase, done);
alter table public.journey_tasks enable row level security;
drop policy if exists journey_owner_read on public.journey_tasks;
create policy journey_owner_read on public.journey_tasks for select using (user_id = auth.uid());

-- ===== 0040_day7_partner_portal.sql =====
-- ForiForeign — 0040 · Day 7: institution / employer partner portal and service partners. Additive, idempotent.
create table if not exists public.partner_openings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  created_by uuid,
  kind text not null default 'study' check (kind in ('study','postdoc','phd','masters','work')),
  title text not null,
  level text,
  field text,
  country_code text not null,
  city text,
  description text,
  requirements text,
  funding_or_salary text,
  deadline date,
  url text,
  contact_email text,
  status text not null default 'draft' check (status in ('draft','live','closed')),
  opportunity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table if exists public.partner_openings add column if not exists org_id uuid;
alter table if exists public.partner_openings add column if not exists created_by uuid;
alter table if exists public.partner_openings add column if not exists kind text default 'study' not null;
alter table if exists public.partner_openings add column if not exists title text;
alter table if exists public.partner_openings add column if not exists level text;
alter table if exists public.partner_openings add column if not exists field text;
alter table if exists public.partner_openings add column if not exists country_code text;
alter table if exists public.partner_openings add column if not exists city text;
alter table if exists public.partner_openings add column if not exists description text;
alter table if exists public.partner_openings add column if not exists requirements text;
alter table if exists public.partner_openings add column if not exists funding_or_salary text;
alter table if exists public.partner_openings add column if not exists deadline date;
alter table if exists public.partner_openings add column if not exists url text;
alter table if exists public.partner_openings add column if not exists contact_email text;
alter table if exists public.partner_openings add column if not exists status text default 'draft' not null;
alter table if exists public.partner_openings add column if not exists opportunity_id uuid;
alter table if exists public.partner_openings add column if not exists created_at timestamptz default now() not null;
alter table if exists public.partner_openings add column if not exists updated_at timestamptz default now() not null;
create index if not exists idx_partner_openings_org on public.partner_openings(org_id, status);
create table if not exists public.application_shares (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  user_id uuid not null,
  org_id uuid not null references public.organisations(id) on delete cascade,
  opening_id uuid,
  consent boolean not null default false,
  shared_at timestamptz,
  partner_status text not null default 'received' check (partner_status in ('received','reviewing','shortlisted','interview','offer','rejected')),
  partner_note text,
  created_at timestamptz not null default now(),
  unique (application_id, org_id)
);
alter table if exists public.application_shares add column if not exists application_id uuid;
alter table if exists public.application_shares add column if not exists user_id uuid;
alter table if exists public.application_shares add column if not exists org_id uuid;
alter table if exists public.application_shares add column if not exists opening_id uuid;
alter table if exists public.application_shares add column if not exists consent boolean default false not null;
alter table if exists public.application_shares add column if not exists shared_at timestamptz;
alter table if exists public.application_shares add column if not exists partner_status text default 'received' not null;
alter table if exists public.application_shares add column if not exists partner_note text;
alter table if exists public.application_shares add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_app_shares_org on public.application_shares(org_id, partner_status);
create table if not exists public.service_partners (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  slot text not null check (slot in ('insurance','sim','housing','pickup','bank','forex','attestation','flights','finance','visa_desk','translation','other')),
  name text not null,
  url text,
  whatsapp text,
  countries text[] not null default '{}',
  description text,
  status text not null default 'live' check (status in ('draft','live','paused')),
  created_at timestamptz not null default now()
);
alter table if exists public.service_partners add column if not exists org_id uuid;
alter table if exists public.service_partners add column if not exists slot text;
alter table if exists public.service_partners add column if not exists name text;
alter table if exists public.service_partners add column if not exists url text;
alter table if exists public.service_partners add column if not exists whatsapp text;
alter table if exists public.service_partners add column if not exists countries text default '{}' not null;
alter table if exists public.service_partners add column if not exists description text;
alter table if exists public.service_partners add column if not exists status text default 'live' not null;
alter table if exists public.service_partners add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_service_partners_slot on public.service_partners(slot, status);
alter table if exists public.opportunities add column if not exists partner_org_id uuid;
alter table if exists public.opportunities add column if not exists is_partner boolean not null default false;
alter table public.partner_openings enable row level security;
drop policy if exists openings_member_read on public.partner_openings;
create policy openings_member_read on public.partner_openings for select using (exists (select 1 from public.org_members m where m.org_id = partner_openings.org_id and m.user_id = auth.uid()));
alter table public.application_shares enable row level security;
drop policy if exists shares_read on public.application_shares;
create policy shares_read on public.application_shares for select using (user_id = auth.uid() or exists (select 1 from public.org_members m where m.org_id = application_shares.org_id and m.user_id = auth.uid()));
alter table public.service_partners enable row level security;
drop policy if exists service_partners_public on public.service_partners;
create policy service_partners_public on public.service_partners for select using (status = 'live');

-- ===== 0041_day8_10_global_perf_security.sql =====
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
alter table if exists public.org_api_keys add column if not exists org_id uuid;
alter table if exists public.org_api_keys add column if not exists name text;
alter table if exists public.org_api_keys add column if not exists key_hash text;
alter table if exists public.org_api_keys add column if not exists prefix text;
alter table if exists public.org_api_keys add column if not exists scopes text default '{read}' not null;
alter table if exists public.org_api_keys add column if not exists created_by uuid;
alter table if exists public.org_api_keys add column if not exists last_used_at timestamptz;
alter table if exists public.org_api_keys add column if not exists revoked_at timestamptz;
alter table if exists public.org_api_keys add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_org_api_keys_org on public.org_api_keys(org_id);
alter table public.org_api_keys enable row level security;
drop policy if exists api_keys_owner_read on public.org_api_keys;
create policy api_keys_owner_read on public.org_api_keys for select using (exists (select 1 from public.org_members m where m.org_id = org_api_keys.org_id and m.user_id = auth.uid() and m.role = 'owner'));

-- ===== 0042_day11_13_whitelabel_webhooks.sql =====
-- ForiForeign — 0042 · Days 11-13: white-label domains, webhooks, deliveries. Additive, idempotent.
create table if not exists public.org_domains (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  domain text not null unique,
  verify_token text not null,
  verified boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
alter table if exists public.org_domains add column if not exists org_id uuid;
alter table if exists public.org_domains add column if not exists domain text;
alter table if exists public.org_domains add column if not exists verify_token text;
alter table if exists public.org_domains add column if not exists verified boolean default false not null;
alter table if exists public.org_domains add column if not exists verified_at timestamptz;
alter table if exists public.org_domains add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_org_domains_org on public.org_domains(org_id);
create table if not exists public.org_webhooks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  url text not null,
  secret text not null,
  events text[] not null default '{*}',
  status text not null default 'active' check (status in ('active','paused')),
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table if exists public.org_webhooks add column if not exists org_id uuid;
alter table if exists public.org_webhooks add column if not exists url text;
alter table if exists public.org_webhooks add column if not exists secret text;
alter table if exists public.org_webhooks add column if not exists events text default '{*}' not null;
alter table if exists public.org_webhooks add column if not exists status text default 'active' not null;
alter table if exists public.org_webhooks add column if not exists created_by uuid;
alter table if exists public.org_webhooks add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_org_webhooks_org on public.org_webhooks(org_id, status);
create table if not exists public.webhook_deliveries (
  id bigserial primary key,
  webhook_id uuid not null references public.org_webhooks(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','delivered','failed')),
  attempts integer not null default 0,
  response_code integer,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
alter table if exists public.webhook_deliveries add column if not exists webhook_id uuid;
alter table if exists public.webhook_deliveries add column if not exists event text;
alter table if exists public.webhook_deliveries add column if not exists payload jsonb;
alter table if exists public.webhook_deliveries add column if not exists status text default 'pending' not null;
alter table if exists public.webhook_deliveries add column if not exists attempts integer default 0 not null;
alter table if exists public.webhook_deliveries add column if not exists response_code integer;
alter table if exists public.webhook_deliveries add column if not exists last_error text;
alter table if exists public.webhook_deliveries add column if not exists created_at timestamptz default now() not null;
alter table if exists public.webhook_deliveries add column if not exists delivered_at timestamptz;
create index if not exists idx_webhook_deliveries_hook on public.webhook_deliveries(webhook_id, created_at desc);
alter table public.org_domains enable row level security;
drop policy if exists org_domains_owner on public.org_domains;
create policy org_domains_owner on public.org_domains for select using (exists (select 1 from public.org_members m where m.org_id = org_domains.org_id and m.user_id = auth.uid() and m.role = 'owner'));
alter table public.org_webhooks enable row level security;
drop policy if exists org_webhooks_owner on public.org_webhooks;
create policy org_webhooks_owner on public.org_webhooks for select using (exists (select 1 from public.org_members m where m.org_id = org_webhooks.org_id and m.user_id = auth.uid() and m.role = 'owner'));

-- ===== 0043_days16_20.sql =====
-- ForiForeign — 0043 · Days 16-20: notifications, sponsor register, dependants, PR tracker, Lemon Squeezy. Additive, idempotent.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  org_id uuid,
  kind text not null,                 -- task_due, offer_deadline, payment_approved, applicant_status, visa_rule_verified, journey_reminder, system
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table if exists public.notifications add column if not exists user_id uuid;
alter table if exists public.notifications add column if not exists org_id uuid;
alter table if exists public.notifications add column if not exists kind text;
alter table if exists public.notifications add column if not exists title text;
alter table if exists public.notifications add column if not exists body text;
alter table if exists public.notifications add column if not exists link text;
alter table if exists public.notifications add column if not exists read_at timestamptz;
alter table if exists public.notifications add column if not exists emailed_at timestamptz;
alter table if exists public.notifications add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_notifications_user on public.notifications(user_id, read_at, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists notifications_owner on public.notifications;
create policy notifications_owner on public.notifications for select using (user_id = auth.uid());
create table if not exists public.sponsor_register (
  id bigserial primary key,
  country_code text not null,
  org_name text not null,
  org_norm text not null,
  town text,
  route text,
  rating text,
  source_url text,
  imported_at timestamptz not null default now()
);
alter table if exists public.sponsor_register add column if not exists country_code text;
alter table if exists public.sponsor_register add column if not exists org_name text;
alter table if exists public.sponsor_register add column if not exists org_norm text;
alter table if exists public.sponsor_register add column if not exists town text;
alter table if exists public.sponsor_register add column if not exists route text;
alter table if exists public.sponsor_register add column if not exists rating text;
alter table if exists public.sponsor_register add column if not exists source_url text;
alter table if exists public.sponsor_register add column if not exists imported_at timestamptz default now() not null;
create index if not exists idx_sponsor_norm on public.sponsor_register(country_code, org_norm);
alter table if exists public.opportunities add column if not exists sponsor_verified boolean;
alter table if exists public.opportunities add column if not exists sponsor_checked_at timestamptz;
alter table if exists public.profiles add column if not exists arrival_date date;
alter table if exists public.profiles add column if not exists dependants jsonb not null default '[]'::jsonb;
alter table if exists public.payments add column if not exists provider text;

-- ===== 0044_days21_25.sql =====
-- ForiForeign — 0044 · Days 21-25: email preference, partner pilots. Additive, idempotent.
alter table if exists public.profiles add column if not exists notify_email boolean not null default true;
alter table if exists public.organisations add column if not exists pilot boolean not null default false;
alter table if exists public.organisations add column if not exists pilot_started_at timestamptz;
alter table if exists public.organisations add column if not exists pilot_notes text;

-- ===== 0045_case_inbox_brain.sql =====
-- ForiForeign — 0045 · Case Inbox + Case Brain: the platform stays in the loop after the applicant presses Send,
-- lawfully: the applicant forwards or pastes replies; ForiForeign reads, understands, prepares, and the applicant acts.
alter table if exists public.applications add column if not exists intake_alias text unique;
alter table if exists public.applications add column if not exists last_inbound_at timestamptz;
alter table if exists public.applications add column if not exists next_action text;
alter table if exists public.applications add column if not exists next_action_owner text;    -- you | us | them
alter table if exists public.applications add column if not exists next_action_due date;
alter table if exists public.applications add column if not exists brain jsonb not null default '{}'::jsonb;   -- latest understanding: state, risks, predicted next event
create table if not exists public.case_messages (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  user_id uuid not null,
  direction text not null default 'in' check (direction in ('in','out')),
  channel text not null default 'email' check (channel in ('email','whatsapp','portal','manual')),
  from_addr text,
  subject text,
  body text,
  classification text,        -- interview_invite | offer | conditional_offer | rejection | documents_requested | info_request | acknowledgement | scheduling | other
  extracted jsonb not null default '{}'::jsonb,
  suggested_reply text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table if exists public.case_messages add column if not exists application_id uuid;
alter table if exists public.case_messages add column if not exists user_id uuid;
alter table if exists public.case_messages add column if not exists direction text default 'in' not null;
alter table if exists public.case_messages add column if not exists channel text default 'email' not null;
alter table if exists public.case_messages add column if not exists from_addr text;
alter table if exists public.case_messages add column if not exists subject text;
alter table if exists public.case_messages add column if not exists body text;
alter table if exists public.case_messages add column if not exists classification text;
alter table if exists public.case_messages add column if not exists extracted jsonb default '{}'::jsonb not null;
alter table if exists public.case_messages add column if not exists suggested_reply text;
alter table if exists public.case_messages add column if not exists received_at timestamptz default now() not null;
alter table if exists public.case_messages add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_case_messages_app on public.case_messages(application_id, received_at desc);
alter table public.case_messages enable row level security;
drop policy if exists case_messages_owner on public.case_messages;
create policy case_messages_owner on public.case_messages for select using (user_id = auth.uid());

-- ===== 0046_apply_mailbox.sql =====
-- ForiForeign — 0046 · The ForiForeign application mailbox: name@apply.foriforeign.com per user, on our own
-- domain, operated by the platform as a service the user consents to and can pause, export or close.
alter table if exists public.profiles add column if not exists apply_email text unique;
alter table if exists public.profiles add column if not exists apply_email_forward boolean not null default true;   -- copy every inbound to the personal email
alter table if exists public.profiles add column if not exists apply_email_paused boolean not null default false;   -- user pauses platform reading; mail still stored, not read by the brain
alter table if exists public.profiles add column if not exists apply_email_consent_at timestamptz;
alter table if exists public.case_messages alter column application_id drop not null;
alter table if exists public.case_messages add column if not exists assigned_by text;   -- alias | sender_match | latest_case | unassigned
create index if not exists idx_case_messages_user on public.case_messages(user_id, received_at desc);

-- ===== 0047_forimail_backbone.sql =====
-- ForiForeign — 0047 · forimail.com becomes the backbone: every user gets a unique address at first login,
-- the portal has a full inbox, every message is triaged (not only case-linked ones).
alter table if exists public.case_messages add column if not exists read_at timestamptz;
alter table if exists public.case_messages add column if not exists triage text;         -- application | verification_code | institution_general | newsletter | spam | personal | other
alter table if exists public.case_messages add column if not exists otp_code text;
alter table if exists public.case_messages add column if not exists to_addr text;
alter table if exists public.case_messages add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table if exists public.profiles alter column apply_email_forward set default false;
create index if not exists idx_case_messages_unread on public.case_messages(user_id, read_at) where read_at is null;

-- ===== 0048_rules_types_org_admin.sql =====
-- ForiForeign — 0048 · rule types for attestation/licence/shortage; organisation-scoped audit; cleanup.
alter table if exists public.visa_rules drop constraint if exists visa_rules_rule_type_check;
alter table if exists public.visa_rules add constraint visa_rules_rule_type_check check (rule_type in ('eligibility','document','financial','language','fee','processing','work_rights','dependants','post_arrival','pr_path','note','attestation','licence','shortage'));
alter table if exists public.audit_log add column if not exists org_id uuid;
create index if not exists idx_audit_org on public.audit_log(org_id, created_at desc);

-- ===== 0049_browser_agent_finance_history.sql =====
-- ForiForeign — 0049 · Browser Agent (consented portal connections + always-on status watch), client finance,
-- unified case history, lead capture, WhatsApp outbound queue, appointments. Additive, idempotent.
create table if not exists public.portal_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  client_id uuid, org_id uuid,
  portal_key text not null,            -- e.g. uk_vfs, ca_ircc, au_immi, de_videx, university:<domain>
  portal_name text not null,
  login_url text not null,
  status_url text,
  username text,
  secret_enc text,                     -- AES-256-GCM (lib/crypto) - never plain
  consent boolean not null default false,
  consent_at timestamptz,
  scope text not null default 'watch' check (scope in ('watch','watch_and_upload','watch_upload_submit')),
  watch_every_minutes integer not null default 720,
  status text not null default 'connected' check (status in ('connected','paused','error','disconnected')),
  last_run_at timestamptz, last_status_text text, last_status_hash text, last_error text,
  created_at timestamptz not null default now()
);
alter table if exists public.portal_connections add column if not exists user_id uuid;
alter table if exists public.portal_connections add column if not exists client_id uuid;
alter table if exists public.portal_connections add column if not exists org_id uuid;
alter table if exists public.portal_connections add column if not exists portal_key text;
alter table if exists public.portal_connections add column if not exists portal_name text;
alter table if exists public.portal_connections add column if not exists login_url text;
alter table if exists public.portal_connections add column if not exists status_url text;
alter table if exists public.portal_connections add column if not exists username text;
alter table if exists public.portal_connections add column if not exists secret_enc text;
alter table if exists public.portal_connections add column if not exists consent boolean default false not null;
alter table if exists public.portal_connections add column if not exists consent_at timestamptz;
alter table if exists public.portal_connections add column if not exists scope text default 'watch' not null;
alter table if exists public.portal_connections add column if not exists watch_every_minutes integer default 720 not null;
alter table if exists public.portal_connections add column if not exists status text default 'connected' not null;
alter table if exists public.portal_connections add column if not exists last_run_at timestamptz;
alter table if exists public.portal_connections add column if not exists last_status_text text;
alter table if exists public.portal_connections add column if not exists last_status_hash text;
alter table if exists public.portal_connections add column if not exists last_error text;
alter table if exists public.portal_connections add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_portal_conn_user on public.portal_connections(user_id, status);
create table if not exists public.portal_runs (
  id bigserial primary key,
  connection_id uuid not null references public.portal_connections(id) on delete cascade,
  user_id uuid not null,
  started_at timestamptz not null default now(), finished_at timestamptz,
  outcome text not null default 'pending' check (outcome in ('pending','ok','changed','login_failed','blocked','error')),
  status_text text, extracted jsonb not null default '{}'::jsonb, screenshot_key text, error text
);
alter table if exists public.portal_runs add column if not exists connection_id uuid;
alter table if exists public.portal_runs add column if not exists user_id uuid;
alter table if exists public.portal_runs add column if not exists started_at timestamptz default now() not null;
alter table if exists public.portal_runs add column if not exists finished_at timestamptz;
alter table if exists public.portal_runs add column if not exists outcome text default 'pending' not null;
alter table if exists public.portal_runs add column if not exists status_text text;
alter table if exists public.portal_runs add column if not exists extracted jsonb default '{}'::jsonb not null;
alter table if exists public.portal_runs add column if not exists screenshot_key text;
alter table if exists public.portal_runs add column if not exists error text;
create index if not exists idx_portal_runs_conn on public.portal_runs(connection_id, started_at desc);
create table if not exists public.browser_policies (
  id uuid primary key default gen_random_uuid(),
  scope_kind text not null check (scope_kind in ('platform','org','user')),
  scope_id uuid,
  allowed_domains text[] not null default '{}',
  max_scope text not null default 'watch' check (max_scope in ('watch','watch_and_upload','watch_upload_submit')),
  enabled boolean not null default true,
  updated_by uuid, updated_at timestamptz not null default now()
);
alter table if exists public.browser_policies add column if not exists scope_kind text;
alter table if exists public.browser_policies add column if not exists scope_id uuid;
alter table if exists public.browser_policies add column if not exists allowed_domains text default '{}' not null;
alter table if exists public.browser_policies add column if not exists max_scope text default 'watch' not null;
alter table if exists public.browser_policies add column if not exists enabled boolean default true not null;
alter table if exists public.browser_policies add column if not exists updated_by uuid;
alter table if exists public.browser_policies add column if not exists updated_at timestamptz default now() not null;
create table if not exists public.client_finance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('fee_charged','payment_received','refund','cost','commission_in','commission_out','adjustment')),
  amount numeric not null, currency text not null default 'USD',
  note text, reference text, occurred_on date not null default current_date,
  created_by uuid, created_at timestamptz not null default now()
);
alter table if exists public.client_finance add column if not exists org_id uuid;
alter table if exists public.client_finance add column if not exists client_id uuid;
alter table if exists public.client_finance add column if not exists kind text;
alter table if exists public.client_finance add column if not exists amount numeric;
alter table if exists public.client_finance add column if not exists currency text default 'USD' not null;
alter table if exists public.client_finance add column if not exists note text;
alter table if exists public.client_finance add column if not exists reference text;
alter table if exists public.client_finance add column if not exists occurred_on date default current_date not null;
alter table if exists public.client_finance add column if not exists created_by uuid;
alter table if exists public.client_finance add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_client_finance_client on public.client_finance(client_id, occurred_on desc);
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  source text not null default 'form' check (source in ('form','meta','whatsapp','website','referral','import','other')),
  full_name text, email text, phone text, whatsapp text, country_interest text, lane text, message text,
  assigned_user_id uuid, status text not null default 'new' check (status in ('new','contacted','qualified','converted','lost')),
  client_id uuid, raw jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
alter table if exists public.leads add column if not exists org_id uuid;
alter table if exists public.leads add column if not exists source text default 'form' not null;
alter table if exists public.leads add column if not exists full_name text;
alter table if exists public.leads add column if not exists email text;
alter table if exists public.leads add column if not exists phone text;
alter table if exists public.leads add column if not exists whatsapp text;
alter table if exists public.leads add column if not exists country_interest text;
alter table if exists public.leads add column if not exists lane text;
alter table if exists public.leads add column if not exists message text;
alter table if exists public.leads add column if not exists assigned_user_id uuid;
alter table if exists public.leads add column if not exists status text default 'new' not null;
alter table if exists public.leads add column if not exists client_id uuid;
alter table if exists public.leads add column if not exists raw jsonb default '{}'::jsonb not null;
alter table if exists public.leads add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_leads_org on public.leads(org_id, status, created_at desc);
alter table if exists public.organisations add column if not exists lead_token text unique;
create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid, user_id uuid, client_id uuid,
  channel text not null check (channel in ('whatsapp','email','sms')),
  to_addr text not null, body text not null, template_key text,
  status text not null default 'queued' check (status in ('queued','approved','sent','failed','cancelled')),
  requires_approval boolean not null default true, approved_by uuid, sent_at timestamptz, provider_id text, error text,
  created_by uuid, created_at timestamptz not null default now()
);
alter table if exists public.outbound_messages add column if not exists org_id uuid;
alter table if exists public.outbound_messages add column if not exists user_id uuid;
alter table if exists public.outbound_messages add column if not exists client_id uuid;
alter table if exists public.outbound_messages add column if not exists channel text;
alter table if exists public.outbound_messages add column if not exists to_addr text;
alter table if exists public.outbound_messages add column if not exists body text;
alter table if exists public.outbound_messages add column if not exists template_key text;
alter table if exists public.outbound_messages add column if not exists status text default 'queued' not null;
alter table if exists public.outbound_messages add column if not exists requires_approval boolean default true not null;
alter table if exists public.outbound_messages add column if not exists approved_by uuid;
alter table if exists public.outbound_messages add column if not exists sent_at timestamptz;
alter table if exists public.outbound_messages add column if not exists provider_id text;
alter table if exists public.outbound_messages add column if not exists error text;
alter table if exists public.outbound_messages add column if not exists created_by uuid;
alter table if exists public.outbound_messages add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_outbound_org on public.outbound_messages(org_id, status, created_at desc);
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid, user_id uuid, client_id uuid,
  kind text not null default 'call' check (kind in ('call','meeting','interview','biometrics','embassy','other')),
  title text not null, starts_at timestamptz not null, ends_at timestamptz, location text, link text, notes text,
  created_by uuid, created_at timestamptz not null default now()
);
alter table if exists public.appointments add column if not exists org_id uuid;
alter table if exists public.appointments add column if not exists user_id uuid;
alter table if exists public.appointments add column if not exists client_id uuid;
alter table if exists public.appointments add column if not exists kind text default 'call' not null;
alter table if exists public.appointments add column if not exists title text;
alter table if exists public.appointments add column if not exists starts_at timestamptz;
alter table if exists public.appointments add column if not exists ends_at timestamptz;
alter table if exists public.appointments add column if not exists location text;
alter table if exists public.appointments add column if not exists link text;
alter table if exists public.appointments add column if not exists notes text;
alter table if exists public.appointments add column if not exists created_by uuid;
alter table if exists public.appointments add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_appointments_user on public.appointments(user_id, starts_at);
alter table if exists public.profiles add column if not exists protected_admin boolean not null default false;
alter table public.portal_connections enable row level security; drop policy if exists pc_owner on public.portal_connections; create policy pc_owner on public.portal_connections for select using (user_id = auth.uid());
alter table public.client_finance enable row level security; drop policy if exists cf_org on public.client_finance; create policy cf_org on public.client_finance for select using (exists (select 1 from public.org_members m where m.org_id = client_finance.org_id and m.user_id = auth.uid() and m.role in ('owner','manager')));
alter table public.leads enable row level security; drop policy if exists leads_org on public.leads; create policy leads_org on public.leads for select using (exists (select 1 from public.org_members m where m.org_id = leads.org_id and m.user_id = auth.uid()));

-- ===== 0050_fix_all.sql =====
-- ForiForeign — 0050 · the 20-gap fix pass: attachments, journey engine, consent confirmation, licences, refunds,
-- session revocation, change detection, metering, retention, sources, work-permit tracks.
alter table if exists public.case_messages add column if not exists confidence numeric;
alter table if exists public.case_messages add column if not exists needs_confirmation boolean not null default false;
alter table if exists public.profiles add column if not exists next_action jsonb;              -- the ONE next action (journey engine)
alter table if exists public.profiles add column if not exists journey_stage text;
alter table if exists public.profiles add column if not exists role_changed_at timestamptz;      -- tokens issued before this are rejected
alter table if exists public.portal_connections add column if not exists applicant_confirmed boolean not null default false;
alter table if exists public.portal_connections add column if not exists confirm_token text;
alter table if exists public.portal_connections add column if not exists connected_by uuid;
create table if not exists public.consultant_licences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null,
  body text not null,                 -- OISC, MARA, RCIC (CICC), IAA (NZ), Bar/Law Society, Other
  jurisdiction text not null,         -- GB, AU, CA, NZ, ...
  number text not null,
  expires_on date,
  evidence_document_id uuid,
  status text not null default 'declared' check (status in ('declared','verified','expired','rejected')),
  verified_by uuid, verified_at timestamptz,
  created_at timestamptz not null default now()
);
alter table if exists public.consultant_licences add column if not exists org_id uuid;
alter table if exists public.consultant_licences add column if not exists user_id uuid;
alter table if exists public.consultant_licences add column if not exists body text;
alter table if exists public.consultant_licences add column if not exists jurisdiction text;
alter table if exists public.consultant_licences add column if not exists number text;
alter table if exists public.consultant_licences add column if not exists expires_on date;
alter table if exists public.consultant_licences add column if not exists evidence_document_id uuid;
alter table if exists public.consultant_licences add column if not exists status text default 'declared' not null;
alter table if exists public.consultant_licences add column if not exists verified_by uuid;
alter table if exists public.consultant_licences add column if not exists verified_at timestamptz;
alter table if exists public.consultant_licences add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_licences_user on public.consultant_licences(user_id, status);
create table if not exists public.usage_meter (
  id bigserial primary key,
  user_id uuid not null, org_id uuid,
  capability text not null,           -- interview_prep, refusal_analysis, doc_read, case_brain, discovery, portal_watch
  units integer not null default 1,
  created_at timestamptz not null default now()
);
alter table if exists public.usage_meter add column if not exists user_id uuid;
alter table if exists public.usage_meter add column if not exists org_id uuid;
alter table if exists public.usage_meter add column if not exists capability text;
alter table if exists public.usage_meter add column if not exists units integer default 1 not null;
alter table if exists public.usage_meter add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_usage_user_cap on public.usage_meter(user_id, capability, created_at desc);
create table if not exists public.rule_sources (
  source_url text primary key,
  last_hash text, last_checked_at timestamptz, last_changed_at timestamptz, status text not null default 'ok'
);
alter table if exists public.rule_sources add column if not exists last_hash text;
alter table if exists public.rule_sources add column if not exists last_checked_at timestamptz;
alter table if exists public.rule_sources add column if not exists last_changed_at timestamptz;
alter table if exists public.rule_sources add column if not exists status text default 'ok' not null;
alter table if exists public.visa_rules add column if not exists source_changed boolean not null default false;
create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('greenhouse','lever','workable','rss','json')),
  key text not null,                  -- board token / company slug / feed URL
  org_name text, country_code text, lane text not null default 'work' check (lane in ('study','work')),
  enabled boolean not null default true,
  last_run_at timestamptz, last_count integer, last_error text,
  created_at timestamptz not null default now(),
  unique (kind, key)
);
alter table if exists public.sources add column if not exists kind text;
alter table if exists public.sources add column if not exists key text;
alter table if exists public.sources add column if not exists org_name text;
alter table if exists public.sources add column if not exists country_code text;
alter table if exists public.sources add column if not exists lane text default 'work' not null;
alter table if exists public.sources add column if not exists enabled boolean default true not null;
alter table if exists public.sources add column if not exists last_run_at timestamptz;
alter table if exists public.sources add column if not exists last_count integer;
alter table if exists public.sources add column if not exists last_error text;
alter table if exists public.sources add column if not exists created_at timestamptz default now() not null;
alter table if exists public.opportunities add column if not exists posted_at timestamptz;
alter table if exists public.opportunities add column if not exists source_key text;
alter table if exists public.payments add column if not exists refunded_at timestamptz;
alter table if exists public.payments add column if not exists refund_ref text;
-- Multi-instance safe job claim: one row, locked, skipped by other workers.
create or replace function public.claim_job(worker text) returns setof public.job_queue language plpgsql as $$
declare j public.job_queue;
begin
  select * into j from public.job_queue where status = 'queued' and run_after <= now() order by id for update skip locked limit 1;
  if not found then return; end if;
  update public.job_queue set status = 'running', locked_at = now(), locked_by = worker, attempts = attempts + 1, updated_at = now() where id = j.id returning * into j;
  return next j;
end $$;

-- ===== 0051_policy_partnerships_economics.sql =====
-- ForiForeign — 0051 · policy watch with impact, partnership outreach + official documents registry with digital
-- signature, case-closure cleanup, economics. USD-only pricing (PKR paths retired from the interface).
alter table if exists public.rule_sources add column if not exists last_text text;
create table if not exists public.policy_updates (
  id uuid primary key default gen_random_uuid(),
  country_code text not null, source_url text not null, source_title text,
  summary text not null, impact text, affected_lanes text[] not null default '{}',
  severity text not null default 'info' check (severity in ('info','review','urgent')),
  detected_at timestamptz not null default now(), reviewed_by uuid, reviewed_at timestamptz, status text not null default 'new' check (status in ('new','reviewed','dismissed'))
);
alter table if exists public.policy_updates add column if not exists country_code text;
alter table if exists public.policy_updates add column if not exists source_url text;
alter table if exists public.policy_updates add column if not exists source_title text;
alter table if exists public.policy_updates add column if not exists summary text;
alter table if exists public.policy_updates add column if not exists impact text;
alter table if exists public.policy_updates add column if not exists affected_lanes text default '{}' not null;
alter table if exists public.policy_updates add column if not exists severity text default 'info' not null;
alter table if exists public.policy_updates add column if not exists detected_at timestamptz default now() not null;
alter table if exists public.policy_updates add column if not exists reviewed_by uuid;
alter table if exists public.policy_updates add column if not exists reviewed_at timestamptz;
alter table if exists public.policy_updates add column if not exists status text default 'new' not null;
create index if not exists idx_policy_updates_cc on public.policy_updates(country_code, detected_at desc);
create table if not exists public.official_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('partnership_proposal','mou','agency_agreement','service_partner_agreement','consent','other')),
  title text not null,
  counterparty_org_id uuid, counterparty_name text, counterparty_email text, counterparty_focal text,
  our_focal text, body_text text not null, variant text,
  storage_key text, sha256 text,
  status text not null default 'draft' check (status in ('draft','approved','signed','sent','countersigned','archived','void')),
  approved_by uuid, approved_at timestamptz, signed_by uuid, signed_at timestamptz, signature text, sent_at timestamptz, countersigned_at timestamptz,
  valid_from date, valid_until date, notes text,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table if exists public.official_documents add column if not exists kind text;
alter table if exists public.official_documents add column if not exists title text;
alter table if exists public.official_documents add column if not exists counterparty_org_id uuid;
alter table if exists public.official_documents add column if not exists counterparty_name text;
alter table if exists public.official_documents add column if not exists counterparty_email text;
alter table if exists public.official_documents add column if not exists counterparty_focal text;
alter table if exists public.official_documents add column if not exists our_focal text;
alter table if exists public.official_documents add column if not exists body_text text;
alter table if exists public.official_documents add column if not exists variant text;
alter table if exists public.official_documents add column if not exists storage_key text;
alter table if exists public.official_documents add column if not exists status text default 'draft' not null;
alter table if exists public.official_documents add column if not exists approved_by uuid;
alter table if exists public.official_documents add column if not exists approved_at timestamptz;
alter table if exists public.official_documents add column if not exists signed_by uuid;
alter table if exists public.official_documents add column if not exists signed_at timestamptz;
alter table if exists public.official_documents add column if not exists signature text;
alter table if exists public.official_documents add column if not exists sent_at timestamptz;
alter table if exists public.official_documents add column if not exists countersigned_at timestamptz;
alter table if exists public.official_documents add column if not exists valid_from date;
alter table if exists public.official_documents add column if not exists valid_until date;
alter table if exists public.official_documents add column if not exists notes text;
alter table if exists public.official_documents add column if not exists created_by uuid;
alter table if exists public.official_documents add column if not exists created_at timestamptz default now() not null;
alter table if exists public.official_documents add column if not exists updated_at timestamptz default now() not null;
create index if not exists idx_official_docs_status on public.official_documents(status, created_at desc);
alter table if exists public.visa_cases add column if not exists fee_amount numeric;
alter table if exists public.visa_cases add column if not exists fee_currency text;
alter table if exists public.visa_cases add column if not exists fee_paid_on date;
alter table if exists public.offers add column if not exists tuition_fee numeric;
alter table if exists public.offers add column if not exists tuition_currency text;
alter table if exists public.applications add column if not exists closed_at timestamptz;
alter table if exists public.applications add column if not exists purged_at timestamptz;

-- ===== 0052_layers_support_oversight.sql =====
-- ForiForeign — 0052 · visibility layers, support triage, platform oversight, official contact.
alter table if exists public.support_tickets add column if not exists category text;          -- payment | bug | visa | partnership | account | complaint | other
alter table if exists public.support_tickets add column if not exists priority text;          -- low | normal | high | urgent
alter table if exists public.support_tickets add column if not exists suggested_reply text;
alter table if exists public.support_tickets add column if not exists org_id uuid;
alter table if exists public.support_tickets add column if not exists sla_due_at timestamptz;
create index if not exists idx_support_status_priority on public.support_tickets(status, priority);

-- ===== 0053_institutions_entities.sql =====
-- ForiForeign — 0053 · institution / employer entities (the graph's first nodes) for all 54 destinations.
create table if not exists public.institutions (
  id uuid primary key default gen_random_uuid(),
  country_code text not null, name text not null, domain text, kind text not null default 'university' check (kind in ('university','college','employer','recruiter','funder','hospital','other')),
  website text, admissions_url text, careers_url text, contact_email text,
  partner_org_id uuid, verified boolean not null default false, source text not null default 'seed',
  created_at timestamptz not null default now(),
  unique (country_code, name)
);
alter table if exists public.institutions add column if not exists country_code text;
alter table if exists public.institutions add column if not exists name text;
alter table if exists public.institutions add column if not exists domain text;
alter table if exists public.institutions add column if not exists kind text default 'university' not null;
alter table if exists public.institutions add column if not exists website text;
alter table if exists public.institutions add column if not exists admissions_url text;
alter table if exists public.institutions add column if not exists careers_url text;
alter table if exists public.institutions add column if not exists contact_email text;
alter table if exists public.institutions add column if not exists partner_org_id uuid;
alter table if exists public.institutions add column if not exists verified boolean default false not null;
alter table if exists public.institutions add column if not exists source text default 'seed' not null;
alter table if exists public.institutions add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_institutions_cc on public.institutions(country_code, kind);
create index if not exists idx_institutions_domain on public.institutions(domain);
alter table public.institutions enable row level security;
drop policy if exists institutions_public on public.institutions; create policy institutions_public on public.institutions for select using (true);

-- ===== 0054_acquisition.sql =====
-- ForiForeign — 0054 · Acquisition engine: professions from ESCO, regulated-profession registry, institution and job
-- acquisition from authoritative registries and open job APIs, with verification state on every entity.
create table if not exists public.professions (
  id uuid primary key default gen_random_uuid(),
  esco_uri text unique, isco text, title text not null, alt_labels text[] not null default '{}', description text,
  regulated_in text[] not null default '{}', skills text[] not null default '{}', source text not null default 'esco', updated_at timestamptz not null default now()
);
alter table if exists public.professions add column if not exists esco_uri text;
alter table if exists public.professions add column if not exists isco text;
alter table if exists public.professions add column if not exists title text;
alter table if exists public.professions add column if not exists alt_labels text default '{}' not null;
alter table if exists public.professions add column if not exists description text;
alter table if exists public.professions add column if not exists regulated_in text default '{}' not null;
alter table if exists public.professions add column if not exists skills text default '{}' not null;
alter table if exists public.professions add column if not exists source text default 'esco' not null;
alter table if exists public.professions add column if not exists updated_at timestamptz default now() not null;
create index if not exists idx_professions_isco on public.professions(isco);
create index if not exists idx_professions_title on public.professions using gin (to_tsvector('simple', title));
alter table if exists public.institutions add column if not exists registry text;
alter table if exists public.institutions add column if not exists registry_id text;
alter table if exists public.institutions add column if not exists city text;
alter table if exists public.institutions add column if not exists sector text;          -- public | private | for_profit
alter table if exists public.institutions add column if not exists verified_at timestamptz;
alter table if exists public.institutions add column if not exists domain_ok boolean;
alter table if exists public.institutions add column if not exists careers_feed text;    -- greenhouse:token | lever:slug | workable:slug | rss:url
alter table if exists public.institutions add column if not exists last_checked_at timestamptz;
alter table if exists public.institutions add column if not exists industry text;
create index if not exists idx_institutions_registry on public.institutions(registry, registry_id);
alter table if exists public.sources add column if not exists params jsonb not null default '{}'::jsonb;
alter table if exists public.sources drop constraint if exists sources_kind_check;
alter table if exists public.sources add constraint sources_kind_check check (kind in ('greenhouse','lever','workable','rss','json','arbeitnow','adzuna','jooble','reed','usajobs','esco','eu_regprof','college_scorecard','registry_csv','ats_discover'));
alter table if exists public.opportunities add column if not exists employer_verified boolean;
alter table if exists public.opportunities add column if not exists institution_id uuid;

-- ===== 0055_visa_desk_addons.sql =====
-- ForiForeign — 0055 · Visa desk (end-to-end visa processing in the platform), add-on packs, partner spotlight.
alter table if exists public.visa_cases add column if not exists appointment_at timestamptz;
alter table if exists public.visa_cases add column if not exists appointment_place text;
alter table if exists public.visa_cases add column if not exists tracking_ref text;
alter table if exists public.visa_cases add column if not exists decision_text text;
alter table if exists public.visa_cases add column if not exists steps jsonb not null default '{}'::jsonb;    -- {prepare:done, booked:done, submitted:done, tracking:done, decision:done}
create table if not exists public.user_addons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, addon_key text not null, payment_id uuid, granted_by uuid,
  expires_at timestamptz, created_at timestamptz not null default now()
);
alter table if exists public.user_addons add column if not exists user_id uuid;
alter table if exists public.user_addons add column if not exists addon_key text;
alter table if exists public.user_addons add column if not exists payment_id uuid;
alter table if exists public.user_addons add column if not exists granted_by uuid;
alter table if exists public.user_addons add column if not exists expires_at timestamptz;
alter table if exists public.user_addons add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_user_addons on public.user_addons(user_id, addon_key);
alter table if exists public.payments add column if not exists addon_key text;
alter table if exists public.partner_openings add column if not exists spotlight boolean not null default false;
alter table if exists public.partner_openings add column if not exists spotlight_until date;

-- ===== 0056_consent_ledger_free_tier.sql =====
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
alter table if exists public.consent_ledger add column if not exists user_id uuid;
alter table if exists public.consent_ledger add column if not exists kind text;
alter table if exists public.consent_ledger add column if not exists version text;
alter table if exists public.consent_ledger add column if not exists text_hash text;
alter table if exists public.consent_ledger add column if not exists wording text;
alter table if exists public.consent_ledger add column if not exists evidence jsonb default '{}'::jsonb not null;
alter table if exists public.consent_ledger add column if not exists ip text;
alter table if exists public.consent_ledger add column if not exists user_agent text;
alter table if exists public.consent_ledger add column if not exists locale text;
alter table if exists public.consent_ledger add column if not exists recorded_at timestamptz default now() not null;
create index if not exists idx_consent_user on public.consent_ledger(user_id, recorded_at desc);
alter table if exists public.profiles add column if not exists free_searches_used integer not null default 0;

-- ===== 0057_quota_allocation.sql =====
-- ForiForeign — 0057 · agency quota allocation down the tree (branch → sub-branch → member), organisation search counters,
-- resale locks.
create table if not exists public.quota_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  scope_kind text not null check (scope_kind in ('branch','member')),
  scope_key text not null,                 -- branch path ("Lahore" or "Lahore/DHA") or user id
  cases_month integer not null default 0,
  searches_day integer not null default 0,
  set_by uuid, updated_at timestamptz not null default now(),
  unique (org_id, scope_kind, scope_key)
);
alter table if exists public.quota_allocations add column if not exists org_id uuid;
alter table if exists public.quota_allocations add column if not exists scope_kind text;
alter table if exists public.quota_allocations add column if not exists scope_key text;
alter table if exists public.quota_allocations add column if not exists cases_month integer default 0 not null;
alter table if exists public.quota_allocations add column if not exists searches_day integer default 0 not null;
alter table if exists public.quota_allocations add column if not exists set_by uuid;
alter table if exists public.quota_allocations add column if not exists updated_at timestamptz default now() not null;
alter table if exists public.usage_meter add column if not exists scope_key text;
create index if not exists idx_usage_org_cap on public.usage_meter(org_id, capability, created_at desc);
alter table if exists public.org_subscriptions add column if not exists searches_day integer;
alter table if exists public.org_subscriptions add column if not exists searches_month integer;
alter table if exists public.org_subscriptions add column if not exists billing_period text not null default 'month';
alter table if exists public.clients add column if not exists origin_org_locked boolean not null default true;

-- ===== 0058_prospecting_brief_selfheal.sql =====
-- ForiForeign — 0058 · Prospecting agent (lawful B2B outreach with trial access), daily brief, self-heal log, FAQ store.
create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('university','agency','employer','partner')),
  name text not null, country_code text, city text, website text, domain text,
  contacts jsonb not null default '[]'::jsonb,          -- [{email, role, source_url}]
  research jsonb not null default '{}'::jsonb,          -- what we learned from their public pages
  stage text not null default 'found' check (stage in ('found','researched','proposed','replied','trial','mou','client','declined','unsubscribed','bounced')),
  proposal_doc_id uuid, trial_org_id uuid, trial_until date,
  last_contact_at timestamptz, next_followup_at timestamptz, followups integer not null default 0,
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (kind, name, country_code)
);
alter table if exists public.prospects add column if not exists kind text;
alter table if exists public.prospects add column if not exists name text;
alter table if exists public.prospects add column if not exists country_code text;
alter table if exists public.prospects add column if not exists city text;
alter table if exists public.prospects add column if not exists website text;
alter table if exists public.prospects add column if not exists domain text;
alter table if exists public.prospects add column if not exists contacts jsonb default '[]'::jsonb not null;
alter table if exists public.prospects add column if not exists research jsonb default '{}'::jsonb not null;
alter table if exists public.prospects add column if not exists stage text default 'found' not null;
alter table if exists public.prospects add column if not exists proposal_doc_id uuid;
alter table if exists public.prospects add column if not exists trial_org_id uuid;
alter table if exists public.prospects add column if not exists trial_until date;
alter table if exists public.prospects add column if not exists last_contact_at timestamptz;
alter table if exists public.prospects add column if not exists next_followup_at timestamptz;
alter table if exists public.prospects add column if not exists followups integer default 0 not null;
alter table if exists public.prospects add column if not exists notes text;
alter table if exists public.prospects add column if not exists created_at timestamptz default now() not null;
alter table if exists public.prospects add column if not exists updated_at timestamptz default now() not null;
create index if not exists idx_prospects_stage on public.prospects(stage, next_followup_at);
create table if not exists public.suppression_list (email text primary key, reason text, created_at timestamptz not null default now());
create table if not exists public.daily_briefs (id uuid primary key default gen_random_uuid(), brief_date date not null unique, content jsonb not null, text_summary text, created_at timestamptz not null default now());
create table if not exists public.selfheal_log (id bigserial primary key, kind text not null, detail text, action text, outcome text, created_at timestamptz not null default now());
create table if not exists public.faqs (id uuid primary key default gen_random_uuid(), question text not null, answer text not null, audience text not null default 'applicant' check (audience in ('applicant','agency','partner','all')), source text not null default 'admin', hits integer not null default 0, updated_at timestamptz not null default now());
alter table if exists public.support_tickets add column if not exists auto_replied boolean not null default false;
alter table if exists public.documents add column if not exists attestation_status text;   -- unknown | apostille | legalised | notarised | certified_copy | plain

-- ===== 0059_autopilot_copilot.sql =====
-- ForiForeign — 0059 · prospecting autopilot, admin guidance, FAQ learning, admin copilot log.
create table if not exists public.admin_guidance (id uuid primary key default gen_random_uuid(), text text not null, applies_to text[] not null default '{all}', active boolean not null default true, created_by uuid, created_at timestamptz not null default now(), expires_at timestamptz);
create table if not exists public.faq_candidates (id uuid primary key default gen_random_uuid(), question text not null, answer text, seen integer not null default 1, audience text not null default 'applicant', status text not null default 'pending' check (status in ('pending','approved','rejected')), created_at timestamptz not null default now());
create table if not exists public.copilot_log (id bigserial primary key, admin_id uuid, question text, answer text, actions jsonb not null default '[]'::jsonb, created_at timestamptz not null default now());
alter table if exists public.prospects add column if not exists sent_to text[] not null default '{}';
alter table if exists public.prospects add column if not exists roi jsonb not null default '{}'::jsonb;
alter table if exists public.documents add column if not exists compressed boolean not null default false;

-- ===== 0060_more_sources.sql =====
-- ForiForeign — 0060 · more keyless job sources, OpenAlex enrichment, university page probe, legal versions, reranker cache.
alter table if exists public.sources drop constraint if exists sources_kind_check;
alter table if exists public.sources add constraint sources_kind_check check (kind in ('greenhouse','lever','workable','rss','json','arbeitnow','adzuna','jooble','reed','usajobs','esco','eu_regprof','college_scorecard','registry_csv','ats_discover','remotive','jobicy','himalayas','themuse','nhs_jobs','openalex','uni_pages'));
alter table if exists public.institutions add column if not exists scholarships_url text;
create table if not exists public.legal_versions (id uuid primary key default gen_random_uuid(), kind text not null, version text not null, summary text, effective_from date not null default current_date, created_by uuid, created_at timestamptz not null default now(), unique (kind, version));
alter table if exists public.visa_rules add column if not exists assist jsonb;

-- ===== 0060_totp_paddle_legal.sql =====
-- ForiForeign — 0060 · admin TOTP (second factor inside the app), Paddle gateway, legal re-acceptance, scholarship probes.
alter table if exists public.profiles add column if not exists totp_secret_enc text;
alter table if exists public.profiles add column if not exists totp_enabled boolean not null default false;
alter table if exists public.profiles add column if not exists legal_version_accepted text;
create table if not exists public.totp_sessions (token text primary key, user_id uuid not null, expires_at timestamptz not null);
alter table if exists public.institutions add column if not exists scholarship_probe_at timestamptz;
alter table if exists public.opportunities add column if not exists eligibility_flag text;   -- citizens_only | clearance | local_only | null

-- ===== 0061_more_sources.sql =====
-- ===== 0061_more_sources.sql =====
alter table if exists public.sources drop constraint if exists sources_kind_check;
alter table if exists public.sources add constraint sources_kind_check check (kind in ('greenhouse','lever','workable','rss','json','arbeitnow','adzuna','jooble','reed','usajobs','esco','eu_regprof','college_scorecard','registry_csv','ats_discover','remotive','jobicy','himalayas','themuse','nhs_jobs','openalex','uni_pages'));

-- ===== 0062_preflight.sql =====
-- ===== 0062_preflight.sql =====
alter table if exists public.applications add column if not exists preflight_at timestamptz;

-- ===== 0063_labour_category_cost_intel.sql =====
-- ===== 0063_labour_category_cost_intel.sql =====
alter table if exists public.opportunities add column if not exists category text;   -- labour | care | skilled | academic
create index if not exists idx_opps_category on public.opportunities(category, country_code);
alter table if exists public.applications add column if not exists success_estimate jsonb;

-- ===== 0064_refs_chain_tz.sql =====
-- ForiForeign — 0064 · reference numbers, audit hash chain, timezone, brand kit, staff-assist scope, resubmission.
alter table if exists public.applications add column if not exists ref text unique;
alter table if exists public.official_documents add column if not exists ref text unique;
alter table if exists public.visa_cases add column if not exists ref text unique;
alter table if exists public.support_tickets add column if not exists ref text unique;
alter table if exists public.payments add column if not exists ref text unique;
alter table if exists public.audit_log add column if not exists chain_hash text;
alter table if exists public.audit_log add column if not exists prev_hash text;
alter table if exists public.profiles add column if not exists timezone text;
alter table if exists public.visa_cases add column if not exists resubmitted_from uuid;
alter table if exists public.visa_cases add column if not exists emigration_clearance jsonb;
alter table if exists public.portal_connections drop constraint if exists portal_connections_scope_check;
alter table if exists public.portal_connections add constraint portal_connections_scope_check check (scope in ('watch','watch_and_upload','watch_upload_submit','staff_assist'));

-- ===== 0065_staff_processing.sql =====
-- ===== 0065_staff_processing.sql =====
alter table if exists public.profiles add column if not exists allow_staff_processing boolean not null default false;

-- ===== 0066_caseview_checkins_pricing.sql =====
-- ForiForeign — 0066 · check-in tracking backbone, case view support, wedge pricing (Residence plan, labour starter), client import.
alter table if exists public.visa_cases add column if not exists expected_decision_from date;
alter table if exists public.visa_cases add column if not exists expected_decision_to date;
alter table if exists public.visa_cases add column if not exists checkins jsonb;
alter table if exists public.visa_cases add column if not exists checkin_state text;
alter table if exists public.applications add column if not exists prepared_at timestamptz;
alter table if exists public.applications add column if not exists sent_to text;

-- ===== 0067_channel_identity.sql =====
-- ===== 0067_channel_identity.sql =====
alter table if exists public.applications add column if not exists channel_kind text;      -- direct | agency
alter table if exists public.applications add column if not exists channel_org_id uuid;
create index if not exists idx_apps_channel on public.applications(channel_org_id);

-- ===== 0068_support_routing.sql =====
-- ===== 0068_support_routing.sql =====
alter table if exists public.support_tickets add column if not exists org_id uuid;
create index if not exists idx_tickets_org on public.support_tickets(org_id);

-- ===== 0069_partner_system.sql =====
-- ForiForeign — 0069 · Partner system: reputation, priority tier, office contacts, negotiation, onboarding, referrals, receivables, disputes.
alter table if exists public.institutions add column if not exists partner_tier text;            -- mou | pilot | null
alter table if exists public.institutions add column if not exists partner_since date;
alter table if exists public.institutions add column if not exists partner_terms jsonb;          -- {fee_pct, fixed_usd, currency, payment_days, valid_until, document_id}
alter table if exists public.institutions add column if not exists reputation numeric;           -- 0-100 per country
alter table if exists public.institutions add column if not exists reputation_meta jsonb;        -- {works, cited, rank, verified}
alter table if exists public.institutions add column if not exists office jsonb;                 -- {email, name, title, url, confidence, found_at}
create index if not exists idx_inst_partner on public.institutions(country_code, partner_tier, reputation desc);
alter table if exists public.opportunities add column if not exists partner_tier text;
create table if not exists public.partner_referrals (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid, institution_name text, country_code text,
  application_id uuid, user_id uuid, org_id uuid,              -- org_id = consultancy channel (null = direct)
  stage text not null default 'sent',                           -- sent | reply | offer | accepted | enrolled | withdrawn | rejected
  tuition_usd numeric, share_usd numeric, share_basis text,     -- pct:15 | fixed:500
  invoice_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table if exists public.partner_referrals add column if not exists institution_id uuid;
alter table if exists public.partner_referrals add column if not exists institution_name text;
alter table if exists public.partner_referrals add column if not exists country_code text;
alter table if exists public.partner_referrals add column if not exists application_id uuid;
alter table if exists public.partner_referrals add column if not exists user_id uuid;
alter table if exists public.partner_referrals add column if not exists org_id uuid;
alter table if exists public.partner_referrals add column if not exists stage text default 'sent' not null;
alter table if exists public.partner_referrals add column if not exists tuition_usd numeric;
alter table if exists public.partner_referrals add column if not exists share_usd numeric;
alter table if exists public.partner_referrals add column if not exists share_basis text;
alter table if exists public.partner_referrals add column if not exists invoice_id uuid;
alter table if exists public.partner_referrals add column if not exists created_at timestamptz default now() not null;
alter table if exists public.partner_referrals add column if not exists updated_at timestamptz default now() not null;
create index if not exists idx_ref_inst on public.partner_referrals(institution_id, stage);
create table if not exists public.partner_invoices (
  id uuid primary key default gen_random_uuid(), ref text unique,
  institution_id uuid, institution_name text, period text, amount_usd numeric not null default 0, lines jsonb,
  status text not null default 'pending',                       -- pending | sent | reminded | paid | disputed | written_off
  due_on date, sent_at timestamptz, paid_at timestamptz, paid_ref text, reminders integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table if exists public.partner_invoices add column if not exists ref text;
alter table if exists public.partner_invoices add column if not exists institution_id uuid;
alter table if exists public.partner_invoices add column if not exists institution_name text;
alter table if exists public.partner_invoices add column if not exists period text;
alter table if exists public.partner_invoices add column if not exists amount_usd numeric default 0 not null;
alter table if exists public.partner_invoices add column if not exists lines jsonb;
alter table if exists public.partner_invoices add column if not exists status text default 'pending' not null;
alter table if exists public.partner_invoices add column if not exists due_on date;
alter table if exists public.partner_invoices add column if not exists sent_at timestamptz;
alter table if exists public.partner_invoices add column if not exists paid_at timestamptz;
alter table if exists public.partner_invoices add column if not exists paid_ref text;
alter table if exists public.partner_invoices add column if not exists reminders integer default 0 not null;
alter table if exists public.partner_invoices add column if not exists created_at timestamptz default now() not null;
alter table if exists public.partner_invoices add column if not exists updated_at timestamptz default now() not null;
create table if not exists public.partner_disputes (
  id uuid primary key default gen_random_uuid(), ref text unique,
  institution_id uuid, invoice_id uuid, referral_id uuid, raised_by text, reason text, evidence jsonb,
  status text not null default 'open',                          -- open | evidence_sent | resolved | escalated
  resolution text, opened_at timestamptz not null default now(), resolved_at timestamptz
);
alter table if exists public.partner_disputes add column if not exists ref text;
alter table if exists public.partner_disputes add column if not exists institution_id uuid;
alter table if exists public.partner_disputes add column if not exists invoice_id uuid;
alter table if exists public.partner_disputes add column if not exists referral_id uuid;
alter table if exists public.partner_disputes add column if not exists raised_by text;
alter table if exists public.partner_disputes add column if not exists reason text;
alter table if exists public.partner_disputes add column if not exists evidence jsonb;
alter table if exists public.partner_disputes add column if not exists status text default 'open' not null;
alter table if exists public.partner_disputes add column if not exists resolution text;
alter table if exists public.partner_disputes add column if not exists opened_at timestamptz default now() not null;
alter table if exists public.partner_disputes add column if not exists resolved_at timestamptz;
create table if not exists public.partner_liaison_log (
  id bigserial primary key, institution_id uuid, kind text, detail text, created_at timestamptz not null default now()
);
alter table if exists public.partner_liaison_log add column if not exists institution_id uuid;
alter table if exists public.partner_liaison_log add column if not exists kind text;
alter table if exists public.partner_liaison_log add column if not exists detail text;
alter table if exists public.partner_liaison_log add column if not exists created_at timestamptz default now() not null;
alter table if exists public.prospects add column if not exists negotiation jsonb;               -- {rounds:[], terms:{}, state}
alter table if exists public.prospects add column if not exists institution_id uuid;

-- ===== 0070_admission_evidence.sql =====
-- ForiForeign — 0070 · Admission and fee evidence: the portal is where enrolment is proven; the share follows the proof.
create table if not exists public.admission_records (
  id uuid primary key default gen_random_uuid(),
  application_id uuid, user_id uuid, referral_id uuid, institution_id uuid, org_id uuid,
  admission_number text, programme text, intake text, tuition_usd numeric, deposit_usd numeric, deposit_on date, currency text,
  evidence_doc_id uuid, evidence_kind text,            -- admission_letter | fee_receipt | institution_confirmation | applicant_statement
  confirmed_by text,                                    -- applicant | institution | consultancy | reader
  confidence numeric, created_at timestamptz not null default now()
);
alter table if exists public.admission_records add column if not exists application_id uuid;
alter table if exists public.admission_records add column if not exists user_id uuid;
alter table if exists public.admission_records add column if not exists referral_id uuid;
alter table if exists public.admission_records add column if not exists institution_id uuid;
alter table if exists public.admission_records add column if not exists org_id uuid;
alter table if exists public.admission_records add column if not exists admission_number text;
alter table if exists public.admission_records add column if not exists programme text;
alter table if exists public.admission_records add column if not exists intake text;
alter table if exists public.admission_records add column if not exists tuition_usd numeric;
alter table if exists public.admission_records add column if not exists deposit_usd numeric;
alter table if exists public.admission_records add column if not exists deposit_on date;
alter table if exists public.admission_records add column if not exists currency text;
alter table if exists public.admission_records add column if not exists evidence_doc_id uuid;
alter table if exists public.admission_records add column if not exists evidence_kind text;
alter table if exists public.admission_records add column if not exists confirmed_by text;
alter table if exists public.admission_records add column if not exists confidence numeric;
alter table if exists public.admission_records add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_adm_app on public.admission_records(application_id);
alter table if exists public.partner_referrals add column if not exists admission_number text;
alter table if exists public.partner_referrals add column if not exists evidence jsonb;
alter table if exists public.partner_invoices add column if not exists interest_usd numeric not null default 0;
alter table if exists public.partner_invoices add column if not exists pdf_path text;
alter table if exists public.institutions add column if not exists renewal_notified_at timestamptz;
alter table if exists public.institutions add column if not exists partner_kind text;   -- university | college | language_school | research_institute | employer | care_provider | hospital | licensed_recruiter

-- ===== 0071_trust_based_share.sql =====
-- ForiForeign — 0071 · Trust-based partner terms (no interest, no penalties), MOU terms stored on the document, institution kinds widened.
alter table if exists public.official_documents add column if not exists terms jsonb;
alter table if exists public.official_documents add column if not exists country_code text;
alter table if exists public.official_documents add column if not exists share_pct numeric;
alter table if exists public.institutions drop constraint if exists institutions_kind_check;
alter table if exists public.institutions add constraint institutions_kind_check check (kind in ('university','college','language_school','research_institute','employer','care_provider','hospital','recruiter','funder','other'));
alter table if exists public.partner_invoices drop column if exists interest_usd;

-- ===== 0072_lane_pref.sql =====
-- ForiForeign — 0072 · the applicant's chosen lane (study | work) drives navigation, search and recommendations.
alter table if exists public.profiles add column if not exists lane_pref text;

-- ===== 0073_subscription_lifecycle.sql =====
-- ForiForeign — 0073 · Subscription lifecycle for FF-CRM: renewal reminders, 3-day grace, invoices, renewals, all traceable.
alter table if exists public.org_subscriptions add column if not exists reminded_7 timestamptz;
alter table if exists public.org_subscriptions add column if not exists reminded_3 timestamptz;
alter table if exists public.org_subscriptions add column if not exists reminded_0 timestamptz;
alter table if exists public.org_subscriptions add column if not exists grace_until timestamptz;
alter table if exists public.org_subscriptions add column if not exists renewed_from uuid;
alter table if exists public.org_subscriptions add column if not exists gateway_subscription_id text;
create table if not exists public.org_invoices (
  id uuid primary key default gen_random_uuid(), ref text unique,
  org_id uuid, subscription_id uuid, payment_id uuid,
  tier_key text, tier_name text, billing_period text, amount_usd numeric not null default 0, currency text not null default 'USD',
  period_start timestamptz, period_end timestamptz, status text not null default 'paid',   -- paid | refunded | void
  gateway text, gateway_ref text, pdf_path text, emailed_to text, emailed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table if exists public.org_invoices add column if not exists ref text;
alter table if exists public.org_invoices add column if not exists org_id uuid;
alter table if exists public.org_invoices add column if not exists subscription_id uuid;
alter table if exists public.org_invoices add column if not exists payment_id uuid;
alter table if exists public.org_invoices add column if not exists tier_key text;
alter table if exists public.org_invoices add column if not exists tier_name text;
alter table if exists public.org_invoices add column if not exists billing_period text;
alter table if exists public.org_invoices add column if not exists amount_usd numeric default 0 not null;
alter table if exists public.org_invoices add column if not exists currency text default 'USD' not null;
alter table if exists public.org_invoices add column if not exists period_start timestamptz;
alter table if exists public.org_invoices add column if not exists period_end timestamptz;
alter table if exists public.org_invoices add column if not exists status text default 'paid' not null;
alter table if exists public.org_invoices add column if not exists gateway text;
alter table if exists public.org_invoices add column if not exists gateway_ref text;
alter table if exists public.org_invoices add column if not exists pdf_path text;
alter table if exists public.org_invoices add column if not exists emailed_to text;
alter table if exists public.org_invoices add column if not exists emailed_at timestamptz;
alter table if exists public.org_invoices add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_org_invoices_org on public.org_invoices(org_id, created_at desc);

-- ===== 0075_strict_separation.sql =====
-- ForiForeign — 0075 · STRICT SEPARATION. Direct applicants and FF-CRM clients are two populations that never meet.
-- An account records where it was created: the platform itself, or one consultancy's domain. Only accounts created on a
-- consultancy's domain can ever be attached to that consultancy. The consent-link experiment is retired.
alter table if exists public.profiles add column if not exists signup_org_id uuid;          -- null = created on foriforeign.com
alter table if exists public.profiles add column if not exists signup_host text;
alter table if exists public.clients drop column if exists pending_user_id;
alter table if exists public.clients drop column if exists link_status;
alter table if exists public.clients drop column if exists link_requested_at;
alter table if exists public.clients drop column if exists link_decided_at;
create index if not exists idx_profiles_signup_org on public.profiles(signup_org_id) where signup_org_id is not null;

-- ===== 0076_profile_from_cv.sql =====
-- ForiForeign — 0076 · Thirty more profile facts read from the CV and documents (never the CV's email address).
alter table if exists public.profiles add column if not exists highest_degree_year text;
alter table if exists public.profiles add column if not exists skills jsonb;
alter table if exists public.profiles add column if not exists certifications jsonb;
alter table if exists public.profiles add column if not exists language_tests jsonb;
alter table if exists public.profiles add column if not exists awards jsonb;
alter table if exists public.profiles add column if not exists memberships jsonb;
alter table if exists public.profiles add column if not exists projects jsonb;
alter table if exists public.profiles add column if not exists volunteering jsonb;
alter table if exists public.profiles add column if not exists gender text;
alter table if exists public.profiles add column if not exists marital_status text;
alter table if exists public.profiles add column if not exists current_employer text;
alter table if exists public.profiles add column if not exists notice_period text;
alter table if exists public.profiles add column if not exists driving_licence text;
-- Applicant "plus" packages: after an offer, one payment covers the whole rest of the journey.
alter table if exists public.user_addons add column if not exists bundle text;

-- ===== 0077_client_mailbox.sql =====
-- ForiForeign — 0077 · Every FF-CRM client gets a ForiForeign address the moment the record is created, account or not.
alter table if exists public.clients add column if not exists apply_email text;
create unique index if not exists idx_clients_apply_email on public.clients(apply_email) where apply_email is not null;
alter table if exists public.case_messages add column if not exists client_id uuid;
alter table if exists public.case_messages add column if not exists org_id uuid;
create index if not exists idx_case_messages_client on public.case_messages(client_id) where client_id is not null;

-- ===== 0078_agency_full_solution.sql =====
-- ForiForeign — 0078 · FF-CRM full-solution: the consultancy's own partner universities (priority + terms), finance (bank accounts,
-- expenses, disputes, P&L by branch), lead capture (own WhatsApp number and AI key, lead email address, public API).
create table if not exists public.org_partners (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  name text not null, country_code text, domain text, kind text not null default 'university',   -- university | college | employer | other
  contact_name text, contact_email text, contact_phone text,
  terms jsonb not null default '{}'::jsonb,      -- {fee_pct, fixed, currency, payment_days, intakes}
  agreement_from date, agreement_to date, priority integer not null default 1, status text not null default 'active',
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table if exists public.org_partners add column if not exists org_id uuid;
alter table if exists public.org_partners add column if not exists name text;
alter table if exists public.org_partners add column if not exists country_code text;
alter table if exists public.org_partners add column if not exists domain text;
alter table if exists public.org_partners add column if not exists kind text default 'university' not null;
alter table if exists public.org_partners add column if not exists contact_name text;
alter table if exists public.org_partners add column if not exists contact_email text;
alter table if exists public.org_partners add column if not exists contact_phone text;
alter table if exists public.org_partners add column if not exists terms jsonb default '{}'::jsonb not null;
alter table if exists public.org_partners add column if not exists agreement_from date;
alter table if exists public.org_partners add column if not exists agreement_to date;
alter table if exists public.org_partners add column if not exists priority integer default 1 not null;
alter table if exists public.org_partners add column if not exists status text default 'active' not null;
alter table if exists public.org_partners add column if not exists notes text;
alter table if exists public.org_partners add column if not exists created_at timestamptz default now() not null;
alter table if exists public.org_partners add column if not exists updated_at timestamptz default now() not null;
create index if not exists idx_org_partners_org on public.org_partners(org_id, status);
create table if not exists public.org_bank_accounts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, label text, bank text, account_title text, account_no text, iban text, swift text, currency text not null default 'PKR', is_default boolean not null default false, created_at timestamptz not null default now()
);
alter table if exists public.org_bank_accounts add column if not exists org_id uuid;
alter table if exists public.org_bank_accounts add column if not exists label text;
alter table if exists public.org_bank_accounts add column if not exists bank text;
alter table if exists public.org_bank_accounts add column if not exists account_title text;
alter table if exists public.org_bank_accounts add column if not exists account_no text;
alter table if exists public.org_bank_accounts add column if not exists iban text;
alter table if exists public.org_bank_accounts add column if not exists swift text;
alter table if exists public.org_bank_accounts add column if not exists currency text default 'PKR' not null;
alter table if exists public.org_bank_accounts add column if not exists is_default boolean default false not null;
alter table if exists public.org_bank_accounts add column if not exists created_at timestamptz default now() not null;
create table if not exists public.org_expenses (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, branch text, category text, amount numeric not null default 0, currency text not null default 'PKR', occurred_on date not null default current_date, note text, created_by uuid, created_at timestamptz not null default now()
);
alter table if exists public.org_expenses add column if not exists org_id uuid;
alter table if exists public.org_expenses add column if not exists branch text;
alter table if exists public.org_expenses add column if not exists category text;
alter table if exists public.org_expenses add column if not exists amount numeric default 0 not null;
alter table if exists public.org_expenses add column if not exists currency text default 'PKR' not null;
alter table if exists public.org_expenses add column if not exists occurred_on date default current_date not null;
alter table if exists public.org_expenses add column if not exists note text;
alter table if exists public.org_expenses add column if not exists created_by uuid;
alter table if exists public.org_expenses add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_org_expenses_org on public.org_expenses(org_id, occurred_on);
create table if not exists public.org_disputes (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, ref text, with_kind text not null default 'client',   -- client | partner | staff
  client_id uuid, partner_id uuid, amount numeric, currency text, reason text, status text not null default 'open', resolution text, opened_at timestamptz not null default now(), resolved_at timestamptz
);
alter table if exists public.org_disputes add column if not exists org_id uuid;
alter table if exists public.org_disputes add column if not exists ref text;
alter table if exists public.org_disputes add column if not exists with_kind text default 'client' not null;
alter table if exists public.org_disputes add column if not exists client_id uuid;
alter table if exists public.org_disputes add column if not exists partner_id uuid;
alter table if exists public.org_disputes add column if not exists amount numeric;
alter table if exists public.org_disputes add column if not exists currency text;
alter table if exists public.org_disputes add column if not exists reason text;
alter table if exists public.org_disputes add column if not exists status text default 'open' not null;
alter table if exists public.org_disputes add column if not exists resolution text;
alter table if exists public.org_disputes add column if not exists opened_at timestamptz default now() not null;
alter table if exists public.org_disputes add column if not exists resolved_at timestamptz;
alter table if exists public.client_finance add column if not exists branch text;
alter table if exists public.client_finance add column if not exists bank_account_id uuid;
alter table if exists public.commission_ledger add column if not exists partner_id uuid;
alter table if exists public.commission_ledger add column if not exists received_on date;
alter table if exists public.commission_ledger add column if not exists branch text;
alter table if exists public.clients add column if not exists source text;          -- whatsapp | email | web | walk-in | referral | api | csv
alter table if exists public.clients add column if not exists source_detail text;

-- ===== 0079_portal_assist_crm_gaps.sql =====
-- ForiForeign — 0079 · Portal Assist (one button, human-completed security, status + screenshot back) and CRM gaps.
alter table if exists public.portal_runs add column if not exists screenshot_key text;
alter table if exists public.portal_runs add column if not exists page_url text;
alter table if exists public.portal_runs add column if not exists status_label text;
alter table if exists public.portal_runs add column if not exists by_user_id uuid;
alter table if exists public.portal_runs add column if not exists on_behalf_org_id uuid;
alter table if exists public.clients add column if not exists lost_reason text;
alter table if exists public.clients add column if not exists assigned_to uuid;
alter table if exists public.clients add column if not exists last_activity_at timestamptz;
alter table if exists public.clients add column if not exists followup_step integer not null default 0;
alter table if exists public.clients add column if not exists sub_agent_user_id uuid;
alter table if exists public.clients add column if not exists sub_agent_share_pct numeric;
alter table if exists public.commission_ledger add column if not exists sub_agent_user_id uuid;
alter table if exists public.commission_ledger add column if not exists sub_agent_share_pct numeric;
create table if not exists public.org_broadcasts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, channel text not null default 'email', filter jsonb, template text, sent integer not null default 0, created_by uuid, created_at timestamptz not null default now()
);
alter table if exists public.org_broadcasts add column if not exists org_id uuid;
alter table if exists public.org_broadcasts add column if not exists channel text default 'email' not null;
alter table if exists public.org_broadcasts add column if not exists filter jsonb;
alter table if exists public.org_broadcasts add column if not exists template text;
alter table if exists public.org_broadcasts add column if not exists sent integer default 0 not null;
alter table if exists public.org_broadcasts add column if not exists created_by uuid;
alter table if exists public.org_broadcasts add column if not exists created_at timestamptz default now() not null;

-- ===== 0080_smart_visa_status.sql =====
-- ForiForeign — 0080 · Smart visa status: decision from mail first, manual update second, one automated check after the country's usual time, never a second attempt.
alter table if exists public.visa_cases add column if not exists manual_status_at timestamptz;
alter table if exists public.visa_cases add column if not exists manual_note text;
alter table if exists public.visa_cases add column if not exists auto_checked_at timestamptz;
alter table if exists public.visa_cases add column if not exists auto_check_result text;
alter table if exists public.visa_cases add column if not exists decision_from_mail_at timestamptz;
alter table if exists public.profiles add column if not exists province text;
alter table if exists public.profiles add column if not exists postal_code text;
alter table if exists public.profiles add column if not exists birth_place text;
alter table if exists public.profiles add column if not exists passport_issue text;
alter table if exists public.profiles add column if not exists passport_expiry text;
alter table if exists public.profiles add column if not exists father_name text;
alter table if exists public.profiles add column if not exists mother_name text;
alter table if exists public.profiles add column if not exists previous_refusals text;

-- ===== 0080_visa_status_strategy.sql =====
-- ForiForeign — 0080 · Visa status strategy: email first, manual second, one portal check after the country's usual processing time, never daily, never a second attempt.
alter table if exists public.visa_cases add column if not exists check_after date;
alter table if exists public.visa_cases add column if not exists check_attempts integer not null default 0;
alter table if exists public.visa_cases add column if not exists decision_source text;      -- email | manual | portal | none
alter table if exists public.visa_cases add column if not exists check_note text;
alter table if exists public.visa_cases add column if not exists manual_note text;

-- ===== 0081_pr_pathways.sql =====
-- ForiForeign — 0081 · PR pathways: one structured, sourced row per destination; nightly policy watch re-verifies the source page.
create table if not exists public.pr_pathways (
  id uuid primary key default gen_random_uuid(), country_code text not null unique,
  pr_route text, years_to_pr numeric, years_to_citizenship numeric, language text, requirement text, absence_rule text, dependants text, dual_nationality text, notes text,
  source_url text, confidence text not null default 'verify', status text not null default 'active', last_verified_at timestamptz, changed_at timestamptz, updated_at timestamptz not null default now()
);
alter table if exists public.pr_pathways add column if not exists country_code text;
alter table if exists public.pr_pathways add column if not exists pr_route text;
alter table if exists public.pr_pathways add column if not exists years_to_pr numeric;
alter table if exists public.pr_pathways add column if not exists years_to_citizenship numeric;
alter table if exists public.pr_pathways add column if not exists language text;
alter table if exists public.pr_pathways add column if not exists requirement text;
alter table if exists public.pr_pathways add column if not exists absence_rule text;
alter table if exists public.pr_pathways add column if not exists dependants text;
alter table if exists public.pr_pathways add column if not exists dual_nationality text;
alter table if exists public.pr_pathways add column if not exists notes text;
alter table if exists public.pr_pathways add column if not exists source_url text;
alter table if exists public.pr_pathways add column if not exists confidence text default 'verify' not null;
alter table if exists public.pr_pathways add column if not exists status text default 'active' not null;
alter table if exists public.pr_pathways add column if not exists last_verified_at timestamptz;
alter table if exists public.pr_pathways add column if not exists changed_at timestamptz;
alter table if exists public.pr_pathways add column if not exists updated_at timestamptz default now() not null;

-- ===== 0082_pathway_membership.sql =====
-- ForiForeign — 0082 · Pathway Membership: free discovery and readiness for everyone; a low-friction recurring membership for
-- personalised analysis, monitoring and human help. Events are detected from the profile, documents, visa files and policy watch.
create table if not exists public.pathway_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, country_code text, kind text not null,   -- experience | qualification | language | visa | document_expiry | rule_change | eligibility | residence
  title text, detail text, delta jsonb, score_before integer, score_after integer, next_move text, priority text not null default 'normal',
  seen_at timestamptz, created_at timestamptz not null default now()
);
alter table if exists public.pathway_events add column if not exists user_id uuid;
alter table if exists public.pathway_events add column if not exists country_code text;
alter table if exists public.pathway_events add column if not exists kind text;
alter table if exists public.pathway_events add column if not exists title text;
alter table if exists public.pathway_events add column if not exists detail text;
alter table if exists public.pathway_events add column if not exists delta jsonb;
alter table if exists public.pathway_events add column if not exists score_before integer;
alter table if exists public.pathway_events add column if not exists score_after integer;
alter table if exists public.pathway_events add column if not exists next_move text;
alter table if exists public.pathway_events add column if not exists priority text default 'normal' not null;
alter table if exists public.pathway_events add column if not exists seen_at timestamptz;
alter table if exists public.pathway_events add column if not exists created_at timestamptz default now() not null;
create index if not exists idx_pathway_events_user on public.pathway_events(user_id, created_at desc);
alter table if exists public.profiles add column if not exists pathway_cc text;              -- the destination the person is tracking
alter table if exists public.profiles add column if not exists pathway_connected boolean not null default true;
alter table if exists public.profiles add column if not exists pathway_last_check timestamptz;
alter table if exists public.support_tickets add column if not exists kind text;

-- ===== 0083_crm_operations.sql =====
-- ForiForeign — 0083 · FF-CRM operations: priority, stage timing, client requests, activity.
alter table if exists public.clients add column if not exists priority text not null default 'normal';   -- low | normal | high | urgent
alter table if exists public.clients add column if not exists stage_changed_at timestamptz;
alter table if exists public.client_tasks add column if not exists for_client boolean not null default false;
create index if not exists idx_client_tasks_open on public.client_tasks(org_id, status) where status = 'open';

-- ===== 0084_crm_gaps.sql =====
-- ForiForeign — 0084 · FF-CRM gaps: invitations, archiving.
alter table if exists public.clients add column if not exists invited_at timestamptz;
alter table if exists public.clients add column if not exists archived_at timestamptz;

-- ===== 0084_profile_columns_missing.sql =====
-- ForiForeign — 0084 · BLUNDER FIX: the profile extractor wrote columns that did not exist (methods, languages, target_countries,
-- current_salary, summary), so PostgREST rejected the whole update and NOTHING from the CV reached the profile. These columns now exist.
alter table if exists public.profiles add column if not exists methods text;
alter table if exists public.profiles add column if not exists languages jsonb;
alter table if exists public.profiles add column if not exists target_countries jsonb;
alter table if exists public.profiles add column if not exists current_salary text;
alter table if exists public.profiles add column if not exists summary text;
alter table if exists public.profiles add column if not exists highest_degree text;
alter table if exists public.profiles add column if not exists lane_pref text;
alter table if exists public.profiles add column if not exists origin_country text;
alter table if exists public.profiles add column if not exists arrival_date date;
alter table if exists public.profiles add column if not exists links jsonb;

-- ===== 0085_reach_99.sql =====
-- ForiForeign — 0085 · Improvement set: marketing opt-out per client, tax fields on invoices, calibration storage lives in app_settings.
alter table if exists public.clients add column if not exists no_marketing boolean not null default false;
alter table if exists public.org_invoices add column if not exists tax_pct numeric;
alter table if exists public.org_invoices add column if not exists tax_usd numeric;
alter table if exists public.org_invoices add column if not exists total_usd numeric;

-- ===== 0086_rls_defense_in_depth.sql =====
-- ForiForeign — 0086 · SEC-001 · Defence in depth: Row Level Security ON for every application table.
-- Architecture verified in Phase 1: the server uses the service-role key (which bypasses RLS) and the browser NEVER queries
-- tables directly (0 uses of the client-side .from() in public/index.html; the anon key is used for Auth only). Therefore
-- enabling RLS with NO policies changes nothing for the server and closes the door for anyone holding the anon key.
-- Safe by construction: service_role bypasses RLS; anon/authenticated get zero rows on every table below.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
-- The one table the client may read through PostgREST later (none today). Add explicit policies here when that changes.

-- ===== 0087_profile_provenance_doc_versions.sql =====
-- ForiForeign — 0087 · Phase 3 · Traceable facts and document versions.
-- profile_provenance: for every profile column filled by extraction or by the person: {field: {source: 'cv'|'document'|'user'|'intent', doc_id, at}}.
alter table if exists public.profiles add column if not exists profile_provenance jsonb not null default '{}'::jsonb;
-- Document versions (DISC-001): a replacement CV supersedes the previous one; nothing is deleted.
alter table if exists public.documents add column if not exists version integer not null default 1;
alter table if exists public.documents add column if not exists supersedes_id uuid;
alter table if exists public.documents add column if not exists superseded_at timestamptz;
create index if not exists idx_documents_user_type_live on public.documents(user_id, doc_type) where superseded_at is null;

-- ===== 0088_opportunity_identity.sql =====
-- ForiForeign — 0088 · Phase 4 · One identity per opportunity (DISC-002) and honest verification status.
alter table if exists public.opportunities add column if not exists url_key text;
alter table if exists public.opportunities add column if not exists verify_note text;
alter table if exists public.opportunities add column if not exists verify_attempts integer not null default 0;
create index if not exists idx_opportunities_url_key on public.opportunities(url_key);
create index if not exists idx_opportunities_fingerprint on public.opportunities(fingerprint);

-- ===== 0089_mail_outbox.sql =====
-- ForiForeign — 0089 · Phase 5 · DISC-006 · Durable outbox for outbound mail: every message has an idempotency key; a provider
-- outage queues the message instead of losing it; retries with backoff; never a duplicate send.
create table if not exists public.mail_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  user_id uuid, application_id uuid, org_id uuid, kind text not null default 'case',
  payload jsonb not null,                       -- {from,to,subject,html,text,replyTo,cc,attachDocIds,headers,case_message_id}
  status text not null default 'pending',       -- pending | sent | failed
  attempts integer not null default 0, last_error text, next_attempt_at timestamptz not null default now(),
  provider_id text, created_at timestamptz not null default now(), sent_at timestamptz
);
alter table if exists public.mail_outbox add column if not exists idempotency_key text;
alter table if exists public.mail_outbox add column if not exists user_id uuid;
alter table if exists public.mail_outbox add column if not exists application_id uuid;
alter table if exists public.mail_outbox add column if not exists org_id uuid;
alter table if exists public.mail_outbox add column if not exists kind text default 'case' not null;
alter table if exists public.mail_outbox add column if not exists payload jsonb;
alter table if exists public.mail_outbox add column if not exists status text default 'pending' not null;
alter table if exists public.mail_outbox add column if not exists attempts integer default 0 not null;
alter table if exists public.mail_outbox add column if not exists last_error text;
alter table if exists public.mail_outbox add column if not exists next_attempt_at timestamptz default now() not null;
alter table if exists public.mail_outbox add column if not exists provider_id text;
alter table if exists public.mail_outbox add column if not exists created_at timestamptz default now() not null;
alter table if exists public.mail_outbox add column if not exists sent_at timestamptz;
create index if not exists idx_mail_outbox_due on public.mail_outbox(status, next_attempt_at);
alter table if exists public.case_messages add column if not exists send_status text;   -- queued | sent | failed (outbound only)
alter table if exists public.case_messages add column if not exists outbox_id uuid;
alter table if exists public.case_messages add column if not exists idempotency_key text;
alter table if exists public.case_messages add column if not exists provider_message_id text;
create index if not exists idx_case_messages_idem on public.case_messages(user_id, idempotency_key);

-- ===== 0090_payment_case.sql =====
-- ForiForeign — 0090 · Phase 7 · DISC-003 · a case opened automatically after payment is marked; ledger rows link to their payment.
alter table if exists public.applications add column if not exists opened_by text;
alter table if exists public.credit_ledger add column if not exists payment_id uuid;
alter table if exists public.payments add column if not exists intent jsonb;
-- (no DB unique index on user×opportunity: legitimate re-applications after a refusal exist; duplicates are prevented in code and tested)

-- ===== 0090_payment_intent.sql =====
-- ForiForeign — 0090 · Phase 7 · DISC-003 · A payment remembers what the person was trying to open, and settles into it.
alter table if exists public.payments add column if not exists intent jsonb;          -- {opportunity_id, addon}
alter table if exists public.payments add column if not exists case_id uuid;          -- the application opened by this payment
alter table if exists public.payments add column if not exists settled_source text;   -- webhook | return | safepay | lemon | paddle | admin
alter table if exists public.payments add column if not exists abandoned_at timestamptz;
create index if not exists idx_payments_user_status on public.payments(user_id, status);

-- ===== 0091_job_queue_idem.sql =====
-- ForiForeign — 0091 · Phase 9 · Jobs: idempotency key and per-job timeout.
alter table if exists public.job_queue add column if not exists idem_key text;
alter table if exists public.job_queue add column if not exists timeout_ms integer;
create index if not exists idx_job_queue_idem_live on public.job_queue(idem_key) where status in ('queued','running');

-- ===== 0092_rls_late_tables.sql =====
-- ForiForeign — 0092 · Final audit: RLS on tables created after 0086 (mail_outbox) and on the migration ledger; idempotent re-run of the loop.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' and not rowsecurity loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ===== 0093_byoc_ai.sql =====
-- ForiForeign — 0093 · BYOC AI: one private AI connection per consultancy (encrypted at rest), usage attribution, fixed platform plans.
create table if not exists public.org_ai_connections (
  org_id uuid primary key, status text not null default 'connected',          -- connected | disconnected
  gemini_key_enc text, anthropic_key_enc text, openai_key_enc text,           -- AES-256-GCM via FF_DATA_KEY; never returned
  gemini_last4 text, anthropic_last4 text, openai_last4 text,
  health text not null default 'healthy', health_note text, last_ok_at timestamptz, last_error_at timestamptz,
  connected_by uuid, connected_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table if exists public.org_ai_connections add column if not exists status text default 'connected' not null;
alter table if exists public.org_ai_connections add column if not exists gemini_key_enc text;
alter table if exists public.org_ai_connections add column if not exists anthropic_key_enc text;
alter table if exists public.org_ai_connections add column if not exists openai_key_enc text;
alter table if exists public.org_ai_connections add column if not exists health text default 'healthy' not null;
alter table if exists public.org_ai_connections add column if not exists health_note text;
alter table if exists public.org_ai_connections add column if not exists last_ok_at timestamptz;
alter table if exists public.org_ai_connections add column if not exists last_error_at timestamptz;
alter table if exists public.org_ai_connections add column if not exists connected_by uuid;
alter table if exists public.org_ai_connections add column if not exists connected_at timestamptz default now() not null;
alter table if exists public.org_ai_connections add column if not exists updated_at timestamptz default now() not null;
alter table public.org_ai_connections enable row level security;
-- the cost ledger was written by the router but never created by a migration; created here so metering exists on every database
create table if not exists public.ai_cost_ledger (
  id uuid primary key default gen_random_uuid(), org_id uuid, user_id uuid, application_id uuid,
  provider text, model text, purpose text, input_tokens integer, output_tokens integer, thinking text,
  cost_usd numeric, est_cost_usd numeric, created_at timestamptz not null default now()
);
alter table if exists public.ai_cost_ledger add column if not exists org_id uuid;
alter table if exists public.ai_cost_ledger add column if not exists user_id uuid;
alter table if exists public.ai_cost_ledger add column if not exists application_id uuid;
alter table if exists public.ai_cost_ledger add column if not exists provider text;
alter table if exists public.ai_cost_ledger add column if not exists model text;
alter table if exists public.ai_cost_ledger add column if not exists purpose text;
alter table if exists public.ai_cost_ledger add column if not exists input_tokens integer;
alter table if exists public.ai_cost_ledger add column if not exists output_tokens integer;
alter table if exists public.ai_cost_ledger add column if not exists thinking text;
alter table if exists public.ai_cost_ledger add column if not exists cost_usd numeric;
alter table if exists public.ai_cost_ledger add column if not exists est_cost_usd numeric;
alter table if exists public.ai_cost_ledger add column if not exists created_at timestamptz default now() not null;
alter table public.ai_cost_ledger enable row level security;
alter table if exists public.ai_cost_ledger add column if not exists org_id uuid;
alter table if exists public.ai_cost_ledger add column if not exists est_cost_usd numeric;
alter table if exists public.ai_cost_ledger add column if not exists cost_usd numeric;
alter table if exists public.ai_cost_ledger add column if not exists thinking text;
create index if not exists idx_ai_cost_ledger_user_day on public.ai_cost_ledger(user_id, created_at);
create index if not exists idx_ai_cost_ledger_org_day on public.ai_cost_ledger(org_id, created_at);

