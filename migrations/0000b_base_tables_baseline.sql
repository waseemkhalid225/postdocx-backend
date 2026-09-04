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
