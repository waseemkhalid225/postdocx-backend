# ForiForeign server core v0.7

## v0.7 commercial redesign — what changed
- **Opportunities page** is now a two-lane commercial entry: **Study Abroad** and **Work Abroad**.
  - Study Abroad covers every level (Bachelors, Masters, PhD, Postdoc) with scholarships folded in,
    plus a **funding filter**: Fully funded / Partial / Self-finance, and country + subject search.
  - Work Abroad is a distinct green lane that names the licensing route per destination.
- **Instant search**: reads the verified `opportunities` table directly and renders immediately;
  the agent fleet keeps refreshing it in the background (unchanged cron schedule).
- **Profile document checklist**: CV, transcripts, degrees, English test, passport, licenses,
  reference letters, publications, and a catch-all — with progress bar and per-item upload.
- **Gmail one-click**: unchanged flow, verified end-to-end in code (14/14 checkpoints).
- Bug fixes: credit-pill pluralization; apostrophe-safe onclick args (escAttr); Opportunities
  nav tab resets to the lane chooser; checklist refreshes on upload/delete.

## IMPORTANT — run the migration once
Before or right after deploying v0.7, open **Supabase → SQL editor** and run
`migrations/0007_commercial_redesign.sql`. It is additive and idempotent (safe to re-run).
It adds `opportunities.funding_type` and `opportunities.level` and backfills them.
The app degrades gracefully if you forget — filters simply fall back to showing everything —
but the funding/level filters only truly work once the migration is applied.

---

# ForiForeign server core (original v0.1 notes below)

## Deploy (NEW Railway service — keep PostDocX untouched)
1. Create a NEW GitHub repo: foriforeign-backend. Upload these files (extracted, not the zip).
2. Railway -> New Service -> Deploy from that repo.
3. Variables on the NEW service:
   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY  (from Supabase)
   ANTHROPIC_API_KEY, OPENAI_API_KEY
   MODEL_NANO=gpt-5.4-nano  MODEL_MINI=gpt-5.4-mini  MODEL_SEARCH=claude-haiku-4-5-20251001  MODEL_PREMIUM=claude-sonnet-4-6
4. Open <service-url>/health -> expect {"ok":true,"v":"0.1","db":true}
   db:true proves Railway <-> Supabase connection works.

## What is inside (all tested offline)
- Supabase auth verification (frontend will use Supabase signup/login with email verification)
- Profiles (auto-created on first login), universal profile fields
- Credit ledger + balance function; payments: pending -> STAFF-ONLY confirm -> credits granted (audit-logged)
- Pricing endpoint (versioned; PKR numbers await founder pricing session)
- Opportunities read API (verified-only, full-text search ready)
- Applications: 1 credit consumed per application, duplicate-blocked, stage machine incl. awaiting_authorization (rule R4)
- Model router (rule R7): extract/classify->nano, main->mini, search_verify->haiku, high_value->sonnet; EVERY call writes ai_cost_ledger with token counts and USD cost

## Next build steps (my side, in order)
1. Frontend v0 (signup/login, profile, buy credits, browse opportunities, start application)
2. Port the proven PostDocX pipeline (discover/verify/hunt/prepare/draft/send) onto callAI() + Supabase
3. Opportunity ingestion + evidence engine for country ratings
4. R2 storage + document pipeline; retention
5. Payments UX + admin confirm dashboard
