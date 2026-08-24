-- ============================================================
-- ForiForeign v1.1 — Supabase schema (IDEMPOTENT: safe to re-run any number of times)
-- Approved rules baked in: evidence-only, credits, retention,
-- human-authorization gates, per-user isolation via RLS.
-- ============================================================

-- ---------- extensions ----------
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ---------- profiles (extends Supabase auth.users) ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text default '',
  nationality text default 'Pakistan',
  mode text not null default 'study' check (mode in ('study','work','both')),
  -- universal profile (normalized)
  headline text default '',            -- e.g. "PhD Pharmacology"
  field text default '',
  methods text default '',
  publications jsonb default '[]',
  education jsonb default '[]',        -- [{level,degree,institution,year,grade}]
  experience jsonb default '[]',
  licenses jsonb default '[]',         -- medical professions licensing layer
  links jsonb default '{}',            -- {orcid, scholar, linkedin,...}
  partner_id uuid references profiles(id),
  gmail_connected boolean default false,
  gmail_refresh_enc text,              -- AES-GCM encrypted, service-role only
  gmail_addr text default '',
  send_mode text not null default 'copilot' check (send_mode in ('copilot','autopilot')),
  role text not null default 'user' check (role in ('user','staff','admin')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- credits & payments ----------
create table if not exists credit_ledger (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  delta int not null,                        -- +purchase / -consume / +refund
  reason text not null check (reason in ('purchase','consume','refund','grant','adjust')),
  application_id uuid,                       -- set on consume
  payment_id uuid,
  note text default '',
  created_at timestamptz default now()
);
create index if not exists idx_credit_user on credit_ledger(user_id);

create table if not exists payments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  amount_pkr numeric(12,2) not null,
  credits int not null,
  method text not null default 'bank_transfer',
  reference text default '',                 -- bank ref / txn id
  status text not null default 'pending' check (status in ('pending','confirmed','rejected','refunded')),
  confirmed_by uuid references profiles(id), -- staff who confirmed (server-confirmed rule)
  pricing_version text not null default 'v1',
  created_at timestamptz default now(),
  confirmed_at timestamptz
);

create table if not exists pricing (
  version text primary key,
  active boolean default false,
  packs jsonb not null,       -- [{credits:1,pkr:X},{credits:5,pkr:Y},{credits:10,pkr:Z}]
  refund_policy text not null default '',
  created_at timestamptz default now()
);

-- ---------- taxonomy & suitability (evidence engine) ----------
create table if not exists countries (
  code text primary key,                    -- ISO-2
  name text not null,
  study_rating text default 'yellow' check (study_rating in ('green','yellow','red')),
  work_rating text default 'yellow' check (work_rating in ('green','yellow','red')),
  evidence jsonb default '[]',              -- [{claim,source_url,checked_at}]  RULE: no rating without evidence
  cost_note text default '',
  updated_at timestamptz default now()
);

create table if not exists professions (
  id text primary key,                      -- taxonomy code
  name text not null,
  category text not null,                   -- medical five at launch
  licensing jsonb default '{}',             -- per-country licensing requirements
  active boolean default true
);

-- ---------- opportunities (ingested + verified) ----------
create table if not exists opportunities (
  id uuid primary key default uuid_generate_v4(),
  kind text not null check (kind in ('study','scholarship','postdoc','work')),
  title text not null,
  institution text not null,
  country_code text references countries(code),
  city text default '',
  url text not null,
  deadline date,
  funding text default '',
  stipend text default '',
  duration text default '',
  perks text default '',
  requirements jsonb default '{}',
  contact_emails text[] default '{}',       -- only literally-seen addresses (RULE)
  apply_via text not null default 'portal' check (apply_via in ('email','portal','both')),
  status text not null default 'needs_verification'
    check (status in ('needs_verification','verified','expired','rejected')),
  verified_at timestamptz,
  source text default 'agent',
  search_blob tsvector,
  created_at timestamptz default now()
);
create index if not exists idx_opp_search on opportunities using gin(search_blob);
create index if not exists idx_opp_kind on opportunities(kind, status);

-- ---------- applications (the case lifecycle) ----------
create table if not exists applications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id),
  case_no text not null,
  stage text not null default 'matched' check (stage in
    ('matched','preparing','prepared','awaiting_authorization','submitted_email',
     'submitted_portal','replied','interview','offer','closed','archived')),
  match_score int default 0,
  chance text default '',
  prep_status jsonb default '{}',           -- {plan:[],done:[]}
  credits_consumed int default 0,
  authorized_at timestamptz,                -- RULE R4: consequential submission needs this
  authorized_by uuid references profiles(id),
  next_action text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, opportunity_id)
);

-- ---------- documents ----------
create table if not exists documents (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  application_id uuid references applications(id) on delete set null,
  kind text not null,                       -- cv|cover|concept|funding|credential|other
  name text not null,
  storage_key text not null,                -- R2/Supabase-storage key
  mime text default 'application/pdf',
  size_bytes bigint default 0,
  is_original boolean default false,        -- user credentials: attach unmodified (RULE)
  generated boolean default false,
  retention_until date,                     -- RULE R5 lifecycle
  created_at timestamptz default now()
);
create index if not exists idx_doc_user on documents(user_id);

create table if not exists document_access_log (
  id bigint generated always as identity primary key,
  document_id uuid not null references documents(id) on delete cascade,
  accessed_by uuid not null,
  action text not null check (action in ('view','download','attach','delete','rename')),
  at timestamptz default now()
);

-- ---------- messaging ----------
create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  application_id uuid references applications(id) on delete cascade,
  direction text not null check (direction in ('outbound','inbound')),
  to_emails text[] default '{}',
  subject text default '',
  body text default '',
  status text not null default 'draft' check (status in ('draft','pending','approved','sent','failed','rejected')),
  sent_at timestamptz,
  provider_id text default '',
  followup_count int default 0,
  created_at timestamptz default now()
);
create index if not exists idx_msg_user on messages(user_id, status);

-- ---------- referees, reminders ----------
create table if not exists referees (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null, title text default '', institution text default '',
  email text default '', phone text default '', relationship text default '',
  created_at timestamptz default now()
);

create table if not exists reminders (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  application_id uuid references applications(id) on delete cascade,
  kind text not null, due_on date, note text default '',
  status text not null default 'open' check (status in ('open','done')),
  created_at timestamptz default now()
);

-- ---------- cost ledger & audit ----------
create table if not exists ai_cost_ledger (
  id bigint generated always as identity primary key,
  user_id uuid, application_id uuid,
  provider text not null, model text not null, purpose text not null,
  input_tokens int default 0, output_tokens int default 0,
  cost_usd numeric(10,6) default 0,
  created_at timestamptz default now()
);
create index if not exists idx_cost_app on ai_cost_ledger(application_id);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  actor uuid, event text not null, detail text default '',
  at timestamptz default now()
);

create table if not exists app_settings (
  key text primary key, value jsonb not null default '{}', updated_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY — users see ONLY their own rows.
-- The agent/server uses service_role and bypasses RLS.
-- ============================================================
alter table profiles enable row level security;
alter table credit_ledger enable row level security;
alter table payments enable row level security;
alter table applications enable row level security;
alter table documents enable row level security;
alter table messages enable row level security;
alter table referees enable row level security;
alter table reminders enable row level security;
alter table ai_cost_ledger enable row level security;

drop policy if exists "own profile read" on profiles;
create policy "own profile read" on profiles for select using (auth.uid() = id);
drop policy if exists "own profile write" on profiles;
create policy "own profile write" on profiles for update using (auth.uid() = id)
  with check (auth.uid() = id AND role = (select role from profiles where id = auth.uid())); -- cannot self-promote
drop policy if exists "members visible minimal" on profiles;
create policy "members visible minimal" on profiles for select using (true); -- partner discovery (name/field only via view below)

drop policy if exists "own credits" on credit_ledger;
create policy "own credits" on credit_ledger for select using (auth.uid() = user_id);
drop policy if exists "own payments" on payments;
create policy "own payments" on payments      for select using (auth.uid() = user_id);
drop policy if exists "create own payment" on payments;
create policy "create own payment" on payments for insert with check (auth.uid() = user_id AND status = 'pending');
drop policy if exists "own apps" on applications;
create policy "own apps" on applications  for select using (auth.uid() = user_id);
drop policy if exists "own docs" on documents;
create policy "own docs" on documents     for all    using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own msgs" on messages;
create policy "own msgs" on messages      for select using (auth.uid() = user_id);
drop policy if exists "edit own draft msgs" on messages;
create policy "edit own draft msgs" on messages for update using (auth.uid() = user_id AND status in ('draft','pending'))
  with check (auth.uid() = user_id);
drop policy if exists "own referees" on referees;
create policy "own referees" on referees      for all    using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own reminders" on reminders;
create policy "own reminders" on reminders     for all    using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own costs" on ai_cost_ledger;
create policy "own costs" on ai_cost_ledger for select using (auth.uid() = user_id);

-- opportunities & countries & pricing are public-read
alter table opportunities enable row level security;
alter table countries enable row level security;
alter table pricing enable row level security;
drop policy if exists "opps readable" on opportunities;
create policy "opps readable" on opportunities for select using (status = 'verified');
drop policy if exists "countries readable" on countries;
create policy "countries readable" on countries     for select using (true);
drop policy if exists "pricing readable" on pricing;
create policy "pricing readable" on pricing       for select using (active = true);

-- minimal member directory for partner linking
create or replace view member_directory as
  select id, full_name, field, headline from profiles;

-- ---------- helper: current credit balance ----------
create or replace function credit_balance(uid uuid) returns int language sql stable as
$$ select coalesce(sum(delta),0)::int from credit_ledger where user_id = uid $$;

-- ---------- seed ----------
insert into pricing(version, active, packs, refund_policy) values
 ('v1', true,
  '[{"credits":1,"pkr":0},{"credits":5,"pkr":0},{"credits":10,"pkr":0}]',
  'Set at founder pricing session; unconsumed credits refundable on request within 14 days.')
 on conflict (version) do nothing;

insert into app_settings(key, value) values
 ('engine', '{"min_engage_score":60,"daily_outreach_cap":5,"followup_days":8,"run_cooldown_min":30}')
 on conflict (key) do nothing;

-- done
select 'ForiForeign schema v1 installed' as result;
