-- ForiForeign Phase 2 — per-field provenance + cross-document verification.
-- Additive and idempotent. Run once in the Supabase SQL editor.
--
-- Stores each extracted profile fact as its own row, with the source document
-- and a status, so the UI can show "verified across N documents" or flag conflicts.
-- The existing profiles table is untouched and stays the canonical structured store;
-- profile_fields is the evidence/provenance layer on top of it.

create table if not exists public.profile_fields (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  field_key    text not null,               -- e.g. 'cgpa', 'headline', 'degree_msc'
  field_group  text not null default 'general', -- personal | education | experience | research | language | identity | general
  value        text,                         -- normalized string value
  status       text not null default 'extracted', -- extracted | verified | conflicting | provided | inferred
  sources      jsonb not null default '[]'::jsonb, -- [{document_id, name, value}]
  confidence   text default 'medium',        -- low | medium | high
  resolved     boolean not null default false, -- user has confirmed/resolved this field
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- one logical field per user (values/sources merged in code)
create unique index if not exists uq_profile_fields_user_key
  on public.profile_fields (user_id, field_key);

create index if not exists idx_profile_fields_user   on public.profile_fields (user_id);
create index if not exists idx_profile_fields_status on public.profile_fields (user_id, status);

-- keep updated_at fresh
create or replace function public.touch_profile_fields()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_profile_fields on public.profile_fields;
create trigger trg_touch_profile_fields
  before update on public.profile_fields
  for each row execute function public.touch_profile_fields();
