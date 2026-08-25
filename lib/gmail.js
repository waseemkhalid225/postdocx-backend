// lib/gmail.js — one-click Google OAuth per user + Gmail API sending (no heavy deps)
const { admin } = require('./supa');
const { encrypt, decrypt } = require('./crypt');

const SCOPE = 'https://www.googleapis.com/auth/gmail.send';
function redirectUri() { return (process.env.BASE_URL || '').replace(/\/$/, '') + '/auth/google/callback'; }

function authStartUrl(stateToken) {
  const cid = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!cid || !process.env.BASE_URL) throw new Error('Owner setup: GOOGLE_OAUTH_CLIENT_ID and BASE_URL must be set in Railway');
  return 'https://accounts.google.com/o/oauth2/v2/auth'
    + '?client_id=' + encodeURIComponent(cid)
    + '&redirect_uri=' + encodeURIComponent(redirectUri())
    + '&response_type=code&scope=' + encodeURIComponent(SCOPE)
    + '&access_type=offline&prompt=consent'
    + '&state=' + encodeURIComponent(stateToken);
}

async function exchangeCode(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri(), grant_type: 'authorization_code'
    })
  });
  const d = await res.json();
  if (!res.ok || !d.refresh_token) throw new Error(d.error_description || 'Google returned no permanent token; remove the app at myaccount.google.com/permissions and retry');
  return d.refresh_token;
}

async function accessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, grant_type: 'refresh_token'
    })
  });
  const d = await res.json();
  if (!res.ok || !d.access_token) throw new Error(d.error_description || d.error || 'Token refresh failed');
  return d.access_token;
}

/* MIME with attachments (base64url for Gmail API) */
function buildMime({ from, bcc, to, subject, text, attachments = [] }) {
  const b = 'ff_' + Math.random().toString(36).slice(2);
  let m = '';
  m += 'From: ' + from + '\r\n';
  m += 'To: ' + to.join(', ') + '\r\n';
  if (bcc) m += 'Bcc: ' + bcc + '\r\n';
  m += 'Subject: =?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=\r\n';
  m += 'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="' + b + '"\r\n\r\n';
  m += '--' + b + '\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n' + text + '\r\n\r\n';
  for (const a of attachments) {
    m += '--' + b + '\r\nContent-Type: ' + (a.contentType || 'application/pdf') + '; name="' + a.filename + '"\r\n';
    m += 'Content-Disposition: attachment; filename="' + a.filename + '"\r\nContent-Transfer-Encoding: base64\r\n\r\n';
    m += a.content.toString('base64').replace(/(.{76})/g, '$1\r\n') + '\r\n\r\n';
  }
  m += '--' + b + '--';
  return Buffer.from(m).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendAsUser(userId, { to, subject, text, attachments }, transport) {
  const { data: p } = await admin().from('profiles').select('gmail_refresh_enc,gmail_addr,full_name').eq('id', userId).single();
  if (!p || !p.gmail_refresh_enc) throw new Error('GMAIL_NOT_CONNECTED');
  const rt = decrypt(p.gmail_refresh_enc);
  const from = p.gmail_addr || '';
  const raw = buildMime({ from: (p.full_name ? '"' + p.full_name.replace(/"/g, '') + '" <' + from + '>' : from), bcc: from, to, subject, text, attachments });
  const send = transport || (async (tok, raw2) => {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
      body: JSON.stringify({ raw: raw2 })
    });
    const d = await res.json();
    if (!res.ok) throw new Error('Gmail: ' + (d.error && d.error.message || res.status));
    return d.id;
  });
  const tok = transport ? 'test' : await accessToken(rt);
  return await send(tok, raw);
}

module.exports = { authStartUrl, exchangeCode, accessToken, sendAsUser, buildMime };
