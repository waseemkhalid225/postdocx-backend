-- ForiForeign — 0046 · The ForiForeign application mailbox: name@apply.foriforeign.com per user, on our own
-- domain, operated by the platform as a service the user consents to and can pause, export or close.
alter table if exists public.profiles add column if not exists apply_email text unique;
alter table if exists public.profiles add column if not exists apply_email_forward boolean not null default true;   -- copy every inbound to the personal email
alter table if exists public.profiles add column if not exists apply_email_paused boolean not null default false;   -- user pauses platform reading; mail still stored, not read by the brain
alter table if exists public.profiles add column if not exists apply_email_consent_at timestamptz;
alter table if exists public.case_messages alter column application_id drop not null;
alter table if exists public.case_messages add column if not exists assigned_by text;   -- alias | sender_match | latest_case | unassigned
create index if not exists idx_case_messages_user on public.case_messages(user_id, received_at desc);
