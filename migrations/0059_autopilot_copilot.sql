-- ForiForeign — 0059 · prospecting autopilot, admin guidance, FAQ learning, admin copilot log.
create table if not exists public.admin_guidance (id uuid primary key default gen_random_uuid(), text text not null, applies_to text[] not null default '{all}', active boolean not null default true, created_by uuid, created_at timestamptz not null default now(), expires_at timestamptz);
create table if not exists public.faq_candidates (id uuid primary key default gen_random_uuid(), question text not null, answer text, seen integer not null default 1, audience text not null default 'applicant', status text not null default 'pending' check (status in ('pending','approved','rejected')), created_at timestamptz not null default now());
create table if not exists public.copilot_log (id bigserial primary key, admin_id uuid, question text, answer text, actions jsonb not null default '[]'::jsonb, created_at timestamptz not null default now());
alter table if exists public.prospects add column if not exists sent_to text[] not null default '{}';
alter table if exists public.prospects add column if not exists roi jsonb not null default '{}'::jsonb;
alter table if exists public.documents add column if not exists compressed boolean not null default false;
