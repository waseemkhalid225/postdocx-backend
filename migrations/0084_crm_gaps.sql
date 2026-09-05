-- ForiForeign — 0084 · FF-CRM gaps: invitations, archiving.
alter table if exists public.clients add column if not exists invited_at timestamptz;
alter table if exists public.clients add column if not exists archived_at timestamptz;
