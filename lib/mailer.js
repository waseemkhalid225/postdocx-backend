// lib/mailer.js — Gmail SMTP sending + IMAP reply detection
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

function transporter(creds) {
  const user = (creds && creds.user) || process.env.GMAIL_USER;
  const pass = (creds && creds.pass) || process.env.GMAIL_APP_PASSWORD;
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass }
  });
}

async function sendMail({ to, subject, text, html, fromName, attachments, creds, replyTo }) {
  const t = transporter(creds);
  const fromAddr = (creds && creds.user) || process.env.GMAIL_USER;
  const mail = {
    from: `"${fromName || process.env.FROM_NAME || 'PostDocX'}" <${fromAddr}>`,
    to, subject, text, html
  };
  if (replyTo) mail.replyTo = replyTo;
  if (attachments && attachments.length) mail.attachments = attachments;
  try { return (await t.sendMail(mail)).messageId; }
  catch (e) {
    // If an attachment URL fails to fetch, fall back to sending without attachments
    if (mail.attachments) { delete mail.attachments; return (await t.sendMail(mail)).messageId; }
    throw e;
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
      for await (const msg of client.fetch({ since }, { envelope: true, source: true })) {
        const from = (msg.envelope.from && msg.envelope.from[0] && msg.envelope.from[0].address || '').toLowerCase();
        if (!knownEmails.includes(from)) continue;
        let text = '';
        try {
          const parsed = await simpleParser(msg.source);
          text = (parsed.text || '').trim().slice(0, 6000);
        } catch (e) { /* body optional */ }
        found.push({ from, subject: msg.envelope.subject || '(no subject)',
          date: (msg.envelope.date ? new Date(msg.envelope.date) : new Date()).toISOString(),
          text });
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (e) { console.error('IMAP check failed:', e.message); }
  return found;
}

async function testCreds(creds) {
  try { await transporter(creds).verify(); return true; } catch (e) { return false; }
}
module.exports = { sendMail, checkReplies, testCreds };
