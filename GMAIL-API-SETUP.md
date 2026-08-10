# Gmail API Sending Setup — the genuine send path

Once this is done, every email PostDocX sends goes out **as your real Gmail address**.
The professor sees a normal personal email from you. No Brevo, no "via", nothing third-party.
It works on Railway because the Gmail API is HTTPS (Railway only blocks SMTP, not HTTPS).

You do this ONCE. It takes about 15 minutes.

---

## STEP 1 — Create OAuth credentials in Google Cloud (5 min)

1. Go to https://console.cloud.google.com
2. Pick your project (or create one, e.g. "PostDocX").
3. Left menu: **APIs & Services → Library**. Search **Gmail API** → click it → **Enable**.
4. Left menu: **APIs & Services → OAuth consent screen**:
   - User type: **External** → Create.
   - App name: PostDocX. User support email: your email. Developer email: your email. Save.
   - **Scopes**: skip (Save and continue).
   - **Test users**: click **Add users**, add the exact Gmail you will send from
     (e.g. `waseemkhalid225@gmail.com`). Save.
   - (You can leave the app in "Testing" mode. A test user's refresh token keeps working.)
5. Left menu: **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Name: PostDocX.
   - Under **Authorized redirect URIs**, click Add URI and paste EXACTLY:
     `https://developers.google.com/oauthplayground`
   - Create.
6. A box shows your **Client ID** and **Client secret**. Copy both, keep them safe.

---

## STEP 2 — Get your refresh token (5 min)

1. Go to https://developers.google.com/oauthplayground
2. Top right, click the **gear icon** (OAuth 2.0 configuration):
   - Tick **Use your own OAuth credentials**.
   - Paste your **Client ID** and **Client secret** from Step 1. Close the gear.
3. On the LEFT side, in the "Input your own scopes" box at the bottom, paste EXACTLY:
   `https://www.googleapis.com/auth/gmail.send`
   Then click **Authorize APIs**.
4. Google asks you to sign in — **sign in with the exact Gmail you will send from**
   (the one you added as a test user). Allow the permissions.
   (If it warns the app is unverified: click Advanced → Go to PostDocX (unsafe). This is
   your own app, it is safe.)
5. Back on the playground, click **Exchange authorization code for tokens**.
6. Copy the **Refresh token** value (long string). This is what PostDocX uses.

---

## STEP 3 — Add the three variables in Railway (2 min)

Railway → your PostDocX service → **Variables** → add these three:

    GOOGLE_OAUTH_CLIENT_ID       = (Client ID from Step 1)
    GOOGLE_OAUTH_CLIENT_SECRET   = (Client secret from Step 1)
    GOOGLE_OAUTH_REFRESH_TOKEN   = (Refresh token from Step 2)

Railway redeploys automatically when you save.

---

## STEP 4 — Verify (1 min)

1. Open PostDocX → **Admin → Autopilot health** (or Profile → AI system).
2. The Email row should now say: **"Sends as your real Gmail: youraddress@gmail.com"** ✓
3. Open any prepared case → the send panel should say ready to send via **your Gmail**.
4. Send one test outreach to yourself (put your own address as the recipient) and confirm
   it arrives looking like a normal personal email, from you, with the PDF attached.

---

## Removing Brevo (after Gmail API works)

Once Step 4 confirms Gmail sending works, Brevo is no longer used. You can:
- Leave `BREVO_API_KEY` in place as a silent fallback (harmless), OR
- Delete `BREVO_API_KEY` from Railway variables to remove it entirely.

The code always prefers the Gmail API when it is configured; Brevo is only touched if the
Gmail API is missing or errors. Nothing else needs to change.

---

## Notes and honest caveats

- The sending account = the Gmail you authorized in Step 2. If you want emails to come from
  `waseemkhalid225@gmail.com`, authorize with THAT account. If from the office account,
  authorize with that one. Whichever you sign in with in Step 2 is the "from" address.
- A copy of every sent email is BCC'd to that same address, so you keep a record
  (the Gmail API also places sent mail in your Gmail "Sent" folder automatically — so with
  this path you DO get a real Sent record, unlike Brevo).
- Refresh tokens for apps in "Testing" mode can expire if unused for 6 months; just redo
  Step 2 if that ever happens. Publishing the app (optional) removes that limit.
- Daily Gmail send limits: a normal Gmail account can send ~500 messages/day, far above
  PostDocX's caps, so this is not a constraint for your use.
