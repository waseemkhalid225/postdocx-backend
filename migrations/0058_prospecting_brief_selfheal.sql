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
create index if not exists idx_prospects_stage on public.prospects(stage, next_followup_at);
create table if not exists public.suppression_list (email text primary key, reason text, created_at timestamptz not null default now());
create table if not exists public.daily_briefs (id uuid primary key default gen_random_uuid(), brief_date date not null unique, content jsonb not null, text_summary text, created_at timestamptz not null default now());
create table if not exists public.selfheal_log (id bigserial primary key, kind text not null, detail text, action text, outcome text, created_at timestamptz not null default now());
create table if not exists public.faqs (id uuid primary key default gen_random_uuid(), question text not null, answer text not null, audience text not null default 'applicant' check (audience in ('applicant','agency','partner','all')), source text not null default 'admin', hits integer not null default 0, updated_at timestamptz not null default now());
alter table if exists public.support_tickets add column if not exists auto_replied boolean not null default false;
alter table if exists public.documents add column if not exists attestation_status text;   -- unknown | apostille | legalised | notarised | certified_copy | plain
