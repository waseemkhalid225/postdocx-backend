-- ForiForeign — 0045 · Case Inbox + Case Brain: the platform stays in the loop after the applicant presses Send,
-- lawfully: the applicant forwards or pastes replies; ForiForeign reads, understands, prepares, and the applicant acts.
alter table if exists public.applications add column if not exists intake_alias text unique;
alter table if exists public.applications add column if not exists last_inbound_at timestamptz;
alter table if exists public.applications add column if not exists next_action text;
alter table if exists public.applications add column if not exists next_action_owner text;    -- you | us | them
alter table if exists public.applications add column if not exists next_action_due date;
alter table if exists public.applications add column if not exists brain jsonb not null default '{}'::jsonb;   -- latest understanding: state, risks, predicted next event
create table if not exists public.case_messages (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  user_id uuid not null,
  direction text not null default 'in' check (direction in ('in','out')),
  channel text not null default 'email' check (channel in ('email','whatsapp','portal','manual')),
  from_addr text,
  subject text,
  body text,
  classification text,        -- interview_invite | offer | conditional_offer | rejection | documents_requested | info_request | acknowledgement | scheduling | other
  extracted jsonb not null default '{}'::jsonb,
  suggested_reply text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_case_messages_app on public.case_messages(application_id, received_at desc);
alter table public.case_messages enable row level security;
drop policy if exists case_messages_owner on public.case_messages;
create policy case_messages_owner on public.case_messages for select using (user_id = auth.uid());
