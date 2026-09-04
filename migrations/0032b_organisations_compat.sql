create table if not exists public.organisations (id uuid primary key default gen_random_uuid(), name text not null default '', kind text not null default 'personal', created_at timestamptz not null default now());
create table if not exists public.clients (id uuid primary key default gen_random_uuid(), org_id uuid, full_name text, created_at timestamptz not null default now());
-- Two generations of the organisations table used different owner column names (owner_user_id, owner_id). Both exist from
-- here on and are kept equal by a trigger, so every index, policy and code path works whichever name it uses.
alter table if exists public.organisations add column if not exists owner_user_id uuid;
alter table if exists public.organisations add column if not exists owner_id uuid;
alter table if exists public.organisations add column if not exists slug text;
alter table if exists public.organisations add column if not exists country_code text;
alter table if exists public.organisations add column if not exists plan text not null default 'free';
alter table if exists public.organisations add column if not exists settings jsonb not null default '{}'::jsonb;
alter table if exists public.organisations add column if not exists updated_at timestamptz not null default now();
update public.organisations set owner_id = coalesce(owner_id, owner_user_id), owner_user_id = coalesce(owner_user_id, owner_id) where owner_id is null or owner_user_id is null;
create or replace function public.ff_sync_org_owner() returns trigger language plpgsql as $$
begin
  if new.owner_id is null then new.owner_id := new.owner_user_id; end if;
  if new.owner_user_id is null then new.owner_user_id := new.owner_id; end if;
  if tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id and new.owner_user_id is not distinct from old.owner_user_id then new.owner_user_id := new.owner_id; end if;
    if new.owner_user_id is distinct from old.owner_user_id and new.owner_id is not distinct from old.owner_id then new.owner_id := new.owner_user_id; end if;
  end if;
  return new;
end $$;
drop trigger if exists ff_sync_org_owner on public.organisations;
create trigger ff_sync_org_owner before insert or update on public.organisations for each row execute function public.ff_sync_org_owner();


alter table if exists public.clients add column if not exists whatsapp text;
alter table if exists public.clients add column if not exists nationality text;
alter table if exists public.clients add column if not exists lane text;
alter table if exists public.clients add column if not exists origin_partner text;
alter table if exists public.clients add column if not exists status text not null default 'active';
alter table if exists public.clients add column if not exists user_id uuid;
alter table if exists public.clients add column if not exists owner_user_id uuid;
alter table if exists public.clients add column if not exists email text;
alter table if exists public.clients add column if not exists phone text;
alter table if exists public.clients add column if not exists stage text;
alter table if exists public.clients add column if not exists branch text;
alter table if exists public.clients add column if not exists notes text;
