# ForiForeign — Admin Runbook (Day 14)

## 1. Environment variables (Railway → Variables)
| Name | Required | What it does |
|---|---|---|
| SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY | yes | Database, auth, storage. **Never delete the service role key.** |
| ANTHROPIC_API_KEY, GEMINI_API_KEY | yes | Writing lane and discovery lane. |
| STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET | for card payments | Card checkout; webhook signature. Without them only bank transfer shows. |
| FF_DATA_KEY | recommended | 32-byte hex/base64 key; encrypts passport and national-ID numbers at rest. `/api/health/full` header `x-ff-field-encryption`. |
| FF_QUEUE | optional | `off` disables the in-process job worker (tests, one-off scripts). |

## 2. Deploy
One line (Windows): `cd /d C:\projects\postdocx-backend && git pull origin main && git rm -rf -q . && tar -xf "%USERPROFILE%\Downloads\foriforeign-full.zip" -C . && git add -A && git commit -m "Rxxxx" && git push origin main`
Then confirm `https://foriforeign.com/api/health` shows the new build. Railway keeps the previous deployment: **Rollback** = Railway → Deployments → previous → Redeploy.

## 3. Database changes
Run `ALL_MIGRATIONS_run_in_order.sql` in Supabase SQL Editor after every build that ships a new migration. The file is idempotent; re-running is safe.

## 4. Daily checks (5 minutes)
- `/api/health/full` → all lanes OK.
- Admin → Payments: pending screenshots to approve or reject.
- Admin → Visa rules: rules still marked *verify*; verify against the source.
- Admin → Support: open tickets, deletion requests (subject "Account deletion requested").
- `/api/admin/queue` (admin login): `dead` should be 0; if not, check `audit_log` events `queue:*` in Admin → Audit log.

## 5. Queue
Jobs: `client_discover`, `vault_read`, `profile_extract`, `interview_prep`, `visa_refusal`, `webhook_deliver`. Retries with exponential backoff; jobs stuck *running* for 20 minutes are re-queued automatically. To re-run a dead job: set its `status='queued'` and `attempts=0` in `job_queue`.

## 6. Payments
- Card: Stripe Dashboard → Payments. A paid session that did not credit: open Admin → Payments, find the `CARD:` row; if still pending, ask the customer to reopen the app (return page re-confirms) or check Stripe → Webhooks → deliveries for a non-200.
- Bank transfer: verify the screenshot against the bank app, then Approve (credits land immediately) or Reject with a reason (customer is told under Ask us).
- Agency plan: `org_subscriptions` rows; `cases_used` counts activations from the plan.

## 7. Seeding and content
- Visa rules: Admin → Visa rules → Seed (safe to repeat; adds only what is missing).
- Service partners: `POST /api/admin/partners` (admin token) with `{slot,name,url,whatsapp,countries,description}`.
- Packages, agency plans, payment accounts, promo: Admin → Settings; live immediately.

## 8. Incidents
1. Site down → Railway logs; rollback if the last deploy is the cause.
2. AI provider outage → discovery falls back across lanes; writing queue retries; tell customers "preparing, may take longer" via site banner (Admin → Content).
3. Stripe webhook failing → Stripe → Webhooks → resend events after the fix.
4. Data request → user can export themselves (Profile → Download all my data); deletion requests are tickets: purge with Admin → Users → dormant purge after 30 days.

## 9. Backups (see tools/backup.js)
Supabase Pro keeps daily backups / PITR — that is the primary. In addition run `node tools/backup.js` weekly (needs the service-role env) → `backups/ff-YYYY-MM-DD.json`. Restore drill: `FF_RESTORE_CONFIRM=yes node tools/restore.js backups/ff-YYYY-MM-DD.json profiles` restores one table by upsert. Test the drill monthly on a staging project.
