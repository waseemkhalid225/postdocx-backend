-- ForiForeign — 0079 · Portal Assist (one button, human-completed security, status + screenshot back) and CRM gaps.
alter table if exists public.portal_runs add column if not exists screenshot_key text;
alter table if exists public.portal_runs add column if not exists page_url text;
alter table if exists public.portal_runs add column if not exists status_label text;
alter table if exists public.portal_runs add column if not exists by_user_id uuid;
alter table if exists public.portal_runs add column if not exists on_behalf_org_id uuid;
alter table if exists public.clients add column if not exists lost_reason text;
alter table if exists public.clients add column if not exists assigned_to uuid;
alter table if exists public.clients add column if not exists last_activity_at timestamptz;
alter table if exists public.clients add column if not exists followup_step integer not null default 0;
alter table if exists public.clients add column if not exists sub_agent_user_id uuid;
alter table if exists public.clients add column if not exists sub_agent_share_pct numeric;
alter table if exists public.commission_ledger add column if not exists sub_agent_user_id uuid;
alter table if exists public.commission_ledger add column if not exists sub_agent_share_pct numeric;
create table if not exists public.org_broadcasts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, channel text not null default 'email', filter jsonb, template text, sent integer not null default 0, created_by uuid, created_at timestamptz not null default now()
);
