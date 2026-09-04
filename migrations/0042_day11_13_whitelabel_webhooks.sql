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
create index if not exists idx_webhook_deliveries_hook on public.webhook_deliveries(webhook_id, created_at desc);
alter table public.org_domains enable row level security;
drop policy if exists org_domains_owner on public.org_domains;
create policy org_domains_owner on public.org_domains for select using (exists (select 1 from public.org_members m where m.org_id = org_domains.org_id and m.user_id = auth.uid() and m.role = 'owner'));
alter table public.org_webhooks enable row level security;
drop policy if exists org_webhooks_owner on public.org_webhooks;
create policy org_webhooks_owner on public.org_webhooks for select using (exists (select 1 from public.org_members m where m.org_id = org_webhooks.org_id and m.user_id = auth.uid() and m.role = 'owner'));
