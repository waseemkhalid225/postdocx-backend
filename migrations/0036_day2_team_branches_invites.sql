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
create unique index if not exists idx_org_invites_pending on public.org_invites(org_id, lower(email)) where accepted_at is null;
alter table public.org_invites enable row level security;
drop policy if exists invites_member_read on public.org_invites;
create policy invites_member_read on public.org_invites for select using (exists (select 1 from public.org_members m where m.org_id = org_invites.org_id and m.user_id = auth.uid() and m.role in ('owner','manager')));
