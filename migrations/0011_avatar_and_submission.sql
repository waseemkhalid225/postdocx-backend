-- ForiForeign v0.7 — 0011: profile avatar + browser-agent-ready submission tracking.
-- Additive and idempotent. Run once after 0010.

-- 1) Profile photograph (stored in the private userdocs bucket; served via signed URL)
alter table if exists public.profiles
  add column if not exists avatar_key text;

-- 2) Future browser-agent submission workflow (item 13): the agent will later fill
--    official portals. These columns let it record its work without a rebuild.
alter table if exists public.applications
  add column if not exists submission_method text,          -- email | portal | agent
  add column if not exists portal_url text,                 -- official application portal
  add column if not exists submission_status text,          -- pending | in_progress | submitted | confirmed | failed
  add column if not exists submission_log jsonb default '[]'::jsonb, -- [{at, step, note}]
  add column if not exists submission_confirmation text;    -- reference number / receipt
