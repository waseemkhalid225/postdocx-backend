// Gmail API sending — sends as the REAL user, over HTTPS (works on Railway, no SMTP).
// The professor sees the email from the user's actual Gmail address, with nothing third-party.
// Uses a one-time OAuth refresh token the user authorizes.
const { google } = require('googleapis');

function oauthClient() {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GMAIL_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const refresh = process.env.GOOGLE_OAUTH_REFRESH_TOKEN || process.env.GMAIL_OAUTH_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  const client = new google.auth.OAuth2(id, secret, 'https://developers.google.com/oauthplayground');
  client.setCredentials({ refresh_token: refresh });
  return client;
}

function isConfigured() {
  return !!((process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GMAIL_OAUTH_CLIENT_ID) && (process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GMAIL_OAUTH_CLIENT_SECRET) && (process.env.GOOGLE_OAUTH_REFRESH_TOKEN || process.env.GMAIL_OAUTH_REFRESH_TOKEN));
}

// Build a raw RFC 2822 message (with attachments) and base64url encode it.
function buildRaw({ from, to, bcc, subject, text, replyTo, attachments }) {
  const boundary = 'pdx_' + Date.now().toString(36);
  const headers = [];
  headers.push('From: ' + from);
  headers.push('To: ' + to);
  if (bcc) headers.push('Bcc: ' + bcc);
  if (replyTo) headers.push('Reply-To: ' + replyTo);
  headers.push('Subject: ' + encodeHeader(subject));
  headers.push('MIME-Version: 1.0');

  let body;
  if (attachments && attachments.length) {
    headers.push('Content-Type: multipart/mixed; boundary="' + boundary + '"');
    const parts = [];
    parts.push('--' + boundary);
    parts.push('Content-Type: text/plain; charset="UTF-8"');
    parts.push('Content-Transfer-Encoding: 7bit');
    parts.push('');
    parts.push(text);
    for (const a of attachments) {
      const content = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content || '');
      parts.push('--' + boundary);
      parts.push('Content-Type: ' + (a.contentType || 'application/pdf') + '; name="' + (a.filename || 'attachment.pdf') + '"');
      parts.push('Content-Transfer-Encoding: base64');
      parts.push('Content-Disposition: attachment; filename="' + (a.filename || 'attachment.pdf') + '"');
      parts.push('');
      parts.push(content.toString('base64').replace(/(.{76})/g, '$1\n'));
    }
    parts.push('--' + boundary + '--');
    body = headers.join('\r\n') + '\r\n\r\n' + parts.join('\r\n');
  } else {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    body = headers.join('\r\n') + '\r\n\r\n' + text;
  }
  return Buffer.from(body).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeHeader(s) {
  // RFC 2047 for non-ASCII subjects
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return '=?UTF-8?B?' + Buffer.from(s).toString('base64') + '?=';
}

async function sendViaGmailApi({ to, subject, text, fromName, fromEmail, replyTo, bcc, attachments }) {
  const client = oauthClient();
  if (!client) throw new Error('Gmail API not configured (need GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN)');
  const gmail = google.gmail({ version: 'v1', auth: client });
  // The authenticated account's own address is the real sender.
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const realAddr = profile.data.emailAddress;
  const from = fromName ? `"${fromName}" <${realAddr}>` : realAddr;
  const raw = buildRaw({ from, to, bcc, subject, text, replyTo, attachments });
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return { id: res.data.id, from: realAddr };
}

// Read the authenticated account's address (for health checks / display)
async function whoAmI() {
  const client = oauthClient();
  if (!client) return null;
  try {
    const gmail = google.gmail({ version: 'v1', auth: client });
    const p = await gmail.users.getProfile({ userId: 'me' });
    return p.data.emailAddress;
  } catch (e) { return null; }
}

module.exports = { sendViaGmailApi, isConfigured, whoAmI };
