-- ForiForeign — 0082 · Pathway Membership: free discovery and readiness for everyone; a low-friction recurring membership for
-- personalised analysis, monitoring and human help. Events are detected from the profile, documents, visa files and policy watch.
create table if not exists public.pathway_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, country_code text, kind text not null,   -- experience | qualification | language | visa | document_expiry | rule_change | eligibility | residence
  title text, detail text, delta jsonb, score_before integer, score_after integer, next_move text, priority text not null default 'normal',
  seen_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists idx_pathway_events_user on public.pathway_events(user_id, created_at desc);
alter table if exists public.profiles add column if not exists pathway_cc text;              -- the destination the person is tracking
alter table if exists public.profiles add column if not exists pathway_connected boolean not null default true;
alter table if exists public.profiles add column if not exists pathway_last_check timestamptz;
alter table if exists public.support_tickets add column if not exists kind text;
