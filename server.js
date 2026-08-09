// server.js — PostDocX v2: multi-user portal + agent engine in one Railway deployment
require('dotenv').config();
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const crypto = require('crypto');
const multer = require('multer');
const db = require('./lib/sheets');
const gdrive = require('./lib/drive');
const storage = require('./lib/storage');
const { hashPassword, verifyPassword, signToken, verifyToken, encrypt } = require('./lib/crypt');
const { testEmailCreds } = require('./lib/mailer');
const mammoth = require('mammoth');
const { claude, parseJSON } = require('./lib/anthropic');
const { runCycle, cfg, draftProposal, interviewBrief, coupleDossier, weeklyReview, draftRefereeRequests, tailoredCV, coverLetter } = require('./lib/agent');

const app = express();
app.use(express.json({ limit: '1mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/* ---------- hardening ---------- */
const hits = new Map();
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  const ip = req.headers['x-forwarded-for'] || req.ip || '?';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  if (arr.length > 120) return res.status(429).json({ error: 'Too many requests' });
  next();
});

const KEY = process.env.APPROVE_KEY || 'change-me';
function safeEqual(a, b) {
  const A = Buffer.from(String(a || '')), B = Buffer.from(String(b || ''));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
const keyGuard = (req, res) => {
  if (!safeEqual(req.query.key || req.headers['x-key'], KEY)) { res.status(403).send('Forbidden'); return false; }
  return true;
};

/* ---------- auth middleware ---------- */
function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const p = verifyToken(t);
  if (!p) return res.status(401).json({ error: 'Please sign in again' });
  req.userId = p.id; req.userRole = p.role;
  next();
}
function adminOnly(req, res, next) {
  if (req.userRole !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}
async function getUser(id) { return (await db.all('Users')).find(u => u.id === id); }
function publicUser(u) {
  const { passHash, encPass, _row, ...rest } = u;
  rest.emailConnected = u.emailConnected === 'yes' || u.emailConnected === 'imap';
  rest.emailMode = u.emailConnected || 'no';
  return rest;
}
const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);

/* ================= AUTH ================= */
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, title, field, methods, pubs, prefs, links, orcid, nationality, phone, jobPrefs } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const users = await db.all('Users');
    if (users.some(u => u.email.toLowerCase() === String(email).toLowerCase()))
      return res.status(400).json({ error: 'An account with this email already exists' });
    const role = users.length === 0 ? 'admin' : 'member'; // first account is admin
    const u = {
      id: uid(), name, email, passHash: hashPassword(password), role,
      title: title || '', field: field || '', methods: methods || '', pubs: pubs || '',
      prefs: prefs || '', links: links || '', orcid: orcid || '', nationality: nationality || 'Pakistani',
      phone: phone || '', smtpEmail: '', encPass: '', emailConnected: 'no', partnerId: '',
      active: 'yes', createdOn: today(),
      jobPrefs: Array.isArray(jobPrefs) ? jobPrefs.join(',') : (jobPrefs || 'international_job')
    };
    await db.add('Users', u);
    await db.log('REGISTER', name + ' <' + email + '> as ' + role);
    res.json({ token: signToken({ id: u.id, role }), user: publicUser(u) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const u = (await db.all('Users')).find(x => x.email.toLowerCase() === String(email || '').toLowerCase());
    if (!u || !verifyPassword(password, u.passHash)) return res.status(401).json({ error: 'Wrong email or password' });
    if (u.active === 'no') return res.status(403).json({ error: 'Account disabled' });
    res.json({ token: signToken({ id: u.id, role: u.role }), user: publicUser(u) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/me', auth, async (req, res) => {
  const u = await getUser(req.userId);
  if (!u) return res.status(401).json({ error: 'Account not found' });
  res.json({ user: publicUser(u) });
});

app.put('/api/profile', auth, async (req, res) => {
  try {
    const u = await getUser(req.userId);
    const allowed = ['name', 'title', 'field', 'methods', 'pubs', 'prefs', 'links', 'orcid', 'nationality', 'phone', 'jobPrefs', 'minSalary', 'jobLocations'];
    for (const k of allowed) if (req.body[k] !== undefined) u._row.set(k, String(req.body[k]).slice(0, 2000));
    await u._row.save();
    res.json({ user: publicUser(await getUser(req.userId)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- connect own Gmail (app password, stored encrypted, never returned) ---- */
app.post('/api/email-connect', auth, async (req, res) => {
  try {
    const { gmail, appPassword } = req.body || {};
    if (!gmail || !appPassword) return res.status(400).json({ error: 'Gmail address and app password are required' });
    const pass = String(appPassword).replace(/\s+/g, '');
    if (pass.length !== 16) return res.status(400).json({ error: 'A Gmail app password is exactly 16 characters. Copy it again from myaccount.google.com → App passwords.' });
    const t = await testEmailCreds({ user: gmail, pass });
    if (!t.smtp && !t.imap) {
      const authFail = /auth|credential|password|535|Invalid/i.test(t.smtpError + t.imapError);
      return res.status(400).json({ error: authFail
        ? 'Gmail rejected the sign-in. Check: the app password is copied exactly (16 characters), the Gmail address is right, and 2-Step Verification is ON for that account. Regular account passwords never work here.'
        : 'This server could not reach Gmail at all (network blocked or timeout). Try again in a minute; if it persists, your hosting plan may block mail ports. Technical detail: ' + (t.smtpError || t.imapError) });
    }
    const mode = t.smtp ? 'yes' : 'imap';
    const u = await getUser(req.userId);
    u._row.set('smtpEmail', gmail);
    u._row.set('encPass', encrypt(pass));
    u._row.set('emailConnected', mode);
    await u._row.save();
    await db.log('EMAIL_CONNECTED', u.name + ' -> ' + gmail + ' (' + mode + ')');
    res.json({ ok: true, mode, message: t.smtp
      ? 'Connected fully. Outreach sends from your own Gmail and replies are detected in your inbox.'
      : 'Connected for reading: your inbox replies will be detected. Sending from your address is blocked by the hosting network (' + t.smtpError.slice(0, 80) + '), so outreach goes through the office account with Reply-To set to you. Upgrading the Railway plan usually unblocks direct sending.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/email-disconnect', auth, async (req, res) => {
  const u = await getUser(req.userId);
  u._row.set('smtpEmail', ''); u._row.set('encPass', ''); u._row.set('emailConnected', 'no');
  await u._row.save();
  res.json({ ok: true });
});

/* ================= DOCUMENTS (real uploads to Drive) ================= */
app.post('/api/documents', auth, upload.array('files', 12), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files received' });
    const okTypes = ['application/pdf', 'image/jpeg', 'image/png',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'];
    const u = await getUser(req.userId);
    const existing = (await db.all('Documents')).filter(d => d.resId === req.userId);
    const hasCVAttach = existing.some(d => /cv/i.test(d.type) && d.attach === 'yes');
    const classify = fn => {
      const f = String(fn).toLowerCase();
      if (/(cv|resume|curriculum)/.test(f)) return 'CV';
      if (/(statement|sop)/.test(f)) return 'Research statement';
      if (/(transcript|marks|dmc|result)/.test(f)) return 'Transcripts';
      if (/(thesis|dissertation)/.test(f)) return 'Thesis';
      if (/(degree|diploma)/.test(f)) return 'Degree certificates';
      if (/(passport|cnic|identity|id[ ._-]?card)/.test(f)) return 'Passport / ID';
      if (/(reference|recommendation)/.test(f)) return 'Reference letters';
      if (/(paper|publication|article|manuscript|doi|journal|jpet)/.test(f)) return 'Publication PDFs';
      if (/(certificate|award|medal)/.test(f)) return 'Certificates (awards, training)';
      return 'Other';
    };
    const results = [];
    let cvAttached = hasCVAttach;
    for (const file of files) {
      if (!okTypes.includes(file.mimetype)) { results.push({ name: file.originalname, error: 'Only PDF, Word or image files' }); continue; }
      const type = classify(file.originalname);
      const stamp = today().replace(/-/g, '');
      const fname = `${u.name.replace(/\s+/g, '_')}_${type.replace(/[^A-Za-z]/g, '')}_${stamp}_${file.originalname}`.slice(0, 120);
      try {
        const f = await storage.put(fname, file.mimetype, file.buffer);
        const attach = (!cvAttached && type === 'CV') ? 'yes' : 'no';
        if (attach === 'yes') cvAttached = true;
        await db.add('Documents', {
          id: uid(), resId: req.userId, type, name: file.originalname,
          url: '', attach, version: '', updatedOn: today(), note: '',
          driveId: f.id, mime: file.mimetype, size: String(f.size || file.size)
        });
        results.push({ name: file.originalname, type });
      } catch (e) { results.push({ name: file.originalname, error: e.message }); }
    }
    res.json({ ok: true, results });
  } catch (e) { res.status(500).json({ error: 'Upload failed. ' + e.message }); }
});

app.get('/api/documents', auth, async (req, res) => {
  const docs = (await db.all('Documents')).filter(d => d.resId === req.userId)
    .map(({ _row, ...d }) => d);
  res.json({ documents: docs });
});

app.get('/api/documents/:id/download', auth, async (req, res) => {
  try {
    const d = (await db.all('Documents')).find(x => x.id === req.params.id);
    if (!d || d.resId !== req.userId) return res.status(404).send('Not found');
    if (!d.driveId) return res.status(404).send('No file stored');
    const buf = storage.isStorageId(d.driveId) ? await storage.get(d.driveId) : await gdrive.getBuffer(d.driveId);
    res.set('Content-Type', d.mime || 'application/octet-stream');
    res.set('Content-Disposition', 'inline; filename="' + (d.name || 'document').replace(/"/g, '') + '"');
    res.send(buf);
  } catch (e) { res.status(500).send('Download failed'); }
});

app.delete('/api/documents/:id', auth, async (req, res) => {
  const d = (await db.all('Documents')).find(x => x.id === req.params.id);
  if (!d || d.resId !== req.userId) return res.status(404).json({ error: 'Not found' });
  if (d.driveId) { if (storage.isStorageId(d.driveId)) await storage.remove(d.driveId); else await gdrive.remove(d.driveId); }
  await d._row.delete();
  db.bust('Documents');
  res.json({ ok: true });
});


/* ---- autofill profile from uploaded documents ---- */
async function extractProfile(userId) {
  const docs = (await db.all('Documents')).filter(d => d.resId === userId && d.driveId);
  if (!docs.length) throw new Error('Upload your CV first, then the profile can fill itself.');
  // Prefer CV, then research statement, then anything else. Up to 3 files, ~9 MB budget.
  const order = t => /cv/i.test(t) ? 0 : /statement/i.test(t) ? 1 : /publication/i.test(t) ? 2 : 3;
  const picked = docs.sort((a, b) => order(a.type) - order(b.type)).slice(0, 3);
  const blocks = [];
  let budget = 9 * 1024 * 1024;
  for (const d of picked) {
    try {
      const buf = storage.isStorageId(d.driveId) ? await storage.get(d.driveId) : await gdrive.getBuffer(d.driveId);
      if (buf.length > budget) continue;
      budget -= buf.length;
      if (d.mime === 'application/pdf') {
        blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
      } else if (/wordprocessingml|msword/.test(d.mime)) {
        const r = await mammoth.extractRawText({ buffer: buf });
        if (r.value) blocks.push({ type: 'text', text: 'Content of ' + d.type + ' (' + d.name + '):\n' + r.value.slice(0, 30000) });
      } else if (/^image\//.test(d.mime)) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: d.mime, data: buf.toString('base64') } });
      }
    } catch (e) { /* skip unreadable file */ }
  }
  if (!blocks.length) throw new Error('Could not read the uploaded files.');
  blocks.push({ type: 'text', text:
`Extract this researcher's academic profile from the document(s) above. Use ONLY what is actually written there, never invent or embellish. Respond ONLY with JSON:
{"title":"academic credentials in one line, degrees and research standing first, current job title last or omitted","field":"REWRITE, do not copy the CV summary: describe this person purely as a RESEARCHER in 2-3 sentences: their research lines, disease areas, molecular targets, computational and experimental angles. A professional summary about operations, management or job duties is wrong here","methods":"ONLY research-relevant methods: laboratory, computational, statistical, animal or cell models, assays, regulatory science where research-relevant; comma separated","pubs":"key publications: title, journal, year, role; one per line","orcid":"ORCID id if present else empty","links":"Scholar/ResearchGate/LinkedIn URLs found, else empty","phone":"phone if present else empty","nationality":"if stated else empty","prefs":""}

STRICT FILTER: extract ONLY what strengthens a postdoctoral research application. Include research techniques, experimental and computational methods, models, publications, thesis work, research awards. EXCLUDE routine job duties, business or administrative operations, retail or management experience, generic software, and anything a hiring PI would not care about. When a professional role contains research-relevant elements (for example pharmacovigilance systems, regulatory science, clinical data), keep only those elements, framed as research skills.` });
  const txt = await claude(blocks, { search: false, maxTokens: 1800 });
  return parseJSON(txt);
}

app.post('/api/profile/autofill', auth, async (req, res) => {
  try {
    const v = await extractProfile(req.userId);
    const u = await getUser(req.userId);
    const fields = ['title', 'field', 'methods', 'pubs', 'orcid', 'links', 'phone', 'nationality'];
    const force = !!(req.body || {}).force;
    const filled = [];
    for (const k of fields) {
      const val = String(v[k] || '').trim();
      if (!val) continue;
      const cleanVal = val.replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',');
      if (force || !String(u[k] || '').trim()) { u._row.set(k, cleanVal.slice(0, 2000)); filled.push(k); }
    }
    if (filled.length) await u._row.save();
    await db.log('AUTOFILL', u.name + ': ' + (filled.join(', ') || 'nothing new'));
    res.json({ ok: true, filled, user: publicUser(await getUser(req.userId)) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ================= REFEREES ================= */
app.get('/api/referees', auth, async (req, res) => {
  res.json({ referees: (await db.all('Referees')).filter(r => r.resId === req.userId).map(({ _row, ...r }) => r) });
});
app.post('/api/referees', auth, async (req, res) => {
  const { name, email, relationship } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
  await db.add('Referees', { id: uid(), resId: req.userId, name, email, relationship: relationship || '', status: 'pending', note: '' });
  res.json({ ok: true });
});
app.post('/api/referees/request-all', auth, async (req, res) => {
  try { const n = await draftRefereeRequests(req.userId); res.json({ ok: true, drafted: n }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/referees/:id', auth, async (req, res) => {
  const r = (await db.all('Referees')).find(x => x.id === req.params.id && x.resId === req.userId);
  if (!r) return res.status(404).json({ error: 'Not found' });
  await r._row.delete(); db.bust('Referees'); res.json({ ok: true });
});

/* ================= PIPELINE DATA ================= */
app.get('/api/bundle', auth, async (req, res) => {
  try {
    const me = await getUser(req.userId);
    const strip = a => a.map(({ _row, ...o }) => o);
    const [opps, outbox, proposals, users, cases, threads, tasks] = await Promise.all([
      db.all('Opportunities'), db.all('Outbox'), db.all('Proposals'), db.all('Users'), db.all('Cases'), db.all('Threads'), db.all('Tasks')
    ]);
    const mineOpp = opps.filter(o => o.resId === req.userId);
    const coupleKeys = new Set(mineOpp.filter(o => o.coupleKey).map(o => o.coupleKey));
    const partnerOpp = opps.filter(o => o.coupleKey && coupleKeys.has(o.coupleKey) && o.resId !== req.userId);
    res.json({
      me: publicUser(me),
      partner: me.partnerId ? (u => u ? { id: u.id, name: u.name } : null)(users.find(x => x.id === me.partnerId)) : null,
      opportunities: strip(mineOpp),
      coupleOpportunities: strip(partnerOpp),
      outbox: strip(outbox.filter(m => m.resId === req.userId)),
      proposals: strip(proposals.filter(p => p.resId === req.userId)).map(p => ({ id: p.id, title: p.title, status: p.status, createdOn: p.createdOn })),
      cases: strip(cases.filter(cse => cse.resId === req.userId)),
      tasks: strip(tasks.filter(t => t.resId === req.userId)),
      threads: strip(threads.filter(t => t.resId === req.userId)).map(t => ({ id: t.id, oppId: t.oppId, outboxId: t.outboxId, fromEmail: t.fromEmail, subject: t.subject, body: t.body, intent: t.intent, receivedOn: t.receivedOn }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/proposals/:id', auth, async (req, res) => {
  const p = (await db.all('Proposals')).find(x => x.id === req.params.id && x.resId === req.userId);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json({ title: p.title, content: p.content, createdOn: p.createdOn });
});


app.post('/api/tasks/:id/toggle', auth, async (req, res) => {
  const t = (await db.all('Tasks')).find(x => x.id === req.params.id && x.resId === req.userId);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const next = t.status === 'Done' ? 'Open' : 'Done';
  t._row.set('status', next);
  await t._row.save();
  res.json({ ok: true, status: next });
});

/* ---- manual job entry (Jobs section; the postdoc engine is untouched by these) ---- */
app.post('/api/opportunities', auth, async (req, res) => {
  try {
    const { title, institution, category, country, url, deadline, compensation, note } = req.body || {};
    if (!title || !institution) return res.status(400).json({ error: 'Title and organization are required' });
    const cat = ['national_job', 'remote_job', 'international_job'].includes(category) ? category : 'national_job';
    const dupKey = (req.userId + '|' + institution + '|' + title).toLowerCase().replace(/\s+/g, ' ');
    const opps = await db.all('Opportunities');
    if (opps.some(o => o.dupKey === dupKey)) return res.status(400).json({ error: 'Already tracked' });
    const oid = uid();
    await db.add('Opportunities', {
      id: oid, resId: req.userId, title, institution, country: country || '', pi: '', url: url || '',
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(deadline || '') ? deadline : '', funding: compensation ? 'Salaried' : 'Funding TBC',
      status: 'New', matchScore: '', note: note || 'Manual entry', dupKey, addedOn: today(), verifiedOn: '',
      coupleKey: '', category: cat, level: 'Job role', compensation: compensation || '', section: 'job'
    });
    const checklists = {
      national_job: ['Eligibility checked', 'CV updated for this role', 'Cover letter prepared', 'Application submitted'],
      remote_job: ['Job analyzed', 'Cover letter prepared', 'Application submitted'],
      international_job: ['Eligibility checked', 'CV updated for this role', 'Cover letter prepared', 'Visa route checked', 'Application submitted']
    };
    await db.addMany('Tasks', (checklists[cat] || checklists.national_job)
      .map(t => ({ id: uid(), resId: req.userId, oppId: oid, category: cat, title: t, status: 'Open', createdOn: today() })));
    res.json({ ok: true, message: 'Job added. Tailored CV and cover letter are being written, check Activity in 2 to 3 minutes.' });
    coverLetter(oid).catch(e => console.error('cover:', e.message));
    tailoredCV(oid).catch(e => console.error('cv:', e.message));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- in-app approvals ---- */
app.put('/api/outbox/:id', auth, async (req, res) => {
  const m = (await db.all('Outbox')).find(x => x.id === req.params.id && x.resId === req.userId);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (m.status !== 'PENDING') return res.status(400).json({ error: 'Only pending drafts can be edited' });
  const { subject, body } = req.body || {};
  if (subject) m._row.set('subject', String(subject).slice(0, 300));
  if (body) m._row.set('body', String(body).slice(0, 8000));
  await m._row.save();
  await db.log('DRAFT_EDITED', m.subject);
  res.json({ ok: true });
});

app.post('/api/outbox/:id/:action', auth, async (req, res) => {
  const { id, action } = req.params;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Bad action' });
  const m = (await db.all('Outbox')).find(x => x.id === id && x.resId === req.userId);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (m.status !== 'PENDING') return res.status(400).json({ error: 'Already ' + m.status.toLowerCase() });
  m._row.set('status', action === 'approve' ? 'APPROVED' : 'REJECTED');
  await m._row.save();
  await db.log(action.toUpperCase() + 'D', m.subject);
  res.json({ ok: true, status: action === 'approve' ? 'APPROVED' : 'REJECTED' });
});

/* ---- on-demand agent actions (per user) ---- */
app.post('/api/generate/:kind/:oppId', auth, async (req, res) => {
  const { kind, oppId } = req.params;
  const opp = (await db.all('Opportunities')).find(o => o.id === oppId);
  if (!opp || opp.resId !== req.userId) return res.status(404).json({ error: 'Opportunity not found' });
  const fns = { proposal: draftProposal, interview: interviewBrief, dossier: coupleDossier, cv: tailoredCV, cover: coverLetter };
  if (!fns[kind]) return res.status(400).json({ error: 'Unknown generator' });
  res.json({ ok: true, message: 'Writing now. It will appear under Proposals and in your email in 1 to 3 minutes.' });
  fns[kind](oppId).catch(e => console.error(kind, e.message));
});

/* ================= ADMIN ================= */
app.get('/api/admin/users', auth, adminOnly, async (req, res) => {
  res.json({ users: (await db.all('Users')).map(publicUser) });
});
app.post('/api/admin/link-couple', auth, adminOnly, async (req, res) => {
  try {
    const { a, b } = req.body || {};
    const users = await db.all('Users');
    const A = users.find(u => u.id === a), B = users.find(u => u.id === b);
    if (!A || !B || A.id === B.id) return res.status(400).json({ error: 'Pick two different users' });
    A._row.set('partnerId', B.id); await A._row.save();
    B._row.set('partnerId', A.id); await B._row.save();
    await db.log('COUPLE_LINKED', A.name + ' <-> ' + B.name);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/unlink-couple', auth, adminOnly, async (req, res) => {
  const users = await db.all('Users');
  const A = users.find(u => u.id === (req.body || {}).a);
  if (!A) return res.status(400).json({ error: 'User not found' });
  const B = users.find(u => u.id === A.partnerId);
  A._row.set('partnerId', ''); await A._row.save();
  if (B) { B._row.set('partnerId', ''); await B._row.save(); }
  res.json({ ok: true });
});

app.get('/api/admin/diag', auth, adminOnly, async (req, res) => {
  const out = { sheets: { ok: false, note: '' }, drive: null, gmail: { ok: false, note: '' }, anthropic: { ok: false, note: '' } };
  try { await db.connect(); out.sheets = { ok: true, note: 'Google Sheet connected, all tabs present' }; }
  catch (e) { out.sheets = { ok: false, note: 'Sheets failed: ' + String(e.message).slice(0, 160) }; }
  try { out.storage = await storage.probe(); } catch (e) { out.storage = { ok: false, note: String(e.message).slice(0, 200) }; }
  try { out.drive = await gdrive.probe(); } catch (e) { out.drive = { token: { ok: false, note: String(e.message).slice(0, 200) } }; }
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    const t = await testEmailCreds({ user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD });
    out.gmail = { ok: t.smtp || t.imap, note: t.smtp ? 'Office Gmail: sending and reading OK' : t.imap ? 'Office Gmail: reading OK, sending port blocked by host (' + t.smtpError.slice(0, 80) + ')' : 'Office Gmail failed: ' + (t.smtpError || t.imapError) };
  } else out.gmail = { ok: false, note: 'GMAIL_USER / GMAIL_APP_PASSWORD not set' };
  out.anthropic = { ok: !!process.env.ANTHROPIC_API_KEY, note: process.env.ANTHROPIC_API_KEY ? 'API key present' : 'ANTHROPIC_API_KEY not set' };
  res.json(out);
});

app.post('/api/admin/run', auth, adminOnly, async (req, res) => {
  res.json({ ok: true, message: 'Full cycle started. Reports go out when it finishes, typically 2 to 3 minutes.' });
  runCycle().catch(e => console.error(e));
});
app.post('/api/admin/backup', auth, adminOnly, async (req, res) => {
  try { const name = await gdrive.backupSheet(); res.json({ ok: true, message: 'Backup created in Drive: ' + name + ' (last 8 kept)' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/weekly', auth, adminOnly, async (req, res) => {
  res.json({ ok: true, message: 'Weekly review is being written.' });
  weeklyReview().catch(e => console.error(e));
});

/* ================= key-protected routes (external cron / monitoring) ================= */
app.get('/health', (_req, res) => res.json({ ok: true, mode: cfg().autoSend ? 'auto' : 'approval', v: 2 }));
app.get('/run', (req, res) => { if (!keyGuard(req, res)) return; res.send('Cycle started'); runCycle().catch(console.error); });

/* ================= static frontend ================= */
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, fp) => { if (fp.endsWith('.html')) res.set('Cache-Control', 'no-store'); }
}));
app.get('*', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ================= cron ================= */
const TZ = process.env.TZ_NAME || 'Asia/Karachi';
cron.schedule(process.env.CRON_MAIN || '0 6 * * *', () => runCycle().catch(console.error), { timezone: TZ });
cron.schedule(process.env.CRON_EVENING || '0 18 * * *', () => runCycle({ light: true }).catch(console.error), { timezone: TZ });
cron.schedule(process.env.CRON_WEEKLY || '0 9 * * 0', () => weeklyReview().catch(console.error), { timezone: TZ });
cron.schedule(process.env.CRON_BACKUP || '30 8 * * 0', () => gdrive.backupSheet().then(n => console.log('Backup:', n)).catch(e => console.error('Backup failed:', e.message)), { timezone: TZ });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PostDocX v2 on :${PORT} | mode=${cfg().autoSend ? 'auto' : 'approval'} | tz=${TZ}`));
