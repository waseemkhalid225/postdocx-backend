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
