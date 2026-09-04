-- ForiForeign — 0075 · STRICT SEPARATION. Direct applicants and FF-CRM clients are two populations that never meet.
-- An account records where it was created: the platform itself, or one consultancy's domain. Only accounts created on a
-- consultancy's domain can ever be attached to that consultancy. The consent-link experiment is retired.
alter table if exists public.profiles add column if not exists signup_org_id uuid;          -- null = created on foriforeign.com
alter table if exists public.profiles add column if not exists signup_host text;
alter table if exists public.clients drop column if exists pending_user_id;
alter table if exists public.clients drop column if exists link_status;
alter table if exists public.clients drop column if exists link_requested_at;
alter table if exists public.clients drop column if exists link_decided_at;
create index if not exists idx_profiles_signup_org on public.profiles(signup_org_id) where signup_org_id is not null;
