// Gmail API sending — sends as the REAL user, over HTTPS (works on Railway, no SMTP).
// The professor sees the email from the user's actual Gmail address, with nothing third-party.
// Uses a one-time OAuth refresh token the user authorizes.
const { google } = require('googleapis');

function oauthClient(userRefresh) {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GMAIL_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const refresh = userRefresh || process.env.GOOGLE_OAUTH_REFRESH_TOKEN || process.env.GMAIL_OAUTH_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  const client = new google.auth.OAuth2(id, secret, 'https://developers.google.com/oauthplayground');
  client.setCredentials({ refresh_token: refresh });
  return client;
}

function isConfigured(userRefresh) {
  return !!userRefresh || !!((process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GMAIL_OAUTH_CLIENT_ID) && (process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GMAIL_OAUTH_CLIENT_SECRET) && (process.env.GOOGLE_OAUTH_REFRESH_TOKEN || process.env.GMAIL_OAUTH_REFRESH_TOKEN));
}

// Build a raw RFC 2822 message (with attachments) and base64url encode it.
function buildRaw({ from, to, bcc, subject, text, replyTo, attachments }) {
  const boundary = 'pdx_' + Date.now().toString(36);
  const headers = [];
  if (from) headers.push('From: ' + from);
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


function normalizeAddrs(str) {
  return String(str || '')
    .split(',')
    .map(a => a.trim().replace(/^mailto:/i, '').replace(/[.,;:]+$/, '').trim())
    .filter(a => /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(a))
    .join(', ');
}

async function sendViaGmailApi({ to, subject, text, fromName, fromEmail, replyTo, bcc, attachments, authRefresh, senderAddr }) {
  to = normalizeAddrs(to);
  if (!to) throw new Error('Invalid recipient address. Remove any trailing dot or stray characters from the To field.');
  if (bcc) bcc = normalizeAddrs(bcc) || undefined;
  if (replyTo) replyTo = normalizeAddrs(replyTo) || undefined;
  const client = oauthClient(authRefresh);
  if (!client) throw new Error('Gmail API not configured (need GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN)');
  const gmail = google.gmail({ version: 'v1', auth: client });
  // gmail.send scope does not allow reading the profile, so we never ask for it.
  // Gmail automatically stamps the authenticated account as the sender; we set a
  // friendly From when we know the address, otherwise Gmail fills it in itself.
  const knownAddr = senderAddr || process.env.GMAIL_SENDER_EMAIL || process.env.GMAIL_USER || '';
  const from = knownAddr ? (fromName ? `"${fromName}" <${knownAddr}>` : knownAddr) : (fromName || '');
  const raw = buildRaw({ from, to, bcc, subject, text, replyTo, attachments });
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return { id: res.data.id, from: knownAddr || 'your Gmail' };
}

// Read the authenticated account's address (for health checks / display)
async function whoAmI(authRefresh, userAddr) {
  const client = oauthClient(authRefresh);
  if (!client) return null;
  try {
    // Refreshing an access token is permitted with only the gmail.send scope.
    // If this succeeds, the refresh token is valid and sending will work.
    const t = await client.getAccessToken();
    if (!t || !t.token) return null;
    return userAddr || process.env.GMAIL_SENDER_EMAIL || process.env.GMAIL_USER || 'connected account';
  } catch (e) { return null; }
}

module.exports = { sendViaGmailApi, isConfigured, whoAmI };
