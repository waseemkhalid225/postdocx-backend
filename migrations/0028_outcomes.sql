-- Outcome tracking: learn which applications actually succeed so ranking can improve.
alter table public.applications add column if not exists outcome text;
alter table public.applications add column if not exists outcome_at timestamptz;
alter table public.applications add column if not exists outcome_note text;
create index if not exists idx_applications_outcome on public.applications (outcome);
