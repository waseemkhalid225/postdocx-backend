# ForiForeign QA/QC scripts (Day 13)
Run before every release. Each line is one check; note PASS/FAIL and the build number.

## A. Consultant day-in-the-life (30 min)
1. Create agency → invite consultant (branch Lahore) and sub-agent → sub-agent sees only own clients.
2. Create client with email of a real account → overview shows completeness, checklist, risks.
3. Run discovery from client → job appears in /api/admin/queue → stage moves to match.
4. Activate 2 cases from plan (needs active plan; without plan → 402 with clear text).
5. Record offer with 2 conditions + deadline in 3 days → alert shows; tick a condition.
6. Prepare interview → pack cites client CV facts.
7. Visa readiness for client (GB student) → documents/flags/pre-fill; refusal analysis returns structured reasons.
8. Journey plan for client → 5 phases; partner links visible where a service partner exists.
9. Analytics → funnel and per-consultant overdue correct.
10. Billing → invoice PDF opens.

## B. Student five questions (15 min)
Where am I? (journey card) · What has been done? (cases, offers) · What is waiting? (checklist, tasks) · What do I do next? (next action) · What happens next? (journey plan). Each must be answerable from the Dashboard/Profile without asking support.

## C. Edge cases (20 min)
- Visa refused → refusal analysis → reapply actions; case status refused.
- Offer declined → status declined; no further alerts.
- Finance change → funding_source updated → visa flags update on re-assess.
- Card payment cancelled → no credits; pending row stays pending; retry works.
- Webhook endpoint down → deliveries retry 5 times then dead; hook can be re-tested.
- Language Urdu → RTL; switching back restores LTR.
- Origin India → INR shown; bank transfer hidden.
- API key revoked → /api/v1/clients returns 401.

## D. Mobile matrix
Android Chrome + iOS Safari: nav at bottom, sign out visible, pay sheet scrolls, results sheet keeps analysis open during live top-up, install prompt appears, offline banner shows in airplane mode.
