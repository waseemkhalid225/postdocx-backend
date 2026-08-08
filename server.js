// server.js — PostDocX backend (Railway-ready)
require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const crypto = require('crypto');
const { runCycle, cfg, draftProposal, interviewBrief, coupleDossier, weeklyReview, draftRefereeRequests } = require('./lib/agent');
const db = require('./lib/sheets');

const app = express();
app.use(express.json());

const KEY = process.env.APPROVE_KEY || 'change-me';
function safeEqual(a, b) {
  const A = Buffer.from(String(a || '')), B = Buffer.from(String(b || ''));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
const hits = new Map();
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  const ip = req.headers['x-forwarded-for'] || req.ip || '?';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  if (arr.length > 60) return res.status(429).send('Too many requests');
  next();
});
const guard = (req, res) => {
  if (!safeEqual(req.query.key || req.headers['x-key'], KEY)) { res.status(403).send('Forbidden'); return false; }
  return true;
};
const page = (title, msg) =>
`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui;background:#F3F5F7;color:#1B2A41;display:grid;place-items:center;min-height:90vh;margin:0}
.c{background:#fff;border:1px solid #DCE2E8;border-radius:14px;padding:28px 26px;max-width:440px;box-shadow:0 4px 14px rgba(27,42,65,.08)}
h1{font-size:20px;margin:0 0 8px}p{color:#5C6C7D;line-height:1.5;white-space:pre-wrap}</style></head>
<body><div class="c"><h1>PostDoc<span style="color:#B8912E">X</span> — ${title}</h1><p>${msg}</p></div></body></html>`;

app.get('/health', (_req, res) => res.json({ ok: true, mode: cfg().autoSend ? 'auto' : 'approval', time: new Date().toISOString() }));

app.get('/status', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const opps = await db.all('Opportunities');
    const out = await db.all('Outbox');
    res.send(page('Status',
`Mode: ${cfg().autoSend ? 'AUTO-SEND' : 'APPROVAL'}
Opportunities: ${opps.length} (verified: ${opps.filter(o => o.status === 'VERIFIED').length})
Outbox: ${out.length} (sent: ${out.filter(m => m.status === 'SENT').length}, pending: ${out.filter(m => m.status === 'PENDING').length})
Replies received: ${out.filter(m => m.replied === 'yes').length}`));
  } catch (e) { res.status(500).send(page('Error', e.message)); }
});

// Manual run: GET /run?key=...
app.get('/run', async (req, res) => {
  if (!guard(req, res)) return;
  res.send(page('Cycle started', 'The full agent cycle is running in the background.\nYour daily report email will arrive when it finishes (typically 3–8 minutes).'));
  runCycle().catch(e => console.error(e));
});

async function setOutboxStatus(id, status) {
  const out = await db.all('Outbox');
  const m = out.find(x => x.id === id);
  if (!m) return null;
  m._row.set('status', status);
  await m._row.save();
  return m;
}

app.get('/approve/:id', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const m = await setOutboxStatus(req.params.id, 'APPROVED');
    if (!m) return res.send(page('Not found', 'That draft no longer exists.'));
    await db.log('APPROVED', m.subject);
    res.send(page('Approved ✓', `"${m.subject}"\nto ${m.toName} <${m.toEmail}>\n\nIt will be sent within the next cycle (or trigger /run to send now).`));
  } catch (e) { res.status(500).send(page('Error', e.message)); }
});

app.get('/reject/:id', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const m = await setOutboxStatus(req.params.id, 'REJECTED');
    if (!m) return res.send(page('Not found', 'That draft no longer exists.'));
    await db.log('REJECTED', m.subject);
    res.send(page('Rejected ✗', `"${m.subject}" will not be sent.`));
  } catch (e) { res.status(500).send(page('Error', e.message)); }
});


// Generate a research concept note for one opportunity: /proposal/OPP_ID?key=...
app.get('/proposal/:oppId', async (req, res) => {
  if (!guard(req, res)) return;
  res.send(page('Concept note started', 'Writing the concept note now (1 to 3 minutes).\nIt will be emailed to you and saved in the Proposals tab of the Sheet.'));
  draftProposal(req.params.oppId).catch(e => console.error('proposal:', e.message));
});

// JSON snapshot for the PostDocX web app (CORS open, key protected)
app.get('/api/data', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (!safeEqual(req.query.key || req.headers['x-key'], KEY)) return res.status(403).json({ error: 'forbidden' });
  try {
    const strip = a => a.map(({ _row, ...o }) => o);
    const [researchers, opportunities, outbox, proposals] = await Promise.all([
      db.all('Researchers'), db.all('Opportunities'), db.all('Outbox'), db.all('Proposals')
    ]);
    res.json({ ok: true, generated: new Date().toISOString(),
      researchers: strip(researchers), opportunities: strip(opportunities),
      outbox: strip(outbox).map(m => ({ id: m.id, resId: m.resId, toName: m.toName, subject: m.subject, status: m.status, sentOn: m.sentOn, replied: m.replied, type: m.type })),
      proposals: strip(proposals).map(p => ({ id: p.id, resId: p.resId, title: p.title, status: p.status, createdOn: p.createdOn })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// Interview briefing for one opportunity
app.get('/interview/:oppId', async (req, res) => {
  if (!guard(req, res)) return;
  res.send(page('Interview briefing started', 'Researching the lab and preparing your briefing (1 to 3 minutes).\nIt will be emailed to you and saved in the Proposals tab.'));
  interviewBrief(req.params.oppId).catch(e => console.error('interview:', e.message));
});

// Two-body dossier for a couple-linked opportunity
app.get('/couple-dossier/:oppId', async (req, res) => {
  if (!guard(req, res)) return;
  res.send(page('Two-body dossier started', 'Writing the combined dossier for both researchers (1 to 3 minutes).\nIt will be emailed to you and saved in the Proposals tab.'));
  coupleDossier(req.params.oppId).catch(e => console.error('dossier:', e.message));
});

// Draft reference-request emails for a researcher (Referees tab, status not confirmed)
app.get('/referees/:resId', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const n = await draftRefereeRequests(req.params.resId);
    res.send(page('Referee requests drafted', n + ' request email(s) added to the Outbox with status PENDING.\nApprove them from your next daily report, or /run to process now.'));
  } catch (e) { res.status(500).send(page('Error', e.message)); }
});

// Weekly strategy review, on demand
app.get('/weekly', async (req, res) => {
  if (!guard(req, res)) return;
  res.send(page('Weekly review started', 'The strategy review is being written and will be emailed to you shortly.'));
  weeklyReview().catch(e => console.error('weekly:', e.message));
});

// Cron — default 06:00 Pakistan time daily; sender cycle again at 18:00 to push approved drafts
const TZ = process.env.TZ_NAME || 'Asia/Karachi';
cron.schedule(process.env.CRON_MAIN || '0 6 * * *', () => runCycle().catch(console.error), { timezone: TZ });
cron.schedule(process.env.CRON_EVENING || '0 18 * * *', () => runCycle({ light: true }).catch(console.error), { timezone: TZ });
cron.schedule(process.env.CRON_WEEKLY || '0 9 * * 0', () => weeklyReview().catch(console.error), { timezone: TZ });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PostDocX backend on :${PORT} | mode=${cfg().autoSend ? 'auto' : 'approval'} | tz=${TZ}`));
