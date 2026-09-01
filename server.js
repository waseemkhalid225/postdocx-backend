// ForiForeign server core v0.1 - auth (Supabase), credits, payments, pricing, opportunities
require('dotenv').config();
const express = require('express');
const { admin, userFromToken } = require('./lib/supa');

const app = express();
try { app.use(require('compression')()); } catch (e) { /* compression not installed yet */ }
const { slog, errlog } = require('./lib/oblog');
const _lat = []; // rolling latency + error counters for the observability dashboard
const _ops = { req: 0, err: 0, ai_err: 0 };
app.use((req, res, next) => {
  req.reqId = Math.random().toString(36).slice(2, 10);
  const t0 = Date.now(); _ops.req++;
  res.on('finish', () => {
    const ms = Date.now() - t0; _lat.push(ms); if (_lat.length > 500) _lat.shift();
    if (res.statusCode >= 500) _ops.err++;
    if (req.path.startsWith('/api')) slog('http', req.method + ' ' + req.path + ' ' + res.statusCode, { requestId: req.reqId, ms });
  });
  next();
});
/* Crash-proofing: unexpected errors are logged and survived - the platform never
   dies over one bad request or one rejected promise. */
process.on('unhandledRejection', err => { try { require('./lib/oblog').errlog('process:unhandledRejection', err instanceof Error ? err : new Error(String(err)), {}); } catch (e) {} });
process.on('uncaughtException', err => { try { require('./lib/oblog').errlog('process:uncaughtException', err, {}); } catch (e) {} console.error('[uncaught]', err && err.message); });

/* Security headers on every response. */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

/* Load shield: simple per-IP rate limit on the API (600 requests / 5 min).
   Generous for real users, a wall for scripts and floods. Memory-safe: the map
   is swept every window. */
const _rl = new Map();
const _rlSweep = setInterval(() => _rl.clear(), 5 * 60000);
if (_rlSweep.unref) _rlSweep.unref();
app.use('/api', (req, res, next) => {
  // Workshop-safe: a whole venue shares one public IP, so signed-in traffic is
  // keyed by the user's own token and never punished for a neighbour's clicks.
  const tok = String(req.headers.authorization || '').slice(-28);
  const ip = tok ? ('u:' + tok) : ((req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'x');
  const n = (_rl.get(ip) || 0) + 1;
  _rl.set(ip, n);
  if (n > (tok ? 900 : 300)) return res.status(429).json({ error: 'Too many requests. Please slow down for a few minutes.' });
  next();
});

/* PDF typography. PDFKit's built-in Times-* fonts are WinAnsi-encoded: any character
   outside that set renders as garbage glyphs (verified: Arabic and CJK produced
   unreadable output). We embed DejaVu Serif, which covers Latin-extended, accents,
   punctuation, currency and Cyrillic, and we sanitize anything still unsupported so a
   document can never ship with broken characters. */
const PDF_FONTS = { regular: __dirname + '/assets/fonts/DejaVuSerif.ttf', bold: __dirname + '/assets/fonts/DejaVuSerif-Bold.ttf' };
let _pdfFontsOk = null;
function pdfFontsAvailable() {
  if (_pdfFontsOk === null) {
    try { _pdfFontsOk = require('fs').existsSync(PDF_FONTS.regular) && require('fs').existsSync(PDF_FONTS.bold); }
    catch (e) { _pdfFontsOk = false; }
  }
  return _pdfFontsOk;
}
function usePdfFonts(pdf) {
  if (!pdfFontsAvailable()) return { R: 'Times-Roman', B: 'Times-Bold' };
  try { pdf.registerFont('FFR', PDF_FONTS.regular); pdf.registerFont('FFB', PDF_FONTS.bold); return { R: 'FFR', B: 'FFB' }; }
  catch (e) { return { R: 'Times-Roman', B: 'Times-Bold' }; }
}
/* Replace characters the embedded font cannot draw. Latin, accents, punctuation,
   currency, Greek and Cyrillic pass through; anything else (Arabic, CJK, emoji) is
   removed rather than rendered as meaningless glyphs. */
function pdfSafe(t) {
  return String(t == null ? '' : t)
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\u0000-\u024F\u0370-\u04FF\u2000-\u206F\u20A0-\u20BF\u2122\u00B7\u2022\n\r\t]/g, '')
    .replace(/[ \t]{2,}/g, ' ');
}
const RELEVANCE_FLOOR = 60; // single source of truth for match relevance minimum
/* How many scored matches a single search may return. Fifteen was a shortlist ceiling
   that made a healthy database look empty: a postdoc search returned seven results
   while dozens of qualifying positions sat unshown. The relevance floor above already
   guarantees quality, so the count can be generous - everything here is a genuine
   60%+ fit, and the package still decides how many the buyer may unlock. */
const MATCH_MAX = 60;

/* Build stamp: proves WHICH code is actually running in production. */
const FF_BUILD = '2026-09-01-R4560';
console.log('[boot] ForiForeign build ' + FF_BUILD);
/* THE DOWNLOADABLE EXTENSION MUST BE THE EXTENSION WE WROTE. public/foriforeign-apply-
   assistant.zip was a file committed by hand, and it had drifted: users were downloading
   v1.4.0, which only drops a draft into Gmail, while extension/ in this repo was v1.6.0,
   the version that opens the official portal and fills it. Every complaint that the
   assistant "does not open the university page" was people running the old build. The zip
   is now rebuilt from source on every boot, so the two can never diverge again. */
try {
  const AdmZipB = require('adm-zip');
  const fsB = require('fs'), pathB = require('path');
  const srcDir = pathB.join(__dirname, 'extension');
  if (fsB.existsSync(srcDir)) {
    const z = new AdmZipB();
    const walk = (dir, base) => {
      for (const f of fsB.readdirSync(dir)) {
        const full = pathB.join(dir, f);
        if (fsB.statSync(full).isDirectory()) walk(full, base ? base + '/' + f : f);
        else if (f !== 'README.md') z.addLocalFile(full, base || '');
      }
    };
    walk(srcDir, '');
    z.writeZip(pathB.join(__dirname, 'public', 'foriforeign-apply-assistant.zip'));
    const mf = JSON.parse(fsB.readFileSync(pathB.join(srcDir, 'manifest.json'), 'utf8'));
    console.log('[boot] apply assistant zip rebuilt from source, v' + mf.version);
  }
} catch (e) { console.log('[boot] extension zip rebuild skipped: ' + e.message); }
app.get('/api/version', (req, res) => {
  // The installed app polls this to decide whether to reload, so it must never be cached.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({ build: FF_BUILD, ok: true });
});
/* Instant email confirmation: kills the "email not confirmed" loop permanently.
   Confirming an address grants nothing without the password, so this is safe;
   lightly rate-limited per IP. */
const _confHits = new Map();
/* Server-side account creation that NEVER sends email.
   When the project's mail server is misconfigured or down, Supabase's client signup
   fails with "Error sending confirmation email" and may not create the account at all.
   This admin-API path creates the user already confirmed, so a broken mailbox can never
   stop someone from joining. Rate limited and it never reveals whether an email exists. */
const _suHits = new Map();
app.post('/api/auth/signup-direct', async (req, res) => {
  try {
    const ip = (req.headers['x-forwarded-for'] || req.ip || 'x').split(',')[0].trim();
    const now = Date.now(); const h = (_suHits.get(ip) || []).filter(t => now - t < 3600000);
    h.push(now); _suHits.set(ip, h);
    if (_suHits.size > 5000) _suHits.clear();
    if (h.length > 12) return res.status(429).json({ error: 'Too many sign-up attempts. Please try again later.' });

    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const password = String((req.body && req.body.password) || '');
    const full_name = String((req.body && req.body.full_name) || '').slice(0, 80);
    const whatsapp = String((req.body && req.body.whatsapp) || '').slice(0, 24);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const base = process.env.SUPABASE_URL.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SECRET_KEY;
    const hd = { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' };

    const r = await fetch(base + '/auth/v1/admin/users', {
      method: 'POST', headers: hd,
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name, whatsapp } })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = String(d.msg || d.message || d.error_description || '').toLowerCase();
      // Already registered: say so plainly so the person signs in instead.
      if (/already|registered|exists|duplicate/.test(msg)) {
        return res.status(409).json({ error: 'An account with this email already exists. Please sign in instead.' });
      }
      return res.status(400).json({ error: 'Could not create the account. Please try again.' });
    }
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: 'Could not create the account. Please try again.' }); }
});
app.post('/api/auth/confirmed', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.ip || 'x';
    const now = Date.now(); const h = _confHits.get(ip) || [];
    const fresh = h.filter(t => now - t < 60000); fresh.push(now); _confHits.set(ip, fresh);
    if (fresh.length > 10) return res.status(429).json({ error: 'Too many attempts, wait a minute.' });
    const email = String(req.body && req.body.email || '').trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
    const base = process.env.SUPABASE_URL.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SECRET_KEY;
    const hd = { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' };
    const q = await fetch(base + '/auth/v1/admin/users?email=' + encodeURIComponent(email), { headers: hd });
    const qd = await q.json().catch(() => ({}));
    const u = (qd.users || (Array.isArray(qd) ? qd : [])).find(x => String(x.email || '').toLowerCase() === email);
    if (!u) return res.json({ ok: true }); // never reveal whether an email exists
    if (!u.email_confirmed_at) {
      await fetch(base + '/auth/v1/admin/users/' + u.id, { method: 'PUT', headers: hd, body: JSON.stringify({ email_confirm: true }) });
    }
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: 'Could not confirm right now' }); }
});
/* Self-diagnosing health: shows WHICH link is broken without exposing any secret. */
app.get('/api/health/full', async (req, res) => {
  const has = k => !!process.env[k];
  const out = {
    build: FF_BUILD,
    env: {
      SUPABASE_URL: has('SUPABASE_URL'),
      service_key: has('SUPABASE_SERVICE_KEY') || has('SUPABASE_SERVICE_ROLE_KEY') || has('SUPABASE_SERVICE_ROLE') || has('SUPABASE_SECRET_KEY'),
      SUPABASE_ANON_KEY: has('SUPABASE_ANON_KEY') || has('SUPABASE_KEY'),
      GEMINI_API_KEY: has('GEMINI_API_KEY'),
      OPENAI_API_KEY: has('OPENAI_API_KEY'),
      ANTHROPIC_API_KEY: has('ANTHROPIC_API_KEY'),
      BRAVE_API_KEY: has('BRAVE_API_KEY')
    },
    db: 'not tested', auth_layer: 'not tested',
    ai_gate: (() => { try { const j = require('./lib/jobs'); return { max: j.MAX_AI || null, active: j.aiActive ? j.aiActive() : null, waiting: j.aiWaiting ? j.aiWaiting() : null }; } catch (e) { return null; } })()
  };
  try {
    const { error } = await admin().from('profiles').select('id', { count: 'exact', head: true });
    out.db = error ? ('ERROR: ' + error.message) : 'OK';
  } catch (e) { out.db = 'ERROR: ' + String(e.message).slice(0, 160); }
  try {
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (t) { const u = await require('./lib/supa').userFromToken(t); out.auth_layer = u ? ('OK as ' + (u.email || u.id)) : 'TOKEN REJECTED'; }
    else out.auth_layer = 'no token sent (open this page while logged in via the app to test)';
  } catch (e) { out.auth_layer = 'ERROR: ' + String(e.message).slice(0, 160); }
  res.json(out);
});
app.use(express.json({ limit: '2mb' }));
const multer = require('multer');
const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 20 } });
/* Admin-configured upload limits, enforced per request. multer holds the hard ceiling;
   these apply the operator's chosen values on top so the setting is real, not cosmetic. */
function enforceUploadLimits(req, res, next) {
  try {
    const lim = ((require('./lib/settings').cache() || {}).limits) || {};
    const maxMb = Number(lim.max_upload_mb) || 10;
    const maxFiles = Number(lim.max_files_per_upload) || 6;
    const files = req.files || (req.file ? [req.file] : []);
    if (files.length > maxFiles) {
      return res.status(413).json({ error: 'Please upload up to ' + maxFiles + ' files at a time.' });
    }
    for (const f of files) {
      if (f && f.size > maxMb * 1024 * 1024) {
        return res.status(413).json({ error: 'Each file must be under ' + maxMb + ' MB. "' + String(f.originalname || 'file').slice(0, 40) + '" is larger.' });
      }
    }
  } catch (e) {}
  next();
}
// Long-cache heavy static assets (video/icons); HTML always fresh.
/* The shell, the worker and the manifest must always be revalidated, or a phone will
   happily run a week-old build from its own HTTP cache no matter what the worker does.
   Everything else (video, icons) keeps the long cache, since those rarely change. */
app.use(express.static('public', { maxAge: '7d', etag: true, lastModified: true, setHeaders: (res, p) => {
  if (p.endsWith('.html') || p.endsWith('sw.js') || p.endsWith('manifest.json')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
} }));
/* Uptime probe: deliberately does no database work so it stays fast and never fails
   during a brief database blip. Deep diagnostics live at /api/health/full. */
app.get('/health', (req, res) => res.json({ ok: true, v: '0.7', up: process.uptime() | 0 }));

/* Per-user limiter for AI-triggering actions: protects cost and stability under load.
   In-memory sliding window: 30 AI actions per user per hour (admin exempt). */
const _aiHits = new Map();
function aiLimit(req, res, next) {
  const id = req.userId || req.ip; const now = Date.now();
  const arr = (_aiHits.get(id) || []).filter(t => now - t < 3600e3);
  if (arr.length >= 30) return res.status(429).json({ error: 'You have reached this hour\'s search limit. Please try again shortly.' });
  arr.push(now); _aiHits.set(id, arr);
  if (_aiHits.size > 5000) _aiHits.clear(); // memory-safe under real load
  next();
}

process.on('unhandledRejection', e => console.error('[bg]', e && e.message));
process.on('uncaughtException', e => console.error('[bg!]', e && e.message));

/* ---------- auth ---------- */
// Owner emails always hold super_admin, enforced on every authenticated request.
const _allowanceChecked = new Set();
const OWNER_EMAILS = ['waseemkhalid225@gmail.com', 'admin@foriforeign.com'];
async function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  const u = await userFromToken(t);
  if (!u) return res.status(401).json({ error: 'Please sign in again' });
  req.userId = u.id; req.userEmail = u.email;
  if (u.email && OWNER_EMAILS.includes(String(u.email).toLowerCase())) {
    try { const { data: p } = await admin().from('profiles').select('role').eq('id', u.id).single(); if (!p || p.role !== 'super_admin') await admin().from('profiles').update({ role: 'super_admin' }).eq('id', u.id); } catch (e) {}
  }
  /* Any admin, however they were promoted, receives the working allowance once. This
     covers accounts elevated before the rule existed, without re-granting on every call. */
  try {
    if (!_allowanceChecked.has(u.id)) {
      _allowanceChecked.add(u.id);
      if (_allowanceChecked.size > 5000) _allowanceChecked.clear();
      const { data: pr } = await admin().from('profiles').select('role').eq('id', u.id).single();
      if (pr && require('./lib/rbac').isAdminRole(pr.role) && pr.role !== 'user') {
        ensureAdminAllowance(u.id).catch(() => {});
      }
    }
  } catch (e) {}
  next();
}
async function staffOnly(req, res, next) {
  const { data } = await admin().from('profiles').select('role').eq('id', req.userId).single();
  const { isAdminRole } = require('./lib/rbac');
  if (!data || !isAdminRole(data.role)) return res.status(403).json({ error: 'Staff only' });
  req.userRole = data.role;
  next();
}
// Permission-scoped middleware (RBAC). Falls back to staffOnly behavior for legacy roles.
const { requirePermission } = require('./lib/rbac');
const perm = (p) => requirePermission(p, admin);


/* ---------- future-client compatibility (Android app, browser agent) ---------- */
// CORS: same-origin web needs nothing; native Android / external agents do.
// Set ALLOWED_ORIGINS in Railway (comma-separated) when those clients exist;
// capacitor://localhost and http://localhost are common for Android wrappers.
app.use((req, res, next) => {
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
// Version handshake for any client (web, Android, agent). A future Android app calls
// this first; if its version < min_supported_android, it shows an update screen.
app.get('/api/app-info', (req, res) => {
  res.json({
    api_version: 1,
    server_version: 'v0.7',
    min_supported_android: '0',   // raise when a breaking change ships
    min_supported_web: '0',
    endpoints: { config: '/api/config', site_config: '/api/site-config', health: '/health' }
  });
});

/* ---------- public policy pages (required for Google OAuth verification) ---------- */
async function policyPage(res, title, text) {
  const escH = s => String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escH(title)} - ForiForeign</title>
<style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;padding:0 20px;color:#1F2937;line-height:1.8}
h1{color:#2563EB}a{color:#2563EB}</style></head>
<body><h1>${escH(title)}</h1><div style="white-space:pre-wrap">${escH(text)}</div>
<p style="margin-top:40px;color:#6B7280;font-size:14px">ForiForeign · <a href="/">Home</a></p></body></html>`);
}
app.get('/privacy', async (req, res) => {
  const cfg = await siteSettings.getConfig().catch(() => siteSettings.DEFAULTS);
  policyPage(res, 'Privacy Policy', (cfg.content && cfg.content.privacy) || 'Privacy policy is being prepared.');
});
app.get('/terms', async (req, res) => {
  const cfg = await siteSettings.getConfig().catch(() => siteSettings.DEFAULTS);
  policyPage(res, 'Terms of Service', (cfg.content && cfg.content.terms) || 'Terms are being prepared.');
});

/* ---------- public: opportunity counts per country (powers the 3D globe) ---------- */
app.get('/api/public/opportunity-counts', async (req, res) => {
  try {
    const { data } = await admin().from('opportunities').select('country_code,kind,verified_at').eq('status', 'verified').limit(2000);
    const counts = {};
    (data || []).forEach(o => {
      if (!o.country_code) return;
      const c = counts[o.country_code] || (counts[o.country_code] = { total: 0, study: 0, work: 0, scholarship: 0, last: null });
      c.total++;
      if (o.kind === 'work') c.work++; else if (o.kind === 'scholarship') c.scholarship++; else c.study++;
      if (o.verified_at && (!c.last || o.verified_at > c.last)) c.last = o.verified_at;
    });
    res.json({ counts });
  } catch (e) { res.json({ counts: {} }); }
});

/* ---------- public config for the frontend ---------- */
app.get('/api/config', (req, res) => {
  res.json({ supabaseUrl: process.env.SUPABASE_URL || '', supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '' });
});

/* ---------- Phase 1: central site configuration ---------- */
const siteSettings = require('./lib/settings');
app.get('/api/site-config', async (req, res) => {
  try {
    const cfg = await siteSettings.getConfig();
    const pub = siteSettings.publicView(cfg);
    pub.fx = { usd_to_pkr: Number(cfg.ai && cfg.ai.usd_to_pkr) || 278 };
    // Real, admin-entered stories only - never fabricated defaults.
    pub.stories = Array.isArray(cfg.success_stories) ? cfg.success_stories.slice(0, 3).map(x => ({ name: String(x.name || '').slice(0, 40), text: String(x.text || '').slice(0, 140) })).filter(x => x.name && x.text) : [];
    res.json({ config: pub });
  }
  catch (e) { res.json({ config: siteSettings.publicView(siteSettings.DEFAULTS) }); }
});
/* ---------- Live trust numbers: real counts, cached 10 minutes, never fabricated ---------- */
let _stats = { at: 0, data: null };
app.get('/api/stats', async (req, res) => {
  if (_stats.data && Date.now() - _stats.at < 600e3) return res.json(_stats.data);
  const out = { opportunities: 0, countries: 0, added7: 0 };
  try {
    const { count: n } = await admin().from('opportunities').select('id', { count: 'exact', head: true }).eq('status', 'verified');
    out.opportunities = n || 0;
    const { data: cs } = await admin().from('opportunities').select('country_code').eq('status', 'verified').limit(2000);
    out.countries = new Set((cs || []).map(r => r.country_code).filter(Boolean)).size;
    const wk = new Date(Date.now() - 7 * 864e5).toISOString();
    const { count: a7 } = await admin().from('opportunities').select('id', { count: 'exact', head: true }).eq('status', 'verified').gte('created_at', wk);
    out.added7 = a7 || 0;
  } catch (e) {}
  _stats = { at: Date.now(), data: out };
  res.json(out);
});
app.get('/api/admin/settings', auth, perm('settings.read'), async (req, res) => {
  try {
    const cfg = await siteSettings.getConfig(true);
    const { data: row } = await admin().from('app_settings').select('value').eq('key', 'site_config').single().then(r => r, () => ({ data: null }));
    res.json({ config: cfg, version: (row && row.value && row.value.version) || 0, history: ((row && row.value && row.value.history) || []).map(h => ({ version: h.version, at: h.at })) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/admin/settings', auth, perm('settings.write'), async (req, res) => {
  try { res.json(await siteSettings.saveConfig(req.body && req.body.patch, req.userId)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/admin/settings/rollback', auth, perm('settings.write'), async (req, res) => {
  try { res.json(await siteSettings.rollback(req.body && req.body.version, req.userId)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/admin/audit', auth, perm('audit.read'), async (req, res) => {
  const page = Math.max(0, parseInt(req.query.page || '0'));
  const { data } = await admin().from('audit_log').select('*').order('created_at', { ascending: false }).range(page * 50, page * 50 + 49);
  res.json({ entries: data || [], page });
});

/* ================= PUBLIC SEO LAYER: server-rendered doors into live inventory ================ */
const SEO_COUNTRIES = { germany:'DE', italy:'IT', finland:'FI', sweden:'SE', norway:'NO', netherlands:'NL', france:'FR', 'united-kingdom':'GB', uk:'GB', 'united-states':'US', usa:'US', canada:'CA', australia:'AU', ireland:'IE', 'saudi-arabia':'SA', uae:'AE', qatar:'QA', china:'CN', japan:'JP', 'south-korea':'KR', malaysia:'MY', turkey:'TR', poland:'PL', hungary:'HU', austria:'AT', denmark:'DK' };
const SEO_SLUGS = ['fully-funded-masters-germany','fully-funded-phd-germany','fully-funded-masters-italy','fully-funded-scholarships-finland','no-ielts-scholarships','fully-funded-masters-sweden','fully-funded-phd-netherlands','masters-scholarships-china','fully-funded-masters-turkey','pharmacist-jobs-saudi-arabia','nurse-jobs-saudi-arabia','doctor-jobs-uae','pharmacist-jobs-uae','nurse-jobs-qatar','fully-funded-postdoc-germany','masters-scholarships-hungary','fully-funded-phd-australia','engineer-jobs-uae'];
function pkrText(txt, rate) {
  const m = String(txt || '').match(/([$€£])\s?([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s?(USD|EUR|GBP)/i);
  if (!m) return '';
  const amt = parseFloat((m[2] || m[3] || '').replace(/,/g, '')); if (!isFinite(amt) || amt <= 0) return '';
  const cur = (m[1] || m[4] || '$').toUpperCase();
  const mult = cur === '€' || cur === 'EUR' ? 1.08 : cur === '£' || cur === 'GBP' ? 1.27 : 1;
  const pkr = amt * mult * (rate || 278);
  const nice = pkr >= 1e7 ? (pkr / 1e7).toFixed(1) + ' crore' : pkr >= 1e5 ? (pkr / 1e5).toFixed(1) + ' lakh' : Math.round(pkr).toLocaleString();
  return '≈ Rs ' + nice;
}
const seoPage = (title, desc, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | ForiForeign</title><meta name="description" content="${desc}"><link rel="canonical" href=""><style>body{margin:0;background:#050d1f;color:#eef4ff;font:15px/1.6 system-ui,Segoe UI,Arial}a{color:#00D4FF}.wrap{max-width:760px;margin:0 auto;padding:28px 16px}h1{font-size:26px;margin:6px 0}h2{font-size:18px;margin:18px 0 6px;color:#fff}.sub{color:#9db8e8;font-size:13px}.card{background:rgba(8,18,40,.92);border:1px solid rgba(140,178,255,.3);border-radius:14px;padding:14px;margin:10px 0}.chip{display:inline-block;border:1px solid rgba(140,178,255,.4);border-radius:999px;padding:2px 10px;font-size:12px;margin:2px 4px 2px 0;color:#cfe1ff}.g{color:#2dd4bf;font-weight:700}.cta{display:inline-block;background:linear-gradient(90deg,#1683FF,#00D4FF);color:#04101f;font-weight:800;padding:12px 22px;border-radius:12px;text-decoration:none;margin-top:14px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}</style></head><body><div class="wrap"><div class="top"><a href="/" style="font-weight:800;text-decoration:none;color:#fff">ForiForeign</a><a href="/" class="sub">Open the app →</a></div>${body}<a class="cta" href="/">See my matches - free CV analysis</a><div class="sub" style="margin-top:16px">Every opportunity verified on the official page before you see it. You review, you press Send. Built in Pakistan.</div></div></body></html>`;
app.get('/s/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
    const parts = slug.split('-');
    let cc = null; for (const [name, code] of Object.entries(SEO_COUNTRIES)) if (slug.endsWith(name)) { cc = code; break; }
    const isWork = /jobs/.test(slug);
    const funded = /fully-funded/.test(slug);
    const noIelts = /no-ielts/.test(slug);
    const level = ['bachelors', 'masters', 'phd', 'postdoc'].find(l => parts.includes(l.replace('masters','masters')) || slug.includes(l)) || null;
    const prof = isWork ? parts[0] : null;
    let q = admin().from('opportunities').select('*').eq('status', 'verified').order('created_at', { ascending: false }).limit(12);
    q = isWork ? q.eq('kind', 'work') : q.in('kind', ['study', 'scholarship', 'postdoc']);
    if (cc) q = q.eq('country_code', cc);
    if (funded) q = q.eq('funding_type', 'fully');
    if (level) q = q.eq('level', level);
    if (prof && prof !== 'jobs') q = q.ilike('title', '%' + prof + '%');
    let { data: rows } = await q;
    rows = rows || [];
    if (!rows.length && cc) { const r2 = await admin().from('opportunities').select('*').eq('status', 'verified').eq('country_code', cc).limit(12); rows = r2.data || []; }
    const cfg = await siteSettings.getConfig().catch(() => siteSettings.DEFAULTS);
    const rate = Number(cfg.ai && cfg.ai.usd_to_pkr) || 278;
    const h = slug.split('-').map(w => w[0] ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
    const cards = rows.map(o => { const pk = pkrText(o.stipend || o.tuition, rate); return `<div class="card"><span class="chip">${o.country_code || ''}</span>${o.level ? `<span class="chip">${o.level}</span>` : ''}${o.funding_type === 'fully' ? '<span class="chip" style="border-color:#2dd4bf;color:#2dd4bf">Fully funded</span>' : ''}${o.deadline ? `<span class="chip">Deadline ${o.deadline}</span>` : ''}${o.stipend ? `<div class="g" style="margin-top:6px">Stipend: ${String(o.stipend).slice(0, 60)} ${pk ? '<span class="sub">' + pk + '</span>' : ''}</div>` : ''}<div class="sub" style="margin-top:6px">Verified on the official page. Institution and full details open with your ForiForeign package. Uploading your CV and seeing your match scores is free.</div></div>`; }).join('');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(seoPage(h, h + ' for Pakistani students and professionals - verified on official pages, matched to your CV, applications prepared for you.', `<h1>${h}</h1><div class="sub">${rows.length ? rows.length + ' verified openings live right now.' : 'The agent searches official sources daily - open the app and it searches for you.'} Matched to your CV. Applications prepared for you.</div>${cards}`));
  } catch (e) { res.redirect('/'); }
});
const SEO_GUIDES = {
  germany: { cc: 'DE', title: 'Study in Germany from Pakistan', body: '<h2>Why Germany</h2><div>Public universities charge no tuition - you pay only a semester fee of roughly €150–350 (≈ Rs 50,000–1.2 lakh per year). World-class engineering, pharmacy and research, with DAAD scholarships built for international students.</div><h2>Money reality</h2><div>Blocked account requirement ≈ €11,904 (≈ Rs 36 lakh) shown once for the visa. Monthly living ≈ €950.</div><h2>Visa for Pakistanis</h2><div>National (D) visa via the German Embassy Islamabad; APS certificate is now required before application. Plan 3–4 months.</div><h2>Funding names to know</h2><div>DAAD, Deutschlandstipendium, Erasmus Mundus.</div>' },
  finland: { cc: 'FI', title: 'Study in Finland from Pakistan', body: '<h2>Why Finland</h2><div>One of the world&#39;s best education systems, 400+ English programmes, and generous early-bird tuition waivers - many admits pay 50–100% less.</div><h2>Money reality</h2><div>Tuition €8,000–18,000 before waivers; living ≈ €800/month. Proof of funds ≈ €6,720/year (≈ Rs 21 lakh).</div><h2>Visa for Pakistanis</h2><div>Residence permit online via EnterFinland, biometrics at VFS Islamabad/Karachi.</div><h2>Funding names to know</h2><div>University scholarships (automatic with admission), EDUFI for doctoral research.</div>' },
  italy: { cc: 'IT', title: 'Study in Italy from Pakistan', body: '<h2>Why Italy</h2><div>Regional grants (DSU) can make study effectively free - many Pakistani students pay near-zero tuition AND receive a yearly grant with free meals and housing support.</div><h2>Money reality</h2><div>Tuition is income-based, often €150–1,000 with ISEE paperwork; DSU grants ≈ €5,000–7,000/year (≈ Rs 15–21 lakh).</div><h2>Visa for Pakistanis</h2><div>Pre-enrolment on Universitaly, then D-visa at the Embassy in Islamabad. Start documents early - attestation takes time.</div><h2>Funding names to know</h2><div>DSU regional scholarships, Invest Your Talent in Italy.</div>' },
  'saudi-arabia': { cc: 'SA', title: 'Work in Saudi Arabia from Pakistan', body: '<h2>Why Saudi Arabia</h2><div>Tax-free salaries, large Pakistani community, and constant demand for pharmacists, nurses, doctors and engineers under Vision 2030.</div><h2>Registration reality</h2><div>Regulated professions must be registered with the relevant Saudi authority before starting. You apply for that yourself, directly with the regulator; ForiForeign finds and prepares the job application only.</div><h2>Money reality</h2><div>Pharmacist salaries commonly SAR 5,000–12,000/month (≈ Rs 3.7–9 lakh) plus housing/transport in many contracts.</div><h2>Funding names to know</h2><div>For study instead: KAUST and Saudi government scholarships are fully funded with stipends.</div>' },
  'united-kingdom': { cc: 'GB', title: 'Study in the UK from Pakistan', body: '<h2>Why the UK</h2><div>One-year Master&#39;s degrees cut total cost dramatically, and the Graduate Route gives 2 years of post-study work.</div><h2>Money reality</h2><div>Tuition £14,000–28,000; maintenance funds ≈ £1,023/month outside London shown for 9 months (≈ Rs 32 lakh).</div><h2>Visa for Pakistanis</h2><div>Student visa with CAS; IHS surcharge applies. TB test required at approved Pakistani clinics.</div><h2>Funding names to know</h2><div>Chevening (fully funded), Commonwealth Shared Scholarships, GREAT Scholarships.</div>' },
  australia: { cc: 'AU', title: 'Study in Australia from Pakistan', body: '<h2>Why Australia</h2><div>Strong universities, paid part-time work rights, and 2–4 years of post-study work through the Temporary Graduate visa.</div><h2>Money reality</h2><div>Tuition AUD 30,000–45,000; proof of funds ≈ AUD 29,710/year (≈ Rs 55 lakh). Research degrees are often fully funded with stipends ≈ AUD 32,000.</div><h2>Visa for Pakistanis</h2><div>Subclass 500 with GS statement; strong, honest documentation matters more than agents claim.</div><h2>Funding names to know</h2><div>Australia Awards, RTP (research), Destination Australia.</div>' }
};
app.get('/guide/:c', async (req, res) => {
  const g = SEO_GUIDES[String(req.params.c || '').toLowerCase()];
  if (!g) return res.redirect('/');
  res.set('Cache-Control', 'public, max-age=3600');
  const links = SEO_SLUGS.filter(sl => { for (const [n, c] of Object.entries(SEO_COUNTRIES)) if (sl.endsWith(n) && c === g.cc) return true; return false; }).map(sl => `<a href="/s/${sl}">${sl.replace(/-/g, ' ')}</a>`).join(' · ');
  res.send(seoPage(g.title, g.title + ' - real costs in PKR, visa steps and funding names, plus live verified opportunities.', `<h1>${g.title}</h1>${g.body}${links ? '<h2>Live openings</h2><div>' + links + '</div>' : ''}`));
});
app.get('/sitemap.xml', (req, res) => {
  const base = 'https://foriforeign.com';
  const urls = ['/', ...SEO_SLUGS.map(x => '/s/' + x), ...Object.keys(SEO_GUIDES).map(x => '/guide/' + x)];
  res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.map(u => '<url><loc>' + base + u + '</loc></url>').join('') + '</urlset>');
});
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nAllow: /\nSitemap: https://foriforeign.com/sitemap.xml\n'));
/* ---------- RBAC: my permissions + user role management ---------- */
/* ---------- Spec 35/36: Complete Opportunity Intelligence report ---------- */
app.get('/api/opportunities/:id/report', auth, async (req, res) => {
  const { data: o } = await admin().from('opportunities').select('*').eq('id', req.params.id).single();
  if (!o) return res.status(404).json({ error: 'Opportunity not found' });
  // Paywall: without entitlement, the full report (institution, official page,
  // verified contacts) stays sealed. The teaser keeps the numbers that sell.
  if (!(await entitled(req.userId, simUser(req)))) {
    let m = null; try { const { matchOpportunity } = require('./lib/match'); m = await matchOpportunity(req.userId, o.id); } catch (e) {}
    return res.status(402).json({
      locked: true,
      error: 'This opportunity is reserved for package members. Choose a package to open the institution, official page and verified contact - one case or several, your choice.',
      teaser: { ...lockTease(o), match: m ? { status: m.status, pct: m.pct } : null }
    });
  }
  // record 'viewed' (spec 41) - best effort
  admin().from('user_opportunity_history').insert({ user_id: req.userId, opportunity_id: o.id, event: 'viewed' }).then(() => {}, () => {});
  // match + eligibility gaps (spec 13/15)
  let match = null;
  try { const { matchOpportunity } = require('./lib/match'); match = await matchOpportunity(req.userId, o.id); } catch (e) {}
  // financial summary (spec 12): stated figures only + clearly-labeled living estimate
  /* We show what the opportunity GIVES: stipend, funding, fee waivers, work rights.
     We do not present living-cost estimates. They are guesses about the applicant's
     future expenses, they discourage strong candidates, and they are not what anyone is
     paying us to find out. */
  /* Make the stated pay meaningful: annualised, in its own currency, and in PKR at the
     admin rate. Derived only from what the official page says; never invented. */
  let payView = null;
  try {
    const cfgP = await siteSettings.getConfig().catch(() => siteSettings.DEFAULTS);
    const rateP = Number(cfgP.ai && cfgP.ai.usd_to_pkr) || 278;
    const { summarise } = require('./lib/pay');
    payView = summarise(o.stipend || o.funding || o.salary_note || '', rateP);
  } catch (e) {}
  const financial = {
    tuition_stated: o.tuition || null,
    application_fee_stated: o.application_fee || null,
    stipend_stated: o.stipend || null,
    funding_stated: o.funding || null,
    pay: payView,
    /* G1: an opportunity is only real if the applicant can actually take it up. Stated
       facts from the page first; the country note is general guidance, labelled as such. */
    mobility: (function () {
      const cc = String(o.country_code || '').toUpperCase();
      const NOTE = {
        GB: { visa: 'Skilled Worker or Global Talent route; sponsorship required for most roles', dependants: 'Dependants usually permitted on Skilled Worker', stay: 'Settlement possible after 5 years' },
        DE: { visa: 'EU Blue Card or research visa under a hosting agreement', dependants: 'Spouse may join and work', stay: 'Permanent residence possible after 21 to 33 months on a Blue Card' },
        SE: { visa: 'Work or doctoral residence permit', dependants: 'Family may accompany and work', stay: 'Permanent residence possible after 4 years' },
        DK: { visa: 'Researcher fast-track or Positive List scheme', dependants: 'Family may accompany and work', stay: 'Permanent residence after 8 years, sooner on some tracks' },
        NL: { visa: 'Highly Skilled Migrant or orientation year', dependants: 'Partner may work without a separate permit', stay: 'Permanent residence after 5 years' },
        CA: { visa: 'Work permit, often LMIA-exempt for research', dependants: 'Spouse usually eligible for an open work permit', stay: 'Express Entry pathway to residence' },
        AU: { visa: 'Skilled or employer-sponsored visa', dependants: 'Family may accompany', stay: 'Permanent residence pathways available' },
        US: { visa: 'H-1B, J-1 or O-1 depending on the role', dependants: 'J-2 or H-4 for family; work rights vary', stay: 'Green card sponsorship possible, long timelines' },
        AE: { visa: 'Employer-sponsored work permit and residence visa', dependants: 'Family sponsorship above a salary threshold', stay: 'Renewable residence, Golden Visa for some' },
        SA: { visa: 'Employer-sponsored Iqama', dependants: 'Family sponsorship subject to profession and salary', stay: 'Residence tied to employment' },
        QA: { visa: 'Employer-sponsored work residence permit', dependants: 'Family sponsorship above a salary threshold', stay: 'Residence tied to employment' }
      }[cc];
      if (!NOTE && !o.work_rights && !o.pr_pathway_note) return null;
      return {
        visa_route: NOTE ? NOTE.visa : null,
        dependants: NOTE ? NOTE.dependants : null,
        long_term: o.pr_pathway_note || (NOTE ? NOTE.stay : null),
        work_rights_stated: o.work_rights || null,
        note: 'General guidance for Pakistani passport holders. Immigration rules change; confirm on the official government site before you commit.'
      };
    })(),
    note: 'All figures are taken from the official source page.'
  };
  // Market band from our own verified inventory (never fabricated; only when >=2 datapoints exist)
  try {
    if (o.kind === 'work') {
      const role = /pharmac/i.test(o.title) ? 'Pharmacist' : /nurse|midwif/i.test(o.title) ? 'Nurse' : /doctor|physician|medical officer|resident|consultant/i.test(o.title) ? 'Doctor' : /dent/i.test(o.title) ? 'Dentist' : /engineer/i.test(o.title) ? 'Engineer' : /lab|technologist|technician/i.test(o.title) ? 'Lab/Allied' : null;
      if (role) {
        const band = await salaryBandFor(role, o.country_code || '');
        if (band) financial.market_band = { label: role + ' in ' + (o.country_code || ''), range: band.currency + ' ' + band.low.toLocaleString() + ' - ' + band.high.toLocaleString() + ' /month', based_on: band.n + ' verified positions in our inventory' };
      }
    }
  } catch (e) {}
  const now = Date.now(), day = 86400000;
  const freshness = (o.deadline && new Date(o.deadline).getTime() < now - day) ? 'deadline_passed'
    : (o.verified_at && now - new Date(o.verified_at).getTime() < day) ? 'verified_today'
    : (o.verified_at && now - new Date(o.verified_at).getTime() < 14 * day) ? 'verified_recently' : 'needs_reverification';
  res.json({
    opportunity: o, match, financial, freshness,
    provenance: { source_url: o.url, source_type: 'official_page', retrieved_at: o.created_at, last_verified: o.verified_at, verification: o.status }
  });
});
/* ---------- Salary intelligence: bands mined from our own verified hunts ----------
   Zero external data, zero fabrication: we aggregate the salary/stipend figures our
   agents verified on official pages. Cached 1h. */
let _salIntel = { at: 0, data: {} };
function _moneyNums(txt) {
  const out = [];
  const re = /(SAR|AED|QAR|OMR|BHD|KWD|GBP|USD|EUR|AUD|CAD|£|\$|€)\s?([\d,]{3,9})/gi;
  let m2; while ((m2 = re.exec(String(txt || '')))) { const v = parseInt(m2[2].replace(/,/g, ''), 10); if (v >= 800 && v <= 90000) out.push({ cur: m2[1].toUpperCase(), v }); }
  return out;
}
async function computeSalaryBands() {
  if (Date.now() - _salIntel.at > 3600e3) {
    const { data: rows } = await admin().from('opportunities').select('country_code,title,salary_note,stipend').eq('kind', 'work').eq('status', 'verified').limit(1000);
    const agg = {};
    for (const o of (rows || [])) {
      const role = /pharmac/i.test(o.title) ? 'Pharmacist' : /nurse|midwif/i.test(o.title) ? 'Nurse' : /doctor|physician|medical officer|resident|consultant/i.test(o.title) ? 'Doctor' : /dent/i.test(o.title) ? 'Dentist' : /engineer/i.test(o.title) ? 'Engineer' : /lab|technologist|technician/i.test(o.title) ? 'Lab/Allied' : 'Other';
      for (const n of _moneyNums((o.salary_note || '') + ' ' + (o.stipend || ''))) {
        const k = role + '|' + (o.country_code || '??') + '|' + n.cur.replace('£', 'GBP').replace('$', 'USD').replace('€', 'EUR');
        (agg[k] = agg[k] || []).push(n.v);
      }
    }
    const bands = {};
    for (const [k, vs] of Object.entries(agg)) {
      if (vs.length < 2) continue;
      vs.sort((a, b) => a - b);
      bands[k] = { low: vs[Math.floor(vs.length * .25)], high: vs[Math.floor(vs.length * .75)], n: vs.length };
    }
    _salIntel = { at: Date.now(), data: bands };
  }
  return _salIntel.data;
}
async function salaryBandFor(role, cc) {
  try {
    const data = await computeSalaryBands();
    const hit = Object.entries(data).find(([k]) => k.startsWith(role + '|' + String(cc).toUpperCase() + '|'));
    return hit ? { currency: hit[0].split('|')[2], ...hit[1] } : null;
  } catch (e) { return null; }
}
/* ForiForeign runs NO licensing service. Licensing is applied for personally, on the
   regulator's own portal, with original documents; it is slow, sensitive and nobody
   else should touch it. The tracker and the pathway product that used to live here are
   gone. What remains is the opposite question, answered below: if the applicant ALREADY
   holds a credential, identify it correctly so we can match jobs that accept it. */
app.post('/api/license/resolve', auth, async (req, res) => {
  try {
    const text = String((req.body || {}).text || '').slice(0, 120);
    const ctrys = Array.isArray((req.body || {}).countries)
      ? (req.body.countries || []).filter(c => /^[A-Za-z]{2}$/.test(String(c))).map(c => String(c).toUpperCase()).slice(0, 15) : [];
    if (!text.trim()) return res.json({ licence: null });
    const { resolveLicence } = require('./lib/licence');
    const licence = await resolveLicence(text, ctrys);
    res.json({ licence });
  } catch (e) { res.json({ licence: null }); }
});
/* Safe profile subset for the browser assistant: the exact fields a portal form needs.
   Never documents, never credentials, never payment data. */
/* Profile conflicts: where two documents disagree, the user decides. Nothing is
   auto-resolved, and the established value stays in place until they choose. */
app.get('/api/profile/conflicts', auth, async (req, res) => {
  try {
    const { data } = await admin().from('app_settings').select('value').eq('key', 'profilex:' + req.userId).single();
    const x = (data && data.value && data.value.x) || {};
    const list = (x._conflicts || []).filter(c => c && c.status !== 'resolved');
    res.json({ conflicts: list, completeness: (data && data.value && data.value.completeness) || null, sources: x._sources || [] });
  } catch (e) { res.json({ conflicts: [], completeness: null, sources: [] }); }
});
app.post('/api/profile/conflicts/resolve', auth, async (req, res) => {
  try {
    const field = String((req.body && req.body.field) || '');
    const choose = String((req.body && req.body.value) || '');
    if (!field || !choose) return res.status(400).json({ error: 'Choose which value is correct.' });
    const { data } = await admin().from('app_settings').select('value').eq('key', 'profilex:' + req.userId).single();
    const val = (data && data.value) || {}; const x = val.x || {};
    x[field] = choose;
    x._conflicts = (x._conflicts || []).map(c => c.field === field ? Object.assign({}, c, { status: 'resolved', chosen: choose }) : c);
    x._provenance = Object.assign({}, x._provenance || {}, { [field]: { source: 'user confirmed', at: new Date().toISOString(), status: 'user_confirmed' } });
    await admin().from('app_settings').upsert({ key: 'profilex:' + req.userId, value: Object.assign({}, val, { x, conflicts: x._conflicts.filter(c => c.status !== 'resolved').length }) });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/profile/assist', auth, async (req, res) => {
  try {
    const { data: pr } = await admin().from('profiles').select('*').eq('id', req.userId).single();
    if (!pr) return res.json({ profile: null });
    let licNum = '', licAuth = '', profession = '';
    try {
      const { data: pf } = await admin().from('app_settings').select('value').eq('key', 'prefs:' + req.userId).single();
      const pv = (pf && pf.value) || {};
      licAuth = (pv.licenseResolved && pv.licenseResolved.authority) || pv.licenseHeld || '';
      const { data: px } = await admin().from('app_settings').select('value').eq('key', 'profilex:' + req.userId).single();
      const x = (px && px.value && px.value.x) || {};
      licNum = x.license_number || '';
      profession = (x.professions && x.professions[0]) || x.profession || pr.field || '';
    } catch (e) {}
    res.json({ profile: {
      full_name: pr.full_name, email: pr.email, phone: pr.phone, city: pr.city, address: pr.address,
      last_institution: pr.last_institution, degree_level: pr.degree_level, field: pr.field, cgpa: pr.cgpa,
      experience_years: pr.experience_years, language_scores: pr.language_scores, linkedin: pr.linkedin,
      license_number: licNum, license_authority: licAuth, profession
    } });
  } catch (e) { res.json({ profile: null }); }
});
app.get('/api/salary-intel', auth, async (req, res) => {
  try {
    if (Date.now() - _salIntel.at > 3600e3) {
      const { data: rows } = await admin().from('opportunities').select('country_code,title,salary_note,stipend').eq('kind', 'work').eq('status', 'verified').limit(1000);
      const agg = {};
      for (const o of (rows || [])) {
        const role = /pharmac/i.test(o.title) ? 'Pharmacist' : /nurse|midwif/i.test(o.title) ? 'Nurse' : /doctor|physician|medical officer|resident|consultant/i.test(o.title) ? 'Doctor' : /dent/i.test(o.title) ? 'Dentist' : /engineer/i.test(o.title) ? 'Engineer' : /lab|technologist|technician/i.test(o.title) ? 'Lab/Allied' : 'Other';
        for (const n of _moneyNums((o.salary_note || '') + ' ' + (o.stipend || ''))) {
          const k = role + '|' + (o.country_code || '??') + '|' + n.cur.replace('£','GBP').replace('$','USD').replace('€','EUR');
          (agg[k] = agg[k] || []).push(n.v);
        }
      }
      const bands = {};
      for (const [k, vs] of Object.entries(agg)) {
        if (vs.length < 2) continue;
        vs.sort((a, b) => a - b);
        bands[k] = { low: vs[Math.floor(vs.length * .25)], high: vs[Math.floor(vs.length * .75)], n: vs.length };
      }
      _salIntel = { at: Date.now(), data: bands };
    }
    const role = String(req.query.role || ''); const cc = String(req.query.cc || '').toUpperCase();
    if (role && cc) {
      const hit = Object.entries(_salIntel.data).find(([k]) => k.startsWith(role + '|' + cc + '|'));
      return res.json({ band: hit ? { role, cc, currency: hit[0].split('|')[2], ...hit[1] } : null, source: 'ForiForeign verified inventory' });
    }
    res.json({ bands: _salIntel.data, source: 'ForiForeign verified inventory' });
  } catch (e) { res.json({ bands: {}, band: null }); }
});
/* ---------- Spec 41: save / unsave + saved list ---------- */
app.post('/api/opportunities/:id/save', auth, async (req, res) => {
  const ev = req.body && req.body.unsave ? 'unsaved' : 'saved';
  const { error } = await admin().from('user_opportunity_history').insert({ user_id: req.userId, opportunity_id: req.params.id, event: ev });
  if (error) return res.status(400).json({ error: /user_opportunity_history/.test(error.message) ? 'Run migration 0015 first' : error.message });
  res.json({ ok: true, event: ev });
});
app.get('/api/opportunities/saved/list', auth, async (req, res) => {
  const { data: hist } = await admin().from('user_opportunity_history').select('opportunity_id,event,created_at').eq('user_id', req.userId).in('event', ['saved', 'unsaved']).order('created_at', { ascending: false }).then(r => r, () => ({ data: [] }));
  const state = {}; (hist || []).forEach(h => { if (!(h.opportunity_id in state)) state[h.opportunity_id] = h.event; });
  const ids = Object.keys(state).filter(id => state[id] === 'saved');
  if (!ids.length) return res.json({ opportunities: [] });
  const { data: opps } = await admin().from('opportunities').select('*').in('id', ids);
  let list = opps || [];
  if (String(req.query.match) === '1') {
    // Never re-show what this user already chose or dismissed. Paid users keep the
    // right to fresh matches every time (premium: re-search anytime for 6 months).
    try {
      const { data: myApps } = await admin().from('applications').select('opportunity_id').eq('user_id', req.userId);
      const used = new Set((myApps || []).map(x => x.opportunity_id));
      let rej = [];
      try { const { data: rv } = await admin().from('app_settings').select('value').eq('key', 'rejected:' + req.userId).single(); rej = (rv && rv.value && rv.value.ids) || []; } catch (e) {}
      const rset = new Set(rej);
      list = list.filter(o => !used.has(o.id) && !rset.has(o.id));
    } catch (e) {}
  }
  const entOk = await entitled(req.userId, simUser(req));
  if (!entOk) list = list.map(o => lockTease(o));
  else if (String(req.query.match) === '1') {
    // Package choice model: each plan opens its own 'view' count of matched positions and
    // the buyer chooses freely among them; the rest stay reserved. Staff see everything.
    try {
      const { data: prf } = await admin().from('profiles').select('role').eq('id', req.userId).single();
      if (!(prf && ['admin', 'staff'].includes(prf.role) && !simUser(req))) {
        let tier = 0;
        const simT = simUser(req);
        if (simT) tier = simT.tier || 0;
        else try { const { data: pays } = await admin().from('payments').select('credits').eq('user_id', req.userId).eq('status', 'confirmed').order('credits', { ascending: false }).limit(1); tier = Number(pays && pays[0] && pays[0].credits) || 0; } catch (e) {}
        // Package-first model: the user's real available credits decide the reveal.
        // 0 credits -> nothing is unlocked; they see the analysis and choose a package.
        // After confirmation, their tier reveals its configured 'view' count, best first.
        const bal = await balance(req.userId);
        const effectiveTier = Math.max(tier, bal);
        const pv2 = o => (o.match && o.match.pct != null) ? o.match.pct : -1;
        if (effectiveTier < 1) {
          list = list.map(o => lockTease(o));  // convince with the analysis; reveal after purchase
        } else {
          // Visibility from admin-editable packages: find the tier whose credits the user
          // holds and show its 'view' count.
          let visible = 5;
          try {
            const cfg = await require('./lib/settings').getConfig();
            const tiers = ((cfg.packages && cfg.packages.tiers) || []).slice().sort((a, b) => (a.credits || 0) - (b.credits || 0));
            let picked = null;
            for (const t of tiers) if (effectiveTier >= (t.credits || 0)) picked = t;
            visible = picked ? (picked.view || picked.credits || 5) : (tiers[0] ? (tiers[0].view || 5) : 5);
          } catch (e) { visible = effectiveTier >= 10 ? 20 : effectiveTier >= 5 ? 8 : 5; }
          const open = new Set([...list].sort((x, y) => pv2(y) - pv2(x)).slice(0, visible).map(o => o.id));
          list = list.map(o => open.has(o.id) ? o : lockTease(o));
        }
      }
    } catch (e) {}
  }
  // Tell the client honestly if we widened the net, so the wording matches reality.
  res.json({ opportunities: list, relaxed: req._relaxNote || null, broadened: !!req._broadened,
    searches_left: (req._searchLeft || {}).day, search_limit: (req._searchLeft || {}).limit, searches_used: (req._searchLeft || {}).used });
});
/* ---------- Spec 2: configurable university database (admin) ---------- */
app.get('/api/admin/universities', auth, perm('countries.read'), async (req, res) => {
  let q = admin().from('universities').select('*').order('country_code').order('priority');
  if (req.query.country) q = q.eq('country_code', String(req.query.country).toUpperCase());
  const { data } = await q.then(r => r, () => ({ data: [] }));
  res.json({ universities: data || [] });
});
/* Import a country's institutions from an uploaded Excel/CSV/Word file.
   Extracts {name, official email} pairs; AI enrichment fills the rest in background. */
app.post('/api/admin/universities/import', auth, perm('countries.write'), up.single('file'), async (req, res) => {
  const cc = String(req.body && req.body.country_code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return res.status(400).json({ error: 'Valid ISO2 country code required' });
  if (!req.file) return res.status(400).json({ error: 'Attach an .xlsx, .csv or .docx file' });
  const ext = (req.file.originalname || '').toLowerCase().split('.').pop();
  const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
  let lines = [];
  try {
    if (['xlsx', 'xlsm', 'csv', 'tsv'].includes(ext)) {
      // Dependency-free reader (lib/sheet.js) — removes the vulnerable xlsx package.
      const { readRows } = require('./lib/sheet');
      const rows = readRows(req.file.buffer, ext);
      lines = rows.map(r => (r || []).map(c => String(c == null ? '' : c).trim()).filter(Boolean).join(' , '));
    } else if (ext === 'docx') {
      const AdmZip = require('adm-zip');
      const xml = new AdmZip(req.file.buffer).readAsText('word/document.xml') || '';
      lines = xml.replace(/<w:p[ >]/g, '\n<').replace(/<[^>]+>/g, ' ').split('\n').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    } else if (ext === 'txt') {
      lines = req.file.buffer.toString('utf8').split(/\r?\n/);
    } else return res.status(400).json({ error: 'Use .xlsx, .csv, .docx or .txt' });
  } catch (e) { return res.status(400).json({ error: 'Could not read the file: ' + e.message }); }
  const rows = [];
  for (const raw of lines.slice(0, 400)) {
    const line = String(raw).trim(); if (line.length < 3) continue;
    const em = (line.match(EMAIL) || [])[0] || null;
    const name = line.replace(EMAIL, '').replace(/[,;|\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (name.length >= 3 && !/^(name|university|institution|email|s\.?no)/i.test(name)) rows.push({ name, email: em });
  }
  if (!rows.length) return res.status(400).json({ error: 'No institution rows recognised in the file' });
  const { data: existing } = await admin().from('universities').select('id,name').eq('country_code', cc);
  const byName = new Map((existing || []).map(u => [u.name.toLowerCase(), u.id]));
  let created = 0, updated = 0, pri = (existing || []).length;
  for (const r of rows.slice(0, 200)) {
    const id = byName.get(r.name.toLowerCase());
    if (id) { await admin().from('universities').update({ official_email: r.email || undefined, enabled: true }).eq('id', id); updated++; }
    else { pri++; await admin().from('universities').insert({ country_code: cc, name: r.name, official_email: r.email, priority: pri, enabled: true }); created++; }
  }
  await admin().from('audit_log').insert({ actor: req.userId, event: 'UNILIST_IMPORT', detail: cc + ': +' + created + ' new, ' + updated + ' updated from ' + ext }).then(() => {}, () => {});
  // AI enrichment runs in the background: latest admissions, fees, intakes, news.
  require('./lib/jobs').runJob('discover', 'uni-enrich:' + cc + ':' + Date.now(), req.userId, () => enrichUniversities(cc, 8), { retries: 0, timeoutMs: 480000 });
  res.json({ ok: true, created, updated, enriching: true });
});
/* AI enrichment: for each institution, pull the latest verifiable picture. */
async function enrichUniversities(cc, limit) {
  const { data: unis } = await admin().from('universities').select('id,name,official_email,info_updated_at').eq('country_code', cc).eq('enabled', true)
    .order('info_updated_at', { ascending: true, nullsFirst: true }).limit(limit || 6);
  if (!unis || !unis.length) return 0;
  const { callAI } = require('./lib/router');
  const { parseJSON } = require('./lib/engine');
  const prompt = 'For EACH institution below, search its OFFICIAL website and report the latest verifiable facts. Respond ONLY with a JSON array, one object per institution, schema: [{"name":"exact name given","admissions_open":"what is currently open, or empty","next_intake":"","application_fee":"","tuition_range":"","scholarships":"named scholarships available","latest_note":"one line of recent relevant news","admissions_email":"only if printed on the official site"}]. Facts literally on official pages only; leave unknown fields empty.\nINSTITUTIONS (' + cc + '):\n' + unis.map(u => '- ' + u.name).join('\n');
  const txt = await callAI('search_verify', prompt, { search: true, urls: true, maxTokens: 3200, userId: null });
  const arr = parseJSON(txt) || [];
  let n = 0;
  for (const it of arr) {
    const u = unis.find(x => x.name.toLowerCase() === String(it.name || '').toLowerCase()) || unis.find(x => String(it.name || '').toLowerCase().includes(x.name.toLowerCase().slice(0, 12)));
    if (!u) continue;
    const info = { admissions_open: it.admissions_open || '', next_intake: it.next_intake || '', application_fee: it.application_fee || '', tuition_range: it.tuition_range || '', scholarships: it.scholarships || '', latest_note: it.latest_note || '' };
    const patch = { info, info_updated_at: new Date().toISOString() };
    if (!u.official_email && /@/.test(String(it.admissions_email || ''))) patch.official_email = String(it.admissions_email).slice(0, 140);
    await admin().from('universities').update(patch).eq('id', u.id); n++;
  }
  return n;
}
app.post('/api/admin/universities/enrich', auth, perm('countries.write'), async (req, res) => {
  const cc = String(req.body && req.body.country_code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return res.status(400).json({ error: 'Valid ISO2 country code required' });
  require('./lib/jobs').runJob('discover', 'uni-enrich:' + cc + ':' + Date.now(), req.userId, () => enrichUniversities(cc, 8), { retries: 0, timeoutMs: 480000 });
  res.json({ ok: true, message: 'AI is refreshing this country now; check back in a few minutes.' });
});
app.post('/api/admin/universities/bulk', auth, perm('countries.write'), async (req, res) => {
  const cc = String(req.body && req.body.country_code || '').toUpperCase();
  const names = Array.isArray(req.body && req.body.names) ? req.body.names.map(n => String(n).trim().slice(0, 120)).filter(Boolean).slice(0, 200) : [];
  if (!/^[A-Z]{2}$/.test(cc)) return res.status(400).json({ error: 'Valid ISO2 country code required' });
  // Replace semantics: saving a country's list replaces its previous list, priorities follow line order.
  await admin().from('universities').delete().eq('country_code', cc);
  if (names.length) {
    const rows = names.map((name, i) => ({ country_code: cc, name, priority: i + 1, enabled: true }));
    const { error } = await admin().from('universities').insert(rows);
    if (error) return res.status(400).json({ error: error.message });
  }
  await admin().from('audit_log').insert({ actor: req.userId, event: 'UNILIST_SAVE', detail: cc + ': ' + names.length + ' institutions' }).then(() => {}, () => {});
  res.json({ ok: true, saved: names.length });
});
app.delete('/api/admin/universities/:id', auth, perm('countries.write'), async (req, res) => {
  const { error } = await admin().from('universities').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});
app.post('/api/admin/universities', auth, perm('countries.write'), async (req, res) => {
  const b = req.body || {};
  const cc = String(b.country_code || '').toUpperCase().slice(0, 2);
  const name = String(b.name || '').trim().slice(0, 160);
  if (!cc || !name) return res.status(400).json({ error: 'country_code and name required' });
  const { error } = await admin().from('universities').upsert({ country_code: cc, name, priority: parseInt(b.priority) || 100, enabled: b.enabled !== false }, { onConflict: 'country_code,name' });
  if (error) return res.status(400).json({ error: /universities/.test(error.message) ? 'Run migration 0015 first' : error.message });
  await admin().from('audit_log').insert({ actor: req.userId, event: 'UNIVERSITY_UPSERT', detail: cc + ' ' + name }).then(() => {}, () => {});
  res.json({ ok: true });
});
app.post('/api/admin/universities/:id/toggle', auth, perm('countries.write'), async (req, res) => {
  const { data: u } = await admin().from('universities').select('enabled').eq('id', req.params.id).single();
  if (!u) return res.status(404).json({ error: 'Not found' });
  const { error } = await admin().from('universities').update({ enabled: !u.enabled }).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true, enabled: !u.enabled });
});
app.get('/api/admin/applications', auth, perm('overview.read'), async (req, res) => {
  const status = String(req.query.status || '');
  let q = admin().from('applications').select('id,user_id,status,created_at,submission_status,opportunity_id,opportunities(title,org,country_code,kind)').order('created_at', { ascending: false }).limit(100);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) { // relation join may differ; fall back to plain select
    const { data: plain } = await admin().from('applications').select('*').order('created_at', { ascending: false }).limit(100);
    return res.json({ applications: plain || [] });
  }
  // attach user names in one query
  const ids = [...new Set((data || []).map(a => a.user_id))];
  const { data: profs } = ids.length ? await admin().from('profiles').select('id,full_name').in('id', ids) : { data: [] };
  const nameOf = Object.fromEntries((profs || []).map(p => [p.id, p.full_name]));
  res.json({ applications: (data || []).map(a => ({ ...a, user_name: nameOf[a.user_id] || '' })) });
});
app.get('/api/admin/payments', auth, perm('payments.read'), async (req, res) => {
  const status = String(req.query.status || '');
  let q = admin().from('payments').select('*').order('created_at', { ascending: false }).limit(100);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  const ids = [...new Set((data || []).map(p => p.user_id))];
  const { data: profs } = ids.length ? await admin().from('profiles').select('id,full_name').in('id', ids) : { data: [] };
  const nameOf = Object.fromEntries((profs || []).map(p => [p.id, p.full_name]));
  res.json({ payments: (data || []).map(p => ({ ...p, user_name: nameOf[p.user_id] || '' })) });
});
app.get('/api/admin/me', auth, staffOnly, async (req, res) => {
  const { permissionsFor, ROLE_PERMISSIONS } = require('./lib/rbac');
  res.json({ role: req.userRole, permissions: [...permissionsFor(req.userRole)], roles: Object.keys(ROLE_PERMISSIONS) });
});
app.get('/api/admin/settings/export', auth, perm('settings.write'), async (req, res) => {
  try {
    const cfg = await siteSettings.getConfig(true);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="foriforeign-settings-backup.json"');
    res.send(JSON.stringify(cfg, null, 2));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/admin/users', auth, perm('users.read'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  let query = admin().from('profiles').select('id,full_name,role,created_at,whatsapp').order('created_at', { ascending: false }).limit(100);
  if (q) query = query.ilike('full_name', '%' + q + '%');
  const { data } = await query;
  res.json({ users: data || [] });
});
app.delete('/api/admin/users/:id', auth, perm('users.write'), async (req, res) => {
  try {
    const targetId = req.params.id;
    if (targetId === req.userId) return res.status(400).json({ error: 'You cannot delete your own account.' });
    const { data: target } = await admin().from('profiles').select('id, full_name, role').eq('id', targetId).single();
    if (!target) return res.status(404).json({ error: 'User not found.' });
    // Protect owner and other super_admins from deletion.
    if (target.role === 'super_admin') return res.status(403).json({ error: 'A super admin account cannot be deleted here.' });
    // Remove the user's data across the app, then the auth account.
    for (const tbl of ['application_documents', 'applications', 'documents', 'credit_ledger', 'payments', 'support_tickets', 'profile_fields']) {
      try { await admin().from(tbl).delete().eq('user_id', targetId); } catch (e) {}
    }
    try { await admin().from('app_settings').delete().eq('key', 'profilex:' + targetId); } catch (e) {}
    try { await admin().from('app_settings').delete().eq('key', 'prefs:' + targetId); } catch (e) {}
    // Remove their uploaded files from storage as well, not just the rows.
    try {
      const { BUCKET } = require('./lib/docs');
      const { data: files } = await admin().storage.from(BUCKET).list(targetId, { limit: 200 });
      if (files && files.length) await admin().storage.from(BUCKET).remove(files.map(f => targetId + '/' + f.name));
      const { data: tf } = await admin().storage.from(BUCKET).list(targetId + '/tailored', { limit: 200 });
      if (tf && tf.length) await admin().storage.from(BUCKET).remove(tf.map(f => targetId + '/tailored/' + f.name));
    } catch (e) {}
    try { await admin().from('profiles').delete().eq('id', targetId); } catch (e) {}
    try { await admin().auth.admin.deleteUser(targetId); } catch (e) {}
    try { await admin().from('audit_log').insert({ actor: req.userId, event: 'USER_DELETED', detail: 'Deleted user ' + (target.full_name || targetId) }); } catch (e) {}
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
/* Every admin needs a working allowance so they can prepare and inspect real cases.
   Granted once per account, idempotently, whether they were promoted today or long ago. */
const ADMIN_ALLOWANCE = 999;
async function ensureAdminAllowance(userId) {
  try {
    const { data: prior } = await admin().from('credit_ledger')
      .select('id').eq('user_id', userId).eq('reason', 'admin_allowance').limit(1);
    if (prior && prior.length) return false;
    const bal = await balance(userId);
    const top = ADMIN_ALLOWANCE - bal;
    if (top <= 0) return false;
    await admin().from('credit_ledger').insert({
      user_id: userId, delta: top, reason: 'admin_allowance',
      note: 'Admin working allowance (' + ADMIN_ALLOWANCE + ' cases)'
    });
    return true;
  } catch (e) { return false; }
}
app.post('/api/admin/users/:id/role', auth, perm('users.write'), async (req, res) => {
  const { ROLE_PERMISSIONS } = require('./lib/rbac');
  const role = String(req.body && req.body.role || '');
  if (!(role in ROLE_PERMISSIONS)) return res.status(400).json({ error: 'Unknown role' });
  // Only a super_admin (or legacy admin) may grant admin-level roles.
  const grantorFull = ['super_admin', 'admin'].includes(req.userRole);
  const grantingAdmin = require('./lib/rbac').isAdminRole(role) && role !== 'user';
  if (grantingAdmin && !grantorFull) return res.status(403).json({ error: 'Only a super admin can assign admin roles' });
  if (req.params.id === req.userId && role === 'user') return res.status(400).json({ error: 'You cannot remove your own admin access' });
  const { error } = await admin().from('profiles').update({ role }).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  // A newly promoted admin receives the working allowance immediately.
  let granted = false;
  if (grantingAdmin) granted = await ensureAdminAllowance(req.params.id);
  await admin().from('audit_log').insert({ actor: req.userId, event: 'ROLE_CHANGED', detail: req.params.id + ' -> ' + role + (granted ? ' (+' + ADMIN_ALLOWANCE + ' cases)' : '') }).then(() => {}, () => {});
  res.json({ ok: true, allowance_granted: granted });
});
app.post('/api/support', auth, async (req, res) => {
  const subject = String((req.body && req.body.subject) || '').slice(0, 160);
  const message = String((req.body && req.body.message) || '').slice(0, 4000);
  if (!subject || !message) return res.status(400).json({ error: 'Subject and message are required' });
  const { data, error } = await admin().from('support_tickets').insert({
    user_id: req.userId, email: req.userEmail, subject, message, status: 'new'
  }).select().single();
  if (error) return res.status(400).json({ error: /support_tickets|relation/.test(error.message) ? 'Support is not set up yet (run migration 0013)' : error.message });
  res.json({ ok: true, ticket: { id: data.id } });
});
app.get('/api/support/mine', auth, async (req, res) => {
  const { data } = await admin().from('support_tickets').select('*').eq('user_id', req.userId).order('created_at', { ascending: false }).then(r => r, () => ({ data: [] }));
  res.json({ tickets: data || [] });
});
app.get('/api/admin/support', auth, perm('support.read'), async (req, res) => {
  const status = String(req.query.status || '');
  let q = admin().from('support_tickets').select('*').order('created_at', { ascending: false }).limit(100);
  if (['new', 'open', 'waiting', 'answered', 'resolved', 'closed'].includes(status)) q = q.eq('status', status);
  const { data } = await q.then(r => r, () => ({ data: [] }));
  res.json({ tickets: data || [] });
});
app.post('/api/admin/support/:id', auth, perm('support.write'), async (req, res) => {
  const patch = {};
  if (req.body && typeof req.body.reply === 'string') patch.reply = req.body.reply.slice(0, 4000);
  if (req.body && ['new', 'open', 'waiting', 'answered', 'resolved', 'closed'].includes(req.body.status)) patch.status = req.body.status;
  if (patch.reply && !patch.status) patch.status = 'answered'; // a reply is a notification
  if (req.body && typeof req.body.internal_note === 'string') patch.internal_note = req.body.internal_note.slice(0, 2000);
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  patch.updated_at = new Date().toISOString();
  const { error } = await admin().from('support_tickets').update(patch).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  await admin().from('audit_log').insert({ actor: req.userId, event: 'SUPPORT_UPDATE', detail: req.params.id + ' ' + JSON.stringify(patch).slice(0, 200) }).then(() => {}, () => {});
  res.json({ ok: true });
});
app.post('/api/support/seen', auth, async (req, res) => {
  await admin().from('support_tickets').update({ status: 'resolved', updated_at: new Date().toISOString() }).eq('user_id', req.userId).eq('status', 'answered').then(() => {}, () => {});
  res.json({ ok: true });
});
/* Approve a user-submitted review ticket straight onto the public homepage. */
/* SITE-WIDE FREE PROMO: admin opens a limited window (e.g. 48h); every user who
   claims during it gets exactly 1 free case, once per promo. */
app.post('/api/admin/promo', auth, perm('settings.write'), async (req, res) => {
  try {
    const hours = Math.max(1, Math.min(168, parseInt(req.body && req.body.hours, 10) || 48));
    const ends = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    await admin().from('app_settings').upsert({ key: 'free_promo', value: { active: true, started_at: new Date().toISOString(), ends_at: ends, hours } });
    await admin().from('audit_log').insert({ actor: req.userId, event: 'PROMO_START', detail: hours + 'h free case, ends ' + ends }).then(() => {}, () => {});
    res.json({ ok: true, ends_at: ends });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/admin/promo/stop', auth, perm('settings.write'), async (req, res) => {
  try {
    await admin().from('app_settings').upsert({ key: 'free_promo', value: { active: false, stopped_at: new Date().toISOString() } });
    await admin().from('audit_log').insert({ actor: req.userId, event: 'PROMO_STOP', detail: 'manual stop' }).then(() => {}, () => {});
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
async function activePromo() {
  try {
    const { data } = await admin().from('app_settings').select('value').eq('key', 'free_promo').single();
    const v = data && data.value;
    if (v && v.active && v.ends_at && new Date(v.ends_at) > new Date()) return v;
  } catch (e) {}
  return null;
}
const _promoHits = new Map();
app.post('/api/promo/claim', auth, (req, res) => withUserLock(req.userId, () => claimPromo(req, res)));
async function claimPromo(req, res) {
  try {
    // Light abuse guard on top of the once-per-promo ledger check.
    const n = (_promoHits.get(req.userId) || 0) + 1; _promoHits.set(req.userId, n);
    if (_promoHits.size > 5000) _promoHits.clear();
    if (n > 8) return res.status(429).json({ error: 'Too many attempts. Please refresh and try again.' });
    if (simUser(req)) return res.status(400).json({ error: 'Exit user-view simulation to claim on your real account.' });
    const promo = await activePromo();
    if (!promo) return res.status(400).json({ error: 'No free promo is running right now.' });
    const note = 'promo:' + promo.ends_at;
    const { data: prior } = await admin().from('credit_ledger').select('id').eq('user_id', req.userId).eq('note', note).limit(1);
    if (prior && prior.length) return res.status(409).json({ error: 'You already claimed this promo. Enjoy your free case!' });
    await admin().from('credit_ledger').insert({ user_id: req.userId, delta: 1, reason: 'promo_grant', note });
    await admin().from('audit_log').insert({ actor: req.userId, event: 'PROMO_CLAIM', detail: note }).then(() => {}, () => {});
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
}
/* Free case grant from support: one tap approves 1 case for the requester
   (idempotent per ticket), replies warmly, and the user can apply immediately. */
app.post('/api/admin/support/:id/grant-free-case', auth, perm('support.write'), async (req, res) => {
  try {
    const { data: t } = await admin().from('support_tickets').select('*').eq('id', req.params.id).single();
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    if (!t.user_id) return res.status(400).json({ error: 'Ticket has no linked user' });
    const grantNote = 'Free case via support ' + t.id;
    const { data: prior } = await admin().from('credit_ledger').select('id').eq('user_id', t.user_id).eq('note', grantNote).limit(1);
    if (prior && prior.length) return res.status(409).json({ error: 'Already granted for this ticket' });
    await admin().from('credit_ledger').insert({ user_id: t.user_id, delta: 1, reason: 'support_grant', note: grantNote });
    const reply = 'Good news! We have added 1 free case to your account as a one-time gift. Run your search, view your best matches and choose the one you want, your case will be prepared completely, end to end. We wish you success!';
    await admin().from('support_tickets').update({ reply, status: 'answered', handled_by: req.userId }).eq('id', req.params.id);
    await admin().from('audit_log').insert({ actor: req.userId, event: 'SUPPORT_GRANT_SOLO', detail: 'ticket ' + t.id + ' -> user ' + t.user_id }).then(() => {}, () => {});
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/admin/support/:id/decline-free', auth, perm('support.write'), async (req, res) => {
  try {
    const reply = 'Thank you for asking! Free packages are offered only occasionally, and we cannot add one this time. The Basic plan costs less than one restaurant dinner and prepares your complete case end to end, and every payment supports the free CV analysis we give everyone. We would love to prepare your case whenever you are ready.';
    await admin().from('support_tickets').update({ reply, status: 'answered', handled_by: req.userId }).eq('id', req.params.id);
    await admin().from('audit_log').insert({ actor: req.userId, event: 'SUPPORT_DECLINE_FREE', detail: 'ticket ' + req.params.id }).then(() => {}, () => {});
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/admin/support/:id/approve-review', auth, perm('reviews.write'), async (req, res) => {
  const { data: t } = await admin().from('support_tickets').select('*').eq('id', req.params.id).single();
  if (!t) return res.status(404).json({ error: 'Not found' });
  const { data: pr } = await admin().from('profiles').select('full_name').eq('id', t.user_id).single();
  const stars = (String(t.subject).match(/★(\d)/) || [])[1];
  const cfg = await siteSettings.getConfig();
  cfg.reviews = Array.isArray(cfg.reviews) ? cfg.reviews : [];
  cfg.reviews.unshift({ name: (pr && pr.full_name ? pr.full_name.split(' ')[0] : 'Client'), country: '', stars: Number(stars) || 5, text: String(t.message).slice(0, 200), note: String(req.body && req.body.note || '').slice(0, 60), visible: true });
  cfg.reviews = cfg.reviews.slice(0, 12);
  await admin().from('app_settings').upsert({ key: 'site_config', value: cfg });
  await admin().from('support_tickets').update({ status: 'resolved', reply: t.reply || 'Thank you! Your review is now live on our homepage.', updated_at: new Date().toISOString() }).eq('id', t.id);
  res.json({ ok: true });
});
/* ---------- Business: expenses + monthly profit & loss (full admin control) ---------- */
app.get('/api/admin/expenses', auth, perm('aicost.read'), async (req, res) => {
  const { data } = await admin().from('app_settings').select('value').eq('key', 'expenses').single().then(r => r, () => ({ data: null }));
  res.json({ items: (data && data.value && data.value.items) || [] });
});
app.put('/api/admin/expenses', auth, perm('settings.write'), async (req, res) => {
  const items = Array.isArray(req.body && req.body.items) ? req.body.items.slice(0, 40).map(x => ({
    name: String(x.name || '').slice(0, 60),
    amount: Math.max(0, Number(x.amount) || 0),
    currency: ['USD', 'PKR'].includes(x.currency) ? x.currency : 'PKR',
    period: ['monthly', 'yearly'].includes(x.period) ? x.period : 'monthly'
  })).filter(x => x.name && x.amount > 0) : [];
  await admin().from('app_settings').upsert({ key: 'expenses', value: { items } });
  res.json({ ok: true, saved: items.length });
});
app.get('/api/admin/pnl', auth, perm('aicost.read'), async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : new Date().toISOString().slice(0, 7);
  const cfg = await siteSettings.getConfig().catch(() => ({}));
  const rate = Number(cfg.ai && cfg.ai.usd_to_pkr) || 278;
  const out = { month, rate, income_pkr: 0, ai_cost_pkr: 0, fixed_pkr: 0, items: [], formulas: {} };
  try {
    const { data: pays } = await admin().from('payments').select('*').eq('status', 'confirmed').gte('confirmed_at', month + '-01').lt('confirmed_at', month + '-31T23:59:59Z');
    out.income_pkr = (pays || []).reduce((sm, p2) => sm + (Number(p2.amount_pkr || p2.amount || p2.price_pkr || 0)), 0);
  } catch (e) {}
  try {
    const { data: ai } = await admin().from('ai_cost_ledger').select('cost_usd,created_at').gte('created_at', month + '-01').lt('created_at', month + '-31T23:59:59Z');
    out.ai_cost_pkr = Math.round((ai || []).reduce((sm, r2) => sm + Number(r2.cost_usd || 0), 0) * rate);
  } catch (e) {}
  try {
    const { data: ex } = await admin().from('app_settings').select('value').eq('key', 'expenses').single();
    const items = (ex && ex.value && ex.value.items) || [];
    out.items = items.map(x => {
      const monthly = x.period === 'yearly' ? x.amount / 12 : x.amount;
      const pkr = Math.round(x.currency === 'USD' ? monthly * rate : monthly);
      out.fixed_pkr += pkr;
      return { ...x, monthly_pkr: pkr };
    });
  } catch (e) {}
  out.total_expense_pkr = out.fixed_pkr + out.ai_cost_pkr;
  out.profit_pkr = out.income_pkr - out.total_expense_pkr;
  out.formulas = {
    monthly_share: 'yearly amount / 12; USD amounts x rate (' + rate + ')',
    total_expense: 'fixed monthly shares + AI cost of the month',
    profit: 'confirmed payments of the month - total expense'
  };
  res.json(out);
});
/* One-click AI engine diagnostic: proves key, models, and search grounding live. */
/* DEEP AI DIAGNOSIS: probes EVERY model in the chain individually with a real
   grounded call, runs one real discovery-style call end to end, checks ingest
   verdicts per item, and returns the last error_log rows. One screenshot = truth. */
app.get('/api/admin/ai-deepcheck', auth, perm('aicost.read'), async (req, res) => {
  const out = { build: FF_BUILD, probes: [], discovery: null, recent_errors: [] };
  const key = process.env.GEMINI_API_KEY;
  const { MODEL, FALLBACK } = require('./lib/gemini');
  const chain = [...new Set([MODEL(), FALLBACK && FALLBACK(), 'gemini-3.6-flash'].filter(Boolean))];
  // 1) Per-model grounded probe: which models exist, which support search, which are overloaded.
  await Promise.all(chain.map(async m => {
    const t0 = Date.now();
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 45000);
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent?key=' + key, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with exactly: OK' }] }], tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: 30 } }),
        signal: ctl.signal });
      clearTimeout(tm);
      const d = await r.json().catch(() => ({}));
      out.probes.push({ model: m, status: r.status, ms: Date.now() - t0,
        ok: r.ok, error: r.ok ? null : String(d && d.error && d.error.message || '').slice(0, 220),
        sample: r.ok ? String(((d.candidates || [])[0] || {}).content && d.candidates[0].content.parts && d.candidates[0].content.parts.map(p => p.text || '').join('') || '').slice(0, 40) : null });
    } catch (e) { out.probes.push({ model: m, ok: false, ms: Date.now() - t0, error: e.name === 'AbortError' ? 'slow right now (>45s); the cascade skips to the next model automatically' : String(e.message).slice(0, 160) }); }
  }));
  out.probes.sort((a, b) => String(a.model).localeCompare(String(b.model)));
  // CLAUDE probe: the premium writing lane, exactly as case preparation uses it.
  if (process.env.ANTHROPIC_API_KEY) {
    const t0 = Date.now();
    try {
      const { anthropicCall, AMODEL } = require('./lib/anthropic');
      const a = await anthropicCall('Reply with exactly: OK', { maxTokens: 20, timeoutMs: 30000 });
      out.probes.push({ model: 'CLAUDE:' + a.model, status: 200, ms: Date.now() - t0, ok: true, sample: String(a.text || '').slice(0, 20) });
    } catch (e) { out.probes.push({ model: 'CLAUDE:' + require('./lib/anthropic').AMODEL(), ok: false, ms: Date.now() - t0, error: String(e.message).slice(0, 200) }); }
  } else out.probes.push({ model: 'CLAUDE premium lane', ok: false, error: 'ANTHROPIC_API_KEY not set in Railway' });
  // OpenAI grounded backup probe
  if (process.env.OPENAI_API_KEY) {
    const t0 = Date.now(); const bm = process.env.OPENAI_BACKUP_MODEL || 'gpt-5.4-mini';
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 25000);
      const r = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
        body: JSON.stringify({ model: bm, tools: [{ type: 'web_search' }], input: 'Reply with exactly: OK', max_output_tokens: 30 }), signal: ctl.signal });
      clearTimeout(tm);
      const d = await r.json().catch(() => ({}));
      out.probes.push({ model: 'OPENAI:' + bm, status: r.status, ms: Date.now() - t0, ok: r.ok,
        error: r.ok ? null : String(d && d.error && d.error.message || '').slice(0, 220) });
    } catch (e) { out.probes.push({ model: 'OPENAI backup', ok: false, error: String(e.message).slice(0, 160) }); }
  } else out.probes.push({ model: 'OPENAI backup', ok: false, error: 'OPENAI_API_KEY not set' });
  // 2) One REAL discovery-style call through the actual pipeline (callAI -> cascade -> backup)
  try {
    const { callAI } = require('./lib/router');
    const { parseJSON, ingestOpps } = require('./lib/engine');
    const t0 = Date.now();
    const txt = await callAI('search_verify',
      'Find 2 currently-open, fully funded masters or PhD scholarships in Germany or Turkiye for international students. Verify each on its OFFICIAL page. Respond ONLY with a JSON array: [{"title":"","institution":"","country_code":"ISO2","url":"official page url","deadline":"YYYY-MM-DD or empty","funding":"","funding_type":"fully","level":"masters|phd"}]',
      { search: true, urls: true, maxTokens: 1800, userId: req.userId });
    let items = parseJSON(txt) || [];
    if (!Array.isArray(items)) items = [items];
    const verdicts = items.map(it => ({
      institution: String(it.institution || '').slice(0, 60),
      url_ok: /^https?:\/\//.test(String(it.url || '')),
      has_title: !!it.title, has_institution: !!it.institution,
      deadline: it.deadline || null
    }));
    const added = await ingestOpps(items, 'study', req.userId);
    out.discovery = { ok: true, ms: Date.now() - t0, raw_first_300: String(txt || '').slice(0, 300), parsed: items.length, verdicts, added_to_db: added };
  } catch (e) { out.discovery = { ok: false, error: String(e.message).slice(0, 300) }; }
  // 3) Recent pipeline errors
  try { const { data: errs } = await admin().from('error_log').select('created_at,area,message').order('created_at', { ascending: false }).limit(12);
    out.recent_errors = (errs || []).map(x => ({ t: String(x.created_at).slice(5, 16), area: x.area, msg: String(x.message || '').slice(0, 140) })); } catch (e) {}
  res.json(out);
});
app.get('/api/admin/ai-selftest', auth, perm('aicost.read'), async (req, res) => {
  const { geminiCall } = require('./lib/gemini');
  const out = { plain: null, grounded: null };
  const run = async (name, opts) => {
    const t0 = Date.now();
    try {
      const r = await geminiCall(name === 'plain' ? 'Reply with exactly: OK' : 'Search the web for the official website of MIT and reply with just its domain.', opts);
      return { ok: true, ms: Date.now() - t0, model: r.model || null, sample: String(r.text || '').slice(0, 60) };
    } catch (e) { return { ok: false, ms: Date.now() - t0, error: String(e.message).slice(0, 200) }; }
  };
  const claudeRun = async () => {
    if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: 'ANTHROPIC_API_KEY not set' };
    const t0 = Date.now();
    try { const { anthropicCall } = require('./lib/anthropic'); const a = await anthropicCall('Reply with exactly: OK', { maxTokens: 20, timeoutMs: 25000 }); return { ok: true, ms: Date.now() - t0, model: a.model }; }
    catch (e) { return { ok: false, ms: Date.now() - t0, error: String(e.message).slice(0, 160) }; }
  };
  // All three probes fly in PARALLEL: total time = slowest, not the sum.
  const [plain, grounded, claude] = await Promise.all([
    run('plain', { maxTokens: 20, thinking: 'low' }),
    run('grounded', { maxTokens: 100, thinking: 'low', search: true }),
    claudeRun()
  ]);
  out.plain = plain; out.grounded = grounded; out.claude = claude;
  out.backup = { configured: !!process.env.OPENAI_API_KEY, model: process.env.OPENAI_BACKUP_MODEL || 'gpt-5.4-mini (default)' };
  res.json(out);
});
app.get('/api/admin/ai-costs', auth, perm('aicost.read'), async (req, res) => {
  try {
    const cfg = await siteSettings.getConfig();
    const rate = Number(cfg.ai && cfg.ai.usd_to_pkr) || 278;
    const { data: rows } = await admin().from('ai_cost_ledger').select('cost_usd,provider,model,purpose,created_at,application_id').order('created_at', { ascending: false }).limit(5000);
    const all = rows || [];
    const sum = arr => arr.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
    const totalUsd = sum(all);
    const today = new Date().toISOString().slice(0, 10);
    const monthPrefix = today.slice(0, 7);
    const todayUsd = sum(all.filter(r => (r.created_at || '').slice(0, 10) === today));
    const monthUsd = sum(all.filter(r => (r.created_at || '').slice(0, 7) === monthPrefix));
    // by provider/model
    const byModel = {};
    all.forEach(r => { const k = (r.provider || '?') + '/' + (r.model || '?'); byModel[k] = (byModel[k] || 0) + Number(r.cost_usd || 0); });
    // per-case: distinct application_ids that incurred cost
    const caseIds = new Set(all.filter(r => r.application_id).map(r => r.application_id));
    const perCaseUsd = caseIds.size ? sum(all.filter(r => r.application_id)) / caseIds.size : 0;
    const toPkr = u => Math.round(u * rate);
    const override = Number(cfg.ai && cfg.ai.pkr_override_per_case);
    res.json({
      rate,
      usd: { total: totalUsd.toFixed(4), today: todayUsd.toFixed(4), month: monthUsd.toFixed(4), perCase: perCaseUsd.toFixed(4) },
      pkr: {
        total: toPkr(totalUsd), today: toPkr(todayUsd), month: toPkr(monthUsd),
        perCase: (isFinite(override) && override > 0) ? override : toPkr(perCaseUsd),
        perCaseIsOverride: (isFinite(override) && override > 0)
      },
      byModelPkr: Object.fromEntries(Object.entries(byModel).map(([k, u]) => [k, toPkr(u)])),
      cases: caseIds.size,
      note: 'PKR is computed from provider USD estimates at the admin-set exchange rate. Treat as an estimate, not an exact bill.'
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// Historical purchases are never rewritten: payments store their own amount_pkr at
// purchase time, so editing packs here only affects future purchases.
app.get('/api/admin/packages', auth, perm('packages.read'), async (req, res) => {
  const { data } = await admin().from('pricing').select('*').eq('active', true).single().then(r => r, () => ({ data: null }));
  res.json({ packs: (data && data.packs) || [], version: (data && data.version) || null });
});
app.put('/api/admin/packages', auth, perm('packages.write'), async (req, res) => {
  const packs = Array.isArray(req.body && req.body.packs) ? req.body.packs : null;
  if (!packs) return res.status(400).json({ error: 'packs array required' });
  // validate + normalize each pack; reject malformed entries rather than store junk
  const clean = [];
  for (const p of packs) {
    const credits = parseInt(p.credits), pkr = parseInt(p.pkr);
    if (!isFinite(credits) || credits < 1 || !isFinite(pkr) || pkr < 0) continue;
    clean.push({
      credits, pkr,
      name: String(p.name || (credits + ' case' + (credits === 1 ? '' : 's'))).slice(0, 60),
      description: String(p.description || '').slice(0, 200),
      /* How many matched positions this plan opens for reading. Always at least the
         number they can apply to, because a plan that shows fewer than it lets you
         apply to is nonsense. Blank means "twice the credits", a sane default. */
      view: (() => { const v = parseInt(p.view); return isFinite(v) && v > 0 ? Math.max(v, credits) : Math.max(credits * 2, credits); })(),
      featured: !!p.featured, visible: p.visible !== false,
      promo_pkr: (isFinite(parseInt(p.promo_pkr)) && parseInt(p.promo_pkr) >= 0) ? parseInt(p.promo_pkr) : null
    });
  }
  if (!clean.length) return res.status(400).json({ error: 'No valid packages' });
  /* ONE SOURCE OF TRUTH. The buy page, the reveal cap and the match sheet all read
     packages.tiers, so editing packs without mirroring them left the admin changing
     names and counts that nothing on the site ever used. */
  try {
    const cfg = await siteSettings.getConfig();
    const prior = ((cfg.packages && cfg.packages.tiers) || []);
    const tiers = clean.filter(p => p.visible !== false).map(p => {
      const was = prior.find(t => t.credits === p.credits) || {};
      return {
        key: was.key || String(p.name || ('p' + p.credits)).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 20),
        name: p.name, credits: p.credits, view: p.view, pkr: p.pkr, promo_pkr: p.promo_pkr || null,
        description: p.description || was.description || '',
        featured: !!p.featured, feats: was.feats || [
          'See your ' + p.view + ' best-matched opportunities',
          'Choose and apply to any ' + p.credits + ' of them',
          'Customized documents prepared for each position you choose'
        ],
      };
    });
    /* Every plan is a case plan now, so the packs the admin edits ARE the full ladder.
       Nothing is carried over: a plan removed in the editor is removed from the site. */
    if (tiers.length) await siteSettings.saveConfig({ packages: { tiers } }, req.userId);
  } catch (e) { /* pricing still saves even if the mirror fails */ }
  const { data: cur } = await admin().from('pricing').select('*').eq('active', true).single().then(r => r, () => ({ data: null }));
  const oldPacks = (cur && cur.packs) || [];
  const nextVer = (() => { const n = parseInt(cur && cur.version); return isFinite(n) ? String(n + 1) : String(Date.now()); })();
  await admin().from('pricing').update({ active: false }).eq('active', true);
  const { error } = await admin().from('pricing').insert({ version: nextVer, active: true, packs: clean, refund_policy: (cur && cur.refund_policy) || '' });
  if (error) return res.status(400).json({ error: error.message });
  await admin().from('audit_log').insert({ actor: req.userId, event: 'PACKAGES_CHANGED', detail: ('v' + nextVer + ' old=' + JSON.stringify(oldPacks).slice(0, 200) + ' new=' + JSON.stringify(clean).slice(0, 200)).slice(0, 480) }).then(() => {}, () => {});
  res.json({ ok: true, version: nextVer, packs: clean });
});

/* ---------- Phase 4: countries admin ---------- */
app.get('/api/admin/countries', auth, perm('countries.read'), async (req, res) => {
  const { data } = await admin().from('countries').select('*').order('name');
  res.json({ countries: data || [] });
});
app.post('/api/admin/countries', auth, perm('countries.write'), async (req, res) => {
  const b = req.body || {};
  const code = String(b.code || '').toUpperCase().slice(0, 2);
  const name = String(b.name || '').slice(0, 80);
  if (!code || !name) return res.status(400).json({ error: 'code and name required' });
  const row = { code, name, study_rating: ['green', 'yellow', 'red'].includes(b.study_rating) ? b.study_rating : 'green', enabled: b.enabled !== false, featured: !!b.featured };
  const { error } = await admin().from('countries').upsert(row, { onConflict: 'code' });
  if (error) return res.status(400).json({ error: error.message });
  await admin().from('audit_log').insert({ actor: req.userId, event: 'COUNTRY_UPSERT', detail: code + ' ' + name + ' enabled=' + row.enabled }).then(() => {}, () => {});
  res.json({ ok: true });
});
app.post('/api/admin/countries/:code/toggle', auth, perm('countries.write'), async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const { data: c } = await admin().from('countries').select('enabled').eq('code', code).single();
  if (!c) return res.status(404).json({ error: 'Not found' });
  const enabled = !c.enabled;
  const { error } = await admin().from('countries').update({ enabled }).eq('code', code);
  if (error) return res.status(400).json({ error: error.message });
  await admin().from('audit_log').insert({ actor: req.userId, event: 'COUNTRY_TOGGLE', detail: code + ' -> ' + (enabled ? 'enabled' : 'disabled') }).then(() => {}, () => {});
  res.json({ ok: true, enabled });
});
// Maintenance gate: when enabled, non-staff API access pauses gracefully.
app.use('/api', async (req, res, next) => {
  // Always-allowed: public config, and provider webhooks (external callers).
  if (['/config', '/site-config', '/pricing', '/countries', '/payment-gateways'].some(p => req.path === p)) return next();
  if (req.path.startsWith('/payments/webhook/')) return next();
  try {
    const cfg = await siteSettings.getConfig();
    if (!cfg.maintenance.enabled) return next();
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    const u = await userFromToken(t);
    if (u) { const { data: p } = await admin().from('profiles').select('role').eq('id', u.id).single(); if (p && require('./lib/rbac').isAdminRole(p.role)) return next(); }
    return res.status(503).json({ error: cfg.maintenance.message, maintenance: true });
  } catch (e) { return next(); }
});

/* ---------- health ---------- */

/* ---------- profile ---------- */
app.get('/api/me', auth, async (req, res) => {
  let { data, error } = await admin().from('profiles').select('*').eq('id', req.userId).single();
  if (error && error.code === 'PGRST116') {
    // first login: create the profile row
    const isFounder = OWNER_EMAILS.includes((req.userEmail || '').toLowerCase());
    let signupName = '';
    try { const { data: ud } = await admin().auth.getUser((req.headers.authorization || '').replace(/^Bearer /, '')); signupName = ((ud && ud.user && ud.user.user_metadata) || {}).full_name || ''; } catch (e) {}
    const ins = await admin().from('profiles').insert({ id: req.userId, full_name: signupName || req.userEmail.split('@')[0], role: isFounder ? 'super_admin' : 'user' }).select().single();
    if (isFounder) await admin().from('credit_ledger').insert({ user_id: req.userId, delta: 999, reason: 'grant', note: 'Founder account' });
    data = ins.data;
  }
  if (!data) return res.status(500).json({ error: 'Profile unavailable' });
  // FOUNDER SELF-HEAL: the owner account can never lose its powers. If the founder
  // email ever shows up without the admin role or its credit grant (a recreated row,
  // a bad migration moment, anything), it is restored right here, automatically.
  try {
    const isFounder2 = OWNER_EMAILS.includes((req.userEmail || '').toLowerCase());
    if (isFounder2) {
      if (data.role !== 'admin') { await admin().from('profiles').update({ role: 'admin' }).eq('id', req.userId); data.role = 'admin'; }
      const bal2 = await balance(req.userId);
      if (bal2 < 100) {
        const { data: prior } = await admin().from('credit_ledger').select('id').eq('user_id', req.userId).eq('reason', 'founder_restore').limit(1);
        if (!prior || !prior.length) await admin().from('credit_ledger').insert({ user_id: req.userId, delta: 999 - bal2, reason: 'founder_restore', note: 'Founder account credit restore' });
      }
    }
  } catch (e) {}
  // Deep profile: the agent's full extraction rides along for the profile view.
  try { const { data: px } = await admin().from('app_settings').select('value').eq('key', 'profilex:' + req.userId).single(); if (px && px.value && px.value.x) data.deep = px.value.x; } catch (e) {}
  delete data.gmail_refresh_enc;
  let appCount = 0;
  try { const { count } = await admin().from('applications').select('id', { count: 'exact', head: true }).eq('user_id', req.userId); appCount = count || 0; } catch (e) {}
  data.used_free_case = appCount > 0;
  res.json({ me: data, credits: await balance(req.userId) });
});
/* ---------- journey state for the state-driven post-login home (Stage 2) ----------
   Returns ONE state + the single next action the home should show. */
async function computeMeState(uid) {
    const { count: cvCount } = await admin().from('documents').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('kind', 'cv');
    const hasCV = (cvCount || 0) > 0;
    const { data: apps } = await admin().from('applications').select('id,stage,opportunity_id,updated_at').eq('user_id', uid).order('updated_at', { ascending: false }).limit(50);
    const list = apps || [];
    const anyStage = (...s) => list.find(a => s.includes(a.stage));
    let state = 'new', action = null, appId = null;

    if (!hasCV && !list.length) { state = 'new'; }
    else {
      const sent = list.find(a => ['submitted_email', 'submitted', 'sent', 'applied'].includes(a.stage));
      const ready = anyStage('awaiting_authorization', 'prepared', 'portal_apply');
      const preparing = anyStage('preparing');
      const { data: opps } = await admin().from('opportunities').select('id', { count: 'exact', head: false }).limit(1);
      if (preparing) { state = 'preparing'; appId = preparing.id; }
      else if (ready) { state = 'application_ready'; appId = ready.id; }
      else if (sent) { state = 'application_sent'; appId = sent.id; }
      else if (hasCV) { state = 'cv_uploaded'; }
      else { state = 'new'; }
    }
    // Real workspace counts for the home status strip (never fabricated).
    let matches = 0, deadlineSoon = 0, appsReady = 0;
    try {
      const { count: m } = await admin().from('opportunities').select('id', { count: 'exact', head: true }).eq('status', 'verified');
      matches = m || 0;
      const soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const { count: ds } = await admin().from('opportunities').select('id', { count: 'exact', head: true }).eq('status', 'verified').gte('deadline', today).lte('deadline', soon);
      deadlineSoon = ds || 0;
      appsReady = list.filter(a => ['awaiting_authorization', 'prepared', 'portal_apply'].includes(a.stage)).length;
    } catch (e) {}
    return { state, hasCV, appCount: list.length, matches, deadlineSoon, appsReady };
}
app.get('/api/me/state', auth, async (req, res) => {
  try { res.json(await computeMeState(req.userId)); }
  catch (e) { res.json({ state: 'new', hasCV: false, appCount: 0, matches: 0, deadlineSoon: 0, appsReady: 0 }); }
});
/* ---------- consolidated home payload: one call paints the whole dashboard ---------- */
const _homeMatchCache = new Map();
app.get('/api/home', auth, async (req, res) => {
  const uid = req.userId;
  const out = { state: null, credits: null, myMatches: null, discover: null };
  // SPEED: everything the dashboard needs is fetched in PARALLEL. On mobile networks this
  // turns ten sequential round-trips into roughly one.
  const [stateR, balR, ledR, casesR, promoR] = await Promise.all([
    computeMeState(uid).catch(() => null),
    balance(uid).catch(() => 0),
    admin().from('credit_ledger').select('delta').eq('user_id', uid).then(r => r, () => ({ data: [] })),
    admin().from('applications').select('id', { count: 'exact', head: true }).eq('user_id', uid).then(r => r, () => ({ count: 0 })),
    activePromo().catch(() => null)
  ]);
  out.state = stateR;
  try {
    const bal = balR;
    const led = ledR && ledR.data;
    const purchased = (led || []).filter(l => Number(l.delta) > 0).reduce((sm, l) => sm + Number(l.delta), 0);
    const casesUsed = casesR && casesR.count;
    try {
      const promo = promoR;
      if (promo) {
        const note = 'promo:' + promo.ends_at;
        const { data: cl } = await admin().from('credit_ledger').select('id').eq('user_id', req.userId).eq('note', note).limit(1);
        out.promo = { active: true, ends_at: promo.ends_at, claimed: !!(cl && cl.length) };
      }
    } catch (e) {}
    const simP = simUser(req);
    out.credits = simP ? { balance: simP.tier, creditsRemaining: simP.tier, casesUsed: 0, casesTotal: simP.tier }
      : { balance: bal, creditsRemaining: bal, casesUsed: casesUsed || 0, casesTotal: purchased };
  } catch (e) {}
  try {
    // Personalized: how many CURRENT verified opportunities score >=70% for THIS user.
    const { matchMany } = require('./lib/match');
    // Cached for 5 minutes per user: scoring 60 opportunities on every dashboard load was
    // the single slowest step. The number changes rarely, so a short cache is safe.
    const mcKey = 'mm:' + uid;
    const cachedMM = _homeMatchCache.get(mcKey);
    if (cachedMM && Date.now() - cachedMM.at < 300000) { out.myMatches = cachedMM.val; throw { _skip: true }; }
    /* The dashboard count must agree with what a search actually returns. Counting the
       whole inventory ignored the user's chosen level, field and countries, so the
       dashboard could claim 52 matches while a search correctly returned none. We now
       apply the SAME gates the search uses. */
    let wantLv = [], wantCc = [];
    try {
      const { data: pf } = await admin().from('app_settings').select('value').eq('key', 'prefs:' + uid).single();
      const pv = (pf && pf.value) || {};
      wantLv = pv.levels || [];
      wantCc = (pv.ctrys || pv.countries || []).map(c => String(c).toUpperCase());
    } catch (e) {}
    let q = admin().from('opportunities').select('*').eq('status', 'verified').order('created_at', { ascending: false }).limit(240);
    if (wantCc.length) q = q.in('country_code', wantCc);
    const { data: opps } = await q;
    if (opps && opps.length) {
      const m = await matchMany(uid, opps, wantLv, wantCc);
      const usable = (m || []).filter(x =>
        !x.wrongTarget && !x.overqualified && !x.fieldMismatch &&
        x.status !== 'not_eligible' && x.pct != null && x.pct >= RELEVANCE_FLOOR);
      const pcts = usable.map(x => x.pct);
      out.myMatches = { count70: usable.length, best: pcts.length ? Math.max(...pcts) : null, scored: pcts.length, live: opps.length };
    } else out.myMatches = { count70: 0, best: null, scored: 0, live: 0 };
    try { _homeMatchCache.set('mm:' + uid, { val: out.myMatches, at: Date.now() }); if (_homeMatchCache.size > 3000) _homeMatchCache.clear(); } catch (e) {}
  } catch (e) { if (!(e && e._skip)) { /* non-fatal */ } }
  try {
    const { count: ans } = await admin().from('support_tickets').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'answered').then(r => r, () => ({ count: 0 }));
    out.support = { answered: ans || 0 };
  } catch (e) {}
  try {
    // Referral identity: every user gets a permanent code; balance rides along.
    const { data: me } = await admin().from('profiles').select('referral_code,referral_balance_pkr').eq('id', uid).single();
    let code = me && me.referral_code;
    if (!code) { code = 'FF' + uid.replace(/-/g, '').slice(0, 8).toUpperCase(); await admin().from('profiles').update({ referral_code: code }).eq('id', uid); }
    out.referral = { code, balance_pkr: Number(me && me.referral_balance_pkr) || 0 };
  } catch (e) {}
  try {
    const { data: st } = await admin().from('app_settings').select('value').eq('key', 'discover:' + uid).single();
    const v = st && st.value;
    if (v && v.status === 'running' && Date.now() - new Date(v.startedAt || 0).getTime() < 12 * 60000)
      out.discover = { status: 'running', found: Number(v.found) || 0, target: Number(v.target) || 5, kind: v.kind || null };
  } catch (e) {}
  res.json(out);
});
/* Live discovery status: survives app close, battery death, page reloads. */
app.get('/api/run/status', auth, async (req, res) => {
  try {
    const { data: st } = await admin().from('app_settings').select('value').eq('key', 'discover:' + req.userId).single();
    const v = st && st.value;
    if (!v) return res.json({ status: 'idle' });
    let found = Number(v.found) || 0;
    try {
      // Live accuracy: count what actually landed in the DB since the run started.
      let q = admin().from('opportunities').select('id', { count: 'exact', head: true }).eq('status', 'verified').gte('created_at', v.startedAt || new Date(0).toISOString());
      if (v.kind) q = q.eq('kind', v.kind);
      const { count } = await q; found = Math.max(found, count || 0);
    } catch (e) {}
    let status = v.status || 'idle';
    // Stale guard: a 'running' older than 12 minutes finished or died - report done with what exists.
    if (status === 'running' && Date.now() - new Date(v.startedAt || 0).getTime() > 12 * 60000) status = 'done';
    res.json({ status, found, target: Number(v.target) || 5, kind: v.kind || null, startedAt: v.startedAt || null, stage: v.stage || null });
  } catch (e) { res.json({ status: 'idle' }); }
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
/* Simulation: an admin can request the exact experience of a brand-new user.
   The header only ever REDUCES privileges (never grants), so it is safe by design. */
const simUser = req => {
  if (String((req.headers || {})['x-ff-simulate-user'] || '') !== '1') return false;
  const t = parseInt((req.headers || {})['x-ff-simulate-tier'] || '0', 10) || 0;
  return { tier: [0, 1, 5, 10].includes(t) ? t : 0 };
};
/* Paywall: full opportunity identity is for staff and package members only. */
async function entitled(userId, sim) {
  if (sim) return (sim.tier || 0) >= 1; // simulated package member or fresh visitor, exactly as chosen
  try {
    const { data: prof } = await admin().from('profiles').select('role').eq('id', userId).single();
    if (prof && ['admin', 'staff'].includes(prof.role)) return true;
    return (await balance(userId)) >= 1;
  } catch (e) { return true; } // never lock everyone out on an internal error
}
/* Teaser row: everything that sells (match %, funding, stipend figures, country,
   deadline) - nothing that identifies (no institution, title, url, city, contacts). */
/* A generalised description of the role, honest and specific enough for the applicant to
   judge whether it is worth paying for, without identifying the institution.
   "Postdoctoral position in thrombosis and haemostasis" is useful and safe.
   "Postdoctoral opportunity" is neither. */
function generalTitle(o) {
  let t = String(o.title || '').trim();
  if (!t) return null;
  // Drop reference numbers and bracketed asides first.
  t = t.replace(/\b(ref|reference|vacancy|requisition|position id|no)\.?\s*[:#]?\s*[A-Z0-9][A-Z0-9\-\/]{2,}\b/gi, ' ');
  t = t.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  /* Then cut the segment that names the employer, and everything after it. A separator
     followed by an institution word means the rest identifies the organisation. */
  const ORG = /(university|universit[a-z]+|college|institut[a-z]*|hospital|centre|center|school|faculty|department|dept|clinic|trust|nhs|foundation|laborator[a-z]+|\blab\b|academy|akademi|karolinska|max planck|charit[eé])/i;
  const parts = t.split(/\s*(?:,|\||\u2013|\u2014| - | at | with | for )\s*/i);
  const kept = [];
  for (const seg of parts) {
    if (!seg) continue;
    if (ORG.test(seg)) break;             // employer reached: stop, keep what came before
    kept.push(seg.trim());
  }
  t = (kept.join(', ') || parts[0] || '').trim();
  t = t.replace(/\s{2,}/g, ' ').replace(/^[\s,\-\u2013|]+|[\s,\-\u2013|]+$/g, '').trim();
  // A topic makes the card genuinely judgeable, so keep the discipline when present.
  const topic = (o.req_field || o.field || '').trim();
  if (t.length < 12 && topic) t = t + ' in ' + topic;
  if (!t) return null;
  return t.length > 90 ? t.slice(0, 88).replace(/\s+\S*$/, '') + '…' : t;
}
/* Remote is not one thing. "Remote within the USA" is closed to a Pakistan-based
   applicant; "remote worldwide" is open. Saying only "Remote" would mislead. */
function remoteScope(o) {
  const blob = [o.title, o.location, o.requirements, o.eligibility, o.req_nationality, o.work_rights]
    .filter(Boolean).join(' ').toLowerCase();
  if (!o.remote && !/remote|work from home|telecommut/.test(blob)) return null;
  if (/worldwide|anywhere|any country|global(ly)?|from any location/.test(blob)) return 'Remote, open worldwide';
  const within = blob.match(/remote[^.]{0,40}?\b(within|in|from|based in)\s+(the\s+)?(us|usa|united states|uk|united kingdom|eu|europe|canada|australia|germany|india)\b/);
  if (within) return 'Remote, but only from ' + within[3].toUpperCase().replace('USA', 'the USA').replace('UK', 'the UK');
  if (/must (be|reside|live)[^.]{0,30}(us|usa|uk|eu|eea|canada|australia)\b/.test(blob)) return 'Remote, with a residence requirement';
  return 'Remote, confirm eligibility on the official page';
}
function lockTease(o) {
  return {
    id: o.id, kind: o.kind, country_code: o.country_code, deadline: o.deadline,
    // City and country are given: an applicant must know where in the world this is.
    city: o.city || null,
    general_title: generalTitle(o),
    remote_scope: remoteScope(o), remote: (o.remote === true || o.remote === false) ? o.remote : null,
    field: o.req_field || o.field || null,
    funding: o.funding || null, funding_type: o.funding_type || null, level: o.level || null,
    stipend: o.stipend || null, tuition: o.tuition || null, salary_note: o.salary_note || null,
    req_language: o.req_language || null, req_language_min: o.req_language_min || null,
    created_at: o.created_at || null, verified_at: o.verified_at || null,
    match: o.match || null, locked: true
  };
}
app.get('/api/credits', auth, async (req, res) => {
  const { data } = await admin().from('credit_ledger').select('*').eq('user_id', req.userId).order('created_at', { ascending: false }).limit(50);
  res.json({ balance: await balance(req.userId), ledger: data || [] });
});

/* ---------- pricing & payments (server-confirmed rule) ---------- */
app.get('/api/pricing', async (req, res) => {
  const { data } = await admin().from('pricing').select('*').eq('active', true).single();
  const out = data || { packs: [] };
  // Admin packages are the source of truth: build the purchasable packs from them so a
  // price/credits change in admin is live instantly for everyone.
  try {
    const cfg = await siteSettings.getConfig();
    const tiers = (cfg.packages && cfg.packages.tiers) || [];
    /* MERGE, never overwrite. This line used to replace the admin's saved packs
       wholesale, so renamed plans, promo prices and descriptions silently vanished from
       the buy page. Admin packs win; tiers only fill in what a pack does not carry. */
    const packs = (out.packs || []).slice();
    if (packs.length) {
      out.packs = packs.map(p => {
        const t = tiers.find(x => x.credits === p.credits) || {};
        return Object.assign({}, t, p, {
          view: p.view || t.view || Math.max((p.credits || 1) * 2, p.credits || 1),
          name: p.name || t.name,
          feats: p.feats || t.feats
        });
      });
    } else if (tiers.length) {
      out.packs = tiers.map(t => ({ credits: t.credits, pkr: t.pkr, promo_pkr: t.promo_pkr || null,
        name: t.name, view: t.view, description: t.description || '',
        feats: t.feats, featured: t.featured }));
    }
  } catch (e) {}
  res.json({ pricing: out });
});
/* What will this plan actually cost ME, right now? The payment sheet used to compute
   this from the tier config while the server charged from the stored packs, and it
   ignored the referral balance entirely, so anyone holding referral credit was told to
   overpay. One endpoint, one number, computed by the same code path that charges. */
app.get('/api/payments/quote', auth, async (req, res) => {
  try {
    const credits = Number(req.query.credits);
    if (!isFinite(credits)) return res.status(400).json({ error: 'credits required' });
    const { data: pr } = await admin().from('pricing').select('*').eq('active', true).single().then(r => r, () => ({ data: null }));
    let pack = ((pr || {}).packs || []).find(p => Number(p.credits) === credits);
    if (!pack) {
      try {
        const cfg = await siteSettings.getConfig();
        const t = ((cfg.packages && cfg.packages.tiers) || []).find(x => Number(x.credits) === credits);
        if (t) pack = { credits: t.credits, pkr: t.pkr, promo_pkr: t.promo_pkr || null, name: t.name };
      } catch (e) {}
    }
    if (!pack) return res.status(404).json({ error: 'Choose a valid credit pack' });
    const listPkr = Number(pack.pkr) || 0;
    const promo = (Number(pack.promo_pkr) > 0 && Number(pack.promo_pkr) < listPkr) ? Number(pack.promo_pkr) : null;
    const base = promo != null ? promo : listPkr;
    let discount = 0;
    try {
      const { data: me } = await admin().from('profiles').select('referral_balance_pkr').eq('id', req.userId).single();
      discount = Math.min(Number(me && me.referral_balance_pkr) || 0, 500 * (pack.credits || 1));
    } catch (e) {}
    res.json({ name: pack.name || null, credits: pack.credits, list_pkr: listPkr, promo_pkr: promo,
      discount_pkr: discount, amount_pkr: Math.max(0, base - discount) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/payments', auth, async (req, res) => {
  try { const cfg = await siteSettings.getConfig(); if (cfg.features && cfg.features.payments === false) return res.status(503).json({ error: 'Payments are temporarily unavailable. Please try again shortly.' }); } catch (e) {}
  const { credits, reference } = req.body || {};
  if (!isFinite(Number(credits)) || Number(credits) <= 0) return res.status(400).json({ error: 'Choose a package first.' });
  let pr = null;
  try { const r = await admin().from('pricing').select('*').eq('active', true).single(); pr = r.data || null; } catch (e) {}
  /* RESOLVE FIRST, THEN PRICE. The promo check used to run before this fallback, so a
     plan that lived only in the tier config was charged at list price, and the fallback
     itself dropped promo_pkr on the way past. */
  let pack = ((pr || {}).packs || []).find(p => Number(p.credits) === Number(credits));
  if (!pack) {
    try {
      const cfg = await siteSettings.getConfig();
      const t = ((cfg.packages && cfg.packages.tiers) || []).find(x => Number(x.credits) === Number(credits));
      if (t) pack = { credits: t.credits, pkr: t.pkr, promo_pkr: t.promo_pkr || null, name: t.name };
    } catch (e) {}
  }
  /* LAST RESORT: the shipped ladder. A stale pricing row in the database used to make
     a perfectly valid plan unrecognisable, and the buyer was told to "choose a valid
     credit pack" for the plan they had just tapped. A payment attempt must never be
     refused because OUR configuration drifted. */
  if (!pack) {
    try {
      const t = (((require('./lib/settings').DEFAULTS || {}).packages || {}).tiers || [])
        .find(x => Number(x.credits) === Number(credits));
      if (t) pack = { credits: t.credits, pkr: t.pkr, promo_pkr: null, name: t.name };
    } catch (e) {}
  }
  if (!pack) return res.status(400).json({ error: 'That package is no longer available. Please refresh the plans page and try again.' });
  // Charge the promo price whenever the admin has set one below list.
  const listPkr = Number(pack.pkr) || 0;
  if (Number(pack.promo_pkr) > 0 && Number(pack.promo_pkr) < listPkr) {
    pack = Object.assign({}, pack, { pkr: Number(pack.promo_pkr), list_pkr: listPkr });
  }
  // Referral discount: Rs 500 per case, automatically applied from the user's balance.
  let discount = 0;
  try {
    const { data: me } = await admin().from('profiles').select('referral_balance_pkr').eq('id', req.userId).single();
    discount = Math.min(Number(me && me.referral_balance_pkr) || 0, 500 * pack.credits);
  } catch (e) {}
  /* The insert is written twice on purpose: the full row first, and a minimal row if the
     database is missing an optional column (an unrun migration used to turn "I have
     paid" into a dead button). A customer who has already sent money must never be left
     with nothing recorded. */
  const full = {
    user_id: req.userId, amount_pkr: Math.max(0, pack.pkr - discount), credits: pack.credits, discount_pkr: discount,
    reference: String(reference || '').slice(0, 120), pricing_version: (pr && pr.version) || null
  };
  let { data, error } = await admin().from('payments').insert(full).select().single();
  if (error) {
    try { require('./lib/oblog').errlog('payments:insert', new Error(error.message || 'insert failed'), { userId: req.userId }); } catch (e) {}
    const minimal = { user_id: req.userId, amount_pkr: full.amount_pkr, credits: full.credits, reference: full.reference };
    ({ data, error } = await admin().from('payments').insert(minimal).select().single());
  }
  if (error) return res.status(400).json({ error: 'We could not record your payment just now. Please send your transaction ID on WhatsApp and we will activate it manually.' });
  res.json({ payment: data, amount_pkr: Math.max(0, pack.pkr - discount), list_pkr: pack.list_pkr || pack.pkr,
    promo_applied: !!pack.list_pkr, discount_pkr: discount,
    note: 'Pending. Credits appear after staff confirms your bank transfer.' });
});
app.post('/api/payments/:id/confirm', auth, perm('payments.write'), async (req, res) => {
  const { data: p } = await admin().from('payments').select('*').eq('id', req.params.id).single();
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.status !== 'pending') return res.status(400).json({ error: 'Already ' + p.status });
  // Atomic: only the request that flips pending->confirmed may write the credits.
  const { data: flipped } = await admin().from('payments').update({ status: 'confirmed', confirmed_by: req.userId, confirmed_at: new Date().toISOString() }).eq('id', p.id).eq('status', 'pending').select('id');
  if (!flipped || !flipped.length) return res.status(400).json({ error: 'Already confirmed' });
  await admin().from('credit_ledger').insert({ user_id: p.user_id, delta: p.credits, reason: 'purchase', payment_id: p.id });
  // A purchase restarts the search allowance: previous usage no longer counts.
  try { await resetSearchAllowance(p.user_id); } catch (e) {}
  // Referral settlement: consume the buyer's applied discount; reward the referrer
  // Rs 500 per case on the buyer's FIRST confirmed payment.
  try {
    if (Number(p.discount_pkr) > 0) {
      const { data: me } = await admin().from('profiles').select('referral_balance_pkr').eq('id', p.user_id).single();
      await admin().from('profiles').update({ referral_balance_pkr: Math.max(0, (Number(me && me.referral_balance_pkr) || 0) - Number(p.discount_pkr)) }).eq('id', p.user_id);
    }
    const { count: prior } = await admin().from('payments').select('id', { count: 'exact', head: true }).eq('user_id', p.user_id).eq('status', 'confirmed').neq('id', p.id);
    if ((prior || 0) === 0) {
      const { data: buyer } = await admin().from('profiles').select('referred_by').eq('id', p.user_id).single();
      if (buyer && buyer.referred_by) {
        const bonus = 500 * Number(p.credits || 1);
        const { data: refr } = await admin().from('profiles').select('referral_balance_pkr').eq('id', buyer.referred_by).single();
        await admin().from('profiles').update({ referral_balance_pkr: (Number(refr && refr.referral_balance_pkr) || 0) + bonus }).eq('id', buyer.referred_by);
        admin().from('audit_log').insert({ actor: p.user_id, event: 'REFERRAL_BONUS', detail: 'Rs ' + bonus + ' credited to referrer for first confirmed payment' }).then(() => {}, () => {});
        admin().from('support_tickets').insert({ user_id: buyer.referred_by, subject: 'Referral reward earned', message: 'A friend you invited completed their first purchase.', reply: 'Congratulations - Rs ' + bonus + ' referral discount is now in your account, applied automatically on your next package.', status: 'answered' }).then(() => {}, () => {});
      }
    }
  } catch (e) {}
  // Active pull-back: if a WhatsApp bridge is configured, ping the buyer that their
  // package is live (reuses the same optional ZAINAB_NOTIFY_URL hook as results-ready).
  try {
    if (process.env.ZAINAB_NOTIFY_URL) {
      const { data: pf } = await admin().from('profiles').select('whatsapp,full_name').eq('id', p.user_id).single();
      if (pf && pf.whatsapp) fetch(process.env.ZAINAB_NOTIFY_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: pf.whatsapp, text: (((await siteSettings.getConfig()).notify || {}).payment_confirmed || 'ForiForeign: your payment is verified and {credits} case credit(s) are now active. foriforeign.com').replace('{credits}', String(p.credits)).replace('{name}', String(pf.full_name || '')) }) }).catch(() => {});
    }
  } catch (e) {}
  // Manual-verification era: the moment credits land, the user sees a dashboard
  // notification (Ask us badge + thread). When the payment gateway goes live,
  // this same confirm path runs automatically with zero admin involvement.
  admin().from('support_tickets').insert({
    user_id: p.user_id, subject: 'Payment confirmed',
    message: 'Package purchase - ' + p.credits + ' case credit' + (p.credits === 1 ? '' : 's'),
    reply: 'Your payment is verified and ' + p.credits + ' case credit' + (p.credits === 1 ? ' is' : 's are') + ' now active. Open Find Opportunities, pick your best match, and your first case begins immediately.',
    status: 'answered'
  }).then(() => {}, () => {});
  await admin().from('audit_log').insert({ actor: req.userId, event: 'PAYMENT_CONFIRMED', detail: p.id + ' +' + p.credits + 'cr' });
  res.json({ ok: true });
});

/* ADMIN BYPASS ACTIVATION. The owner and staff never pay, and never should have been
   sent through the customer payment sheet to test or to work. One button grants the
   entitlement immediately, with no payment row to approve and no waiting, and clears
   the day's search usage so the account is effectively unlimited. Client-preview mode
   is refused deliberately: that mode exists to REMOVE admin power, so honouring a
   bypass inside it would make the preview a lie. */
app.post('/api/admin/bypass-activate', auth, async (req, res) => {
  try {
    const { data: prof } = await admin().from('profiles').select('role').eq('id', req.userId).single();
    if (!prof || !require('./lib/rbac').isAdminRole(prof.role) || prof.role === 'user') return res.status(403).json({ error: 'Staff only' });
    if (simUser(req)) return res.status(400).json({ error: 'You are previewing as a client. Exit the preview, then activate.' });
    const asked = Number((req.body || {}).credits);
    const want = isFinite(asked) && asked > 0 ? Math.max(999, Math.round(asked)) : 999;
    const bal0 = await balance(req.userId).catch(() => 0);
    const topUp = Math.max(1, want - bal0);
    const { error } = await admin().from('credit_ledger').insert({ user_id: req.userId, delta: topUp, reason: 'admin_bypass', note: 'Staff activation, no payment' });
    if (error) return res.status(400).json({ error: error.message });
    try { await resetSearchAllowance(req.userId); } catch (e) {}
    try { await admin().from('audit_log').insert({ actor: req.userId, event: 'ADMIN_BYPASS_ACTIVATE', detail: '+' + topUp + ' credits, no payment' }); } catch (e) {}
    const bal = await balance(req.userId).catch(() => topUp);
    res.json({ ok: true, granted: topUp, balance: bal, unlimited: bal >= 900 });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---------- Phase 5: payment gateways (SKELETON - inert until credentials set) ---------- */
const paymentGateways = require('./lib/payments');
app.get('/api/payment-gateways', (req, res) => {
  // Public: which automated gateways are live. Empty until you configure a merchant.
  res.json({ gateways: paymentGateways.listEnabled() });
});
// Provider webhook. No user auth (providers call this); security is signature verification
// inside handleWebhook. Never credits without a valid signature + amount match.
app.post('/api/payments/webhook/:gateway', express.json({ limit: '256kb' }), async (req, res) => {
  try {
    const out = await paymentGateways.handleWebhook(String(req.params.gateway), req.body || {});
    res.json(out);
  } catch (e) {
    // Log for reconciliation but don't leak details to the caller.
    admin().from('audit_log').insert({ event: 'WEBHOOK_REJECTED', detail: String(req.params.gateway) + ': ' + String(e.message).slice(0, 180) }).then(() => {}, () => {});
    res.status(400).json({ ok: false });
  }
});

/* ---------- public data ---------- */
app.get('/api/countries', async (req, res) => {
  // Only show enabled countries publicly; if the column doesn't exist yet, show all.
  let { data, error } = await admin().from('countries').select('*').eq('enabled', true).order('name');
  if (error && /enabled|column/.test(error.message || '')) ({ data } = await admin().from('countries').select('*').order('name'));
  res.json({ countries: data || [] });
});
app.get('/api/opportunities', auth, async (req, res) => {
  /* NOTHING IS HIDDEN FROM STAFF. Every commercial narrowing below - the score bar, the
     result ceiling, the locked cards - exists to shape what a CUSTOMER sees. Applying it
     to the owner meant he could not audit his own inventory: a search returned a handful
     of cards while the database held far more, and there was no way to tell a filtering
     bug from an empty database. Client preview is deliberately excluded, because that
     mode exists precisely to see the customer's view. The user's OWN filters (level,
     field, country) are still honoured for staff - those are instructions, not paywalls. */
  let staffFull = false;
  try {
    const { data: _pf } = await admin().from('profiles').select('role').eq('id', req.userId).single();
    staffFull = !!(_pf && require('./lib/rbac').isAdminRole(_pf.role) && _pf.role !== 'user' && !simUser(req));
  } catch (e) {}
  const kind = String(req.query.kind || 'study');
  const q = String(req.query.q || '').trim();
  const studyKinds = ['study', 'scholarship', 'postdoc'];
  const multi = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
  /* The window used to be 400 rows ordered by earliest deadline, and relevance was scored
     only afterwards - so once inventory grows, the window fills with whatever closes next
     week and an excellent match six months out is invisible. Recency is the safer cut: a
     recently verified row is a row we know is real, and the deadline is still enforced by
     the filters. The window is also wider now that conditional filtering happens after
     the fetch rather than inside the query. */
  let query = admin().from('opportunities').select('*').eq('status', 'verified').limit(1000);
  query = (String(req.query.sort) === 'deadline') ? query.order('deadline', { ascending: true }) : query.order('verified_at', { ascending: false });
  if (kind === 'study') query = query.in('kind', studyKinds);
  else if (kind === 'scholarship') query = query.eq('kind', 'scholarship');
  else query = query.eq('kind', kind);
  /* FILTERING, REBUILT. Twelve separate .or() calls used to be stacked onto this one
     query, producing twelve query parameters all named "or". Whether PostgREST combines
     repeated top-level logical parameters with AND, or honours only one of them, is not
     something this code could safely assume - and a filter that MIGHT be dropped is worse
     than no filter, because the applicant is shown exactly what they excluded and has no
     way to know. The query below now carries only equality and IN conditions, which are
     unambiguous, and every conditional rule is applied in lib/oppfilter.js over the
     fetched rows, where it is pure, deterministic and covered by tests that run offline.
     The fetch window is wider to compensate for filtering later. */
  const cc = multi(req.query.country).map(s => s.toUpperCase());
  if (cc.length) query = query.in('country_code', cc);
  const ALL_LEVELS = ['bachelors', 'masters', 'phd', 'postdoc', 'diploma', 'short_course', 'fellowship', 'observership'];
  const lvls = multi(req.query.level).concat(multi(req.query.levels)).filter(l => ALL_LEVELS.includes(l));
  const academicLane = !(kind === 'work' || kind === 'job');
  const fts = multi(req.query.funding_type).filter(f => ['fully', 'partial', 'self'].includes(f));
  const sectorQ = multi(req.query.sector).filter(x => /^[a-z_-]{2,40}$/.test(x));
  const jts = multi(req.query.job_type).filter(j => ['full_time', 'part_time', 'contract', 'internship'].includes(j));
  const exps = multi(req.query.exp).filter(x => ['entry', 'mid', 'senior'].includes(x));
  const langPicks = multi(req.query.langs).filter(x => ['none', 'cert_before', 'course_after', 'local_lang'].includes(x));
  const fieldSlug = String(req.query.field || '').trim().toLowerCase();
  let fieldTerms = [];
  if (fieldSlug && /^[a-z-]{2,40}$/.test(fieldSlug)) {
    try { fieldTerms = require('./lib/domains').termsForSlug(fieldSlug).slice(0, 12); } catch (e) {}
  }
  const intakeM = String(req.query.intake || '').match(/^(20\d{2})$/);
  const dwinRaw = parseInt(req.query.deadline_days, 10);
  const wantRemote = String(req.query.remote) === '1';
  const wantOnsite = String(req.query.workmode || '') === 'onsite';
  const wantVisa = String(req.query.visa) === '1';
  /* A deadline window and an intake year can contradict each other outright: "closing in
     30 days" and "2027 intakes" have almost no overlap, and the applicant was shown an
     empty screen with no explanation. The intake wins, because it is the more considered
     choice, and the contradiction is reported back. */
  let dropped = null;
  let intakeYear = intakeM ? parseInt(intakeM[1], 10) : 0;
  let dwin = isFinite(dwinRaw) && dwinRaw > 0 && dwinRaw <= 400 ? dwinRaw : 0;
  if (intakeYear && dwin) { dwin = 0; dropped = 'deadline_window_vs_intake'; }
  const FILTERS = {
    today: new Date().toISOString().slice(0, 10),
    levels: (lvls.length && academicLane) ? Array.from(new Set(lvls)) : [],
    fundingTypes: fts,
    noLanguageTest: String(req.query.no_language_test) === '1',
    langs: langPicks,
    fieldTerms,
    sectorTerms: sectorQ.map(x => x.replace(/_/g, ' ')),
    hasStipend: String(req.query.has_stipend) === '1',
    tuitionFree: String(req.query.tuition_free) === '1',
    noAppFee: String(req.query.no_app_fee) === '1',
    rollingOnly: String(req.query.rolling) === '1',
    hasDeadline: String(req.query.has_deadline) === '1',
    deadlineDays: dwin,
    intakeYear,
    jobTypes: jts,
    expLevels: exps
  };
  if (fts.length) query = query.in('funding_type', fts);
  if (q) query = query.textSearch('search_blob', q.split(/\s+/).join(' & '));
  let { data, error } = await query;
  // ANY query failure degrades to an unfiltered fetch rather than an empty result set.
  // A single malformed condition (or a column that does not exist) otherwise kills the
  // whole query and the user sees "no opportunities" when hundreds are available.
  if (error) {
    try { require('./lib/oblog').errlog('opportunities:query', new Error(error.message || 'query failed'), { userId: req.userId }); } catch (e) {}
  }
  if (error) {
    /* BLUNDER: this fallback dropped EVERY filter. One malformed condition anywhere above
       - a sparse column, a bad character in a sector name - and the applicant silently
       received unfiltered inventory: countries they never picked, levels they had ruled
       out, a PhD advert in a postdoc search. It looked exactly like a broken matcher and
       it was actually a swallowed query error. The hard filters the applicant actually
       chose are now preserved; only the exotic conditions are dropped. */
    /* The fallback keeps every unambiguous condition. It cannot drop a filter now even
       in principle, because the conditional rules are applied after the fetch either
       way. */
    let q2 = admin().from('opportunities').select('*').eq('status', 'verified').order('verified_at', { ascending: false }).limit(1000);
    if (kind === 'study') q2 = q2.in('kind', studyKinds); else q2 = q2.eq('kind', kind);
    if (cc.length) q2 = q2.in('country_code', cc);
    if (fts.length) q2 = q2.in('funding_type', fts);
    ({ data } = await q2);
  }
  let rows = data || [];
  /* Every conditional filter, applied here where it is deterministic and tested. */
  let _filterReport = {};
  try {
    const OF = require('./lib/oppfilter');
    const inferLevel = t => {
      const x = String(t || '').toLowerCase();
      if (/post[\s-]?doc|postdoctoral/.test(x)) return 'postdoc';
      if (/\bphd\b|ph\.d|doctoral (position|student|programme|program)|doctorate/.test(x)) return 'phd';
      if (/\bmaster|\bmsc\b|\bm\.sc|mphil/.test(x)) return 'masters';
      if (/bachelor|\bbsc\b|undergraduate/.test(x)) return 'bachelors';
      if (/fellowship/.test(x)) return 'fellowship';
      return null;
    };
    const res = OF.applyFilters(rows, FILTERS, { inferLevel });
    rows = res.rows; _filterReport = res.report || {};
  } catch (e) {
    try { require('./lib/oblog').errlog('opportunities:filter', e, { userId: req.userId }); } catch (e2) {}
  }
  // Evidence-based remote decision, applied to every row the user is about to see.
  const remoteEvidence = o => {
    if (o.remote === false) return false;
    if (o.remote === true) return true;
    const blob = [o.title, o.funding, o.salary_note, o.duration, o.fee_structure, o.job_type].join(' ').toLowerCase();
    return /\bremote\b|work from home|work from anywhere|telecommut|fully distributed/.test(blob);
  };
  if (wantRemote) rows = rows.filter(remoteEvidence);
  if (wantOnsite) rows = rows.filter(o => !remoteEvidence(o));
  /* Sponsorship asked for: confirmed sponsors lead, then adverts that never said. A
     position that states sponsorship in its text counts as confirmed even when the
     boolean column was never populated by the extractor. */
  if (wantVisa) {
    const visaEvidence = o => o.visa_sponsorship === true
      || /visa sponsor|sponsorship (is )?(available|provided|offered)|we sponsor|work permit (provided|arranged|sponsored)|relocation (support|package)/i
        .test([o.title, o.description, o.salary_note, o.funding, o.fee_structure].join(' '));
    rows.sort((a, b) => (visaEvidence(b) ? 1 : 0) - (visaEvidence(a) ? 1 : 0));
  }
  // USER PROTECTION (spec 18/41): never re-show an opportunity this user already applied to.
  try {
    const { data: apps } = await admin().from('applications').select('opportunity_id').eq('user_id', req.userId);
    const applied = new Set((apps || []).map(a => a.opportunity_id));
    // Anything the user has explicitly dismissed is gone for good too: a search should
    // never keep returning something they have already judged and rejected.
    let dismissed = new Set();
    try {
      const { data: dm } = await admin().from('app_settings').select('value').eq('key', 'dismissed:' + req.userId).single();
      dismissed = new Set(((dm && dm.value && dm.value.ids) || []));
    } catch (e) {}
    rows = rows.filter(o => !applied.has(o.id) && !dismissed.has(o.id));
  } catch (e) {}
  // Freshness (spec 38), computed from real timestamps only.
  const now = Date.now(), day = 86400000;
  rows.forEach(o => {
    if (o.deadline && new Date(o.deadline).getTime() < now - day) o.freshness = 'deadline_passed';
    else if (o.verified_at && now - new Date(o.verified_at).getTime() < day) o.freshness = 'verified_today';
    else if (o.verified_at && now - new Date(o.verified_at).getTime() < 14 * day) o.freshness = 'verified_recently';
    else o.freshness = 'needs_reverification';
  });
  /* If strict SQL filtering returned nothing, retry with only the essential constraints
     (kind and country). An empty screen when inventory exists is a worse failure than a
     slightly broader list, and the relevance gate below still ranks and labels results. */
  if (!rows.length) {
    try {
      let q3 = admin().from('opportunities').select('*').eq('status', 'verified')
        .order('deadline', { ascending: true }).limit(400);
      if (kind === 'study') q3 = q3.in('kind', studyKinds);
      else if (kind === 'scholarship') q3 = q3.eq('kind', 'scholarship');
      else q3 = q3.eq('kind', kind);
      const cc2 = multi(req.query.country).map(x => x.toUpperCase());
      if (cc2.length) q3 = q3.in('country_code', cc2);
      const { data: d3 } = await q3;
      // The user's chosen countries and lane are kept. We only drop OUR optional
      // refinements (sector, intake, language, licence hints); we never quietly search
      // a country they did not ask for. If that still finds nothing, the empty state
      // offers them the choice to widen.
      if (d3 && d3.length) { rows = d3; req._broadened = true; }
    } catch (e) {}
  }
  rows = rows.filter(o => o.freshness !== 'deadline_passed');

  /* ENTITY DEDUPLICATION. The same opportunity is often listed twice with different ids
     (an aggregator copy and the official page). We collapse them on institution + title
     + deadline, keeping the entry with the most authoritative source and the richest
     detail, so the user never sees the same job twice. */
  {
    // Institution names are canonicalised first ("Riphah Intl. Univ." and "Riphah
    // International University" are one organisation), so duplicates actually collapse.
    const { canonicalKey } = require('./lib/entity');
    const key = o => [canonicalKey(o.institution).slice(0, 60),
                      String(o.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60),
                      String(o.deadline || '')].join('|');
    const authority = o => {
      const u = String(o.url || '').toLowerCase();
      if (/\.edu|\.ac\.|\.gov|\.nhs\.|\.int\b/.test(u)) return 3;   // official
      if (/careers|jobs\.|recruit/.test(u)) return 2;                    // employer portal
      return 1;                                                          // aggregator
    };
    const richness = o => Object.values(o).filter(v => v != null && String(v).trim() !== '').length;
    const best = new Map();
    for (const o of rows) {
      const k = key(o);
      if (!k.replace(/\|/g, '')) { best.set('u:' + o.id, o); continue; }
      const cur = best.get(k);
      if (!cur) { best.set(k, o); continue; }
      const better = (authority(o) - authority(cur)) || (richness(o) - richness(cur));
      if (better > 0) best.set(k, o);
    }
    rows = [...best.values()];
  }
  /* The level inference that used to live here has moved into lib/oppfilter.js, where it
     is applied once, in one place, and covered by tests. Running it twice - once in SQL,
     once here - was how "unstated level" and "wrong level" came to be treated as the same
     thing, which could empty an entire result set. */

  rows = rows.slice(0, staffFull ? 400 : 240);
  let opportunities = rows;
  // Phase 4: annotate with match status when requested (?match=1)
  if (String(req.query.match || '') === '1' && opportunities.length) {
    try {
      const { matchMany } = require('./lib/match');
      // The user's own selected target levels gate the results: a postdoc seeker must
      // never receive PhD admissions, a PhD seeker never Master's, and so on.
      let wantedLevels = [];
      try {
        if (req.query.levels) wantedLevels = String(req.query.levels).split(',').map(x => x.trim()).filter(Boolean);
        if (!wantedLevels.length) { const { data: pf } = await admin().from('app_settings').select('value').eq('key', 'prefs:' + req.userId).single(); wantedLevels = ((pf && pf.value && pf.value.levels) || []); }
      } catch (e) {}
      const wantedCountries = multi(req.query.country).map(x => String(x).toUpperCase());
      const m = await matchMany(req.userId, opportunities, wantedLevels, wantedCountries);
      const byId = {}; m.forEach(x => { byId[x.id] = x; });
      opportunities = opportunities.map(o => ({ ...o, match: byId[o.id] ? { status: byId[o.id].status, pct: byId[o.id].pct, dims: byId[o.id].dims, overqualified: byId[o.id].overqualified, fieldMismatch: byId[o.id].fieldMismatch, wrongTarget: byId[o.id].wrongTarget, levelUnknown: byId[o.id].levelUnknown } : null }));
      // HARD RELEVANCE GATE (never show the user anything that is not a real fit):
      //  - below the applicant's own level (PhD holder must never see MPhil/Masters/Bachelors)
      //  - a clear field/profession mismatch (pharmacist must not see biochemistry-only roles)
      //  - not_eligible, or below the 50% relevance floor
      //  - criteria the source never published (we keep these ONLY if nothing else, and never labelled as weak)
      /* GRADUATED RELEVANCE GATE.
         Strict filters are right when there is plenty of inventory, but stacking four of
         them can eliminate EVERYTHING and leave the user staring at an empty screen while
         genuinely useful opportunities exist. So we apply the strictest rule first and
         relax one level at a time until we have something real to show, labelling each
         result honestly. We never invent a match, and we never show a worse fit above a
         better one. */
      const all = opportunities.slice();
      const notEligible = o => o.match && (o.match.status === 'not_eligible');
      const wrongLevel  = o => o.match && (o.match.wrongTarget || o.match.status === 'wrong_target_level');
      const belowLevel  = o => o.match && (o.match.overqualified || o.match.status === 'below_your_level');
      const wrongField  = o => o.match && (o.match.fieldMismatch || o.match.status === 'field_mismatch');
      const belowFloor  = o => o.match && o.match.pct != null && o.match.pct < RELEVANCE_FLOOR;
      const unknownLvl  = o => o.match && o.match.levelUnknown;

      /* WHAT THE USER CHOSE IS ABSOLUTE. Level, lane and eligibility are never relaxed:
         a postdoc applicant must never be shown a PhD place, and a pharmacist must never
         be shown a biochemistry-only post. The ONLY thing that may relax is our own
         internal score bar, which is our quality opinion, not the user's instruction.
         If nothing genuinely fits, we say so and let the USER decide to widen. */
      const tiers = [
        // 1. Exactly what was asked for, at our full quality bar.
        { note: null, keep: o => !notEligible(o) && !wrongLevel(o) && !belowLevel(o) && !wrongField(o) && !belowFloor(o) },
        // 2. Same level, same field, same eligibility: only OUR score bar is eased.
        { note: 'These match your level and field. Their scores are a little under our usual bar, so check the details carefully.',
          keep: o => !notEligible(o) && !wrongLevel(o) && !belowLevel(o) && !wrongField(o) && !unknownLvl(o) },
        /* 3. Last resort: positions whose advert never stated a level. These are not
           wrong-level - we simply could not read one - and hiding them entirely can empty
           a screen that has genuine matches on it. Shown last, and labelled honestly. */
        { note: 'The adverts below do not state a study level, so we could not confirm it matches what you asked for. Check each one before applying.',
          keep: o => !notEligible(o) && !wrongLevel(o) && !belowLevel(o) && !wrongField(o) }
      ];
      let picked = [], relaxNote = null;
      if (staffFull) {
        /* Staff see the raw result set, scored and sorted but never trimmed, so a thin
           screen can be read as thin inventory rather than a filter quietly at work. */
        picked = all;
        relaxNote = 'Staff view: every scored result is shown, including any below the customer quality bar.';
      } else {
        for (const t of tiers) {
          picked = all.filter(t.keep);
          if (picked.length) { relaxNote = t.note; break; }
        }
      }
      opportunities = picked;
      if (relaxNote) res.set('X-FF-Relaxed', '1');
      req._relaxNote = relaxNote;
      // Highest match first, always.
      /* TWO-TRACK. A single ranked list forced one impossible choice: either the gates
         are tight, and every adjacent role the applicant is genuinely qualified for is
         thrown away, or they are loose and a pharmacist is shown physician posts. Two
         labelled tracks resolve it. DIRECT is the applicant's own field and level.
         ADJACENT is a role their skills cover under a different title - never a role
         requiring a licence or degree they lack, because those are still rejected
         outright upstream. Adjacent results always sit BELOW every direct one. */
      opportunities = opportunities.map(o => {
        const adjacent = !!(o.match && o.match.fieldMismatch)
          || String((((o.intelligence || o.extra) || {}).track || '')).toLowerCase() === 'adjacent';
        return Object.assign({}, o, { track: adjacent ? 'adjacent' : 'direct' });
      });
      /* Equal-quality tiebreak: prefer the destination a Pakistani applicant can actually
         reach. It never overrides match quality and never demotes a country the applicant
         asked for - it only decides which of two equally good matches is listed first. */
      const _acc = require('./lib/access');
      opportunities.sort((a, b) => {
        const t = (a.track === 'adjacent' ? 1 : 0) - (b.track === 'adjacent' ? 1 : 0);
        if (t !== 0) return t;
        const d = ((b.match && b.match.pct) || 0) - ((a.match && a.match.pct) || 0);
        if (d !== 0) return d;
        return _acc.accessScore(b.country_code) - _acc.accessScore(a.country_code);
      });
      /* Everything that survives the gate above is a real 60%+ fit at the level, field
         and countries the user chose, so we hand back the full set. The package tier
         controls how many are UNLOCKED; it must not also silently shrink the search. */
      opportunities = opportunities.slice(0, staffFull ? 200 : MATCH_MAX);
    } catch (e) { /* matching is best-effort; never blocks the list */ }
  }
  // Mark opportunities this user has already started - one case, one cost, ever.
  try {
    const { data: mine } = await admin().from('applications').select('opportunity_id').eq('user_id', req.userId);
    const mset = new Set((mine || []).map(x => x.opportunity_id));
    if (mset.size) opportunities = opportunities.map(o => mset.has(o.id) ? { ...o, started: true, owned: true } : o);
  } catch (e) {}
  // Free-preview model: after the free case is used and credits are exhausted, the list
  // still shows match strength / funding / deadline, but identity is locked until purchase.
  try {
    const { data: prof } = await admin().from('profiles').select('role').eq('id', req.userId).single();
    /* The old list missed super_admin and every delegated admin role, so those accounts
       were served locked cards like a customer with no credits. */
    const isStaff = staffFull || !!(prof && require('./lib/rbac').isAdminRole(prof.role) && prof.role !== 'user');
    if (!isStaff && (await balance(req.userId)) < 1) {
      const bal = await balance(req.userId);
      if (bal < 1) {
        opportunities = opportunities.map(o => lockTease(o));
      }
    }
  } catch (e) { /* on any error, fall through unlocked rather than break browsing */ }
  res.json({ opportunities });
});

/* Per-user serialization for credit-spending actions. Two requests from the same user
   can otherwise both pass the balance check and each create a case from one credit
   (reproduced: 2 cases, balance -1). Requests queue per user; different users never wait. */
const _userLocks = new Map();
async function withUserLock(userId, fn) {
  const prev = _userLocks.get(userId) || Promise.resolve();
  let release;
  const next = new Promise(r => { release = r; });
  _userLocks.set(userId, prev.then(() => next));
  try { await prev; } catch (e) {}
  try { return await fn(); }
  finally {
    release();
    if (_userLocks.get(userId) === next || _userLocks.size > 2000) {
      // best-effort cleanup so the map cannot grow without bound
      setTimeout(() => { const cur = _userLocks.get(userId); if (cur === next) _userLocks.delete(userId); }, 0);
    }
  }
}
/* ---------- applications: 1 credit = 1 application (consume on create) ---------- */
app.post('/api/applications', auth, (req, res) => withUserLock(req.userId, () => createApplication(req, res)));
async function createApplication(req, res) {
  const { opportunityId } = req.body || {};
  const { data: prof } = await admin().from('profiles').select('role').eq('id', req.userId).single();
  const isAdmin = prof && ['admin', 'staff'].includes(prof.role) && !simUser(req);
  // CV is the one required document before any application can be prepared.
  const { data: cvDocs } = await admin().from('documents').select('id').eq('user_id', req.userId).eq('kind', 'cv').eq('generated', false).limit(1);
  if (!isAdmin && (!cvDocs || !cvDocs.length)) {
    return res.status(400).json({ error: 'Please upload your CV first. It is the only required document, and every application is prepared from it.' });
  }
  const bal = await balance(req.userId);
  if (!isAdmin && bal < 1) {
    return res.status(402).json({ error: 'Your matches are ready. Choose a package to start this case - every case is prepared completely, end to end.' });
  }
  const { data: opp } = await admin().from('opportunities').select('id,institution').eq('id', opportunityId).single();
  if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
  const caseNo = 'FF-' + Date.now().toString(36).toUpperCase();
  // DEBIT FIRST, then create. Combined with the per-user lock this removes the
  // check-then-act window entirely; if creation fails we refund immediately.
  let debited = false;
  if (!isAdmin) {
    const balNow = await balance(req.userId);
    if (balNow < 1) return res.status(402).json({ error: 'Your matches are ready. Choose a package to start this case.' });
    const { error: dErr } = await admin().from('credit_ledger').insert({ user_id: req.userId, delta: -1, reason: 'consume', note: opp.institution });
    if (dErr) return res.status(400).json({ error: 'Could not start this case. Please try again.' });
    debited = true;
  }
  const { data: appRow, error } = await admin().from('applications')
    .insert({ user_id: req.userId, opportunity_id: opp.id, case_no: caseNo, stage: 'preparing', credits_consumed: isAdmin ? 0 : 1 })
    .select().single();
  if (error) {
    if (debited) { try { await admin().from('credit_ledger').insert({ user_id: req.userId, delta: 1, reason: 'refund', note: 'Case could not be created' }); } catch (e) {} }
    return res.status(400).json({ error: error.message.includes('duplicate') ? 'You already have an application for this opportunity' : error.message });
  }
  if (debited) { try { await admin().from('credit_ledger').update({ application_id: appRow.id }).eq('user_id', req.userId).eq('reason', 'consume').is('application_id', null); } catch (e) {} }
  if (req.body && req.body.requirements_acknowledged) admin().from('audit_log').insert({ actor: req.userId, event: 'REQ_ACK', detail: 'Requirements acknowledged before case ' + appRow.case_no + ' (' + opp.institution + ')' }).then(() => {}, () => {});
  res.json({ application: appRow, freeCase: false });
}
app.get('/api/applications', auth, async (req, res) => {
  const { data } = await admin().from('applications').select('*, opportunities(title,institution,country_code,deadline,url)').eq('user_id', req.userId).order('updated_at', { ascending: false });
  res.json({ applications: data || [] });
});



/* ---------- documents: upload, read, view, delete + auto profile fill ---------- */
// (multer defined near the top so every upload route can use it)
const { saveUpload, signedUrl, extractProfile } = require('./lib/docs');
app.post('/api/documents', auth, up.array('files', 20), enforceUploadLimits, async (req, res) => {
  try {
    // Optional section override: when the user adds files from a specific profile
    // section, that section's kind wins over filename-based classification.
    const VALID_KINDS = ['cv','transcript','degree','certificate','english_test','license','publication','reference_letter','document'];
    const kindOverride = VALID_KINDS.includes(String(req.body && req.body.kind || '')) ? String(req.body.kind) : null;
    const results = [];
    for (const f of (req.files || [])) {
      try { const d = await saveUpload(req.userId, f, kindOverride); results.push({ id: d.id, name: d.name, kind: d.kind }); }
      catch (e) { results.push({ name: f.originalname, error: e.message }); }
    }
    const ok = results.some(r => !r.error);
    res.json({ ok, results, autofill: ok });
    // A referred user uploading a document is the qualification event: check the
    // referrer's milestones now so rewards issue automatically, never manually.
    try {
      const { data: prof } = await admin().from('profiles').select('referred_by').eq('id', req.userId).single();
      if (prof && prof.referred_by && prof.referred_by !== req.userId) {
        require('./lib/referral').syncRewards(prof.referred_by).catch(() => {});
      }
    } catch (e) {}
    if (ok) setTimeout(() => {
      // Extraction rides the same surge gate as search and prepare: even 50
      // simultaneous uploads queue fairly instead of storming the AI provider.
      require('./lib/jobs').runJob('prepare', 'autofill:' + req.userId + ':' + Date.now(), req.userId,
        () => extractProfile(req.userId),
        { retries: 0, timeoutMs: 300000 }
      ).catch(e => admin().from('audit_log').insert({ actor: req.userId, event: 'AUTOFILL_FAIL', detail: String(e.message).slice(0, 200) }).then(() => {}, () => {}));
    }, 1200);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* ---------- profile avatar (private bucket, signed URL) ---------- */
app.post('/api/me/avatar', auth, up.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a photo first' });
    if (!/^image\//.test(req.file.mimetype)) return res.status(400).json({ error: 'Please upload an image (JPG or PNG)' });
    if (req.file.size > 5 * 1024 * 1024) return res.status(400).json({ error: 'Photo must be under 5 MB' });
    const { BUCKET } = require('./lib/docs');
    const key = req.userId + '/avatar_' + Date.now() + '.' + (req.file.mimetype.split('/')[1] || 'jpg');
    const { error } = await admin().storage.from(BUCKET).upload(key, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (error) return res.status(400).json({ error: error.message });
    const { data: old } = await admin().from('profiles').select('avatar_key').eq('id', req.userId).single();
    let upd = await admin().from('profiles').update({ avatar_key: key }).eq('id', req.userId);
    if (upd.error && /avatar_key|column/.test(upd.error.message || '')) return res.status(400).json({ error: 'Run migration 0011 first (avatar_key column missing)' });
    if (old && old.avatar_key) { try { await admin().storage.from(BUCKET).remove([old.avatar_key]); } catch (e) {} }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/me/avatar/url', auth, async (req, res) => {
  try {
    const { data: p } = await admin().from('profiles').select('avatar_key').eq('id', req.userId).single();
    if (!p || !p.avatar_key) return res.json({ url: null });
    const { signedUrl } = require('./lib/docs');
    res.json({ url: await signedUrl(p.avatar_key, 3600) });
  } catch (e) { res.json({ url: null }); }
});
app.get('/api/documents', auth, async (req, res) => {
  const { data } = await admin().from('documents').select('id,kind,name,mime,size_bytes,created_at').eq('user_id', req.userId).eq('generated', false).order('created_at', { ascending: false });
  res.json({ documents: data || [] });
});
// Canonical document checklist - what strengthens a client's study/work case.
// Maps uploaded documents (by their classified `kind`) onto a fixed list so the
// Profile page can show a clear "have / still needed" checklist.
const DOC_CHECKLIST = [
  { key: 'cv',            label: 'CV / Resume',                 required: true,  match: ['cv'] },
  { key: 'transcript',   label: 'Academic transcripts',        required: true,  match: ['transcript'] },
  { key: 'degree',       label: 'Degree certificates',         required: true,  match: ['degree'] },
  { key: 'english_test', label: 'English test (IELTS/TOEFL/PTE)', required: true, match: ['english_test'] },
  { key: 'passport',     label: 'Passport (photo page) - optional, not needed to start', required: false, match: ['passport'] },
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
  /* The role families are derived from the CV, so a new CV must rebuild them. Done after
     the response is sent: the applicant should never wait on it. */
  try {
    const out = await extractProfile(req.userId);
    res.json({ ok: true, ...out });
    (async () => {
      try {
        const TGT = require('./lib/targeting');
        const { data: p } = await admin().from('profiles').select('*').eq('id', req.userId).single();
        const { data: pxr } = await admin().from('app_settings').select('value').eq('key', 'profilex:' + req.userId).single();
        await TGT.buildTargeting(req.userId, pxr && pxr.value && pxr.value.x, p, true);
      } catch (e) {}
    })();
    return;
  }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// Item 13: preview extraction without committing, so the user can review first.
app.post('/api/profile/autofill/preview', auth, async (req, res) => {
  try { const out = await extractProfile(req.userId, { dry: true }); res.json({ ok: true, ...out }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// Apply only the fields the user confirmed from the preview.
app.post('/api/profile/autofill/apply', auth, async (req, res) => {
  const patch = (req.body && req.body.patch) || {};
  const referees = (req.body && req.body.referees) || [];
  const allowed = ['headline','field','methods','phone','education','publications','experience','licenses','links'];
  const clean = {};
  for (const k of allowed) if (k in patch) clean[k] = patch[k];
  if (Object.keys(clean).length) { clean.updated_at = new Date().toISOString(); await admin().from('profiles').update(clean).eq('id', req.userId); }
  let refsAdded = 0;
  for (const r of referees.slice(0, 6)) {
    if (!r || !r.name) continue;
    const { data: ex } = await admin().from('referees').select('id').eq('user_id', req.userId).eq('name', r.name).limit(1);
    if (ex && ex.length) continue;
    await admin().from('referees').insert({ user_id: req.userId, name: r.name, title: r.title || '', institution: r.institution || '', email: String(r.email || '').toLowerCase(), relationship: r.relationship || '' });
    refsAdded++;
  }
  await admin().from('audit_log').insert({ actor: req.userId, event: 'AUTOFILL_APPLIED', detail: Object.keys(clean).join(',') + (refsAdded ? ' +' + refsAdded + ' referees' : '') });
  res.json({ ok: true, applied: Object.keys(clean), refsAdded });
});
// Profile readiness - computed from real profile fields + document checklist.
// Honest by construction: a section is 'complete' only if the underlying data
// actually exists. Nothing here infers or invents.
app.get('/api/profile/readiness', auth, async (req, res) => {
  const { data: p } = await admin().from('profiles').select('*').eq('id', req.userId).single();
  const { data: docs } = await admin().from('documents').select('kind').eq('user_id', req.userId).eq('generated', false);
  const { data: refs } = await admin().from('referees').select('id').eq('user_id', req.userId);
  const have = new Set((docs || []).map(d => String(d.kind || '').toLowerCase()));
  const nonEmpty = v => Array.isArray(v) ? v.length > 0 : !!(v && String(v).trim());
  const prof = p || {};
  // Each section: whether it's filled, and whether a supporting document backs it (=> verified-ish)
  const sections = [
    { key: 'personal',    label: 'Personal information', filled: nonEmpty(prof.full_name) && nonEmpty(prof.phone), doc: false,                 required: true },
    { key: 'headline',    label: 'Professional headline', filled: nonEmpty(prof.headline),                          doc: false,                 required: true },
    { key: 'education',   label: 'Education',             filled: nonEmpty(prof.education),                          doc: have.has('degree'),    required: true },
    { key: 'transcript',  label: 'Academic transcript',  filled: have.has('transcript'),                           doc: have.has('transcript'), required: true },
    { key: 'cv',          label: 'CV / Resume',          filled: have.has('cv'),                                   doc: have.has('cv'),        required: true },
    { key: 'experience',  label: 'Work experience',      filled: nonEmpty(prof.experience),                        doc: have.has('certificate'),required: false },
    { key: 'research',    label: 'Publications / research', filled: nonEmpty(prof.publications),                    doc: have.has('publication'),required: false },
    { key: 'english',     label: 'English test',         filled: have.has('english_test'),                         doc: have.has('english_test'),required: false },
    { key: 'passport',    label: 'Passport',             filled: have.has('passport'),                             doc: have.has('passport'),  required: false },
    { key: 'licenses',    label: 'Professional license', filled: nonEmpty(prof.licenses) || have.has('license'),   doc: have.has('license'),   required: false },
    { key: 'referees',    label: 'Referees',             filled: (refs || []).length > 0,                          doc: false,                 required: false }
  ].map(s => ({
    ...s,
    status: s.filled ? (s.doc ? 'verified' : 'provided') : (s.required ? 'required' : 'recommended')
  }));
  const reqSecs = sections.filter(s => s.required);
  const reqDone = reqSecs.filter(s => s.filled).length;
  const allDone = sections.filter(s => s.filled).length;
  // Weighted: required sections carry more weight than optional ones.
  const wReq = 0.7, wOpt = 0.3;
  const optSecs = sections.filter(s => !s.required);
  const optDone = optSecs.filter(s => s.filled).length;
  const pct = Math.round(100 * (
    (reqSecs.length ? wReq * reqDone / reqSecs.length : 0) +
    (optSecs.length ? wOpt * optDone / optSecs.length : 0)
  ));
  // Recommended next actions, ordered: required-missing first, then recommended-missing.
  const actions = sections
    .filter(s => !s.filled)
    .sort((a, b) => (b.required - a.required))
    .slice(0, 4)
    .map(s => ({ key: s.key, label: s.label, required: s.required }));
  res.json({ pct, sections, requiredTotal: reqSecs.length, requiredDone: reqDone, sectionsFilled: allDone, sectionsTotal: sections.length, actions });
});
app.get('/api/referees', auth, async (req, res) => {
  const { data } = await admin().from('referees').select('*').eq('user_id', req.userId).order('created_at');
  res.json({ referees: data || [] });
});

/* ---------- Phase 2: field provenance + conflict resolution ---------- */

/* ---------- Phase 2: per-field provenance + cross-doc verification ---------- */
const { rebuildProvenance, listFields, resolveField } = require('./lib/provenance');
app.get('/api/profile/fields', auth, async (req, res) => {
  try {
    const fields = await listFields(req.userId);
    const conflicts = fields.filter(f => f.status === 'conflicting' && !f.resolved).length;
    const verified = fields.filter(f => f.status === 'verified').length;
    res.json({ fields, conflicts, verified });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/profile/verify', auth, async (req, res) => {
  // Kick the cross-document verification. Returns immediately; work continues in background.
  res.json({ ok: true, message: 'Reading your documents and cross-checking them. Refresh in a moment.' });
  rebuildProvenance(req.userId).catch(e => admin().from('audit_log').insert({ actor: req.userId, event: 'PROVENANCE_FAIL', detail: String(e.message).slice(0, 200) }).then(() => {}, () => {}));
});
app.post('/api/profile/fields/:key/resolve', auth, async (req, res) => {
  try {
    const out = await resolveField(req.userId, String(req.params.key), (req.body && req.body.value) || '');
    res.json(out);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---------- Phase 4: eligibility matching + Why You Match ---------- */
const { matchOpportunity, matchMany } = require('./lib/match');
app.get('/api/opportunities/:id/match', auth, async (req, res) => {
  try { res.json(await matchOpportunity(req.userId, req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});


/* ---------- ForiForeign Apply Assistant: signed application packages ---------- */
const applyLib = require('./lib/apply');
// Signed, short-lived package for one application. No mailbox access, no credentials, never auto-sends.
app.get('/api/applications/:id/package', auth, async (req, res) => {
  const cfg = await siteSettings.getConfig().catch(() => siteSettings.DEFAULTS);
  const aa = cfg.apply_assistant || {};
  if (aa.enabled === false) return res.status(503).json({ error: 'Online application assistance is temporarily unavailable.' });
  const { data: a } = await admin().from('applications').select('*, opportunities(*)').eq('id', req.params.id).single();
  if (!a || a.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  const { data: msg } = await admin().from('messages').select('*').eq('application_id', a.id).eq('direction', 'outbound').in('status', ['approved', 'ready', 'pending']).order('created_at', { ascending: false }).limit(1).single();
  if (!msg) return res.status(400).json({ error: 'Prepare the application first.' });
  const recipientEmail = (msg.to_emails || [])[0] || '';
  if (!recipientEmail) {
    // Safety net: an email package must never have a blank recipient. If we reach here, the
    // opportunity is portal-only - tell the client to use the official portal instead.
    const o0 = a.opportunities || {};
    return res.status(409).json({ error: 'portal_only', portal_url: o0.url || a.portal_url || '', message: 'This opportunity applies through its official portal. Your documents are ready to attach there.' });
  }
  const { data: docs } = await admin().from('application_documents').select('id,kind,title,themed_key').eq('application_id', a.id);
  /* The applicant's OWN CV must always travel with the application. We no longer rewrite
     it, so it is not in application_documents: we attach the uploaded original directly.
     Without this, an application would go out with no CV at all. */
  let ownDocs = [];
  const attachMode = ((a.prep_status || {}).attach_mode === 'self') ? 'self' : 'us';
  try {
    if (attachMode === 'self') throw new Error('applicant attaches their own files');
    const { data: mine } = await admin().from('documents')
      .select('id,name,kind,storage_key,mime,created_at')
      .eq('user_id', req.userId).eq('generated', false)
      .order('created_at', { ascending: false }).limit(12);
    const isCV = d => /cv|resume|curriculum/i.test(String(d.name || '') + ' ' + String(d.kind || ''));
    const cv = (mine || []).find(isCV);
    if (cv) ownDocs.push({ id: 'own:' + cv.id, filename: applyLib.niceName({ kind: 'cv', title: cv.name || 'CV' }),
      url: '/api/apply/own/' + cv.id + '?' + applyLib.docQuery(cv.id, req.userId) });
    // Supporting evidence the applicant chose to upload, capped so the email stays sane.
    for (const d of (mine || [])) {
      if (cv && d.id === cv.id) continue;
      if (!/publication|thesis|licen|degree|transcript|certificate|experience|reference/i.test(String(d.name || '') + ' ' + String(d.kind || ''))) continue;
      if (ownDocs.length >= 5) break;
      ownDocs.push({ id: 'own:' + d.id, filename: (d.name || 'Document').replace(/\.[a-z0-9]+$/i, '') + '.pdf',
        url: '/api/apply/own/' + d.id + '?' + applyLib.docQuery(d.id, req.userId) });
    }
  } catch (e) {}
  const o = a.opportunities || {};
  const pkg = applyLib.buildPackage({
    applicationId: a.id, opportunityId: o.id || '',
    recipient: recipientEmail, recipientName: o.contact_name || '',
    organization: o.institution || '', subject: msg.subject || '', body: msg.body || '',
    /* "I will attach my own files" has to mean exactly that. Dropping only the uploaded
       originals while still attaching our letters would produce a draft the applicant did
       not ask for and might not notice. Self mode attaches nothing at all. */
    attachments: attachMode === 'self' ? []
      : ownDocs.concat((docs || []).map(d => ({ id: d.id, filename: applyLib.niceName(d), url: '/api/apply/doc/' + d.id + '?' + applyLib.docQuery(d.id, req.userId) })))
  });
  await admin().from('audit_log').insert({ actor: req.userId, event: 'APPLY_PACKAGE', detail: a.id });
  // Safe profile subset for the extension form-filler (Phase 2) - never documents, never credentials.
  let pr = {}; try { const { data: prof } = await admin().from('profiles').select('full_name,email,phone,city,address,last_institution,degree_level,field,cgpa,experience_years,language_scores,linkedin').eq('id', req.userId).single(); pr = prof || {}; } catch (e) {}
  // Licence details are the fields Gulf and NHS portals screen on first, so the assistant
  // can fill them too. Still never documents, passwords or payment data.
  let licInfo = {};
  try {
    const { data: pf } = await admin().from('app_settings').select('value').eq('key', 'prefs:' + req.userId).single();
    const pv = (pf && pf.value) || {};
    licInfo.license_authority = (pv.licenseResolved && pv.licenseResolved.authority) || pv.licenseHeld || '';
    const { data: px } = await admin().from('app_settings').select('value').eq('key', 'profilex:' + req.userId).single();
    const x = (px && px.value && px.value.x) || {};
    licInfo.license_number = x.license_number || '';
    licInfo.profession = (x.professions && x.professions[0]) || x.profession || pr.field || '';
  } catch (e) {}
  pkg.profile = { full_name: pr.full_name, email: pr.email, phone: pr.phone, city: pr.city, address: pr.address,
    last_institution: pr.last_institution, degree_level: pr.degree_level, field: pr.field, cgpa: pr.cgpa,
    experience_years: pr.experience_years, language_scores: pr.language_scores, linkedin: pr.linkedin,
    license_number: licInfo.license_number || '', license_authority: licInfo.license_authority || '', profession: licInfo.profession || '' };
  res.json(pkg);
});
// Short-lived signed PDF fetch for one prepared document (used by the assistant to attach files).
/* Serves the applicant's OWN uploaded file (their CV, publications, licence and so on)
   to the Apply Assistant, so real documents travel with the application. Signed and
   short-lived, exactly like generated documents. */
app.get('/api/apply/own/:docId', async (req, res) => {
  try {
    const v = applyLib.verifyDocQuery(req.params.docId, req.query);
    if (!v.ok) return res.status(403).json({ error: 'Link expired. Press APPLY again.' });
    const { data: d } = await admin().from('documents').select('*').eq('id', req.params.docId).single();
    if (!d || d.user_id !== v.userId) return res.status(404).json({ error: 'Not found' });
    const { BUCKET } = require('./lib/docs');
    const { data: file, error } = await admin().storage.from(BUCKET).download(d.storage_key);
    if (error || !file) return res.status(404).json({ error: 'File unavailable' });
    const buf = Buffer.from(await file.arrayBuffer());
    const name = String(d.name || 'document').replace(/["\r\n]/g, '');
    res.setHeader('Content-Type', d.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
    res.send(buf);
  } catch (e) { res.status(400).json({ error: 'Document unavailable' }); }
});
app.get('/api/apply/doc/:docId', async (req, res) => {
  try {
    const v = applyLib.verifyDocQuery(req.params.docId, req.query);
    if (!v.ok) return res.status(403).json({ error: 'Link expired. Press APPLY again.' });
    const { data: d } = await admin().from('application_documents').select('*, applications!inner(user_id)').eq('id', req.params.docId).single();
    if (!d || d.applications.user_id !== v.userId) return res.status(404).json({ error: 'Not found' });
    const { textToPdf } = require('./lib/agents');
    const pdf = await textToPdf(d.title, d.content);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + applyLib.niceName(d).replace(/"/g, '') + '"');
    res.send(pdf);
  } catch (e) { res.status(400).json({ error: 'Document unavailable' }); }
});


app.get('/api/admin/overview', auth, perm('overview.read'), async (req, res) => {
  const { data: pend } = await admin().from('payments').select('*, profiles(full_name)').eq('status', 'pending').order('created_at');
  const { data: users } = await admin().from('profiles').select('id');
  const { data: costs } = await admin().from('ai_cost_ledger').select('cost_usd');
  const { data: apps } = await admin().from('applications').select('id');
  let flags = [];
  try { const r = await admin().from('abuse_flags').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(20); flags = r.data || []; } catch (e) {}
  res.json({ users: (users||[]).length, applications: (apps||[]).length,
    aiCostUsd: (costs||[]).reduce((s,c)=>s+Number(c.cost_usd||0),0).toFixed(4),
    pendingPayments: pend||[], abuseFlags: flags });
});

/* Not interested: hide an opportunity from this user permanently (never re-shown). */
app.post('/api/opportunities/:id/reject', auth, async (req, res) => {
  try {
    const key = 'rejected:' + req.userId;
    let ids = [];
    try { const { data } = await admin().from('app_settings').select('value').eq('key', key).single(); ids = (data && data.value && data.value.ids) || []; } catch (e) {}
    if (!ids.includes(req.params.id)) ids.push(req.params.id);
    await admin().from('app_settings').upsert({ key, value: { ids: ids.slice(-500) } });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
/* Referral claim: a new user attaches to the friend whose link brought them. */
/* ---------- Referral rewards: qualified referrals earn free case credits ---------- */
/* Has this account ever paid? Referral rewards are for paying customers only, so the
   programme cannot be farmed by accounts that never buy anything. */
async function hasEverPaid(userId) {
  try {
    const { data } = await admin().from('payments').select('id').eq('user_id', userId).eq('status', 'confirmed').limit(1);
    if (data && data.length) return true;
    // A granted or promo credit also counts as an activated customer.
    const { data: led } = await admin().from('credit_ledger').select('id')
      .eq('user_id', userId).in('reason', ['purchase', 'promo_grant', 'support_grant']).limit(1);
    return !!(led && led.length);
  } catch (e) { return false; }
}
/* G3: OUTCOME TRACKING. Without knowing which applications succeed we can never improve
   ranking, and we can never tell a client what actually works. One question, optional. */
app.post('/api/applications/:id/outcome', auth, async (req, res) => {
  try {
    const outcome = String((req.body && req.body.outcome) || '');
    if (!['no_reply', 'rejected', 'interview', 'offer', 'accepted', 'withdrew'].includes(outcome))
      return res.status(400).json({ error: 'Choose one of the listed outcomes.' });
    const { data: a } = await admin().from('applications').select('id,user_id,opportunity_id').eq('id', req.params.id).single();
    if (!a || a.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
    await admin().from('applications').update({
      outcome, outcome_at: new Date().toISOString(),
      outcome_note: String((req.body && req.body.note) || '').slice(0, 400)
    }).eq('id', a.id);
    try { await admin().from('audit_log').insert({ actor: req.userId, event: 'OUTCOME', detail: outcome + ' for ' + a.id }); } catch (e) {}
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
/* G5: SAVED SEARCHES. A user should not have to rebuild filters every time. */
/* Dismissing an opportunity. The user has judged it and does not want it again, so we
   respect that permanently rather than showing it in every future search. Reversible. */
app.post('/api/opportunities/:id/dismiss', auth, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    const undo = !!(req.body && req.body.undo);
    const { data } = await admin().from('app_settings').select('value').eq('key', 'dismissed:' + req.userId).single();
    let ids = ((data && data.value && data.value.ids) || []).filter(Boolean);
    if (undo) ids = ids.filter(x => x !== id);
    else if (!ids.includes(id)) ids.push(id);
    await admin().from('app_settings').upsert({ key: 'dismissed:' + req.userId, value: { ids: ids.slice(-500), at: new Date().toISOString() } });
    res.json({ ok: true, dismissed: !undo, count: ids.length });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/searches', auth, async (req, res) => {
  try {
    const { data } = await admin().from('app_settings').select('value').eq('key', 'savedsearch:' + req.userId).single();
    res.json({ searches: (data && data.value && data.value.list) || [] });
  } catch (e) { res.json({ searches: [] }); }
});
app.put('/api/searches', auth, async (req, res) => {
  try {
    const list = Array.isArray(req.body && req.body.list) ? req.body.list.slice(0, 8) : [];
    await admin().from('app_settings').upsert({ key: 'savedsearch:' + req.userId, value: { list, at: new Date().toISOString() } });
    res.json({ ok: true, list });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/referral/status', auth, async (req, res) => {
  try {
    const R = require('./lib/referral');
    const paid = await hasEverPaid(req.userId);
    if (!paid) {
      return res.json({ eligible: false,
        reason: 'Referral rewards unlock once you activate any package. Choose a package to start inviting and earning.' });
    }
    const cfg = await R.settings();
    const sync = await R.syncRewards(req.userId);
    const w = await R.wallet(req.userId);
    const { data: me } = await admin().from('profiles').select('referral_code').eq('id', req.userId).single();
    let code = me && me.referral_code;
    if (!code) {
      code = 'FF' + req.userId.replace(/-/g, '').slice(0, 8).toUpperCase();
      try { await admin().from('profiles').update({ referral_code: code }).eq('id', req.userId); } catch (e) {}
    }
    const perMilestone = cfg.per_milestone;
    const toNext = perMilestone - (sync.qualified % perMilestone);
    res.json({
      eligible: true,
      code,
      link: 'https://foriforeign.com/?ref=' + code,
      per_milestone: perMilestone,
      credits_per_milestone: cfg.credits_per_milestone,
      expiry_months: cfg.expiry_months,
      qualified: sync.qualified,
      pending: sync.pending,
      total: sync.qualified + sync.pending,
      progress: sync.qualified % perMilestone,
      to_next: sync.qualified > 0 && toNext === perMilestone ? perMilestone : toNext,
      available: w.active.length,
      used: w.used,
      expired: w.expired,
      // Never expose who the referred people are; only dates and status.
      credits: w.all.map(c => ({ milestone: c.milestone, earned_at: c.earned_at, expires_at: c.expires_at, status: c.status }))
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
/* Redeem one free case credit. Serialized per user so two taps cannot double-spend. */
app.post('/api/referral/redeem', auth, (req, res) => withUserLock(req.userId, async () => {
  try {
    const R = require('./lib/referral');
    const credit = await R.redeem(req.userId, 'solo_activation');
    if (!credit) return res.status(400).json({ error: 'You have no active free credits right now.' });
    // Grant exactly one case credit through the normal ledger.
    await admin().from('credit_ledger').insert({
      user_id: req.userId, delta: 1, reason: 'referral_reward',
      note: 'Free case credit from referral milestone ' + credit.milestone
    });
    try { await admin().from('audit_log').insert({ actor: req.userId, event: 'REFERRAL_REDEEM', detail: 'milestone ' + credit.milestone + ', credit ' + credit.id }); } catch (e) {}
    res.json({ ok: true, expires_at: credit.expires_at, milestone: credit.milestone });
  } catch (e) { res.status(400).json({ error: e.message }); }
}));
app.post('/api/referral/claim', auth, async (req, res) => {
  const code = String(req.body && req.body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (!code) return res.status(400).json({ error: 'Code required' });
  const { data: me } = await admin().from('profiles').select('referred_by,referral_code').eq('id', req.userId).single();
  if (me && me.referred_by) return res.json({ ok: true, already: true });
  if (me && me.referral_code === code) return res.status(400).json({ error: 'That is your own code' });
  const { data: refr } = await admin().from('profiles').select('id').eq('referral_code', code).single();
  if (!refr) return res.status(404).json({ error: 'Referral code not found' });
  await admin().from('profiles').update({ referred_by: refr.id }).eq('id', req.userId);
  res.json({ ok: true });
});
/* ---------- Dormant hygiene: keep Supabase lean; admin removes unused accounts ---------- */
/* ADMIN RESET TOOLS. Two deliberate, separately-confirmed actions:
   - purge_users: delete every non-admin account and all of its data
   - reset_self:  clear the caller's own CVs, cases and profile so they can retest clean
   Both are irreversible, require an explicit typed confirmation, and are audit-logged. */
app.post('/api/admin/reset', auth, perm('users.write'), async (req, res) => {
  const mode = String((req.body && req.body.mode) || '');
  const confirm = String((req.body && req.body.confirm) || '');
  if (confirm !== 'RESET') return res.status(400).json({ error: 'Type RESET to confirm this action.' });

  const wipeUserData = async (uid) => {
    for (const tbl of ['application_documents', 'applications', 'documents', 'credit_ledger',
                       'payments', 'support_tickets', 'profile_fields', 'referral_credits']) {
      try { await admin().from(tbl).delete().eq('user_id', uid); } catch (e) {}
    }
    for (const k of ['profilex:', 'prefs:', 'licjourney:', 'targeting:']) {
      try { await admin().from('app_settings').delete().eq('key', k + uid); } catch (e) {}
    }
    try {
      const { BUCKET } = require('./lib/docs');
      for (const prefix of [uid, uid + '/tailored']) {
        const { data: files } = await admin().storage.from(BUCKET).list(prefix, { limit: 200 });
        if (files && files.length) await admin().storage.from(BUCKET).remove(files.map(f => prefix + '/' + f.name));
      }
    } catch (e) {}
  };

  try {
    if (mode === 'reset_self') {
      await wipeUserData(req.userId);
      try { await admin().from('audit_log').insert({ actor: req.userId, event: 'ADMIN_RESET_SELF', detail: 'Own CVs, cases and profile cleared for retesting' }); } catch (e) {}
      return res.json({ ok: true, mode, cleared: 1 });
    }
    if (mode === 'purge_users') {
      const { data: profs } = await admin().from('profiles').select('id, role');
      const staff = ['admin', 'super_admin', 'staff'];
      const targets = (profs || []).filter(p => !staff.includes(p.role));
      let removed = 0;
      for (const p of targets) {
        await wipeUserData(p.id);
        try { await admin().from('profiles').delete().eq('id', p.id); } catch (e) {}
        try { await admin().auth.admin.deleteUser(p.id); } catch (e) {}
        removed++;
      }
      try { await admin().from('audit_log').insert({ actor: req.userId, event: 'ADMIN_PURGE_USERS', detail: 'Removed ' + removed + ' non-staff accounts and all their data' }); } catch (e) {}
      return res.json({ ok: true, mode, removed, kept_staff: (profs || []).length - targets.length });
    }
    res.status(400).json({ error: 'Unknown reset mode.' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/admin/inventory', auth, perm('users.read'), async (req, res) => {
  try {
    const { count: total } = await admin().from('opportunities').select('id', { count: 'exact', head: true }).eq('status', 'verified');
    const { data: rows } = await admin().from('opportunities').select('kind,country_code,level,created_at').eq('status', 'verified').limit(2000);
    const byKind = {}, byCountry = {}, byLevel = {};
    let fresh7 = 0; const wk = Date.now() - 7 * 864e5;
    for (const r of (rows || [])) {
      byKind[r.kind || '?'] = (byKind[r.kind || '?'] || 0) + 1;
      byCountry[r.country_code || '??'] = (byCountry[r.country_code || '??'] || 0) + 1;
      byLevel[r.level || 'unclassified'] = (byLevel[r.level || 'unclassified'] || 0) + 1;
      if (r.created_at && new Date(r.created_at).getTime() > wk) fresh7++;
    }
    const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 12);
    res.json({ total: total || 0, fresh_last_7_days: fresh7, kinds: top(byKind), countries: top(byCountry), levels: top(byLevel) });
  } catch (e) { res.json({ total: 0, fresh_last_7_days: 0, kinds: [], countries: [], levels: [] }); }
});
app.get('/api/admin/demand', auth, perm('users.read'), async (req, res) => {
  try {
    const { data } = await admin().from('app_settings').select('key,value').like('key', 'prefs:%').limit(2000);
    const exams = {}, countries = {}, levels = {}, kinds = {};
    for (const r of (data || [])) {
      const v = r.value || {};
      (v.ctrys || []).forEach(x => { countries[x] = (countries[x] || 0) + 1; });
      (v.levels || []).forEach(x => { levels[x] = (levels[x] || 0) + 1; });
      if (v.kind) kinds[v.kind] = (kinds[v.kind] || 0) + 1;
    }
    const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 15);
    res.json({ exams: top(exams), countries: top(countries), levels: top(levels), kinds: top(kinds), users: (data || []).length });
  } catch (e) { res.json({ exams: [], countries: [], levels: [], kinds: [], users: 0 }); }
});
app.get('/api/admin/dormant', auth, perm('users.read'), async (req, res) => {
  const months = Math.min(36, Math.max(6, Number(req.query.months) || 12));
  const cutoff = new Date(Date.now() - months * 30 * 864e5).toISOString();
  const { data: profs } = await admin().from('profiles').select('id,full_name,updated_at,created_at').lt('updated_at', cutoff).limit(200);
  const out = [];
  for (const pr2 of (profs || [])) {
    const { count: apps2 } = await admin().from('applications').select('id', { count: 'exact', head: true }).eq('user_id', pr2.id);
    const { count: pays } = await admin().from('payments').select('id', { count: 'exact', head: true }).eq('user_id', pr2.id).eq('status', 'confirmed');
    if ((apps2 || 0) === 0 && (pays || 0) === 0) out.push({ id: pr2.id, name: pr2.full_name, last_active: pr2.updated_at, joined: pr2.created_at });
  }
  res.json({ months, dormant: out });
});
app.post('/api/admin/dormant/:userId/purge', auth, perm('users.write'), async (req, res) => {
  const uid = req.params.userId;
  // Safety: never purge anyone with cases or confirmed payments.
  const { count: apps2 } = await admin().from('applications').select('id', { count: 'exact', head: true }).eq('user_id', uid);
  const { count: pays } = await admin().from('payments').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'confirmed');
  if ((apps2 || 0) > 0 || (pays || 0) > 0) return res.status(400).json({ error: 'This account has cases or payments and cannot be purged.' });
  for (const t of ['documents', 'support_tickets', 'credit_ledger', 'payments']) { try { await admin().from(t).delete().eq('user_id', uid); } catch (e) {} }
  for (const k of ['lastRun:', 'discover:', 'prefs:']) { try { await admin().from('app_settings').delete().eq('key', k + uid); } catch (e) {} }
  try { await admin().from('profiles').delete().eq('id', uid); } catch (e) {}
  try { await admin().auth.admin.deleteUser(uid); } catch (e) {}
  await admin().from('audit_log').insert({ actor: req.userId, event: 'DORMANT_PURGE', detail: 'Removed dormant account ' + uid }).then(() => {}, () => {});
  res.json({ ok: true });
});
/* ---------- saved search preferences: one search remembers the next ---------- */
app.get('/api/prefs', auth, async (req, res) => {
  try { const { data } = await admin().from('app_settings').select('value').eq('key', 'prefs:' + req.userId).single(); res.json({ prefs: (data && data.value) || null }); }
  catch (e) { res.json({ prefs: null }); }
});
app.put('/api/prefs', auth, async (req, res) => {
  const v = (req.body && req.body.prefs) || {};
  const sArr = (a, re, cap) => Array.isArray(a) ? a.map(x => String(x)).filter(x => re.test(x)).slice(0, cap || 10) : [];
  const clean = {
    kind: ['study', 'work', 'both'].includes(v.kind) ? v.kind : 'study',
    funded: !!v.funded, remote: !!v.remote, visa: !!v.visa,
    ctrys: Array.isArray(v.ctrys) ? v.ctrys.filter(c => /^[A-Za-z]{2}$/.test(String(c))).map(c => String(c).toUpperCase()).slice(0, 15) : [],
    // Every finder choice persists - the promise "your selection is saved automatically" is kept here.
    fundings: sArr(v.fundings, /^(fully|partial|self)$/),
    levels: sArr(v.levels, /^[a-z_]{2,20}$/),
    langs: sArr(v.langs, /^[a-z_]{2,20}$/),
    jobTypes: sArr(v.jobTypes, /^[a-z_]{2,20}$/),
    exps: sArr(v.exps, /^[a-z]{2,10}$/),
    // Retired: we no longer sell licensing help, so there is no exam selection to store.
    licenses: [],
    programTypes: sArr(v.programTypes, /^[a-z_]{2,20}$/),
    sectors: sArr(v.sectors, /^[a-z_]{2,20}$/),
    workmode: ['', 'remote', 'onsite'].includes(String(v.workmode || '')) ? String(v.workmode || '') : '',
    field: /^[a-z][a-z-]{1,40}$/.test(String(v.field || '')) ? String(v.field) : '',
    intake: ['', '2026', '2027'].includes(String(v.intake || '')) ? String(v.intake || '') : '',
    // Lane-specific selections, remembered so the finder reopens as the user left it.
    tuition: String(v.tuition || '').slice(0, 20),
    stipendPref: String(v.stipendPref || '').slice(0, 20),
    instruction: String(v.instruction || '').slice(0, 20),
    uniType: String(v.uniType || '').slice(0, 20),
    appFee: String(v.appFee || '').slice(0, 20),
    deadlineIn: String(v.deadlineIn || '').slice(0, 10),
    visaSel: String(v.visaSel || '').slice(0, 20),
    contractLen: String(v.contractLen || '').slice(0, 20),
    startWhen: String(v.startWhen || '').slice(0, 20),
    salaryBand: String(v.salaryBand || '').slice(0, 20),
    // What the applicant typed, plus the resolved credential they ALREADY hold.
    licenseHeld: String(v.licenseHeld || '').slice(0, 120),
    licenseResolved: (v.licenseResolved && typeof v.licenseResolved === 'object') ? {
      code: String(v.licenseResolved.code || '').slice(0, 16),
      name: String(v.licenseResolved.name || '').slice(0, 90),
      authority: String(v.licenseResolved.authority || '').slice(0, 90),
      profession: String(v.licenseResolved.profession || '').slice(0, 60),
      confident: !!v.licenseResolved.confident
    } : null
  };
  try { await admin().from('app_settings').upsert({ key: 'prefs:' + req.userId, value: clean }); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* ---------- Future Path Guide: individualized post-acceptance roadmap PDF ---------- */
const FUTURE_PATH = {
  DE: { name: 'Germany', embassy: 'German Embassy Islamabad, Ramna 5, Diplomatic Enclave', portal: 'https://videx.diplo.de (VIDEX form) + appointment via the embassy website', funds: 'Blocked account approx. EUR 11,904 (Rs ~36 lakh) via Expatrio/Fintiba/Coracle, opened online', extra: 'APS certificate (aps-pakistan.pk) is required BEFORE the visa application.' },
  FI: { name: 'Finland', embassy: 'VFS Global Islamabad / Karachi (Finland residence permits)', portal: 'https://enterfinland.fi - apply online, then biometrics at VFS', funds: 'Approx. EUR 6,720/year (Rs ~21 lakh) in your own account', extra: 'Early tuition-waiver deadlines matter; accept your offer fast.' },
  IT: { name: 'Italy', embassy: 'Embassy of Italy Islamabad, Diplomatic Enclave', portal: 'Pre-enrolment on https://universitaly.it, then D-visa at the embassy', funds: 'Approx. EUR 6,000/year, plus DSU grant award letter if you have one', extra: 'Start degree attestation early; Italian pre-enrolment paperwork takes time.' },
  GB: { name: 'United Kingdom', embassy: 'VFS Global UK Visa Application Centres, Islamabad / Lahore / Karachi', portal: 'https://gov.uk/student-visa - apply online with your CAS', funds: 'GBP 1,023/month for 9 months outside London (Rs ~32 lakh), held 28 days', extra: 'IHS health surcharge is paid during the application; TB test at an approved clinic.' },
  AU: { name: 'Australia', embassy: 'Australian High Commission Islamabad (visas processed online)', portal: 'https://immi.homeaffairs.gov.au - Subclass 500 via ImmiAccount', funds: 'Approx. AUD 29,710/year (Rs ~55 lakh) evidence', extra: 'The GS (Genuine Student) statement matters most; write it yourself, honestly.' },
  SA: { name: 'Saudi Arabia', embassy: 'Royal Embassy of Saudi Arabia Islamabad; work visas via Enjaz/Musaned through your employer', portal: 'Your employer initiates the work visa; you complete biometrics at Etimad centres', funds: 'Employer-sponsored; no personal bank statement normally required for work visas', extra: 'SCFHS classification (via DataFlow + Prometric) must be complete for healthcare roles.' },
  AE: { name: 'United Arab Emirates', embassy: 'Employer processes the work permit; entry visa issued electronically', portal: 'Employer-driven via MOHRE/ICP; you provide attested documents', funds: 'Employer-sponsored', extra: 'DHA/HAAD/MOH licensing via DataFlow verification must be complete.' },
  CA: { name: 'Canada', embassy: 'VFS Global Canada Visa Application Centres, Islamabad / Lahore / Karachi', portal: 'https://ircc.canada.ca - study permit online (SDS closed; regular stream)', funds: 'CAD 20,635/year + first-year tuition (GIC where applicable)', extra: 'Provincial attestation letter (PAL) is required with most study permits.' },
  US: { name: 'United States', embassy: 'US Embassy Islamabad / Consulate Karachi - F-1 interview', portal: 'Pay SEVIS fee (fmjfee.com), complete DS-160, book the interview', funds: 'Evidence covering I-20 first-year amount', extra: 'Carry original documents to the interview; answer plainly and honestly.' },
  KR: { name: 'South Korea', embassy: 'Embassy of the Republic of Korea, Islamabad (Diplomatic Enclave)', portal: 'D-2 student visa at the embassy with your Certificate of Admission; GKS awardees follow NIIED instructions', funds: 'Approx. USD 20,000 bank balance certificate for self-financed; GKS is fully covered', extra: 'TOPIK improves both admission and GKS scoring; apply via embassy OR university track.' },
  JP: { name: 'Japan', embassy: 'Embassy of Japan Islamabad; visa via designated agencies after CoE', portal: 'University obtains your Certificate of Eligibility (CoE), then you apply for the student visa', funds: 'MEXT is fully funded; self-financed need approx. JPY 2M/year evidence', extra: 'MEXT embassy-track opens April-May yearly at the embassy website.' },
  CN: { name: 'China', embassy: 'Embassy of China Islamabad / consulates Karachi, Lahore', portal: 'X1 visa with JW201/JW202 form + admission letter; CSC awardees get JW201', funds: 'CSC is fully funded (tuition, dorm, stipend); self-financed approx. USD 4,000-8,000/year', extra: 'CSC applications run November-March via csc.edu.cn and university portals.' },
  TR: { name: 'Turkiye', embassy: 'Embassy of Turkiye Islamabad; e-visa/education visa after acceptance', portal: 'Turkiye Burslari (turkiyeburslari.gov.tr) covers everything; visa with acceptance letter', funds: 'Burslari is fully funded incl. flight; self-financed approx. USD 3,000-6,000/year', extra: 'Burslari window is typically January-February - one application, all universities.' },
  IE: { name: 'Ireland', embassy: 'Embassy of Ireland Islamabad (visa via VFS)', portal: 'Study visa online at irishimmigration.ie, then VFS biometrics', funds: 'EUR 10,000 evidence plus first-year fees paid', extra: 'Government of Ireland International Education Scholarship pays EUR 10,000 + full fee waiver.' },
  NL: { name: 'Netherlands', embassy: 'Netherlands embassy route is handled BY the university (TEV procedure)', portal: 'The university applies for your MVV/residence permit; you attend biometrics when called', funds: 'Approx. EUR 13,000/year transferred to the university before arrival', extra: 'Orange Knowledge and university excellence scholarships stack with this route.' },
  HU: { name: 'Hungary', embassy: 'Embassy of Hungary Islamabad', portal: 'Stipendium Hungaricum via apply.stipendiumhungaricum.hu (deadline mid-January), then D visa', funds: 'Stipendium is fully funded: tuition, stipend, housing allowance, insurance', extra: 'HEC Pakistan co-nominates - watch hec.gov.pk for the parallel window.' },
  NZ: { name: 'New Zealand', embassy: 'New Zealand visas are processed online (no local embassy visit needed)', portal: 'Student visa via immigration.govt.nz with offer of place', funds: 'NZD 20,000/year evidence plus tuition', extra: 'Post-study work rights up to 3 years; Manaaki New Zealand Scholarships are fully funded.' }
};
/* Official routes for every destination we serve, so a guide is never thin because the
   country happens to be Lithuania instead of Germany. Addresses are the mission in
   Pakistan; portals are the government's own site, which is the only authority on fees,
   appointments and document lists. Phone numbers are NOT hardcoded here on purpose:
   mission numbers change, and a wrong number in a guide is worse than no number, so the
   live brief below fetches the current contact details at generation time. */
/* Every destination we serve, by name. A guide that says "LT" instead of "Lithuania"
   reads like a database dump, and the applicant has to go and look it up. */
const CC_FULL = { AU: 'Australia', AT: 'Austria', AZ: 'Azerbaijan', BH: 'Bahrain', BE: 'Belgium',
  BN: 'Brunei', BG: 'Bulgaria', CA: 'Canada', CN: 'China', HR: 'Croatia', CY: 'Cyprus',
  CZ: 'Czechia', DK: 'Denmark', EE: 'Estonia', FI: 'Finland', FR: 'France', GE: 'Georgia',
  DE: 'Germany', GR: 'Greece', HK: 'Hong Kong', HU: 'Hungary', IE: 'Ireland', IT: 'Italy',
  JP: 'Japan', KZ: 'Kazakhstan', KW: 'Kuwait', LV: 'Latvia', LT: 'Lithuania', LU: 'Luxembourg',
  MY: 'Malaysia', MT: 'Malta', NL: 'Netherlands', NZ: 'New Zealand', NO: 'Norway', OM: 'Oman',
  PL: 'Poland', PT: 'Portugal', QA: 'Qatar', RO: 'Romania', SA: 'Saudi Arabia', SG: 'Singapore',
  SK: 'Slovakia', SI: 'Slovenia', KR: 'South Korea', ES: 'Spain', SE: 'Sweden', CH: 'Switzerland',
  TW: 'Taiwan', TH: 'Thailand', TR: 'Turkiye', AE: 'United Arab Emirates', GB: 'United Kingdom',
  US: 'United States', UZ: 'Uzbekistan', ZA: 'South Africa', PK: 'Pakistan' };
const MISSION = {
  AU: { m: 'Australian High Commission, Constitution Avenue, Diplomatic Enclave, Islamabad (visas processed online)', u: 'https://immi.homeaffairs.gov.au' },
  AT: { m: 'Embassy of Austria, Diplomatic Enclave, Islamabad', u: 'https://www.bmeia.gv.at/en/austrian-embassy-islamabad' },
  AZ: { m: 'Embassy of Azerbaijan, Diplomatic Enclave, Islamabad', u: 'https://evisa.gov.az' },
  BH: { m: 'Embassy of Bahrain, Diplomatic Enclave, Islamabad (work visas are employer-sponsored)', u: 'https://www.evisa.gov.bh' },
  BE: { m: 'Embassy of Belgium, Diplomatic Enclave, Islamabad (visa intake via VFS Global)', u: 'https://dofi.ibz.be/en' },
  BN: { m: 'High Commission of Brunei Darussalam, Islamabad', u: 'https://www.imigresen.gov.bn' },
  BG: { m: 'Embassy of Bulgaria, Islamabad', u: 'https://www.mfa.bg/en' },
  CA: { m: 'VFS Global Canada Visa Application Centres, Islamabad, Lahore and Karachi', u: 'https://www.canada.ca/en/immigration-refugees-citizenship.html' },
  CN: { m: 'Embassy of China, Diplomatic Enclave, Islamabad; consulates in Karachi and Lahore', u: 'https://www.visaforchina.cn' },
  HR: { m: 'Croatia is represented for Pakistan from its mission in the region; applications via VFS Global', u: 'https://mup.gov.hr/en' },
  CY: { m: 'High Commission of Cyprus (accredited to Pakistan); student visas via the Civil Registry and Migration Department', u: 'http://www.moi.gov.cy/crmd' },
  CZ: { m: 'Embassy of the Czech Republic, Diplomatic Enclave, Islamabad', u: 'https://ipc.gov.cz/en' },
  DK: { m: 'Embassy of Denmark, Diplomatic Enclave, Islamabad (applications via VFS Global)', u: 'https://www.nyidanmark.dk/en-GB' },
  EE: { m: 'Estonia is represented via a nearby embassy; applications via VFS Global', u: 'https://www.politsei.ee/en' },
  FI: { m: 'VFS Global Finland, Islamabad and Karachi (residence permits)', u: 'https://enterfinland.fi' },
  FR: { m: 'Embassy of France, Diplomatic Enclave, Islamabad; intake via VFS Global', u: 'https://france-visas.gouv.fr/en' },
  GE: { m: 'Embassy of Georgia (accredited to Pakistan); e-visa available online', u: 'https://www.evisa.gov.ge' },
  GR: { m: 'Embassy of Greece, Islamabad', u: 'https://www.mfa.gr/en' },
  HK: { m: 'Hong Kong immigration is handled online; the Chinese mission handles related entry queries', u: 'https://www.immd.gov.hk/eng' },
  HU: { m: 'Embassy of Hungary, Diplomatic Enclave, Islamabad', u: 'https://konzuliszolgalat.kormany.hu/en' },
  IE: { m: 'Embassy of Ireland, Islamabad; intake via VFS Global', u: 'https://www.irishimmigration.ie' },
  IT: { m: 'Embassy of Italy, Diplomatic Enclave, Islamabad', u: 'https://www.universitaly.it' },
  JP: { m: 'Embassy of Japan, Diplomatic Enclave, Islamabad; visa after the Certificate of Eligibility', u: 'https://www.mofa.go.jp/j_info/visit/visa/index.html' },
  KZ: { m: 'Embassy of Kazakhstan, Islamabad', u: 'https://www.egov.kz/cms/en' },
  KW: { m: 'Embassy of Kuwait, Diplomatic Enclave, Islamabad (work visas are employer-sponsored)', u: 'https://www.moi.gov.kw' },
  LV: { m: 'Latvia is represented via a nearby embassy; applications via VFS Global', u: 'https://www.pmlp.gov.lv/en' },
  LT: { m: 'Lithuania is represented via a nearby embassy; applications via VFS Global', u: 'https://migracija.lt/en' },
  LU: { m: 'Luxembourg is represented via the Belgian mission for visa intake', u: 'https://guichet.public.lu/en.html' },
  MY: { m: 'High Commission of Malaysia, Diplomatic Enclave, Islamabad', u: 'https://educationmalaysia.gov.my' },
  MT: { m: 'Malta is represented via a nearby embassy; applications via VFS Global', u: 'https://identita.gov.mt' },
  NL: { m: 'Netherlands student and knowledge-migrant permits are applied for BY the university (TEV procedure); biometrics at VFS Global', u: 'https://ind.nl/en' },
  NZ: { m: 'New Zealand visas are decided online; no local mission visit is normally needed', u: 'https://www.immigration.govt.nz' },
  NO: { m: 'Embassy of Norway, Islamabad; intake via VFS Global', u: 'https://www.udi.no/en' },
  OM: { m: 'Embassy of Oman, Diplomatic Enclave, Islamabad (work visas are employer-sponsored)', u: 'https://evisa.rop.gov.om' },
  PL: { m: 'Embassy of Poland, Diplomatic Enclave, Islamabad', u: 'https://www.gov.pl/web/diplomacy' },
  PT: { m: 'Portugal is represented for Pakistan via a regional mission; intake via VFS Global', u: 'https://aima.gov.pt/en' },
  QA: { m: 'Embassy of Qatar, Diplomatic Enclave, Islamabad (work visas are employer-sponsored)', u: 'https://portal.moi.gov.qa' },
  RO: { m: 'Embassy of Romania, Islamabad', u: 'https://evisa.mae.ro' },
  SA: { m: 'Royal Embassy of Saudi Arabia, Diplomatic Enclave, Islamabad; work visas via Musaned/Enjaz through your employer', u: 'https://visa.mofa.gov.sa' },
  SG: { m: 'High Commission of Singapore (accredited to Pakistan); passes are applied for by the employer or institution', u: 'https://www.mom.gov.sg' },
  SK: { m: 'Slovakia is represented via a nearby embassy; applications via VFS Global', u: 'https://www.mzv.sk/en' },
  SI: { m: 'Slovenia is represented via a nearby embassy; applications via VFS Global', u: 'https://www.gov.si/en' },
  KR: { m: 'Embassy of the Republic of Korea, Diplomatic Enclave, Islamabad', u: 'https://www.visa.go.kr/openPage.do?MENU_ID=10101' },
  ES: { m: 'Embassy of Spain, Diplomatic Enclave, Islamabad; intake via BLS International', u: 'https://www.exteriores.gob.es/en' },
  SE: { m: 'Embassy of Sweden, Diplomatic Enclave, Islamabad; applications online then biometrics', u: 'https://www.migrationsverket.se/en' },
  CH: { m: 'Embassy of Switzerland, Diplomatic Enclave, Islamabad', u: 'https://www.sem.admin.ch/sem/en/home.html' },
  TW: { m: 'Taipei Economic and Cultural Office (regional, accredited to Pakistan)', u: 'https://www.boca.gov.tw/mp-2.html' },
  TH: { m: 'Royal Thai Embassy, Diplomatic Enclave, Islamabad', u: 'https://www.thaievisa.go.th' },
  TR: { m: 'Embassy of Turkiye, Diplomatic Enclave, Islamabad', u: 'https://www.turkiyeburslari.gov.tr' },
  AE: { m: 'Embassy of the UAE, Diplomatic Enclave, Islamabad; work permits are initiated by your employer', u: 'https://icp.gov.ae/en' },
  GB: { m: 'UK Visa Application Centres (VFS Global), Islamabad, Lahore and Karachi', u: 'https://www.gov.uk/student-visa' },
  US: { m: 'US Embassy Islamabad and US Consulate General Karachi', u: 'https://travel.state.gov/content/travel/en/us-visas.html' },
  UZ: { m: 'Embassy of Uzbekistan, Islamabad; e-visa available online', u: 'https://e-visa.gov.uz' },
  DE: { m: 'Embassy of Germany, Ramna 5, Diplomatic Enclave, Islamabad', u: 'https://videx.diplo.de' },
  ZA: { m: 'High Commission of South Africa, Diplomatic Enclave, Islamabad', u: 'https://www.dha.gov.za' }
};
/* Pakistan-side offices every applicant needs, with the official page for each. */
const PK_OFFICES = [
  ['HEC degree attestation', 'https://eservices.hec.gov.pk', 'Islamabad HQ (Sector H-9) plus Regional Centres in Lahore, Karachi, Peshawar, Quetta, Multan, Faisalabad, D.I. Khan, Gilgit and Muzaffarabad. Start the online account first, then book or courier.'],
  ['MOFA attestation (after HEC)', 'https://mofa.gov.pk', 'Islamabad HQ in the Mauve Area, plus Camp Offices in Karachi, Lahore, Peshawar, Quetta, Multan, Faisalabad, Sialkot and Gujranwala. Carry HEC-attested originals and your CNIC.'],
  ['IBCC (school certificates)', 'https://ibcc.edu.pk', 'For Matric and Intermediate equivalence and attestation, before HEC where a school certificate is required.'],
  ['Bureau of Emigration, Protector of Emigrants', 'https://beoe.gov.pk', 'Mandatory registration before departure for overseas employment. Offices in Islamabad, Rawalpindi, Lahore, Karachi, Peshawar, Multan and others.'],
  ['NADRA (CNIC, NICOP, FRC)', 'https://www.nadra.gov.pk', 'Family Registration Certificate is required by several embassies for dependants.'],
  ['Passport and Immigration', 'https://dgip.gov.pk', 'Keep at least 18 months validity before you apply for any long-stay visa.'],
  ['Police character certificate', 'https://police.punjab.gov.pk', 'Punjab online; Sindh sindhpolice.gov.pk, KP kppolice.gov.pk, Balochistan balochistanpolice.gov.pk, or your district police office.'],
  ['Foreign missions directory in Pakistan', 'https://mofa.gov.pk/foreign-missions-in-pakistan', 'The authoritative list of every embassy and high commission in Pakistan with current addresses and telephone numbers.']
];
const INSIDER = {
  GULF_LICENSE: [
    ['DataFlow PSV', '30-45 days typical; premium 10-12 days where offered. Delays almost always come from universities and past employers not replying - warn your referees TODAY that DataFlow will contact them.'],
    ['Prometric exam booking', 'Slots in Pakistan (Islamabad, Lahore, Karachi) fill 2-4 weeks ahead; book the moment eligibility opens.'],
    ['Regulator eligibility', 'SCFHS via Mumaris Plus: classification 2-6 weeks after DataFlow clears. DHA: eligibility letter usually valid about 1 year - track its expiry. QCHP/DHP: evaluation 3-8 weeks.'],
    ['Offer to visa', 'Gulf employer visa processing 2-6 weeks after license activation; medical (GAMCA) + police certificate + attestations must already be in hand or you lose those weeks.'],
    ['First salary reality', 'Expect the first pay 30-45 days after joining; carry funds for the first six weeks of living costs.']
  ],
  GB_LICENSE: [
    ['PLAB 2 to GMC registration', 'ID check appointment and registration decision typically 5-15 working days after a complete application; English evidence (IELTS 7.5 UKVI academic or OET B) must be under 2 years old.'],
    ['NMC route (nurses)', 'CBT from Pakistan anytime; OSCE only in the UK within 3 months of arrival on the OSCE visa route; NMC decision about 2-4 weeks per stage.'],
    ['Certificate of Sponsorship', 'NHS trusts issue CoS in 1-3 weeks after offer; Skilled Worker visa from Pakistan currently about 3 weeks standard, priority faster.'],
    ['First rotation truth', 'Most IMGs start in non-training SHO/Trust-grade posts; use the first 6-12 months for portfolio + exams toward training posts.']
  ],
  US_LICENSE: [
    ['ECFMG certification', 'EPIC verification of each credential 2-8 weeks; plan USMLE Step scheduling around Prometric Pakistan slot scarcity.'],
    ['NCLEX path (nurses)', 'CGFNS/state board evaluation 6-12 weeks, ATT then NCLEX; VisaScreen certificate needed for the visa stage.'],
    ['Match cycle reality', 'Residency interviews Oct-Jan, Match in March, start July - align your paperwork year to this calendar or lose a full year.']
  ],
  GENERIC_STUDY: [
    ['Offer to CAS/I-20/CoE', 'Universities issue the visa document 1-4 weeks after deposit; chase politely at 2 weeks.'],
    ['Attestation chain', 'HEC attestation 5-10 working days (urgent counters faster), MOFA 1-3 days after HEC; courier both ways adds a week - start the chain the day you accept.'],
    ['Visa decision windows', 'UK about 3 weeks, Schengen study 2-6 weeks, USA interview-dependent, Australia 4-8 weeks typical for Pakistani applicants; peak season (June-August) runs longer.'],
    ['Money timing', 'Bank funds should be seasoned 3-6 months BEFORE the visa application; a sudden large deposit is the most common refusal trigger.']
  ]
};
app.get('/api/applications/:id/cv.docx', auth, async (req, res) => {
  try {
    const { data: a } = await admin().from('applications').select('id,user_id').eq('id', req.params.id).single();
    if (!a || a.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
    const { data: d } = await admin().from('application_documents').select('themed_key').eq('application_id', req.params.id).eq('kind', 'cv').limit(1);
    const key = d && d[0] && d[0].themed_key;
    if (!key) return res.status(404).json({ error: 'No themed CV for this case yet.' });
    const { BUCKET } = require('./lib/docs');
    const { data: f, error } = await admin().storage.from(BUCKET).download(key);
    if (error || !f) return res.status(404).json({ error: 'Themed CV unavailable.' });
    const buf = Buffer.from(await f.arrayBuffer());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="ForiForeign_CV.docx"');
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* The guide must be CURRENT, not a snapshot of whatever was true when this file was
   written. For each destination we fetch a short factual brief with grounded search and
   cache it for seven days, so every applicant gets today's fees, timelines and contact
   details without us hardcoding numbers that quietly go stale. */
async function liveCountryBrief(cc, opp) {
  const key = 'guidebrief:' + String(cc || 'XX').toUpperCase() + ':' + ((opp && opp.kind) === 'work' ? 'work' : 'study');
  try {
    const { data: row } = await admin().from('app_settings').select('value').eq('key', key).single();
    if (row && row.value && row.value.at && (Date.now() - new Date(row.value.at).getTime()) < 7 * 86400000) return row.value.brief;
  } catch (e) {}
  const name = (MISSION[cc] && MISSION[cc].m) || '';
  const prompt = 'You are briefing a Pakistani applicant who has been accepted for a '
    + (((opp && opp.kind) === 'work') ? 'job' : 'study place') + ' in ' + (cc || 'the destination country')
    + '. Using current official government and embassy sources ONLY, return STRICT JSON with these keys and nothing else: '
    + '{"mission":"full current name and street address of that country\'s embassy, high commission or visa application centre in Pakistan",'
    + '"phone":"its current public telephone number, or an empty string if you cannot verify one",'
    + '"appointment":"exactly how an applicant in Pakistan books the appointment today, naming the portal or centre",'
    + '"fee":"the current visa fee with currency","processing":"current published processing time",'
    + '"funds":"the exact proof-of-funds amount currently required, with currency",'
    + '"links":[{"label":"what it is","url":"official https url"}],'
    + '"watch":["two to four things that change often and cost applicants time or money right now"]}. '
    + 'Known mission on record: ' + (name || 'unknown') + '. '
    + 'NEVER invent a phone number, fee or address. If you cannot verify a value from an official source, return an empty string for it. '
    + 'Every url must be an official government, embassy or university domain.';
  let brief = null;
  try {
    const { geminiCall } = require('./lib/gemini');
    const raw = await geminiCall(prompt, { maxTokens: 900, search: true, json: true });
    brief = typeof raw === 'string' ? JSON.parse(String(raw).replace(/```json|```/g, '').trim()) : raw;
  } catch (e) { brief = null; }
  if (brief) { try { await admin().from('app_settings').upsert({ key, value: { at: new Date().toISOString(), brief } }); } catch (e) {} }
  return brief;
}
app.get('/api/applications/:id/guide.pdf', auth, async (req, res) => {
  const { data: a } = await admin().from('applications').select('*, opportunities(*)').eq('id', req.params.id).single();
  if (!a || a.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  const opp = a.opportunities || {};
  const { data: pr } = await admin().from('profiles').select('full_name').eq('id', req.userId).single();
  /* FUTURE_PATH carries the richest detail for the destinations we know deeply; MISSION
     covers every country we serve. Fall back to MISSION so a guide for Lithuania is a
     real guide, not a generic one with the country name missing. */
  const _cc0 = String(opp.country_code || '').toUpperCase();
  const g = FUTURE_PATH[_cc0] || (MISSION[_cc0] ? {
    name: CC_FULL[_cc0] || _cc0,
    embassy: MISSION[_cc0].m,
    portal: MISSION[_cc0].u,
    funds: '',
    extra: ''
  } : null);
  const clean = t => String(t || '').replace(/[\u2013\u2014]/g, '-');
  const countryLabel = cc => CC_FULL[String(cc || '').toUpperCase()] || cc || '';
  const PDFDocument = require('pdfkit');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="Future Path Guide - ' + clean(opp.institution || 'Your Case').replace(/[^A-Za-z0-9 .-]/g, '').slice(0, 60) + '.pdf"');
  const pdf = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 58, right: 58 },
    info: { Title: 'Your Future Path', Author: 'ForiForeign', Creator: 'ForiForeign' } });
  pdf.pipe(res);
  const FT = usePdfFonts(pdf);
  const LM = pdf.page.margins.left, RM = pdf.page.width - pdf.page.margins.right;
  const H = t => {
    // Keep a heading with at least a few lines of its section, never orphaned at a break.
    if (pdf.y > pdf.page.height - pdf.page.margins.bottom - 90) pdf.addPage();
    pdf.moveDown(0.65).font(FT.B).fontSize(11.5).fillColor('#111')
      .text(pdfSafe(t).toUpperCase(), { characterSpacing: 0.9 });
    const y = pdf.y + 2;
    pdf.moveTo(LM, y).lineTo(RM, y).lineWidth(0.5).strokeColor('#9aa6b8').stroke();
    pdf.moveDown(0.5); pdf.fillColor('#000');
  };
  const P = t => pdf.font(FT.R).fontSize(10.8).fillColor('#000')
    .text(pdfSafe(t), { align: 'justify', lineGap: 2.2 });
  const B = t => pdf.font(FT.R).fontSize(10.8).fillColor('#000')
    .text('\u2022   ' + pdfSafe(t), { align: 'left', indent: 10, lineGap: 1.6 });
  // A labelled fact line, for addresses, phones and web pages.
  const KV = (k, v) => {
    if (!v) return;
    pdf.font(FT.B).fontSize(10.5).fillColor('#333').text(pdfSafe(k), { continued: true });
    pdf.font(FT.R).fillColor('#000').text('  ' + pdfSafe(v), { lineGap: 1.4 });
  };
  /* A guide the applicant cannot click is a guide they have to retype. Every official
     page in this document is a live link. */
  const LINK = (k, url, note) => {
    if (!url) return;
    pdf.font(FT.B).fontSize(10.5).fillColor('#333').text(pdfSafe(k), { continued: true });
    pdf.font(FT.R).fillColor('#0B57D0').text('  ' + pdfSafe(url), { link: String(url), underline: true, continued: !!note });
    if (note) pdf.fillColor('#000').text('   ' + pdfSafe(note), { lineGap: 1.4 });
    pdf.fillColor('#000');
  };
  pdf.font(FT.B).fontSize(17).text('Your Future Path', { align: 'center' });
  pdf.font(FT.R).fontSize(11.5).text(clean((opp.institution || '') + (g ? ' · ' + g.name : '')) + ((pr && pr.full_name) ? '  -  prepared for ' + pr.full_name : ''), { align: 'center' });
  pdf.moveDown(0.5);
  P('Congratulations on reaching this stage. The distance between you and ' + clean(g ? g.name : 'your destination') + ' is now a checklist, not a dream' + (opp.funding_type === 'fully' ? ' - and this position is fully funded, so the numbers are already on your side' : '') + (opp.stipend ? '. Your stated stipend: ' + clean(String(opp.stipend).slice(0, 40)) + '.' : '.'));
  P('This guide covers what happens after you are accepted, step by step, until you land and secure your position. ForiForeign does not provide visa or document-processing services, and you do not need any agent: every step below is designed for you to do yourself, easily and officially. Thousands of Pakistani students and professionals complete these exact steps every year. So will you.');
  /* THE GUIDE MUST BE ABOUT THIS POSITION, NOT THIS COUNTRY. Everything below used to be
     assembled from country templates: the same Germany guide for a Max Planck postdoc and
     a Munich nursing job. The applicant paid for a case, so the case leads - what this
     position pays, what it costs, what it demands, how long is left, and what is already
     prepared for it. Country mechanics follow afterwards. */
  H('This position at a glance');
  KV('Position:', opp.title || '');
  KV('Institution:', [opp.institution, opp.city, countryLabel(opp.country_code)].filter(Boolean).join(', '));
  KV('Level:', opp.level ? String(opp.level).replace(/_/g, ' ') : (opp.kind === 'work' ? 'Employment' : 'As stated on the official page'));
  KV('Funding:', opp.funding_type === 'fully' ? 'Fully funded' : opp.funding_type === 'partial' ? 'Partially funded' : (opp.funding || 'Stated on the official page'));
  KV('Deadline:', opp.deadline ? String(opp.deadline).slice(0, 10) : 'Rolling or not stated');
  KV('How to apply:', /portal/i.test(String(opp.apply_via || '')) ? 'Through the official online portal' : ((opp.contact_emails || [])[0] ? 'By email to ' + (opp.contact_emails || [])[0] : 'Confirm on the official page'));
  LINK('Official page:', opp.url || '');

  /* THE MONEY, IN ONE PLACE. Stipend, tuition, fee and living cost were scattered across
     three different screens and absent from the guide entirely, which is the single thing
     every applicant asks first. Only figures the official page actually stated appear. */
  H('The money');
  {
    const x = opp.extra || {};
    let anyMoney = false;
    const M = (k, v) => { if (v && String(v).trim()) { KV(k, String(v).slice(0, 180)); anyMoney = true; } };
    M('Stipend or salary:', opp.stipend || opp.salary_note);
    M('Tuition:', opp.tuition);
    M('Application fee:', opp.application_fee);
    M('Fee structure:', opp.fee_structure);
    M('Living cost, per year:', x.annual_living_cost);
    M('Housing support:', x.housing_support);
    M('Proof of funds needed:', opp.bank_statement_note);
    M('Other scholarships you may stack:', x.scholarship_stack);
    M('Work rights while studying:', x.work_rights);
    if (opp.funding_type === 'fully') P('This position is fully funded. Confirm on the official page exactly what the funding covers - tuition, stipend, insurance, travel - because "fully funded" is worded differently by every institution.');
    if (!anyMoney) P('The official advert did not print its financial terms. Ask for them in writing before you accept anything: the stipend or salary figure, whether tuition is charged, and what the institution covers. A position that will not state its terms in writing is a position to be careful with.');
  }

  /* WORKING BACKWARDS FROM THE REAL DEADLINE. A generic timeline is useless to someone
     with 19 days left, and dangerous to someone with eight months who thinks they can
     wait. The dates below are computed from this position's own deadline. */
  if (opp.deadline) {
    const dl = new Date(String(opp.deadline).slice(0, 10) + 'T00:00:00Z');
    const days = Math.round((dl - Date.now()) / 86400000);
    if (isFinite(days)) {
      H('Your countdown, ' + (days >= 0 ? days + ' days left' : 'deadline passed'));
      const back = n => new Date(dl.getTime() - n * 86400000).toISOString().slice(0, 10);
      if (days < 0) P('This deadline has passed. Do not spend money on attestation for it. Open a new search and pick a position that is still open.');
      else if (days <= 21) {
        P('This is a short runway, so the order matters more than usual. Attestation cannot be rushed, but an application can be submitted while attestation is still in progress at almost every institution.');
        B('Today: submit the application itself. Do not wait for attested documents unless the advert explicitly demands them at submission.');
        B('Today: email your referees. A reference letter is the most common reason a complete application misses a deadline.');
        B('This week: start HEC attestation online. It runs in the background.');
        B('By ' + back(2) + ': everything uploaded, and a confirmation email saved as PDF.');
      } else {
        B('By ' + back(Math.min(days - 2, 60)) + ': referees briefed and reference letters requested.');
        B('By ' + back(Math.min(days - 2, 45)) + ': HEC attestation started at eservices.hec.gov.pk.');
        B('By ' + back(Math.min(days - 2, 30)) + ': MOFA attestation, and language test booked if one is required.');
        B('By ' + back(Math.min(days - 2, 14)) + ': application fully drafted and reviewed once, away from the screen.');
        B('By ' + back(2) + ': submitted, with the confirmation saved as PDF. Never submit on the closing day itself - portals fail under load.');
      }
    }
  }

  /* WHAT IS ALREADY DONE FOR THIS CASE, AND WHAT IS STILL ON THE APPLICANT. The guide
     never mentioned the documents we prepared, so the applicant had no single page
     telling them where they stand. */
  try {
    const { data: adocs } = await admin().from('application_documents').select('title,kind').eq('application_id', a.id);
    const reqs = (a.prep_status || {}).reqs || {};
    if ((adocs || []).length || (reqs.required_now || []).length) {
      H('Your file for this application');
      if ((adocs || []).length) {
        pdf.font(FT.B).fontSize(10.5).fillColor('#333').text('Prepared for you, ready in your case:');
        pdf.fillColor('#000');
        (adocs || []).forEach(d => B(String(d.title || d.kind)));
      }
      if ((reqs.required_now || []).length) {
        pdf.moveDown(0.3);
        pdf.font(FT.B).fontSize(10.5).fillColor('#333').text('You must supply these yourself, originals only:');
        pdf.fillColor('#000');
        (reqs.required_now || []).slice(0, 16).forEach(r => B(String(r)));
      }
      if ((reqs.missing_urgent || []).length) {
        pdf.moveDown(0.3);
        pdf.font(FT.B).fontSize(10.5).fillColor('#B00020').text('Not yet uploaded, needed to submit: ' + (reqs.missing_urgent || []).join(', '));
        pdf.fillColor('#000');
      }
      P('We write the letters, statements and proposals. We never produce a document an institution issues - degrees, transcripts, experience certificates, licences and good-standing letters come from the issuing body and are yours to obtain.');
    }
  } catch (e) {}

  /* An interview section written for THIS position and this applicant. Cached on the
     application, so re-downloading the guide costs nothing. */
  try {
    const cacheKey = 'guideprep:' + a.id;
    let prep = null;
    try { const { data: c0 } = await admin().from('app_settings').select('value').eq('key', cacheKey).single(); prep = c0 && c0.value && c0.value.t; } catch (e) {}
    if (!prep) {
      const { callAI } = require('./lib/router');
      const { data: pf2 } = await admin().from('profiles').select('headline,field,methods,education,publications').eq('id', req.userId).single();
      prep = await callAI('case_writing',
        'Write two sections of a preparation guide for one specific applicant and one specific position. Plain prose and short lines, no markdown symbols, no headings other than the two labels given.\n' +
        'POSITION: ' + (opp.title || '') + ' at ' + (opp.institution || '') + ', ' + (countryLabel(opp.country_code) || '') + '. ' + String(opp.description || '').slice(0, 700) + '\n' +
        'APPLICANT: ' + ((pf2 && pf2.headline) || '') + '; field ' + ((pf2 && pf2.field) || '') + '; methods ' + String((pf2 && pf2.methods) || '').slice(0, 200) + '; publications ' + JSON.stringify((pf2 && pf2.publications) || []).slice(0, 400) + '\n\n' +
        'SECTION ONE, labelled exactly "LIKELY QUESTIONS": eight questions this specific selection panel is likely to ask this specific applicant, each followed by one sentence on what a strong answer contains. Technical where the position is technical.\n' +
        'SECTION TWO, labelled exactly "WHAT TO STRENGTHEN": four honest gaps between this applicant and this position, each with one concrete action. Never flatter, never invent a qualification.',
        { maxTokens: 1400, userId: req.userId });
      if (prep) { try { await admin().from('app_settings').upsert({ key: cacheKey, value: { t: prep } }); } catch (e) {} }
    }
    if (prep) {
      const parts = String(prep).split(/WHAT TO STRENGTHEN/i);
      H('Likely questions, and what a strong answer contains');
      P(String(parts[0] || '').replace(/LIKELY QUESTIONS/i, '').trim().slice(0, 4000));
      if (parts[1]) { H('What to strengthen before you apply'); P(String(parts[1]).trim().slice(0, 2500)); }
    }
  } catch (e) { /* the guide is complete without it */ }

  H('Your complete road, application to visa success');
  {
    const wk = (opp && opp.kind) === 'work';
    const steps = [
      ['Reply and confirm', 'Answer every university or employer email within 48 hours, politely and briefly. Confirm your interest and ask for the official offer or admission letter.'],
      ['Offer letter in hand', 'Save the signed offer or admission letter as PDF. Every next step, bank, embassy, ' + (wk ? 'Protector office' : 'scholarship body') + ', will ask for it.'],
      ['License and credential verification', (wk ? 'For regulated professions start DataFlow (Gulf), EPIC/ECFMG (physicians) or CGFNS (nurses, USA) NOW, it takes 30 to 45 days and every employer waits for it. Keep license, eligibility letters and good-standing certificates scanned and ready.' : 'If your route involves professional registration later, keep degree and license documents scanned; verification bodies like DataFlow and EPIC take weeks, never days.')],
      ['Degree attestation, HEC', 'Start at eservices.hec.gov.pk, then the nearest HEC Regional Centre (list in the Pakistan offices section below). Attest all degrees and transcripts. For school-level certificates use IBCC.'],
      ['MOFA attestation', 'After HEC, attest the same documents at MOFA, Islamabad HQ or the camp office in your city. Book online at mofa.gov.pk and carry originals plus CNIC.'],
      ['Bank statement', 'Prepare ' + (g && g.funds ? g.funds : 'the proof of funds your destination requires') + '. Keep the amount seasoned in the account 3 to 6 months where possible; a parent or sponsor account works with a sponsorship letter and their CNIC.'],
      ['Police character certificate', 'From your district police office or the provincial police portal. Takes days, not weeks; do it early.'],
      ['Medical and insurance', 'Some embassies require a medical from an approved panel doctor and health insurance covering the first months. Check the embassy page the same week you apply.'],
      ['Visa application', (g ? 'Apply at ' + g.portal + '. ' : 'Apply on the official national visa portal. ') + 'Fill every field exactly as in your passport, upload the attested set, pay the fee, book biometrics.'],
      ['Embassy or VAC visit', (g ? g.embassy + '. ' : 'Your destination embassy or its visa application centre in Pakistan. ') + 'Carry originals, copies, photos per spec, and the fee receipt.']
    ];
    if (wk) steps.push(['Protector of Emigrants', 'Employment abroad requires registration with the Bureau of Emigration, Protectorate office (Islamabad, Rawalpindi, Lahore, Karachi, Peshawar, Multan and others) before departure, with your work visa and contract. beoe.gov.pk has the list.']);
    steps.push(
      ['Interview, if called', 'Answer honestly and consistently with your documents. Know your programme, funding and return plans. Short, confident answers win.'],
      ['Ticket and arrival plan', 'Book only after the visa is stamped. Arrange airport pickup or first-week housing through the ' + (wk ? 'employer' : 'university international office') + ' before you fly.'],
      ['First week there', (wk ? 'Report to the employer, sign the contract copy, register with local authorities and open a bank account.' : 'Register at the university, activate your student ID, register with local authorities, open a bank account and confirm your funding payments.')]
    );
    let n = 0;
    for (const [t, dtl] of steps) {
      n++;
      if (pdf.y > 720) pdf.addPage();
      const y0 = pdf.y;
      pdf.font(FT.B).fontSize(11).fillColor('#000').text(n + '.  ' + t, 40, y0, { width: 150 });
      pdf.font(FT.R).fontSize(10.5).text(dtl, 200, y0, { width: 355, align: 'justify' });
      pdf.moveTo(40, pdf.y + 4).lineTo(555, pdf.y + 4).strokeColor('#BBBBBB').lineWidth(0.5).stroke();
      pdf.y = pdf.y + 9; pdf.x = 40;
    }
    pdf.moveDown(0.6);
  }
  /* WHERE TO GO AND WHO TO CONTACT. A guide that names the institution but not its
     address, phone or official pages leaves the applicant to hunt for all of it. */
  H('Where to go and who to contact');
  KV('Institution:', opp.institution || '');
  KV('Location:', [opp.city, countryLabel(opp.country_code)].filter(Boolean).join(', '));
  KV('Official page:', opp.url || '');
  KV('Application route:', /portal/i.test(String(opp.apply_via || '')) ? 'Online portal on the official page'
    : ((opp.contact_emails || [])[0] ? 'By email to ' + (opp.contact_emails || [])[0] : 'Confirm on the official page'));
  /* There is no contact_email or contact_phone column on opportunities - the addresses
     live in the contact_emails array - so this line silently printed nothing at all. */
  KV('Contact:', [opp.contact_name].concat(opp.contact_emails || []).filter(Boolean).join('  ·  '));
  KV('Deadline:', opp.deadline ? String(opp.deadline).slice(0, 10) : 'Rolling or not stated');
  pdf.moveDown(0.35);
  P('Always confirm these details on the official page before you travel, post documents or pay any fee. Institutions move offices and change contacts, and the official page is the only source that is always current.');
  try {
    const cc = String(opp.country_code || '').toUpperCase();
    const ms = MISSION[cc];
    if (ms) {
      pdf.moveDown(0.25);
      KV('Visa mission in Pakistan:', ms.m);
      LINK('Official portal:', ms.u);
      P('Attestation of your degrees by HEC and then the Ministry of Foreign Affairs is normally required before submission. Confirm the current fee, appointment route and document list on the portal above, which is the only authority.');
    }
    // Live, checked-this-week detail for this exact destination.
    const lb = await liveCountryBrief(cc, opp);
    if (lb) {
      H('Current details for ' + (countryLabel(cc) || cc) + ', checked this week');
      KV('Mission or visa centre:', lb.mission || '');
      KV('Telephone:', lb.phone || 'Confirm on the mission website, numbers change');
      KV('How to book:', lb.appointment || '');
      KV('Current fee:', lb.fee || '');
      KV('Processing time:', lb.processing || '');
      KV('Proof of funds:', lb.funds || '');
      (lb.links || []).slice(0, 8).forEach(l => { if (l && l.url) LINK((l.label || 'Official page') + ':', l.url); });
      if ((lb.watch || []).length) {
        pdf.moveDown(0.3);
        pdf.font(FT.B).fontSize(10.5).fillColor('#333').text('What is changing right now:');
        pdf.fillColor('#000');
        (lb.watch || []).slice(0, 4).forEach(w => B(String(w)));
      }
      P('These figures were verified from official sources when this guide was generated. Fees and timelines move; the portal link above always outranks this page.');
    }
  } catch (e) {}
  /* The licensing-pathway section that used to sit here has been removed. ForiForeign
     does not advise on obtaining a licence and must never imply that it does. If the
     applicant already holds one, it is noted below as a fact about them, nothing more. */
  try {
    const { data: pfx } = await admin().from('app_settings').select('value').eq('key', 'prefs:' + req.userId).single();
    const pv = (pfx && pfx.value) || {};
    const heldName = (pv.licenseResolved && pv.licenseResolved.name) || pv.licenseHeld || '';
    if (heldName) {
      pdf.moveDown(0.3);
      KV('Licence you already hold:', heldName + ((pv.licenseResolved && pv.licenseResolved.authority) ? '  (' + pv.licenseResolved.authority + ')' : ''));
      P('Keep the certificate, registration number and a current good-standing letter scanned and ready; employers ask for them at contract stage. Anything still to be obtained is applied for by you, directly with the regulator, on its own portal.');
    }
  } catch (e) {}
  H('Insider timeline: what actually happens next, and when');
  {
    const wk2 = (opp && opp.kind) === 'work';
    const cc2 = opp.country_code || '';
    let rows2 = wk2 ? (['SA','AE','QA','OM','BH','KW'].includes(cc2) ? INSIDER.GULF_LICENSE : cc2 === 'GB' ? INSIDER.GB_LICENSE : cc2 === 'US' ? INSIDER.US_LICENSE : INSIDER.GULF_LICENSE.slice(0,2).concat(INSIDER.GENERIC_STUDY.slice(2))) : INSIDER.GENERIC_STUDY;
    P('These are the inside timeframes most applicants only learn after losing months. Current at preparation time; always confirm on the official page, which is the only authority.');
    for (const [t2, d2] of rows2) { B(t2 + ' - ' + d2); }
    P('Golden rule: run verifications, attestations and bookings IN PARALLEL, never one after another. The applicants who land in 90 days are the ones whose DataFlow, police certificate and attestations were all moving in the same week.');
  }
  H('1. After acceptance');
  B('You may be invited to an online interview. Prepare with your CV and the documents ForiForeign drafted; answer plainly.');
  B('Degree attestation: first HEC (eservices.hec.gov.pk, online account, courier both ways), then MOFA (mofa.gov.pk attestation, online appointment or Qousia counters). Attest degree + transcripts.');
  B('Institutions often ask for attested hard copies by courier later; keep two attested sets ready.');
  H('2. Visa, done by yourself' + (g ? ' - ' + g.name : ''));
  if (g) {
    B('Where: ' + g.embassy + '.');
    B('How: ' + g.portal + '.');
    if (g.extra) B('Important: ' + g.extra);
  } else {
    B('Apply directly through the official embassy or government portal of the destination country; the offer letter states the visa category.');
  }
  B('Book the appointment yourself, pay the official fee only, and submit your own file. No agent adds anything a careful applicant cannot do.');
  H('3. Financial evidence');
  P(g && g.funds ? g.funds + '. Keep the funds seasoned in your own or an immediate family member\'s account, with a clean 6-month statement and a maintenance letter from the bank.' : 'Follow the exact amount stated in your offer or the embassy checklist; keep a clean 6-month bank statement and a bank maintenance letter.');
  H('4. Pakistan offices you will actually need, with official links');
  for (const [nm, url, note] of PK_OFFICES) { LINK(nm + ':', url); P(note); pdf.moveDown(0.15); }
  P('Exact addresses, timings and fees change; always confirm on the official page in the same week you visit. Every link above is the government\'s own site, never an agent or a middleman.');
  H('5. Before you fly');
  B('Verify your offer, CAS/admission letter, visa, passport validity (18+ months), and attested originals in hand luggage.');
  B('Arrange accommodation for the first weeks through the institution where possible.');
  B('Inform the institution of your arrival date; register on arrival as instructed (city registration / police / university enrolment).');
  H('6. Your first weeks, securing the position');
  B('Open a local bank account in week one (your admission letter and passport are enough almost everywhere).');
  B('Complete enrolment/joining formalities and collect your student or employee ID; this activates insurance and access.');
  B('Learn the part-time work rules of your visa before accepting any work; keep every payslip and document.');
  B('Stay in touch with your department or HR in the first month - early visibility becomes references, assistantships and renewals.');
  pdf.moveDown(0.5);
  pdf.font(FT.B).fontSize(12).text('You have done the hardest part already. Follow the list, keep your documents tidy, and go claim it.', { align: 'center' });
  pdf.moveDown(0.8);
  pdf.font(FT.R).fontSize(10.5).fillColor('#333').text('Every fact above follows official channels current at preparation time; always confirm on the linked official pages, which are the only authority. ForiForeign · foriforeign.com', { align: 'center' });
  pdf.end();
});
/* ---------- Professional PDF of a case document (editable content -> elegant PDF) ---------- */
app.get('/api/applications/:id/documents/:docId/pdf', auth, async (req, res) => {
  const { data: a } = await admin().from('applications').select('id,user_id').eq('id', req.params.id).single();
  if (!a || a.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  const { data: doc } = await admin().from('application_documents').select('*').eq('id', req.params.docId).eq('application_id', a.id).single();
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  const { data: pr } = await admin().from('profiles').select('full_name,email,phone,city').eq('id', req.userId).single();
  const person = (pr && pr.full_name) || '';
  const isCV = /cv|resume|curriculum/i.test(String(doc.kind || '') + ' ' + String(doc.title || ''));
  const contactLine = [ (pr && pr.email) || '', (pr && pr.phone) || '', (pr && pr.city) ? pr.city + ', Pakistan' : '' ]
    .filter(Boolean).join('  ·  ');
  const clean = str => String(str || '').replace(/[\u2013\u2014]/g, '-');
  const fname = (clean(doc.title || 'Document') + (person ? ' - ' + person : '')).replace(/[^A-Za-z0-9 .-]/g, '').replace(/\s+/g, ' ').trim() + '.pdf';
  const PDFDocument = require('pdfkit');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
  const pdf = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 60, right: 60 },
    info: { Title: String(doc.title || 'Document'), Author: person || 'ForiForeign', Creator: 'ForiForeign' } });
  pdf.pipe(res);
  const FT = usePdfFonts(pdf);
  // Header block. A CV must lead with the applicant's NAME and carry a contact line:
  // recruiters and ATS parsers look for both in the first block.
  if (isCV && person) {
    pdf.font(FT.B).fontSize(19).fillColor('#000000').text(pdfSafe(person), { align: 'center' });
    if (contactLine) pdf.moveDown(0.25).font(FT.R).fontSize(10.5).fillColor('#222').text(pdfSafe(contactLine), { align: 'center' });
    // A thin rule separates the header from the body, the convention in professional CVs.
    pdf.moveDown(0.5);
    const y = pdf.y, L = pdf.page.margins.left, R = pdf.page.width - pdf.page.margins.right;
    pdf.moveTo(L, y).lineTo(R, y).lineWidth(0.8).strokeColor('#000').stroke();
    pdf.moveDown(0.7);
  } else {
    pdf.font(FT.B).fontSize(17).fillColor('#000000').text(pdfSafe(doc.title || ''), { align: 'center' });
    if (person) pdf.moveDown(0.2).font(FT.R).fontSize(11.5).text(pdfSafe(person), { align: 'center' });
    pdf.moveDown(0.8);
  }
  pdf.fillColor('#000');
  // Page numbers on multi-page documents (a CV that runs to two pages must be
  // identifiable if the pages are separated).
  let _pageCount = 1;
  pdf.on('pageAdded', () => {
    _pageCount++;
    try {
      const b = pdf.page.height - pdf.page.margins.bottom + 22;
      pdf.font(FT.R).fontSize(9).fillColor('#666')
        .text(pdfSafe(person || '') + '  ·  page ' + _pageCount, pdf.page.margins.left, b,
          { width: pdf.page.width - pdf.page.margins.left - pdf.page.margins.right, align: 'right' });
      pdf.fillColor('#000');
    } catch (e) {}
  });
  const lines = pdfSafe(doc.content || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { pdf.moveDown(0.45); continue; }
    const hd = line.match(/^\*\*(.+)\*\*:?\s*$/);
    const isCaps = /^[A-Z][A-Z &,'\-\/()]{3,}$/.test(line);
    if (hd || isCaps || (line.length < 42 && /^[A-Z][A-Za-z &/-]+$/.test(line) && !/[.]$/.test(line))) {
      // Section heading: small-caps weight, letter-spaced, with a hairline rule beneath.
      // This is the difference between a plain text dump and a designed document.
      const htxt = (hd ? hd[1] : line).replace(/\*\*/g, '');
      if (pdf.y > pdf.page.height - pdf.page.margins.bottom - 70) pdf.addPage();
      pdf.moveDown(0.55).font(FT.B).fontSize(11.5).fillColor('#111')
        .text(htxt.toUpperCase(), { align: 'left', characterSpacing: 0.9 });
      const hy = pdf.y + 2, HL = pdf.page.margins.left, HR = pdf.page.width - pdf.page.margins.right;
      pdf.moveTo(HL, hy).lineTo(HR, hy).lineWidth(0.5).strokeColor('#9aa6b8').stroke();
      pdf.moveDown(0.45); pdf.fillColor('#000');
      continue;
    }
    const body = line.replace(/\*\*/g, '');
    if (/^[-•]\s+/.test(body)) {
      // Hanging indent so wrapped bullet text aligns under the text, not the bullet.
      pdf.font(FT.R).fontSize(11).fillColor('#000')
        .text('•   ' + body.replace(/^[-•]\s+/, ''), { align: 'left', indent: 10, lineGap: 1.2 });
    } else {
      pdf.font(FT.R).fontSize(11).fillColor('#000').text(body, { align: 'left', lineGap: 1.6 });
    }
  }
  pdf.end();
});
/* ---------- pipeline endpoints ---------- */
const { discoverForUser, prepareApplication } = require('./lib/engine');
/* Admin-configured search cooldown: protects AI spend and stops rapid repeat searches.
   Staff are exempt so support can always reproduce a user's search. */
/* FAIR USE. Protects real API spend without punishing genuine users.
   - Searching stays free and unlimited for normal usage.
   - A soft limit warns kindly; a hard limit pauses discovery, never the whole account.
   - Paying customers get a multiplied allowance, so spending money always buys headroom.
   - Staff are exempt. Prepared cases and downloads are NEVER blocked: a client who has
     paid must always be able to reach their own work. */
const _spendCache = new Map();
/* SEARCH COUNTER. Counted per calendar day and per calendar month from a reset point,
   so buying a package genuinely restarts the allowance. */
async function searchCounts(userId) {
  const c = _spendCache.get(userId);
  if (c && Date.now() - c.at < 60000) return c.val;
  const today = new Date().toISOString().slice(0, 10);
  const month = new Date().toISOString().slice(0, 7);
  let resetAt = null;
  try {
    const { data } = await admin().from('app_settings').select('value').eq('key', 'searchreset:' + userId).single();
    resetAt = data && data.value && data.value.at;
  } catch (e) {}
  let day = 0, mon = 0;
  try {
    /* The reset point ALWAYS wins when it is later than the month boundary, and the
       month boundary is only a floor to keep the query small. A purchase must clear
       everything used before it, whichever day that was. */
    const monthStart = month + '-01T00:00:00.000Z';
    const since = (resetAt && resetAt > monthStart) ? resetAt : monthStart;
    const { data } = await admin().from('audit_log').select('created_at')
      .eq('actor', userId).eq('event', 'SEARCH_RUN').gte('created_at', since);
    for (const r of (data || [])) {
      mon++;
      // Rows before the reset point never reach here, so a purchase genuinely zeroes today.
      if (String(r.created_at || '').slice(0, 10) === today) day++;
    }
  } catch (e) {}
  const val = { day, mon };
  _spendCache.set(userId, { val, at: Date.now() });
  if (_spendCache.size > 5000) _spendCache.clear();
  return val;
}
/* The gate itself. Free and paying users share one honest allowance; buying a package
   resets it, which is what makes a purchase feel like a fresh start. */
async function fairUse(req, res, next) {
  try {
    const cfg = await siteSettings.getConfig();
    const fu = cfg.fair_use || {};
    if (fu.enabled === false) return next();
    if (req.userRole && ['admin', 'super_admin', 'staff'].includes(req.userRole)) return next();
    /* THREE A DAY, FIVE ONCE THEY HAVE BOUGHT. Nothing raises it further and nothing is
       sold that raises it. Buying a package also wipes whatever has already been used,
       today or on any earlier day, so the five start clean. */
    const everPaid = await hasEverPaid(req.userId).catch(() => false);
    const dayMax = everPaid ? (Number(fu.paid_daily_searches) || 5) : (Number(fu.daily_searches) || 3);
    const { day } = await searchCounts(req.userId);
    if (day >= dayMax) {
      try { await admin().from('audit_log').insert({ actor: req.userId, event: 'SEARCH_LIMIT_DAY', detail: day + '/' + dayMax }); } catch (e) {}
      // Tell them exactly when it refills, in their own timezone, not a vague "tomorrow".
      const tzOff = Number(req.headers['x-tz-offset']);              // minutes, from the client
      const off = isFinite(tzOff) ? tzOff : -300;                     // default Pakistan, UTC+5
      const nowLocal = new Date(Date.now() - off * 60000);
      const nextLocal = new Date(nowLocal); nextLocal.setUTCHours(24, 0, 0, 0);
      const resetsAt = new Date(nextLocal.getTime() + off * 60000);
      const mins = Math.max(1, Math.round((resetsAt - Date.now()) / 60000));
      const hrs = Math.floor(mins / 60), rem = mins % 60;
      const inWords = hrs > 0 ? (hrs + ' hour' + (hrs === 1 ? '' : 's') + (rem ? ' ' + rem + ' minutes' : '')) : (mins + ' minutes');
      return res.status(429).json({
        error: 'You have used all ' + dayMax + ' searches for today.',
        fair_use: true, scope: 'day', used: day, limit: dayMax, paid: everPaid,
        resets_at: resetsAt.toISOString(), resets_in_minutes: mins, resets_in_words: inWords
      });
    }
    // The client needs all three numbers to warn honestly before the last search is spent.
    req._searchLeft = { day: dayMax - day, limit: dayMax, used: day + 1, paid: everPaid };
    // Count this search only once it has passed the gate.
    try { await admin().from('audit_log').insert({ actor: req.userId, event: 'SEARCH_RUN', detail: 'search' }); } catch (e) {}
    _spendCache.delete(req.userId);
  } catch (e) {}
  next();
}
/** Zero the counters. Called whenever a package is activated, which is what makes a
    purchase a genuinely fresh start: everything used before this moment stops counting. */
async function resetSearchAllowance(userId) {
  try {
    await admin().from('app_settings').upsert({ key: 'searchreset:' + userId, value: { at: new Date().toISOString() } });
    _spendCache.delete(userId);
    return true;
  } catch (e) { return false; }
}
/* There is no cooldown between searches. The daily count is the only limit: three a day,
   five once a package has been bought. An artificial gap between searches punished a
   mistaken tap and protected nothing the daily count does not already protect. */
app.post('/api/run', auth, fairUse, (req,res,next)=>{const f=(require('./lib/settings').cache()||{}).features||{};if(f.discovery_enabled===false)return res.status(503).json({error:'Search is briefly paused for maintenance. Please try again soon.'});next();}, async (req, res) => {
  // Search preferences + package fulfillment: paid credits define how many verified
  // opportunities the agent must deliver (min 5, max 20). Priority countries are
  // searched first; comparable nearby destinations complete the set only if needed.
  const b = req.body || {};
  const arr = (v, ok) => Array.isArray(v) ? v.map(x => String(x)).filter(x => ok.includes(x)).slice(0, 8) : [];
  const prefs = {
    countries: Array.isArray(b.countries) ? b.countries.filter(c => /^[A-Za-z]{2}$/.test(String(c))).map(c => String(c).toUpperCase()).slice(0, 15) : [],
    fundings: arr(b.fundings, ['fully', 'partial', 'self']),
    levels: arr(b.levels, ['bachelors', 'masters', 'phd', 'postdoc', 'diploma', 'short_course', 'fellowship', 'observership']),
    langs: arr(b.langs, ['none', 'cert_before', 'course_after', 'local_lang']),
    jobTypes: arr(b.job_types, ['full_time', 'part_time', 'contract', 'internship']),
    exps: arr(b.exps, ['entry', 'mid', 'senior']),
    // The only licence question we ask is what the applicant ALREADY holds, in their words.
    licenseHeld: String(b.license_held || '').slice(0, 120),
    programTypes: arr(b.program_types, ['degree', 'diploma', 'short_course', 'training', 'fellowship', 'exchange', 'observership']),
    sectors: arr(b.sectors, ['hospital', 'university', 'industry', 'government', 'ngo', 'remote_company']),
    field: /^[a-z][a-z-]{1,40}$/.test(String(b.field || '')) ? String(b.field) : null,
    intake: ['2026', '2027'].includes(String(b.intake || '')) ? String(b.intake) : null,
    noLang: !!b.no_lang, remote: !!b.remote,
    /* Lane-specific preferences. These are not columns, they steer the discovery agent,
       and each is accepted only for the lane it belongs to so a study answer can never
       reach a job search. */
    lane: b.lane === 'work' ? 'work' : 'study',
    instruction: b.lane === 'work' ? '' : String(b.instruction || '').slice(0, 20),
    uniType: b.lane === 'work' ? '' : String(b.uni_type || '').slice(0, 20),
    appFee: b.lane === 'work' ? '' : String(b.app_fee || '').slice(0, 20),
    deadlineIn: b.lane === 'work' ? '' : String(b.deadline_in || '').slice(0, 10),
    visaPref: b.lane === 'work' ? String(b.visa_pref || '').slice(0, 20) : '',
    contractLen: b.lane === 'work' ? String(b.contract_len || '').slice(0, 20) : '',
    startWhen: b.lane === 'work' ? String(b.start_when || '').slice(0, 20) : '',
    salaryBand: b.lane === 'work' ? String(b.salary_band || '').slice(0, 20) : '',
    // Work mode rides through to the agent so an on-site request is honoured too.
    workmode: ['', 'remote', 'onsite'].includes(String(b.workmode || '')) ? String(b.workmode || '') : (b.remote ? 'remote' : ''),
    target: 5
  };
  prefs.fundedOnly = !!b.funded_only || prefs.fundings.includes('fully');
  prefs.level = prefs.levels[0] || null; // back-compat
  prefs.prefsHash = JSON.stringify({ k: b.kind || null, c: prefs.countries, f: prefs.fundings, l: prefs.levels, j: prefs.jobTypes, e: prefs.exps, x: prefs.licenseHeld, fd: prefs.field, i: prefs.intake, n: prefs.noLang, r: prefs.remote });
  // Admin and staff run without limits: no cooldown, full delivery target.
  let isAdminRun = false;
  try { const { data: pr0 } = await admin().from('profiles').select('role').eq('id', req.userId).single(); isAdminRun = !!(pr0 && ['admin', 'staff'].includes(pr0.role)) && !simUser(req); } catch (e) {}
  /* NO WAITING BETWEEN SEARCHES. The daily count is the only limit: three a day, five
     once a package has been bought. A user who has a search left may spend it whenever
     they like, back to back if they want. The 30-minute gate that used to sit here made
     a mistaken tap feel like a punishment. */
  await admin().from('app_settings').upsert({ key: 'lastRun:' + req.userId, value: { at: new Date().toISOString() } });
  try {
    const bal = await balance(req.userId);
    /* Depth of the hunt. The old formula tied the target to the credit balance, so a
       two-case buyer triggered a search for five positions and then wondered why the
       screen looked thin. Fifteen is now the floor for everyone and staff run wide. */
    prefs.target = isAdminRun ? 60 : Math.min(60, Math.max(15, (bal || 0) * 3));
  } catch (e) {}
  // Server-side, resumable progress: the run continues even if the phone dies.
  const progressKey = 'discover:' + req.userId;
  prefs.progressKey = progressKey;
  prefs.startedAt = new Date().toISOString();
  try { await admin().from('app_settings').upsert({ key: progressKey, value: { status: 'running', startedAt: prefs.startedAt, kind: b.kind || null, target: prefs.target, found: 0, prefsHash: prefs.prefsHash } }); } catch (e) {}
  /* READ-FIRST. How much is already verified and still open for this lane? The client
     shows those immediately instead of holding the user in front of a progress ring while
     inventory it could already display sits in the table. */
  let instant = 0;
  try {
    let iq = admin().from('opportunities').select('id', { count: 'exact', head: true })
      .eq('status', 'verified').or('deadline.gte.' + new Date().toISOString().slice(0, 10) + ',deadline.is.null');
    if (b.kind) iq = (b.kind === 'work') ? iq.eq('kind', 'work') : iq.in('kind', ['study', 'scholarship', 'postdoc']);
    if (prefs.countries.length) iq = iq.in('country_code', prefs.countries);
    const { count } = await iq; instant = count || 0;
  } catch (e) {}
  res.json({ ok: true, ran: true, instant, message: 'Searching official sources now. Verified opportunities appear within 2 to 3 minutes.',
    searches_left: (req._searchLeft || {}).day, search_limit: (req._searchLeft || {}).limit,
    searches_used: (req._searchLeft || {}).used, paid: !!(req._searchLeft || {}).paid });
  require('./lib/jobs').runJob('discover', 'discover:' + req.userId + ':' + Math.floor(Date.now()/1800e3), req.userId, () =>
    discoverForUser(req.userId, b.kind, prefs)
      .then(async n => { try { await admin().from('app_settings').upsert({ key: progressKey, value: { status: 'done', startedAt: prefs.startedAt, kind: b.kind || null, target: prefs.target, found: n, prefsHash: prefs.prefsHash } }); } catch (e) {}
        // Pull-back notification: if a WhatsApp bridge is configured, ping the user.
        try { if (process.env.ZAINAB_NOTIFY_URL && n > 0) { const { data: pf } = await admin().from('profiles').select('whatsapp,full_name').eq('id', req.userId).single(); if (pf && pf.whatsapp) fetch(process.env.ZAINAB_NOTIFY_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: pf.whatsapp, text: (((await siteSettings.getConfig()).notify || {}).results_ready || 'ForiForeign: your matches are ready! {n} verified opportunities are waiting. foriforeign.com').replace('{n}', String(n)).replace('{name}', String(pf.full_name || '')) }) }).catch(() => {}); } } catch (e) {}
        return n; })
      .catch(async e => { try { await admin().from('app_settings').upsert({ key: progressKey, value: { status: 'error', startedAt: prefs.startedAt, kind: b.kind || null, target: prefs.target, message: String(e.message).slice(0, 160), prefsHash: prefs.prefsHash } }); } catch (e2) {} throw e; }),
    { retries: 1, timeoutMs: 600000 });
  // Real-time Brave assist: right after every user search, harvest fresh leads and
  // verify one batch immediately - new finds surface on the dashboard within minutes.
  setTimeout(() => { try { const h = require('./lib/harvest'); h.braveLeads().then(() => setTimeout(() => h.verifyLeads(), 20000)).catch(() => {}); } catch (e) {} }, 5000);
});
/* Observability: the admin sees problems before users complain. */
app.get('/api/admin/metrics', auth, perm('countries.write'), async (req, res) => {
  const day = new Date(Date.now() - 24 * 3600e3).toISOString();
  const q = async p => { try { return (await p).count || 0; } catch (e) { return 0; } };
  const errors24 = await q(admin().from('error_log').select('id', { count: 'exact', head: true }).gte('at', day));
  const aiErr24 = await q(admin().from('error_log').select('id', { count: 'exact', head: true }).gte('at', day).ilike('area', '%gemini%'));
  const jobsFailed = await q(admin().from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed'));
  const opps24 = await q(admin().from('opportunities').select('id', { count: 'exact', head: true }).gte('created_at', day));
  let cost24 = 0; try { const { data } = await admin().from('ai_cost_ledger').select('cost_usd').gte('created_at', day); cost24 = (data || []).reduce((s, r) => s + Number(r.cost_usd || 0), 0); } catch (e) {}
  const lat = _lat.slice().sort((a, b) => a - b);
  const p95 = lat.length ? lat[Math.floor(lat.length * .95)] : 0;
  const { data: recent } = await admin().from('error_log').select('at,area,message').order('at', { ascending: false }).limit(8);
  res.json({ errors24, aiErr24, jobsFailed, opps24, cost24: +cost24.toFixed(4), p95ms: p95, requests: _ops.req, recent: recent || [] });
});
/* Admin corridor seeding - weakness #1: fill real inventory before launch. */
app.post('/api/admin/seed', auth, perm('countries.write'), aiLimit, async (req, res) => {
  const { kind, query } = req.body || {};
  if (!query || String(query).length < 8) return res.status(400).json({ error: 'Give a corridor query, e.g. "fully funded masters Germany"' });
  res.json({ ok: true, message: 'Seeding started. Verified results appear within 2-3 minutes.' });
  const { seedDiscovery } = require('./lib/engine');
  seedDiscovery(String(kind || ''), String(query).slice(0, 200), req.userId).then(n => console.log('[seed]', n, 'added')).catch(e => console.error('[seed]', e.message));
});
/* Real job status - weakness #3: the UI polls this until preparation truly finishes. */
app.get('/api/applications/:id/status', auth, async (req, res) => {
  const { data: a } = await admin().from('applications').select('id,user_id,stage,next_action,updated_at,prep_progress,prep_started_at').eq('id', req.params.id).single();
  if (!a || a.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  const steps = a.prep_progress || [];
  let failed = steps.some(st => st.error);
  let eta = 'Usually takes a few minutes.';
  // Stall guard: preparing for over 9 minutes with no error recorded means the run hung or
  // timed out. Surface Retry - finished documents are kept, so a retry costs almost nothing.
  if (!failed && a.stage === 'preparing' && a.prep_started_at && Date.now() - new Date(a.prep_started_at).getTime() > 9 * 60000) {
    failed = true;
    eta = 'This took longer than usual. Press Retry - completed documents are kept, nothing is generated twice.';
  }
  if (a.prep_started_at) {
    const el = (Date.now() - new Date(a.prep_started_at).getTime()) / 1000;
    if (el < 150) eta = 'Estimated time remaining: about 1–2 minutes';
  }
  res.json({ stage: a.stage, next_action: a.next_action, steps, failed, eta, ready: ['awaiting_authorization','prepared','portal_apply'].includes(a.stage) });
});
app.post('/api/applications/:id/prepare', auth, (req,res,next)=>{const f=(require('./lib/settings').cache()||{}).features||{};if(f.prepare_enabled===false)return res.status(503).json({error:'Case preparation is briefly paused for maintenance. Please try again soon.'});next();}, aiLimit, async (req, res) => {
  const { data: a } = await admin().from('applications').select('id,user_id,stage').eq('id', req.params.id).single();
  if (!a || a.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  // Idempotent: a fully prepared case is NEVER re-run - zero extra AI cost, instant answer.
  if (['awaiting_authorization', 'prepared', 'portal_apply'].includes(a.stage))
    return res.json({ ok: true, already: true, message: 'This case is already fully prepared.' });
  res.json({ ok: true, message: 'Preparing your documents and email now.' });
  const markFail = async e => {
    try {
      const { data: cur } = await admin().from('applications').select('prep_progress').eq('id', a.id).single();
      const steps = (cur && cur.prep_progress || []).map(st => st.active ? { ...st, active: false, error: 'This step hit a problem. Retry usually fixes it.' } : st);
      await admin().from('applications').update({ prep_progress: steps, next_action: 'One step needs attention. Press Retry.' }).eq('id', a.id);
    } catch (e2) {}
  };
  require('./lib/jobs').runJob('prepare', 'prepare:' + a.id + ':' + Math.floor(Date.now() / 300e3), req.userId,
    () => prepareApplication(a.id).catch(async e => { await markFail(e); throw e; }), { retries: 0, timeoutMs: 480000 });
});
app.get('/api/applications/:id', auth, async (req, res) => {
  const { data: a } = await admin().from('applications').select('*, opportunities(*)').eq('id', req.params.id).single();
  if (!a || a.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  let { data: docs } = await admin().from('application_documents').select('id,kind,title,content,status,themed_key').eq('application_id', a.id).then(r => r, async () => await admin().from('application_documents').select('id,kind,title,content').eq('application_id', a.id));
  const { data: msgs } = await admin().from('messages').select('*').eq('application_id', a.id).order('created_at', { ascending: false });
  /* The applicant's own uploaded files travel with the application, so the case screen
     must show them. Without this the case listed only what we wrote, and an applicant
     reasonably concluded their real CV had been ignored in favour of a summary of it. */
  let own = [];
  try {
    const { data: mine } = await admin().from('documents').select('id,name,kind,mime,created_at')
      .eq('user_id', req.userId).eq('generated', false).order('created_at', { ascending: false }).limit(12);
    own = (mine || []).map(d => ({ id: d.id, name: d.name, kind: d.kind, mime: d.mime, created_at: d.created_at,
      is_cv: /cv|resume|curriculum/i.test(String(d.name || '') + ' ' + String(d.kind || '')) }));
  } catch (e) {}
  res.json({ application: a, documents: docs || [], messages: msgs || [], own_documents: own });
});
/* ---------- Spec 27: case editor - edit/rename/approve documents, case notes ---------- */
app.post('/api/applications/:id/documents/:docId', auth, async (req, res) => {
  const { data: a } = await admin().from('applications').select('id,user_id').eq('id', req.params.id).single();
  if (!a || a.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  const patch = {};
  if (typeof (req.body || {}).content === 'string') patch.content = req.body.content.slice(0, 40000);
  if (typeof (req.body || {}).title === 'string' && req.body.title.trim()) patch.title = req.body.title.trim().slice(0, 160);
  if (['draft', 'under_review', 'approved'].includes((req.body || {}).status)) patch.status = req.body.status;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  const { error } = await admin().from('application_documents').update(patch).eq('id', req.params.docId).eq('application_id', a.id);
  if (error) return res.status(400).json({ error: /status.*column/.test(error.message || '') ? 'Run migration 0016 first' : error.message });
  res.json({ ok: true });
});
/* WHO ATTACHES THE FILES IS THE APPLICANT'S CHOICE. We attach everything by default and
   they press Send. Some people would rather attach their own originals - a particular
   scan, a specific version of a certificate - and being forced to accept our selection is
   not respectful of that. The email draft and the package builder both honour it. */
app.post('/api/applications/:id/attach-mode', auth, async (req, res) => {
  const mode = ((req.body || {}).mode === 'self') ? 'self' : 'us';
  const { data: a } = await admin().from('applications').select('id,user_id,prep_status').eq('id', req.params.id).single();
  if (!a || a.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  const ps = a.prep_status || {};
  ps.attach_mode = mode;
  const { error } = await admin().from('applications').update({ prep_status: ps }).eq('id', a.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true, mode });
});
app.post('/api/applications/:id/notes', auth, async (req, res) => {
  const { data: a } = await admin().from('applications').select('id,user_id').eq('id', req.params.id).single();
  if (!a || a.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  const { error } = await admin().from('applications').update({ notes: String((req.body || {}).notes || '').slice(0, 8000) }).eq('id', a.id);
  if (error) return res.status(400).json({ error: /notes.*column/.test(error.message || '') ? 'Run migration 0016 first' : error.message });
  res.json({ ok: true });
});
app.post('/api/messages/:id/authorize', auth, async (req, res) => {
  const { data: m } = await admin().from('messages').select('*').eq('id', req.params.id).single();
  if (!m || m.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  if (m.status !== 'pending') return res.status(400).json({ error: 'Already ' + m.status });
  await admin().from('messages').update({ status: 'approved' }).eq('id', m.id);
  await admin().from('applications').update({ stage: 'prepared', authorized_at: new Date().toISOString(), authorized_by: req.userId, next_action: 'Authorized. Press APPLY to open it in your own email, review, and send.' }).eq('id', m.application_id);
  await admin().from('audit_log').insert({ actor: req.userId, event: 'AUTHORIZED', detail: m.id });
  res.json({ ok: true, note: 'Authorized. Press APPLY to open it in your own email - you review and press Send.' });
});

const PORT = process.env.PORT || 3000;
app.use((err, req, res, next) => {
  // Client-side faults (malformed JSON, oversized body) are 4xx, not 5xx: the caller gets a
  // clear, actionable message and we do not log them as server failures.
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError && 'body' in err)) {
    return res.status(400).json({ error: 'That request could not be read. Please try again.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That upload is too large. Please send a smaller file.' });
  }
  errlog('http', err, { requestId: req.reqId, userId: req.userId });
  if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on our side. Our team has been notified - please try again.', ref: req.reqId });
});
process.on('unhandledRejection', e => console.error('[rejection]', e && e.message));
try { const { expireAgent } = require('./lib/agents'); setInterval(() => expireAgent().catch(e=>console.error('[expire]',e.message)), 12*3600e3); setTimeout(()=>expireAgent().catch(()=>{}), 60e3); } catch (e) {}
/* Self-seeding inventory: on boot and daily at 03:00, if verified stock is thin,
   the agent seeds high-demand corridors itself. The platform can never sit empty
   waiting for an admin. */
const SEED_CORRIDORS = [
  ['masters', 'fully funded masters scholarships Germany Sweden Finland Norway for international students'],
  ['masters', 'fully funded masters scholarships Italy France Netherlands Denmark for international students'],
  ['phd', 'fully funded PhD positions Germany Netherlands Scandinavia sciences engineering health'],
  ['phd', 'funded PhD positions UK Ireland Australia New Zealand with stipend'],
  ['postdoc', 'postdoc positions Europe USA Canada life sciences chemistry pharmacology open now'],
  ['scholarship', 'fully funded government scholarships China Turkey Hungary Korea Japan for Pakistani students'],
  ['scholarship', 'fully funded scholarships USA Canada Australia for international students 2026 2027'],
  ['bachelors', 'fully funded bachelors scholarships for international students Europe Turkey Hungary'],
  ['work', 'pharmacist nurse doctor jobs Saudi Arabia UAE Qatar with visa sponsorship'],
  ['work', 'healthcare allied health jobs Gulf hospitals SCFHS DHA licensed'],
  ['work', 'engineer IT jobs Europe Germany Netherlands visa sponsorship for international candidates'],
  ['work', 'nurse jobs UK Ireland Australia New Zealand international recruitment'],
  ['work', 'DHA SCFHS QCHP licensed pharmacist doctor nurse vacancies Gulf hospitals current openings'],
  ['work', 'NHS Trust vacancies IMG doctors NMC nurses Trac jobs HealthJobsUK current'],
  ['work', 'UPDA SCE licensed engineer vacancies Qatar Saudi Arabia mega projects'],
  ['work', 'medical laboratory radiographer physiotherapist jobs Gulf UK DataFlow HCPC licensed']
];
async function selfSeed(reason) {
  try {
    const { count } = await admin().from('opportunities').select('id', { count: 'exact', head: true }).eq('status', 'verified');
    if ((count || 0) >= 40) return;
    const { seedDiscovery } = require('./lib/engine');
    for (let i = 0; i < SEED_CORRIDORS.length; i++) {
      const [k, q] = SEED_CORRIDORS[i];
      require('./lib/jobs').runJob('discover', 'selfseed:' + i + ':' + k + ':' + new Date().toISOString().slice(0, 10), null,
        () => seedDiscovery(k, q, null), { retries: 1, timeoutMs: 600000 });
      await new Promise(r => setTimeout(r, 15000)); // stagger, be gentle on the API
    }
    console.log('[selfSeed] launched (' + reason + '), stock was ' + (count || 0));
  } catch (e) { console.error('[selfSeed]', e.message); }
}
try { require('node-cron').schedule('0 3 * * *', () => selfSeed('daily')); } catch (e) {}
setTimeout(() => selfSeed('boot'), 20000);
/* Harvest pipeline: RSS + Brave leads flow into a queue; AI verifies queued URLs in
   small batches; priority institutions are swept on rotation. Feeds and Brave are
   free; only verification and sweeps spend AI - in controlled, capped batches. */
try {
  const harvest = require('./lib/harvest');
  require('node-cron').schedule('15 */2 * * *', () => { harvest.rssWatch(); harvest.braveLeads(); });   // gather leads every 2h, zero/near-zero cost
  require('node-cron').schedule('45 */2 * * *', () => harvest.verifyLeads());                            // verify up to 6 leads per 2h
  require('node-cron').schedule('0 4 * * *', () => harvest.uniSweep());                                  // 6 priority institutions daily, rotating
  setTimeout(() => { harvest.rssWatch(); harvest.braveLeads(); }, 60000);
  setTimeout(() => harvest.verifyLeads(), 180000);
} catch (e) { console.error('[harvest] scheduling failed', e.message); }
/* Final error net: any handler that throws returns clean JSON instead of killing the request. */
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err))) {
    return res.status(400).json({ error: 'That request could not be read. Please try again.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That upload is too large. Please send a smaller file.' });
  }
  try { require('./lib/oblog').errlog('express:' + (req.path || ''), err, {}); } catch (e) {}
  if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on our side. It has been logged and the self-healer is on it.' });
});
/* Self-healing supervisor: every 10 minutes, detect and repair known failure
   patterns automatically - stalled jobs, stuck preparations, zero-result runs. */
try {
  const { runHealer } = require('./lib/healer');
  require('node-cron').schedule('*/10 * * * *', runHealer);
  setTimeout(runHealer, 90000);
} catch (e) { console.error('[healer] scheduling failed', e.message); }
// Boot sweeper: a restart mid-job leaves rows stuck 'running' forever. Sweep them
// to 'failed' so retries work and the failed-jobs metric stays truthful.
(async () => { try { await admin().from('jobs').update({ status: 'failed', last_error: 'server restarted mid-job', updated_at: new Date().toISOString() }).eq('status', 'running'); } catch (e) {} })();
app.listen(PORT, () => {
  console.log('ForiForeign core on :' + PORT);
  try { require('./lib/agents').startAgents(); } catch (e) { console.error('[agents]', e.message); }
});
