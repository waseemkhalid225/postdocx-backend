-- ===== 0068_support_routing.sql =====
alter table if exists public.support_tickets add column if not exists org_id uuid;
create index if not exists idx_tickets_org on public.support_tickets(org_id);
