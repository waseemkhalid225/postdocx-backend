// lib/mailer.js — Gmail SMTP sending + IMAP reply detection
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');

function transporter() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
}

async function sendMail({ to, subject, text, html, fromName, attachments }) {
  const t = transporter();
  const mail = {
    from: `"${fromName || process.env.FROM_NAME || 'PostDocX'}" <${process.env.GMAIL_USER}>`,
    to, subject, text, html
  };
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
async function checkReplies(knownEmails) {
  if (!process.env.GMAIL_APP_PASSWORD || !knownEmails.length) return [];
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
  const found = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - 7 * 86400000);
      for await (const msg of client.fetch({ seen: false, since }, { envelope: true })) {
        const from = (msg.envelope.from && msg.envelope.from[0] && msg.envelope.from[0].address || '').toLowerCase();
        if (knownEmails.includes(from)) {
          found.push({ from, subject: msg.envelope.subject || '(no subject)' });
        }
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (e) { console.error('IMAP check failed:', e.message); }
  return found;
}

module.exports = { sendMail, checkReplies };
