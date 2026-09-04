-- ForiForeign — 0077 · Every FF-CRM client gets a ForiForeign address the moment the record is created, account or not.
alter table if exists public.clients add column if not exists apply_email text;
create unique index if not exists idx_clients_apply_email on public.clients(apply_email) where apply_email is not null;
alter table if exists public.case_messages add column if not exists client_id uuid;
alter table if exists public.case_messages add column if not exists org_id uuid;
create index if not exists idx_case_messages_client on public.case_messages(client_id) where client_id is not null;
