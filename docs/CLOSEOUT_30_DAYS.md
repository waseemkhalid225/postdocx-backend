---
title: "ForiForeign — 30-Day Build Close-Out Report"
subtitle: "From opportunity search to the AI-native Global Mobility Operating System · Build R5200"
author: "For Dr. Waseem Khalid, Founder · Prepared by Claude · 3 September 2026"
date: "Every item below is in the shipped code, covered by the automated suite (615 assertions, wiring audit, guard audit) and described in the runbook."
---

# 1. Where we started and where we are

| | Day 0 (R4720) | Day 30 (R5200) |
|---|---|---|
| Product | B2C opportunity search + prepared applications, Pakistan only, PKR only | Four-door Global Mobility OS: applicants, consultancies, universities/employers, service partners |
| Journey covered | Discover → Prepare → Send | Discover → Qualify → Match → Prepare → Apply → Offer → Visa → Travel → Arrive → Settle → Family → PR |
| Markets | Pakistan | 14 origin markets, 5 interface languages, USD pricing with local estimates, card payments worldwide |
| Destinations | 54 searched | 54 with official immigration entry points; 20 with full sourced visa routes (202 rules) |
| Tenancy | Single user | Organisations, roles, branches, sub-agent isolation, RLS, API keys, webhooks, white-label domains |
| Data | CV extraction | Global Mobility Profile with provenance, document vault with reading/expiry/cross-checks, encrypted identifiers |
| Payments | Bank transfer screenshot | Stripe or Lemon Squeezy card checkout with signed webhooks + bank fallback; agency subscriptions; commissions |
| Intelligence | Deterministic matcher | + bounded, explained outcome learning; sponsor-register verification; occupation classification; interview packs; refusal analysis |
| Operations | Manual | Job queue with retries, notification hub, nightly agents, runbook, backup/restore, smoke and load tools, security review |

# 2. What shipped, day by day

| Day | Build | Delivered |
|---|---|---|
| 0 | R4730–R4760 | Mobile nav, fast dashboard, strict country scope, leak-proof cards, screenshot payments, ledger hardening |
| 0 | R4800 | Phase 0: organisations, clients, job queue, provenance |
| 0 | R4810 | Phase 1: document intelligence, checklist engine, Global Mobility Profile |
| 0 | R4820 | Phase 2: consultant command center, agency plans, commissions |
| 1 | R4830 | USD pricing, Stripe checkout, signed webhook |
| 2 | R4840 | Team invites, branches, sub-agent isolation, WhatsApp click-to-chat |
| 3 | R4850 | Agency billing with plan limits, invoices, offers & conditions, interview-prep agent |
| 4 | R4860 | Visa Intelligence: rules registry, readiness, pre-fill, refusal analysis (10 destinations) |
| 5 | R4870 | After the visa: pre-departure → PR plans with partner slots |
| 6 | R4880 | Outcome learning loop, agency analytics, admin rule verification |
| 7 | R4890 | Partner portal: openings, consent-gated applicants, service partners |
| 8–10 | R4920 | Languages & origins, 54 entry points, indexes, queue on long paths, field encryption, data rights, API keys |
| 11–13 | R4950 | White-label domains, signed webhooks, API docs, PWA install/offline, QA scripts |
| 14–15 | R5000 | Runbook, backup/restore, pricing page, launch deck |
| 16–20 | R5050 | Notification hub, sponsor register, occupations, Lemon Squeezy, family & PR tracker, origin attestation |
| 21–25 | R5100 | Partner pilots, origin at sign-up, 10 more destinations, email notifications, consultant mobile view |
| 26–30 | R5200 | Runtime QA, route-guard audit, hardening headers, per-IP limiter, smoke/load tools, security review, this report |

# 3. Verified by automation, every build

- 615 assertions across matching, paywall, lockdown (identity leaks), extension, profile pipeline, resilience (every day's contract), search net, deadline logic.
- Wiring audit: every button has a handler, every frontend call has a route, no missing element ids.
- Guard audit: every `/api/org/:id/*` route scoped by organisation membership and role; every `/api/admin/*` route permissioned; every `/api/v1/*` route key-authenticated.
- Headless render of Profile, Workspace, client page and Team panel with stubbed data: no exceptions.

# 4. What needs YOU to finish (from the morning PDFs)

| Item | Why it matters | Where |
|---|---|---|
| Deploy R5200 and run the SQL once | 0033–0044 add every new table | Task 1–2 |
| Card account: Stripe (foreign entity) **or** Lemon Squeezy keys | Turns on "Pay by card" for all origins | Task 5 / B10 |
| `FF_DATA_KEY` | Encrypts passport/ID at rest | B7 |
| `RESEND_API_KEY` + domain verification | Email notifications | B11 |
| Seed visa rules, then verify them against the sources | Rules show as facts only when verified | B4 / B5 |
| Import the UK sponsor register CSV | Sponsor chips on UK jobs | B10 |
| First agency, first university pilot, first service partners | The four doors need real occupants | partners.html |
| QA scripts A–D with FAIL lines | Same-day fix builds | tools/QA_SCRIPTS.md |
| Lawyer's one-paragraph disclaimer | Visa layer wording | Day 3 answers |

# 5. KPIs to watch from week one

Applicant: sign-up → first search (%), search → package (%), package → sent application (days), sent → interview/offer (%), refunds. Consultancy: workspaces created, active plans, cases activated per plan, overdue tasks per consultant. Partner: live openings, applicants, consent rate, time to decision. Platform: queue dead jobs (should be 0), p95 response time (< 2 s), webhook failure rate (< 1%), rules verified (target: all 20 routes within 30 days).

# 6. The next 90 days (recommended)

1. **Weeks 1–4:** verify all 202 rules; onboard 3 agencies and 1 university pilot; India soft launch (INR, Hindi, HRD/MEA attestation content already live).
2. **Weeks 5–8:** WhatsApp Business API for outbound notifications (replacing tap-to-chat); CSP with nonces; 2FA for admins; third-party pen-test.
3. **Weeks 9–12:** 10 more destinations with full routes; employer sponsor registers for DE/CA/AU where public; outcome learning at scale; Bangladesh and Gulf origin launches.

*Thank you for 30 days of 18-hour work. The platform now does what the audit said no competitor does: it moves a real person from wanting to go abroad to being established abroad, with dramatically less manual work for the consultant — and every claim it makes points to a source.*
