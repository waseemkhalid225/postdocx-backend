-- ForiForeign — 0091 · Phase 9 · Jobs: idempotency key and per-job timeout.
alter table if exists public.job_queue add column if not exists idem_key text;
alter table if exists public.job_queue add column if not exists timeout_ms integer;
create index if not exists idx_job_queue_idem_live on public.job_queue(idem_key) where status in ('queued','running');
