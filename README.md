# ForiForeign server core v0.7

## Profile Intelligence — ALL PHASES COMPLETE
Deploy order: push code, then run the two new migrations in the Supabase SQL editor.

### Migrations to run (Supabase SQL editor), in order:
1. `migrations/0007_commercial_redesign.sql`  (funding_type + level filters)
2. `migrations/0008_profile_fields.sql`       (Phase 2: per-field provenance table)
3. `migrations/0009_eligibility_criteria.sql` (Phase 3: opportunity criteria columns)
All three are additive and idempotent — safe to run once, no-ops if re-run.

### Phase 1 — Profile-first dashboard (no migration)
Home is the readiness dashboard: weighted % (70% required / 30% optional), section
status (verified/provided/required/recommended), ordered next actions. Review-before-save
over autofill via `/api/profile/autofill/preview` + `/api/profile/autofill/apply`.

### Phase 2 — Per-field provenance + cross-document verification (migration 0008)
`lib/provenance.js` extracts each document individually, tracks a canonical field set
(name, DOB, CGPA, degree, English, passport, etc.), and marks each field:
- `verified`   — same value seen in 2+ documents
- `conflicting`— documents disagree; user resolves in the Profile "verification" panel
- `extracted`  — one source, unconfirmed
- `provided`   — user typed/confirmed it
Endpoints: `/api/profile/fields`, `/api/profile/verify`, `/api/profile/fields/:key/resolve`.
UI: source attribution per field + one-tap conflict resolution.

### Phase 3 — Structured eligibility criteria (migration 0009)
The discovery agent (`lib/engine.js`) extracts criteria at discovery time, ONLY where
literally stated on the official page: degree level, field, min CGPA (+scale), language
(+min), nationality, experience years, license route, required documents. Unstated => NULL.

### Phase 4 — Matching + "Why You Match" (no migration; computed live)
`lib/match.js` scores each opportunity ONLY over criteria that are actually stated
(pct = met / stated). Unknowns count as neither pass nor fail. Verdicts: eligible /
potentially_eligible / not_eligible / criteria_not_published. Browse lanes request
`?match=1`; each card shows a badge and a "Why you match" breakdown with per-line reasons.

### Honesty guarantee (spec item 12)
Nothing is invented. A field exists only if a document or the user provided it; a match %
is computed only from stated criteria; an opportunity with no published criteria shows
"criteria not published" rather than a fabricated score.



## Profile Intelligence — ALL PHASES SHIPPED
Deploy order matters. Run the three migrations in the Supabase SQL editor in this order,
then deploy the code. All migrations are additive and idempotent (safe to re-run).

1. `migrations/0007_commercial_redesign.sql`  — funding_type + level (Opportunities filters)
2. `migrations/0008_profile_fields.sql`        — profile_fields table (per-field provenance)
3. `migrations/0009_eligibility_criteria.sql`  — eligibility criteria columns on opportunities

**Phase 1 — Profile-first dashboard.** Home is the Career & Study Profile dashboard:
readiness % (weighted 70/30 required/optional), section status (verified/provided/required/
recommended), ordered recommended actions. Review-before-save over autofill: preview extracted
fields, tick/untick, nothing saved until confirmed.
Endpoints: `/api/profile/readiness`, `/api/profile/autofill/preview`, `/api/profile/autofill/apply`.

**Phase 2 — Per-field provenance + cross-document verification.** `lib/provenance.js` reads each
document separately, tracks which document each fact came from, then merges: facts agreed across
2+ documents become `verified`; disagreements become `conflicting` and the user resolves them in
Profile → Verified information. Requires migration 0008.
Endpoints: `/api/profile/fields`, `/api/profile/verify`, `/api/profile/fields/:key/resolve`.

**Phase 3 — Structured eligibility criteria.** The discovery agent (`lib/engine.js`) now extracts
degree level, min CGPA (+scale), language + min, nationality, experience years, license route, and
required documents — ONLY where literally stated on the official page. Unstated → NULL. Requires
migration 0009. Backward compatible: if migrations aren't run, discovery strips the new fields and
still inserts opportunities.

**Phase 4 — Matching engine + Why You Match.** `lib/match.js` compares the user's verified profile
against each opportunity's stated criteria → Eligible / Potentially eligible / Not eligible /
Criteria not published, with per-line reasons. Browse cards show a match badge (`?match=1`); the
"Why you match" button opens the full breakdown.
Endpoint: `/api/opportunities/:id/match`.

### Honesty guarantees (enforced in code, unit-tested)
- A criterion the opportunity did not publish is "not specified" — never a satisfied pass.
- A criterion the user has no data for is "unknown" (?) — never assumed met, never counted in the %.
- The match % is `met / stated` over only the criteria that were actually published AND checkable.
- Provenance stores every value with its source document; nothing is written that wasn't read from a file.



## Profile Intelligence — phased roadmap
**Phase 1 (shipped in this build):** Profile-first dashboard.
- Home is now the Career & Study Profile dashboard: readiness % (weighted 70% required / 30% optional),
  section status (verified / provided / required / recommended), and ordered "recommended next" actions.
- Review-before-save: after the agent reads your documents, "Review extracted info" shows every
  proposed field with tick/untick, and nothing is written until you confirm. New endpoints:
  `/api/profile/readiness`, `/api/profile/autofill/preview`, `/api/profile/autofill/apply`.
- No schema change for Phase 1. Honest by construction: a section counts as complete only if the
  underlying data actually exists; nothing is inferred or invented.

**Phase 2 (next):** Per-field provenance + cross-document verification.
- New `profile_fields` table (value, source document id, status: extracted/verified/conflicting/provided).
- When two documents agree a field is `verified`; when they disagree it's `conflicting` and you resolve it.

**Phase 3:** Structured eligibility criteria on opportunities.
- Criteria columns (degree level, min CGPA, field, language min, nationality, deadline), extracted by the
  discovery agent at discovery time — only where literally stated on the official page (unstated => null).

**Phase 4:** Matching engine + "Why You Match".
- Computes Eligible / Potentially / Missing / Not eligible from stored facts, with per-line reasons.
  The match % is real because it is derived from Phase 2–3 data, never fabricated; unknown criteria
  render as "not specified" rather than a satisfied requirement.



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
   GEMINI_API_KEY            # Google AI Studio key (ForiForeign project), server-side only
   GEMINI_MODEL=gemini-3.7-flash   # optional override; defaults to gemini-3.7-flash
4. Open <service-url>/health -> expect {"ok":true,"v":"0.1","db":true}
   db:true proves Railway <-> Supabase connection works.

## What is inside (all tested offline)
- Supabase auth verification (frontend will use Supabase signup/login with email verification)
- Profiles (auto-created on first login), universal profile fields
- Credit ledger + balance function; payments: pending -> STAFF-ONLY confirm -> credits granted (audit-logged)
- Pricing endpoint (versioned; PKR numbers await founder pricing session)
- Opportunities read API (verified-only, full-text search ready)
- Applications: 1 credit consumed per application, duplicate-blocked, stage machine incl. awaiting_authorization (rule R4)
- Model router: single model (Gemini 3.7 Flash) with thinking levels — extract/classify=low, main/doc_extract/search_verify=medium, high_value=high; EVERY call writes ai_cost_ledger with token counts and USD cost

## Next build steps (my side, in order)
1. Frontend v0 (signup/login, profile, buy credits, browse opportunities, start application)
2. Port the proven PostDocX pipeline (discover/verify/hunt/prepare/draft/send) onto callAI() + Supabase
3. Opportunity ingestion + evidence engine for country ratings
4. R2 storage + document pipeline; retention
5. Payments UX + admin confirm dashboard
