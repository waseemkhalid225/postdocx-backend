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
  res.json({ ok: true, v: '0.7', db });
});

/* ---------- profile ---------- */
app.get('/api/me', auth, async (req, res) => {
  let { data, error } = await admin().from('profiles').select('*').eq('id', req.userId).single();
  if (error && error.code === 'PGRST116') {
    // first login: create the profile row
    const isFounder = (req.userEmail || '').toLowerCase() === (process.env.ADMIN_EMAIL || 'waseemkhalid225@gmail.com').toLowerCase();
    const ins = await admin().from('profiles').insert({ id: req.userId, full_name: req.userEmail.split('@')[0], role: isFounder ? 'admin' : 'user' }).select().single();
    if (isFounder) await admin().from('credit_ledger').insert({ user_id: req.userId, delta: 999, reason: 'grant', note: 'Founder account' });
    data = ins.data;
  }
  if (!data) return res.status(500).json({ error: 'Profile unavailable' });
  delete data.gmail_refresh_enc;
  res.json({ me: data, credits: await balance(req.userId) });
});
app.put('/api/me', auth, async (req, res) => {
  const allowed = ['full_name','phone','mode','headline','field','methods','publications','education','experience','licenses','links','send_mode','annual_budget_pkr','funded_only','profession'];
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
  // 'study' is the umbrella for browsing academic routes; when the caller asks for
  // study we include scholarship + postdoc so the Study Abroad page shows every level.
  const studyKinds = ['study', 'scholarship', 'postdoc'];
  let query = admin().from('opportunities').select('*').eq('status', 'verified')
    .order('deadline', { ascending: true }).limit(60);
  if (kind === 'study') query = query.in('kind', studyKinds);
  else query = query.eq('kind', kind);
  if (req.query.country) query = query.eq('country_code', String(req.query.country).toUpperCase());
  // funding filter: fully | partial | self. Unknown (null) rows are shown unless a
  // strict filter is requested, so instant browsing is never empty by accident.
  const ft = String(req.query.funding_type || '').trim();
  if (['fully', 'partial', 'self'].includes(ft)) query = query.eq('funding_type', ft);
  // level filter for the BS -> Postdoc control
  const lvl = String(req.query.level || '').trim();
  if (['bachelors', 'masters', 'phd', 'postdoc'].includes(lvl)) query = query.eq('level', lvl);
  if (q) query = query.textSearch('search_blob', q.split(/\s+/).join(' & '));
  let { data, error } = await query;
  // Graceful fallback: if funding_type / level columns don't exist yet (migration not
  // run), Postgres returns 42703. Retry without those filters so search still works.
  if (error && /funding_type|level|column/.test(error.message || '') && (ft || lvl)) {
    let q2 = admin().from('opportunities').select('*').eq('status', 'verified')
      .order('deadline', { ascending: true }).limit(60);
    if (kind === 'study') q2 = q2.in('kind', studyKinds); else q2 = q2.eq('kind', kind);
    if (req.query.country) q2 = q2.eq('country_code', String(req.query.country).toUpperCase());
    if (q) q2 = q2.textSearch('search_blob', q.split(/\s+/).join(' & '));
    ({ data, error } = await q2);
  }
  if (error) return res.status(400).json({ error: error.message });
  res.json({ opportunities: data || [] });
});

/* ---------- applications: 1 credit = 1 application (consume on create) ---------- */
app.post('/api/applications', auth, async (req, res) => {
  const { opportunityId } = req.body || {};
  const { data: prof } = await admin().from('profiles').select('role').eq('id', req.userId).single();
  const isAdmin = prof && ['admin','staff'].includes(prof.role);
  const bal = await balance(req.userId);
  if (!isAdmin && bal < 1) return res.status(402).json({ error: 'No credits. Buy a pack to start this application.' });
  const { data: opp } = await admin().from('opportunities').select('id,institution').eq('id', opportunityId).single();
  if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
  const caseNo = 'FF-' + Date.now().toString(36).toUpperCase();
  const { data: appRow, error } = await admin().from('applications')
    .insert({ user_id: req.userId, opportunity_id: opp.id, case_no: caseNo, stage: 'preparing', credits_consumed: isAdmin ? 0 : 1 })
    .select().single();
  if (error) return res.status(400).json({ error: error.message.includes('duplicate') ? 'You already have an application for this opportunity' : error.message });
  if (!isAdmin) await admin().from('credit_ledger').insert({ user_id: req.userId, delta: -1, reason: 'consume', application_id: appRow.id, note: opp.institution });
  res.json({ application: appRow });
});
app.get('/api/applications', auth, async (req, res) => {
  const { data } = await admin().from('applications').select('*, opportunities(title,institution,country_code,deadline,url)').eq('user_id', req.userId).order('updated_at', { ascending: false });
  res.json({ applications: data || [] });
});



/* ---------- documents: upload, read, view, delete + auto profile fill ---------- */
const multer = require('multer');
const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 6 } });
const { saveUpload, signedUrl, extractProfile } = require('./lib/docs');
app.post('/api/documents', auth, up.array('files', 6), async (req, res) => {
  try {
    const results = [];
    for (const f of (req.files || [])) {
      try { const d = await saveUpload(req.userId, f); results.push({ id: d.id, name: d.name, kind: d.kind }); }
      catch (e) { results.push({ name: f.originalname, error: e.message }); }
    }
    const ok = results.some(r => !r.error);
    res.json({ ok, results, autofill: ok });
    if (ok) setTimeout(() => extractProfile(req.userId).catch(e => admin().from('audit_log').insert({ actor: req.userId, event: 'AUTOFILL_FAIL', detail: String(e.message).slice(0, 200) })), 1200);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/documents', auth, async (req, res) => {
  const { data } = await admin().from('documents').select('id,kind,name,mime,size_bytes,created_at').eq('user_id', req.userId).eq('generated', false).order('created_at', { ascending: false });
  res.json({ documents: data || [] });
});
// Canonical document checklist — what strengthens a client's study/work case.
// Maps uploaded documents (by their classified `kind`) onto a fixed list so the
// Profile page can show a clear "have / still needed" checklist.
const DOC_CHECKLIST = [
  { key: 'cv',            label: 'CV / Resume',                 required: true,  match: ['cv'] },
  { key: 'transcript',   label: 'Academic transcripts',        required: true,  match: ['transcript'] },
  { key: 'degree',       label: 'Degree certificates',         required: true,  match: ['degree'] },
  { key: 'english_test', label: 'English test (IELTS/TOEFL/PTE)', required: true, match: ['english_test'] },
  { key: 'passport',     label: 'Passport (photo page)',       required: true,  match: ['passport'] },
  { key: 'license',      label: 'Professional license/registration (work)', required: false, match: ['license'] },
  { key: 'reference_letter', label: 'Reference / recommendation letters', required: false, match: ['reference_letter'] },
  { key: 'publication',  label: 'Publications / research papers', required: false, match: ['publication'] },
  { key: 'certificate',  label: 'Other certificates / awards',  required: false, match: ['certificate'] },
  { key: 'document',     label: 'Anything else that helps your case', required: false, match: ['document'] }
];
app.get('/api/documents/checklist', auth, async (req, res) => {
  const { data } = await admin().from('documents').select('kind').eq('user_id', req.userId).eq('generated', false);
  const have = new Set((data || []).map(d => String(d.kind || '').toLowerCase()));
  const items = DOC_CHECKLIST.map(it => ({
    key: it.key, label: it.label, required: it.required,
    have: it.match.some(m => have.has(m))
  }));
  const requiredItems = items.filter(i => i.required);
  const requiredDone = requiredItems.filter(i => i.have).length;
  res.json({
    items,
    requiredTotal: requiredItems.length,
    requiredDone,
    complete: requiredDone === requiredItems.length,
    uploadedKinds: [...have]
  });
});
app.get('/api/documents/:id/url', auth, async (req, res) => {
  const { data: d } = await admin().from('documents').select('*').eq('id', req.params.id).single();
  if (!d || d.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  try {
    const url = await signedUrl(d.storage_key);
    await admin().from('document_access_log').insert({ document_id: d.id, accessed_by: req.userId, action: 'view' });
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/documents/:id', auth, async (req, res) => {
  const { data: d } = await admin().from('documents').select('*').eq('id', req.params.id).single();
  if (!d || d.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  try { await admin().storage.from(require('./lib/docs').BUCKET).remove([d.storage_key]); } catch (e) {}
  await admin().from('documents').delete().eq('id', d.id);
  await admin().from('document_access_log').insert({ document_id: d.id, accessed_by: req.userId, action: 'delete' });
  res.json({ ok: true });
});
app.post('/api/profile/autofill', auth, async (req, res) => {
  try { const out = await extractProfile(req.userId); res.json({ ok: true, ...out }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/referees', auth, async (req, res) => {
  const { data } = await admin().from('referees').select('*').eq('user_id', req.userId).order('created_at');
  res.json({ referees: data || [] });
});


/* ---------- Gmail one-click connect (per user) ---------- */
const gmailLib = require('./lib/gmail');
app.get('/auth/google/start', async (req, res) => {
  try {
    const u = await userFromToken(String(req.query.token || ''));
    if (!u) return res.status(401).send('Sign in first, then press Connect my Gmail again.');
    res.redirect(gmailLib.authStartUrl(String(req.query.token)));
  } catch (e) { res.status(400).send(e.message); }
});
app.get('/auth/google/callback', async (req, res) => {
  try {
    const u = await userFromToken(String(req.query.state || ''));
    if (!u) return res.redirect('/?gmail=error&why=' + encodeURIComponent('Session expired, sign in and retry'));
    if (!req.query.code) return res.redirect('/?gmail=error&why=' + encodeURIComponent(String(req.query.error || 'Google returned no code')));
    const rt = await gmailLib.exchangeCode(String(req.query.code));
    const { encrypt } = require('./lib/crypt');
    const { data: p } = await admin().from('profiles').select('id').eq('id', u.id).single();
    if (!p) await admin().from('profiles').insert({ id: u.id, full_name: u.email.split('@')[0] });
    await admin().from('profiles').update({ gmail_refresh_enc: encrypt(rt), gmail_addr: u.email, gmail_connected: true }).eq('id', u.id);
    await admin().from('audit_log').insert({ actor: u.id, event: 'GMAIL_CONNECTED', detail: u.email });
    res.redirect('/?gmail=connected');
  } catch (e) { res.redirect('/?gmail=error&why=' + encodeURIComponent(String(e.message).slice(0, 140))); }
});
app.get('/api/me/gmail', auth, async (req, res) => {
  const { data: p } = await admin().from('profiles').select('gmail_connected,gmail_addr').eq('id', req.userId).single();
  res.json({ connected: !!(p && p.gmail_connected), addr: (p || {}).gmail_addr || '' });
});
app.post('/api/me/gmail/disconnect', auth, async (req, res) => {
  await admin().from('profiles').update({ gmail_refresh_enc: null, gmail_connected: false }).eq('id', req.userId);
  res.json({ ok: true });
});


app.get('/api/admin/overview', auth, staffOnly, async (req, res) => {
  const { data: pend } = await admin().from('payments').select('*, profiles(full_name)').eq('status', 'pending').order('created_at');
  const { data: users } = await admin().from('profiles').select('id');
  const { data: costs } = await admin().from('ai_cost_ledger').select('cost_usd');
  const { data: apps } = await admin().from('applications').select('id');
  res.json({ users: (users||[]).length, applications: (apps||[]).length,
    aiCostUsd: (costs||[]).reduce((s,c)=>s+Number(c.cost_usd||0),0).toFixed(4),
    pendingPayments: pend||[] });
});

/* ---------- pipeline endpoints ---------- */
const { discoverForUser, prepareApplication } = require('./lib/engine');
app.post('/api/run', auth, async (req, res) => {
  const { data: st } = await admin().from('app_settings').select('value').eq('key', 'lastRun').single();
  const last = st ? new Date(st.value.at || 0) : new Date(0);
  const mins = (Date.now() - last.getTime()) / 60000;
  if (mins < 30) return res.json({ ok: true, ran: false, message: 'Searched ' + Math.round(mins) + ' min ago. Next run possible in ' + Math.ceil(30 - mins) + ' min.' });
  await admin().from('app_settings').upsert({ key: 'lastRun', value: { at: new Date().toISOString() } });
  res.json({ ok: true, ran: true, message: 'Searching official sources now. Verified opportunities appear within 2 to 3 minutes.' });
  discoverForUser(req.userId, req.body && req.body.kind).catch(e => console.error('[discover]', e.message));
});
app.post('/api/applications/:id/prepare', auth, async (req, res) => {
  const { data: a } = await admin().from('applications').select('id,user_id').eq('id', req.params.id).single();
  if (!a || a.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, message: 'Preparing your documents and email now.' });
  prepareApplication(a.id).catch(e => console.error('[prepare]', e.message));
});
app.get('/api/applications/:id', auth, async (req, res) => {
  const { data: a } = await admin().from('applications').select('*, opportunities(*)').eq('id', req.params.id).single();
  if (!a || a.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  const { data: docs } = await admin().from('application_documents').select('id,kind,title,content').eq('application_id', a.id);
  const { data: msgs } = await admin().from('messages').select('*').eq('application_id', a.id).order('created_at', { ascending: false });
  res.json({ application: a, documents: docs || [], messages: msgs || [] });
});
app.post('/api/messages/:id/authorize', auth, async (req, res) => {
  const { data: m } = await admin().from('messages').select('*').eq('id', req.params.id).single();
  if (!m || m.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  if (m.status !== 'pending') return res.status(400).json({ error: 'Already ' + m.status });
  await admin().from('messages').update({ status: 'approved' }).eq('id', m.id);
  await admin().from('applications').update({ stage: 'prepared', authorized_at: new Date().toISOString(), authorized_by: req.userId, next_action: 'Authorized. The send agent dispatches it from your Gmail within 2 minutes.' }).eq('id', m.application_id);
  await admin().from('audit_log').insert({ actor: req.userId, event: 'AUTHORIZED', detail: m.id });
  res.json({ ok: true, note: 'Authorized. It sends from your own Gmail within 2 minutes, with your documents attached as PDFs.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('ForiForeign core on :' + PORT);
  try { require('./lib/agents').startAgents(); } catch (e) { console.error('[agents]', e.message); }
});
