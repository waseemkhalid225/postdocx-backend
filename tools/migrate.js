#!/usr/bin/env node
/* OPS-001 · Migration runner. Applies the ASSEMBLED, idempotent script (ALL_MIGRATIONS_run_in_order.sql — built by tools/build-sql.js,
   which adds shape guards the raw files rely on) and records its checksum in public.schema_migrations, so "what is applied" is a fact.
   Usage: DATABASE_URL=postgres://... node tools/migrate.js [--dry]   (Supabase → Settings → Database → direct connection string; PGSSL=off for local) */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
(async () => {
  const dry = process.argv.includes('--dry'); const url = process.env.DATABASE_URL; if (!url) { console.error('DATABASE_URL is required'); process.exit(2); }
  const file = path.join(__dirname, '..', 'ALL_MIGRATIONS_run_in_order.sql'); const sql = fs.readFileSync(file, 'utf8'); const sum = crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);
  const { Client } = require('pg'); const c = new Client({ connectionString: url, ssl: (process.env.PGSSL === 'off' || /localhost|127\.0\.0\.1|sslmode=disable/.test(url)) ? false : { rejectUnauthorized: false } }); await c.connect();
  await c.query('create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now(), checksum text)'); try { await c.query('alter table public.schema_migrations enable row level security'); } catch (e) {}
  const { rows } = await c.query('select name, checksum from public.schema_migrations where name = $1', ['ALL_MIGRATIONS']);
  if (rows.length && rows[0].checksum === sum) { console.log('already applied: ALL_MIGRATIONS @' + sum); await c.end(); return; }
  if (dry) { console.log('would apply ALL_MIGRATIONS @' + sum + ' (' + sql.length + ' bytes)'); await c.end(); return; }
  try { await c.query(sql); await c.query('insert into public.schema_migrations(name, checksum) values ($1, $2) on conflict (name) do update set checksum = excluded.checksum, applied_at = now()', ['ALL_MIGRATIONS', sum]); console.log('applied ALL_MIGRATIONS @' + sum); } catch (e) { console.error('FAILED:', e.message); process.exit(1); }
  await c.end();
})();
