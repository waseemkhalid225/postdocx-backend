-- ForiForeign — 0066 · check-in tracking backbone, case view support, wedge pricing (Residence plan, labour starter), client import.
alter table if exists public.visa_cases add column if not exists expected_decision_from date;
alter table if exists public.visa_cases add column if not exists expected_decision_to date;
alter table if exists public.visa_cases add column if not exists checkins jsonb;
alter table if exists public.visa_cases add column if not exists checkin_state text;
alter table if exists public.applications add column if not exists prepared_at timestamptz;
alter table if exists public.applications add column if not exists sent_to text;
