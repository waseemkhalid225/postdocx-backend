// lib/supa.js — Supabase clients: admin (service role) + per-request user auth
// Node compatibility: newer supabase-js needs a WebSocket implementation.
// On Node 22+ it is native; on anything older we polyfill with 'ws' so the
// platform can never be taken down by a runtime version again.
if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = require('ws'); } catch (e) {}
}
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
// Accept every common name for the service key, so a variable rename can never
// take the platform down again.
const serviceKey = process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_ROLE
  || process.env.SUPABASE_SECRET_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

let _admin = null;
function admin() {
  if (process.env.FF_MEMDB === '1' && process.env.NODE_ENV !== 'production') return require('./memdb').client;
  if (!_admin) {
    if (!url || !serviceKey) throw new Error('SUPABASE_URL or the service key is missing in Railway variables (accepted names: SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY)');
    _admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  return _admin;
}

// Verify a user's bearer token, return { id, email } or null
// Short-lived cache of verified tokens: auth is checked on EVERY request, so without
// this each call pays a network round-trip to the auth service.
const _tokCache = new Map();
const _crypto = require('crypto');
async function userFromToken(token) {
  if (!token) return null;
  // Key on a hash of the WHOLE token. Keying on a substring could let two distinct
  // tokens collide and return the wrong user's identity.
  const key = _crypto.createHash('sha256').update(String(token)).digest('hex');
  const hit = _tokCache.get(key);
  if (hit && Date.now() - hit.at < 30000) return hit.user;
  try {
    // Hard timeout: if the auth service is slow or unreachable, fail fast instead of
    // leaving every request hanging.
    const res = await Promise.race([
      admin().auth.getUser(token),
      new Promise(resolve => setTimeout(() => resolve({ _timeout: true }), 6000))
    ]);
    if (res && res._timeout) return null;
    const { data, error } = res || {};
    if (error || !data || !data.user) return null;
    const user = { id: data.user.id, email: data.user.email };
    _tokCache.set(key, { user, at: Date.now() });
    if (_tokCache.size > 5000) _tokCache.clear();
    return user;
  } catch (e) { return null; }
}

module.exports = { admin, userFromToken, anonKey, url };
