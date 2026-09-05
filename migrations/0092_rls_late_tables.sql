-- ForiForeign — 0092 · Final audit: RLS on tables created after 0086 (mail_outbox) and on the migration ledger; idempotent re-run of the loop.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' and not rowsecurity loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
