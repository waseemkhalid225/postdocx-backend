-- ForiForeign — 0018: RecipientDiscoveryService columns (spec #12/#13).
-- Additive and idempotent. Run once after 0017.
-- Stores the verified recipient for each opportunity: who to contact, their role,
-- how confident we are, and the official source the email was seen on.
-- All nullable; the engine degrades gracefully if this migration has not been run.

alter table if exists public.opportunities
  add column if not exists contact_name text,
  add column if not exists recipient_type text,
  add column if not exists recipient_role text,
  add column if not exists recipient_confidence text,
  add column if not exists recipient_source text;

-- Helpful when reviewing which opportunities still lack a verified recipient.
create index if not exists idx_opps_recipient_conf on public.opportunities (recipient_confidence);
