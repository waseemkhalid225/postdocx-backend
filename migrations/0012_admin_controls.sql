-- ForiForeign v0.7 — 0012: admin control for countries + packages.
-- Additive and idempotent. Run once after 0011.

-- Country visibility controls (public list respects `enabled`)
alter table if exists public.countries
  add column if not exists enabled boolean not null default true,
  add column if not exists featured boolean not null default false,
  add column if not exists description text,
  add column if not exists flag_url text;

-- Existing rows should stay visible by default
update public.countries set enabled = true where enabled is null;
