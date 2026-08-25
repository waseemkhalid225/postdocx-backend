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
