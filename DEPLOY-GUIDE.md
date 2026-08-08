# PostDocX Backend — Easy Deployment Guide (Railway)

The same pattern as Zainab: Node.js on Railway + Google Sheets. About 30 minutes, one time.

## How it works (in one paragraph)

Every day at 6:00 AM and 6:00 PM Pakistan time, the agent wakes up and runs the full cycle: checks your Gmail inbox for professor replies → searches the web for new real postdoc openings for each researcher → verifies each one against its original institutional page → drafts personalized outreach emails for verified matches scoring 80+ → sends them (auto mode) or queues them for your one-tap approval (approval mode) → sends courteous follow-ups after 8 days → emails you a daily report with everything, including Approve/Reject links you tap from your phone. All records live in one Google Sheet.

## STEP 1 — Create the Google Sheet database (5 min)

1. Go to sheets.google.com → create a blank sheet → name it **PostDocX**
2. Copy the long ID from the URL (between `/d/` and `/edit`) → this is your `SHEET_ID`
3. Leave the sheet empty — the backend creates all tabs and columns automatically on first run

## STEP 2 — Create a Google Service Account (8 min, one time)

1. Go to console.cloud.google.com → create a project (name: PostDocX)
2. Search "Google Sheets API" → click **Enable**
3. Menu → IAM & Admin → **Service Accounts** → Create service account (name: postdocx) → Done
4. Click the new account → **Keys** tab → Add key → Create new key → **JSON** → a file downloads
5. Open that JSON file in Notepad. You need two values:
   - `client_email` → this is `GOOGLE_SERVICE_EMAIL`
   - `private_key` → this is `GOOGLE_PRIVATE_KEY` (copy the whole thing including BEGIN/END lines, keep the \n characters exactly as they are)
6. Back in your Google Sheet → **Share** → paste the service account email → give **Editor** access

## STEP 3 — Gmail App Password (3 min)

1. Go to myaccount.google.com → Security → make sure **2-Step Verification** is ON
2. Search "App passwords" in the account search bar → create one (app: Mail, name: PostDocX)
3. Copy the 16-character password → this is `GMAIL_APP_PASSWORD`

This lets the backend send from your Gmail and read your inbox for replies. It never deletes anything.

## STEP 4 — Anthropic API key (2 min)

1. Go to console.anthropic.com → API Keys → Create key → copy it → `ANTHROPIC_API_KEY`
2. Add a small credit balance (the daily cycle typically costs well under $1/day at default caps)

## STEP 5 — Deploy on Railway (8 min)

1. Push this folder to a GitHub repo (or use Railway's "Deploy from local" via CLI)
   - GitHub web method: github.com → New repository → "postdocx-backend" → upload all files from this folder
2. railway.app → New Project → **Deploy from GitHub repo** → select postdocx-backend
3. Open the service → **Variables** tab → add every variable from `.env.example` with your real values
   - For `APPROVE_KEY`: type any long random text (this protects your approve/reject links)
   - For `BASE_URL`: after Railway gives you a domain (Settings → Networking → Generate Domain), paste it here
4. Railway auto-deploys. Check **Deployments → Logs** — you should see:
   `PostDocX backend on :3000 | mode=approval | tz=Asia/Karachi`

## STEP 6 — Add your researchers (3 min)

Open the Google Sheet → **Researchers** tab (created automatically after the first run — or trigger it now, see Step 7). Add one row per researcher:

| id | name | title | email | field | methods | pubs | prefs | links | active |
|----|------|-------|-------|-------|---------|------|-------|-------|--------|
| waseem | Dr. Waseem Abbas | Pharm-D, MPhil (Gold Medal), PhD Pharmacology | you@gmail.com | Cardiovascular & thrombosis pharmacology; computational drug discovery | Molecular docking (AutoDock Vina), pharmacovigilance (VigiFlow, aDSM), drug repurposing, regulatory science | First-author JPET 2025; IJP 2025 | Fully funded preferred; couple placement valued | ORCID/Scholar links | yes |
| sehrish | Dr. Sehrish Abbas | Assistant Professor of Biotechnology | ... | Polymer-encapsulated antibiotic nanocomposites; biomaterials | Nanomaterial synthesis, antimicrobial assays, drug-eluting coatings | ... | Fully funded or hostable; couple placement valued | ... | yes |

## STEP 7 — Test it

Open in your browser (replace with your domain and key):

```
https://your-app.up.railway.app/run?key=YOUR_APPROVE_KEY
```

Within 3–8 minutes you'll receive the first daily report email. From then on it runs automatically at 6 AM and 6 PM.

Other useful links:
- `/health` — is it alive
- `/status?key=...` — pipeline counts
- `/run?key=...` — run a cycle right now

## Couple placement (new)

In the **Researchers** sheet, put each partner's id in the other's `partnerId` column (waseem ↔ sehrish). The daily cycle then also runs a couple search: same university, same institute, same city, or one funded role plus one hostable route nearby. Paired finds share a `coupleKey` in Opportunities and appear in the daily report under "Couple placement scenarios". The rule from your architecture applies: a pairing is never forced at the cost of either researcher's genuine fit.

In the PostDocX web app, open Researchers → Edit profile → Partner, and the link is set both ways automatically.

## Research concept notes (new)

For any opportunity, open:

```
https://your-app.up.railway.app/proposal/OPPORTUNITY_ID?key=YOUR_KEY
```

(The opportunity id is in column A of the Opportunities sheet.) The agent studies the PI's last three years of work and writes a 700 to 900 word concept note in plain, natural academic prose: no dashes, no formulaic AI phrasing, structured as Background and rationale, Hypothesis and aims, Approach, Expected outcomes and impact, Fit and feasibility. It is emailed to you and saved in the **Proposals** tab. Treat it as a strong first draft: read it, edit it, and make it yours before sending. You are the author, and PIs can tell when an applicant actually owns the ideas.

## Connect the web app dashboard (new)

In the PostDocX web app → Settings, paste your Railway `BASE_URL` and your `APPROVE_KEY`, save, then tap **Sync backend** on the Dashboard. Everything the agent found overnight flows into your app, matched to researchers by name and deduplicated. Pending approvals and new replies show in the sync summary.

## Switching between Approval and Auto mode

- `SEND_MODE=approval` (recommended): every email waits for you. The daily report contains one-tap **Approve** / **Reject** links. Approved drafts go out in the next cycle (or tap /run to send immediately).
- `SEND_MODE=auto`: verified, high-match outreach (score ≥ 80) and follow-ups send automatically, capped at `MAX_EMAILS_PER_DAY` (default 5).

Change the variable in Railway and it redeploys in ~1 minute.

## Built-in safety rules (always on, both modes)

- Never contacts anything that failed verification against its original institutional source
- Never guesses email addresses — only publicly listed ones; otherwise the draft waits in Outbox with status NO_EMAIL for you to fill in
- Duplicate key (researcher + institution + title) blocks repeat contact forever
- Hard daily send cap; maximum 2 follow-ups per contact, minimum 8 days apart, stops the moment a reply is detected
- Researchers' profiles never mix; drafts use only real profile facts
- Everything is logged in the Sheet's Log tab

## Everything the agent now does

Daily 6 AM (full cycle): reply detection → discovery per researcher (with PI grant-momentum flag and visa note per country) → couple co-location search for linked partners → verification against primary sources → outreach drafting for verified 80+ matches (learns from subject lines that earned replies, attaches your CV if you marked one for attaching) → send or queue for approval → follow-ups → referee reminders when a deadline is within 12 days → fellowship calendar alerts (MSCA, Humboldt, EMBO, HFSP, Newton, JSPS, Banting, KAUST and more, warned 3 months ahead) → daily report.

Daily 6 PM (light cycle, near-zero cost): sends anything you approved during the day, checks for replies, follow-ups. Emails you only if something happened.

Sunday 9 AM: weekly strategy review in your inbox: reply-rate analysis, which region is converting, rejection patterns, one publication move per researcher for the next 90 days, and the single most important action for the coming week.

On demand, from any browser (replace ID and key):

| What | Link |
|---|---|
| Run full cycle now | `/run?key=KEY` |
| Research concept note for an opportunity | `/proposal/OPP_ID?key=KEY` |
| Interview briefing (lab study, pitch, likely questions, funding narrative) | `/interview/OPP_ID?key=KEY` |
| Two-body couple dossier | `/couple-dossier/OPP_ID?key=KEY` |
| Draft reference-request emails for a researcher | `/referees/RESEARCHER_ID?key=KEY` |
| Weekly review now | `/weekly?key=KEY` |
| Pipeline status | `/status?key=KEY` |

All generated documents land in the **Proposals** tab and in your email.

## Documents and referees

- **Documents tab** (also in the web app, Researchers → Documents): file every item per researcher: CV, research statement, degree certificates, transcripts, publication PDFs, reference letters, passport/ID. Paste Google Drive share links. Set `attach` to `yes` on the CV row (with a direct-download link) and the agent attaches it to outreach emails automatically. The web app shows an application-readiness percentage and warns about anything missing.
- **Referees tab**: name, email, relationship, status per referee. `/referees/RESEARCHER_ID?key=KEY` drafts warm request emails into the Outbox (approval flow applies). When any verified opportunity's deadline comes within 12 days, the daily report reminds you exactly whom to chase.

## Performance, security and cost (verified before shipping)

Tested before packaging: all endpoints return 403 on a wrong key (constant-time comparison, no timing leaks), rate limiting kicks in at 60 requests/minute, security headers set, and secrets are only ever read from environment variables, never written to the Sheet or logs.

Cost control: web searches are capped at 5 per reasoning call, discovery/verification/sending all have hard caps you control in Variables, the evening cycle skips all discovery, and the weekly review uses no search at all. At default caps, a typical month runs on a few dollars of API credit; you can halve it again by setting `MAX_DISCOVER_PER_RESEARCHER=3` and `MAX_VERIFY_PER_RUN=4`. Railway's hobby tier covers the server itself.

## My honest recommendation

Run in **approval mode for the first 2–3 weeks**. You'll see the draft quality, tap-approve the good ones in ten seconds from your phone, and reject anything off. Once you trust the pattern, flip to auto if you want — but for first contact with professors, a 10-second human glance measurably improves quality and protects your academic reputation. Application portal submissions and anything legally binding should always stay manual.
