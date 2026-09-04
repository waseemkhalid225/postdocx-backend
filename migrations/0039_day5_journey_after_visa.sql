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
create index if not exists idx_journey_user on public.journey_tasks(user_id, phase, done);
alter table public.journey_tasks enable row level security;
drop policy if exists journey_owner_read on public.journey_tasks;
create policy journey_owner_read on public.journey_tasks for select using (user_id = auth.uid());
