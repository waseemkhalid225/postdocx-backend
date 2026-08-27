-- ForiForeign — 0021: genuine preparation progress for the waiting experience.
-- The engine writes each completed step here; the UI shows only real progress.
alter table if exists public.applications
  add column if not exists prep_progress jsonb default '[]'::jsonb,
  add column if not exists prep_started_at timestamptz;
