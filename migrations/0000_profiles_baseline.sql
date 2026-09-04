-- ForiForeign — 0000 · PROFILES BASELINE. Runs first. Every column the code reads or writes on public.profiles is created if
-- missing (the table itself pre-exists from the original app and may lack some). email is filled from auth.users and kept in
-- sync by a trigger. Idempotent.
create table if not exists public.profiles (id uuid primary key, created_at timestamptz not null default now());
alter table public.profiles
  add column if not exists email text,
  add column if not exists full_name text,
  add column if not exists role text not null default 'user',
  add column if not exists phone text,
  add column if not exists whatsapp text,
  add column if not exists city text,
  add column if not exists address text,
  add column if not exists country_code text,
  add column if not exists nationality text,
  add column if not exists date_of_birth date,
  add column if not exists national_id text,
  add column if not exists passport_number text,
  add column if not exists headline text,
  add column if not exists field text,
  add column if not exists profession text,
  add column if not exists degree text,
  add column if not exists degree_level text,
  add column if not exists education jsonb,
  add column if not exists experience jsonb,
  add column if not exists experience_years numeric,
  add column if not exists total_experience_years numeric,
  add column if not exists cgpa text,
  add column if not exists last_institution text,
  add column if not exists publications jsonb,
  add column if not exists language_scores jsonb,
  add column if not exists licenses jsonb,
  add column if not exists license_number text,
  add column if not exists license_authority text,
  add column if not exists linkedin text,
  add column if not exists notify_whatsapp boolean not null default true,
  add column if not exists send_mode text,
  add column if not exists referral_status text,
  add column if not exists referral_qualified_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();
-- Fill email from auth.users and keep it in sync.
update public.profiles p set email = u.email from auth.users u where u.id = p.id and (p.email is null or p.email = '');
create or replace function public.ff_sync_profile_email() returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name) values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;
drop trigger if exists ff_sync_profile_email on auth.users;
create trigger ff_sync_profile_email after insert or update of email on auth.users for each row execute function public.ff_sync_profile_email();
