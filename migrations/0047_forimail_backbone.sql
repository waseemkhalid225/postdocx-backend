-- ForiForeign — 0047 · forimail.com becomes the backbone: every user gets a unique address at first login,
-- the portal has a full inbox, every message is triaged (not only case-linked ones).
alter table if exists public.case_messages add column if not exists read_at timestamptz;
alter table if exists public.case_messages add column if not exists triage text;         -- application | verification_code | institution_general | newsletter | spam | personal | other
alter table if exists public.case_messages add column if not exists otp_code text;
alter table if exists public.case_messages add column if not exists to_addr text;
alter table if exists public.case_messages add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table if exists public.profiles alter column apply_email_forward set default false;
create index if not exists idx_case_messages_unread on public.case_messages(user_id, read_at) where read_at is null;
