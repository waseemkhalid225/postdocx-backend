// lib/crypt.js — passwords, session tokens, credential encryption. Node built-ins only.
const crypto = require('crypto');

const SECRET = () => {
  const s = process.env.APP_SECRET || process.env.APPROVE_KEY;
  if (!s || s === 'change-me') console.warn('WARNING: set a strong APP_SECRET in variables');
  return crypto.createHash('sha256').update(String(s || 'dev')).digest();
};

/* ---- passwords (scrypt) ---- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}
function verifyPassword(pw, stored) {
  try {
    const [saltHex, hashHex] = String(stored).split(':');
    const hash = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64);
    return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
  } catch (e) { return false; }
}

/* ---- session tokens (HMAC, 30-day expiry) ---- */
function signToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 30 * 86400000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET()).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifyToken(token) {
  try {
    const [body, sig] = String(token).split('.');
    const expect = crypto.createHmac('sha256', SECRET()).update(body).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch (e) { return null; }
}

/* ---- credential encryption (AES-256-GCM) for per-user Gmail app passwords ---- */
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', SECRET(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return iv.toString('hex') + ':' + c.getAuthTag().toString('hex') + ':' + enc.toString('hex');
}
function decrypt(blob) {
  try {
    const [ivH, tagH, encH] = String(blob).split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', SECRET(), Buffer.from(ivH, 'hex'));
    d.setAuthTag(Buffer.from(tagH, 'hex'));
    return Buffer.concat([d.update(Buffer.from(encH, 'hex')), d.final()]).toString('utf8');
  } catch (e) { return ''; }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, encrypt, decrypt };
