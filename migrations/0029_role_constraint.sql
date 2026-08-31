-- Fix: the profiles.role CHECK constraint predates the role system and rejects
-- 'super_admin', so promoting an owner account fails. Rebuild it to allow every role
-- the application actually uses, and keep it as a constraint so typos are still caught.
do $$
declare c record;
begin
  -- Drop any existing check constraint on profiles.role, whatever it is named.
  for c in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_role_check check (role in (
    'user','staff','admin','super_admin',
    'content_admin','support_admin','finance_admin','operations_admin',
    'opportunity_admin','ai_admin','security_admin'
  ));

alter table public.profiles alter column role set default 'user';
update public.profiles set role = 'user' where role is null;
