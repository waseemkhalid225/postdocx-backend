-- ForiForeign — 0086 · SEC-001 · Defence in depth: Row Level Security ON for every application table.
-- Architecture verified in Phase 1: the server uses the service-role key (which bypasses RLS) and the browser NEVER queries
-- tables directly (0 uses of the client-side .from() in public/index.html; the anon key is used for Auth only). Therefore
-- enabling RLS with NO policies changes nothing for the server and closes the door for anyone holding the anon key.
-- Safe by construction: service_role bypasses RLS; anon/authenticated get zero rows on every table below.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
-- The one table the client may read through PostgREST later (none today). Add explicit policies here when that changes.
