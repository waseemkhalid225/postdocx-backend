# ForiForeign — release runbook (Phase 11)

## Deploy (Railway)
1. `git push origin main` → Railway builds (prestart builds the web bundle and guides). Health: `GET /api/health` must return `{ok:true, build:<label>}`.
2. Migrations: `DATABASE_URL=<Supabase direct connection string> node tools/migrate.js --dry` then without `--dry`. The runner applies the assembled idempotent script once per checksum and records it in `public.schema_migrations`.
3. Verify: `/api/admin/self-probe` (staff), `/api/admin/security/posture` (TOTP coverage, keys, origins).

## Rollback
- Code: `git revert <commit>` or redeploy the previous Railway deployment; every phase is tagged (`phase0-baseline` … `phase10-ui`).
- Schema: migrations are additive and idempotent (columns/tables/indexes are only added, never dropped); a code rollback never requires a schema rollback.

## Backups and restore
- Supabase: enable daily backups (Point-in-time if on Pro). `tools/backup.js` exports application tables to JSON; `tools/restore.js` restores a table set. Drill: restore into a fresh Supabase project, run `tools/migrate.js`, boot with that project's keys, run `/api/admin/self-probe`.
- Storage: bucket `documents` is private; back up with the Supabase storage export.

## Required environment (production)
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, FF_DATA_KEY, FF_SIGN_KEY, RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO, APPLY_DOMAIN, INTAKE_SECRET, LEMON_API_KEY, LEMON_STORE_ID, LEMON_WEBHOOK_SECRET, PUBLIC_URL, ALLOWED_ORIGINS, NODE_ENV=production. See ENV.md for the rest.

## Monitoring
- `/api/health` (uptime probe), ERROR_WEBHOOK_URL (errors), Admin → Self-heal (dead jobs, bulkheads), Admin → Queue, nightly audit-chain verify, subscription and outbox sweeps.

## Never in production
FF_MEMDB, FF_FAKE_AI_FILE, FF_FAKE_MAIL (all refuse when NODE_ENV=production).
