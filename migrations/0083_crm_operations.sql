-- ForiForeign — 0083 · FF-CRM operations: priority, stage timing, client requests, activity.
alter table if exists public.clients add column if not exists priority text not null default 'normal';   -- low | normal | high | urgent
alter table if exists public.clients add column if not exists stage_changed_at timestamptz;
alter table if exists public.client_tasks add column if not exists for_client boolean not null default false;
create index if not exists idx_client_tasks_open on public.client_tasks(org_id, status) where status = 'open';
