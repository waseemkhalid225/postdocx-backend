// lib/mailer.js — Gmail SMTP sending + IMAP reply detection
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const gmailApi = require('./gmail-send');
const { simpleParser } = require('mailparser');

function transporter(creds) {
  const user = (creds && creds.user) || process.env.GMAIL_USER;
  const pass = (creds && creds.pass) || process.env.GMAIL_APP_PASSWORD;
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass },
    connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 15000
  });
}


/* ---------- HTTP fallback (Brevo) for hosts that block SMTP ports ---------- */


async function sendMail({ to, subject, text, html, fromName, attachments, creds, replyTo, bcc }) {
  // ONLY sender: the user's own Gmail via the Gmail API. Nothing third party, ever.
  if (!gmailApi.isConfigured()) {
    throw new Error('Gmail is not connected. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REFRESH_TOKEN in Railway.');
  }
  try {
    const r = await gmailApi.sendViaGmailApi({ to, subject, text, fromName, replyTo, bcc, attachments });
    return r.id;
  } catch (e) {
    const msg = String(e.message || '');
    if (/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT|Request had insufficient authentication/i.test(msg)) {
      throw new Error('Gmail refused: the token has the WRONG SCOPE. Redo the OAuth Playground with EXACTLY https://www.googleapis.com/auth/gmail.send and update GOOGLE_OAUTH_REFRESH_TOKEN.');
    }
    if (/invalid_grant/i.test(msg)) {
      throw new Error('Gmail refused: the refresh token is expired or revoked. Generate a fresh one at the OAuth Playground and update GOOGLE_OAUTH_REFRESH_TOKEN.');
    }
    throw new Error('Gmail send failed: ' + msg);
  }
}

// Check inbox for unseen replies from a list of known contact emails.
// Returns array of { from, subject } matches. Read-only intent: does not delete anything.
async function checkReplies(knownEmails, creds) {
  const user = (creds && creds.user) || process.env.GMAIL_USER;
  const pass = (creds && creds.pass) || process.env.GMAIL_APP_PASSWORD;
  if (!pass || !knownEmails.length) return [];
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user, pass }
  });
  const found = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - 7 * 86400000);
      // Search per known contact instead of scanning the whole inbox:
      // downloads only messages that are actually from supervisors we wrote to.
      for (const from of knownEmails.slice(0, 30)) {
        for await (const msg of client.fetch({ since, from }, { envelope: true, source: true })) {
          let text = '';
          try {
            const parsed = await simpleParser(msg.source);
            text = (parsed.text || '').trim().slice(0, 6000);
          } catch (e) { /* body optional */ }
          found.push({ from, subject: msg.envelope.subject || '(no subject)',
            date: (msg.envelope.date ? new Date(msg.envelope.date) : new Date()).toISOString(),
            text });
        }
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (e) { console.error('IMAP check failed:', e.message); }
  return found;
}

async function testCreds(creds) {
  try { await transporter(creds).verify(); return true; } catch (e) { return false; }
}

function withTimeout(promise, ms, label) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(label + ' timed out')), ms))]);
}

// Full diagnostic: tests sending (SMTP 465) and reading (IMAP 993) separately,
// so we can tell "wrong password" apart from "hosting provider blocks the port".
async function testEmailCreds(creds) {
  const out = { smtp: false, imap: false, smtpError: '', imapError: '' };
  try { await withTimeout(transporter(creds).verify(), 15000, 'SMTP'); out.smtp = true; }
  catch (e) { out.smtpError = String(e.message || e).slice(0, 200); }
  try {
    const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, logger: false,
      auth: { user: creds.user, pass: creds.pass } });
    await withTimeout(client.connect(), 15000, 'IMAP');
    await client.logout();
    out.imap = true;
  } catch (e) { out.imapError = String(e.message || e).slice(0, 200); }
  return out;
}

module.exports = { sendMail, checkReplies, testCreds, testEmailCreds };
