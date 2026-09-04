-- ForiForeign — 0052 · visibility layers, support triage, platform oversight, official contact.
alter table if exists public.support_tickets add column if not exists category text;          -- payment | bug | visa | partnership | account | complaint | other
alter table if exists public.support_tickets add column if not exists priority text;          -- low | normal | high | urgent
alter table if exists public.support_tickets add column if not exists suggested_reply text;
alter table if exists public.support_tickets add column if not exists org_id uuid;
alter table if exists public.support_tickets add column if not exists sla_due_at timestamptz;
create index if not exists idx_support_status_priority on public.support_tickets(status, priority);
