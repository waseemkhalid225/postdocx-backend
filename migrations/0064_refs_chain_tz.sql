-- ForiForeign — 0064 · reference numbers, audit hash chain, timezone, brand kit, staff-assist scope, resubmission.
alter table if exists public.applications add column if not exists ref text unique;
alter table if exists public.official_documents add column if not exists ref text unique;
alter table if exists public.visa_cases add column if not exists ref text unique;
alter table if exists public.support_tickets add column if not exists ref text unique;
alter table if exists public.payments add column if not exists ref text unique;
alter table if exists public.audit_log add column if not exists chain_hash text;
alter table if exists public.audit_log add column if not exists prev_hash text;
alter table if exists public.profiles add column if not exists timezone text;
alter table if exists public.visa_cases add column if not exists resubmitted_from uuid;
alter table if exists public.visa_cases add column if not exists emigration_clearance jsonb;
alter table if exists public.portal_connections drop constraint if exists portal_connections_scope_check;
alter table if exists public.portal_connections add constraint portal_connections_scope_check check (scope in ('watch','watch_and_upload','watch_upload_submit','staff_assist'));
