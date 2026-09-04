// lib/crypto.js — Day 10 · field-level encryption for the identifiers a breach would hurt most.
// AES-256-GCM with a key from FF_DATA_KEY (32 bytes, base64 or hex). Without the key the
// platform still works and /api/health reports "field encryption: off" so it is never silent.
const crypto = require('crypto');
function key() { const k = process.env.FF_DATA_KEY || ''; if (!k) return null; const b = /^[0-9a-f]{64}$/i.test(k) ? Buffer.from(k, 'hex') : Buffer.from(k, 'base64'); return b.length === 32 ? b : null; }
function enabled() { return !!key(); }
function encrypt(text) { const k = key(); if (!k || text == null || text === '') return null; const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', k, iv); const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]); return 'v1.' + iv.toString('base64') + '.' + c.getAuthTag().toString('base64') + '.' + enc.toString('base64'); }
function decrypt(blob) { const k = key(); if (!k || !blob || typeof blob !== 'string' || !blob.startsWith('v1.')) return null; try { const [, iv, tag, enc] = blob.split('.'); const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64')); d.setAuthTag(Buffer.from(tag, 'base64')); return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8'); } catch (e) { return null; } }
function mask(v) { const s = String(v || ''); if (s.length <= 4) return s ? '••••' : ''; return '•'.repeat(Math.max(0, s.length - 4)) + s.slice(-4); }
const SENSITIVE_FIELDS = ['passport_number', 'cnic'];
module.exports = { enabled, encrypt, decrypt, mask, SENSITIVE_FIELDS };
