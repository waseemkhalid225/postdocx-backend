-- ForiForeign — 0085 · Improvement set: marketing opt-out per client, tax fields on invoices, calibration storage lives in app_settings.
alter table if exists public.clients add column if not exists no_marketing boolean not null default false;
alter table if exists public.org_invoices add column if not exists tax_pct numeric;
alter table if exists public.org_invoices add column if not exists tax_usd numeric;
alter table if exists public.org_invoices add column if not exists total_usd numeric;
