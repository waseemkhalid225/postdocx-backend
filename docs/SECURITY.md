# ForiForeign — Security review (Day 29)

## Threat model
Assets: applicant identity documents and identifiers, payment records, agency client lists, partner applicant data, visa rules integrity. Adversaries: account takeover, a member of one organisation reading another's data, scraping, webhook/payment forgery, an AI provider outage or prompt injection through uploaded documents.

## Controls in place
| Area | Control |
|---|---|
| Authentication | Supabase Auth (email/password, Google); bearer tokens; short-lived signed URLs for files; `?t=` token accepted only for invoice PDF and self-export downloads. |
| Authorisation | Platform roles (user/staff/content_admin/admin/super_admin) with a permission map; owner-level powers (bypass, plan grants, settings) restricted to admin/super_admin. Organisation roles (owner/manager/consultant/sub_agent/viewer); **every `/api/org/:id/*` route passes `requireOrg`/`orgClient`**, which also applies branch and sub-agent scope on the query (automated test). Every `/api/admin/*` route passes `perm()` (two audited exceptions use `staffOnly` or an explicit role check). API keys hashed (SHA-256), shown once, revocable, read-only scopes. |
| Tenant isolation | Row-level security on every organisation table (members read their org only; owners for keys/domains/webhooks); server uses the service role, so RLS is the second wall. |
| Data at rest | Supabase encryption at rest; passport and national-ID numbers additionally AES-256-GCM encrypted with `FF_DATA_KEY` and displayed masked; confidential documents (bank statements, visa papers) stored only with explicit consent. |
| Payments | Stripe / Lemon Squeezy webhooks verified by HMAC with timestamp tolerance; raw body parsed before JSON; settlement idempotent per payment (status flip guarded); credits written through one ledger function; commissions accrue once per payment. |
| Webhooks out | HMAC-SHA256 signature, https only, retries with backoff, dead-letter after 5. |
| Abuse | Per-user AI action limiter; per-IP limiter on unauthenticated endpoints; upload size/type limits; identity scrub on locked cards; rate limit on API keys (600/h documented). |
| Headers | HSTS, nosniff, frame-options SAMEORIGIN, referrer policy, permissions policy, response-time header. |
| AI safety | Document reader never invents values; visa rules only from the registry with sources; refusal analysis says when licensed advice is required; learning nudge bounded ±4 and explained; prompts receive minimal, scrubbed context. |
| Data rights | Self-service export (JSON), deletion request with audit + ticket, retention dates on documents, consent flags. |
| Audit | `audit_log` on payments, grants, org events, pilots, deletions, queue failures. |

## Pending / recommended
- Content-Security-Policy (the client is a single inline-script page; needs a nonce build step).
- 2FA for owner and admin accounts (Supabase MFA), and IP allow-list for the admin tab.
- Secrets rotation schedule (quarterly) for API keys and webhook secrets.
- Pen-test by a third party before the India launch.
