// lib/crypt.js — AES-256-GCM for per-user Gmail refresh tokens
const crypto = require('crypto');
function key() {
  const s = process.env.APP_SECRET || '';
  if (s.length < 16) throw new Error('APP_SECRET missing (any long random string) in Railway variables');
  return crypto.createHash('sha256').update(s).digest();
}
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decrypt(blob) {
  const b = Buffer.from(String(blob), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
module.exports = { encrypt, decrypt };
