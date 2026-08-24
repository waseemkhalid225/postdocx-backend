// lib/supa.js — Supabase clients: admin (service role) + per-request user auth
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

let _admin = null;
function admin() {
  if (!_admin) {
    if (!url || !serviceKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY missing in Railway variables');
    _admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  return _admin;
}

// Verify a user's bearer token, return { id, email } or null
async function userFromToken(token) {
  if (!token) return null;
  try {
    const { data, error } = await admin().auth.getUser(token);
    if (error || !data || !data.user) return null;
    return { id: data.user.id, email: data.user.email };
  } catch (e) { return null; }
}

module.exports = { admin, userFromToken, anonKey, url };
