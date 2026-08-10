// lib/mailer.js — Gmail SMTP sending + IMAP reply detection
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
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
async function sendViaHttp({ to, subject, text, fromName, fromEmail, replyTo, attachments }) {
  if (!process.env.BREVO_API_KEY) throw new Error('SMTP blocked and no BREVO_API_KEY set');
  // Brevo only accepts VERIFIED senders. Send from the verified office address;
  // when the mail was meant to come from a researcher's own account, set Reply-To
  // to them so the professor's reply still lands in their inbox.
  const officeSender = process.env.GMAIL_USER;
  const wanted = fromEmail || officeSender;
  const body = {
    sender: { email: officeSender, name: fromName || process.env.FROM_NAME || 'PostDocX' },
    to: [{ email: to }],
    subject, textContent: text
  };
  const reply = replyTo || (wanted !== officeSender ? wanted : '');
  if (reply) body.replyTo = { email: reply };
  if (attachments && attachments.length) {
    body.attachment = [];
    for (const a of attachments) {
      if (a.content) body.attachment.push({ name: a.filename || 'attachment', content: Buffer.from(a.content).toString('base64') });
    }
    if (!body.attachment.length) delete body.attachment;
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Brevo ' + res.status + ': ' + (await res.text()).slice(0, 150) + '. The sender address must be verified in Brevo (Senders & IPs).');
  return 'brevo';
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
    const netBlocked = /timed? ?out|ETIMEDOUT|ECONN|EHOSTUNREACH|ENETUNREACH|greeting never received/i.test(String(e.message || e));
    if (netBlocked) {
      // Host network blocks SMTP: deliver over HTTPS instead
      return sendViaHttp({ to, subject, text, fromName, fromEmail: fromAddr, replyTo, attachments });
    }
    // If an attachment failed, retry without attachments
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
