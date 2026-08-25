-- ForiForeign — 0016: case editor (spec 27). Run once after 0015. Additive/idempotent.
alter table if exists public.application_documents
  add column if not exists status text not null default 'draft';   -- draft | under_review | approved
alter table if exists public.applications
  add column if not exists notes text;
