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
create index if not exists idx_portal_conn_user on public.portal_connections(user_id, status);
create table if not exists public.portal_runs (
  id bigserial primary key,
  connection_id uuid not null references public.portal_connections(id) on delete cascade,
  user_id uuid not null,
  started_at timestamptz not null default now(), finished_at timestamptz,
  outcome text not null default 'pending' check (outcome in ('pending','ok','changed','login_failed','blocked','error')),
  status_text text, extracted jsonb not null default '{}'::jsonb, screenshot_key text, error text
);
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
create table if not exists public.client_finance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('fee_charged','payment_received','refund','cost','commission_in','commission_out','adjustment')),
  amount numeric not null, currency text not null default 'USD',
  note text, reference text, occurred_on date not null default current_date,
  created_by uuid, created_at timestamptz not null default now()
);
create index if not exists idx_client_finance_client on public.client_finance(client_id, occurred_on desc);
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  source text not null default 'form' check (source in ('form','meta','whatsapp','website','referral','import','other')),
  full_name text, email text, phone text, whatsapp text, country_interest text, lane text, message text,
  assigned_user_id uuid, status text not null default 'new' check (status in ('new','contacted','qualified','converted','lost')),
  client_id uuid, raw jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
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
create index if not exists idx_outbound_org on public.outbound_messages(org_id, status, created_at desc);
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid, user_id uuid, client_id uuid,
  kind text not null default 'call' check (kind in ('call','meeting','interview','biometrics','embassy','other')),
  title text not null, starts_at timestamptz not null, ends_at timestamptz, location text, link text, notes text,
  created_by uuid, created_at timestamptz not null default now()
);
create index if not exists idx_appointments_user on public.appointments(user_id, starts_at);
alter table if exists public.profiles add column if not exists protected_admin boolean not null default false;
alter table public.portal_connections enable row level security; drop policy if exists pc_owner on public.portal_connections; create policy pc_owner on public.portal_connections for select using (user_id = auth.uid());
alter table public.client_finance enable row level security; drop policy if exists cf_org on public.client_finance; create policy cf_org on public.client_finance for select using (exists (select 1 from public.org_members m where m.org_id = client_finance.org_id and m.user_id = auth.uid() and m.role in ('owner','manager')));
alter table public.leads enable row level security; drop policy if exists leads_org on public.leads; create policy leads_org on public.leads for select using (exists (select 1 from public.org_members m where m.org_id = leads.org_id and m.user_id = auth.uid()));
