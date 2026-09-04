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
