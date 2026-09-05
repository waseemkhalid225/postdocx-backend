# ForiForeign — environment variables (R11700)

Required: SUPABASE_URL · SUPABASE_ANON_KEY · SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE / SUPABASE_SECRET_KEY / SUPABASE_KEY) · ANTHROPIC_API_KEY · GEMINI_API_KEY · FF_DATA_KEY (32-byte key for encrypted fields) · FF_SIGN_KEY (signing packages for the assistant; falls back to FF_DATA_KEY)

Mail: RESEND_API_KEY · MAIL_FROM · MAIL_REPLY_TO · APPLY_DOMAIN (forimail.com) · INTAKE_DOMAIN (alias) · INTAKE_SECRET (Worker → /api/mail/inbound) · MAIL_EVENTS_SECRET (Resend events) · SIM_MAIL_SINK (dummy-case mail sink)

Payments: LEMON_API_KEY · LEMON_STORE_ID · LEMON_WEBHOOK_SECRET · PADDLE_API_KEY · PADDLE_CLIENT_TOKEN · PADDLE_ENV · PADDLE_WEBHOOK_SECRET · STRIPE_SECRET_KEY · STRIPE_WEBHOOK_SECRET · SAFEPAY_API_KEY · SAFEPAY_SECRET · SAFEPAY_ENV · JAZZCASH_MERCHANT_ID · JAZZCASH_INTEGRITY_SALT · EASYPAISA_STORE_ID · EASYPAISA_HASH_KEY

AI: ANTHROPIC_MODEL · OPENAI_API_KEY · OPENAI_BACKUP_MODEL · GEMINI_FALLBACK_MODEL · AI_CONCURRENCY · BRAVE_API_KEY

Discovery: ADZUNA_APP_ID · ADZUNA_APP_KEY · REED_API_KEY · USAJOBS_API_KEY · USAJOBS_EMAIL · JOOBLE_API_KEY · SCORECARD_API_KEY

Messaging: WHATSAPP_TOKEN · WHATSAPP_PHONE_ID (platform number) · ZAINAB_NOTIFY_URL

Runtime: PUBLIC_URL · ALLOWED_ORIGINS · NODE_ENV · FF_QUEUE (off to disable the job queue) · FF_LANE_MAX_RUNNING · FF_SERVE_MIN (serve index.min.html) · REDIS_URL · BROWSER_WORKER_TOKEN (headless portal worker) · ERROR_WEBHOOK_URL · APPLY_SECRET · FF_BUILD (set by the build)


## R14000 · BYOC (per-consultancy AI accounts)
- `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` now serve only direct applicants and platform staff. Consultancies connect their own keys in Team & setup → AI connection; those are encrypted with `FF_DATA_KEY` (required) into `org_ai_connections` and used exclusively for that consultancy's requests.
