-- ForiForeign — 0089 · Phase 5 · DISC-006 · Durable outbox for outbound mail: every message has an idempotency key; a provider
-- outage queues the message instead of losing it; retries with backoff; never a duplicate send.
create table if not exists public.mail_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  user_id uuid, application_id uuid, org_id uuid, kind text not null default 'case',
  payload jsonb not null,                       -- {from,to,subject,html,text,replyTo,cc,attachDocIds,headers,case_message_id}
  status text not null default 'pending',       -- pending | sent | failed
  attempts integer not null default 0, last_error text, next_attempt_at timestamptz not null default now(),
  provider_id text, created_at timestamptz not null default now(), sent_at timestamptz
);
create index if not exists idx_mail_outbox_due on public.mail_outbox(status, next_attempt_at);
alter table if exists public.case_messages add column if not exists send_status text;   -- queued | sent | failed (outbound only)
alter table if exists public.case_messages add column if not exists outbox_id uuid;
alter table if exists public.case_messages add column if not exists idempotency_key text;
alter table if exists public.case_messages add column if not exists provider_message_id text;
create index if not exists idx_case_messages_idem on public.case_messages(user_id, idempotency_key);
