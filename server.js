// ForiForeign server core v0.1 — auth (Supabase), credits, payments, pricing, opportunities
require('dotenv').config();
const express = require('express');
const { admin, userFromToken } = require('./lib/supa');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

process.on('unhandledRejection', e => console.error('[bg]', e && e.message));
process.on('uncaughtException', e => console.error('[bg!]', e && e.message));

/* ---------- auth ---------- */
async function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  const u = await userFromToken(t);
  if (!u) return res.status(401).json({ error: 'Please sign in again' });
  req.userId = u.id; req.userEmail = u.email;
  next();
}
async function staffOnly(req, res, next) {
  const { data } = await admin().from('profiles').select('role').eq('id', req.userId).single();
  if (!data || !['staff', 'admin'].includes(data.role)) return res.status(403).json({ error: 'Staff only' });
  next();
}


/* ---------- public config for the frontend ---------- */
app.get('/api/config', (req, res) => {
  res.json({ supabaseUrl: process.env.SUPABASE_URL || '', supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '' });
});

/* ---------- health ---------- */
app.get('/health', async (req, res) => {
  let db = false;
  try { const { error } = await admin().from('app_settings').select('key').limit(1); db = !error; } catch (e) {}
  res.json({ ok: true, v: '0.1', db });
});

/* ---------- profile ---------- */
app.get('/api/me', auth, async (req, res) => {
  let { data, error } = await admin().from('profiles').select('*').eq('id', req.userId).single();
  if (error && error.code === 'PGRST116') {
    // first login: create the profile row
    const ins = await admin().from('profiles').insert({ id: req.userId, full_name: req.userEmail.split('@')[0] }).select().single();
    data = ins.data;
  }
  if (!data) return res.status(500).json({ error: 'Profile unavailable' });
  delete data.gmail_refresh_enc;
  res.json({ me: data, credits: await balance(req.userId) });
});
app.put('/api/me', auth, async (req, res) => {
  const allowed = ['full_name','phone','mode','headline','field','methods','publications','education','experience','licenses','links','send_mode'];
  const patch = {};
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
  patch.updated_at = new Date().toISOString();
  const { data, error } = await admin().from('profiles').update(patch).eq('id', req.userId).select().single();
  if (error) return res.status(400).json({ error: error.message });
  delete data.gmail_refresh_enc;
  res.json({ me: data });
});

/* ---------- credits ---------- */
async function balance(userId) {
  const { data } = await admin().rpc('credit_balance', { uid: userId });
  return typeof data === 'number' ? data : 0;
}
app.get('/api/credits', auth, async (req, res) => {
  const { data } = await admin().from('credit_ledger').select('*').eq('user_id', req.userId).order('created_at', { ascending: false }).limit(50);
  res.json({ balance: await balance(req.userId), ledger: data || [] });
});

/* ---------- pricing & payments (server-confirmed rule) ---------- */
app.get('/api/pricing', async (req, res) => {
  const { data } = await admin().from('pricing').select('*').eq('active', true).single();
  res.json({ pricing: data });
});
app.post('/api/payments', auth, async (req, res) => {
  const { credits, reference } = req.body || {};
  const { data: pr } = await admin().from('pricing').select('*').eq('active', true).single();
  const pack = ((pr || {}).packs || []).find(p => p.credits === Number(credits));
  if (!pack) return res.status(400).json({ error: 'Choose a valid credit pack' });
  const { data, error } = await admin().from('payments').insert({
    user_id: req.userId, amount_pkr: pack.pkr, credits: pack.credits,
    reference: String(reference || '').slice(0, 120), pricing_version: pr.version
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ payment: data, note: 'Pending. Credits appear after staff confirms your bank transfer.' });
});
app.post('/api/payments/:id/confirm', auth, staffOnly, async (req, res) => {
  const { data: p } = await admin().from('payments').select('*').eq('id', req.params.id).single();
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.status !== 'pending') return res.status(400).json({ error: 'Already ' + p.status });
  await admin().from('payments').update({ status: 'confirmed', confirmed_by: req.userId, confirmed_at: new Date().toISOString() }).eq('id', p.id);
  await admin().from('credit_ledger').insert({ user_id: p.user_id, delta: p.credits, reason: 'purchase', payment_id: p.id });
  await admin().from('audit_log').insert({ actor: req.userId, event: 'PAYMENT_CONFIRMED', detail: p.id + ' +' + p.credits + 'cr' });
  res.json({ ok: true });
});

/* ---------- public data ---------- */
app.get('/api/countries', async (req, res) => {
  const { data } = await admin().from('countries').select('*').order('name');
  res.json({ countries: data || [] });
});
app.get('/api/opportunities', auth, async (req, res) => {
  const kind = String(req.query.kind || 'study');
  const q = String(req.query.q || '').trim();
  let query = admin().from('opportunities').select('*').eq('status', 'verified').eq('kind', kind).order('deadline', { ascending: true }).limit(40);
  if (q) query = query.textSearch('search_blob', q.split(/\s+/).join(' & '));
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ opportunities: data || [] });
});

/* ---------- applications: 1 credit = 1 application (consume on create) ---------- */
app.post('/api/applications', auth, async (req, res) => {
  const { opportunityId } = req.body || {};
  const bal = await balance(req.userId);
  if (bal < 1) return res.status(402).json({ error: 'No credits. Buy a pack to start this application.' });
  const { data: opp } = await admin().from('opportunities').select('id,institution').eq('id', opportunityId).single();
  if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
  const caseNo = 'FF-' + Date.now().toString(36).toUpperCase();
  const { data: appRow, error } = await admin().from('applications')
    .insert({ user_id: req.userId, opportunity_id: opp.id, case_no: caseNo, stage: 'preparing', credits_consumed: 1 })
    .select().single();
  if (error) return res.status(400).json({ error: error.message.includes('duplicate') ? 'You already have an application for this opportunity' : error.message });
  await admin().from('credit_ledger').insert({ user_id: req.userId, delta: -1, reason: 'consume', application_id: appRow.id, note: opp.institution });
  res.json({ application: appRow });
});
app.get('/api/applications', auth, async (req, res) => {
  const { data } = await admin().from('applications').select('*, opportunities(title,institution,country_code,deadline,url)').eq('user_id', req.userId).order('updated_at', { ascending: false });
  res.json({ applications: data || [] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('ForiForeign core on :' + PORT));
