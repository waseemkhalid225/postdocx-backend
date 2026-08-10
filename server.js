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
const { runCycle, cfg, draftProposal, interviewBrief, coupleDossier, weeklyReview, draftRefereeRequests, tailoredCV, coverLetter, setRuntimeMode, loadRuntimeMode, targetLabMap, fundingNarrative, sendOne, analyzeCase, piInsight, computeReadiness, buildReminders } = require('./lib/agent');
const { testOpenAI } = require('./lib/openai');
loadRuntimeMode().catch(() => {});

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
    const allowed = ['name', 'title', 'field', 'methods', 'pubs', 'prefs', 'links', 'orcid', 'nationality', 'phone', 'jobPrefs', 'minSalary', 'jobLocations', 'schedLink'];
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
{"title":"academic credentials in one line, degrees and research standing first, current job title last or omitted","field":"REWRITE, do not copy the CV summary: describe this person purely as a RESEARCHER in 2-3 sentences: their research lines, disease areas, molecular targets, computational and experimental angles. A professional summary about operations, management or job duties is wrong here","methods":"ONLY research-relevant methods: laboratory, computational, statistical, animal or cell models, assays, regulatory science where research-relevant; comma separated","pubs":"key publications: title, journal, year, role; one per line","orcid":"ORCID id if present else empty","links":"Scholar/ResearchGate/LinkedIn URLs found, else empty","phone":"phone if present else empty","nationality":"if stated else empty","prefs":"","referees":"if a references section exists: one per line as Name | email | relationship, else empty"}

DEEP ANALYSIS: read ALL documents together as one body of evidence, CV, theses, publications, statements, certificates. Synthesize across them: connect thesis topics to publications, methods to the projects where they were actually used, and tag techniques with their evidence level in brackets, for example molecular docking [PhD, published], HPLC [MPhil], pharmacovigilance systems [professional, research-relevant]. Never list a technique without evidence in the documents.\n\nSTRICT FILTER: extract ONLY what strengthens a postdoctoral research application. Include research techniques, experimental and computational methods, models, publications, thesis work, research awards. EXCLUDE routine job duties, business or administrative operations, retail or management experience, generic software, and anything a hiring PI would not care about. When a professional role contains research-relevant elements (for example pharmacovigilance systems, regulatory science, clinical data), keep only those elements, framed as research skills.` });
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
    // Referee extraction from the documents' references section
    let refsAdded = 0;
    if (v.referees && v.referees.length > 10) {
      const existingRefs = (await db.all('Referees')).filter(x => x.resId === req.userId);
      for (const line of String(v.referees).split('\n')) {
        const parts = line.split('|').map(x => x.trim()).filter(Boolean);
        if (parts.length < 2 || !/@/.test(parts[1] || '')) continue;
        if (existingRefs.some(x => x.email.toLowerCase() === parts[1].toLowerCase())) continue;
        await db.add('Referees', { id: uid(), resId: req.userId, name: parts[0], email: parts[1], relationship: parts[2] || 'listed as reference in CV', status: 'pending', note: 'Extracted from uploaded documents' });
        refsAdded++;
      }
    }
    if (filled.length) {
      const rows2 = await db.all('Settings');
      const fl = rows2.find(x => x.key === 'rescorePending');
      const cur = fl ? String(fl.value || '') : '';
      const nv = cur.includes(req.userId) ? cur : (cur ? cur + ',' : '') + req.userId;
      if (fl) { fl._row.set('value', nv); await fl._row.save(); }
      else await db.add('Settings', { key: 'rescorePending', value: nv });
      setTimeout(() => runCycle({ light: true }).catch(() => {}), 2000);
    }
    // #3 close missing-document tasks that this upload satisfies, resume those cases
    try {
      const myDocs = (await db.all('Documents')).filter(d => d.resId === req.userId);
      const haveTypes = myDocs.map(d => (d.type || '').toLowerCase());
      const openTasks = (await db.all('Tasks')).filter(t => t.resId === req.userId && t.status !== 'Done' && /^provide:|^upload/i.test(t.title));
      const resumed = new Set();
      for (const t of openTasks) {
        const want = t.title.replace(/^provide:\s*|^upload( missing documents:)?\s*/i, '').toLowerCase();
        if (haveTypes.some(ht => ht && (want.includes(ht.split(' ')[0]) || ht.includes(want.split(' ')[0])))) {
          t._row.set('status', 'Done'); await t._row.save();
          if (t.oppId) resumed.add(t.oppId);
        }
      }
      for (const oppId of resumed) analyzeCase(oppId).catch(() => {});
    } catch (e) {}
    await db.log('AUTOFILL', u.name + ': ' + (filled.join(', ') || 'nothing new') + (refsAdded ? ' +' + refsAdded + ' referees' : ''));
    res.json({ ok: true, filled, refsAdded, docsRead: (await db.all('Documents')).filter(d => d.resId === req.userId && d.driveId).length, user: publicUser(await getUser(req.userId)) });
  } catch (e) { res.status(400).json({ error: e.message, detail: 'autofill' }); }
});

/* ---- Authorize and submit: one action approves every pending email for this opportunity and sends within a minute ---- */
app.post('/api/opps/:oppId/authorize', auth, async (req, res) => {
  const out = (await db.all('Outbox')).filter(m => m.oppId === req.params.oppId && m.resId === req.userId);
  const pending = out.filter(m => m.status === 'PENDING' && m.toEmail);
  if (!pending.length) {
    const noEmail = out.some(m => m.status === 'NO_EMAIL');
    return res.status(400).json({ error: noEmail ? 'No verified contact email for this one yet, add it in the Sheet Outbox tab or wait for verification to find it.' : 'No draft is ready yet, the agent prepares one after verification.' });
  }
  for (const m of pending) { m._row.set('status', 'APPROVED'); await m._row.save(); }
  await db.log('AUTHORIZED', req.params.oppId + ' (' + pending.length + ' emails)');
  res.json({ ok: true, approved: pending.length, message: pending.length + ' email(s) authorized, sending within a minute.' });
  setTimeout(() => runCycle({ light: true }).catch(e => console.error(e)), 500);
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
const strip = a => a.map(({ _row, ...o }) => o);
app.get('/api/bundle', auth, async (req, res) => {
  try {
    const me = await getUser(req.userId);
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
      mode: cfg().autoSend ? 'auto' : 'approval',
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


/* ---- edit a generated document, and turn it into a professional PDF ---- */
app.put('/api/proposals/:id', auth, async (req, res) => {
  const pRow = (await db.all('Proposals')).find(x => x.id === req.params.id && x.resId === req.userId);
  if (!pRow) return res.status(404).json({ error: 'Not found' });
  const { content, title } = req.body || {};
  if (content) pRow._row.set('content', String(content).slice(0, 45000));
  if (title) pRow._row.set('title', String(title).slice(0, 200));
  pRow._row.set('status', 'EDITED');
  await pRow._row.save();
  res.json({ ok: true });
});

app.post('/api/proposals/:id/pdf', auth, async (req, res) => {
  try {
    const pRow = (await db.all('Proposals')).find(x => x.id === req.params.id && x.resId === req.userId);
    if (!pRow) return res.status(404).json({ error: 'Not found' });
    const u = await getUser(req.userId);
    const PDFDocument = require('pdfkit');
    const chunks = [];
    const pdf = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 68, right: 68 } });
    pdf.on('data', c => chunks.push(c));
    const done = new Promise(r => pdf.on('end', r));
    pdf.font('Helvetica-Bold').fontSize(15).text(u.name || '', { align: 'left' });
    if (u.title) pdf.font('Helvetica').fontSize(9.5).fillColor('#444444').text(u.title);
    pdf.moveDown(0.4).fillColor('#000000');
    pdf.font('Helvetica-Bold').fontSize(12).text(pRow.title.replace(/^(Tailored CV|Cover letter \([^)]*\)|Concept note|Interview brief|Two-body dossier): ?/i, ''));
    pdf.moveDown(0.7);
    pdf.font('Helvetica').fontSize(10.5).fillColor('#111111');
    for (const para of String(pRow.content).split(/\n\n+/)) {
      const line = para.trim();
      if (!line) continue;
      const isHeading = line.length < 70 && !/[.]$/.test(line) && (line === line.toUpperCase() || /^[A-Z][A-Za-z ,&]+$/.test(line));
      if (isHeading) { pdf.moveDown(0.35).font('Helvetica-Bold').fontSize(11).text(line); pdf.font('Helvetica').fontSize(10.5); }
      else pdf.text(line.replace(/\n/g, ' '), { align: 'justify', lineGap: 2.2 });
      pdf.moveDown(0.45);
    }
    pdf.end();
    await done;
    const buf = Buffer.concat(chunks);
    const kind = /Tailored CV/i.test(pRow.title) ? 'CV (tailored, PDF)' : /Cover letter/i.test(pRow.title) ? 'Cover letter (PDF)' : /Concept note/i.test(pRow.title) ? 'Concept note (PDF)' : 'Document (PDF)';
    const fname = (u.name || 'Document').replace(/\s+/g, '_') + '_' + kind.replace(/[^A-Za-z]/g, '') + '_' + today().replace(/-/g, '') + '.pdf';
    const f = await storage.put(fname, 'application/pdf', buf);
    await db.add('Documents', { id: uid(), resId: req.userId, type: kind, name: fname, url: '', attach: 'no', version: '', updatedOn: today(), note: 'Generated from: ' + pRow.title, driveId: f.id, mime: 'application/pdf', size: String(buf.length) });
    const docs = await db.all('Documents');
    const docRow = docs.filter(d => d.resId === req.userId).sort((a, b) => (b.updatedOn || '') < (a.updatedOn || '') ? -1 : 1)[0];
    res.json({ ok: true, docId: docRow ? docRow.id : '', message: 'PDF created and saved to your Documents: ' + fname });
  } catch (e) { res.status(500).json({ error: 'PDF failed: ' + e.message }); }
});

/* ---- backups: list and safe restore (empty tabs only, so nothing can be overwritten) ---- */
app.get('/api/admin/backups', auth, adminOnly, async (req, res) => {
  const items = await storage.list('PostDocX-Backup');
  res.json({ backups: items.sort((a, b) => a.name < b.name ? 1 : -1).slice(0, 10) });
});

app.post('/api/admin/restore', auth, adminOnly, async (req, res) => {
  try {
    const { id, tab } = req.body || {};
    if (!id || !tab || !db.SCHEMA[tab]) return res.status(400).json({ error: 'Backup id and valid tab required' });
    const existing = await db.all(tab);
    if (existing.length) return res.status(400).json({ error: 'Safety guard: "' + tab + '" already has ' + existing.length + ' rows. Restore only fills EMPTY tabs so nothing can be overwritten. Clear the tab in the Sheet first if you truly want to restore it.' });
    const buf = await storage.get(id);
    const dump = JSON.parse(buf.toString());
    const rows = dump[tab] || [];
    if (!rows.length) return res.status(400).json({ error: 'Backup has no rows for ' + tab });
    await db.addMany(tab, rows);
    await db.log('RESTORED', tab + ' (' + rows.length + ' rows) from ' + id);
    res.json({ ok: true, message: 'Restored ' + rows.length + ' rows into ' + tab + '.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


app.post('/api/labmap', auth, async (req, res) => {
  res.json({ ok: true, message: 'Building your target lab map, 3 to 5 minutes. It arrives in Activity, Created for you, and by email.' });
  targetLabMap(req.userId).catch(e => console.error('labmap:', e.message));
});

/* ---- SIMPLE UX aggregated endpoints (engine unchanged, just friendlier reads) ---- */
app.get('/api/home', auth, async (req, res) => {
  try {
    const [opps, cases, outbox, tasks, docs, threads] = await Promise.all([
      db.all('Opportunities'), db.all('Cases'), db.all('Outbox'), db.all('Tasks'), db.all('Documents'), db.all('Threads')
    ]);
    const mine = x => x.resId === req.userId;
    const myOpps = opps.filter(mine);
    const myCases = cases.filter(mine);
    const appliedOppIds = new Set(myCases.filter(c => ['Sent','Replied','In conversation','Interview','Closed'].includes(c.stage)).map(c => c.oppId));
    const engaged = myOpps.filter(o => (parseInt(o.matchScore) || 0) >= (parseInt(process.env.MIN_ENGAGE_SCORE || '65')) && o.status !== 'EXPIRED' && o.archived !== 'yes' && !appliedOppIds.has(o.id));
    const best = engaged.sort((a, b) => (parseInt(b.matchScore) || 0) - (parseInt(a.matchScore) || 0)).slice(0, 12);
    const pendingApprovals = outbox.filter(m => mine(m) && m.status === 'PENDING');
    const openTasks = tasks.filter(t => mine(t) && t.status !== 'Done');
    const submitted = myCases.filter(c => ['Sent', 'Replied', 'In conversation', 'Interview'].includes(c.stage));
    // action items: pending approvals + open document/confirm tasks
    const actions = [];
    for (const m of pendingApprovals) {
      const o = opps.find(x => x.id === m.oppId);
      actions.push({ kind: 'approve', id: m.id, title: 'Review and send', where: o ? (o.institution) : m.toName, oppId: m.oppId, section: o ? (o.section || 'postdoc') : 'postdoc' });
    }
    for (const t of openTasks.filter(t => /upload|confirm|reference/i.test(t.title))) {
      const o = opps.find(x => x.id === t.oppId);
      actions.push({ kind: 'task', id: t.id, title: t.title, where: o ? o.institution : '', oppId: t.oppId, section: o ? (o.section || 'postdoc') : 'postdoc' });
    }
    const settings = await db.all('Settings');
    const autopilot = (settings.find(x => x.key === 'autopilot') || {}).value !== 'off';
    let lastRun = null; try { lastRun = JSON.parse((settings.find(x => x.key === 'lastRun') || {}).value || 'null'); } catch (e) {}
    const mode = cfg().autoSend ? 'auto' : 'approval';
    // "worked overnight" summary from today's log
    const log = await db.all('Log');
    const todayStr = new Date().toISOString().slice(0, 10);
    const todays = log.filter(l => (l.ts || '').slice(0, 10) === todayStr);
    res.json({
      name: (await getUser(req.userId)).name,
      autopilot, mode, lastRun,
      counts: {
        checked: myOpps.length,
        best: best.length,
        prepared: myCases.filter(c => ['Email prepared', 'Awaiting approval'].includes(c.stage)).length,
        submitted: submitted.length,
        actions: actions.length,
        applied: appliedOppIds.size,
        belowThreshold: myOpps.filter(o => (parseInt(o.matchScore)||0) < (parseInt(process.env.MIN_ENGAGE_SCORE||'65')) && o.status!=='EXPIRED' && o.archived!=='yes').length
      },
      best: strip(best),
      actions,
      applications: strip(myCases).map(c => {
        const o = opps.find(x => x.id === c.oppId) || {};
        return { caseNo: c.caseNo, oppId: c.oppId, stage: c.stage, institution: o.institution || '', title: o.title || '', deadline: o.deadline || '', matchScore: c.matchScore };
      }),
      activityToday: todays.slice(-12).map(l => ({ event: l.event, detail: l.detail })),
      docReadiness: (() => {
        const need = ['CV', 'Research statement', 'Degree certificates', 'Transcripts', 'Publication PDFs', 'Reference letters'];
        const have = new Set(docs.filter(mine).map(d => d.type));
        return need.map(t => ({ type: t, ready: have.has(t) }));
      })()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/autopilot', auth, adminOnly, async (req, res) => {
  const on = !(req.body && req.body.off);
  const rows = await db.all('Settings');
  const row = rows.find(x => x.key === 'autopilot');
  if (row) { row._row.set('value', on ? 'on' : 'off'); await row._row.save(); }
  else await db.add('Settings', { key: 'autopilot', value: on ? 'on' : 'off' });
  res.json({ ok: true, autopilot: on });
});

app.get('/api/ai-health', auth, async (req, res) => {
  const claude = { ok: !!process.env.ANTHROPIC_API_KEY, note: process.env.ANTHROPIC_API_KEY ? 'Connected' : 'No key' };
  let openai = { ok: false, note: 'No key' };
  try { openai = await testOpenAI(); } catch (e) {}
  res.json({ claude, openai });
});


app.get('/api/report', auth, async (req, res) => {
  const settings = await db.all('Settings');
  let rep = null; try { rep = JSON.parse((settings.find(x=>x.key==='lastReport')||{}).value||'null'); } catch(e){}
  res.json({ report: rep });
});




app.post('/api/tasks/:id/done', auth, async (req, res) => {
  const t = (await db.all('Tasks')).find(x => x.id === req.params.id && x.resId === req.userId);
  if (!t) return res.status(404).json({ error: 'Not found' });
  t._row.set('status', 'Done'); await t._row.save();
  res.json({ ok: true });
});

/* ===== live preparation status ===== */
app.get('/api/prep-status', auth, async (req, res) => {
  const opps = (await db.all('Opportunities')).filter(o => o.resId === req.userId);
  const out = [];
  for (const o of opps) {
    if (!o.prepStartedAt) continue;
    let ps = {};
    try { ps = JSON.parse(o.prepStatus || '{}'); } catch (e) {}
    const plan = ps.plan || [];
    const done = ps.done || [];
    const preparing = o.prepDone !== 'yes' && plan.length > 0;
    out.push({ oppId: o.id, institution: o.institution, title: o.title, section: o.section || 'postdoc',
      plan: plan, done: done, preparing: preparing,
      pct: plan.length ? Math.round(100 * done.length / plan.length) : 0,
      startedAt: o.prepStartedAt });
  }
  res.json({ preparing: out.filter(x => x.preparing), recent: out });
});

/* ===== FEATURE 1: unified case history — full timeline in one place ===== */
app.get('/api/case-history/:oppId', auth, async (req, res) => {
  try {
    const oppId = req.params.oppId;
    const opp = (await db.all('Opportunities')).find(o => o.id === oppId && o.resId === req.userId);
    if (!opp) return res.status(404).json({ error: 'Not found' });
    const [cases, outbox, threads, tasks, props, docs] = await Promise.all([
      db.all('Cases'), db.all('Outbox'), db.all('Threads'), db.all('Tasks'), db.all('Proposals'), db.all('Documents')
    ]);
    const cse = cases.find(c => c.oppId === oppId);
    const emails = outbox.filter(m => m.oppId === oppId);
    const replies = threads.filter(t => t.oppId === oppId);
    const timeline = [];
    if (opp.addedOn) timeline.push({ on: opp.addedOn, kind: 'found', text: 'Opportunity found and added' });
    if (opp.verifiedOn) timeline.push({ on: opp.verifiedOn, kind: 'verified', text: 'Verified against the official source' });
    if (opp.analyzedOn) timeline.push({ on: opp.analyzedOn, kind: 'analyzed', text: 'Requirements analyzed, documents prepared' });
    for (const m of emails) {
      if (m.sentOn) timeline.push({ on: m.sentOn, kind: 'sent', text: 'Email sent to ' + (m.toName || m.toEmail) + ': "' + m.subject + '"', body: m.body });
      else timeline.push({ on: m.createdOn, kind: 'draft', text: 'Email drafted: "' + m.subject + '"' });
    }
    for (const t of replies) {
      timeline.push({ on: t.receivedOn || t.createdOn, kind: 'reply', text: 'Reply from ' + (t.fromEmail || 'supervisor') + (t.intent ? ' (' + String(t.intent).replace(/_/g,' ') + ')' : ''), body: t.body });
    }
    timeline.sort((a, b) => (a.on || '') < (b.on || '') ? -1 : 1);
    res.json({
      opportunity: (() => { const o = strip([opp])[0]; try { o.requirements = JSON.parse(o.requirements||'{}'); } catch(e){ o.requirements={}; } try { o.nextSteps = JSON.parse(o.nextSteps||'[]'); } catch(e){ o.nextSteps=[]; } return o; })(),
      case: cse ? strip([cse])[0] : null,
      timeline,
      emails: strip(emails),
      replies: strip(replies),
      tasks: strip(tasks.filter(t => t.oppId === oppId)),
      documents: strip(props.filter(p => p.oppId === oppId)).map(p => ({ id: p.id, title: p.title, status: p.status })),
      attachments: docs.filter(d => d.resId === req.userId && /generated from/i.test(d.note||'') && (d.note||'').includes('opp:'+oppId)).map(d => ({ id: d.id, name: d.name, type: d.type }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/applied', auth, async (req, res) => {
  const [cases, opps, threads] = await Promise.all([db.all('Cases'), db.all('Opportunities'), db.all('Threads')]);
  const mine = cases.filter(c => c.resId === req.userId);
  const applied = mine.filter(c => ['Sent','Replied','In conversation','Interview','Closed'].includes(c.stage));
  const rows = applied.map(c => {
    const o = opps.find(x => x.id === c.oppId) || {};
    const rep = threads.filter(t => t.oppId === c.oppId);
    const lastReply = rep.sort((a,b)=>(a.receivedOn||'')<(b.receivedOn||'')?1:-1)[0];
    return { oppId: c.oppId, caseNo: c.caseNo, institution: o.institution||'', title: o.title||'', stage: c.stage, updatedOn: c.updatedOn||'', hasReply: rep.length>0, lastReplyOn: lastReply?lastReply.receivedOn:'', nextAction: c.nextAction||'' };
  }).sort((a,b)=>(a.updatedOn||'')<(b.updatedOn||'')?1:-1);
  res.json({ applied: rows });
});


/* ===== FEATURE 4: reminders ===== */
app.get('/api/reminders', auth, async (req, res) => {
  try { await buildReminders(); } catch (e) {}
  const rows = (await db.all('Reminders')).filter(r => r.resId === req.userId && r.status !== 'done')
    .sort((a,b)=>(a.dueOn||'')<(b.dueOn||'')?-1:1);
  res.json({ reminders: strip(rows) });
});
app.post('/api/reminders/:id/done', auth, async (req, res) => {
  const r = (await db.all('Reminders')).find(x => x.id === req.params.id && x.resId === req.userId);
  if (!r) return res.status(404).json({ error: 'Not found' });
  r._row.set('status', 'done'); await r._row.save();
  res.json({ ok: true });
});

/* ===== FEATURE 3: auto-run search on login (throttled) ===== */
app.post('/api/auto-refresh', auth, async (req, res) => {
  try {
    const settings = await db.all('Settings');
    const autopilot = (settings.find(x => x.key === 'autopilot') || {}).value !== 'off';
    if (!autopilot) return res.json({ ok: true, ran: false, reason: 'Autopilot is paused' });
    const lastRow = settings.find(x => x.key === 'lastAutoRun');
    const last = lastRow ? new Date(lastRow.value || 0) : new Date(0);
    const minsSince = (Date.now() - last.getTime()) / 60000;
    if (minsSince < 180) return res.json({ ok: true, ran: false, reason: 'Searched ' + Math.round(minsSince) + ' min ago' });
    // throttle: only admins trigger the shared cycle
    if (req.userRole !== 'admin') return res.json({ ok: true, ran: false, reason: 'Runs on schedule' });
    if (lastRow) { lastRow._row.set('value', new Date().toISOString()); await lastRow._row.save(); }
    else await db.add('Settings', { key: 'lastAutoRun', value: new Date().toISOString() });
    res.json({ ok: true, ran: true, message: 'Fresh search started in the background' });
    runCycle({ light: true }).catch(e => console.error('auto-refresh cycle', e.message));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- in-app approvals ---- */
app.put('/api/outbox/:id', auth, async (req, res) => {
  const m = (await db.all('Outbox')).find(x => x.id === req.params.id && x.resId === req.userId);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (m.status !== 'PENDING' && m.status !== 'APPROVED') return res.status(400).json({ error: 'Only pending drafts can be edited' });
  const { subject, body, toEmail } = req.body || {};
  if (subject) m._row.set('subject', String(subject).slice(0, 300));
  if (body) m._row.set('body', String(body).slice(0, 8000));
  if (toEmail && /@/.test(toEmail)) m._row.set('toEmail', String(toEmail).trim().slice(0, 200));
  await m._row.save();
  await db.log('DRAFT_EDITED', m.subject);
  res.json({ ok: true });
});

app.post('/api/outbox/:id/:action', auth, async (req, res) => {
  const { id, action } = req.params;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Bad action' });
  const m = (await db.all('Outbox')).find(x => x.id === id && x.resId === req.userId);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (m.status !== 'PENDING' && m.status !== 'APPROVED') return res.status(400).json({ error: 'Already ' + m.status.toLowerCase() });
  if (action === 'reject') {
    m._row.set('status', 'REJECTED'); await m._row.save();
    await db.log('REJECTED', m.subject);
    return res.json({ ok: true, status: 'REJECTED' });
  }
  // APPROVE = send to the recipient NOW, from the user's own email, with attachments
  const result = await sendOne(id);
  if (!result.ok) return res.status(400).json({ error: result.error, status: 'PENDING' });
  res.json({ ok: true, status: 'SENT', message: 'Sent to ' + result.to + (result.attachments ? ' with ' + result.attachments + ' attachment(s)' : '') + '.' });
});

// Preflight: can we actually send email right now? Used before showing Approve as ready.
app.get('/api/send-health', auth, async (req, res) => {
  const u = await getUser(req.userId);
  let can = false, how = '', note = '';
  const gmailApi = require('./lib/gmail-send');
  if (gmailApi.isConfigured()) {
    can = true; const addr = await gmailApi.whoAmI();
    how = 'your Gmail (' + (addr || 'connected account') + ')';
    note = 'The professor receives a genuine personal email from your real address. Nothing third-party is shown.';
  }
  else if (u.emailConnected === 'yes' && u.smtpEmail) { can = true; how = 'your Gmail'; }
  else if (process.env.BREVO_API_KEY) { can = true; how = 'the office sender over HTTPS'; note = 'Sends from the verified office address with your address as reply-to.'; }
  else if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    const t = await testEmailCreds({ user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD });
    can = t.smtp; how = t.smtp ? 'the office Gmail' : ''; if (!t.smtp) note = 'SMTP is blocked by the host. Add a BREVO_API_KEY to enable sending over HTTPS.';
  } else note = 'No sending method configured. Connect your Gmail in Profile, or add a Brevo API key.';
  res.json({ canSend: can, how, note });
});

// Full case view: everything prepared, in one place, before sending
app.get('/api/case/:oppId', auth, async (req, res) => {
  try {
    const oppId = req.params.oppId;
    const opp = (await db.all('Opportunities')).find(o => o.id === oppId && o.resId === req.userId);
    if (!opp) return res.status(404).json({ error: 'Not found' });
    const cases = await db.all('Cases');
    const cse = cases.find(c => c.oppId === oppId);
    const outbox = (await db.all('Outbox')).filter(m => m.oppId === oppId);
    const props = (await db.all('Proposals')).filter(p => p.oppId === oppId);
    const tasks = (await db.all('Tasks')).filter(t => t.oppId === oppId);
    const threads = (await db.all('Threads')).filter(t => t.oppId === oppId);
    res.json({
      opportunity: (() => { const o = strip([opp])[0]; try { o.requirements = JSON.parse(o.requirements || '{}'); } catch(e){ o.requirements = {}; } try { o.nextSteps = JSON.parse(o.nextSteps || '[]'); } catch(e){ o.nextSteps = []; } return o; })(),
      case: cse ? strip([cse])[0] : null,
      emails: strip(outbox),
      documents: strip(props).map(p => ({ id: p.id, title: p.title, status: p.status })),
      attachments: (await db.all('Documents')).filter(d => d.resId === req.userId && /generated from/i.test(d.note || '') && (d.note || '').includes('opp:' + oppId)).map(d => ({ id: d.id, name: d.name, type: d.type })),
      tasks: strip(tasks),
      conversation: strip(threads)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- on-demand agent actions (per user) ---- */
app.post('/api/generate/:kind/:oppId', auth, async (req, res) => {
  const { kind, oppId } = req.params;
  const opp = (await db.all('Opportunities')).find(o => o.id === oppId);
  if (!opp || opp.resId !== req.userId) return res.status(404).json({ error: 'Opportunity not found' });
  const fns = { proposal: draftProposal, interview: interviewBrief, dossier: coupleDossier, cv: tailoredCV, cover: coverLetter, funding: fundingNarrative };
  if (!fns[kind]) return res.status(400).json({ error: 'Unknown generator' });
  res.json({ ok: true, message: 'Writing now. It will appear under Proposals and in your email in 1 to 3 minutes.' });
  fns[kind](oppId).catch(e => console.error(kind, e.message));
});


app.post('/api/cases/:oppId/prepare', auth, async (req, res) => {
  const oppId = req.params.oppId;
  const opp = (await db.all('Opportunities')).find(o => o.id === oppId);
  if (!opp || opp.resId !== req.userId) return res.status(404).json({ error: 'Opportunity not found' });
  const fresh = opp.analyzedOn === today();
  res.json({ ok: true, message: fresh ? 'This case was already analyzed today; refreshing documents.' : 'Reading the full position requirements and preparing everything A to Z. This takes 2 to 4 minutes; the case updates as it completes.' });
  analyzeCase(oppId).catch(e => console.error('analyze', e.message));
});


app.post('/api/prepare-all', auth, async (req, res) => {
  const opps = await db.all('Opportunities');
  const engaged = opps.filter(o => o.resId === req.userId &&
    (parseInt(o.matchScore) || 0) >= (parseInt(process.env.MIN_ENGAGE_SCORE || '65')) &&
    o.status !== 'EXPIRED');
  if (!engaged.length) return res.json({ ok: true, message: 'No engaged opportunities to prepare yet. Run a search first.' });
  res.json({ ok: true, message: 'Preparing ' + engaged.length + ' application(s) in parallel: tailored CVs, cover letters and concept notes. Check Applications in a few minutes.' });
  // Parallel preparation, all documents written fresh by the agent
  Promise.allSettled(engaged.slice(0, 10).map(async o => {
    await tailoredCV(o.id).catch(() => {});
    if ((o.section || 'postdoc') === 'job') await coverLetter(o.id).catch(() => {});
    else if ((parseInt(o.matchScore) || 0) >= 80) await draftProposal(o.id).catch(() => {});
  })).catch(() => {});
});


// Opportunities that scored below the engagement threshold: viewable, user can promote them
app.get('/api/below-threshold', auth, async (req, res) => {
  const th = parseInt(process.env.MIN_ENGAGE_SCORE || '65');
  const opps = (await db.all('Opportunities')).filter(o => o.resId === req.userId && o.archived !== 'yes' && (parseInt(o.matchScore) || 0) < th && o.status !== 'EXPIRED');
  res.json({ threshold: th, items: strip(opps).sort((a,b)=>(parseInt(b.matchScore)||0)-(parseInt(a.matchScore)||0)) });
});
app.post('/api/opps/:oppId/pursue', auth, async (req, res) => {
  const opp = (await db.all('Opportunities')).find(o => o.id === req.params.oppId && o.resId === req.userId);
  if (!opp) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, message: 'Pursuing this opportunity: reading requirements and preparing documents now.' });
  analyzeCase(opp.id).catch(e => console.error('pursue', e.message));
});

// #10 Autopilot health panel: every internal link in one view
app.get('/api/admin/autopilot-health', auth, adminOnly, async (req, res) => {
  const out = {};
  try { await db.connect(); out.database = { ok: true, note: 'Sheets connected' }; } catch (e) { out.database = { ok: false, note: e.message }; }
  try { out.storage = await require('./lib/storage').probe(); } catch (e) { out.storage = { ok: false, note: e.message }; }
  // email
  let email = { ok: false, note: '' };
  const gapi = require('./lib/gmail-send');
  if (gapi.isConfigured()) { const addr = await gapi.whoAmI(); email = { ok: !!addr, note: addr ? ('Sends as your real Gmail: ' + addr) : 'Gmail API configured but token not valid yet' }; }
  else if (process.env.BREVO_API_KEY) email = { ok: true, note: 'HTTPS sending via Brevo (fallback)' };
  else if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    const t = await require('./lib/mailer').testEmailCreds({ user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD });
    email = { ok: t.smtp, note: t.smtp ? 'SMTP sending works' : 'SMTP blocked, add BREVO_API_KEY' };
  } else email = { ok: false, note: 'No sending method configured' };
  out.email = email;
  out.ai = { ok: !!process.env.ANTHROPIC_API_KEY, note: (process.env.ANTHROPIC_API_KEY ? 'Claude ready' : 'No Claude key') + (process.env.OPENAI_API_KEY ? ', GPT ready' : '') };
  const settings = await db.all('Settings');
  let lastRun = null; try { lastRun = JSON.parse((settings.find(x=>x.key==='lastRun')||{}).value||'null'); } catch(e){}
  out.lastCycle = { ok: !!lastRun, note: lastRun ? ('Last ran ' + lastRun.at) : 'No cycle recorded yet' };
  out.autopilot = { ok: (settings.find(x=>x.key==='autopilot')||{}).value !== 'off', note: (settings.find(x=>x.key==='autopilot')||{}).value === 'off' ? 'PAUSED' : 'Running' };
  // stuck cases: verified but not analyzed, or prepared but not sent for >2 days
  const cases = await db.all('Cases');
  const stuck = cases.filter(c => c.status === 'ACTIVE' && ['Email prepared','Awaiting approval'].includes(c.stage)).length;
  out.pipeline = { ok: true, note: cases.filter(c=>c.status==='ACTIVE').length + ' active cases, ' + stuck + ' awaiting your approval' };
  // aging tasks
  const tasks = await db.all('Tasks');
  const openT = tasks.filter(t => t.status !== 'Done').length;
  out.tasks = { ok: openT < 10, note: openT + ' open tasks' };
  res.json(out);
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
    const brevo = process.env.BREVO_API_KEY ? 'HTTPS fallback (Brevo): configured' : 'HTTPS fallback: not configured (set BREVO_API_KEY)';
    out.gmail = { ok: t.smtp || t.imap || !!process.env.BREVO_API_KEY,
      note: 'Sending SMTP: ' + (t.smtp ? 'OK' : 'BLOCKED (' + (t.smtpError || '').slice(0, 60) + ')') +
        ' | Reading IMAP: ' + (t.imap ? 'OK' : 'BLOCKED (' + (t.imapError || '').slice(0, 60) + ')') +
        ' | ' + brevo +
        ((!t.smtp || !t.imap) ? ' | Railway blocks mail ports on free/trial plans, upgrading to Hobby unblocks both.' : '') };
  } else out.gmail = { ok: false, note: 'GMAIL_USER / GMAIL_APP_PASSWORD not set' };
  out.anthropic = { ok: !!process.env.ANTHROPIC_API_KEY, note: process.env.ANTHROPIC_API_KEY ? 'API key present' : 'ANTHROPIC_API_KEY not set' };
  res.json(out);
});

app.post('/api/admin/run', auth, adminOnly, async (req, res) => {
  res.json({ ok: true, message: 'Full cycle started. Reports go out when it finishes, typically 2 to 3 minutes.' });
  runCycle().catch(e => console.error(e));
});

app.post('/api/admin/mode', auth, adminOnly, async (req, res) => {
  const mode = req.body && req.body.mode === 'auto' ? 'auto' : 'approval';
  const rows = await db.all('Settings');
  const row = rows.find(x => x.key === 'sendMode');
  if (row) { row._row.set('value', mode); await row._row.save(); }
  else await db.add('Settings', { key: 'sendMode', value: mode });
  setRuntimeMode(mode);
  await db.log('MODE_CHANGED', mode);
  res.json({ ok: true, mode, message: mode === 'auto'
    ? 'Auto mode ON: verified outreach and routine replies send themselves within daily caps. Interviews and offers still always wait for you.'
    : 'Approval mode ON: every email waits for your tap in Activity.' });
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
async function autopilotOn() { try { return ((await db.all('Settings')).find(x => x.key === 'autopilot') || {}).value !== 'off'; } catch (e) { return true; } }
cron.schedule(process.env.CRON_MAIN || '0 6 * * *', async () => { if (await autopilotOn()) runCycle().catch(console.error); }, { timezone: TZ });
cron.schedule(process.env.CRON_EVENING || '0 18 * * *', async () => { if (await autopilotOn()) runCycle({ light: true }).catch(console.error); }, { timezone: TZ });
cron.schedule(process.env.CRON_WEEKLY || '0 9 * * 0', () => weeklyReview().catch(console.error), { timezone: TZ });
cron.schedule(process.env.CRON_BACKUP || '30 8 * * 0', () => gdrive.backupSheet().then(n => console.log('Backup:', n)).catch(e => console.error('Backup failed:', e.message)), { timezone: TZ });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PostDocX v2 on :${PORT} | mode=${cfg().autoSend ? 'auto' : 'approval'} | tz=${TZ}`));
