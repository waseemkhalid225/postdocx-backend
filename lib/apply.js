// lib/apply.js — ForiForeign Apply Assistant packages.
// Signed, short-lived, single-application payloads. No mailbox access, no stored
// email credentials, and nothing here can send an email: the user always presses
// SEND themselves inside their own email provider.
const crypto = require('crypto');

const TTL_MS = 15 * 60 * 1000; // packages and document links live 15 minutes

function secret() {
  // Reuse an existing strong server secret so no new Railway variable is required.
  const base = process.env.APPLY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || 'change-me';
  return crypto.createHash('sha256').update('ff-apply:' + base).digest();
}
function hmac(s) { return crypto.createHmac('sha256', secret()).update(s).digest('hex'); }

function buildPackage(fields) {
  const exp = Date.now() + TTL_MS;
  const core = {
    v: 1,
    applicationId: fields.applicationId,
    opportunityId: fields.opportunityId,
    recipient: fields.recipient,
    recipientName: fields.recipientName || '',
    organization: fields.organization || '',
    subject: fields.subject || '',
    body: fields.body || '',
    attachments: fields.attachments || [],
    exp
  };
  const sig = hmac(JSON.stringify(core));
  return { package: core, sig };
}

function verifyPackage(core, sig) {
  if (!core || !sig) return false;
  if (Number(core.exp) < Date.now()) return false;
  const want = hmac(JSON.stringify(core));
  try { return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(sig))); } catch (e) { return false; }
}

/* Per-document signed query: ?u=<userId>&e=<exp>&s=<sig> */
function docQuery(docId, userId) {
  const e = Date.now() + TTL_MS;
  const s = hmac(docId + '|' + userId + '|' + e);
  return 'u=' + encodeURIComponent(userId) + '&e=' + e + '&s=' + s;
}
function verifyDocQuery(docId, q) {
  const { u, e, s } = q || {};
  if (!u || !e || !s) return { ok: false };
  if (Number(e) < Date.now()) return { ok: false };
  const want = hmac(docId + '|' + u + '|' + e);
  let ok = false;
  try { ok = crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(s))); } catch (err) {}
  return { ok, userId: u };
}

function niceName(d) {
  const base = d.kind === 'cv' ? 'CV' : d.kind === 'cover' ? 'Cover Letter' : (d.title || 'Document');
  return base.replace(/[^\w \-]/g, '').slice(0, 60) + '.pdf';
}

module.exports = { buildPackage, verifyPackage, docQuery, verifyDocQuery, niceName };
