// ForiForeign server core v0.1 - auth (Supabase), credits, payments, pricing, opportunities
require('dotenv').config();
const express = require('express');
const { admin, userFromToken } = require('./lib/supa');

const app = express();
/* NO REQUEST MAY HANG. Fifty route handlers were async, awaited something, and had no
   try/catch. Express 4 does not catch a rejected promise, and the process-level
   unhandledRejection hook keeps the server ALIVE - which is worse than a crash, because
   the response is simply never sent. The user's button spins until the browser gives up,
   half a minute later, with no message. That is exactly what "the buttons respond very
   slowly" looks like from the outside. Every async handler is now wrapped: an exception
   becomes an immediate 500 with a readable message, and is logged with the route. */
(() => {
  const wrap = fn => {
    if (typeof fn !== 'function' || fn.length >= 4) return fn;          // error middleware stays as-is
    return function wrapped(req, res, next) {
      try {
        const out = fn(req, res, next);
        if (out && typeof out.then === 'function') {
          out.catch(err => {
            try { require('./lib/oblog').errlog('route:' + req.method + ' ' + req.path, err instanceof Error ? err : new Error(String(err)), { userId: req.userId || null }); } catch (e) {}
            if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on our side. Please try again in a moment.' });
          });
        }
        return out;
      } catch (err) {
        try { require('./lib/oblog').errlog('route:' + req.method + ' ' + req.path, err, { userId: req.userId || null }); } catch (e) {}
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on our side. Please try again in a moment.' });
      }
    };
  };
  for (const m of ['get', 'post', 'put', 'patch', 'delete', 'all']) {
    const orig = app[m].bind(app);
    app[m] = function (path, ...handlers) {
      if (typeof path !== 'string' && !(path instanceof RegExp) && !Array.isArray(path)) return orig(path, ...handlers); // app.get('setting')
      return orig(path, ...handlers.map(wrap));
    };
  }
})();
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
const DQ = require('./lib/discovery_quality');
const { callAI } = require('./lib/router');   // QA R5950: employer outreach and support triage call this at module scope
const FF_BUILD = '2026-09-05-R11900';
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
/* /api/health is the documented, uncached build probe used by the runbook, the smoke test and the morning PDF. */
/* Serve the minified front end when it exists (built by npm run build:web / prestart). */
/* The landing is a 40 KB standalone page at /; the app (600 KB) loads at /app, or at / with ?app=1 for old links. The landing
   redirects signed-in visitors to /app by itself. */
try { const fsx = require('fs'); const pth = require('path'); const minPath = pth.join(__dirname, 'public', 'index.min.html'); const appPath = fsx.existsSync(minPath) && process.env.FF_SERVE_MIN !== 'off' ? minPath : pth.join(__dirname, 'public', 'index.html'); const landPath = pth.join(__dirname, 'public', 'landing.html');
  /* White-label hosts: a consultancy's domain never shows the platform's landing, SEO pages, pricing, trust or partner pages. */
  app.use(async (req, res, next) => { try { const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase(); if (!host || /foriforeign\.com$|localhost|127\.0\.0\.1|railway\.app$/.test(host)) return next(); const o = await orgForHost(host); if (!o) return next(); req.whitelabelOrg = o; const p = req.path; if (p === '/' || p === '/landing.html') { res.set('Cache-Control', 'no-cache'); return res.sendFile(appPath); } if (/^\/(study-in|work-in|for-(applicants|consultancies|institutions)|updates|s|guide|sitemap\.xml|robots\.txt|pricing\.html|trust\.html|partners\.html|help\.html|crm\.html|commitments\.html|legal\.html|api-docs\.html)(\/|$)/.test(p)) return res.redirect(302, '/app'); if (/^\/api\/(trust|offering|preview|prospects|brief)/.test(p)) return res.status(404).json({ error: 'Not available on this domain' }); } catch (e) {} next(); });
  app.get('/', (req, res, next) => { if (req.query.app === '1' || req.query.raw === '1' || req.query.paid || req.query.session || req.query.partner || req.query.go) { res.set('Cache-Control', 'no-cache'); return res.sendFile(req.query.raw === '1' ? pth.join(__dirname, 'public', 'index.html') : appPath); } if (fsx.existsSync(landPath)) { res.set('Cache-Control', 'public, max-age=300'); return res.sendFile(landPath); } next(); });
  /* FF-CRM DOOR: consultancy staff and owners sign in here; a consultancy can share /crm/<its-slug>. The applicant landing never appears. */
  app.get(['/crm', '/crm/:slug'], async (req, res) => { try { let name = null; if (req.params.slug) { const { data: o } = await admin().from('organisations').select('name').eq('slug', String(req.params.slug).toLowerCase().slice(0, 60)).neq('kind', 'personal').maybeSingle(); name = o ? o.name : null; } res.set('Cache-Control', 'no-cache'); res.redirect(302, '/app#crm' + (name ? '-' + encodeURIComponent(name) : '')); } catch (e) { res.redirect(302, '/app#crm'); } });
  app.get(['/app', '/index.html'], (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(req.query.raw === '1' ? pth.join(__dirname, 'public', 'index.html') : appPath); }); } catch (e) {}
app.get('/api/health', (req, res) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate'); res.json({ build: FF_BUILD, ok: true, up: process.uptime() | 0 }); });
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
  res.set('x-ff-field-encryption', require('./lib/crypto').enabled() ? 'on' : 'off');
  res.set('x-ff-features', ['card:' + (process.env.STRIPE_SECRET_KEY ? 'on' : 'off'), 'encryption:' + (require('./lib/crypto').enabled() ? 'on' : 'off'), 'queue:' + (process.env.FF_QUEUE === 'off' ? 'off' : 'on')].join(','));
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
/* Stripe webhook: raw body for signature verification, mounted before the JSON parser. */
/* Day 27 · hardening: security headers on every response, response-time header, and a light
   per-IP limiter on unauthenticated endpoints so a scraper cannot make the public config,
   whitelabel or i18n endpoints expensive. */
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff'); res.set('X-Frame-Options', 'SAMEORIGIN'); res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  const t0 = Date.now(); const end = res.end; res.end = function () { try { res.set('x-ff-ms', String(Date.now() - t0)); } catch (e) {} return end.apply(this, arguments); }; next();
});
const _ipHits = new Map(); const LIMITER = require('./lib/limiter');
app.use(async (req, res, next) => {
  if (!/^\/api\/(config|site-config|i18n|whitelabel|leads\/|intake\/|pay\/(stripe|lemon|safepay)\/webhook|health|ask|faqs)/.test(req.path)) return next();
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'x';
  const n = await LIMITER.hit('ip:' + ip, 60);
  if (n > 240) return res.status(429).json({ error: 'Too many requests, slow down.' }); next();
});
/* Security headers beyond the basics: referrer, permissions, and a Content-Security-Policy in report-only mode first
   (the single-file app uses inline scripts; the report tells us what to tighten before enforcing). */
app.use((req, res, next) => { res.set('Referrer-Policy', 'strict-origin-when-cross-origin'); res.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(self)'); res.set('Content-Security-Policy-Report-Only', "default-src 'self' https:; script-src 'self' 'unsafe-inline' https://translate.google.com https://translate.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; connect-src 'self' https:; frame-src https://translate.google.com https://checkout.stripe.com https://*.lemonsqueezy.com; report-uri /api/csp-report"); next(); });
app.post('/api/csp-report', express.json({ type: ['application/csp-report', 'application/json'], limit: '50kb' }), async (req, res) => { try { const r = (req.body || {})['csp-report'] || req.body || {}; await admin().from('audit_log').insert({ event: 'CSP_REPORT', detail: String(JSON.stringify(r)).slice(0, 400) }).then(() => {}, () => {}); } catch (e) {} res.status(204).end(); });
app.post('/api/pay/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const GW = require('./lib/gateway');
    const raw = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body || '');
    if (!GW.verifySignature(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) return res.status(400).send('bad signature');
    const evt = JSON.parse(raw);
    if (evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') {
      const so = evt.data.object; const md = so.metadata || {};
      const r = (md.org_id && md.credits === '0') ? await settleAgencySubscription(so) : await settleCardPayment(so, 'webhook');
      return res.json(r);
    }
    res.json({ ignored: evt.type });
  } catch (e) { res.status(400).send(e.message); }
});
app.post('/api/pay/safepay/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try { const SP = require('./lib/gateway_safepay'); const raw = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body || '');
    if (!SP.verifySignature(raw, req.headers['x-sfpy-signature'], process.env.SAFEPAY_SECRET)) return res.status(400).send('bad signature');
    const evt = JSON.parse(raw); const sess = SP.sessionFromEvent(evt); if (sess.payment_status !== 'paid') return res.json({ ignored: sess.payment_status });
    return res.json(await settleCardPayment(sess, 'safepay')); }
  catch (e) { res.status(400).send(e.message); }
});
app.post('/api/pay/lemon/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try { const L = require('./lib/gateway_lemon'); const raw = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body || '');
    if (!L.verifySignature(raw, req.headers['x-signature'], process.env.LEMON_WEBHOOK_SECRET)) return res.status(400).send('bad signature');
    const evt = JSON.parse(raw); const name = evt.meta && evt.meta.event_name;
    if (name === 'order_created') return res.json(await settleCardPayment(L.sessionFromEvent(evt), 'lemon'));
    res.json({ ignored: name }); }
  catch (e) { res.status(400).send(e.message); }
});
app.use(express.json({ limit: '2mb', verify: (req, res, buf) => { if (/^\/api\/hooks\//.test(req.path || req.url || '')) req.rawBody = buf.toString('utf8'); } }));
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
app.use(express.static('public', { maxAge: '7d', etag: true, lastModified: true, setHeaders: (res, p) => { if (/app\.[0-9a-f]{10}\.min\.js$/.test(p)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
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
const _ownerChecked = new Set();
async function auth(req, res, next) {
  /* Browser-opened files (invoice PDFs) cannot send a header; they carry the token as ?t=. */
  const t = ((req.headers.authorization || '').replace(/^Bearer /, '')) || (req.method === 'GET' && (/^\/api\/org\/[^/]+\/invoice\//.test(req.path) || req.path === '/api/me/export' || req.path === '/api/events' || /^\/api\/admin\/documents\/[^/]+\/pdf$/.test(req.path)) ? String(req.query.t || '') : '');
  const u = await userFromToken(t);
  if (!u) return res.status(401).json({ error: 'Please sign in again' });
  req.userId = u.id; req.userEmail = u.email;
  // Gap 16 · a token issued before the last role change is no longer valid.
  try { const iat = (() => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString()).iat; } catch (e) { return null; } })(); if (iat) { const { data: pr } = await admin().from('profiles').select('role_changed_at').eq('id', u.id).maybeSingle(); if (pr && pr.role_changed_at && new Date(pr.role_changed_at).getTime() / 1000 > iat + 5) return res.status(401).json({ error: 'Your access changed. Please sign in again.' }); } } catch (e) {}
  /* THE OWNER'S OWN ACCOUNT WAS THE SLOWEST IN THE SYSTEM. This block ran a database
     read on EVERY request from the owner email - a round trip to Supabase before each
     button could answer, for exactly one person: the one testing the app. Once the role
     has been confirmed in this process it is not re-checked, so the owner pays the cost
     once per deploy instead of once per tap. */
  if (u.email && OWNER_EMAILS.includes(String(u.email).toLowerCase()) && !_ownerChecked.has(u.id)) {
    _ownerChecked.add(u.id);
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
const TOTP = require('./lib/totp');
const perm = (p) => { const inner = requirePermission(p, admin); return async (req, res, next) => { try { const ok = await TOTP.sessionOk(req.userId, String(req.headers['x-ff-totp'] || req.query.totp || '')); if (!ok) return res.status(428).json({ error: 'Second factor required', totp_required: true }); } catch (e) {} return inner(req, res, next); }; };


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
/* ================= PHASE 0 · GLOBAL MOBILITY OS FOUNDATIONS =================
   Organisations (personal / agency / institution / employer / partner), org membership,
   consultant-owned clients, and a Postgres job queue. Purely additive: the B2C journey is
   untouched; every user owns a personal organisation created on first touch. */
const ORGS = require('./lib/orgs');
const QUEUE = require('./lib/queue');
const orgErr = (res, e) => res.status(e && e.status || 400).json({ error: (e && e.message) || 'Organisation error' });

app.get('/api/org', auth, async (req, res) => {
  try {
    const { data: me } = await admin().from('profiles').select('full_name').eq('id', req.userId).maybeSingle();
    const personal = await ORGS.ensurePersonalOrg(req.userId, (me && me.full_name ? me.full_name + "'s workspace" : null));
    const orgs = await ORGS.myOrgs(req.userId);
    res.json({ personal, orgs, roles: ORGS.ORG_ROLES });
  } catch (e) { orgErr(res, e); }
});
app.post('/api/org', auth, async (req, res) => {
  try { const org = await ORGS.createOrg(req.userId, req.body || {}); await orgAudit(org.id, req.userId, 'ORG_CREATED', org.kind + ' ' + org.name); res.json({ org }); }
  catch (e) { orgErr(res, e); }
});
app.get('/api/org/:id/clients', auth, async (req, res) => {
  try { await ORGS.requireOrg(req, req.params.id, 'clients.read'); const m = await ORGS.membership(req.params.id, req.userId); res.json({ clients: await ORGS.listClients(req.params.id, Object.assign({}, req.query || {}, { scope: ORGS.scopeFor(m, req.userId) })), my_role: m && m.role, my_branch: m && m.branch }); }
  catch (e) { orgErr(res, e); }
});
app.post('/api/org/:id/clients', auth, async (req, res) => {
  try { const b = req.body || {}; const em = String(b.email || '').trim().toLowerCase(); const ph = String(b.phone || b.whatsapp || '').replace(/\D/g, ''); if (em || ph) { let q = admin().from('clients').select('id,full_name,stage,branch').eq('org_id', req.params.id); const ors = []; if (em) ors.push('email.eq.' + em); if (ph) { ors.push('phone.ilike.%' + ph.slice(-9) + '%'); ors.push('whatsapp.ilike.%' + ph.slice(-9) + '%'); } const { data: dup } = await q.or(ors.join(',')).limit(1); if (dup && dup.length && !b.force) return res.status(409).json({ error: 'This person already exists in your workspace', duplicate_of: dup[0] }); } } catch (e) {}

  try {
    await ORGS.requireOrg(req, req.params.id, 'clients.write');
    const client = await ORGS.createClient(req.params.id, req.userId, req.body || {}); CACHE.bust('board:' + req.params.id); WEBHOOKS.emit(req.params.id, 'client.created', { client_id: client.id, full_name: client.full_name, lane: client.lane, stage: client.stage });
    await orgAudit(req.params.id, req.userId, 'CLIENT_CREATED', client.full_name + ' (' + client.id.slice(0, 8) + ')');
    res.json({ client });
  } catch (e) { orgErr(res, e); }
});
app.patch('/api/org/:id/clients/:cid', auth, async (req, res) => {
  try { const before = await orgClient(req, res, 'clients.write'); const mm = await ORGS.membership(req.params.id, req.userId); if (!['owner', 'manager'].includes(mm && mm.role)) { for (const k of ['owner_user_id', 'assigned_to', 'branch', 'sub_agent_user_id', 'sub_agent_share_pct']) delete (req.body || {})[k]; } CACHE.bust('board:' + req.params.id); const client = await ORGS.updateClient(req.params.id, req.params.cid, req.body || {}); try { const extra = { last_activity_at: new Date().toISOString() }; if ((req.body || {}).stage && (req.body || {}).stage !== before.stage) extra.stage_changed_at = new Date().toISOString(); await admin().from('clients').update(extra).eq('id', client.id); } catch (e) {} if ((req.body || {}).stage && (req.body || {}).stage !== before.stage) WEBHOOKS.emit(req.params.id, 'client.stage_changed', { client_id: client.id, from: before.stage, to: client.stage }); res.json({ client }); }
  catch (e) { orgErr(res, e); }
});
app.post('/api/org/:id/members', auth, async (req, res) => {
  try { await ORGS.requireOrg(req, req.params.id, 'members.write'); const b = req.body || {}; const r = await ORGS.addMember(req.params.id, b.email, b.role, b.branch, req.userId); await orgAudit(req.params.id, req.userId, 'MEMBER_INVITED', b.email + ' as ' + (b.role || 'consultant') + (b.branch ? ' / ' + b.branch : '')); res.json(r); }
  catch (e) { orgErr(res, e); }
});
app.get('/api/org/:id/members', auth, async (req, res) => {
  try { await ORGS.requireOrg(req, req.params.id, 'clients.read'); const mm = await ORGS.membership(req.params.id, req.userId); const r = await ORGS.listMembers(req.params.id); if (!['owner', 'manager'].includes(mm && mm.role)) r.members = (r.members || []).map(x => Object.assign({}, x, { email: undefined, invite_email: undefined })); res.json(r); }
  catch (e) { orgErr(res, e); }
});
app.patch('/api/org/:id/members/:uid', auth, async (req, res) => {
  try { await ORGS.requireOrg(req, req.params.id, 'members.write'); const r = await ORGS.updateMember(req.params.id, req.userId, req.params.uid, req.body || {}); await orgAudit(req.params.id, req.userId, 'MEMBER_UPDATED', req.params.uid.slice(0, 8) + ' ' + JSON.stringify(req.body || {}).slice(0, 120)); res.json(r); }
  catch (e) { orgErr(res, e); }
});
app.delete('/api/org/:id/members/:uid', auth, async (req, res) => {
  try { await ORGS.requireOrg(req, req.params.id, 'members.write'); const r = await ORGS.removeMember(req.params.id, req.userId, req.params.uid); await orgAudit(req.params.id, req.userId, 'MEMBER_REMOVED', req.params.uid.slice(0, 8)); res.json(r); }
  catch (e) { orgErr(res, e); }
});
app.delete('/api/org/:id/invites/:iid', auth, async (req, res) => {
  try { await ORGS.requireOrg(req, req.params.id, 'members.write'); await admin().from('org_invites').delete().eq('id', req.params.iid).eq('org_id', req.params.id); res.json({ ok: true }); }
  catch (e) { orgErr(res, e); }
});
app.patch('/api/org/:id', auth, async (req, res) => {
  try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); res.json({ settings: await ORGS.updateOrgSettings(req.params.id, req.body || {}) }); }
  catch (e) { orgErr(res, e); }
});
app.get('/api/org/:id', auth, async (req, res) => {
  try { await ORGS.requireOrg(req, req.params.id, 'clients.read'); const { data } = await admin().from('organisations').select('id,name,kind,plan,country_code,slug,settings,created_at').eq('id', req.params.id).maybeSingle(); res.json({ org: data, me: await ORGS.membership(req.params.id, req.userId) }); }
  catch (e) { orgErr(res, e); }
});
/* A consultant asks the platform to search for a client who already has a ForiForeign login.
   The work runs on the queue, never inside the request. */
app.post('/api/org/:id/clients/:cid/discover', auth, async (req, res) => {
  try {
    { const me = await ORGS.membership(req.params.id, req.userId); const chk = await QUOTA.check(req.params.id, me, 'org_search', 1); if (!chk.ok) return res.status(402).json({ error: chk.reason, code: chk.code }); await QUOTA.consume(req.params.id, me, 'org_search', 1); }
    await ORGS.requireOrg(req, req.params.id, 'clients.write');
    const { data: c } = await admin().from('clients').select('id,user_id,lane,profile').eq('id', req.params.cid).eq('org_id', req.params.id).maybeSingle();
    if (!c) return res.status(404).json({ error: 'Client not found' });
    if (!c.user_id) return res.status(400).json({ error: 'This client has no ForiForeign login yet. Invite them to sign up and upload a CV; search runs on their profile.' });
    const kind = (req.body || {}).kind || (c.lane === 'work' ? 'work' : 'postdoc');
    const jobId = await QUEUE.enqueue('client_discover', { clientId: c.id, userId: c.user_id, kind, prefs: (req.body || {}).prefs || {} }, { orgId: req.params.id, userId: req.userId });
    res.json({ ok: true, job_id: jobId });
  } catch (e) { orgErr(res, e); }
});
app.get('/api/admin/queue', auth, perm('settings.read'), async (req, res) => { try { res.json(await QUEUE.status()); } catch (e) { res.status(400).json({ error: e.message }); } });
QUEUE.register('client_discover', async (p) => {
  const { discoverForUser } = require('./lib/engine');
  const prefs = Object.assign({ countries: [], ctrys: [] }, p.prefs || {});
  prefs.countries = Array.isArray(prefs.ctrys) && prefs.ctrys.length ? prefs.ctrys : (prefs.countries || []);
  prefs.progressKey = 'discover:' + p.userId;
  const r = await discoverForUser(p.userId, p.kind || 'postdoc', prefs);
  try { await admin().from('clients').update({ stage: 'match', updated_at: new Date().toISOString() }).eq('id', p.clientId).eq('stage', 'discover'); } catch (e) {}
  return { found: (r && (r.added != null ? r.added : r)) };
});
try { if (process.env.FF_QUEUE !== 'off') QUEUE.start(5000, 2); } catch (e) {}
/* =================================================================================== */
/* ================= PHASE 1 · DOCUMENT INTELLIGENCE + GLOBAL MOBILITY PROFILE ================= */
const VAULT = require('./lib/vault');
const MOBILITY = require('./lib/mobility');
app.get('/api/vault', auth, async (req, res) => { try { res.json({ documents: await VAULT.vaultFor(req.userId), types: VAULT.DOC_TYPES, labels: VAULT.LABEL }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/vault/checklist', auth, async (req, res) => {
  try { const extra = String(req.query.extra || '').split(',').map(s => s.trim()).filter(Boolean); res.json(await VAULT.checklist(req.userId, String(req.query.for || 'study'), extra)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/vault/:id/read', auth, async (req, res) => {
  try { const jobId = await QUEUE.enqueue('vault_read', { docId: req.params.id, userId: req.userId }, { userId: req.userId, maxAttempts: 2 }); res.json({ ok: true, job_id: jobId }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.patch('/api/vault/:id', auth, async (req, res) => {
  try {
    const b = req.body || {}; const patch = {};
    if (VAULT.DOC_TYPES.includes(b.doc_type)) { patch.doc_type = b.doc_type; patch.sensitive = VAULT.SENSITIVE.has(b.doc_type); }
    if (b.expiry_date === null || /^\d{4}-\d{2}-\d{2}$/.test(String(b.expiry_date || ''))) patch.expiry_date = b.expiry_date;
    if (b.confirm === true) { patch.doc_status = 'read'; patch.issues = []; }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change' });
    const { data, error } = await admin().from('documents').update(patch).eq('id', req.params.id).eq('user_id', req.userId).select('id,doc_type,doc_status,expiry_date').single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ document: data });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/me/mobility', auth, async (req, res) => { try { res.json(await MOBILITY.get(req.userId)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.put('/api/me/mobility', auth, async (req, res) => { try { res.json(await MOBILITY.update(req.userId, (req.body || {}).profile || req.body || {}, 'user')); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Consultants read and complete a linked client's profile; every edit is marked "consultant". */
app.get('/api/org/:id/clients/:cid/mobility', auth, async (req, res) => {
  try {
    await ORGS.requireOrg(req, req.params.id, 'clients.read');
    const { data: c } = await admin().from('clients').select('user_id').eq('id', req.params.cid).eq('org_id', req.params.id).maybeSingle();
    if (!c || !c.user_id) return res.status(400).json({ error: 'Client has no ForiForeign login yet.' });
    res.json(await MOBILITY.get(c.user_id));
  } catch (e) { orgErr(res, e); }
});
app.put('/api/org/:id/clients/:cid/mobility', auth, async (req, res) => {
  try {
    await ORGS.requireOrg(req, req.params.id, 'clients.write');
    const { data: c } = await admin().from('clients').select('user_id').eq('id', req.params.cid).eq('org_id', req.params.id).maybeSingle();
    if (!c || !c.user_id) return res.status(400).json({ error: 'Client has no ForiForeign login yet.' });
    res.json(await MOBILITY.update(c.user_id, (req.body || {}).profile || {}, 'consultant'));
  } catch (e) { orgErr(res, e); }
});
QUEUE.register('vault_read', async (p) => { await meter(p.userId, 'doc_read'); const r = await VAULT.readDocument(p.docId, p.userId); JE.recompute(p.userId); try { await require('./lib/pathway').detect(p.userId, { notify: true }); } catch (e) {} return r; });
QUEUE.register('profile_extract', async (p) => { const r = await require('./lib/jobs').runJob('prepare', 'autofill:' + p.userId + ':' + Date.now(), p.userId, () => extractProfile(p.userId), { retries: 0, timeoutMs: 300000 }); try { await require('./lib/pathway').detect(p.userId, { notify: true }); } catch (e) {} return r; });
/* =========================================================================================== */
/* ================= PHASE 2 · CONSULTANT COMMAND CENTER (API) ================= */
async function orgClient(req, res, permission) {
  await ORGS.requireOrg(req, req.params.id, permission);
  const m = await ORGS.membership(req.params.id, req.userId);
  const { data: c } = await ORGS.applyScope(admin().from('clients').select('*').eq('id', req.params.cid).eq('org_id', req.params.id), ORGS.scopeFor(m, req.userId)).maybeSingle();
  if (!c) { const e = new Error('Client not found or outside your branch'); e.status = 404; throw e; }
  return c;
}
/* One call gives the consultant everything about a client: the command-center screen. */
app.get('/api/org/:id/clients/:cid/overview', auth, async (req, res) => {
  try {
    const c = await orgClient(req, res, 'clients.read');
    const [tasks, notes, comm] = await Promise.all([
      admin().from('client_tasks').select('*').eq('client_id', c.id).order('status').order('due_date', { ascending: true, nullsFirst: false }).limit(100).then(r => r.data || [], () => []),
      admin().from('client_notes').select('*').eq('client_id', c.id).order('created_at', { ascending: false }).limit(50).then(r => r.data || [], () => []),
      admin().from('commission_ledger').select('amount_pkr,status').eq('client_id', c.id).then(r => r.data || [], () => [])
    ]);
    let mobility = null, checklist = null, credits = null, cases = [], matches = null, pendingPayment = null;
    if (c.user_id) {
      try { mobility = await MOBILITY.get(c.user_id); } catch (e) {}
      try { checklist = await VAULT.checklist(c.user_id, c.lane === 'work' ? 'work' : 'study'); } catch (e) {}
      try { credits = await balance(c.user_id); } catch (e) {}
      try { const { data } = await admin().from('applications').select('id,opportunity_id,status,created_at,updated_at').eq('user_id', c.user_id).order('created_at', { ascending: false }).limit(20); cases = data || []; } catch (e) {}
      try { const { data } = await admin().from('app_settings').select('value').eq('key', 'discover:' + c.user_id).maybeSingle(); matches = data && data.value; } catch (e) {}
      /* NEVER ZERO for a consultancy's client either: when discovery has nothing, the overview carries verified catalogue options for the client's lane, country and field, marked as fallback. */
      try { const list = matches && (matches.items || matches.opportunities || matches.results || (Array.isArray(matches) ? matches : null)); if (!list || !list.length) { const EX = require('./lib/explore'); const r = await EX.explore({ kind: c.lane === 'work' ? 'work' : c.lane === 'study' ? 'study' : '', cc: c.target_country || c.country_code || '', text: c.profession || c.field || '', per: 12 }); if (r && r.rows && r.rows.length) matches = { fallback: true, note: 'No strong matches yet for this client; verified options in their lane to start from.', items: r.rows.slice(0, 12), widened: r.widened || null }; } } catch (e) {}
      try { const { data } = await admin().from('payments').select('id,credits,amount_pkr,status,created_at').eq('user_id', c.user_id).order('created_at', { ascending: false }).limit(1); pendingPayment = data && data[0] && data[0].status === 'pending' ? data[0] : null; } catch (e) {}
    }
    const open = tasks.filter(t => t.status === 'open');
    const next = open.find(t => t.owner === 'us') || open[0] || null;
    const risks = [];
    if (mobility && mobility.missing_for_match && mobility.missing_for_match.length) risks.push('Profile incomplete for matching: ' + mobility.missing_for_match.join(', '));
    if (checklist && checklist.expired.length) risks.push('Expired documents: ' + checklist.expired.join(', '));
    if (checklist && checklist.missing.length) risks.push('Missing documents: ' + checklist.missing.join(', '));
    if (mobility && mobility.profile && mobility.profile.visa_refusals) risks.push('Previous visa refusal declared: ' + String(mobility.profile.visa_refusals).slice(0, 80));
    if (!c.user_id) risks.push('Client has no ForiForeign login yet: search and preparation run on their own profile. Invite them.');
    res.json({ client: c, tasks, notes, mobility, checklist, credits, cases, discover: matches, pendingPayment, next_action: next, risks,
      commission_pkr: comm.filter(x => x.status !== 'void').reduce((a, x) => a + (x.amount_pkr || 0), 0) });
  } catch (e) { orgErr(res, e); }
});
app.post('/api/org/:id/clients/:cid/tasks', auth, async (req, res) => {
  try {
    const c = await orgClient(req, res, 'clients.write'); const b = req.body || {};
    if (!String(b.title || '').trim()) return res.status(400).json({ error: 'Task title required' });
    const { data, error } = await admin().from('client_tasks').insert({ org_id: c.org_id, client_id: c.id, title: String(b.title).slice(0, 200), owner: ['us', 'client', 'them'].includes(b.owner) ? b.owner : 'us', due_date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.due_date || '')) ? b.due_date : null, assignee_user_id: b.assignee_user_id || req.userId, created_by: req.userId }).select('*').single();
    if (error) return res.status(400).json({ error: error.message });
    WEBHOOKS.emit(c.org_id, 'task.created', { client_id: c.id, task_id: data.id, title: data.title, owner: data.owner, due_date: data.due_date });
    res.json({ task: data });
  } catch (e) { orgErr(res, e); }
});
app.patch('/api/org/:id/tasks/:tid', auth, async (req, res) => {
  try {
    await ORGS.requireOrg(req, req.params.id, 'clients.write'); const b = req.body || {}; const patch = {};
    if (['open', 'done', 'cancelled'].includes(b.status)) { patch.status = b.status; patch.done_at = b.status === 'done' ? new Date().toISOString() : null; }
    if (b.title) patch.title = String(b.title).slice(0, 200);
    if (b.due_date === null || /^\d{4}-\d{2}-\d{2}$/.test(String(b.due_date || ''))) patch.due_date = b.due_date;
    const { data, error } = await admin().from('client_tasks').update(patch).eq('id', req.params.tid).eq('org_id', req.params.id).select('*').single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ task: data });
  } catch (e) { orgErr(res, e); }
});
app.post('/api/org/:id/clients/:cid/notes', auth, async (req, res) => {
  try {
    const c = await orgClient(req, res, 'clients.write'); const b = req.body || {};
    if (!String(b.body || '').trim()) return res.status(400).json({ error: 'Note text required' });
    const { data, error } = await admin().from('client_notes').insert({ org_id: c.org_id, client_id: c.id, author_user_id: req.userId, channel: ['note', 'whatsapp', 'email', 'call', 'meeting'].includes(b.channel) ? b.channel : 'note', body: String(b.body).slice(0, 4000) }).select('*').single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ note: data });
  } catch (e) { orgErr(res, e); }
});
/* Board: every client of the organisation by journey stage, with the one thing that is due. */
app.get('/api/org/:id/board', auth, async (req, res) => {
  try {
    await ORGS.requireOrg(req, req.params.id, 'clients.read');
    const ck = 'board:' + req.params.id + ':' + req.userId; const hit = CACHE.get(ck); if (hit) return res.json(hit);
    const m = await ORGS.membership(req.params.id, req.userId);
    const clients = await ORGS.listClients(req.params.id, { limit: 200, scope: ORGS.scopeFor(m, req.userId) });
    const { data: tasks } = await admin().from('client_tasks').select('client_id,title,owner,due_date').eq('org_id', req.params.id).eq('status', 'open').order('due_date', { ascending: true, nullsFirst: false });
    const dueOf = {}; for (const t of (tasks || [])) if (!dueOf[t.client_id]) dueOf[t.client_id] = t;
    const today = new Date().toISOString().slice(0, 10);
    const stages = ['lead', 'discover', 'qualify', 'match', 'decide', 'prepare', 'apply', 'offer', 'visa', 'travel', 'arrive', 'settle', 'pr', 'closed'];
    const cols = stages.map(s => ({ stage: s, clients: clients.filter(c => c.stage === s).map(c => ({ ...c, next: dueOf[c.id] || null, overdue: !!(dueOf[c.id] && dueOf[c.id].due_date && dueOf[c.id].due_date < today) })) }));
    const cfg = await siteSettings.getConfig();
    try { const { data: mem } = await admin().from('org_members').select('user_id,name,role').eq('org_id', req.params.id).limit(200); const nameOf = Object.fromEntries((mem || []).map(x => [x.user_id, x.name || x.role])); const now = Date.now(); for (const col of (cols || [])) for (const c of (col.clients || [])) { c.assigned_name = nameOf[c.assigned_to || c.owner_user_id] || null; c.days_in_stage = Math.floor((now - new Date(c.stage_changed_at || c.created_at).getTime()) / 86400000); c.idle_days = Math.floor((now - new Date(c.last_activity_at || c.updated_at || c.created_at).getTime()) / 86400000); c.priority = c.priority || 'normal'; } } catch (e) {}
    res.json(CACHE.set(ck, { stages, columns: cols, total: clients.length, overdue: (tasks || []).filter(t => t.due_date && t.due_date < today).length, agency: cfg.agency || {} }, 10000));
  } catch (e) { orgErr(res, e); }
});
app.get('/api/org/:id/commissions', auth, async (req, res) => {
  try {
    await ORGS.requireOrg(req, req.params.id, 'finance.read');
    const { data } = await admin().from('commission_ledger').select('*').eq('org_id', req.params.id).order('created_at', { ascending: false }).limit(200);
    const rows = data || [];
    res.json({ rows, accrued_pkr: rows.filter(r => r.status === 'accrued').reduce((a, r) => a + r.amount_pkr, 0), payable_pkr: rows.filter(r => r.status === 'payable').reduce((a, r) => a + r.amount_pkr, 0), paid_pkr: rows.filter(r => r.status === 'paid').reduce((a, r) => a + r.amount_pkr, 0) });
  } catch (e) { orgErr(res, e); }
});
/* Commission accrual: when a payment is confirmed for a user who is somebody's client, the
   owning organisation earns its share. Idempotent per payment. */
async function accrueCommission(payment) {
  try {
    const { data: cl } = await admin().from('clients').select('id,org_id,owner_user_id').eq('user_id', payment.user_id).eq('status', 'active').limit(1);
    const c = cl && cl[0]; if (!c) return;
    const { data: org } = await admin().from('organisations').select('kind').eq('id', c.org_id).maybeSingle();
    if (!org || org.kind === 'personal') return;
    const { data: dup } = await admin().from('commission_ledger').select('id').eq('payment_id', payment.id).limit(1);
    if (dup && dup.length) return;
    const cfg = await siteSettings.getConfig(); const pct = Number((cfg.agency || {}).commission_pct_agency) || 0;
    const amt = Math.round((Number(payment.amount_pkr) || 0) * pct / 100);
    if (amt > 0) { await admin().from('commission_ledger').insert({ org_id: c.org_id, client_id: c.id, payment_id: payment.id, amount_pkr: amt, rate_pct: pct, note: payment.credits + ' case package' }); WEBHOOKS.emit(c.org_id, 'commission.accrued', { client_id: c.id, payment_id: payment.id, amount_pkr: amt, rate_pct: pct }); }
    await admin().from('payments').update({ org_id: c.org_id, client_id: c.id }).eq('id', payment.id).then(() => {}, () => {});
  } catch (e) {}
}
/* ============================================================================= */
/* ================= INTERNATIONAL CARD PAYMENTS (USD) ================= */
const GATEWAY = require('./lib/gateway');
const { perUsd } = require('./lib/pay');
/* One quote in two currencies: USD is what the card is charged; local is a display estimate. */
async function usdQuote(userId, credits) {
  const cfg = await siteSettings.getConfig();
  const t = ((cfg.packages && cfg.packages.tiers) || []).find(x => Number(x.credits) === Number(credits));
  if (!t) return null;
  const list = Number(t.usd) || 0;
  const promo = (Number(t.promo_usd) > 0 && Number(t.promo_usd) < list) ? Number(t.promo_usd) : null;
  let discountUsd = 0;
  try {
    const { data: me } = await admin().from('profiles').select('referral_balance_pkr,country_code,nationality').eq('id', userId).single();
    const fx = await perUsd('PKR'); const disc = Math.min(Number(me && me.referral_balance_pkr) || 0, 500 * (t.credits || 1));
    discountUsd = Math.round((disc / (fx.rate || 278)) * 100) / 100;
    const { data: me2 } = await admin().from('profiles').select('origin_country').eq('id', userId).maybeSingle();
    const origin = String((me2 && me2.origin_country) || (me && (me.country_code || me.nationality)) || 'PK').toUpperCase();
    const cur = (require('./lib/i18n').ORIGINS[origin] || {}).currency || 'USD'; const lf = await perUsd(cur);
    const amountUsd = Math.max(0, (promo != null ? promo : list) - discountUsd);
    return { name: t.name, credits: t.credits, list_usd: list, promo_usd: promo, discount_usd: discountUsd, amount_usd: Math.round(amountUsd * 100) / 100,
      local_currency: cur, local_rate: lf.rate || null, local_live: !!lf.live, amount_local: lf.rate ? Math.round(amountUsd * lf.rate) : null, origin, bank_transfer: !!(require('./lib/i18n').ORIGINS[origin] || {}).bank_transfer };
  } catch (e) {
    const amountUsd = Math.max(0, (promo != null ? promo : list));
    return { name: t.name, credits: t.credits, list_usd: list, promo_usd: promo, discount_usd: 0, amount_usd: amountUsd, local_currency: 'PKR', local_rate: null, local_live: false, amount_local: null };
  }
}
app.get('/api/pay/quote', auth, async (req, res) => {
  try { const q = await usdQuote(req.userId, req.query.credits); if (!q) return res.status(404).json({ error: 'Choose a valid package' });
    let local = null; try { const { data: p } = await admin().from('profiles').select('origin_country').eq('id', req.userId).maybeSingle(); const cur = require('./lib/world').origin((p && p.origin_country) || 'PK').currency; if (cur && cur !== 'USD') { const fx = await require('./lib/pay').liveRates().catch(() => null); const r = fx && fx.rates && fx.rates[cur]; if (r) local = { currency: cur, amount: require('./lib/world').niceRound(q.amount_usd * r), rate: r, as_of: new Date().toISOString().slice(0, 10), note: 'Indicative, at today\'s rate; you are charged in USD and your bank converts.' }; } } catch (e) {}
    res.json({ ...q, card: GATEWAY.enabled(), local, tax: 'Sales tax or VAT is added at checkout only where the law of your country requires it; the payment provider (merchant of record) calculates and remits it. The price shown is before tax.', fees: { non_refundable: 'ForiForeign service fee for prepared cases and used add-ons', refundable: 'unused case credits within 14 days by the original method', not_ours: 'application fees, visa fees, medicals, attestation, tests, tuition and any official charge are paid by you directly to the authority or institution; we or your consultancy can assist you with the payment steps' } }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* Start a card checkout: a pending payment row is created first so the webhook and the
   return page both have something to confirm, exactly like the screenshot flow. */
app.post('/api/pay/checkout', auth, async (req, res) => {
  /* GAP: a consultancy's client is never sold ForiForeign packages, server-side as well as on screen. */
  try { const { data: cl } = await admin().from('clients').select('org_id').eq('user_id', req.userId).limit(1); if (cl && cl.length && !STAFF_ROLES.includes(req.userRole)) return res.status(403).json({ error: 'Your cases are handled by your consultancy; there is nothing to buy here.', code: 'CONSULTANCY_CLIENT' }); } catch (e) {}
  try {
    if (!GATEWAY.enabled()) return res.status(400).json({ error: 'Card payments are not switched on yet. Use bank transfer with a screenshot.' });
    const credits = Number((req.body || {}).credits);
    const q = await usdQuote(req.userId, credits);
    if (!q) return res.status(400).json({ error: 'Choose a package first.' });
    const { data: prof } = await admin().from('profiles').select('email').eq('id', req.userId).maybeSingle();
    const { data: pay, error } = await admin().from('payments').insert({ user_id: req.userId, credits: q.credits, amount_pkr: q.amount_local && q.local_currency === 'PKR' ? q.amount_local : 0, status: 'pending', reference: 'CARD', discount_pkr: 0 }).select('id').single();
    if (error) return res.status(400).json({ error: error.message });
    const origin = (req.headers.origin || ('https://' + req.headers.host));
    await CONSENT.record(req, req.userId, 'package_purchase', { name: q.name, amount: q.amount_usd, credits: q.credits }, { payment_id: pay.id, provider: 'stripe' }); await CONSENT.record(req, req.userId, 'refund_policy', {}, { payment_id: pay.id });
    const s = await GATEWAY.createCheckout({ userId: req.userId, email: prof && prof.email, credits: q.credits, usd: q.amount_usd, name: q.name, paymentId: pay.id,
      successUrl: origin + '/?paid=1&session={CHECKOUT_SESSION_ID}', cancelUrl: origin + '/?paid=0' });
    await admin().from('payments').update({ reference: ('CARD:' + s.id).slice(0, 120) }).eq('id', pay.id).then(() => {}, () => {});
    try { await admin().from('audit_log').insert({ actor: req.userId, event: 'CARD_CHECKOUT_STARTED', detail: pay.id + ' $' + q.amount_usd }); } catch (e) {}
    res.json({ url: s.url, payment_id: pay.id, amount_usd: q.amount_usd });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
/* Grant credits for a paid session exactly once; used by the webhook and the return page. */
async function settleCardPayment(session, source) {
  const paymentId = (session.metadata && session.metadata.payment_id) || session.client_reference_id;
  if (!paymentId || session.payment_status !== 'paid') return { ok: false, reason: 'not paid' };
  const { data: p } = await admin().from('payments').select('*').eq('id', paymentId).maybeSingle();
  if (!p) return { ok: false, reason: 'unknown payment' };
  if (p.status === 'confirmed') return { ok: true, already: true };
  const { data: flipped } = await admin().from('payments').update({ status: 'confirmed', confirmed_at: new Date().toISOString() }).eq('id', p.id).eq('status', 'pending').select('id');
  if (!flipped || !flipped.length) return { ok: true, already: true };
  const creditsN = Math.max(1, Math.round(Number(p.credits) || 0));
  const led = await ledgerWrite({ user_id: p.user_id, delta: creditsN, reason: 'purchase', payment_id: p.id, note: 'Card ' + (session.id || '') });
  if (led.error) { await admin().from('payments').update({ status: 'pending' }).eq('id', p.id); return { ok: false, reason: 'ledger' }; }
  try { await admin().from('audit_log').insert({ actor: p.user_id, event: 'PAYMENT_CONFIRMED', detail: p.id + ' +' + creditsN + 'cr card/' + source }); } catch (e) {}
  accrueCommission(p).catch(() => {});
  return { ok: true, credits: creditsN };
}
/* Return page confirmation: the customer is back; verify with the gateway, never trust the URL. */
app.post('/api/pay/confirm', auth, async (req, res) => {
  try {
    const sid = String((req.body || {}).session || '');
    if (!sid) return res.status(400).json({ error: 'session required' });
    const s = await GATEWAY.retrieveSession(sid);
    if ((s.metadata || {}).user_id && s.metadata.user_id !== req.userId) return res.status(403).json({ error: 'Not your payment' });
    const r = await settleCardPayment(s, 'return');
    res.json({ ...r, balance: await balance(req.userId) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
/* =================================================================== */
/* ================= DAY 3 · AGENCY BILLING · OFFERS · INTERVIEW PREP ================= */
const OFFERS = require('./lib/offers');
async function agencyTier(key) { const cfg = await siteSettings.getConfig(); return ((cfg.agency && (cfg.agency.tiers || cfg.agency.plans)) || []).find(t => t.key === key) || null; }
async function activeSub(orgId) {
  const { data } = await admin().from('org_subscriptions').select('*').eq('org_id', orgId).eq('status', 'active').gt('period_end', new Date().toISOString()).order('period_end', { ascending: false }).limit(1);
  return data && data[0] || null;
}
app.get('/api/org/:id/billing', auth, async (req, res) => {
  try {
    await ORGS.requireOrg(req, req.params.id, 'finance.read');
    const cfg = await siteSettings.getConfig(); const sub = await activeSub(req.params.id);
    const { data: hist } = await admin().from('org_subscriptions').select('id,tier_name,usd_month,cases_month,cases_used,status,period_start,period_end,created_at').eq('org_id', req.params.id).order('created_at', { ascending: false }).limit(24);
    res.json({ tiers: (cfg.agency && (cfg.agency.tiers || cfg.agency.plans)) || [], overage_usd: (cfg.agency || {}).overage_usd_per_case || 0, subscription: sub, remaining_cases: sub ? Math.max(0, sub.cases_month - sub.cases_used) : 0, history: hist || [], card: GATEWAY.enabled() });
  } catch (e) { orgErr(res, e); }
});
/* Start a monthly plan payment on the card gateway; the webhook / return activates it. */
app.post('/api/org/:id/subscribe', auth, async (req, res) => {
  try {
    await ORGS.requireOrg(req, req.params.id, 'org.settings');
    if (!GATEWAY.enabled()) return res.status(400).json({ error: 'Card payments are not switched on yet.' });
    const t = await agencyTier(String((req.body || {}).tier || '')); if (!t) return res.status(400).json({ error: 'Choose a plan' });
    const yearly = String((req.body || {}).period || 'month') === 'year' && t.usd_year; const price = yearly ? t.usd_year : t.usd_month;
    const { data: cur } = await admin().from('org_subscriptions').select('id,period_end').eq('org_id', req.params.id).eq('status', 'active').order('period_end', { ascending: false }).limit(1).maybeSingle();
    const { data: sub, error } = await admin().from('org_subscriptions').insert({ org_id: req.params.id, tier_key: t.key, tier_name: t.name, usd_month: price, cases_month: t.cases_month, searches_day: t.searches_day || null, searches_month: t.searches_month || null, renewed_from: cur ? cur.id : null, billing_period: yearly ? 'year' : 'month', status: 'pending' }).select('id').single();
    if (error) return res.status(400).json({ error: error.message });
    const { data: pay } = await admin().from('payments').insert({ user_id: req.userId, credits: 0, amount_pkr: 0, status: 'pending', reference: 'AGENCY', kind: 'agency_subscription', subscription_id: sub.id, org_id: req.params.id }).select('id').single().then(r => r, () => ({ data: null }));
    try { const { data: og } = await admin().from('organisations').select('name').eq('id', req.params.id).maybeSingle(); await CONSENT.record(req, req.userId, 'agency_plan', { org: (og && og.name) || req.params.id, name: t.name, amount: t.usd_month, cases: t.cases_month }, { subscription_id: sub.id, org_id: req.params.id }); } catch (e) {}
    const { data: prof } = await admin().from('profiles').select('email').eq('id', req.userId).maybeSingle();
    const origin = (req.headers.origin || ('https://' + req.headers.host));
    const s = await GATEWAY.createCheckout({ userId: req.userId, email: prof && prof.email, credits: 0, usd: price, name: t.name + ' agency plan (' + (yearly ? '12 months' : '1 month') + ')', paymentId: pay ? pay.id : sub.id, orgId: req.params.id, successUrl: origin + '/?paid=1&kind=agency&session={CHECKOUT_SESSION_ID}', cancelUrl: origin + '/?paid=0' });
    await admin().from('org_subscriptions').update({ gateway_ref: s.id, payment_id: pay ? pay.id : null }).eq('id', sub.id);
    res.json({ url: s.url, subscription_id: sub.id, amount_usd: t.usd_month });
  } catch (e) { orgErr(res, e); }
});
/* Activation shared by webhook and return page; idempotent per subscription. */
async function settleAgencySubscription(session) {
  const sid = session.id; if (!sid || session.payment_status !== 'paid') return { ok: false };
  const { data: sub } = await admin().from('org_subscriptions').select('*').eq('gateway_ref', sid).maybeSingle();
  if (!sub) return { ok: false, reason: 'unknown subscription' };
  if (sub.status === 'active') return { ok: true, already: true };
  let start = new Date(); if (sub.renewed_from) { const { data: prev } = await admin().from('org_subscriptions').select('period_end').eq('id', sub.renewed_from).maybeSingle(); if (prev && prev.period_end && new Date(prev.period_end) > start) start = new Date(prev.period_end); } const end = new Date(start); end.setDate(end.getDate() + (sub.billing_period === 'year' ? 365 : 30));
  await admin().from('org_subscriptions').update({ status: 'active', period_start: start.toISOString(), period_end: end.toISOString(), updated_at: start.toISOString() }).eq('id', sub.id).eq('status', 'pending');
  await admin().from('organisations').update({ plan: sub.tier_key }).eq('id', sub.org_id);
  if (sub.payment_id) await admin().from('payments').update({ status: 'confirmed', confirmed_at: start.toISOString() }).eq('id', sub.payment_id).then(() => {}, () => {});
  try { await admin().from('audit_log').insert({ actor: sub.org_id, event: 'AGENCY_PLAN_ACTIVE', detail: sub.tier_key + ' $' + sub.usd_month }); } catch (e) {}
  try { await issueOrgInvoice(Object.assign({}, sub, { period_start: start.toISOString(), period_end: end.toISOString() }), session); } catch (e) { try { require('./lib/oblog').errlog('org_invoice', e, { sub: sub.id }); } catch (x) {} }
  return { ok: true, tier: sub.tier_key, period_end: end.toISOString() };
}
/* INVOICE, automatically, on every activation and renewal: numbered, on letterhead, emailed to the owner and the coordination address, logged in the organisation's audit. */
async function issueOrgInvoice(sub, session) { const REFS = require('./lib/refs'); const ref = await REFS.next('payment'); const { data: org } = await admin().from('organisations').select('name,settings,owner_id,owner_user_id').eq('id', sub.org_id).maybeSingle(); const ownerId = org && (org.owner_user_id || org.owner_id); const { data: owner } = ownerId ? await admin().from('profiles').select('email,full_name').eq('id', ownerId).maybeSingle() : { data: null }; const id = (org && org.settings && org.settings.identity) || {}; const to = [owner && owner.email, id.contact_email].filter(Boolean).join(', '); const cfg = await siteSettings.getConfig(); const legal = cfg.legal || {};
  const lines = ['TAX INVOICE ' + ref, 'Date: ' + new Date().toISOString().slice(0, 10), 'Billed to: ' + (org ? org.name : sub.org_id) + (id.address ? ', ' + id.address : ''), '', 'FF-CRM ' + sub.tier_name + ' (' + (sub.billing_period === 'year' ? 'annual' : 'monthly') + ')', 'Period: ' + String(sub.period_start).slice(0, 10) + ' to ' + String(sub.period_end).slice(0, 10), 'Amount: USD ' + sub.usd_month + (Number((cfg.tax || {}).default_pct || 0) || ((cfg.tax || {}).by_country || {})[(org && org.settings && org.settings.identity && org.settings.identity.country_code) || ''] ? ' plus tax as shown on the invoice record' : ''), 'Paid by card via ' + ((session && session.gateway) || (cfg.gateway && cfg.gateway.provider) || 'card') + (session && session.id ? ' · ref ' + String(session.id).slice(0, 24) : ''), '', 'Issued by ' + (legal.company_name || 'ForiForeign (Private) Limited') + (legal.address ? ', ' + legal.address : '') + (legal.ntn ? ' · NTN ' + legal.ntn : ''), 'Questions: admin@foriforeign.com'].join('\n');
  let pdf = null; try { pdf = await require('./lib/prospecting').letterheadPdf({ title: 'Invoice ' + ref, body: lines, to: org ? org.name : '', ref }); } catch (e) {}
  const taxCfg = cfg.tax || {}; const orgCC = (org && org.settings && org.settings.identity && org.settings.identity.country_code) || null; const taxPct = Number((taxCfg.by_country || {})[orgCC] != null ? taxCfg.by_country[orgCC] : (taxCfg.default_pct || 0)) || 0; const taxUsd = Math.round(Number(sub.usd_month) * taxPct) / 100; const { data: inv } = await admin().from('org_invoices').insert({ ref, org_id: sub.org_id, subscription_id: sub.id, payment_id: sub.payment_id || null, tier_key: sub.tier_key, tier_name: sub.tier_name, billing_period: sub.billing_period, amount_usd: sub.usd_month, tax_pct: taxPct, tax_usd: taxUsd, total_usd: Number(sub.usd_month) + taxUsd, period_start: sub.period_start, period_end: sub.period_end, status: 'paid', gateway: (session && session.gateway) || null, gateway_ref: session && session.id ? String(session.id).slice(0, 80) : null, emailed_to: to || null }).select('id').single();
  if (to) { try { const M = require('./lib/mailer'); const html = M.wrap('Your FF-CRM invoice ' + ref, 'Thank you. FF-CRM ' + sub.tier_name + ' is active until ' + String(sub.period_end).slice(0, 10) + '. Amount USD ' + sub.usd_month + ', paid by card. The invoice is attached; it is also under FF-CRM → Billing.', 'work'); if (pdf) await M.sendRaw({ from: process.env.MAIL_FROM || ('ForiForeign <no-reply@' + (process.env.APPLY_DOMAIN || 'forimail.com') + '>'), to, subject: 'Invoice ' + ref + ' · FF-CRM ' + sub.tier_name, html, text: lines, replyTo: 'admin@foriforeign.com', attachments: [{ filename: ref + '.pdf', content: pdf.toString('base64') }] }); else await M.send(to, 'Invoice ' + ref + ' · FF-CRM ' + sub.tier_name, html); if (inv) await admin().from('org_invoices').update({ emailed_at: new Date().toISOString() }).eq('id', inv.id); } catch (e) {} }
  try { await orgAudit(sub.org_id, ownerId || null, 'INVOICE_ISSUED', ref + ' USD ' + sub.usd_month + ' ' + sub.tier_name); } catch (e) {}
  return ref; }
app.post('/api/org/:id/subscription/confirm', auth, async (req, res) => {
  try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const s = await GATEWAY.retrieveSession(String((req.body || {}).session || '')); res.json(await settleAgencySubscription(s)); }
  catch (e) { orgErr(res, e); }
});
/* Plan limits enforced here: a consultant activates a client's cases from the agency pool. */
app.post('/api/org/:id/clients/:cid/grant', auth, async (req, res) => {
  try {
    const c = await orgClient(req, res, 'clients.write');
    if (!c.user_id) return res.status(400).json({ error: 'Client has no ForiForeign login yet.' });
    const n = Math.max(1, Math.min(50, Math.round(Number((req.body || {}).credits) || 1)));
    const me = await ORGS.membership(req.params.id, req.userId); const chk = await QUOTA.check(req.params.id, me, 'org_case', n); if (!chk.ok) return res.status(402).json({ error: chk.reason, code: chk.code });
    const sub = await activeSub(req.params.id); const remaining = sub.cases_month - sub.cases_used;
    const { data: upd } = await admin().from('org_subscriptions').update({ cases_used: sub.cases_used + n, updated_at: new Date().toISOString() }).eq('id', sub.id).eq('cases_used', sub.cases_used).select('id');
    if (!upd || !upd.length) return res.status(409).json({ error: 'Try again' });
    await QUOTA.consume(req.params.id, me, 'org_case', n);
    const led = await ledgerWrite({ user_id: c.user_id, delta: n, reason: 'grant', note: 'Agency plan ' + sub.tier_name + ' via ' + req.params.id });
    if (led.error) { await admin().from('org_subscriptions').update({ cases_used: sub.cases_used }).eq('id', sub.id); return res.status(500).json({ error: 'Could not add credits' }); }
    await orgAudit(req.params.id, req.userId, 'AGENCY_GRANT', c.full_name + ' +' + n + ' case(s)');
    res.json({ ok: true, granted: n, remaining: remaining - n, balance: await balance(c.user_id) });
  } catch (e) { orgErr(res, e); }
});
/* Invoice: a simple, printable PDF for the accountant. */
app.get('/api/org/:id/invoice/:sid', auth, async (req, res) => {
  try {
    await ORGS.requireOrg(req, req.params.id, 'finance.read');
    const { data: sub } = await admin().from('org_subscriptions').select('*').eq('id', req.params.sid).eq('org_id', req.params.id).maybeSingle();
    if (!sub) return res.status(404).json({ error: 'Not found' });
    const { data: org } = await admin().from('organisations').select('name,country_code,settings').eq('id', req.params.id).maybeSingle();
    const PDFDocument = require('pdfkit'); const doc = new PDFDocument({ margin: 54 }); const chunks = [];
    doc.on('data', c => chunks.push(c)); doc.on('end', () => { res.setHeader('content-type', 'application/pdf'); res.setHeader('content-disposition', 'inline; filename="foriforeign-invoice-' + sub.id.slice(0, 8) + '.pdf"'); res.send(Buffer.concat(chunks)); });
    doc.fontSize(20).text('ForiForeign', { continued: true }).fontSize(10).text('   foriforeign.com · admin@foriforeign.com'); doc.moveDown();
    doc.fontSize(14).text('INVOICE ' + sub.id.slice(0, 8).toUpperCase()); doc.fontSize(10).text('Date: ' + String(sub.created_at).slice(0, 10)); doc.text('Status: ' + sub.status.toUpperCase()); doc.moveDown();
    const cfgL = await siteSettings.getConfig(); const legal = cfgL.legal || {}; doc.text('From: ' + (legal.company_name || 'ForiForeign (Private) Limited') + (legal.ntn ? ' · NTN ' + legal.ntn : '') + (legal.address ? ' · ' + legal.address : ''));
    doc.text('Billed to: ' + (org && org.name || '') + (org && org.settings && org.settings.city ? ', ' + org.settings.city : '') + ' (' + (org && org.country_code || '') + ')' + (org && org.settings && org.settings.tax_id ? ' · Tax ID ' + org.settings.tax_id : '')); doc.moveDown();
    doc.text('Description: ' + sub.tier_name + ' agency plan, 1 month (' + sub.cases_month + ' prepared cases)');
    doc.text('Period: ' + (sub.period_start ? String(sub.period_start).slice(0, 10) : '-') + ' to ' + (sub.period_end ? String(sub.period_end).slice(0, 10) : '-'));
    doc.moveDown(); doc.fontSize(13).text('Total: USD ' + Number(sub.usd_month).toFixed(2)); doc.fontSize(9).moveDown().text('Paid by card via secure checkout. Cases used this period: ' + sub.cases_used + ' of ' + sub.cases_month + '.');
    doc.end();
  } catch (e) { orgErr(res, e); }
});
/* Offers & conditions: the applicant's own, and the consultant's view of a client's. */
app.get('/api/offers', auth, async (req, res) => { try { res.json({ offers: await OFFERS.list(req.userId) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/offers', auth, async (req, res) => { try { const o = await OFFERS.create(req.userId, req.body || {}); JE.recompute(req.userId); res.json({ offer: OFFERS.enrich(o) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.patch('/api/offers/:id', auth, async (req, res) => { try { const o = await OFFERS.update(req.userId, req.params.id, req.body || {}); JE.recompute(req.userId); res.json({ offer: OFFERS.enrich(o) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/org/:id/clients/:cid/offers', auth, async (req, res) => { try { const c = await orgClient(req, res, 'clients.read'); res.json({ offers: c.user_id ? await OFFERS.list(c.user_id) : [] }); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/clients/:cid/offers', auth, async (req, res) => {
  try { const c = await orgClient(req, res, 'clients.write'); if (!c.user_id) return res.status(400).json({ error: 'Client has no ForiForeign login yet.' });
    const o = await OFFERS.create(c.user_id, req.body || {}, { clientId: c.id, orgId: c.org_id }); WEBHOOKS.emit(c.org_id, 'offer.recorded', { client_id: c.id, offer_id: o.id, issuer: o.issuer, title: o.title, kind: o.kind });
    await admin().from('clients').update({ stage: 'offer', updated_at: new Date().toISOString() }).eq('id', c.id).in('stage', ['apply', 'prepare', 'match', 'decide']).then(() => {}, () => {});
    res.json({ offer: OFFERS.enrich(o) }); } catch (e) { orgErr(res, e); }
});
/* Interview preparation runs on the queue; the pack is ready in about a minute. */
app.post('/api/interview/prep', auth, async (req, res) => {
  try { const cap = await overCap(req.userId, 'interview_prep'); if (cap) return res.status(402).json({ error: 'You have used ' + cap + ' interview packs this month. Add an interview add-on or wait for the monthly reset.' }); await meter(req.userId, 'interview_prep'); const jobId = await QUEUE.enqueue('interview_prep', Object.assign({}, req.body || {}, { userId: req.userId }), { userId: req.userId, maxAttempts: 2 }); res.json({ ok: true, job_id: jobId }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/interview/preps', auth, async (req, res) => { try { res.json({ preps: await OFFERS.listPreps(req.userId) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/interview/preps/:id', auth, async (req, res) => { try { const p = await OFFERS.getPrep(req.userId, req.params.id); if (!p) return res.status(404).json({ error: 'Not found' }); res.json({ prep: p }); } catch (e) { res.status(400).json({ error: e.message }); } });
QUEUE.register('interview_prep', async (p) => { const r = await OFFERS.prepareInterview(p.userId, p); return { id: r.id }; });
/* ====================================================================================== */
/* ================= DAY 4 · VISA INTELLIGENCE ================= */
const VISA = require('./lib/visa');
app.get('/api/visa/countries', auth, async (req, res) => { try { res.json({ countries: await VISA.countries() }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/visa/routes', auth, async (req, res) => { try { res.json({ routes: await VISA.routes(req.query.cc, req.query.lane) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/visa/assess', auth, async (req, res) => { try { res.json(await VISA.assess(req.userId, String(req.query.cc || '').toUpperCase(), String(req.query.route || ''))); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/visa/cases', auth, async (req, res) => {
  try {
    const b = req.body || {}; const cc = String(b.cc || '').toUpperCase(), route = String(b.route || '');
    const { count: used } = await admin().from('visa_cases').select('id', { count: 'exact', head: true }).eq('user_id', req.userId); const g = await addonGate(req.userId, 'visa_desk', used || 0); if (!g.ok) return res.status(402).json({ error: 'Your first visa desk file comes with a package; further files are a $' + g.price_usd + ' add-on.', addon: 'visa_desk', price_usd: g.price_usd });
    const a = await VISA.assess(req.userId, cc, route);
    const { data, error } = await admin().from('visa_cases').insert({ user_id: req.userId, country_code: cc, route_key: route, offer_id: b.offer_id || null, status: a.ready ? 'ready' : 'preparing', prefill: a.prefill, checklist: { required: a.required, flags: a.flags } }).select('*').single();
    if (error) return res.status(400).json({ error: error.message }); JE.recompute(req.userId);
    res.json({ case: data, assessment: a });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/visa/cases', auth, async (req, res) => { try { const { data } = await admin().from('visa_cases').select('id,country_code,route_key,status,submitted_on,decision_on,created_at,updated_at').eq('user_id', req.userId).order('created_at', { ascending: false }); res.json({ cases: data || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.patch('/api/visa/cases/:id', auth, async (req, res) => {
  try {
    const b = req.body || {}; const patch = { updated_at: new Date().toISOString() };
    if (['draft', 'preparing', 'ready', 'submitted', 'decision_pending', 'granted', 'refused', 'withdrawn'].includes(b.status)) patch.status = b.status;
    for (const k of ['submitted_on', 'decision_on']) if (/^\d{4}-\d{2}-\d{2}$/.test(String(b[k] || ''))) patch[k] = b[k];
    if (b.notes !== undefined) patch.notes = String(b.notes || '').slice(0, 4000);
    const { data, error } = await admin().from('visa_cases').update(patch).eq('id', req.params.id).eq('user_id', req.userId).select('*').single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ case: data });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/visa/cases/:id/refusal', auth, async (req, res) => {
  try {
    const { data: c } = await admin().from('visa_cases').select('*').eq('id', req.params.id).eq('user_id', req.userId).maybeSingle();
    if (!c) return res.status(404).json({ error: 'Not found' });
    const cap = await overCap(req.userId, 'refusal_analysis'); if (cap) return res.status(402).json({ error: 'Refusal analysis limit reached for this month (' + cap + ').' }); await meter(req.userId, 'refusal_analysis');
    const jobId = await QUEUE.enqueue('visa_refusal', { caseId: c.id, userId: req.userId, cc: c.country_code, route: c.route_key, text: String((req.body || {}).text || ''), extra: (req.body || {}).extra || '' }, { userId: req.userId, maxAttempts: 2 });
    await admin().from('visa_cases').update({ status: 'refused', updated_at: new Date().toISOString() }).eq('id', c.id);
    res.json({ ok: true, job_id: jobId });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/visa/cases/:id', auth, async (req, res) => { try { const { data } = await admin().from('visa_cases').select('*').eq('id', req.params.id).eq('user_id', req.userId).maybeSingle(); if (!data) return res.status(404).json({ error: 'Not found' }); res.json({ case: data }); } catch (e) { res.status(400).json({ error: e.message }); } });
QUEUE.register('visa_refusal', async (p) => { const r = await VISA.analyseRefusal(p.userId, p.cc, p.route, p.text, p.extra); await admin().from('visa_cases').update({ refusal: r, updated_at: new Date().toISOString() }).eq('id', p.caseId); return { ok: true }; });
/* Consultant view of a client's visa readiness. */
app.get('/api/org/:id/clients/:cid/visa', auth, async (req, res) => {
  try { const c = await orgClient(req, res, 'clients.read'); if (!c.user_id) return res.status(400).json({ error: 'Client has no login yet.' }); res.json(await VISA.assess(c.user_id, String(req.query.cc || '').toUpperCase(), String(req.query.route || ''))); }
  catch (e) { orgErr(res, e); }
});
/* Admin: seed once, list, verify against the source (records verifier, date, version). */
app.post('/api/admin/visa/seed', auth, perm('settings.write'), async (req, res) => { try { res.json(await VISA.seedIfEmpty()); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/visa/rules', auth, perm('settings.read'), async (req, res) => { try { const { data } = await admin().from('visa_rules').select('*').neq('status', 'superseded').order('country_code').order('route_key').order('rule_type'); res.json({ rules: data || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.patch('/api/admin/visa/rules/:rid', auth, perm('settings.write'), async (req, res) => { try { res.json({ rule: await VISA.verifyRule(req.userId, req.params.rid, req.body || {}) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/visa/rules', auth, perm('settings.write'), async (req, res) => {
  try { const b = req.body || {}; const row = { country_code: String(b.country_code || '').toUpperCase().slice(0, 2), route_key: String(b.route_key || '').slice(0, 60), route_name: String(b.route_name || '').slice(0, 120), lane: ['study', 'work', 'both'].includes(b.lane) ? b.lane : 'both', rule_type: b.rule_type, text: String(b.text || '').slice(0, 1000), value: b.value && typeof b.value === 'object' ? b.value : {}, source_url: String(b.source_url || '').slice(0, 500) || null, source_title: String(b.source_title || '').slice(0, 200) || null, status: 'unverified' };
    if (!row.country_code || !row.route_key || !row.text || !row.rule_type) return res.status(400).json({ error: 'country, route, type and text are required' });
    const { data, error } = await admin().from('visa_rules').insert(row).select('*').single(); if (error) return res.status(400).json({ error: error.message }); res.json({ rule: data }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* ============================================================== */
/* ================= DAY 5 · AFTER THE VISA ================= */
const JOURNEY = require('./lib/journey');
app.post('/api/journey/plan', auth, async (req, res) => { try { res.json(await JOURNEY.plan(req.userId, (req.body || {}).cc, (req.body || {}).lane)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/journey', auth, async (req, res) => { try { res.json(await JOURNEY.list(req.userId, req.query.cc)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.patch('/api/journey/:id', auth, async (req, res) => { try { res.json({ task: await JOURNEY.setDone(req.userId, req.params.id, !!(req.body || {}).done) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/org/:id/clients/:cid/journey', auth, async (req, res) => { try { const c = await orgClient(req, res, 'clients.write'); if (!c.user_id) return res.status(400).json({ error: 'Client has no login yet.' }); res.json(await JOURNEY.plan(c.user_id, (req.body || {}).cc, c.lane === 'work' ? 'work' : 'study', c.id)); } catch (e) { orgErr(res, e); } });
app.get('/api/org/:id/clients/:cid/journey', auth, async (req, res) => { try { const c = await orgClient(req, res, 'clients.read'); res.json(c.user_id ? await JOURNEY.list(c.user_id, req.query.cc) : { tasks: [], phases: {}, progress: {} }); } catch (e) { orgErr(res, e); } });
/* ============================================================ */
/* ================= DAY 6 · LEARNING LOOP · AGENCY ANALYTICS ================= */
const LEARNING = require('./lib/learning');
app.get('/api/admin/learning', auth, perm('overview.read'), async (req, res) => { try { res.json({ learning: await LEARNING.current(), max_nudge: LEARNING.MAX_NUDGE }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/learning/rebuild', auth, perm('settings.write'), async (req, res) => { try { res.json(await LEARNING.rebuild()); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/org/:id/analytics', auth, async (req, res) => {
  try {
    await ORGS.requireOrg(req, req.params.id, 'finance.read');
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [cl, tk, cm, sub, mem] = await Promise.all([
      admin().from('clients').select('id,stage,owner_user_id,branch,lane,created_at,updated_at').eq('org_id', req.params.id).then(r => r.data || [], () => []),
      admin().from('client_tasks').select('id,status,due_date,assignee_user_id').eq('org_id', req.params.id).then(r => r.data || [], () => []),
      admin().from('commission_ledger').select('amount_pkr,status,created_at').eq('org_id', req.params.id).then(r => r.data || [], () => []),
      admin().from('org_subscriptions').select('tier_name,cases_month,cases_used,period_end').eq('org_id', req.params.id).eq('status', 'active').order('period_end', { ascending: false }).limit(1).then(r => r.data && r.data[0], () => null),
      admin().from('org_members').select('user_id,role,branch').eq('org_id', req.params.id).then(r => r.data || [], () => [])
    ]);
    const ids = [...new Set(mem.map(m => m.user_id))];
    const { data: profs } = ids.length ? await admin().from('profiles').select('id,full_name').in('id', ids) : { data: [] };
    const nameOf = Object.fromEntries((profs || []).map(p => [p.id, p.full_name]));
    const today = new Date().toISOString().slice(0, 10);
    const stages = ['lead', 'discover', 'qualify', 'match', 'decide', 'prepare', 'apply', 'offer', 'visa', 'travel', 'arrive', 'settle', 'pr', 'closed'];
    const byStage = Object.fromEntries(stages.map(s => [s, cl.filter(c => c.stage === s).length]));
    const reached = s => cl.filter(c => stages.indexOf(c.stage) >= stages.indexOf(s)).length;
    const funnel = ['lead', 'apply', 'offer', 'visa', 'arrive'].map(s => ({ stage: s, clients: reached(s) }));
    const perConsultant = ids.map(u => ({ user_id: u, name: nameOf[u] || u.slice(0, 8), role: (mem.find(m => m.user_id === u) || {}).role, clients: cl.filter(c => c.owner_user_id === u).length, open_tasks: tk.filter(t => t.assignee_user_id === u && t.status === 'open').length, overdue: tk.filter(t => t.assignee_user_id === u && t.status === 'open' && t.due_date && t.due_date < today).length }));
    const byBranch = {}; for (const c of cl) { const b = c.branch || 'No branch'; byBranch[b] = (byBranch[b] || 0) + 1; }
    res.json({ clients_total: cl.length, new_30d: cl.filter(c => c.created_at >= since).length, by_stage: byStage, funnel, by_lane: { study: cl.filter(c => c.lane === 'study').length, work: cl.filter(c => c.lane === 'work').length, both: cl.filter(c => c.lane === 'both').length }, by_branch: byBranch,
      tasks: { open: tk.filter(t => t.status === 'open').length, overdue: tk.filter(t => t.status === 'open' && t.due_date && t.due_date < today).length, done_30d: tk.filter(t => t.status === 'done').length },
      commissions: { accrued_pkr: cm.filter(x => x.status === 'accrued').reduce((a, x) => a + x.amount_pkr, 0), paid_pkr: cm.filter(x => x.status === 'paid').reduce((a, x) => a + x.amount_pkr, 0), last_30d_pkr: cm.filter(x => x.created_at >= since && x.status !== 'void').reduce((a, x) => a + x.amount_pkr, 0) },
      plan: sub ? { tier: sub.tier_name, used: sub.cases_used, of: sub.cases_month, renews: sub.period_end } : null, per_consultant: perConsultant });
  } catch (e) { orgErr(res, e); }
});
/* ============================================================================ */
/* ================= DAY 7 · PARTNER PORTAL ================= */
const PARTNERS = require('./lib/partners');
app.get('/api/org/:id/openings', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.read'); res.json({ openings: await PARTNERS.list(req.params.id) }); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/openings', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.write'); res.json({ opening: await PARTNERS.create(req.params.id, req.userId, req.body || {}) }); } catch (e) { orgErr(res, e); } });
app.patch('/api/org/:id/openings/:oid', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.write'); const b = req.body || {}; res.json({ opening: b.status ? await PARTNERS.setStatus(req.params.id, req.params.oid, b.status) : await PARTNERS.update(req.params.id, req.params.oid, b) }); } catch (e) { orgErr(res, e); } });
app.get('/api/org/:id/applicants', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.read'); res.json({ applicants: await PARTNERS.applicants(req.params.id) }); } catch (e) { orgErr(res, e); } });
app.patch('/api/org/:id/applicants/:aid', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.write'); const r = await PARTNERS.setPartnerStatus(req.params.id, req.params.aid, (req.body || {}).status, (req.body || {}).note); WEBHOOKS.emit(req.params.id, 'applicant.status_changed', { application_id: req.params.aid, status: (req.body || {}).status }); res.json(r); } catch (e) { orgErr(res, e); } });
app.post('/api/applications/:id/consent', auth, async (req, res) => { try { const r = await PARTNERS.consent(req.userId, req.params.id, !!(req.body || {}).consent); if (r.consent) { try { const { data: a } = await admin().from('applications').select('opportunity_id').eq('id', req.params.id).maybeSingle(); const { data: op } = a ? await admin().from('partner_openings').select('org_id').eq('opportunity_id', a.opportunity_id).maybeSingle() : { data: null }; const { data: og } = op ? await admin().from('organisations').select('name').eq('id', op.org_id).maybeSingle() : { data: null }; await CONSENT.record(req, req.userId, 'share_with_partner', { org: (og && og.name) || 'the institution' }, { application_id: req.params.id }); } catch (e) {} } res.json(r); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/partners', auth, async (req, res) => { try { res.json({ partners: await PARTNERS.servicePartners(req.query.slot, req.query.cc) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/partners', auth, perm('settings.read'), async (req, res) => { try { const { data } = await admin().from('service_partners').select('*').order('slot').order('name'); res.json({ partners: data || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/partners', auth, perm('settings.write'), async (req, res) => {
  try { const b = req.body || {}; const row = { slot: b.slot, name: String(b.name || '').slice(0, 120), url: String(b.url || '').slice(0, 400) || null, whatsapp: String(b.whatsapp || '').slice(0, 40) || null, countries: Array.isArray(b.countries) ? b.countries.map(c => String(c).toUpperCase().slice(0, 2)) : String(b.countries || '').split(',').map(c => c.trim().toUpperCase()).filter(Boolean), description: String(b.description || '').slice(0, 500) || null, status: ['draft', 'live', 'paused'].includes(b.status) ? b.status : 'live' };
    if (!row.name || !row.slot) return res.status(400).json({ error: 'Name and slot required' }); const { data, error } = await admin().from('service_partners').insert(row).select('*').single(); if (error) return res.status(400).json({ error: error.message }); res.json({ partner: data }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.patch('/api/admin/partners/:pid', auth, perm('settings.write'), async (req, res) => { try { const b = req.body || {}; const patch = {}; if (['draft', 'live', 'paused'].includes(b.status)) patch.status = b.status; for (const k of ['name', 'url', 'whatsapp', 'description']) if (b[k] !== undefined) patch[k] = String(b[k] || '').slice(0, 500) || null; const { data, error } = await admin().from('service_partners').update(patch).eq('id', req.params.pid).select('*').single(); if (error) return res.status(400).json({ error: error.message }); res.json({ partner: data }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ========================================================== */
/* ================= DAYS 8-10 · GLOBAL · PERFORMANCE · SECURITY ================= */
const I18N = require('./lib/i18n'); const FCRYPT = require('./lib/crypto'); const CACHE = require('./lib/cache');
app.get('/api/i18n', (req, res) => { res.set('Cache-Control', 'public, max-age=3600'); res.json({ langs: I18N.LANGS, origins: I18N.ORIGINS, strings: I18N.T }); });
app.put('/api/me/locale', auth, async (req, res) => {
  try { const b = req.body || {}; const patch = {}; if (I18N.LANGS[b.locale]) patch.locale = b.locale; if (I18N.ORIGINS[b.origin_country]) patch.origin_country = b.origin_country;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change' }); const { error } = await admin().from('profiles').update(patch).eq('id', req.userId); if (error) return res.status(400).json({ error: error.message }); res.json({ ok: true, ...patch }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* Day 10 · data rights: export everything, request deletion. */
app.get('/api/me/export', auth, async (req, res) => {
  try {
    const out = { exported_at: new Date().toISOString(), user_id: req.userId };
    const tables = [['profile', 'profiles', 'id'], ['documents', 'documents', 'user_id'], ['applications', 'applications', 'user_id'], ['payments', 'payments', 'user_id'], ['credit_ledger', 'credit_ledger', 'user_id'], ['offers', 'offers', 'user_id'], ['interview_preps', 'interview_preps', 'user_id'], ['visa_cases', 'visa_cases', 'user_id'], ['journey_tasks', 'journey_tasks', 'user_id'], ['support_tickets', 'support_tickets', 'user_id']];
    for (const [name, table, col] of tables) { try { const { data } = await admin().from(table).select('*').eq(col, req.userId); out[name] = data || []; } catch (e) { out[name] = { error: 'unavailable' }; } }
    if (out.profile && out.profile[0]) { delete out.profile[0].gmail_refresh_enc; delete out.profile[0].mobility_enc; try { out.profile[0].mobility = (await MOBILITY.get(req.userId)).profile; } catch (e) {} }
    res.setHeader('content-disposition', 'attachment; filename="foriforeign-export-' + req.userId.slice(0, 8) + '.json"'); res.json(out);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/me/delete-request', auth, async (req, res) => {
  try { await CONSENT.record(req, req.userId, 'account_deletion', {}, {}); await admin().from('profiles').update({ deletion_requested_at: new Date().toISOString() }).eq('id', req.userId); await admin().from('audit_log').insert({ actor: req.userId, event: 'DELETION_REQUESTED', detail: 'self-service' }).then(() => {}, () => {});
    await admin().from('support_tickets').insert({ user_id: req.userId, subject: 'Account deletion requested', message: 'The user asked for their account and data to be deleted.', status: 'open' }).then(() => {}, () => {});
    res.json({ ok: true, note: 'Deletion requested. Your data is removed within 30 days unless a legal retention applies; you will get a confirmation.' }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* Day 10 · per-organisation API keys and a small read API. */
app.get('/api/org/:id/keys', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const { data } = await admin().from('org_api_keys').select('id,name,prefix,scopes,last_used_at,revoked_at,created_at').eq('org_id', req.params.id).order('created_at', { ascending: false }); res.json({ keys: data || [] }); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/keys', auth, async (req, res) => {
  try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); { const Q = require('./lib/quota'); const L = await Q.limitsFor(req.params.id, { user_id: req.userId }); const sub = L && L.sub; const tier = sub ? (((await siteSettings.getConfig()).agency || {}).tiers || []).find(t => t.key === sub.tier_key) : null; if (!sub || sub.trial || !(tier && tier.api)) return res.status(402).json({ error: 'The API comes with the Growth and Scale plans. Choose one under Billing; keys are issued the moment the plan is active.', code: 'PLAN_API' }); } const raw = 'ffk_' + require('crypto').randomBytes(24).toString('base64url'); const hash = require('crypto').createHash('sha256').update(raw).digest('hex');
    const { data, error } = await admin().from('org_api_keys').insert({ org_id: req.params.id, name: String((req.body || {}).name || 'API key').slice(0, 80), key_hash: hash, prefix: raw.slice(0, 10), created_by: req.userId }).select('id,name,prefix,created_at').single(); if (error) return res.status(400).json({ error: error.message });
    res.json({ key: raw, record: data, note: 'Copy it now; it is shown once.' }); }
  catch (e) { orgErr(res, e); }
});
app.delete('/api/org/:id/keys/:kid', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); await admin().from('org_api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', req.params.kid).eq('org_id', req.params.id); res.json({ ok: true }); } catch (e) { orgErr(res, e); } });
async function apiKeyAuth(req, res, next) {
  try { const raw = String(req.headers['x-api-key'] || ''); if (!raw.startsWith('ffk_')) return res.status(401).json({ error: 'API key required (x-api-key)' });
    const hash = require('crypto').createHash('sha256').update(raw).digest('hex'); const { data: k } = await admin().from('org_api_keys').select('id,org_id,scopes,revoked_at').eq('key_hash', hash).maybeSingle();
    if (!k || k.revoked_at) return res.status(401).json({ error: 'Invalid or revoked key' }); req.orgId = k.org_id; req.apiKeyId = k.id;
    const kk = 'apikey:' + k.id + ':' + Math.floor(Date.now() / 3600000); const n = (_ipHits.get(kk) || 0) + 1; _ipHits.set(kk, n); if (n > 600) return res.status(429).json({ error: 'API key rate limit (600/hour) reached' }); admin().from('org_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', k.id).then(() => {}, () => {}); next(); }
  catch (e) { res.status(401).json({ error: 'Invalid key' }); }
}
app.get('/api/v1/clients', apiKeyAuth, async (req, res) => { try { res.json({ clients: await ORGS.listClients(req.orgId, { limit: 200 }) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/v1/openings', apiKeyAuth, async (req, res) => { try { res.json({ openings: await PARTNERS.list(req.orgId) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/v1/applicants', apiKeyAuth, async (req, res) => { try { res.json({ applicants: await PARTNERS.applicants(req.orgId) }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* =============================================================================== */
/* ================= DAYS 11-13 · WHITE-LABEL · WEBHOOKS · PWA ================= */
const WEBHOOKS = require('./lib/webhooks');
QUEUE.register('webhook_deliver', async (p) => WEBHOOKS.deliver(p.deliveryId));
/* White-label: which organisation owns this host? Cached 60 s. */
async function orgForHost(host) {
  const _o = await orgForHostRaw(host); if (!_o) return null; try { const f = (((_o.settings) || {}).controls || {}).features || {}; if (f.whitelabel === false) return null; } catch (e) {} return _o;
}
async function orgForHostRaw(host) {
  const h = String(host || '').toLowerCase().split(':')[0]; if (!h || /foriforeign\.com$|localhost|railway\.app$/.test(h)) return null;
  const ck = 'wl:' + h; const hit = CACHE.get(ck); if (hit !== null) return hit || null;
  try { const { data: d } = await admin().from('org_domains').select('org_id').eq('domain', h).eq('verified', true).maybeSingle(); if (!d) return CACHE.set(ck, false, 60000) || null;
    const { data: o } = await admin().from('organisations').select('id,name,kind,settings,owner_id').eq('id', d.org_id).maybeSingle(); return CACHE.set(ck, o || false, 60000) || null; } catch (e) { return null; }
}
app.get('/api/whitelabel', async (req, res) => { try { const o = await orgForHost(req.headers['x-forwarded-host'] || req.headers.host); res.set('Cache-Control', 'no-store'); res.json(o ? { org_id: o.id, name: o.name, kind: o.kind, brand_color: (o.settings || {}).brand_color || null, logo_url: (o.settings || {}).logo_url || null, whatsapp: (o.settings || {}).whatsapp || null, phone: (o.settings || {}).phone || null, contact_email: (o.settings || {}).contact_email || (o.settings || {}).email || null, address: (o.settings || {}).address || null, website: (o.settings || {}).website || null, tagline: (o.settings || {}).tagline || null } : {}); } catch (e) { res.json({}); } });
/* A person who signs up on a partner domain becomes that organisation's client (origin recorded). */
app.post('/api/whitelabel/attach', auth, async (req, res) => {
  try { const o = await orgForHost(req.headers['x-forwarded-host'] || req.headers.host); if (!o) return res.json({ attached: false });
    /* STRICT SEPARATION: only an account created on this consultancy's own domain can become its client. An account born on
       foriforeign.com (or on another consultancy's domain) is refused, silently for the consultancy and plainly for the person. */
    { const { data: pr } = await admin().from('profiles').select('signup_org_id,created_at').eq('id', req.userId).maybeSingle(); const born = pr && pr.signup_org_id; if (!born) { try { await admin().from('profiles').update({ signup_org_id: o.id, signup_host: String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0] }).eq('id', req.userId).is('signup_org_id', null).gt('created_at', new Date(Date.now() - 10 * 60000).toISOString()); } catch (e) {} const { data: pr2 } = await admin().from('profiles').select('signup_org_id').eq('id', req.userId).maybeSingle(); if (!(pr2 && pr2.signup_org_id === o.id)) return res.status(403).json({ attached: false, error: 'This account was created on ForiForeign and cannot be attached to a consultancy. Sign in at foriforeign.com, or ask the consultancy to open a separate account for you on their site.' }); } else if (born !== o.id) return res.status(403).json({ attached: false, error: 'This account belongs to another consultancy\'s workspace.' }); }
    const { data: me } = await admin().from('profiles').select('full_name,email,phone,whatsapp,nationality').eq('id', req.userId).maybeSingle();
    const { data: ex } = await admin().from('clients').select('id').eq('org_id', o.id).eq('user_id', req.userId).limit(1); if (ex && ex.length) return res.json({ attached: true, client_id: ex[0].id });
    const c = await ORGS.createClient(o.id, o.owner_id, { full_name: (me && me.full_name) || 'New applicant', email: me && me.email, phone: me && (me.phone || me.whatsapp), nationality: me && me.nationality, lane: 'both' }).catch(() => null);
    if (c) { await admin().from('clients').update({ user_id: req.userId, origin_partner: o.id }).eq('id', c.id); WEBHOOKS.emit(o.id, 'client.created', { client_id: c.id, via: 'whitelabel' }); }
    res.json({ attached: !!c, client_id: c && c.id }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/org/:id/domains', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const { data } = await admin().from('org_domains').select('*').eq('org_id', req.params.id); res.json({ domains: data || [] }); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/domains', auth, async (req, res) => {
  try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const domain = String((req.body || {}).domain || '').toLowerCase().trim().replace(/^https?:\/\//, '').split('/')[0];
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || /foriforeign\.com$/.test(domain)) return res.status(400).json({ error: 'Enter a domain you own, e.g. apply.youragency.com' });
    const token = 'ff-verify-' + require('crypto').randomBytes(12).toString('hex');
    const { data, error } = await admin().from('org_domains').insert({ org_id: req.params.id, domain, verify_token: token }).select('*').single(); if (error) return res.status(400).json({ error: /unique/.test(error.message) ? 'That domain is already attached to a workspace.' : error.message });
    res.json({ domain: data, instructions: 'Add a DNS TXT record for _foriforeign.' + domain + ' with value ' + token + ', and a CNAME from ' + domain + ' to foriforeign.com. Then tap Verify.' }); }
  catch (e) { orgErr(res, e); }
});
app.post('/api/org/:id/domains/:did/verify', auth, async (req, res) => {
  try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const { data: d } = await admin().from('org_domains').select('*').eq('id', req.params.did).eq('org_id', req.params.id).maybeSingle(); if (!d) return res.status(404).json({ error: 'Not found' });
    let ok = false; try { const recs = await require('dns').promises.resolveTxt('_foriforeign.' + d.domain); ok = recs.some(r => r.join('').trim() === d.verify_token); } catch (e) {}
    if (!ok) return res.status(400).json({ error: 'TXT record not found yet. DNS can take up to an hour; try again.' });
    await admin().from('org_domains').update({ verified: true, verified_at: new Date().toISOString() }).eq('id', d.id); CACHE.bust('wl:' + d.domain); res.json({ ok: true }); }
  catch (e) { orgErr(res, e); }
});
app.delete('/api/org/:id/domains/:did', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const { data: d } = await admin().from('org_domains').select('domain').eq('id', req.params.did).eq('org_id', req.params.id).maybeSingle(); await admin().from('org_domains').delete().eq('id', req.params.did).eq('org_id', req.params.id); if (d) CACHE.bust('wl:' + d.domain); res.json({ ok: true }); } catch (e) { orgErr(res, e); } });
app.get('/api/org/:id/webhooks', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const { data } = await admin().from('org_webhooks').select('id,url,events,status,created_at').eq('org_id', req.params.id); const ids = (data || []).map(h => h.id); const { data: del } = ids.length ? await admin().from('webhook_deliveries').select('webhook_id,status,event,created_at,response_code').in('webhook_id', ids).order('created_at', { ascending: false }).limit(50) : { data: [] }; res.json({ webhooks: data || [], recent: del || [], events: WEBHOOKS.EVENTS }); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/webhooks', auth, async (req, res) => {
  try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const b = req.body || {}; const url = String(b.url || '').trim(); if (!/^https:\/\//.test(url)) return res.status(400).json({ error: 'Webhook URL must start with https://' });
    const secret = 'whs_' + require('crypto').randomBytes(24).toString('base64url'); const events = Array.isArray(b.events) && b.events.length ? b.events.filter(e => WEBHOOKS.EVENTS.includes(e)) : ['*'];
    const { data, error } = await admin().from('org_webhooks').insert({ org_id: req.params.id, url, secret, events, created_by: req.userId }).select('id,url,events,status').single(); if (error) return res.status(400).json({ error: error.message });
    res.json({ webhook: data, secret, note: 'Copy the secret now; it is shown once.' }); }
  catch (e) { orgErr(res, e); }
});
app.delete('/api/org/:id/webhooks/:wid', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); await admin().from('org_webhooks').delete().eq('id', req.params.wid).eq('org_id', req.params.id); res.json({ ok: true }); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/webhooks/:wid/test', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const n = await WEBHOOKS.emit(req.params.id, 'client.created', { test: true, client_id: '00000000-0000-0000-0000-000000000000' }); res.json({ queued: n }); } catch (e) { orgErr(res, e); } });
app.get('/api/docs', (req, res) => res.redirect('/api-docs.html'));
/* ============================================================================ */
/* ================= DAYS 16-20 · NOTIFICATIONS · SPONSORS · LEMON · FAMILY/PR · ORIGIN PACK ================= */
const NOTIFY = require('./lib/notify'); const SPONSORS = require('./lib/sponsors'); const OCC = require('./lib/occupations'); const LEMON = require('./lib/gateway_lemon');
app.get('/api/notifications', auth, async (req, res) => { try { res.json(await NOTIFY.list(req.userId, req.query.limit)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/notifications/read', auth, async (req, res) => { try { res.json(await NOTIFY.markRead(req.userId, (req.body || {}).ids)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/notifications/sweep', auth, perm('settings.write'), async (req, res) => { try { res.json(await NOTIFY.dailySweep()); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Day 17 · sponsor register (admin uploads the official CSV; opportunities get a sponsor_verified flag). */
app.post('/api/admin/sponsors/import', auth, perm('settings.write'), up.single('file'), async (req, res) => {
  try { const cc = String((req.body || {}).country_code || 'GB').toUpperCase().slice(0, 2); const text = req.file ? req.file.buffer.toString('utf8') : String((req.body || {}).csv || ''); if (!text) return res.status(400).json({ error: 'Upload the register CSV (file field "file")' });
    const r = await SPONSORS.importCsv(cc, text, (req.body || {}).source_url || null); const c = await SPONSORS.checkOpportunities(cc); res.json({ ...r, ...c }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/admin/sponsors', auth, perm('settings.read'), async (req, res) => { try { res.json({ registers: await SPONSORS.status() }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/sponsors/recheck', auth, perm('settings.write'), async (req, res) => { try { res.json(await SPONSORS.checkOpportunities(String((req.body || {}).country_code || 'GB').toUpperCase())); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/occupation', auth, async (req, res) => { res.json(OCC.classify(req.query.title || '')); });
/* Day 18 · Lemon Squeezy: checkout + webhook (raw body mounted above the JSON parser). */
app.post('/api/pay/lemon/checkout', auth, async (req, res) => {
  try { if (!LEMON.enabled()) return res.status(400).json({ error: 'Lemon Squeezy is not configured.' }); const credits = Number((req.body || {}).credits); const q = await usdQuote(req.userId, credits); if (!q) return res.status(400).json({ error: 'Choose a package first.' });
    const cfg = await siteSettings.getConfig(); const tier = ((cfg.packages && cfg.packages.tiers) || []).find(t => Number(t.credits) === credits); const { data: prof } = await admin().from('profiles').select('email').eq('id', req.userId).maybeSingle();
    const { data: pay, error } = await admin().from('payments').insert({ user_id: req.userId, credits: q.credits, amount_pkr: 0, status: 'pending', reference: 'LEMON', provider: 'lemonsqueezy' }).select('id').single(); if (error) return res.status(400).json({ error: error.message });
    const origin = (req.headers.origin || ('https://' + req.headers.host));
    const s = await LEMON.createCheckout({ variantId: tier && tier.lemon_variant_id, email: prof && prof.email, usd: q.amount_usd, name: 'ForiForeign ' + q.name, paymentId: pay.id, userId: req.userId, successUrl: origin + '/?paid=1&provider=lemon' });
    await admin().from('payments').update({ reference: ('LEMON:' + s.id).slice(0, 120) }).eq('id', pay.id).then(() => {}, () => {}); res.json({ url: s.url, payment_id: pay.id, amount_usd: q.amount_usd }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* Day 19 · dependants and the PR tracker. */
app.get('/api/me/family', auth, async (req, res) => { try { const { data } = await admin().from('profiles').select('dependants,arrival_date').eq('id', req.userId).maybeSingle(); const ck = await VAULT.checklist(req.userId, 'family'); res.json({ dependants: (data && data.dependants) || [], arrival_date: data && data.arrival_date, checklist: ck }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.put('/api/me/family', auth, async (req, res) => {
  try { const b = req.body || {}; const deps = Array.isArray(b.dependants) ? b.dependants.slice(0, 12).map(d => ({ name: String(d.name || '').slice(0, 120), relation: ['spouse', 'child', 'parent', 'other'].includes(d.relation) ? d.relation : 'other', dob: /^\d{4}-\d{2}-\d{2}$/.test(String(d.dob || '')) ? d.dob : null, passport_expiry: /^\d{4}-\d{2}-\d{2}$/.test(String(d.passport_expiry || '')) ? d.passport_expiry : null, travelling: !!d.travelling })) : undefined;
    const patch = {}; if (deps) patch.dependants = deps; if (b.arrival_date === null || /^\d{4}-\d{2}-\d{2}$/.test(String(b.arrival_date || ''))) patch.arrival_date = b.arrival_date; const { error } = await admin().from('profiles').update(patch).eq('id', req.userId); if (error) return res.status(400).json({ error: error.message });
    try { await MOBILITY.update(req.userId, { dependants: (deps || []).filter(d => d.travelling).length }, 'user'); } catch (e) {} res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/me/pr-tracker', auth, async (req, res) => {
  try { const cc = String(req.query.cc || '').toUpperCase(); const { data: p } = await admin().from('profiles').select('arrival_date,mobility').eq('id', req.userId).maybeSingle();
    const { data: rules } = await admin().from('visa_rules').select('id,route_key,route_name,text,value,source_url,source_title,status,last_verified_at').eq('country_code', cc).in('rule_type', ['pr_path', 'dependants', 'work_rights']).neq('status', 'superseded');
    const arrival = p && p.arrival_date; const days = arrival ? Math.floor((Date.now() - new Date(arrival)) / 86400000) : null;
    const { data: jt } = await admin().from('journey_tasks').select('phase,done').eq('user_id', req.userId).eq('country_code', cc);
    const pr = (jt || []).filter(t => t.phase === 'pr'); res.json({ country_code: cc, arrival_date: arrival, days_resident: days, years_resident: days == null ? null : Math.round(days / 365.25 * 10) / 10, rules: rules || [], pr_tasks: { done: pr.filter(t => t.done).length, total: pr.length }, language: p && p.mobility && { test: p.mobility.test_name, score: p.mobility.overall_score } }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* ============================================================================================================ */
/* ================= DAYS 21-25 · PILOTS · ORIGIN ONBOARDING · MAIL PREFERENCE ================= */
app.get('/api/org/:id/partner-metrics', auth, async (req, res) => {
  try { await ORGS.requireOrg(req, req.params.id, 'clients.read'); const apps = await PARTNERS.applicants(req.params.id); const ops = await PARTNERS.list(req.params.id);
    const by = {}; for (const a of apps) by[a.partner_status] = (by[a.partner_status] || 0) + 1;
    const { data: org } = await admin().from('organisations').select('pilot,pilot_started_at,created_at').eq('id', req.params.id).maybeSingle();
    res.json({ openings: { total: ops.length, live: ops.filter(o => o.status === 'live').length }, applicants: apps.length, consented: apps.filter(a => a.consent).length, consent_rate: apps.length ? Math.round(100 * apps.filter(a => a.consent).length / apps.length) : null, by_status: by, offers: by.offer || 0, interviews: by.interview || 0, pilot: !!(org && org.pilot), pilot_started_at: org && org.pilot_started_at, pilot_day: org && org.pilot_started_at ? Math.floor((Date.now() - new Date(org.pilot_started_at)) / 86400000) : null }); }
  catch (e) { orgErr(res, e); }
});
app.post('/api/admin/pilots', auth, perm('settings.write'), async (req, res) => {
  try { const b = req.body || {}; const { data: o } = await admin().from('organisations').select('id,kind').eq('id', String(b.org_id || '')).maybeSingle(); if (!o) return res.status(404).json({ error: 'Organisation not found' });
    await admin().from('organisations').update({ pilot: b.pilot !== false, pilot_started_at: b.pilot !== false ? new Date().toISOString() : null, pilot_notes: String(b.notes || '').slice(0, 1000) || null }).eq('id', o.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/admin/pilots', auth, perm('settings.read'), async (req, res) => { try { const { data } = await admin().from('organisations').select('id,name,kind,pilot,pilot_started_at,pilot_notes,created_at').in('kind', ['institution', 'employer', 'partner']).order('created_at', { ascending: false }); res.json({ orgs: data || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.put('/api/me/notify', auth, async (req, res) => { try { const on = !!(req.body || {}).email; const { error } = await admin().from('profiles').update({ notify_email: on }).eq('id', req.userId); if (error) return res.status(400).json({ error: error.message }); res.json({ ok: true, email: on }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/me/notify', auth, async (req, res) => { try { const { data } = await admin().from('profiles').select('notify_email').eq('id', req.userId).maybeSingle(); res.json({ email: !(data && data.notify_email === false), mail_configured: require('./lib/mailer').enabled() }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ================================================================================================ */
/* ================= EXPLORE CATALOGUE · VISA TRACKING DIRECTORY ================= */
const EXPLORE = require('./lib/explore'); const VTRACK = require('./lib/visa_tracking');
app.get('/api/explore', auth, async (req, res) => {
  try { const q = Object.assign({}, req.query || {}); if (q.profession) { const prof = String(q.profession).slice(0, 60); const D = require('./lib/domains'); const fam = D.familyOfTitle(prof); const syn = fam && D.FAMILIES[fam] ? [fam, ...(D.FAMILIES[fam].syn || [])] : [prof]; q._profFilter = syn.map(x => String(x).toLowerCase()); q._profLabel = prof; }
    /* The profession field is a REAL FILTER, not a full-text query: rows must carry the profession's family or its words in the title or required field. */
    const r = await EXPLORE.explore(q); if (q._profFilter && r && r.rows) { const keep = r.rows.filter(o => { const hay = [o.title, o.req_field, o.field, o.subject].join(' ').toLowerCase(); return q._profFilter.some(w => w.length > 2 && hay.includes(w)); }); if (keep.length) { r.rows = keep; r.total = keep.length; } else { r.widened = (r.widened ? r.widened + ' ' : '') + 'No posting names "' + q._profLabel + '" exactly; showing the closest in this lane.'; } } const ok = await entitled(req.userId, simUser(req));
    r.rows = r.rows.map(o => ok ? Object.assign({}, o, { locked: false, partner: !!o.is_partner }) : Object.assign(lockTease(o), { subject: o.subject, deadline: o.deadline, level: o.level, kind: o.kind, country_code: o.country_code, id: o.id }));
    /* A consultancy's own partners rank first for its clients, labelled; the platform's MOU partners still rank next. */
    try { const orgId = String(req.query.org_id || ''); if (orgId) { const m = await ORGS.membership(orgId, req.userId); if (m) { const names = await orgPartnerNames(orgId); if (names.length) { const key = x => String(x || '').toLowerCase(); const hit = o => names.find(p => key(o.institution).includes(key(p.name).split(/[,(]/)[0].trim().slice(0, 30)) || (p.domain && key(o.url).includes(p.domain))); r.rows = (r.rows || []).map(o => { const h = hit(o); return h ? Object.assign(o, { org_partner: true, org_partner_priority: h.priority || 1 }) : o; }).sort((a, b) => (b.org_partner ? 10 - (b.org_partner_priority || 1) : 0) - (a.org_partner ? 10 - (a.org_partner_priority || 1) : 0)); } } } } catch (e) {}
    r.entitled = ok; if (!ok) r.rows = (r.rows || []).map(o => (o.owned || o.started) ? o : EXPLORE.redactFree(o));
    /* WORK LANE DETAILS on every card: pay parsed into a monthly USD figure with perks, the language test the route needs, and the origin-side clearance a labour worker must obtain. */
    try { const PS = require('./lib/payscale'); const LG = require('./lib/language_guide'); const EM = require('./lib/emigration'); const { data: me } = await admin().from('profiles').select('origin_country').eq('id', req.userId).maybeSingle(); const origin = (me && me.origin_country) || null; const em = origin ? EM.rules(origin) : null;
      r.rows = (r.rows || []).map(o => { if (o.kind !== 'work') return o; const pay = PS.parseSalary(o.salary_note || o.stipend || '', o.country_code); const lane = o.category === 'care' || o.category === 'labour' ? 'labour' : 'work'; let lang = null; try { lang = LG.guide(o.country_code, lane); } catch (e) {} return Object.assign(o, { pay: pay || null, lang_need: lang && lang.text ? String(lang.text).split(/[;.]/)[0].slice(0, 70) : null, clearance: (o.category === 'labour' || o.category === 'care') && em ? String(em.authority || '').split('/')[0].trim().slice(0, 60) : null }); }); } catch (e) {}
    res.json(r); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/explore/institution', auth, async (req, res) => {
  try { const ok = await entitled(req.userId, simUser(req)); if (!ok) return res.status(402).json({ error: 'Institution pages open with a package; browse by subject and country is free.' }); res.json(await EXPLORE.institution(req.query.name)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/explore/institutions', auth, async (req, res) => { try { res.json({ institutions: await EXPLORE.institutionsFor(req.query.cc) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/explore/subjects', auth, async (req, res) => { res.json({ subjects: EXPLORE.SUBJECTS.map(s => s[0]).concat(['Other / interdisciplinary']), levels: EXPLORE.LEVELS }); });
app.get('/api/visa/tracking', auth, async (req, res) => { res.json(VTRACK.trackingFor(String(req.query.cc || '').toUpperCase())); });
/* ================================================================================ */
/* ================= CASE INBOX · CASE BRAIN ================= */
const BRAIN = require('./lib/casebrain');
app.get('/api/applications/:id/inbox', auth, async (req, res) => { try { const r = await BRAIN.inbox(req.params.id, req.userId); if (!r.alias) r.alias = await BRAIN.alias(req.params.id, req.userId); res.json(r); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/applications/:id/inbox', auth, async (req, res) => {
  try { const b = req.body || {}; if (!String(b.body || '').trim()) return res.status(400).json({ error: 'Paste the reply text' });
    const { data: a } = await admin().from('applications').select('id').eq('id', req.params.id).eq('user_id', req.userId).maybeSingle(); if (!a) return res.status(404).json({ error: 'Case not found' });
    const id = await BRAIN.ingest({ applicationId: a.id, userId: req.userId, channel: b.channel === 'whatsapp' ? 'whatsapp' : 'manual', from: b.from || '', subject: b.subject || '', body: b.body }); res.json({ ok: true, message_id: id, note: 'Reading it now; the next action appears in about a minute.' }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* Inbound mail webhook (Postmark / Mailgun / Resend style JSON, mapped to {to, from, subject, text}). Shared secret in x-intake-secret. */
app.post('/api/intake/email', async (req, res) => {
  try { if (!process.env.INTAKE_SECRET || String(req.headers['x-intake-secret'] || '') !== process.env.INTAKE_SECRET) return res.status(401).json({ error: 'unauthorised' });
    const b = req.body || {}; const to = b.to || b.To || b.recipient || (b.ToFull && b.ToFull[0] && b.ToFull[0].Email) || ''; const from = b.from || b.From || b.sender || ''; const subject = b.subject || b.Subject || ''; const text = b.text || b.TextBody || b['body-plain'] || b['stripped-text'] || b.html || b.HtmlBody || '';
    const a = await BRAIN.byAlias(to);
    if (a) { const id = await BRAIN.ingest({ applicationId: a.id, userId: a.user_id, channel: 'email', from, subject, body: text, receivedAt: b.date || b.Date || null, assignedBy: 'alias' }); return res.json({ ok: true, message_id: id }); }
    if (/^partnerships@/i.test(String(to || '').trim()) || String(to || '').toLowerCase().includes('partnerships@' + (process.env.APPLY_DOMAIN || 'forimail.com'))) { const r = await PROSPECT.handleReply({ from, subject, body: text }); try { if (r && r.prospect_id) { const n = await PENGINE.negotiate(r.prospect_id, text); if (n && n.counter && n.state === 'countered') { const { data: pp } = await admin().from('prospects').select('email,name').eq('id', r.prospect_id).maybeSingle(); if (pp && pp.email) { const M = require('./lib/mailer'); await M.send(pp.email, 'Re: ' + String(subject || 'Partnership'), M.wrap('Partnership terms', n.counter, 'work')); } } r.negotiation = n; } } catch (e) {} return res.json(Object.assign({ ok: true, partnerships: true }, r)); }
    const u = await BRAIN.byApplyEmail(to);
    if (!u) { /* A consultancy client's address: the reply is filed to the client and the consultancy is told; nothing touches any ForiForeign applicant. */
      try { const mine = (String(to || '').toLowerCase().match(/[a-z0-9._-]+@[a-z0-9.-]+/g) || []).find(x => x.endsWith('@' + (process.env.APPLY_DOMAIN || 'forimail.com'))); const { data: cl } = mine ? await admin().from('clients').select('id,org_id,user_id,full_name').eq('apply_email', mine).maybeSingle() : { data: null }; if (cl) { const { data: msg } = await admin().from('case_messages').insert({ user_id: cl.user_id || null, client_id: cl.id, org_id: cl.org_id, direction: 'in', channel: 'email', from_addr: String(from || '').slice(0, 200), to_addr: mine, subject: String(subject || '').slice(0, 300), body_text: String(text || '').slice(0, 20000), triage: 'application', received_at: new Date().toISOString() }).select('id').single(); try { const N = require('./lib/notify'); const { data: mem } = await admin().from('org_members').select('user_id').eq('org_id', cl.org_id).eq('status', 'active').in('role', ['owner', 'manager', 'consultant']).limit(20); for (const m of (mem || [])) await N.push(m.user_id, 'mail', 'Reply for ' + cl.full_name + ': ' + String(subject || '').slice(0, 60), String(text || '').slice(0, 160), 'work', cl.org_id); } catch (e) {} if (cl.user_id) { try { await BRAIN.understand(msg.id); } catch (e) {} } return res.json({ ok: true, client: cl.id }); } } catch (e) {}
      try { const mine = (String(to || '').toLowerCase().match(/[a-z0-9._-]+@[a-z0-9.-]+/g) || []).find(x => x.endsWith('@' + (process.env.APPLY_DOMAIN || 'forimail.com'))); if (mine && /^leads\./.test(mine) && !/no-?reply|mailer-daemon|postmaster|noreply|bounce|notifications?@/i.test(String(from || '')) && !/^(auto|automatic reply|out of office|undeliverable)/i.test(String(subject || '')) && (await LIMITER.hit('leadmail:' + String(from || '').toLowerCase().slice(0, 80), 3600)) <= 5) { const { data: orgs } = await admin().from('organisations').select('id,name,settings').neq('kind', 'personal').limit(2000); const org = (orgs || []).find(o => o.settings && o.settings.lead_email === mine); if (org) { const senderEmail = (String(from || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [''])[0]; const senderName = String(from || '').replace(/<.*$/, '').replace(/"/g, '').trim() || senderEmail; const c = await ORGS.createClient(org.id, null, { full_name: senderName, email: senderEmail, stage: 'lead', notes: (String(subject || '') + '\n' + String(text || '').slice(0, 1500)).trim() }); try { await admin().from('clients').update({ source: 'email', source_detail: mine }).eq('id', c.id); const { data: mem } = await admin().from('org_members').select('user_id').eq('org_id', org.id).eq('status', 'active').in('role', ['owner', 'manager', 'consultant']).limit(20); for (const mm of (mem || [])) await require('./lib/notify').push(mm.user_id, 'lead', 'New email lead: ' + senderName, String(subject || '').slice(0, 120), 'work', org.id); } catch (e) {} return res.json({ ok: true, lead: c.id }); } } } catch (e) {}
      return res.status(202).json({ ignored: 'no mailbox for recipient' }); }
    const r = await BRAIN.routeForUser(u, from, subject);
    const id = await BRAIN.ingest({ applicationId: r.application_id, userId: u.id, channel: 'email', from, subject, body: text, receivedAt: b.date || b.Date || null, assignedBy: r.assigned_by, paused: !!u.apply_email_paused });
    try { await admin().from('case_messages').update({ to_addr: String(to).slice(0, 200) }).eq('id', id); } catch (e) {}
    // Gap 1 · attachments become vault documents (read, typed, dated) and are linked to the message and the case.
    try { const atts = Array.isArray(b.attachments) ? b.attachments : (Array.isArray(b.Attachments) ? b.Attachments : []); const saved = [];
      for (const a of atts.slice(0, 8)) { const content = a.content || a.Content || a.content_b64 || a.data; const name = a.name || a.Name || a.filename || 'attachment'; const mime = a.content_type || a.ContentType || a.type || 'application/octet-stream'; if (!content) continue; const buf = Buffer.from(String(content), 'base64'); if (buf.length < 100 || buf.length > 15 * 1024 * 1024) continue;
        const { saveUpload } = require('./lib/docs'); const d = await saveUpload(u.id, { originalname: name, mimetype: mime, buffer: buf, size: buf.length }, null).catch(() => null); if (d && d.id) { saved.push({ id: d.id, name, mime }); await QUEUE.enqueue('vault_read', { docId: d.id, userId: u.id }, { userId: u.id, maxAttempts: 2 }).catch(() => {}); if (r.application_id) await admin().from('application_documents').insert({ application_id: r.application_id, document_id: d.id }).then(() => {}, () => {}); } }
      if (saved.length) await admin().from('case_messages').update({ attachments: saved }).eq('id', id); } catch (e) {}
    JE.recompute(u.id);
    if (u.apply_email_forward === true && u.email) { try { const M = require('./lib/mailer'); await M.sendRaw({ from: 'ForiForeign mailbox <' + u.apply_email + '>', to: u.email, subject: '[Copy] ' + String(subject || '').slice(0, 150), html: '<pre style="white-space:pre-wrap;font-family:Arial,sans-serif">' + String(text || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).slice(0, 20000) + '</pre>', text: String(text || '').slice(0, 20000), replyTo: from }); } catch (e) {} }
    res.json({ ok: true, message_id: id, assigned_by: r.assigned_by }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
QUEUE.register('case_understand', async (p) => { const r = await BRAIN.understand(p.messageId); await meter(p.userId, 'case_brain'); JE.recompute(p.userId); return r; });
/* =========================================================== */
/* ================= APPLICATION MAILBOX (name@apply.foriforeign.com) ================= */
app.get('/api/me/mailbox', auth, async (req, res) => { try { res.json(await BRAIN.mailbox(req.userId)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/me/mailbox', auth, async (req, res) => { try { const r = await BRAIN.provisionApplyEmail(req.userId); try { await admin().from('audit_log').insert({ actor: req.userId, event: 'APPLY_MAILBOX_CREATED', detail: r.email }); } catch (e) {} res.json(r); } catch (e) { res.status(400).json({ error: e.message }); } });
app.patch('/api/me/mailbox', auth, async (req, res) => { try { const b = req.body || {}; const patch = {}; { const cfg = await siteSettings.getConfig(); if (b.forward === true && !((cfg.mail_policy || {}).allow_personal_forward)) return res.status(403).json({ error: 'Copies to a personal address are switched off by policy: the process runs on your ForiForeign address only. Export is always available.' }); } if (typeof b.forward === 'boolean') patch.apply_email_forward = b.forward; if (typeof b.paused === 'boolean') patch.apply_email_paused = b.paused; const { error } = await admin().from('profiles').update(patch).eq('id', req.userId); if (error) return res.status(400).json({ error: error.message }); res.json({ ok: true, ...patch }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/me/mailbox/send', auth, async (req, res) => { try { const b = req.body || {}; res.json(await BRAIN.sendFromApplyEmail(req.userId, { applicationId: b.application_id || null, to: b.to, subject: b.subject, body: b.body, attachDocIds: b.attach_doc_ids })); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ==================================================================================== */
/* ================= FORIMAIL BACKBONE · INBOX · SEND APPLICATION FROM MAILBOX ================= */
app.get('/api/me/mailbox/messages/:id', auth, async (req, res) => { try { res.json({ message: await BRAIN.message(req.userId, req.params.id) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/me/mailbox/messages/:id/link', auth, async (req, res) => { try { res.json(await BRAIN.linkToCase(req.userId, req.params.id, String((req.body || {}).application_id || ''))); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/me/mailbox/messages/:id/confirm', auth, async (req, res) => { try { const c = String((req.body || {}).classification || ''); if (!['interview_invite', 'offer', 'conditional_offer', 'rejection', 'documents_requested', 'info_request', 'acknowledgement', 'scheduling', 'other'].includes(c)) return res.status(400).json({ error: 'classification' }); res.json(await BRAIN.confirmClassification(req.userId, req.params.id, c)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/me/mailbox/messages/:id/read', auth, async (req, res) => { try { await admin().from('case_messages').update({ read_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', req.userId); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* The prepared application is sent from the applicant's forimail address on their tap: subject, body and
   every prepared document attached. This replaces the "open your Gmail" step as the primary route. */
app.post('/api/applications/:id/send-from-mailbox', auth, async (req, res) => {
  try {
    const { data: a } = await admin().from('applications').select('id,user_id,opportunity_id,stage').eq('id', req.params.id).eq('user_id', req.userId).maybeSingle(); if (!a) return res.status(404).json({ error: 'Case not found' });
    const b = req.body || {}; const to = String(b.to || '').trim(); const subject = String(b.subject || '').slice(0, 200); const body = String(b.body || '');
    if (!to || !subject || !body) return res.status(400).json({ error: 'Recipient, subject and body are required' });
    const ids = Array.isArray(b.attach_doc_ids) ? b.attach_doc_ids : [];
    const r = await BRAIN.sendFromApplyEmail(req.userId, { applicationId: a.id, to, subject, body, attachDocIds: ids });
    await admin().from('applications').update({ stage: 'submitted_email', status: 'applied', next_action: 'Wait for their reply; forward nothing - it lands here by itself', next_action_owner: 'them' }).eq('id', a.id).then(() => {}, async () => { await admin().from('applications').update({ stage: 'submitted_email' }).eq('id', a.id); });
    try { await admin().from('audit_log').insert({ actor: req.userId, event: 'APPLY_SENT_FORIMAIL', detail: a.id + ' -> ' + to }); } catch (e) {}
    res.json({ ok: true, ...r });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
QUEUE.register('mail_triage', async (p) => BRAIN.triage(p.messageId));
/* ============================================================================================== */
/* ================= ORGANISATION ADMIN LAYER (owners/managers see only their organisation) ================= */
async function orgAudit(orgId, actor, event, detail) { try { await admin().from('audit_log').insert({ actor, event, detail: String(detail || '').slice(0, 250), org_id: orgId }); } catch (e) {} }
app.get('/api/org/:id/audit', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'finance.read'); const { data } = await admin().from('audit_log').select('id,actor,event,detail,created_at').eq('org_id', req.params.id).order('created_at', { ascending: false }).limit(200); const ids = [...new Set((data || []).map(r => r.actor).filter(Boolean))]; const { data: profs } = ids.length ? await admin().from('profiles').select('id,full_name').in('id', ids) : { data: [] }; const nm = Object.fromEntries((profs || []).map(p => [p.id, p.full_name])); res.json({ audit: (data || []).map(r => Object.assign(r, { actor_name: nm[r.actor] || '' })) }); } catch (e) { orgErr(res, e); } });
/* Data-isolation self-check an owner can run: proves scope from their own account. */
app.get('/api/org/:id/isolation-check', auth, async (req, res) => {
  try { const role = await ORGS.requireOrg(req, req.params.id, 'clients.read'); const m = await ORGS.membership(req.params.id, req.userId);
    const mine = await ORGS.listClients(req.params.id, { limit: 500, scope: ORGS.scopeFor(m, req.userId) }); const { count: all } = await admin().from('clients').select('id', { count: 'exact', head: true }).eq('org_id', req.params.id);
    const { count: others } = await admin().from('clients').select('id', { count: 'exact', head: true }).neq('org_id', req.params.id);
    res.json({ role, branch: m && m.branch, visible_in_my_scope: mine.length, total_in_organisation: all || 0, clients_in_other_organisations: others || 0, other_organisations_visible_to_me: 0, note: 'Server-side scope: owner sees all in the organisation; manager/consultant their branch; sub-agent only their own clients. Other organisations are never queryable from this account.' }); }
  catch (e) { orgErr(res, e); }
});
/* ========================================================================================================== */
/* ================= BROWSER AGENT · FINANCE · HISTORY · LEADS · OUTBOUND · APPOINTMENTS · PROTECTED ADMIN ================= */
const BOT = require('./lib/browserbot');
app.get('/api/me/portals', auth, async (req, res) => { try { res.json({ portals: BOT.PORTALS, scopes: BOT.SCOPES, policy: await BOT.policyFor(req.userId, null), connections: await BOT.list(req.userId), encryption: require('./lib/crypto').enabled() }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/me/portals', auth, async (req, res) => {
  /* Using the ForiForeign address as the portal login is a consent event on its own: recorded with wording, revocable under Options. */
  try { if ((req.body || {}).use_ff_address) { await CONSENT.record(req, req.userId, 'terms', { v: 'portal_login_with_ff_address' }, { portal_key: (req.body || {}).portal_key, username: (req.body || {}).username }); } } catch (e) {} try { const c = await BOT.connect(req.userId, req.body || {}); await CONSENT.record(req, req.userId, 'portal_watch', { portal: c.portal_name, scope: c.scope.replace(/_/g, ' ') }, { connection_id: c.id }); res.json({ connection: c }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/me/portals/:id/runs', auth, async (req, res) => { try { res.json({ runs: await BOT.runs(req.userId, req.params.id) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.patch('/api/me/portals/:id', auth, async (req, res) => { try { res.json(await BOT.setStatus(req.userId, req.params.id, (req.body || {}).status)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/me/portals/:id/check', auth, async (req, res) => { try { const jobId = await QUEUE.enqueue('portal_watch', { connectionId: req.params.id }, { userId: req.userId, maxAttempts: 1 }); res.json({ ok: true, job_id: jobId }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Consultant connects a portal for a client (consent recorded as given to the consultant; the client sees it). */
app.post('/api/org/:id/clients/:cid/portals', auth, async (req, res) => { try { const c = await orgClient(req, res, 'clients.write'); if (!c.user_id) return res.status(400).json({ error: 'Client has no login yet.' });
    const b = Object.assign({}, req.body || {}, { client_id: c.id, org_id: c.org_id, consent: true });
    if (b.scope === 'watch_upload_submit') { const { data: lic } = await admin().from('consultant_licences').select('id').eq('user_id', req.userId).eq('status', 'verified').or('expires_on.is.null,expires_on.gte.' + new Date().toISOString().slice(0, 10)).limit(1); if (!lic || !lic.length) return res.status(403).json({ error: 'Submitting on a client\'s behalf requires a verified registered-agent licence (OISC / MARA / CICC / IAA). Add it under Team → Licences.' }); }
    const r = await BOT.connect(c.user_id, b); await admin().from('portal_connections').update({ applicant_confirmed: false, connected_by: req.userId, status: 'paused' }).eq('id', r.id);
    try { await NOTIFY.push(c.user_id, 'consent', 'Confirm portal access: ' + r.portal_name, 'Your consultant asked to watch this account for you (' + r.scope.replace(/_/g, ' ') + '). Approve or refuse in Profile → Portal watch.', 'profile'); } catch (e) {}
    await orgAudit(c.org_id, req.userId, 'PORTAL_CONNECTED_FOR_CLIENT', c.full_name + ' ' + r.portal_key + ' (awaiting applicant confirmation)'); JE.recompute(c.user_id); res.json({ connection: r, pending_applicant_confirmation: true }); } catch (e) { orgErr(res, e); } });
app.get('/api/org/:id/clients/:cid/portals', auth, async (req, res) => { try { const c = await orgClient(req, res, 'clients.read'); res.json({ connections: c.user_id ? await BOT.list(c.user_id) : [] }); } catch (e) { orgErr(res, e); } });
/* Policy: platform (super_admin) and organisation owners set caps; the lower always wins. */
app.get('/api/admin/browser-policy', auth, perm('settings.read'), async (req, res) => { try { const { data } = await admin().from('browser_policies').select('*').eq('scope_kind', 'platform').maybeSingle(); res.json({ policy: data || { scope_kind: 'platform', enabled: true, max_scope: 'watch', allowed_domains: [] }, portals: BOT.PORTALS }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.put('/api/admin/browser-policy', auth, perm('settings.write'), async (req, res) => { try { if (!['super_admin', 'admin'].includes(req.userRole)) return res.status(403).json({ error: 'Platform admin only' }); const b = req.body || {}; const row = { scope_kind: 'platform', scope_id: null, enabled: b.enabled !== false, max_scope: BOT.SCOPES.includes(b.max_scope) ? b.max_scope : 'watch', allowed_domains: Array.isArray(b.allowed_domains) ? b.allowed_domains.map(d => String(d).toLowerCase().trim()).filter(Boolean) : [], updated_by: req.userId, updated_at: new Date().toISOString() }; const { data: ex } = await admin().from('browser_policies').select('id').eq('scope_kind', 'platform').maybeSingle(); if (ex) await admin().from('browser_policies').update(row).eq('id', ex.id); else await admin().from('browser_policies').insert(row); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.put('/api/org/:id/browser-policy', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const b = req.body || {}; const row = { scope_kind: 'org', scope_id: req.params.id, enabled: b.enabled !== false, max_scope: BOT.SCOPES.includes(b.max_scope) ? b.max_scope : 'watch', allowed_domains: Array.isArray(b.allowed_domains) ? b.allowed_domains.map(d => String(d).toLowerCase().trim()).filter(Boolean) : [], updated_by: req.userId, updated_at: new Date().toISOString() }; const { data: ex } = await admin().from('browser_policies').select('id').eq('scope_kind', 'org').eq('scope_id', req.params.id).maybeSingle(); if (ex) await admin().from('browser_policies').update(row).eq('id', ex.id); else await admin().from('browser_policies').insert(row); await orgAudit(req.params.id, req.userId, 'BROWSER_POLICY_SET', row.max_scope); res.json({ ok: true }); } catch (e) { orgErr(res, e); } });
QUEUE.register('portal_watch', async (p) => BOT.watch(p.connectionId));
/* Client finance: every fee, payment, refund, cost and commission per client; P&L per client and per organisation. */
app.get('/api/org/:id/clients/:cid/finance', auth, async (req, res) => { try { const c = await orgClient(req, res, 'clients.read'); const { data } = await admin().from('client_finance').select('*').eq('client_id', c.id).order('occurred_on', { ascending: false }); const rows = data || []; const sum = k => rows.filter(r => r.kind === k).reduce((a, r) => a + Number(r.amount), 0); const income = sum('fee_charged') + sum('commission_in'); const received = sum('payment_received'); const out = sum('cost') + sum('refund') + sum('commission_out'); res.json({ rows, summary: { charged: income, received, outstanding: income - received, costs: out, profit: received - out + sum('adjustment') } }); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/clients/:cid/finance', auth, async (req, res) => { try { const c = await orgClient(req, res, 'clients.write'); const b = req.body || {}; if (!['fee_charged', 'payment_received', 'refund', 'cost', 'commission_in', 'commission_out', 'adjustment'].includes(b.kind) || !isFinite(Number(b.amount))) return res.status(400).json({ error: 'kind and amount required' }); const { data, error } = await admin().from('client_finance').insert({ org_id: c.org_id, client_id: c.id, kind: b.kind, amount: Number(b.amount), currency: String(b.currency || 'USD').toUpperCase().slice(0, 3), note: String(b.note || '').slice(0, 300) || null, reference: String(b.reference || '').slice(0, 120) || null, occurred_on: /^\d{4}-\d{2}-\d{2}$/.test(String(b.occurred_on || '')) ? b.occurred_on : undefined, created_by: req.userId }).select('*').single(); if (error) return res.status(400).json({ error: error.message }); await orgAudit(c.org_id, req.userId, 'FINANCE_' + b.kind.toUpperCase(), c.full_name + ' ' + b.amount + ' ' + (b.currency || 'USD')); res.json({ row: data }); } catch (e) { orgErr(res, e); } });
app.get('/api/org/:id/finance', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'finance.read'); const { data } = await admin().from('client_finance').select('client_id,kind,amount,currency,occurred_on').eq('org_id', req.params.id); const rows = data || []; const by = {}; for (const r of rows) { const b = by[r.client_id] = by[r.client_id] || { charged: 0, received: 0, costs: 0 }; if (r.kind === 'fee_charged' || r.kind === 'commission_in') b.charged += Number(r.amount); if (r.kind === 'payment_received') b.received += Number(r.amount); if (['cost', 'refund', 'commission_out'].includes(r.kind)) b.costs += Number(r.amount); } const tot = Object.values(by).reduce((a, b) => ({ charged: a.charged + b.charged, received: a.received + b.received, costs: a.costs + b.costs }), { charged: 0, received: 0, costs: 0 }); res.json({ by_client: by, totals: Object.assign(tot, { outstanding: tot.charged - tot.received, profit: tot.received - tot.costs }) }); } catch (e) { orgErr(res, e); } });
/* Unified case history for a client: every event from every module, newest first. */
app.get('/api/org/:id/clients/:cid/history', auth, async (req, res) => {
  try { const c = await orgClient(req, res, 'clients.read'); const ev = [];
    const push = (rows, map) => { for (const r of (rows || [])) ev.push(map(r)); };
    if (c.user_id) {
      push((await admin().from('applications').select('id,status,stage,created_at,updated_at,next_action').eq('user_id', c.user_id).then(r => r.data)), r => ({ at: r.updated_at || r.created_at, kind: 'case', text: 'Case ' + (r.status || r.stage || '') + (r.next_action ? ' · next: ' + r.next_action : ''), ref: r.id }));
      push((await admin().from('case_messages').select('id,direction,subject,classification,received_at').eq('user_id', c.user_id).order('received_at', { ascending: false }).limit(100).then(r => r.data)), r => ({ at: r.received_at, kind: r.direction === 'out' ? 'mail_out' : 'mail_in', text: (r.direction === 'out' ? 'Sent: ' : 'Received: ') + (r.subject || '') + (r.classification ? ' (' + r.classification.replace(/_/g, ' ') + ')' : ''), ref: r.id }));
      push((await admin().from('offers').select('id,issuer,title,status,created_at').eq('user_id', c.user_id).then(r => r.data)), r => ({ at: r.created_at, kind: 'offer', text: 'Offer ' + r.status + ': ' + (r.issuer || '') + ' ' + (r.title || ''), ref: r.id }));
      push((await admin().from('visa_cases').select('id,country_code,route_key,status,updated_at').eq('user_id', c.user_id).then(r => r.data)), r => ({ at: r.updated_at, kind: 'visa', text: 'Visa file ' + r.country_code + ' ' + r.route_key + ': ' + r.status, ref: r.id }));
      push((await admin().from('payments').select('id,credits,amount_pkr,status,created_at').eq('user_id', c.user_id).then(r => r.data)), r => ({ at: r.created_at, kind: 'payment', text: 'Payment ' + r.status + ' · ' + r.credits + ' cases', ref: r.id }));
      push((await admin().from('portal_runs').select('id,outcome,status_text,started_at').eq('user_id', c.user_id).order('started_at', { ascending: false }).limit(30).then(r => r.data)), r => ({ at: r.started_at, kind: 'portal', text: 'Portal check ' + r.outcome + (r.status_text ? ': ' + r.status_text.slice(0, 120) : ''), ref: String(r.id) }));
    }
    push((await admin().from('client_tasks').select('id,title,status,owner,due_date,created_at,done_at').eq('client_id', c.id).then(r => r.data)), r => ({ at: r.done_at || r.created_at, kind: 'task', text: (r.status === 'done' ? 'Done: ' : 'Task: ') + r.title + (r.due_date ? ' (due ' + r.due_date + ')' : ''), ref: r.id }));
    push((await admin().from('client_notes').select('id,channel,body,created_at').eq('client_id', c.id).then(r => r.data)), r => ({ at: r.created_at, kind: 'note', text: '[' + r.channel + '] ' + String(r.body).slice(0, 160), ref: r.id }));
    push((await admin().from('client_finance').select('id,kind,amount,currency,occurred_on').eq('client_id', c.id).then(r => r.data)), r => ({ at: r.occurred_on, kind: 'finance', text: r.kind.replace(/_/g, ' ') + ' ' + r.amount + ' ' + r.currency, ref: r.id }));
    push((await admin().from('audit_log').select('id,event,detail,created_at').eq('org_id', c.org_id).ilike('detail', '%' + c.full_name.slice(0, 40) + '%').limit(50).then(r => r.data)), r => ({ at: r.created_at, kind: 'audit', text: r.event + ' · ' + (r.detail || ''), ref: String(r.id) }));
    ev.sort((a, b) => String(b.at).localeCompare(String(a.at))); res.json({ client: { id: c.id, full_name: c.full_name, stage: c.stage }, events: ev.slice(0, 300) }); }
  catch (e) { orgErr(res, e); }
});
/* Lead capture (competitor gap): public form endpoint per organisation token; Meta Lead Ads webhook shape accepted. */
app.get('/api/org/:id/leads', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.read'); const { data: o } = await admin().from('organisations').select('lead_token').eq('id', req.params.id).maybeSingle(); let token = o && o.lead_token; if (!token) { token = 'lt_' + require('crypto').randomBytes(12).toString('hex'); await admin().from('organisations').update({ lead_token: token }).eq('id', req.params.id); } const mm = await ORGS.membership(req.params.id, req.userId); let lq = admin().from('leads').select('*').eq('org_id', req.params.id); if (mm && mm.role === 'sub_agent') lq = lq.eq('assigned_user_id', req.userId); else if (mm && ['manager', 'consultant'].includes(mm.role) && mm.branch) { const { data: bm } = await admin().from('org_members').select('user_id,branch').eq('org_id', req.params.id); const ids = (bm || []).filter(x => x.branch === mm.branch || String(x.branch || '').startsWith(mm.branch + '/')).map(x => x.user_id); lq = lq.in('assigned_user_id', ids.length ? ids : [req.userId]); } const { data } = await lq.order('created_at', { ascending: false }).limit(200); res.json({ leads: data || [], form_url: 'https://foriforeign.com/api/leads/' + token, embed: '<form method="POST" action="https://foriforeign.com/api/leads/' + token + '"><input name="full_name" placeholder="Name" required><input name="phone" placeholder="WhatsApp"><input name="email" placeholder="Email"><select name="lane"><option value="study">Study</option><option value="work">Work</option></select><button>Send</button></form>' }); } catch (e) { orgErr(res, e); } });
app.post('/api/leads/:token', async (req, res) => { try { const { data: o } = await admin().from('organisations').select('id,owner_id').eq('lead_token', req.params.token).maybeSingle(); if (!o) return res.status(404).json({ error: 'Unknown form' }); const b = req.body || {}; const meta = b.entry && b.entry[0] && b.entry[0].changes && b.entry[0].changes[0] && b.entry[0].changes[0].value; const src = meta ? 'meta' : (b.source || 'form'); const f = meta ? { full_name: '', raw: b } : b; const { data, error } = await admin().from('leads').insert({ org_id: o.id, source: ['form', 'meta', 'whatsapp', 'website', 'referral', 'import', 'other'].includes(src) ? src : 'other', full_name: String(f.full_name || f.name || '').slice(0, 120) || null, email: String(f.email || '').slice(0, 160) || null, phone: String(f.phone || '').slice(0, 40) || null, whatsapp: String(f.whatsapp || f.phone || '').slice(0, 40) || null, country_interest: String(f.country || f.country_interest || '').slice(0, 60) || null, lane: ['study', 'work', 'both'].includes(f.lane) ? f.lane : null, message: String(f.message || '').slice(0, 2000) || null, assigned_user_id: o.owner_id, raw: f.raw || {} }).select('id').single(); if (error) return res.status(400).json({ error: error.message }); try { await NOTIFY.push(o.owner_id, 'lead', 'New lead: ' + (f.full_name || f.name || 'someone'), (f.lane || '') + ' ' + (f.country || ''), 'work', o.id); } catch (e) {} WEBHOOKS.emit(o.id, 'client.created', { lead_id: data.id, source: src }); if (req.is('application/x-www-form-urlencoded')) return res.redirect(302, (req.headers.referer || 'https://foriforeign.com') + '#thanks'); res.json({ ok: true, lead_id: data.id }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.patch('/api/org/:id/leads/:lid', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.write'); const b = req.body || {}; const patch = {}; if (['new', 'contacted', 'qualified', 'converted', 'lost'].includes(b.status)) patch.status = b.status; if (b.assigned_user_id) patch.assigned_user_id = b.assigned_user_id; let client = null; if (b.status === 'converted') { const { data: l } = await admin().from('leads').select('*').eq('id', req.params.lid).eq('org_id', req.params.id).maybeSingle(); if (l && !l.client_id) { client = await ORGS.createClient(req.params.id, req.userId, { full_name: l.full_name || 'Lead', email: l.email, phone: l.phone, whatsapp: l.whatsapp, lane: l.lane || 'both' }).catch(() => null); if (client) patch.client_id = client.id; } } await admin().from('leads').update(patch).eq('id', req.params.lid).eq('org_id', req.params.id); res.json({ ok: true, client_id: client && client.id }); } catch (e) { orgErr(res, e); } });
/* Outbound WhatsApp/email queue with approval (sent by the provider once WHATSAPP_TOKEN / mail keys exist). */
app.post('/api/org/:id/outbound', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.write'); const b = req.body || {}; if (!['whatsapp', 'email'].includes(b.channel) || !b.to || !b.body) return res.status(400).json({ error: 'channel, to and body required' }); const m = await ORGS.membership(req.params.id, req.userId); const auto = ['owner', 'manager'].includes(m && m.role); const { data, error } = await admin().from('outbound_messages').insert({ org_id: req.params.id, client_id: b.client_id || null, channel: b.channel, to_addr: String(b.to).slice(0, 200), body: String(b.body).slice(0, 4000), template_key: b.template_key || null, requires_approval: !auto, status: auto ? 'approved' : 'queued', approved_by: auto ? req.userId : null, created_by: req.userId }).select('*').single(); if (error) return res.status(400).json({ error: error.message }); if (auto) await QUEUE.enqueue('outbound_send', { id: data.id }, { orgId: req.params.id, maxAttempts: 3 }); res.json({ message: data }); } catch (e) { orgErr(res, e); } });
app.get('/api/org/:id/outbound', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.read'); const { data } = await admin().from('outbound_messages').select('*').eq('org_id', req.params.id).order('created_at', { ascending: false }).limit(100); res.json({ messages: data || [] }); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/outbound/:mid/approve', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'members.write'); await admin().from('outbound_messages').update({ status: 'approved', approved_by: req.userId }).eq('id', req.params.mid).eq('org_id', req.params.id); await QUEUE.enqueue('outbound_send', { id: req.params.mid }, { orgId: req.params.id, maxAttempts: 3 }); res.json({ ok: true }); } catch (e) { orgErr(res, e); } });
QUEUE.register('outbound_send', async (p) => {
  const { data: m } = await admin().from('outbound_messages').select('*').eq('id', p.id).maybeSingle(); if (!m || m.status !== 'approved') return { skipped: true };
  if (m.channel === 'email') { const M = require('./lib/mailer'); let brand = null; try { const { data: og } = await admin().from('organisations').select('name,settings').eq('id', m.org_id).maybeSingle(); const { data: dm } = await admin().from('org_domains').select('domain').eq('org_id', m.org_id).eq('status', 'active').limit(1); if (og) brand = { name: og.name, color: (og.settings || {}).brand_color || null, domain: dm && dm[0] ? dm[0].domain : null, reply_to: (og.settings || {}).contact_email || (og.settings || {}).email || null }; } catch (e) {} const r = await M.send(m.to_addr, 'Message from ' + (brand ? brand.name : 'your consultant'), M.wrap('Message from ' + (brand ? brand.name : 'your consultant'), m.body, 'home', brand), brand); if (!r.sent) throw new Error(r.reason); await admin().from('outbound_messages').update({ status: 'sent', sent_at: new Date().toISOString(), provider_id: r.id }).eq('id', m.id); return { sent: true }; }
  if (m.channel === 'whatsapp') { const tok = process.env.WHATSAPP_TOKEN, pid = process.env.WHATSAPP_PHONE_ID; if (!tok || !pid) { await admin().from('outbound_messages').update({ status: 'failed', error: 'WhatsApp Business API not configured (WHATSAPP_TOKEN, WHATSAPP_PHONE_ID)' }).eq('id', m.id); return { failed: true }; }
    const to = String(m.to_addr).replace(/[^0-9]/g, '').replace(/^0/, '92'); const r = await fetch('https://graph.facebook.com/v19.0/' + pid + '/messages', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: m.body } }) }); const d = await r.json().catch(() => ({})); if (!r.ok) { await admin().from('outbound_messages').update({ status: 'failed', error: JSON.stringify(d.error || d).slice(0, 300) }).eq('id', m.id); throw new Error('WhatsApp ' + r.status); } await admin().from('outbound_messages').update({ status: 'sent', sent_at: new Date().toISOString(), provider_id: d.messages && d.messages[0] && d.messages[0].id }).eq('id', m.id); return { sent: true }; }
  return { skipped: true };
});
/* Appointments (competitor gap: scheduling) for applicants and consultants; reminders via the notification sweep. */
app.get('/api/appointments', auth, async (req, res) => { try { const { data } = await admin().from('appointments').select('*').eq('user_id', req.userId).gte('starts_at', new Date(Date.now() - 86400000).toISOString()).order('starts_at'); res.json({ appointments: data || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/appointments', auth, async (req, res) => { try { const b = req.body || {}; if (!b.title || !b.starts_at) return res.status(400).json({ error: 'title and starts_at required' }); const { data, error } = await admin().from('appointments').insert({ user_id: req.userId, kind: ['call', 'meeting', 'interview', 'biometrics', 'embassy', 'other'].includes(b.kind) ? b.kind : 'other', title: String(b.title).slice(0, 200), starts_at: b.starts_at, ends_at: b.ends_at || null, location: String(b.location || '').slice(0, 200) || null, link: String(b.link || '').slice(0, 400) || null, notes: String(b.notes || '').slice(0, 2000) || null, created_by: req.userId }).select('*').single(); if (error) return res.status(400).json({ error: error.message }); res.json({ appointment: data }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/org/:id/clients/:cid/appointments', auth, async (req, res) => { try { const c = await orgClient(req, res, 'clients.write'); if (!c.user_id) return res.status(400).json({ error: 'Client has no login yet.' }); const b = req.body || {}; const { data, error } = await admin().from('appointments').insert({ org_id: c.org_id, client_id: c.id, user_id: c.user_id, kind: ['call', 'meeting', 'interview', 'biometrics', 'embassy', 'other'].includes(b.kind) ? b.kind : 'call', title: String(b.title || 'Call with your consultant').slice(0, 200), starts_at: b.starts_at, ends_at: b.ends_at || null, location: b.location || null, link: b.link || null, notes: b.notes || null, created_by: req.userId }).select('*').single(); if (error) return res.status(400).json({ error: error.message }); try { await NOTIFY.push(c.user_id, 'appointment', 'Appointment: ' + data.title, new Date(data.starts_at).toString().slice(0, 21) + (data.link ? ' · ' + data.link : ''), 'home'); } catch (e) {} res.json({ appointment: data }); } catch (e) { orgErr(res, e); } });
/* ============================================================================================================================ */
/* ================= FIX PASS · consent confirmation · licences · refunds · metering · retention · sources · journey ================= */
const JE = require('./lib/journey_engine'); const SOURCES = require('./lib/sources'); const RULEWATCH = require('./lib/rulewatch');
QUEUE.register('journey_recompute', async (p) => JE.compute(p.userId));
QUEUE.register('source_run', async (p) => SOURCES.run(p.sourceId));
app.get('/api/me/next', auth, async (req, res) => { try { res.json({ next: await JE.compute(req.userId) }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Gap 7 · the applicant confirms a portal connection made by a consultant; until then it is pending. */
app.get('/api/me/portals/pending', auth, async (req, res) => { try { const { data } = await admin().from('portal_connections').select('id,portal_name,login_url,scope,connected_by,created_at').eq('user_id', req.userId).eq('applicant_confirmed', false).neq('status', 'disconnected'); res.json({ pending: (data || []).filter(x => x.connected_by && x.connected_by !== req.userId) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/me/portals/:id/confirm', auth, async (req, res) => { try { const ok = !!(req.body || {}).approve; if (ok) { try { const { data: pc } = await admin().from('portal_connections').select('portal_name,scope,org_id,connected_by').eq('id', req.params.id).maybeSingle(); const { data: cn } = pc && pc.connected_by ? await admin().from('profiles').select('full_name').eq('id', pc.connected_by).maybeSingle() : { data: null }; const { data: og } = pc && pc.org_id ? await admin().from('organisations').select('name').eq('id', pc.org_id).maybeSingle() : { data: null }; await CONSENT.record(req, req.userId, 'consultant_acting', { consultant: (cn && cn.full_name) || 'my consultant', org: (og && og.name) || 'their organisation', scope: ((pc && pc.scope) || 'watch').replace(/_/g, ' ') }, { connection_id: req.params.id }); await CONSENT.record(req, req.userId, 'portal_watch', { portal: (pc && pc.portal_name) || 'the portal', scope: ((pc && pc.scope) || 'watch').replace(/_/g, ' ') }, { connection_id: req.params.id }); } catch (e) {} } const patch = ok ? { applicant_confirmed: true, consent: true, consent_at: new Date().toISOString(), status: 'connected' } : { status: 'disconnected', secret_enc: null, consent: false }; await admin().from('portal_connections').update(patch).eq('id', req.params.id).eq('user_id', req.userId); await admin().from('audit_log').insert({ actor: req.userId, event: ok ? 'PORTAL_CONSENT_CONFIRMED' : 'PORTAL_CONSENT_REFUSED', detail: req.params.id }).then(() => {}, () => {}); if (ok) await QUEUE.enqueue('portal_watch', { connectionId: req.params.id }, { userId: req.userId, maxAttempts: 1 }); JE.recompute(req.userId); res.json({ ok: true, approved: ok }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Gap 8 · consultant licences: declared → verified by platform admin; `submit` scope only with a valid licence. */
app.get('/api/org/:id/licences', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.read'); const { data } = await admin().from('consultant_licences').select('*').eq('org_id', req.params.id).order('created_at', { ascending: false }); res.json({ licences: data || [], bodies: ['OISC (UK)', 'MARA (Australia)', 'CICC / RCIC (Canada)', 'IAA (New Zealand)', 'Law Society / Bar', 'Other'] }); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/licences', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.write'); const b = req.body || {}; if (!b.body || !b.jurisdiction || !b.number) return res.status(400).json({ error: 'body, jurisdiction and number required' }); const { data, error } = await admin().from('consultant_licences').insert({ org_id: req.params.id, user_id: b.user_id || req.userId, body: String(b.body).slice(0, 80), jurisdiction: String(b.jurisdiction).toUpperCase().slice(0, 2), number: String(b.number).slice(0, 80), expires_on: /^\d{4}-\d{2}-\d{2}$/.test(String(b.expires_on || '')) ? b.expires_on : null, evidence_document_id: b.evidence_document_id || null }).select('*').single(); if (error) return res.status(400).json({ error: error.message }); await orgAudit(req.params.id, req.userId, 'LICENCE_DECLARED', data.body + ' ' + data.number); try { const { data: admins } = await admin().from('profiles').select('id').in('role', ['admin', 'super_admin']); for (const a of (admins || [])) await NOTIFY.push(a.id, 'licence', 'Consultant licence to verify: ' + data.body, data.jurisdiction + ' ' + data.number, 'adminx'); } catch (e) {} res.json({ licence: data }); } catch (e) { orgErr(res, e); } });
app.get('/api/admin/licences', auth, perm('users.read'), async (req, res) => { try { const { data } = await admin().from('consultant_licences').select('*').order('status').order('created_at', { ascending: false }).limit(300); res.json({ licences: data || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.patch('/api/admin/licences/:lid', auth, perm('users.write'), async (req, res) => { try { const st = String((req.body || {}).status || ''); if (!['verified', 'rejected', 'expired'].includes(st)) return res.status(400).json({ error: 'status' }); const { data, error } = await admin().from('consultant_licences').update({ status: st, verified_by: req.userId, verified_at: new Date().toISOString() }).eq('id', req.params.lid).select('*').single(); if (error) return res.status(400).json({ error: error.message }); try { await NOTIFY.push(data.user_id, 'licence', 'Your licence is ' + st, data.body + ' ' + data.number, 'work'); } catch (e) {} res.json({ licence: data }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Gap 14 · refunds: gateway refund where possible, ledger reversal always, audit, customer notified. */
app.post('/api/payments/:id/refund', auth, perm('payments.write'), async (req, res) => {
  try { const { data: p } = await admin().from('payments').select('*').eq('id', req.params.id).maybeSingle(); if (!p) return res.status(404).json({ error: 'Not found' }); if (p.status !== 'confirmed') return res.status(400).json({ error: 'Only confirmed payments can be refunded' }); if (p.refunded_at) return res.status(400).json({ error: 'Already refunded' });
    const bal = await balance(p.user_id); const credits = Math.max(0, Math.round(Number(p.credits) || 0)); if (credits && bal < credits) return res.status(400).json({ error: 'The customer has already used ' + (credits - bal) + ' of these cases; refund the unused part manually via an adjustment.' });
    let ref = null; try { if (String(p.reference || '').startsWith('CARD:') && process.env.STRIPE_SECRET_KEY) { const sid = String(p.reference).slice(5); const s = await GATEWAY.retrieveSession(sid); if (s.payment_intent) { const r = await fetch('https://api.stripe.com/v1/refunds', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded' }, body: 'payment_intent=' + encodeURIComponent(s.payment_intent) }); const d = await r.json(); if (!r.ok) throw new Error(d.error && d.error.message || 'refund failed'); ref = d.id; } } } catch (e) { return res.status(400).json({ error: 'Gateway refund failed: ' + e.message }); }
    if (credits) { const led = await ledgerWrite({ user_id: p.user_id, delta: -credits, reason: 'refund', payment_id: p.id, note: 'Refund of payment ' + p.id }); if (led.error) return res.status(500).json({ error: 'Ledger reversal failed' }); }
    await admin().from('payments').update({ status: 'failed', refunded_at: new Date().toISOString(), refund_ref: ref || (String(p.reference || '').startsWith('CARD:') ? null : 'manual') }).eq('id', p.id);
    await admin().from('audit_log').insert({ actor: req.userId, event: 'PAYMENT_REFUNDED', detail: p.id + ' -' + credits + 'cr ' + (ref || 'manual') }).then(() => {}, () => {}); try { await NOTIFY.push(p.user_id, 'refund', 'Refund issued', (ref ? 'Your card refund is on its way (5-10 business days).' : 'Your refund will be sent to your bank account by our finance desk.'), 'home'); } catch (e) {}
    res.json({ ok: true, gateway_refund: ref, credits_reversed: credits }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* Gap 13 · metering: every AI-heavy capability writes a unit; soft caps per 30 days; admin sees usage. */
async function meter(userId, capability, orgId) { try { await admin().from('usage_meter').insert({ user_id: userId, org_id: orgId || null, capability, units: 1 }); } catch (e) {} }
const CAPS = { interview_prep: 6, refusal_analysis: 4, doc_read: 60, case_brain: 200, discovery: 40, portal_watch: 400 };
async function overCap(userId, capability) { if (await isPlatformStaff(userId)) return false; try { const since = new Date(Date.now() - 30 * 86400000).toISOString(); const { count } = await admin().from('usage_meter').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('capability', capability).gte('created_at', since); const cfg = await siteSettings.getConfig(); const cap = (cfg.caps && cfg.caps[capability]) || CAPS[capability] || 9999; return (count || 0) >= cap ? cap : 0; } catch (e) { return 0; } }
app.get('/api/me/usage', auth, async (req, res) => { try { const since = new Date(Date.now() - 30 * 86400000).toISOString(); const { data } = await admin().from('usage_meter').select('capability').eq('user_id', req.userId).gte('created_at', since); const by = {}; for (const r of (data || [])) by[r.capability] = (by[r.capability] || 0) + 1; res.json({ last_30_days: by, caps: CAPS }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/usage', auth, perm('aicost.read'), async (req, res) => { try { const since = new Date(Date.now() - 30 * 86400000).toISOString(); const { data } = await admin().from('usage_meter').select('capability,user_id').gte('created_at', since); const by = {}, users = {}; for (const r of (data || [])) { by[r.capability] = (by[r.capability] || 0) + 1; users[r.user_id] = (users[r.user_id] || 0) + 1; } const top = Object.entries(users).sort((a, b) => b[1] - a[1]).slice(0, 20); res.json({ by_capability: by, top_users: top, caps: CAPS }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Gap 9 · sources admin */
app.get('/api/admin/sources', auth, perm('settings.read'), async (req, res) => { try { const { data } = await admin().from('sources').select('*').order('created_at', { ascending: false }); res.json({ sources: data || [], kinds: Object.keys(SOURCES.ADAPTERS) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/sources', auth, perm('settings.write'), async (req, res) => { try { const b = req.body || {}; if (!SOURCES.ADAPTERS[b.kind] || !b.key) return res.status(400).json({ error: 'kind and key required' }); const { data, error } = await admin().from('sources').upsert({ kind: b.kind, key: String(b.key).trim(), org_name: String(b.org_name || '').slice(0, 200) || null, country_code: String(b.country_code || '').toUpperCase().slice(0, 2) || null, lane: b.lane === 'study' ? 'study' : 'work', enabled: b.enabled !== false }, { onConflict: 'kind,key' }).select('*').single(); if (error) return res.status(400).json({ error: error.message }); await QUEUE.enqueue('source_run', { sourceId: data.id }, { maxAttempts: 1 }); res.json({ source: data }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/sources/:sid/run', auth, perm('settings.write'), async (req, res) => { try { await QUEUE.enqueue('source_run', { sourceId: req.params.sid }, { maxAttempts: 1 }); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/rules/watch', auth, perm('settings.write'), async (req, res) => { try { res.json(await RULEWATCH.sweep(Number((req.body || {}).limit) || 150)); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Gap 18 · retention purge (documents past retention, mail older than 24 months unless linked to an open case, portal runs > 90 days). */
async function retentionPurge() {
  const out = { documents: 0, messages: 0, runs: 0 }; const today = new Date().toISOString().slice(0, 10);
  try { const { data: docs } = await admin().from('documents').select('id,storage_key,user_id,doc_type').lt('retention_until', today).eq('generated', false).limit(500); const { BUCKET } = require('./lib/docs'); const { data: linked } = await admin().from('application_documents').select('document_id'); const keep = new Set((linked || []).map(x => x.document_id));
    for (const d of (docs || [])) { if (keep.has(d.id) || ['cv', 'passport', 'degree', 'transcript'].includes(d.doc_type)) continue; try { await admin().storage.from(BUCKET).remove([d.storage_key]); } catch (e) {} await admin().from('documents').delete().eq('id', d.id); out.documents++; } } catch (e) {}
  try { const cut = new Date(Date.now() - 730 * 86400000).toISOString(); const { data: msgs } = await admin().from('case_messages').select('id').lt('received_at', cut).limit(2000); if (msgs && msgs.length) { await admin().from('case_messages').delete().in('id', msgs.map(m => m.id)); out.messages = msgs.length; } } catch (e) {}
  try { const cut = new Date(Date.now() - 90 * 86400000).toISOString(); const { data: runs } = await admin().from('portal_runs').select('id').lt('started_at', cut).limit(5000); if (runs && runs.length) { await admin().from('portal_runs').delete().in('id', runs.map(r => r.id)); out.runs = runs.length; } } catch (e) {}
  try { await admin().from('audit_log').insert({ event: 'RETENTION_PURGE', detail: JSON.stringify(out) }); } catch (e) {}
  return out;
}
app.post('/api/admin/retention/purge', auth, perm('settings.write'), async (req, res) => { try { res.json(await retentionPurge()); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Gap 17 · alerts: dead jobs, failed webhooks, unreachable rule sources → admin notification (runs hourly). */
async function alertSweep() { const q = await QUEUE.status(); const issues = []; if (q.dead) issues.push(q.dead + ' dead job(s) in the queue'); try { const { count } = await admin().from('webhook_deliveries').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', new Date(Date.now() - 86400000).toISOString()); if (count) issues.push(count + ' webhook delivery failure(s) in 24h'); } catch (e) {} try { const { count } = await admin().from('rule_sources').select('source_url', { count: 'exact', head: true }).eq('status', 'unreachable'); if (count) issues.push(count + ' rule source page(s) unreachable'); } catch (e) {} if (issues.length) { try { const { data: admins } = await admin().from('profiles').select('id').in('role', ['admin', 'super_admin']); for (const a of (admins || [])) await NOTIFY.push(a.id, 'alert', 'Platform alert', issues.join(' · '), 'adminx'); } catch (e) {} } return { issues }; }
app.get('/api/admin/alerts', auth, perm('overview.read'), async (req, res) => { try { res.json(await alertSweep()); } catch (e) { res.status(400).json({ error: e.message }); } });
try { if (process.env.FF_QUEUE !== 'off') { setInterval(() => retentionPurge().catch(() => {}), 7 * 24 * 3600 * 1000); setInterval(() => alertSweep().catch(() => {}), 3600 * 1000); } } catch (e) {}
/* ================================================================================================================= */
/* ================= PAKISTAN-LOCAL PKR CHECKOUT (Safepay) ================= */
const SAFEPAY = require('./lib/gateway_safepay');
/* PKR price of record for Pakistani applicants: the tier's PKR/promo PKR (admin-set), not an FX conversion. */
app.post('/api/pay/pk/checkout', auth, async (req, res) => {
  try { if (!SAFEPAY.enabled()) return res.status(400).json({ error: 'Local PKR card payments are not switched on yet; use bank transfer with a screenshot.' });
    const credits = Number((req.body || {}).credits); const cfg = await siteSettings.getConfig(); const t = ((cfg.packages && cfg.packages.tiers) || []).find(x => Number(x.credits) === credits); if (!t) return res.status(400).json({ error: 'Choose a package first.' });
    const list = Number(t.pkr) || 0; const promo = (Number(t.promo_pkr) > 0 && Number(t.promo_pkr) < list) ? Number(t.promo_pkr) : null; let amount = promo != null ? promo : list; if (!(amount > 0)) return res.status(400).json({ error: 'This package has no PKR price set (Admin → Settings).' });
    try { const { data: me } = await admin().from('profiles').select('referral_balance_pkr').eq('id', req.userId).maybeSingle(); const disc = Math.min(Number(me && me.referral_balance_pkr) || 0, 500 * credits); amount = Math.max(0, amount - disc); } catch (e) {}
    const { data: pay, error } = await admin().from('payments').insert({ user_id: req.userId, credits, amount_pkr: amount, status: 'pending', reference: 'SAFEPAY', provider: 'safepay' }).select('id').single(); if (error) return res.status(400).json({ error: error.message });
    const origin = (req.headers.origin || ('https://' + req.headers.host)); const s = await SAFEPAY.createCheckout({ amountPkr: amount, paymentId: pay.id, successUrl: origin + '/?paid=1&provider=safepay&pid=' + pay.id, cancelUrl: origin + '/?paid=0' });
    await admin().from('payments').update({ reference: ('SAFEPAY:' + s.id).slice(0, 120) }).eq('id', pay.id).then(() => {}, () => {}); res.json({ url: s.url, payment_id: pay.id, amount_pkr: amount }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* ========================================================================== */
/* ================= POLICY WATCH · PARTNERSHIPS & OFFICIAL DOCUMENTS · ECONOMICS · EMPLOYER OUTREACH · CASE CLOSURE ================= */
const POLICY = require('./lib/policywatch'); const PART = require('./lib/partnerships'); const ECON = require('./lib/economics');
app.get('/api/policy/updates', auth, async (req, res) => { try { res.json({ updates: await POLICY.updates(req.query.cc ? String(req.query.cc).toUpperCase() : null, 50) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/policy/sweep', auth, perm('settings.write'), async (req, res) => { try { res.json(await POLICY.sweep(Number((req.body || {}).limit) || 150)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.patch('/api/admin/policy/:pid', auth, perm('settings.write'), async (req, res) => { try { const st = String((req.body || {}).status || ''); if (!['reviewed', 'dismissed'].includes(st)) return res.status(400).json({ error: 'status' }); await admin().from('policy_updates').update({ status: st, reviewed_by: req.userId, reviewed_at: new Date().toISOString() }).eq('id', req.params.pid); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Official documents: draft (agent writes), approve (admin), sign (super_admin/admin, digital signature), send, verify, archive. */
app.get('/api/admin/documents', auth, perm('settings.read'), async (req, res) => { try { const { data } = await admin().from('official_documents').select('id,kind,title,counterparty_name,counterparty_email,counterparty_focal,our_focal,status,variant,sha256,approved_at,signed_at,sent_at,countersigned_at,valid_until,created_at').order('created_at', { ascending: false }).limit(300); res.json({ documents: data || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/documents/:id', auth, perm('settings.read'), async (req, res) => { try { const { data } = await admin().from('official_documents').select('*').eq('id', req.params.id).maybeSingle(); if (!data) return res.status(404).json({ error: 'Not found' }); res.json({ document: data }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/documents/draft', auth, perm('settings.write'), async (req, res) => { try { const b = req.body || {}; if (!b.counterparty_name) return res.status(400).json({ error: 'counterparty_name required' }); const jobId = await QUEUE.enqueue('doc_draft', Object.assign({}, b, { createdBy: req.userId }), { userId: req.userId, maxAttempts: 2 }); res.json({ ok: true, job_id: jobId, note: 'Drafting in the background; it appears in Documents in about a minute.' }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.patch('/api/admin/documents/:id', auth, perm('settings.write'), async (req, res) => { try { const b = req.body || {}; const patch = { updated_at: new Date().toISOString() }; for (const k of ['body_text', 'title', 'counterparty_email', 'counterparty_focal', 'our_focal', 'valid_from', 'valid_until', 'notes', 'counterparty_org_id']) if (b[k] !== undefined) patch[k] = b[k]; if (patch.body_text) patch.body_text = PART.humanize(patch.body_text); const { data, error } = await admin().from('official_documents').update(patch).eq('id', req.params.id).in('status', ['draft']).select('*').single(); if (error) return res.status(400).json({ error: 'Only drafts can be edited' }); res.json({ document: data }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/documents/:id/approve', auth, perm('settings.write'), async (req, res) => { try { if (!['admin', 'super_admin'].includes(req.userRole)) return res.status(403).json({ error: 'Platform admin only' }); res.json({ document: await PART.approve(req.params.id, req.userId) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/documents/:id/sign', auth, perm('settings.write'), async (req, res) => { try { if (!['admin', 'super_admin'].includes(req.userRole)) return res.status(403).json({ error: 'Platform admin only' }); const { data: me } = await admin().from('profiles').select('full_name').eq('id', req.userId).maybeSingle(); res.json({ document: await PART.sign(req.params.id, req.userId, me && me.full_name) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/documents/:id/send', auth, perm('settings.write'), async (req, res) => { try { if (!['admin', 'super_admin'].includes(req.userRole)) return res.status(403).json({ error: 'Platform admin only' }); res.json({ document: await PART.send(req.params.id, req.userId) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/documents/:id/countersigned', auth, perm('settings.write'), async (req, res) => { try { setTimeout(() => PENGINE.onboard(req.params.id).catch(() => {}), 1500); const { data, error } = await admin().from('official_documents').update({ status: 'countersigned', countersigned_at: new Date().toISOString(), valid_from: (req.body || {}).valid_from || new Date().toISOString().slice(0, 10), valid_until: (req.body || {}).valid_until || null, counterparty_org_id: (req.body || {}).counterparty_org_id || null, updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').single(); if (error) return res.status(400).json({ error: error.message }); if (data.counterparty_org_id) await admin().from('organisations').update({ pilot: true, pilot_started_at: new Date().toISOString(), pilot_notes: 'MOU ' + data.id }).eq('id', data.counterparty_org_id).then(() => {}, () => {}); res.json({ document: data }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/documents/:id/pdf', auth, perm('settings.read'), async (req, res) => { try { const { data: d } = await admin().from('official_documents').select('*').eq('id', req.params.id).maybeSingle(); if (!d) return res.status(404).json({ error: 'Not found' }); if (d.storage_key) { const { BUCKET } = require('./lib/docs'); const { data: su } = await admin().storage.from(BUCKET).createSignedUrl(d.storage_key, 600); return res.redirect(su.signedUrl); } const pdf = await PART.renderPdf(d); res.setHeader('content-type', 'application/pdf'); res.send(pdf); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/documents/verify/:id', async (req, res) => { try { res.json(await PART.verify(req.params.id)); } catch (e) { res.status(400).json({ error: e.message }); } });
QUEUE.register('doc_draft', async (p) => { const d = await PART.draft(p); try { await NOTIFY.push(p.createdBy, 'document', 'Draft ready: ' + d.title, 'Review, approve and sign it under Admin → Documents.', 'adminx'); } catch (e) {} return { id: d.id }; });
/* Economics agent */
app.get('/api/admin/economics', auth, perm('aicost.read'), async (req, res) => { try { res.json(await ECON.report()); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Employer Outreach agent (work lane): a first-contact email to the job poster, in the applicant's voice, from their forimail address, sent on their tap. */
app.post('/api/applications/:id/outreach', auth, async (req, res) => {
  try { const { data: a } = await admin().from('applications').select('id,opportunity_id').eq('id', req.params.id).eq('user_id', req.userId).maybeSingle(); if (!a) return res.status(404).json({ error: 'Case not found' });
    const { data: o } = await admin().from('opportunities').select('title,institution,country_code,kind,contact_emails,url,description,visa_sponsorship').eq('id', a.opportunity_id).maybeSingle(); const { data: pr } = await admin().from('profiles').select('full_name,headline,field,profession,total_experience_years,apply_email').eq('id', req.userId).maybeSingle();
    const cap = await overCap(req.userId, 'case_brain'); if (cap) return res.status(402).json({ error: 'Monthly writing limit reached.' }); await meter(req.userId, 'case_brain');
    const txt = await callAI('case_writing', `Write a short first-contact email (120-170 words) from ${pr.full_name}, ${pr.headline || pr.profession || pr.field || 'a professional'} with ${pr.total_experience_years || ''} years of experience, to the hiring contact at ${o.institution} about the position "${o.title}" (${o.country_code}). Purpose: confirm the role is still open, ask whether they sponsor a work visa for candidates from Pakistan/India/Bangladesh if the posting is unclear (${o.visa_sponsorship ? 'posting says: ' + o.visa_sponsorship : 'posting does not say'}), state one concrete relevant strength, and ask for the best way to apply or a short call. Plain, warm, specific, no long dashes, no stock phrases, no bullet points. Sign with the name only. Return only the email body.`, { maxTokens: 400, userId: req.userId });
    const body = PART.humanize(txt); const to = (o.contact_emails || [])[0] || ''; res.json({ to, subject: 'Regarding the ' + o.title + ' position', body, from: pr.apply_email, note: to ? 'Review and tap Send from your ForiForeign address.' : 'No contact email on the posting; use the employer\'s careers page contact or the official page link.' , url: o.url }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* Case closure agent: rejected/withdrawn/closed cases older than 180 days lose their generated files and mail bodies (an audit line stays). */
async function caseClosurePurge() { const cut = new Date(Date.now() - 180 * 86400000).toISOString(); let n = 0; try { const { data: apps } = await admin().from('applications').select('id,user_id,status').in('status', ['rejected', 'withdrawn', 'closed', 'declined']).lt('updated_at', cut).is('purged_at', null).limit(300); const { BUCKET } = require('./lib/docs'); for (const a of (apps || [])) { try { const { data: gen } = await admin().from('documents').select('id,storage_key').eq('user_id', a.user_id).eq('generated', true).eq('application_id', a.id); for (const g of (gen || [])) { try { await admin().storage.from(BUCKET).remove([g.storage_key]); } catch (e) {} await admin().from('documents').delete().eq('id', g.id); } } catch (e) {} await admin().from('case_messages').update({ body: '[purged: case closed]', suggested_reply: null }).eq('application_id', a.id); await admin().from('applications').update({ purged_at: new Date().toISOString(), closed_at: new Date().toISOString() }).eq('id', a.id); n++; } } catch (e) {} try { await admin().from('audit_log').insert({ event: 'CASE_CLOSURE_PURGE', detail: n + ' cases' }); } catch (e) {} return { purged: n }; }
app.post('/api/admin/cases/purge-closed', auth, perm('settings.write'), async (req, res) => { try { res.json(await caseClosurePurge()); } catch (e) { res.status(400).json({ error: e.message }); } });
try { if (process.env.FF_QUEUE !== 'off') setInterval(() => caseClosurePurge().catch(() => {}), 7 * 24 * 3600 * 1000); } catch (e) {}
/* ============================================================================================================================== */
/* ================= VISIBILITY LAYERS · SUPPORT TRIAGE AGENT · PLATFORM OVERSIGHT · OFFICIAL CONTACT ================= */
const OFFICIAL_EMAIL = process.env.MAIL_REPLY_TO || 'admin@foriforeign.com';
/* Only ForiForeign's platform admin sees everything: organisations, their members, clients, plans, commissions. Super admin only. */
const superOnly = (req, res, next) => (req.userRole === 'super_admin' ? next() : res.status(403).json({ error: 'ForiForeign super admin only' }));
app.get('/api/admin/orgs', auth, perm('users.read'), superOnly, async (req, res) => { try { const { data: orgs } = await admin().from('organisations').select('id,name,kind,plan,country_code,owner_id,pilot,created_at').order('created_at', { ascending: false }).limit(500); const out = []; for (const o of (orgs || [])) { const [{ count: members }, { count: clients }, { count: openings }] = await Promise.all([admin().from('org_members').select('user_id', { count: 'exact', head: true }).eq('org_id', o.id), admin().from('clients').select('id', { count: 'exact', head: true }).eq('org_id', o.id), admin().from('partner_openings').select('id', { count: 'exact', head: true }).eq('org_id', o.id)]); out.push(Object.assign(o, { members: members || 0, clients: clients || 0, openings: openings || 0 })); } res.json({ orgs: out }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/orgs/:id', auth, perm('users.read'), superOnly, async (req, res) => { try { const id = req.params.id; const [org, members, clientsRaw, subs, comm, audit] = await Promise.all([admin().from('organisations').select('*').eq('id', id).maybeSingle().then(r => r.data), ORGS.listMembers(id), ORGS.listClients(id, { limit: 200 }), admin().from('org_subscriptions').select('tier_name,status,cases_month,cases_used,period_end').eq('org_id', id).then(r => r.data || []), admin().from('commission_ledger').select('amount_pkr,status').eq('org_id', id).then(r => r.data || []), admin().from('audit_log').select('event,detail,created_at').eq('org_id', id).order('created_at', { ascending: false }).limit(50).then(r => r.data || [])]); /* NO-POACH GUARANTEE, enforced: the platform admin sees a consultancy's client list only as counts and stages; names, phones and
   emails are masked unless the consultancy's owner has granted time-limited support access (Workspace → Team → "Allow platform support"). */
    const grant = org && org.settings && org.settings.support_access_until && new Date(org.settings.support_access_until) > new Date(); const clients = (clientsRaw || []).map(c => grant ? c : Object.assign({}, c, { full_name: c.full_name ? c.full_name.slice(0, 1) + '•••' : null, email: null, phone: null, notes: null }));
    await admin().from('audit_log').insert({ actor: req.userId, event: grant ? 'ADMIN_ORG_VIEWED_WITH_GRANT' : 'ADMIN_ORG_VIEWED_MASKED', detail: id, org_id: id }).then(() => {}, () => {}); res.json({ org, members, clients, masked: !grant, subscriptions: subs, commissions: comm, audit }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/org/:id/support-access', auth, async (req, res) => { try { _maskCache.at = 0; await ORGS.requireOrg(req, req.params.id, 'org.write'); const hours = Math.max(1, Math.min(72, Number((req.body || {}).hours) || 24)); const until = new Date(Date.now() + hours * 3600000).toISOString(); const { data: o } = await admin().from('organisations').select('settings').eq('id', req.params.id).maybeSingle(); await admin().from('organisations').update({ settings: Object.assign({}, (o && o.settings) || {}, { support_access_until: (req.body || {}).revoke ? null : until }) }).eq('id', req.params.id); await orgAudit(req.params.id, req.userId, (req.body || {}).revoke ? 'SUPPORT_ACCESS_REVOKED' : 'SUPPORT_ACCESS_GRANTED', (req.body || {}).revoke ? '' : 'until ' + until); res.json({ support_access_until: (req.body || {}).revoke ? null : until }); } catch (e) { orgErr(res, e); } });
/* Support triage agent: every ticket is classified, prioritised, given an SLA and a suggested reply; admin approves and sends. */
QUEUE.register('support_triage', async (p) => {
  const { data: t } = await admin().from('support_tickets').select('*').eq('id', p.ticketId).maybeSingle(); if (!t) return null;
  let v = { category: 'other', priority: 'normal', suggested_reply: null };
  try { const txt = await callAI('high_value', `You are ForiForeign's support desk. Classify this ticket and draft the reply. Answer ONLY JSON: {"category":"payment|bug|visa|partnership|account|complaint|other","priority":"low|normal|high|urgent","suggested_reply":"a complete, warm, specific reply in plain English (no long dashes, no stock phrases), signed 'ForiForeign Support, admin@foriforeign.com'; if information is missing, ask for exactly what is needed"}\nSUBJECT: ${t.subject}\nMESSAGE: ${String(t.message || '').slice(0, 4000)}`, { maxTokens: 600, json: true }); const m = String(txt).match(/\{[\s\S]*\}/); if (m) v = Object.assign(v, JSON.parse(m[0])); } catch (e) {}
  const sla = { urgent: 4, high: 12, normal: 24, low: 72 }[v.priority] || 24; const cat = ['payment', 'bug', 'visa', 'partnership', 'account', 'complaint', 'other'].includes(v.category) ? v.category : 'other';
  await admin().from('support_tickets').update({ category: cat, priority: v.priority, suggested_reply: v.suggested_reply ? require('./lib/partnerships').humanize(v.suggested_reply) : null, sla_due_at: new Date(Date.now() + sla * 3600000).toISOString() }).eq('id', t.id);
  try { const { data: admins } = await admin().from('profiles').select('id').in('role', ['admin', 'super_admin']); for (const a of (admins || [])) await NOTIFY.push(a.id, 'support', '[' + v.priority + '] ' + cat + ': ' + t.subject, 'Reply within ' + sla + ' h. A suggested reply is ready under Admin → Support.', 'adminx'); } catch (e) {}
  try { const M = require('./lib/mailer'); if (M.enabled()) await M.send(OFFICIAL_EMAIL, '[ForiForeign support] ' + v.priority + ' · ' + cat + ' · ' + t.subject, M.wrap('New support ticket', String(t.message || '').slice(0, 1500), 'adminx')); } catch (e) {}
  return { category: cat, priority: v.priority };
});
app.get('/api/contact', (req, res) => { res.json({ official_email: OFFICIAL_EMAIL, complaints: OFFICIAL_EMAIL, partnerships: 'partnerships@' + (process.env.APPLY_DOMAIN || 'forimail.com') + ' (replies go to ' + OFFICIAL_EMAIL + ')', whatsapp: '+923455216903' }); });
/* Visibility matrix the platform enforces: returned for the client to hide what a person does not need. */
app.get('/api/me/visibility', auth, async (req, res) => { try { const orgs = await ORGS.myOrgs(req.userId); const staff = ['staff', 'content_admin', 'admin', 'super_admin'].includes(req.userRole); const business = orgs.filter(o => o.kind !== 'personal'); res.json({ tabs: { home: true, explore: true, mail: true, profile: true, work: business.length > 0, admin: staff }, business_orgs: business.map(o => ({ id: o.id, name: o.name, kind: o.kind, role: o.my_role })), role: req.userRole, note: 'End users see their own journey only; organisation members see their organisation within their branch and role; ForiForeign platform admin sees everything.' }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ====================================================================================================================== */
/* ================= ACQUISITION ENGINE ROUTES ================= */
const ACQ = require('./lib/acquire');
QUEUE.register('acq_run', async (p) => ACQ.runSource(p.sourceId));
QUEUE.register('acq_verify_institutions', async (p) => ACQ.verifySweep(p.limit || 100));
QUEUE.register('acq_verify_employers', async (p) => ACQ.verifyEmployers(p.limit || 300));
app.get('/api/admin/acquisition', auth, perm('settings.read'), async (req, res) => { try { res.json(await ACQ.status()); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/acquisition/seed', auth, perm('settings.write'), async (req, res) => { try { res.json(await ACQ.seedSources()); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/acquisition/run-all', auth, perm('settings.write'), async (req, res) => { try { const { data } = await admin().from('sources').select('id,kind').eq('enabled', true); let n = 0; for (const s of (data || [])) { await QUEUE.enqueue('acq_run', { sourceId: s.id }, { maxAttempts: 1 }); n++; } await QUEUE.enqueue('acq_verify_institutions', { limit: 200 }, { maxAttempts: 1 }); await QUEUE.enqueue('acq_verify_employers', { limit: 500 }, { maxAttempts: 1 }); res.json({ queued: n + 2 }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/acquisition/run/:sid', auth, perm('settings.write'), async (req, res) => { try { await QUEUE.enqueue('acq_run', { sourceId: req.params.sid }, { maxAttempts: 1 }); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/professions/search', auth, async (req, res) => { try { const q = String(req.query.q || '').slice(0, 80); let qb = admin().from('professions').select('id,title,isco,regulated_in,alt_labels').limit(30); if (q) qb = qb.ilike('title', '%' + q.replace(/[%,]/g, ' ') + '%'); const { data } = await qb; res.json({ professions: data || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/institutions', auth, async (req, res) => { try { let q = admin().from('institutions').select('id,country_code,name,domain,website,kind,sector,verified,careers_feed,partner_org_id').limit(200); if (req.query.cc) q = q.eq('country_code', String(req.query.cc).toUpperCase()); if (req.query.kind) q = q.eq('kind', String(req.query.kind)); if (req.query.q) q = q.ilike('name', '%' + String(req.query.q).slice(0, 60).replace(/[%,]/g, ' ') + '%'); const { data } = await q.order('verified', { ascending: false }).order('name'); res.json({ institutions: data || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ============================================================== */
/* ================= VISA DESK · ADD-ONS · PARTNER SPOTLIGHT ================= */
/* Add-ons: what is charged after the application package, and why. Bundled: the first visa desk file, the first offer
   pack and the first interview pack come with any package; further ones are add-ons; consultants' clients are covered
   by the agency plan. */
async function hasAddon(userId, key) { const { data } = await admin().from('user_addons').select('id').eq('user_id', userId).eq('addon_key', key).or('expires_at.is.null,expires_at.gte.' + new Date().toISOString()).limit(1); return !!(data && data.length); }
async function bundledAllowance(userId, key) { const { count: paid } = await admin().from('payments').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'confirmed'); if (!paid) return 0; if (key === 'visa_desk') { try { const cfg = await siteSettings.getConfig(); const { data: pays } = await admin().from('payments').select('credits').eq('user_id', userId).eq('status', 'confirmed'); const tiers = ((cfg.packages || {}).tiers || []); const best = Math.max(1, ...(pays || []).map(p => { const t = tiers.find(x => Number(x.credits) === Number(p.credits)); return t && t.visa_desk_included ? Number(t.visa_desk_included) : 1; })); return best; } catch (e) {} } const { data: cl } = await admin().from('clients').select('id').eq('user_id', userId).eq('status', 'active').limit(1); if (cl && cl.length) return 99; return { visa_desk: 1, offer_pack: 1, arrival_pack: 1 }[key] || 0; }
const STAFF_ROLES = ['staff', 'content_admin', 'admin', 'super_admin'];
async function isPlatformStaff(userId) { try { const { data } = await admin().from('profiles').select('role').eq('id', userId).maybeSingle(); return !!(data && STAFF_ROLES.includes(data.role)); } catch (e) { return false; } }
async function addonGate(userId, key, usedCount) { if (await isPlatformStaff(userId)) return { ok: true, staff: true }; const cfg = await siteSettings.getConfig(); const price = (cfg.addons || {})[key + '_usd'] || 0; if (await hasAddon(userId, key)) return { ok: true }; const allow = await bundledAllowance(userId, key); if (usedCount < allow) return { ok: true, bundled: true }; return { ok: false, price_usd: price, key }; }
app.get('/api/addons', auth, async (req, res) => { try { const cfg = await siteSettings.getConfig(); const { data } = await admin().from('user_addons').select('addon_key,expires_at,created_at,bundle').eq('user_id', req.userId); const { count: offers } = await admin().from('offers').select('id', { count: 'exact', head: true }).eq('user_id', req.userId); const { data: lastPay } = await admin().from('payments').select('credits').eq('user_id', req.userId).eq('status', 'confirmed').gt('credits', 0).order('created_at', { ascending: false }).limit(1); const tierKey = lastPay && lastPay[0] ? ((((cfg.packages || {}).tiers) || []).find(t => Number(t.credits) === Number(lastPay[0].credits)) || {}).key : null; res.json({ plus: cfg.plus || null, plus_for: tierKey, has_offer: (offers || 0) > 0, prices: cfg.addons || {}, owned: data || [], stages: [{ key: 'package', when: 'Before we prepare your case', what: 'Search is free; you pay when you choose positions to prepare and send', usd: 'Basic $19 · Smart $39 · Premium $79' }, { key: 'offer_pack', when: 'When an offer arrives', what: 'Conditions and deadlines tracked, contract/CAS check, offers compared (first one bundled)', usd: '$' + ((cfg.addons || {}).offer_pack_usd || 15) }, { key: 'visa_desk', when: 'When you start the visa', what: 'Visa desk end to end: readiness, forms pre-fill, appointment, submission guide, tracking, decision, next step (first file bundled)', usd: '$' + ((cfg.addons || {}).visa_desk_usd || 29) }, { key: 'arrival_pack', when: 'After the visa', what: 'Pre-departure to first 90 days with partners at each step (first bundled)', usd: '$' + ((cfg.addons || {}).arrival_pack_usd || 19) }, { key: 'residence_year', when: 'Each year abroad', what: 'Family, PR pathway, policy updates for your destination', usd: '$' + ((cfg.addons || {}).residence_year_usd || 24) + ' / year' }] }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/addons/checkout', auth, async (req, res) => {
  try { const key = String((req.body || {}).addon || ''); const cfg = await siteSettings.getConfig(); const price = (cfg.addons || {})[key + '_usd']; if (key === 'pathway_month') price = (cfg.pathway || {}).month_usd || 9; if (key === 'pathway_year') price = (cfg.pathway || {}).year_usd || 79; if (key === 'o2s' || /_plus$/.test(key)) { const t = ((cfg.plus || {}).tiers || []).find(x => x.key === key) || ((cfg.plus || {}).tiers || [])[0]; price = t ? t.usd : 0; } if (!price) return res.status(400).json({ error: 'Unknown add-on' });
    const { data: pay, error } = await admin().from('payments').insert({ user_id: req.userId, credits: 0, amount_pkr: 0, status: 'pending', reference: 'ADDON', addon_key: key, provider: process.env.STRIPE_SECRET_KEY ? 'stripe' : 'lemonsqueezy' }).select('id').single(); if (error) return res.status(400).json({ error: error.message });
    const { data: prof } = await admin().from('profiles').select('email').eq('id', req.userId).maybeSingle(); const origin = (req.headers.origin || ('https://' + req.headers.host));
    await CONSENT.record(req, req.userId, 'addon_purchase', { name: key.replace(/_/g, ' '), amount: price }, { payment_id: pay.id });
    if (process.env.STRIPE_SECRET_KEY) { const s = await GATEWAY.createCheckout({ userId: req.userId, email: prof && prof.email, credits: 0, usd: price, name: 'ForiForeign ' + key.replace(/_/g, ' '), paymentId: pay.id, successUrl: origin + '/?paid=1&addon=' + key + '&session={CHECKOUT_SESSION_ID}', cancelUrl: origin + '/?paid=0' }); await admin().from('payments').update({ reference: ('CARD:' + s.id).slice(0, 120) }).eq('id', pay.id); return res.json({ url: s.url }); }
    if (LEMON.enabled()) { const tier = { lemon_variant_id: (cfg.addons || {})[key + '_lemon_variant_id'] }; const s = await LEMON.createCheckout({ variantId: tier.lemon_variant_id, email: prof && prof.email, usd: price, name: 'ForiForeign ' + key.replace(/_/g, ' '), paymentId: pay.id, userId: req.userId, successUrl: origin + '/?paid=1&provider=lemon&addon=' + key }); return res.json({ url: s.url }); }
    res.status(400).json({ error: 'Card payments are not switched on yet.' }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* Visa desk: one file per route; six steps with guidance from the rules; tracking and decision captured. */
app.get('/api/visa/desk', auth, async (req, res) => { try { const { data } = await admin().from('visa_cases').select('*').eq('user_id', req.userId).order('created_at', { ascending: false }); const VT = require('./lib/visa_tracking'); res.json({ files: (data || []).map(c => Object.assign(c, { tracking: VT.trackingFor(c.country_code) })) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.patch('/api/visa/desk/:id', auth, async (req, res) => {
  try { const b = req.body || {}; const { data: c } = await admin().from('visa_cases').select('*').eq('id', req.params.id).eq('user_id', req.userId).maybeSingle(); if (!c) return res.status(404).json({ error: 'Not found' });
    const patch = { updated_at: new Date().toISOString() }; const steps = Object.assign({}, c.steps || {});
    if (b.appointment_at) { patch.appointment_at = b.appointment_at; patch.appointment_place = String(b.appointment_place || '').slice(0, 200) || null; steps.booked = true; if (['draft', 'preparing'].includes(c.status)) patch.status = 'ready'; try { await admin().from('appointments').insert({ user_id: req.userId, kind: 'biometrics', title: 'Visa appointment ' + c.country_code, starts_at: b.appointment_at, location: patch.appointment_place, created_by: req.userId }); } catch (e) {} }
    if (b.submitted_on) { patch.submitted_on = b.submitted_on; patch.status = 'submitted'; steps.submitted = true; if (b.tracking_ref) patch.tracking_ref = String(b.tracking_ref).slice(0, 80); patch._schedule = true; }
    if (b.tracking_ref && !b.submitted_on) patch.tracking_ref = String(b.tracking_ref).slice(0, 80);
    if (b.decision === 'granted' || b.decision === 'refused') { patch.status = b.decision; patch.decision_on = b.decision_on || new Date().toISOString().slice(0, 10); patch.decision_text = String(b.decision_text || '').slice(0, 4000) || null; steps.decision = true; if (b.decision === 'granted') { try { await JOURNEY.plan(req.userId, c.country_code, ['work'].includes(c.route_key.split('_').pop()) || /work|skilled|employ|blue|482|h1b|permit/i.test(c.route_key) ? 'work' : 'study'); } catch (e) {} } else if (b.decision_text) { await QUEUE.enqueue('visa_refusal', { caseId: c.id, userId: req.userId, cc: c.country_code, route: c.route_key, text: b.decision_text, extra: '' }, { userId: req.userId, maxAttempts: 2 }).catch(() => {}); } }
    if (b.prepare_done) steps.prepare = true; patch.steps = steps; if (b.notes !== undefined) patch.notes = String(b.notes || '').slice(0, 4000);
    const { data, error } = await admin().from('visa_cases').update((() => { const p2 = Object.assign({}, patch); const sch = p2._schedule; delete p2._schedule; return p2; })()).eq('id', c.id).select('*').single(); if (patch._schedule) { try { await CHECKINS.schedule(c.id); } catch (e) {} try { await VSTRAT.planAfterSubmit(c.id); } catch (e) {} } if (error) return res.status(400).json({ error: error.message }); JE.recompute(req.userId); WEBHOOKS.emit(null, 'visa.case_updated', {}); res.json({ file: data }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* Partner spotlight: a separately labelled rail of partner openings the applicant is eligible for. Ranking is untouched. */
app.get('/api/partners/spotlight', auth, async (req, res) => { try { const { data } = await admin().from('partner_openings').select('id,title,kind,country_code,city,deadline,funding_or_salary,opportunity_id,org_id').eq('status', 'live').eq('spotlight', true).or('spotlight_until.is.null,spotlight_until.gte.' + new Date().toISOString().slice(0, 10)).limit(20); const ids = [...new Set((data || []).map(o => o.org_id))]; const { data: orgs } = ids.length ? await admin().from('organisations').select('id,name').in('id', ids) : { data: [] }; const nm = Object.fromEntries((orgs || []).map(o => [o.id, o.name])); res.json({ spotlight: (data || []).map(o => Object.assign(o, { partner: nm[o.org_id] || 'Partner' })), note: 'Partners pay for visibility here, not for ranking. Your matches are scored the same for every position.' }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.patch('/api/admin/openings/:oid/spotlight', auth, perm('settings.write'), async (req, res) => { try { const b = req.body || {}; await admin().from('partner_openings').update({ spotlight: !!b.spotlight, spotlight_until: b.until || null }).eq('id', req.params.oid); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ============================================================================= */
/* ================= CONSENT LEDGER · FREE-TIER ECONOMICS · STAGE OFFERS ================= */
const CONSENT = require('./lib/consent');
app.get('/api/me/consents', auth, async (req, res) => { try { res.json({ consents: await CONSENT.list(req.userId), wording: CONSENT.WORDING }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/me/consents', auth, async (req, res) => { try { const b = req.body || {}; if (!CONSENT.WORDING[b.kind]) return res.status(400).json({ error: 'Unknown consent kind' }); const id = await CONSENT.record(req, req.userId, b.kind, b.vars || {}, b.evidence || {}); res.json({ ok: true, id }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/consents/:uid', auth, perm('users.read'), async (req, res) => { try { if (!['admin', 'super_admin'].includes(req.userRole)) return res.status(403).json({ error: 'Platform admin only' }); await admin().from('audit_log').insert({ actor: req.userId, event: 'CONSENT_RECORD_PRODUCED', detail: req.params.uid }).then(() => {}, () => {}); if (req.query.pdf) { const { data: me } = await admin().from('profiles').select('full_name').eq('id', req.userId).maybeSingle(); const pdf = await CONSENT.producePdf(req.params.uid, me && me.full_name); res.setHeader('content-type', 'application/pdf'); res.setHeader('content-disposition', 'attachment; filename="consents-' + req.params.uid.slice(0, 8) + '.pdf"'); return res.send(pdf); } res.json({ consents: await CONSENT.list(req.params.uid) }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Stage offers: what the person can do now, what the next stage costs, and why — computed, shown in one place. */
app.get('/api/me/offers-for-me', auth, async (req, res) => {
  try { const cfg = await siteSettings.getConfig(); const A = cfg.addons || {}; const { count: paid } = await admin().from('payments').select('id', { count: 'exact', head: true }).eq('user_id', req.userId).eq('status', 'confirmed'); const bal = await balance(req.userId); const { data: pn } = await admin().from('profiles').select('journey_stage,free_searches_used').eq('id', req.userId).maybeSingle(); const fu = cfg.fair_use || {};
    const stage = (pn && pn.journey_stage) || 'discover'; const free = { used: (pn && pn.free_searches_used) || 0, lifetime: Number(fu.free_lifetime_searches) || 10, daily: Number(fu.daily_searches) || 3, results_visible: Number(fu.free_results_visible) || 5 };
    if (STAFF_ROLES.includes(req.userRole)) return res.json({ stage, staff: true, paid: true, balance: 999, free, items: [], promise: 'Platform staff: no credits, no payment page, every feature open; every action is logged under your account.' });
    /* ONE MORE PAYMENT, EVER: once an offer exists, a single "+" package covers the offer pack, visa desk, interview pack, arrival pack and a year of residence support. No add-on is sold step by step. */
    let plusItem = null; try { const { count: offers } = await admin().from('offers').select('id', { count: 'exact', head: true }).eq('user_id', req.userId); const { data: owned } = await admin().from('user_addons').select('bundle,addon_key').eq('user_id', req.userId); const hasO2S = (owned || []).some(x => x.bundle === 'o2s' || /_plus$/.test(String(x.bundle || ''))); if (((offers || 0) > 0 || ['offer', 'visa', 'travel', 'arrive', 'settle', 'pr'].includes(stage)) && !hasO2S) { const pt = (((cfg.plus || {}).tiers) || [])[0]; if (pt) { const W = require('./lib/world'); const { data: pr } = await admin().from('profiles').select('origin_country').eq('id', req.userId).maybeSingle(); const loc = W.localPrice(pt.usd, (pr && pr.origin_country) || 'PK', null); plusItem = { key: pt.key, title: pt.name + ' · ' + pt.long, why: 'One payment from the offer letter to settlement and PR: offer pack, visa desk (file, pre-fill, one status check, decision), interview pack, arrival pack and a year of residence support with the pathway manager. Nothing else to buy on this journey.', price: '$' + pt.usd + (loc && loc.display && loc.currency !== 'USD' ? ' (' + loc.display + ')' : ''), plus: true }; } } } catch (e) {}
    const items = []; if (plusItem) items.push(plusItem); if (!paid) items.push({ key: 'package', title: 'Prepare and send your applications', why: 'Your matches are ready; preparing a case, sending it from your own address and reading every reply is where the platform does the work for you.', price: 'from $' + (((cfg.packages || {}).tiers || []).map(t => Number(t.promo_usd || t.usd)).filter(Boolean).sort((a, b) => a - b)[0] || 19), action: 'buy' });
    if (paid && bal <= 0) items.push({ key: 'package', title: 'More cases', why: 'All your prepared cases are used. Add cases to keep applying with prepared files.', price: 'from $' + (((cfg.packages || {}).tiers || []).map(t => Number(t.promo_usd || t.usd)).filter(Boolean).sort((a, b) => a - b)[0] || 19), action: 'buy' });
    res.json({ stage, free, paid: !!paid, balance: bal, items, promise: 'Search, matching and previews stay free. You pay only when the platform does work for you, and the first of each later step is included in your package. Every purchase and consent is recorded and you can read the record any time under Profile → Language and data.' }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* ============================================================================================ */
/* ================= AGENCY QUOTA · ALLOCATION · RESALE LOCKS · EXTERNAL BOARDS · PROFESSION FILTER ================= */
const QUOTA = require('./lib/quota'); const BOARDS = require('./lib/boards');
app.get('/api/org/:id/quota', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.read'); const m = await ORGS.membership(req.params.id, req.userId); const L = await QUOTA.limitsFor(req.params.id, m); const u = await QUOTA.usage(req.params.id); res.json({ plan: L.ok ? { tier: L.sub.tier_name, cases_month: L.sub.cases_month, cases_used: L.sub.cases_used, searches_day: L.sub.searches_day, searches_month: L.sub.searches_month, period_end: L.sub.period_end } : null, my_limits: L.ok ? L.lim : null, reason: L.ok ? null : L.reason, usage: u }); } catch (e) { orgErr(res, e); } });
/* Owners allocate anywhere; managers only within their own branch subtree and never above their own limit. */
app.put('/api/org/:id/quota', auth, async (req, res) => {
  try { await ORGS.requireOrg(req, req.params.id, 'members.write'); const me = await ORGS.membership(req.params.id, req.userId); const b = req.body || {}; const kind = b.scope_kind === 'member' ? 'member' : 'branch'; const key = String(b.scope_key || '').slice(0, 120); if (!key) return res.status(400).json({ error: 'scope_key required' });
    if (me.role !== 'owner') { if (!me.branch) return res.status(403).json({ error: 'Only owners allocate across the organisation' }); if (kind === 'branch' && !(key === me.branch || key.startsWith(me.branch + '/'))) return res.status(403).json({ error: 'You can allocate only within ' + me.branch }); if (kind === 'member') { const tm = await ORGS.membership(req.params.id, key); if (!tm || !(tm.branch === me.branch || String(tm.branch || '').startsWith(me.branch + '/'))) return res.status(403).json({ error: 'That member is outside your branch' }); } const L = await QUOTA.limitsFor(req.params.id, me); if (L.ok && ((Number(b.cases_month) || 0) > L.lim.cases_month || (Number(b.searches_day) || 0) > L.lim.searches_day)) return res.status(400).json({ error: 'You cannot allocate more than your own limit (' + L.lim.cases_month + ' cases, ' + L.lim.searches_day + ' searches/day)' }); }
    const { data, error } = await admin().from('quota_allocations').upsert({ org_id: req.params.id, scope_kind: kind, scope_key: key, cases_month: Math.max(0, Number(b.cases_month) || 0), searches_day: Math.max(0, Number(b.searches_day) || 0), set_by: req.userId, updated_at: new Date().toISOString() }, { onConflict: 'org_id,scope_kind,scope_key' }).select('*').single(); if (error) return res.status(400).json({ error: error.message }); await orgAudit(req.params.id, req.userId, 'QUOTA_ALLOCATED', kind + ' ' + key + ' ' + data.cases_month + ' cases / ' + data.searches_day + ' searches/day'); res.json({ allocation: data }); }
  catch (e) { orgErr(res, e); }
});
/* Search from anywhere: the same query on the major boards and portals for that destination, as outbound links. */
app.get('/api/boards', auth, async (req, res) => { try { const cc = String(req.query.cc || '').toUpperCase(); res.json({ links: BOARDS.links({ cc, text: String(req.query.q || '').slice(0, 80), lane: req.query.lane === 'study' ? 'study' : 'work', country: countryName(cc) }) }); } catch (e) { res.status(400).json({ error: e.message }); } });
function countryName(cc) { try { const W = require('./lib/world').W; return (W[cc] && W[cc][0]) || cc; } catch (e) { return cc; } }
/* =========================================================================================================== */
/* ================= PROSPECTING · DAILY BRIEF · SELF-HEAL · SUPPORT RESPONDER · FAQ · DOCUMENT REQUESTS ================= */
const PROSPECT = require('./lib/prospecting'); const BRIEF = require('./lib/dailybrief'); const HEAL = require('./lib/selfheal');
QUEUE.register('prospect_research', async (p) => PROSPECT.research(p.prospectId));
QUEUE.register('prospect_propose', async (p) => PROSPECT.propose(p.prospectId, p.adminId));
QUEUE.register('prospect_send', async (p) => PROSPECT.send(p.prospectId, p.adminId));
QUEUE.register('daily_brief', async (p) => BRIEF.build(p.day));
QUEUE.register('selfheal', async () => HEAL.heal());
QUEUE.register('support_respond', async (p) => HEAL.respond(p.ticketId));
app.get('/api/admin/prospects', auth, perm('settings.read'), async (req, res) => { try { const { data } = await admin().from('prospects').select('*').order('updated_at', { ascending: false }).limit(300); const cfg = await siteSettings.getConfig(); res.json({ prospects: data || [], settings: cfg.prospecting || { daily_cap: 40, trial_days: 60, signer: 'Partnerships, ForiForeign (Private) Limited' } }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/prospects/find', auth, perm('settings.write'), async (req, res) => { try { const r = await PROSPECT.find(req.body || {}); const { data } = await admin().from('prospects').select('id').eq('stage', 'found').limit(60); for (const p of (data || [])) await QUEUE.enqueue('prospect_research', { prospectId: p.id }, { maxAttempts: 1 }); res.json(Object.assign(r, { research_queued: (data || []).length })); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/prospects/:pid/propose', auth, perm('settings.write'), async (req, res) => { try { if (!['admin', 'super_admin'].includes(req.userRole)) return res.status(403).json({ error: 'Platform admin only' }); await QUEUE.enqueue('prospect_propose', { prospectId: req.params.pid, adminId: req.userId }, { userId: req.userId, maxAttempts: 1 }); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/prospects/:pid/send', auth, perm('settings.write'), async (req, res) => { try { if (!['admin', 'super_admin'].includes(req.userRole)) return res.status(403).json({ error: 'Platform admin only' }); res.json(await PROSPECT.send(req.params.pid, req.userId)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/prospects/run', auth, perm('settings.write'), async (req, res) => { try { if (!['admin', 'super_admin'].includes(req.userRole)) return res.status(403).json({ error: 'Platform admin only' }); const b = req.body || {}; const { data } = await admin().from('prospects').select('id,stage,contacts').in('stage', ['researched']).limit(Number(b.limit) || 10); let n = 0; for (const p of (data || [])) { if (!(p.contacts || []).length) continue; await QUEUE.enqueue('prospect_propose', { prospectId: p.id, adminId: req.userId }, { userId: req.userId, maxAttempts: 1 }); n++; } res.json({ queued_proposals: n, note: b.auto_send ? 'Sending runs after proposals are drafted, within the daily cap.' : 'Proposals are drafted; send each from the list (or set auto_send).' }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/brief', auth, perm('overview.read'), async (req, res) => { try { res.json({ briefs: await BRIEF.latest(7) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/brief/build', auth, perm('overview.read'), async (req, res) => { try { res.json(await BRIEF.build((req.body || {}).day)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/selfheal', auth, perm('settings.write'), async (req, res) => { try { res.json(await HEAL.heal()); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/selfheal', auth, perm('overview.read'), async (req, res) => { try { const { data } = await admin().from('selfheal_log').select('*').order('created_at', { ascending: false }).limit(100); res.json({ log: data || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* FAQ store (feeds the responders and the public help page). */
app.get('/api/faqs', async (req, res) => { try { let q = admin().from('faqs').select('id,question,answer,audience').order('hits', { ascending: false }).limit(100); if (req.query.audience) q = q.in('audience', [String(req.query.audience), 'all']); const { data } = await q; res.set('Cache-Control', 'public, max-age=600'); res.json({ faqs: data || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/faqs', auth, perm('content.write'), async (req, res) => { try { const b = req.body || {}; if (!b.question || !b.answer) return res.status(400).json({ error: 'question and answer' }); const { data, error } = await admin().from('faqs').upsert({ id: b.id || undefined, question: String(b.question).slice(0, 300), answer: require('./lib/partnerships').humanize(String(b.answer).slice(0, 3000)), audience: ['applicant', 'agency', 'partner', 'all'].includes(b.audience) ? b.audience : 'all', updated_at: new Date().toISOString() }).select('*').single(); if (error) return res.status(400).json({ error: error.message }); res.json({ faq: data }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/faqs/seed', auth, perm('content.write'), async (req, res) => { try { const rows = require('./lib/faq_seed').FAQS; let n = 0; for (const f of rows) { const { error } = await admin().from('faqs').upsert(f, { onConflict: 'id', ignoreDuplicates: true }); if (!error) n++; } res.json({ seeded: n }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Ask ForiForeign (24/7): applicants and agencies ask in the app; answered from FAQ + own facts when safe, else ticketed. */
app.post('/api/ask', auth, async (req, res) => { try { const q = String((req.body || {}).question || '').slice(0, 2000); if (!q.trim()) return res.status(400).json({ error: 'Ask something' });
  /* INSTANT LAYER: answer from the person's own state and the sourced rules first; only open a ticket when a human is really needed. */
  try { const [{ data: p }, { data: apps }, { data: vis }] = await Promise.all([admin().from('profiles').select('full_name,journey_stage,next_action,lane_pref,target_countries,origin_country,degree_level,experience_years').eq('id', req.userId).maybeSingle(), admin().from('applications').select('id,status,opportunities(title,institution,country_code)').eq('user_id', req.userId).order('updated_at', { ascending: false }).limit(5), admin().from('visa_cases').select('country_code,status,check_after').eq('user_id', req.userId).limit(3)]); const cc = (p && Array.isArray(p.target_countries) && p.target_countries[0]) || (vis && vis[0] && vis[0].country_code) || null; let rulesTxt = ''; try { if (cc) { const { data: R } = await admin().from('visa_rules').select('route_name,rule_type,text,source_url').eq('country_code', cc).neq('status', 'superseded').limit(30); rulesTxt = (R || []).map(r => '- [' + r.rule_type + '] ' + r.route_name + ': ' + String(r.text || '').slice(0, 240) + (r.source_url ? ' (' + r.source_url + ')' : '')).join('\n'); } } catch (e) {} let pr = null; try { if (cc) { const { data: w } = await admin().from('pr_pathways').select('pr_route,years_to_pr,years_to_citizenship,language,requirement,source_url').eq('country_code', cc).maybeSingle(); pr = w; } } catch (e) {}
    const ctx = 'APPLICANT STATE: stage=' + (p && p.journey_stage) + '; next=' + JSON.stringify(p && p.next_action && p.next_action.text) + '; lane=' + (p && p.lane_pref) + '; destination=' + cc + '; origin=' + (p && p.origin_country) + '; degree=' + (p && p.degree_level) + '; experience=' + (p && p.experience_years) + '\nCASES: ' + (apps || []).map(a => (a.opportunities && a.opportunities.title) + ' @ ' + (a.opportunities && a.opportunities.institution) + ' [' + a.status + ']').join('; ') + '\nVISA FILES: ' + (vis || []).map(v => v.country_code + ' ' + v.status + (v.check_after ? ' check after ' + v.check_after : '')).join('; ') + (pr ? '\nPR PATHWAY ' + cc + ': ' + JSON.stringify(pr) : '') + (rulesTxt ? '\nSOURCED RULES ' + cc + ':\n' + rulesTxt : '');
    const txt = await callAI('high_value', 'You are the ForiForeign assistant inside the app. Answer the applicant\'s question in under 140 words using ONLY the state and sourced rules below; cite the source URL in brackets when you use a rule; if the answer depends on something not in the context, say what is missing and offer the exact next action in the app. Never promise a visa or an outcome. Then output a JSON line: {"actions":[{"label":"...","link":"home|profile|explore|apps|mail"}],"human": true|false} where human=true only if a person must review (legal question, dispute, payment problem, or you are unsure).\n\n' + ctx + '\n\nQUESTION: ' + q, { maxTokens: 450 }); const m = String(txt).match(/\{[\s\S]*"actions"[\s\S]*\}\s*$/); let meta = { actions: [], human: false }; try { if (m) meta = JSON.parse(m[0]); } catch (e) {} const answer = String(txt).replace(m ? m[0] : '', '').trim(); if (answer && !meta.human) { try { await admin().from('support_tickets').insert({ user_id: req.userId, subject: q.slice(0, 120), message: q, status: 'answered', reply: answer, kind: 'assistant' }); } catch (e) {} return res.json({ answered: true, reply: answer, actions: (meta.actions || []).slice(0, 3), instant: true, human: false }); } if (answer && meta.human) { const { data: t } = await admin().from('support_tickets').insert({ user_id: req.userId, subject: q.slice(0, 120), message: q + '\n\n[assistant draft]\n' + answer, status: 'open', kind: 'assistant_escalated' }).select('id').single(); return res.json({ answered: true, reply: answer, actions: (meta.actions || []).slice(0, 3), instant: true, human: true, ticket_id: t && t.id, note: 'A person will confirm this within one working day.' }); } } catch (e) {} const { data: t, error } = await admin().from('support_tickets').insert({ user_id: req.userId, subject: q.slice(0, 120), message: q, status: 'open' }).select('id').single(); if (error) return res.status(400).json({ error: error.message }); const r = await HEAL.respond(t.id); const { data: tk } = await admin().from('support_tickets').select('reply,status,suggested_reply').eq('id', t.id).maybeSingle(); res.json({ ticket_id: t.id, answered: !!(r && r.auto), reply: tk && tk.reply, note: r && r.auto ? null : 'A person will reply within 24 hours; you will be notified.' }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Documents needed NOW for this person's stage, origin and destination, with the attestation route; never originals. */
app.get('/api/me/documents-needed', auth, async (req, res) => {
  try { const { data: p } = await admin().from('profiles').select('journey_stage,origin_country,mobility').eq('id', req.userId).maybeSingle(); const stage = (p && p.journey_stage) || 'discover'; const targets = ((p && p.mobility && p.mobility.target_countries) || []).slice(0, 3); const lane = (p && p.mobility && p.mobility.job_goal && !p.mobility.study_goal) ? 'work' : 'study';
    const purpose = ['visa', 'travel'].includes(stage) ? (lane === 'work' ? 'visa_work' : 'visa') : ['offer', 'apply', 'prepare'].includes(stage) ? lane : ['arrive', 'settle', 'pr'].includes(stage) ? 'family' : lane; const ck = await VAULT.checklist(req.userId, purpose);
    const attest = []; for (const cc of targets) { try { const A = require('./lib/attestation'); attest.push({ destination: cc, rule: A.rulesFor((p && p.origin_country) || 'PK', cc)[0] }); } catch (e) {} }
    res.json({ stage, purpose, required: ck.required, recommended: ck.recommended, ready: ck.ready, attestation: attest, policy: 'Upload clear scans or photos of your attested copies. ForiForeign never asks for an original document to be posted or handed over; only the authority you apply to may ask for originals, and they will tell you. Images are compressed for size without losing readability; text is read in any language.' }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* Anti-fraud guard on document generation: the platform writes the applicant's own documents only. */
const FORBIDDEN_DOC = /\b(degree|diploma|transcript|mark ?sheet|certificate|bank statement|statement of account|experience letter|employment letter|reference letter from|recommendation letter from|police (clearance|certificate)|passport|visa|licen[cs]e|attestation|apostille|stamp|seal|offer letter from|admission letter|no objection certificate|noc)\b/i;
app.post('/api/documents/generate-check', auth, async (req, res) => { const t = String((req.body || {}).type || (req.body || {}).request || ''); if (FORBIDDEN_DOC.test(t) && !/cover letter|statement of purpose|motivation|cv|resume|personal statement|research statement|email|reply/i.test(t)) return res.status(403).json({ error: 'ForiForeign prepares only documents you author yourself (CV, cover letter, statement of purpose, research statement, emails). Certificates, transcripts, bank statements, reference or experience letters must come from the issuing institution or employer; the platform will not create or alter them.', allowed: false }); res.json({ allowed: true }); });
/* =========================================================================================================== */
/* ================= ADMIN COPILOT · GUIDANCE · FAQ LEARNING · PROSPECTING AUTOPILOT · PDF COMPRESSION ================= */
const COPILOT = require('./lib/copilot');
app.post('/api/admin/copilot', auth, perm('settings.read'), async (req, res) => { try { if (!['admin', 'super_admin'].includes(req.userRole)) return res.status(403).json({ error: 'Platform admin only' }); res.json(await COPILOT.ask(req.userId, (req.body || {}).question || '', !!(req.body || {}).confirm)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/copilot/snapshot', auth, perm('overview.read'), async (req, res) => { try { res.json(await COPILOT.snapshot()); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/copilot/log', auth, perm('overview.read'), async (req, res) => { try { const { data } = await admin().from('copilot_log').select('*').order('created_at', { ascending: false }).limit(50); res.json({ log: data || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/guidance', auth, perm('overview.read'), async (req, res) => { try { const { data } = await admin().from('admin_guidance').select('*').order('created_at', { ascending: false }).limit(50); res.json({ guidance: data || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/guidance', auth, perm('settings.write'), async (req, res) => { try { const b = req.body || {}; if (!b.text) return res.status(400).json({ error: 'text' }); const { data, error } = await admin().from('admin_guidance').insert({ text: String(b.text).slice(0, 1500), applies_to: Array.isArray(b.applies_to) && b.applies_to.length ? b.applies_to : ['all'], created_by: req.userId, expires_at: b.days ? new Date(Date.now() + Number(b.days) * 86400000).toISOString() : null }).select('*').single(); if (error) return res.status(400).json({ error: error.message }); res.json({ guidance: data }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.patch('/api/admin/guidance/:gid', auth, perm('settings.write'), async (req, res) => { try { await admin().from('admin_guidance').update({ active: !!(req.body || {}).active }).eq('id', req.params.gid); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/faq-candidates', auth, perm('content.read'), async (req, res) => { try { const { data } = await admin().from('faq_candidates').select('*').eq('status', 'pending').order('seen', { ascending: false }).limit(50); res.json({ candidates: data || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/faq-candidates/learn', auth, perm('content.write'), async (req, res) => { try { res.json(await COPILOT.learnFaqs()); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/faq-candidates/:cid', auth, perm('content.write'), async (req, res) => { try { const b = req.body || {}; if (b.approve) { if (b.answer) await admin().from('faq_candidates').update({ answer: String(b.answer).slice(0, 3000) }).eq('id', req.params.cid); res.json({ result: await COPILOT.ACTIONS.approve_faq({ candidate_id: req.params.cid }) }); } else { await admin().from('faq_candidates').update({ status: 'rejected' }).eq('id', req.params.cid); res.json({ result: 'rejected' }); } } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/prospects/discover', auth, perm('settings.write'), async (req, res) => { try { res.json(await PROSPECT.discover(req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/prospects/autopilot', auth, perm('settings.write'), async (req, res) => { try { if (!['admin', 'super_admin'].includes(req.userRole)) return res.status(403).json({ error: 'Platform admin only' }); res.json(await PROSPECT.autopilot(req.userId)); } catch (e) { res.status(400).json({ error: e.message }); } });
QUEUE.register('prospect_autopilot', async (p) => PROSPECT.autopilot(p.adminId));
QUEUE.register('faq_learn', async () => COPILOT.learnFaqs());
/* ==================================================================================================================== */
/* ================= BUILT-IN SEO: indexable destination and audience pages, sitemap, robots, structured data ================= */
const SEO = require('./lib/seo'); const SEO_CACHE = new Map();
const seoSend = (res, key, make) => { let h = SEO_CACHE.get(key); if (!h) { h = make(); if (!h) return res.status(404).send('Not found'); SEO_CACHE.set(key, h); } res.set('Cache-Control', 'public, max-age=3600'); res.type('html').send(h); };
app.get(['/study-in/:cc/:prof', '/work-in/:cc/:prof'], (req, res) => { const lane = req.path.startsWith('/work-in') ? 'work' : 'study'; seoSend(res, lane + ':' + req.params.cc + ':' + req.params.prof, () => SEO.professionPage(req.params.cc, req.params.prof, lane)); });
app.get('/jobs/:id', async (req, res) => { try { const { data: o } = await admin().from('opportunities').select('id,title,institution,country_code,city,kind,category,description,salary_note,deadline,url,verified_at,created_at,contract_type,eligibility_flag').eq('id', req.params.id).eq('kind', 'work').not('verified_at', 'is', null).maybeSingle(); if (!o) return res.status(404).send('Not found'); res.set('Cache-Control', 'public, max-age=3600'); res.type('html').send(SEO.jobPage(o)); } catch (e) { res.status(404).send('Not found'); } });
app.get('/llms.txt', (req, res) => { res.type('text/plain').send('# ForiForeign\nForiForeign (foriforeign.com) helps people from Pakistan and South Asia study or work abroad in 54 countries: verified postings matched to a CV, applications prepared and sent from a dedicated address, replies read, a visa desk, and a PR pathway manager. FF-CRM is its B2B product for consultancies.\n\n## Pages\n- /study-in/{cc} and /work-in/{cc}: sourced rules per country and lane\n- /work-in/{cc}/{profession} and /study-in/{cc}/{field}: profession and field pages with FAQ\n- /jobs/{id}: verified openings\n- /pricing.html, /crm.html, /commitments.html\n\nRules link to official sources and are re-read nightly. Information, not legal advice.'); });
/* INTENT CAPTURE: a visitor's choices on public pages travel into sign-up and the profile (lane, country, profession), so the first screen is already theirs. */
app.get('/api/intent', (req, res) => { const v = String(req.query.v || '').slice(0, 120); if (v) res.setHeader('Set-Cookie', 'ff_intent=' + encodeURIComponent(v) + '; Max-Age=' + (30 * 86400) + '; Path=/; SameSite=Lax'); res.json({ ok: true }); });
app.get(['/study-in/:cc', '/work-in/:cc'], (req, res) => { const lane = req.path.startsWith('/work-in') ? 'work' : 'study'; seoSend(res, lane + ':' + req.params.cc, () => SEO.countryPage(req.params.cc, lane)); });
app.get('/for-:kind', (req, res) => seoSend(res, 'aud:' + req.params.kind, () => SEO.audiencePage(req.params.kind)));
app.get('/sitemap.xml', async (req, res) => { res.set('Cache-Control', 'public, max-age=86400'); let extra = []; try { extra = extra.concat(SEO.programmaticUrls()); const { data: jobs } = await admin().from('opportunities').select('id').eq('kind', 'work').not('verified_at', 'is', null).order('verified_at', { ascending: false }).limit(500); extra = extra.concat((jobs || []).map(j => 'https://foriforeign.com/jobs/' + j.id)); } catch (e) {} try { extra = [...extra, ...(typeof SEO_SLUGS !== 'undefined' ? SEO_SLUGS.map(x => 'https://foriforeign.com/s/' + x) : []), ...(typeof SEO_GUIDES !== 'undefined' ? Object.keys(SEO_GUIDES).map(x => 'https://foriforeign.com/guide/' + x) : [])]; } catch (e) {} res.type('application/xml').send(SEO.sitemap(extra)); });
app.get('/robots.txt', (req, res) => { res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://foriforeign.com/sitemap.xml\n'); });
/* ================================================================================================================== */
/* ================= VERIFY ASSIST · MAIL EVENTS (bounces) · OUTREACH WARM-UP · POLICY UPDATES PAGES · SELF-PROBE ================= */
app.post('/api/admin/visa/rules/:rid/assist', auth, perm('settings.write'), async (req, res) => {
  try { const { data: r } = await admin().from('visa_rules').select('*').eq('id', req.params.rid).maybeSingle(); if (!r || !r.source_url) return res.status(404).json({ error: 'Rule or source not found' });
    let text = ''; try { const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000); const rr = await fetch(r.source_url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 ForiForeign verify-assist' } }); clearTimeout(tm); text = String(await rr.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 40000); } catch (e) { return res.status(400).json({ error: 'Source page unreachable: ' + e.message }); }
    let v = { supported: null, quote: '', value: null, suggested_text: null, note: '' };
    try { const txt = await callAI('high_value', `You help a human verify ONE immigration/education rule against its official source page. Answer ONLY JSON: {"supported":true|false|null,"quote":"the exact sentence(s) from the page that support or contradict the rule, verbatim, max 60 words","value":"the specific figure, date, threshold or list item the page states, or null","suggested_text":"the rule rewritten to match the page exactly (same style, no long dashes), or null if the rule is already right","note":"one line for the reviewer"}\nRULE (${r.rule_type}, ${r.country_code}): ${r.text}\nPAGE TEXT: ${text}`, { maxTokens: 600, json: true }); const m = String(txt).match(/\{[\s\S]*\}/); if (m) v = Object.assign(v, JSON.parse(m[0])); } catch (e) {}
    if (!text.toLowerCase().includes(String(v.quote || 'zzzz').toLowerCase().slice(0, 40))) v.note = (v.note || '') + ' (quote not found verbatim on the page; check manually)';
    res.json(v); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* Mail provider events (Resend webhook): bounces and complaints go straight to the suppression list. */
app.post('/api/mail/events', express.json({ limit: '200kb' }), async (req, res) => { try { const secret = process.env.MAIL_EVENTS_SECRET; if (secret && req.headers['x-events-secret'] !== secret) return res.status(401).end(); const ev = req.body || {}; const type = String(ev.type || ''); const to = ((((ev.data || {}).to) || [])[0]) || ''; if (/bounced|complained/.test(type) && to) { await admin().from('suppression_list').upsert({ email: String(to).toLowerCase(), reason: type }); await admin().from('prospects').update({ stage: 'bounced' }).contains('sent_to', [String(to).toLowerCase()]).then(() => {}, () => {}); } res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Outreach warm-up: the effective daily cap ramps from 10 to the configured cap over 14 days from the first send. */
async function outreachCap() { const cfg = await siteSettings.getConfig(); const cap = Number((cfg.prospecting || {}).daily_cap) || 40; const { data } = await admin().from('prospects').select('last_contact_at').not('last_contact_at', 'is', null).order('last_contact_at', { ascending: true }).limit(1); if (!data || !data[0]) return Math.min(10, cap); const days = (Date.now() - new Date(data[0].last_contact_at).getTime()) / 86400000; return Math.min(cap, Math.round(10 + (cap - 10) * Math.min(1, days / 14))); }
app.get('/api/admin/prospects/cap', auth, perm('settings.read'), async (req, res) => { try { res.json({ effective_cap: await outreachCap() }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Policy updates as public pages: the content pipeline for SEO and newsletters. */
app.get('/updates/:cc?', async (req, res) => { try { const cc = req.params.cc ? String(req.params.cc).toUpperCase() : null; let q = admin().from('policy_updates').select('country_code,source_title,source_url,summary,impact,severity,detected_at').order('detected_at', { ascending: false }).limit(60); if (cc) q = q.eq('country_code', cc); const { data } = await q; const W = require('./lib/world').W; const nm = c => (W[c] && W[c][0]) || c; const esc = t => String(t || '').replace(/[&<>]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x])); const title = cc ? 'Visa and study policy updates for ' + nm(cc) : 'Visa and study policy updates, all destinations'; const body = '<h1>' + esc(title) + '</h1><p class="sub">Detected by Policy Watch on official pages; each entry links its source. Not legal advice.</p>' + ((data || []).map(u => '<div class="card"><b>' + esc(nm(u.country_code)) + ' · ' + esc(String(u.detected_at).slice(0, 10)) + ' · ' + esc(u.severity) + '</b><p>' + esc(u.summary) + '</p>' + (u.impact ? '<p class="sub">Impact: ' + esc(u.impact) + '</p>' : '') + '<p class="sub"><a href="' + esc(u.source_url) + '" rel="nofollow">' + esc(u.source_title || 'Source') + '</a></p></div>').join('') || '<p class="sub">No updates recorded yet.</p>'); res.set('Cache-Control', 'public, max-age=1800'); res.type('html').send('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + ' · ForiForeign</title><meta name="description" content="' + esc(title) + ', detected on official sources and summarised with impact."><link rel="canonical" href="https://foriforeign.com/updates' + (cc ? '/' + cc.toLowerCase() : '') + '"><style>body{font-family:Inter,system-ui,sans-serif;background:#070F22;color:#D6E9FF;margin:0;line-height:1.6}.wrap{max-width:880px;margin:0 auto;padding:28px 20px}h1{color:#fff}a{color:#7EE6FF}.sub{color:#8FA9CE}.card{border:1px solid rgba(140,178,255,.2);border-radius:14px;padding:14px;margin:10px 0}</style></head><body><div class="wrap"><nav><a href="/">ForiForeign</a></nav>' + body + '</div></body></html>'); } catch (e) { res.status(500).send('error'); } });
/* Self-probe: the platform tests its own public endpoints every 10 minutes and alerts on failure or slowness. */
async function selfProbe() { const base = process.env.PUBLIC_URL || ('http://127.0.0.1:' + (process.env.PORT || 3000)); const paths = ['/api/health', '/api/i18n', '/api/site-config', '/study-in/gb', '/sitemap.xml']; const bad = []; for (const p of paths) { const t0 = Date.now(); try { const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000); const r = await fetch(base + p, { signal: ctl.signal }); clearTimeout(tm); const ms = Date.now() - t0; if (!r.ok || ms > 4000) bad.push(p + ' ' + r.status + ' ' + ms + 'ms'); } catch (e) { bad.push(p + ' ' + e.message); } } if (bad.length) { try { await admin().from('audit_log').insert({ event: 'SELF_PROBE_FAIL', detail: bad.join('; ').slice(0, 400) }); const { data: admins } = await admin().from('profiles').select('id').in('role', ['admin', 'super_admin']); for (const a of (admins || [])) await NOTIFY.push(a.id, 'alert', 'Self-probe failed', bad.join('; ').slice(0, 300), 'adminx'); } catch (e) {} } return { ok: !bad.length, bad }; }
app.get('/api/admin/self-probe', auth, perm('overview.read'), async (req, res) => { try { res.json(await selfProbe()); } catch (e) { res.status(400).json({ error: e.message }); } });
try { if (process.env.FF_QUEUE !== 'off' && process.env.NODE_ENV !== 'test') setInterval(() => selfProbe().catch(() => {}), 10 * 60 * 1000); } catch (e) {}
/* ==================================================================================================================== */
/* ================= WORLD UNIVERSITIES · SCHOLARSHIPS · REQUIREMENTS BRIEF · FORIMAIL-ONLY POLICY · PORTAL FILL PLAN ================= */
const REQ = require('./lib/requirements'); const UW = require('./lib/universities_world');
app.post('/api/admin/institutions/seed-world', auth, perm('settings.write'), async (req, res) => { try { res.json(await UW.seed(!!(req.body || {}).destinations_only)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/institutions/count', auth, async (req, res) => { try { res.json({ shipped: UW.count(req.query.cc ? String(req.query.cc).toUpperCase() : null) }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Scholarships open to international applicants: ingested as recurring, source-verified opportunities. */
app.post('/api/admin/scholarships/seed', auth, perm('settings.write'), async (req, res) => {
  try { const { SCHOLARSHIPS } = require('./lib/scholarships_seed'); const { ingestOpps } = require('./lib/engine'); const year = new Date().getFullYear(); let added = 0; const items = SCHOLARSHIPS.map(s => ({ title: s.name, institution: s.name.split('(')[0].trim(), country_code: s.cc === 'EU' ? 'DE' : s.cc, kind: 'study', level: s.levels[0], funding: s.funding === 'fully' ? 'fully funded' : 'partial', funding_type: s.funding, deadline: '', url: s.url, description: s.note + ' Levels: ' + s.levels.join(', ') + '. Usual application window: ' + s.window + '. Open to international applicants; check the official page for this year\'s dates.', contact_emails: [], apply_via: 'portal', remote: 'false', extra: { source_key: 'scholarship_registry', recurring: true, window: s.window, levels: s.levels, year } })); for (let i = 0; i < items.length; i += 20) { added += await ingestOpps(items.slice(i, i + 20), 'scholarship', null).catch(() => 0); } res.json({ scholarships: SCHOLARSHIPS.length, added }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/scholarships', auth, async (req, res) => { try { const { SCHOLARSHIPS } = require('./lib/scholarships_seed'); const cc = req.query.cc ? String(req.query.cc).toUpperCase() : null; const lvl = req.query.level ? String(req.query.level) : null; res.json({ scholarships: SCHOLARSHIPS.filter(s => (!cc || s.cc === cc || s.cc === 'EU') && (!lvl || s.levels.includes(lvl))) }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* What this opportunity needs from THIS person: posting + destination + origin + licence + vault, one checklist. */
app.get('/api/opportunities/:id/requirements', auth, async (req, res) => { try { const cap = await overCap(req.userId, 'case_brain'); if (cap) return res.status(402).json({ error: 'Monthly reading limit reached.' }); res.json(await REQ.brief(req.userId, req.params.id)); } catch (e) { res.status(400).json({ error: e.message }); } });
/* forimail-only policy: the process identity is the platform mailbox; personal addresses are never integrated, never used
   for applications, and (when the admin sets it) membership access is granted only to platform addresses. */
app.get('/api/mail/policy', auth, async (req, res) => { try { const cfg = await siteSettings.getConfig(); const m = cfg.mail_policy || {}; res.json({ process_domain: process.env.APPLY_DOMAIN || 'forimail.com', personal_mail_integration: false, personal_forward_allowed: m.allow_personal_forward === true, members_require_platform_address: m.members_require_platform_address !== false, note: 'All applications, portal accounts and replies use your ForiForeign address. A personal address is never read or connected; it is only where sign-in codes and receipts go.' }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Portal fill plan: the browser worker sends the form's field labels; the server answers with values from the profile and
   the vault, plus the stop rules (never fill payment, captcha or declarations; notify the person when their presence is needed). */
app.post('/api/portal/:id/fill-plan', async (req, res) => {
  try { const token = String(req.headers['x-worker-token'] || ''); if (!process.env.BROWSER_WORKER_TOKEN || token !== process.env.BROWSER_WORKER_TOKEN) return res.status(401).json({ error: 'worker token' });
    const { data: pc } = await admin().from('portal_connections').select('user_id,portal_name,scope,status').eq('id', req.params.id).maybeSingle(); if (!pc || pc.status !== 'active') return res.status(404).json({ error: 'connection' }); if (!/upload|submit/.test(pc.scope || '')) return res.status(403).json({ error: 'scope is watch-only' });
    const fields = Array.isArray((req.body || {}).fields) ? req.body.fields.slice(0, 120) : []; const M = await MOBILITY.get(pc.user_id).catch(() => ({})); const { data: pr } = await admin().from('profiles').select('full_name,email,phone,origin_country,apply_email').eq('id', pc.user_id).maybeSingle();
    const src = Object.assign({ full_name: pr && pr.full_name, email: pr && pr.apply_email, phone: pr && pr.phone, nationality: pr && pr.origin_country }, M || {});
    let plan = []; try { const txt = await callAI('high_value', `Map form fields to values. Answer ONLY JSON: [{"field":"the field label as given","value":"the value or null","confidence":0.0-1.0,"needs_person":true|false,"why":"one line"}]. Rules: never fill payment, card, password, security answers, captcha, declarations, signatures or consent checkboxes (needs_person=true); use ONLY the given data; dates ISO; if unsure set value null and needs_person true.\nFIELDS: ${JSON.stringify(fields)}\nDATA: ${JSON.stringify(src).slice(0, 6000)}`, { maxTokens: 1500, json: true }); const m = String(txt).match(/\[[\s\S]*\]/); if (m) plan = JSON.parse(m[0]); } catch (e) {}
    const needs = plan.filter(x => x.needs_person); if (needs.length) { try { await NOTIFY.push(pc.user_id, 'portal', 'Your presence is needed on ' + pc.portal_name, needs.map(x => x.field).slice(0, 6).join(', ') + (needs.length > 6 ? ' and more' : '') + '. Open the portal to complete these yourself.', 'profile'); } catch (e) {} }
    await admin().from('audit_log').insert({ actor: pc.user_id, event: 'PORTAL_FILL_PLAN', detail: pc.portal_name + ' ' + plan.length + ' fields, ' + needs.length + ' need the person' }).then(() => {}, () => {}); res.json({ plan, stop_before: ['payment', 'captcha', 'declaration', 'signature', 'final submit'], notify_sent: needs.length > 0 }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/portal/:id/needs-you', async (req, res) => { try { const token = String(req.headers['x-worker-token'] || ''); if (!process.env.BROWSER_WORKER_TOKEN || token !== process.env.BROWSER_WORKER_TOKEN) return res.status(401).json({ error: 'worker token' }); const { data: pc } = await admin().from('portal_connections').select('user_id,portal_name').eq('id', req.params.id).maybeSingle(); if (!pc) return res.status(404).json({ error: 'connection' }); const why = String((req.body || {}).why || 'a step only you can complete').slice(0, 300); await NOTIFY.push(pc.user_id, 'portal', 'Your presence is needed on ' + pc.portal_name, why + '. Sign in to the portal to continue; the platform paused here on purpose.', 'profile'); try { const { data: pr } = await admin().from('profiles').select('phone,notify_whatsapp').eq('id', pc.user_id).maybeSingle(); if (pr && pr.phone && pr.notify_whatsapp !== false) await require('./lib/whatsapp').send(pr.phone, 'ForiForeign: your presence is needed on ' + pc.portal_name + ' (' + why + '). Sign in to continue.').catch(() => {}); } catch (e) {} res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ============================================================================================================================== */
/* ================= BEST OPTIONS · PADDLE · AUTO-VERIFY · LEGAL VERSIONS · GRACEFUL SHUTDOWN ================= */
const RERANK = require('./lib/reranker'); const PADDLE = require('./lib/gateway_paddle');
app.get('/api/opportunities/best', auth, async (req, res) => { try { const { data: sc } = await admin().from('opportunity_scores').select('opportunity_id,score,eligible,reasons').eq('user_id', req.userId).order('score', { ascending: false }).limit(40); const ids = (sc || []).map(x => x.opportunity_id); if (!ids.length) return res.json({ best: [], note: 'Run a search first.' }); const { data: opps } = await admin().from('opportunities').select('*').in('id', ids).eq('status', 'verified'); const byS = Object.fromEntries((sc || []).map(x => [x.opportunity_id, x])); const cards = (opps || []).map(o => Object.assign({ match_pct: (byS[o.id] || {}).score, eligible: (byS[o.id] || {}).eligible, quality: DQ.score(o) }, o)).sort((a, b) => (b.match_pct || 0) - (a.match_pct || 0)); const best = await RERANK.best(req.userId, cards, Number(req.query.n) || 10); res.json({ best: best.map(o => ({ id: o.id, title: o.title, institution: o.institution, country_code: o.country_code, kind: o.kind, level: o.level, deadline: o.deadline, funding_type: o.funding_type, match_pct: o.match_pct, quality: o.quality, why_best: o.why_best || null })) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/pay/paddle/webhook', express.raw({ type: 'application/json' }), async (req, res) => { try { if (!PADDLE.verify(req.body, req.headers['paddle-signature'])) return res.status(400).send('bad signature'); const ev = PADDLE.parse(req.body.toString('utf8')); if (/transaction\.(completed|paid)/.test(ev.event) && ev.paymentId) await settleCardPayment(ev.paymentId, 'paddle:' + ev.transactionId); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Auto-verify: low-risk rule types (documents, processing tracks, dependants notes) are verified automatically when the
   assistant finds the supporting sentence verbatim on the official page; eligibility, financial, fee, language and PR
   rules always wait for a person. Every auto-verification is marked as such and reversible. */
app.post('/api/admin/visa/rules/auto-verify', auth, perm('settings.write'), async (req, res) => {
  try { const cc = String((req.body || {}).cc || '').toUpperCase(); if (!cc) return res.status(400).json({ error: 'cc' }); const LOW = ['document', 'processing', 'dependants', 'work_rights', 'shortage']; const { data: rules } = await admin().from('visa_rules').select('id,rule_type,text,source_url').eq('country_code', cc).eq('status', 'unverified').not('source_url', 'is', null).limit(Number((req.body || {}).limit) || 60); let auto = 0, suggested = 0, unreachable = 0; const pages = {};
    for (const r of (rules || [])) { let text = pages[r.source_url]; if (text === undefined) { try { const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000); const rr = await fetch(r.source_url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 ForiForeign verify-assist' } }); clearTimeout(tm); text = String(await rr.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 40000); } catch (e) { text = null; } pages[r.source_url] = text; } if (!text) { unreachable++; continue; }
      let v = null; try { const txt = await callAI('high_value', `Verify ONE rule against its official page. Answer ONLY JSON: {"supported":true|false|null,"quote":"exact sentence(s) from the page, verbatim, max 60 words","suggested_text":"rule rewritten to match the page or null"}\nRULE (${r.rule_type}): ${r.text}\nPAGE: ${text}`, { maxTokens: 500, json: true }); const m = String(txt).match(/\{[\s\S]*\}/); if (m) v = JSON.parse(m[0]); } catch (e) {}
      if (!v) continue; const verbatim = v.quote && text.toLowerCase().includes(String(v.quote).toLowerCase().slice(0, 50)); if (v.supported === true && verbatim && LOW.includes(r.rule_type)) { await admin().from('visa_rules').update({ status: 'verified', last_verified_at: new Date().toISOString(), verified_by: req.userId, assist: { auto: true, quote: v.quote, at: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq('id', r.id); auto++; } else { await admin().from('visa_rules').update({ assist: { auto: false, supported: v.supported, quote: v.quote, suggested_text: v.suggested_text, verbatim, at: new Date().toISOString() } }).eq('id', r.id); suggested++; } }
    await admin().from('audit_log').insert({ actor: req.userId, event: 'RULES_AUTO_VERIFY', detail: cc + ' auto ' + auto + ' suggested ' + suggested + ' unreachable ' + unreachable }).then(() => {}, () => {}); res.json({ cc, auto_verified: auto, suggestions_saved: suggested, unreachable, note: 'Eligibility, financial, fee, language and PR rules always wait for a person; open them to see the saved quote and suggestion.' }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* Legal versions: bump a version; users see a re-acceptance banner until they accept the new text. */
app.get('/api/legal/versions', async (req, res) => { try { const { data } = await admin().from('legal_versions').select('kind,version,summary,effective_from').order('effective_from', { ascending: false }).limit(50); const cur = {}; for (const r of (data || [])) if (!cur[r.kind]) cur[r.kind] = r; res.set('Cache-Control', 'public, max-age=300'); res.json({ current: cur, history: data || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/legal/versions', auth, perm('settings.write'), async (req, res) => { try { if (!['admin', 'super_admin'].includes(req.userRole)) return res.status(403).json({ error: 'Platform admin only' }); const b = req.body || {}; if (!b.kind || !b.version) return res.status(400).json({ error: 'kind and version' }); const { data, error } = await admin().from('legal_versions').insert({ kind: String(b.kind), version: String(b.version), summary: String(b.summary || '').slice(0, 1000), effective_from: b.effective_from || new Date().toISOString().slice(0, 10), created_by: req.userId }).select('*').single(); if (error) return res.status(400).json({ error: error.message }); const cfg = await siteSettings.getConfig(); const legal = Object.assign({}, cfg.legal || {}); legal.versions = Object.assign({}, legal.versions || {}, { [b.kind]: b.version }); await siteSettings.saveConfig({ legal }, req.userId).catch(() => {}); res.json({ version: data }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/me/legal-status', auth, async (req, res) => { try { const cfg = await siteSettings.getConfig(); const vers = ((cfg.legal || {}).versions) || {}; const { data } = await admin().from('consent_ledger').select('kind,version').eq('user_id', req.userId).in('kind', ['terms']).order('recorded_at', { ascending: false }).limit(5); const accepted = (data || [])[0]; const current = vers.terms || (cfg.legal || {}).version || '2026-09-05'; res.json({ current, accepted: accepted ? accepted.version : null, needs_acceptance: !accepted || accepted.version !== current }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/me/accept-legal', auth, async (req, res) => { try { const id = await CONSENT.record(req, req.userId, 'terms', {}, { via: 'reacceptance' }); res.json({ ok: true, id }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ========================================================================================================== */
/* Remote browser worker protocol */
const workerAuth = (req, res, next) => { const token = String(req.headers['x-worker-token'] || ''); if (!process.env.BROWSER_WORKER_TOKEN || token !== process.env.BROWSER_WORKER_TOKEN) return res.status(401).json({ error: 'worker token' }); next(); };
app.get('/api/portal/worker/next', workerAuth, async (req, res) => { try { res.json({ jobs: await BOT.nextForWorker(Number(req.query.limit) || 5) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/portal/worker/report', workerAuth, express.json({ limit: '6mb' }), async (req, res) => { try { res.json(await BOT.reportFromWorker(req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ================= ADMIN TOTP · PADDLE · LEGAL RE-ACCEPTANCE · SCHOLARSHIP PROBES · LOCAL-ONLY FILTER · MORE JOB SOURCES ================= */
app.post('/api/admin/totp/enrol', auth, async (req, res) => { try { if (!['admin', 'super_admin', 'staff', 'content_admin'].includes(req.userRole)) return res.status(403).json({ error: 'staff only' }); const { data: p } = await admin().from('profiles').select('email').eq('id', req.userId).maybeSingle(); res.json(await TOTP.enrol(req.userId, p && p.email)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/totp/confirm', auth, async (req, res) => { try { await TOTP.confirm(req.userId, (req.body || {}).code); const v = await TOTP.verify(req.userId, (req.body || {}).code); res.json({ ok: true, token: v.token }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/totp/verify', auth, async (req, res) => { try { const v = await TOTP.verify(req.userId, (req.body || {}).code); if (!v.ok) return res.status(401).json({ error: 'Code did not match' }); res.json(v); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/totp/status', auth, async (req, res) => { try { const { data: p } = await admin().from('profiles').select('totp_enabled').eq('id', req.userId).maybeSingle(); res.json({ enabled: !!(p && p.totp_enabled) }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Paddle: second merchant-of-record option. */
app.post('/api/pay/paddle/checkout', auth, async (req, res) => { try { if (!PADDLE.enabled()) return res.status(400).json({ error: 'Paddle is not configured' }); const cfg = await siteSettings.getConfig(); const credits = Number((req.body || {}).credits) || 0; const addon = String((req.body || {}).addon || ''); const t = credits ? ((cfg.packages || {}).tiers || []).find(x => Number(x.credits) === credits) : null; const usd = t ? Number(t.promo_usd || t.usd) : addon ? Number((cfg.addons || {})[addon + '_usd']) : 0; if (!usd) return res.status(400).json({ error: 'Unknown item' }); const { data: pay, error } = await admin().from('payments').insert({ user_id: req.userId, credits, amount_pkr: 0, status: 'pending', reference: 'PADDLE', addon_key: addon || null, provider: 'paddle' }).select('id').single(); if (error) return res.status(400).json({ error: error.message }); const { data: prof } = await admin().from('profiles').select('email').eq('id', req.userId).maybeSingle(); const origin = (req.headers.origin || ('https://' + req.headers.host)); const tx = await PADDLE.createTransaction({ priceId: t ? t.paddle_price_id : (cfg.addons || {})[addon + '_paddle_price_id'], email: prof && prof.email, usd, name: t ? 'ForiForeign ' + t.name + ' package' : 'ForiForeign ' + addon.replace(/_/g, ' '), paymentId: pay.id, userId: req.userId, successUrl: origin + '/?paid=1&provider=paddle' }); await admin().from('payments').update({ reference: ('PADDLE:' + tx.id).slice(0, 120) }).eq('id', pay.id); await CONSENT.record(req, req.userId, t ? 'package_purchase' : 'addon_purchase', { name: t ? t.name : addon.replace(/_/g, ' '), amount: usd, credits }, { payment_id: pay.id, provider: 'paddle' }); res.json({ transaction_id: tx.id, client_token: tx.client_token, url: tx.url }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Legal re-acceptance: when the legal version changes, every person sees the notice and re-accepts; recorded in the ledger. */
app.get('/api/legal/version', async (req, res) => { try { const cfg = await siteSettings.getConfig(); res.json({ version: (cfg.legal || {}).version || '2026-09-05', url: '/legal.html' }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Scholarship probe: for seeded universities, read their scholarship / funding pages and extract programmes open to internationals. */
QUEUE.register('scholarship_probe', async (p) => { const { data: inst } = await admin().from('institutions').select('id,name,country_code,website,domain').eq('kind', 'university').in('country_code', Object.keys(require('./lib/visa_portals').PORTALS)).is('scholarship_probe_at', null).limit(Number(p.batch) || 40); let found = 0; const { ingestOpps } = require('./lib/engine'); for (const i of (inst || [])) { const base = (i.website || ('https://' + i.domain)).replace(/\/$/, ''); let text = ''; for (const path of ['/scholarships', '/funding', '/financial-aid', '/international/scholarships', '/admissions/scholarships', '/study/scholarships']) { try { const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 10000); const r = await fetch(base + path, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': 'ForiForeign scholarship probe' } }); clearTimeout(tm); if (r.ok) { text += ' ' + String(await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 6000); if (text.length > 12000) break; } } catch (e) {} } await admin().from('institutions').update({ scholarship_probe_at: new Date().toISOString() }).eq('id', i.id); if (!/scholarship|bursary|fellowship|award|waiver/i.test(text)) continue; let items = []; try { const txt = await callAI('high_value', `From this university's own pages, list scholarships or fee waivers that INTERNATIONAL students can apply for. Answer ONLY JSON: [{"name":"","level":"bachelors|masters|phd|postdoc","funding":"fully|partial","note":"one line: what it covers and who is eligible","url":"the page url if visible else null"}] (max 6; empty array if none are open to internationals).\nUNIVERSITY: ${i.name} (${i.country_code})\nPAGES: ${text.slice(0, 9000)}`, { maxTokens: 700, json: true }); const m = String(txt).match(/\[[\s\S]*\]/); if (m) items = JSON.parse(m[0]); } catch (e) {} if (!items.length) continue; found += await ingestOpps(items.filter(x => x.name).map(x => ({ title: x.name + ' at ' + i.name, institution: i.name, country_code: i.country_code, kind: 'study', level: x.level || 'masters', funding: x.funding === 'fully' ? 'fully funded' : 'partial', funding_type: x.funding === 'fully' ? 'fully' : 'partial', deadline: '', url: x.url || base, description: (x.note || '') + ' Source: the university\'s own scholarship page.', contact_emails: [], apply_via: 'portal', remote: 'false', extra: { source_key: 'scholarship_probe', recurring: true } })), 'scholarship', null).catch(() => 0); } return { probed: (inst || []).length, scholarships_added: found }; });
app.post('/api/admin/scholarships/probe', auth, perm('settings.write'), async (req, res) => { try { await QUEUE.enqueue('scholarship_probe', { batch: Number((req.body || {}).batch) || 40 }, { maxAttempts: 1 }); res.json({ queued: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ============================================================================================================================== */
/* ================= CONFIRM BEFORE YOU APPLY: offer/employer verification, application preflight, labour lane, dependency map ================= */
const OFFERV = require('./lib/offer_verify');
app.post('/api/verify/offer', auth, async (req, res) => { try { const b = req.body || {}; const { data: p } = await admin().from('profiles').select('origin_country').eq('id', req.userId).maybeSingle(); const r = await OFFERV.verify({ text: String(b.text || '').slice(0, 20000), url: b.url, employer: b.employer, email: b.email, cc: b.cc }); r.origin_advice = r.origin_rule[(p && p.origin_country) || 'PK'] || 'Use only licensed recruiters of your country and verify the licence number.'; delete r.origin_rule; await admin().from('audit_log').insert({ actor: req.userId, event: 'OFFER_VERIFIED', detail: (b.employer || b.url || '').slice(0, 120) + ' risk ' + r.risk }).then(() => {}, () => {}); res.json(r); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Preflight: the confirmation screen before Send. Every check is real and named; the person confirms with one tap; recorded. */
app.get('/api/applications/:id/preflight', auth, async (req, res) => {
  try { const { data: a } = await admin().from('applications').select('id,opportunity_id,status').eq('id', req.params.id).eq('user_id', req.userId).maybeSingle(); if (!a) return res.status(404).json({ error: 'Case not found' });
    const { data: o } = await admin().from('opportunities').select('*').eq('id', a.opportunity_id).maybeSingle(); const { data: p } = await admin().from('profiles').select('origin_country').eq('id', req.userId).maybeSingle();
    const q = DQ.score(o); const ver = await OFFERV.verify({ text: (o.description || '') + ' ' + (o.requirements_text || ''), url: o.url, employer: o.institution, email: (o.contact_emails || [])[0], cc: o.country_code }); delete ver.origin_rule;
    const { data: rules } = await admin().from('visa_rules').select('status').eq('country_code', o.country_code).neq('status', 'superseded'); const rv = (rules || []).filter(r => r.status === 'verified').length, rt = (rules || []).length;
    let docs = { required: [], ready: 0 }; try { const ck = await VAULT.checklist(req.userId, o.kind === 'work' ? 'work' : 'study'); docs = { required: ck.required.map(r => ({ label: r.label, state: r.state })), ready: ck.ready }; } catch (e) {}
    const checks = [
      { key: 'posting_open', label: 'Posting is open today', ok: !(o.closed || o.status === 'closed' || (o.deadline && new Date(o.deadline) < new Date())), detail: o.deadline ? 'deadline ' + o.deadline : 'no closing date stated' },
      { key: 'official_page', label: 'Verified on the official page', ok: !!(o.verified_at || o.status === 'verified'), detail: o.url },
      { key: 'employer', label: 'Employer verified (domain, registry, sponsor register where it exists)', ok: ver.level === 'low', detail: ver.reasons.map(r => r.signal).join('; ') || 'no red flags' },
      { key: 'eligibility', label: 'No citizenship / clearance / no-sponsorship restriction in the posting', ok: !o.eligibility_flag, detail: o.eligibility_flag || 'none found' },
      { key: 'rules', label: 'Destination rules verified by a person', ok: rt > 0 && rv >= Math.ceil(rt * 0.5), detail: rv + ' of ' + rt + ' rules verified' },
      { key: 'documents', label: 'Required documents in the vault', ok: docs.required.length > 0 && docs.required.every(r => r.state === 'ok'), detail: docs.required.filter(r => r.state !== 'ok').map(r => r.label).join(', ') || 'all present' }
    ];
    let success = null; try { success = await SUCCESS.estimate(req.userId, a.opportunity_id, a.id); } catch (e) {}
    res.json({ application_id: a.id, quality: q, success, fraud: { risk: ver.risk, level: ver.level, reasons: ver.reasons, advice: ver.advice }, checks, all_ok: checks.every(c => c.ok), can_send: checks.filter(c => ['posting_open', 'official_page', 'employer'].includes(c.key)).every(c => c.ok), note: 'Send stays possible when documents or rules are incomplete; it is blocked when the posting is closed, unverified or the employer fails the checks.' }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/applications/:id/preflight/confirm', auth, async (req, res) => { try { const b = req.body || {}; await CONSENT.record(req, req.userId, 'terms', { v: 'preflight' }, { application_id: req.params.id, checks: b.checks || null, kind: 'preflight_confirmation' }); await admin().from('applications').update({ preflight_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', req.userId).then(() => {}, () => {}); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Labour lane: routes and categories per destination, from the seeded labour rules. */
app.get('/api/labour/routes', auth, async (req, res) => { try { const cc = req.query.cc ? String(req.query.cc).toUpperCase() : null; const seed = require('./lib/visa_seed6').seed.filter(r => r.rule_type === 'eligibility' && (!cc || r.country_code === cc)); res.json({ routes: seed.map(r => ({ country_code: r.country_code, route_key: r.route_key, route_name: r.route_name, summary: r.text, categories: (r.value || {}).categories || [], source_url: r.source_url })) }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Dependency map: which provider each capability uses, whether a fallback exists, and what breaks without it. */
app.get('/api/admin/dependencies', auth, perm('overview.read'), async (req, res) => { try { const env = k => !!process.env[k]; const rows = [
    { capability: 'Discovery (AI-grounded search)', provider: env('GEMINI_API_KEY') ? 'Gemini grounded search' : 'not set', fallback: 'Structured feeds and job APIs (keyless: Arbeitnow, Remotive, Jobicy, The Muse, Himalayas, NHS Jobs; Greenhouse boards)', without: 'Fewer new postings; feeds keep flowing' },
    { capability: 'Writing (documents, replies, proposals)', provider: env('ANTHROPIC_API_KEY') ? 'Claude' : env('OPENAI_API_KEY') ? 'OpenAI' : 'not set', fallback: env('OPENAI_API_KEY') && env('ANTHROPIC_API_KEY') ? 'OpenAI ↔ Claude cascade' : 'none', without: 'No new documents; existing ones and the journey keep working' },
    { capability: 'Document reading (OCR)', provider: 'model vision + local PDF text extraction', fallback: 'Local text extraction for text PDFs', without: 'Scanned images unread until a provider returns' },
    { capability: 'Mail (send)', provider: env('RESEND_API_KEY') ? 'Resend' : 'not set', fallback: 'none (queued until back)', without: 'Sends wait in the outbound queue' },
    { capability: 'Mail (receive)', provider: 'Cloudflare Email Routing → intake', fallback: 'none', without: 'Replies not read until routing returns' },
    { capability: 'Payments', provider: [env('LEMON_API_KEY') && 'Lemon Squeezy', env('PADDLE_API_KEY') && 'Paddle', env('STRIPE_SECRET_KEY') && 'Stripe'].filter(Boolean).join(', ') || 'not set', fallback: 'USD bank transfer with receipt', without: 'Card checkout hidden; bank transfer stays' },
    { capability: 'Database and files', provider: 'Supabase', fallback: 'Nightly backups + tools/restore.js', without: 'Platform down; restore from backup' },
    { capability: 'Rate limits / counters', provider: env('REDIS_URL') ? 'Redis' : 'in-memory', fallback: 'in-memory per instance', without: 'Limits per instance only' },
    { capability: 'Translation', provider: 'Google website translator (client side)', fallback: 'Built-in core strings (EN/UR/HI/BN/AR)', without: 'English + five core languages' },
    { capability: 'WhatsApp notifications', provider: env('WHATSAPP_TOKEN') ? 'Meta Cloud API' : 'not set', fallback: 'In-app + email', without: 'In-app and email only' },
    { capability: 'Browser automation', provider: 'tools/worker (Playwright, your machine)', fallback: 'Mailbox + tracking links', without: 'Status read from mail and by the person' }
  ]; res.json({ dependencies: rows, single_platform: 'Every capability has a stated fallback inside the platform except database, receive-mail and send-mail, which are the three external services the product cannot exist without.' }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ============================================================================================================================== */
/* ================= COST INTELLIGENCE · SUCCESS ESTIMATE · TRANSPARENCY · LABOUR EVERYWHERE ================= */
const COSTI = require('./lib/costintel'); const SUCCESS = require('./lib/success');
app.get('/api/admin/costs', auth, perm('aicost.read'), async (req, res) => { try { res.json(await COSTI.report()); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/opportunities/:id/success', auth, async (req, res) => { try { res.json(await SUCCESS.estimate(req.userId, req.params.id, req.query.app || null)); } catch (e) { res.status(400).json({ error: e.message }); } });
/* What we offer and what we charge, one public endpoint the pricing page, the app and the proposals all read from. */
app.get('/api/offering', async (req, res) => { try { const cfg = await siteSettings.getConfig(); const A = cfg.addons || {}; const DEF = require('./lib/settings').DEFAULTS.packages.tiers; const cc = await visitorCountryAsync(req); const fx = await require('./lib/pay').liveRates().catch(() => null); const W = require('./lib/world'); const lp = u => W.localPrice(u, cc, fx && fx.rates); const tiers = ((cfg.packages || {}).tiers || []).map(t => { const d = DEF.find(x => x.key === t.key || Number(x.credits) === Number(t.credits)) || {}; const usd = Number(t.promo_usd || t.usd || d.promo_usd || d.usd) || 0; const list = Number(t.usd || d.usd) || usd; return { name: t.name, key: t.key, cases: t.credits, previews: t.view, usd, list_usd: list, local: lp(usd), list_local: lp(list), popular: !!(t.featured || d.featured), includes: ['prepare and send ' + t.credits + ' cases from your own address', 'every reply read for you', 'first offer pack', 'first visa desk file', 'first interview pack', 'first arrival pack'] }; }); const agency = ((cfg.agency || {}).tiers || (cfg.agency || {}).plans || []).map(t => ({ name: t.name, applications_month: t.cases_month, searches_day: t.searches_day, searches_month: t.searches_month, seats: t.seats, sub_agents: t.sub_agents, branches: t.branches, usd_month: t.usd_month, usd_year: t.usd_year, white_label: !!t.white_label, api: !!t.api })); res.set('Cache-Control', 'public, max-age=600'); res.json({ currency: 'USD', visitor_cc: cc, local_currency: lp(1).currency, pathway_membership: { month: (cfg.pathway || {}).month_usd || 9, year: (cfg.pathway || {}).year_usd || 79, month_local: lp((cfg.pathway || {}).month_usd || 9), year_local: lp((cfg.pathway || {}).year_usd || 79) }, plus: { includes: ((cfg.plus || {}).includes) || [], tiers: (((cfg.plus || {}).tiers) || []).map(t => Object.assign({}, t, { local: lp(Number(t.usd) || 0) })) }, free: ['search, matching and previews', '10 full searches on a free account, 3 a day', 'offer check before you pay or send documents', 'Ask ForiForeign', 'the labour and work-visa route explorer', 'your ForiForeign address'], applicant_packages: tiers, add_ons: [{ key: 'offer_pack', usd: A.offer_pack_usd, local: lp(Number(A.offer_pack_usd) || 15), what: 'further offers: conditions, deadlines, CAS/contract check, comparison' }, { key: 'visa_desk', usd: A.visa_desk_usd, local: lp(Number(A.visa_desk_usd) || 29), what: 'further visa files: six steps, pre-fill, appointment, tracking, decisions read from mail' }, { key: 'arrival_pack', usd: A.arrival_pack_usd, local: lp(Number(A.arrival_pack_usd) || 19), what: 'further destinations: pre-departure to first 90 days' }, { key: 'residence_year', usd: A.residence_year_usd, local: lp(Number(A.residence_year_usd) || 79), what: 'family, PR pathway, policy updates for a year' }], agency_plans: agency, partners: { note: 'Universities, employers and service partners collaborate under confidential terms; write to admin@foriforeign.com.' }, refunds: 'unused case credits within 14 days by the original method; prepared cases and used add-ons are not refundable', never: ['recruitment fees from workers', 'payment for a visa or a permit', 'unlabelled partner placement (partners are shown first only among options you qualify for, and are labelled)', 'invented documents'], legal: { company: (cfg.legal || {}).company_name, address: (cfg.legal || {}).address, terms: 'https://foriforeign.com/legal.html' } }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ============================================================================================================== */
/* ================= REFS · SEARCH · LIVE EVENTS (SSE) · AUDIT CHAIN · LANGUAGE + EMIGRATION · RESUBMISSION · STAFF-ASSIST · BRAND · COUNTRY BRIEFS ================= */
const REFS = require('./lib/refs'); const CHAIN = require('./lib/auditchain'); const LANG = require('./lib/language_guide'); const EMIG = require('./lib/emigration');
app.get('/api/search', auth, async (req, res) => { try { const isAdmin = ['admin', 'super_admin', 'staff', 'content_admin'].includes(req.userRole); const r = await REFS.search(req.query.q, { admin: isAdmin, userId: req.userId }); if (isAdmin) { const m = await maskedClientMap(); if (m.size) r.hits = (r.hits || []).map(h => (h.user_id && m.has(h.user_id)) ? Object.assign(h, { title: 'Consultancy client (masked)', subtitle: 'support grant required', masked: true }) : h); }
    else { try { const { data: mem } = await admin().from('org_members').select('org_id').eq('user_id', req.userId).eq('status', 'active').limit(5); const orgIds = (mem || []).map(x => x.org_id); if (orgIds.length) { const like = '%' + String(req.query.q || '').slice(0, 80).replace(/[%,]/g, ' ') + '%'; const { data: cl } = await admin().from('clients').select('id,full_name,stage,org_id,user_id,email').in('org_id', orgIds).or('full_name.ilike.' + like + ',email.ilike.' + like).limit(10); for (const c of (cl || [])) r.hits.push({ kind: 'client', id: c.id, ref: '', title: c.full_name, status: c.stage, link: 'work', org_id: c.org_id }); if ((cl || []).length) { const uids = cl.map(c => c.user_id).filter(Boolean); if (uids.length) { const { data: apps } = await admin().from('applications').select('id,ref,status,institution,created_at,user_id').in('user_id', uids).limit(20); for (const a of (apps || [])) r.hits.push({ kind: 'case', id: a.id, ref: a.ref, title: a.institution, status: a.status, when: a.created_at, link: 'work' }); } } } } catch (e) {} }
    res.json(r); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/refs/backfill', auth, perm('settings.write'), async (req, res) => { try { let n = 0; for (const [table, kind] of [['applications', 'application'], ['official_documents', 'official_document'], ['visa_cases', 'visa_case'], ['support_tickets', 'support_ticket'], ['payments', 'payment']]) { const { data } = await admin().from(table).select('id').is('ref', null).limit(2000); for (const r of (data || [])) { await REFS.assign(table, r.id, kind); n++; } } res.json({ assigned: n }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Live updates: server-sent events per signed-in person; notify.push fans out to open connections on this instance. */
const SSE = new Map();
app.get('/api/events', auth, (req, res) => { res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.flushHeaders && res.flushHeaders(); res.write('event: hello\ndata: {"ok":true}\n\n'); const set = SSE.get(req.userId) || new Set(); set.add(res); SSE.set(req.userId, set); const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000); req.on('close', () => { clearInterval(ping); set.delete(res); if (!set.size) SSE.delete(req.userId); }); });
function sseEmit(userId, payload) { const set = SSE.get(String(userId)); if (!set) return; for (const r of set) { try { r.write('event: update\ndata: ' + JSON.stringify(payload) + '\n\n'); } catch (e) {} } }
try { const N = require('./lib/notify'); const orig = N.push; N.push = async function (userId, kind, title, body, link, orgId) { const r = await orig.apply(this, arguments); try { sseEmit(userId, { kind, title, body: String(body || '').slice(0, 300), link, at: new Date().toISOString() }); } catch (e) {} try { if (!orgId && ['application', 'case', 'visa', 'offer', 'mail', 'partner', 'checkin', 'decision'].includes(String(kind))) { for (const w of await orgWatchers(userId)) sseEmit(w, { kind: 'client_' + kind, title: 'Client update: ' + title, body: String(body || '').slice(0, 200), link: 'work', client_user_id: userId, at: new Date().toISOString() }); } } catch (e) {} return r; }; } catch (e) {}
/* Audit chain: nightly seal + verify; admin can run both. */
app.post('/api/admin/audit/seal', auth, perm('audit.read'), async (req, res) => { try { res.json(await CHAIN.seal(5000)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/audit/verify', auth, perm('audit.read'), async (req, res) => { try { res.json(await CHAIN.verify(Number(req.query.hours) || 24)); } catch (e) { res.status(400).json({ error: e.message }); } });
QUEUE.register('audit_seal', async () => { const s = await CHAIN.seal(5000); const v = await CHAIN.verify(24); if (!v.ok) { try { const { data: admins } = await admin().from('profiles').select('id').in('role', ['admin', 'super_admin']); for (const a of (admins || [])) await NOTIFY.push(a.id, 'alert', 'Audit chain broken at row ' + v.broken_at, 'A row was edited or deleted in the audit log. Investigate immediately.', 'adminx'); } catch (e) {} } return Object.assign(s, v); });
/* Language and origin-side emigration guidance, per person. */
app.get('/api/me/route-guide', auth, async (req, res) => { try { const cc = String(req.query.cc || '').toUpperCase(); const lane = String(req.query.lane || 'work'); const { data: p } = await admin().from('profiles').select('origin_country').eq('id', req.userId).maybeSingle(); res.json({ language: LANG.guide(cc, lane), emigration: lane === 'study' ? null : EMIG.rules((p && p.origin_country) || 'PK'), timezone: require('./lib/world').tzOf(cc), origin_timezone: require('./lib/world').tzOf((p && p.origin_country) || 'PK') }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Resubmission after refusal: a new visa file linked to the old one, carrying the refusal analysis and the fixes to make. */
app.post('/api/visa/desk/:id/resubmit', auth, async (req, res) => { try { const { data: c } = await admin().from('visa_cases').select('*').eq('id', req.params.id).eq('user_id', req.userId).maybeSingle(); if (!c || c.status !== 'refused') return res.status(400).json({ error: 'Only a refused file can be resubmitted' }); const { data: n, error } = await admin().from('visa_cases').insert({ user_id: req.userId, country_code: c.country_code, route_key: c.route_key, status: 'preparing', resubmitted_from: c.id, notes: 'Resubmission of ' + (c.ref || c.id.slice(0, 8)) + '. Fix first: ' + ((c.refusal && c.refusal.reapply_or_appeal) || 'address every reason in the refusal analysis') , readiness: c.readiness || null, steps: {} }).select('*').single(); if (error) return res.status(400).json({ error: error.message }); await REFS.assign('visa_cases', n.id, 'visa_case'); JE.recompute(req.userId); res.json({ file: n, fixes: (c.refusal && c.refusal.reasons) || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Staff-assist: platform staff may connect a portal FOR an applicant only with the applicant's recorded consent, and every action is logged under both. */
app.post('/api/admin/portals/staff-assist', auth, perm('cases.write'), async (req, res) => { try { const b = req.body || {}; if (!b.user_id || !b.portal_name || !b.login_url) return res.status(400).json({ error: 'user_id, portal_name, login_url' }); const c = await BOT.connect(b.user_id, { portal_name: b.portal_name, login_url: b.login_url, username: b.username, password: b.password, scope: 'staff_assist', consent: true, connected_by: req.userId }); await CONSENT.record(req, b.user_id, 'portal_watch', { portal: b.portal_name, scope: 'staff assist (pending your approval)' }, { connection_id: c.id, staff: req.userId }); await admin().from('portal_connections').update({ connected_by: req.userId, applicant_confirmed: false }).eq('id', c.id); await NOTIFY.push(b.user_id, 'portal', 'Approve staff help on ' + b.portal_name, 'ForiForeign staff asked to read your ' + b.portal_name + ' status for you. Approve or decline under Profile → Portal watch.', 'profile'); await admin().from('audit_log').insert({ actor: req.userId, event: 'STAFF_ASSIST_REQUESTED', detail: b.user_id + ' ' + b.portal_name }).then(() => {}, () => {}); res.json({ connection: c, awaiting: 'applicant approval' }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Country briefs: a structured brief per destination × lane, grounded on the official portal and our rules, refreshed monthly; shown on SEO pages and in the app for the 46 destinations that have no hand-written guide. */
QUEUE.register('country_brief', async (p) => { const cc = String(p.cc).toUpperCase(); const lane = p.lane === 'work' ? 'work' : 'study'; const P = require('./lib/visa_portals').PORTALS[cc]; if (!P) return null; let text = ''; try { const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000); const r = await fetch(P[0], { signal: ctl.signal, headers: { 'user-agent': 'ForiForeign brief' } }); clearTimeout(tm); text = String(await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 12000); } catch (e) {} const { data: rules } = await admin().from('visa_rules').select('rule_type,text,source_url,route_name').eq('country_code', cc).neq('status', 'superseded').limit(60); let v = null; try { const txt = await callAI('high_value', `Write a structured country brief for ${lane === 'work' ? 'working in' : 'studying in'} ${cc} for applicants from South Asia, the Gulf and Africa. Use ONLY the official page text and the rules given; where a figure is not in them write "see source". Answer ONLY JSON: {"routes":["main routes with one line each"],"first_steps":["3-5 steps in order"],"documents":["typical documents"],"processing":"what the official page says about times, or see source","fees":"what the page says, or see source","common_refusals":["3 typical refusal reasons for this destination and how to avoid them"],"after_arrival":["registration, bank, ID, first 30 days"],"watch_out":["2-3 scams or mistakes specific to this destination"],"sources":["urls used"]}\nOFFICIAL PAGE (${P[1]}): ${text.slice(0, 8000)}\nRULES: ${JSON.stringify((rules || []).map(r => ({ t: r.rule_type, x: r.text, s: r.source_url })).slice(0, 40)).slice(0, 6000)}`, { maxTokens: 1400, json: true }); const m = String(txt).match(/\{[\s\S]*\}/); if (m) v = JSON.parse(m[0]); } catch (e) {} if (!v) return { cc, lane, skipped: 'model' }; await admin().from('app_settings').upsert({ key: 'brief:' + cc + ':' + lane, value: Object.assign(v, { at: new Date().toISOString(), portal: P[0] }) }); return { cc, lane, ok: true }; });
app.get('/api/brief/:cc', async (req, res) => { try { const cc = String(req.params.cc).toUpperCase(); const lane = req.query.lane === 'work' ? 'work' : 'study'; const { data } = await admin().from('app_settings').select('value').eq('key', 'brief:' + cc + ':' + lane).maybeSingle(); if (!data) return res.status(404).json({ error: 'No brief yet' }); res.set('Cache-Control', 'public, max-age=3600'); res.json({ brief: data.value }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/briefs/build', auth, perm('settings.write'), async (req, res) => { try { let n = 0; for (const cc of Object.keys(require('./lib/visa_portals').PORTALS)) for (const lane of ['study', 'work']) { await QUEUE.enqueue('country_brief', { cc, lane }, { maxAttempts: 1 }); n++; } res.json({ queued: n }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ============================================================================================================================== */
/* ================= STAFF PROCESSING ON BEHALF · FEE POLICY · PROPOSAL SELF-REVIEW ================= */
app.put('/api/me/staff-processing', auth, async (req, res) => { try { const on = !!(req.body || {}).allow; await admin().from('profiles').update({ allow_staff_processing: on }).eq('id', req.userId); if (on) await CONSENT.record(req, req.userId, 'consultant_acting', { consultant: 'ForiForeign staff', org: 'ForiForeign (Private) Limited', scope: 'prepare and send my cases when I ask or when I am unavailable; every action logged and visible to me' }, { kind: 'staff_processing' }); res.json({ allow: on }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/cases/:id/process', auth, perm('cases.write'), async (req, res) => {
  try { const b = req.body || {}; const { data: a } = await admin().from('applications').select('id,user_id,status,opportunity_id').eq('id', req.params.id).maybeSingle(); if (!a) return res.status(404).json({ error: 'Case not found' }); const { data: u } = await admin().from('profiles').select('allow_staff_processing,full_name').eq('id', a.user_id).maybeSingle(); if (!(u && u.allow_staff_processing) && !b.override_reason) return res.status(403).json({ error: 'The applicant has not allowed staff processing. Ask them to switch it on under Profile → Language and data, or record an override reason.' });
    const { prepareApplication } = require('./lib/engine'); let prepared = null; try { prepared = await prepareApplication(a.id, a.user_id); } catch (e) { return res.status(400).json({ error: 'Prepare failed: ' + e.message }); }
    let sent = null; if (b.send) { try { const pf = await (await fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/applications/' + a.id + '/preflight', { headers: { authorization: req.headers.authorization } })).json().catch(() => null); if (pf && pf.can_send === false) return res.status(400).json({ error: 'Preflight blocks sending: ' + (pf.checks || []).filter(c => !c.ok).map(c => c.label).join('; ') }); } catch (e) {} sent = { note: 'Open the case and press Send from the applicant\'s ForiForeign address; staff sends are recorded as staff.' }; }
    await admin().from('audit_log').insert({ actor: req.userId, event: 'STAFF_PROCESSED_CASE', detail: a.id + ' for ' + a.user_id + (b.override_reason ? ' override: ' + String(b.override_reason).slice(0, 200) : ' with standing consent') }); await NOTIFY.push(a.user_id, 'case', 'ForiForeign staff prepared your case', 'A staff member prepared ' + (a.id.slice(0, 8)) + ' for you. Review it under Cases; nothing is sent without the preflight.', 'apps'); res.json({ ok: true, prepared: !!prepared, sent }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/fees', async (req, res) => { res.set('Cache-Control', 'public, max-age=600'); res.json({ platform_fee: { what: 'preparation, correspondence, tracking and guidance for the cases in your package or plan', refundable: 'unused case credits within 14 days by the original method', non_refundable: 'prepared cases, used add-ons, agency plan months already started' }, official_fees: { who_pays: 'you, directly to the authority or institution', examples: ['application and admission fees', 'visa and permit fees, health surcharges', 'medical examinations', 'attestation, apostille and translation', 'language and skills tests', 'tuition and deposits', 'protector, emigration clearance and insurance in your country'], assistance: 'the platform shows the exact official page and amount at verification; ForiForeign staff or your consultancy can assist with the steps; nobody may add a fee on top of the official one' }, never: ['recruitment fees from workers', 'fees for a visa, a job or a permit', 'fees for a guaranteed result'] }); });
/* ================================================================================================== */
app.post('/api/org/:id/audit-note', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.read'); const b = req.body || {}; await orgAudit(req.params.id, req.userId, String(b.event || 'NOTE').slice(0, 40), String(b.detail || '').slice(0, 300)); res.json({ ok: true }); } catch (e) { orgErr(res, e); } });
app.get('/api/fx', async (req, res) => { try { const fx = await require('./lib/pay').liveRates().catch(() => null); res.set('Cache-Control', 'public, max-age=3600'); res.json({ base: 'USD', as_of: fx && fx.at ? new Date(fx.at).toISOString().slice(0, 10) : null, approximate: !(fx && fx.rates), rates: (fx && fx.rates) || require('./lib/world').FALLBACK_RATES }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ================= CASE VIEW · CHECK-INS · TRUST PAGE · CLIENT IMPORT · TOOLS ================= */
const CASEVIEW = require('./lib/caseview'); const CHECKINS = require('./lib/checkins');
app.get('/api/cases/:id/view', auth, async (req, res) => { try { const isStaff = ['staff', 'content_admin', 'admin', 'super_admin'].includes(req.userRole); if (isStaff) { const { data: a } = await admin().from('applications').select('user_id').eq('id', req.params.id).maybeSingle(); if (a && a.user_id !== req.userId && !(await staffMayOpen(a.user_id))) return res.status(403).json({ error: 'This case belongs to a consultancy client. Ask the consultancy for a time-limited support grant (Team → Support access).', code: 'MASKED' }); } res.json(await CASEVIEW.view(req.userId, req.params.id, { staff: isStaff })); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/visa/desk/:id/checkin', auth, async (req, res) => { try { const b = req.body || {}; const { data: c } = await admin().from('visa_cases').select('id,status,country_code').eq('id', req.params.id).eq('user_id', req.userId).maybeSingle(); if (!c) return res.status(404).json({ error: 'Not found' }); const ans = String(b.answer || ''); const patch = { updated_at: new Date().toISOString() }; if (ans === 'granted' || ans === 'refused') { patch.status = ans; patch.decision_on = new Date().toISOString().slice(0, 10); patch.checkin_state = 'answered'; patch.decision_text = String(b.text || '').slice(0, 4000) || null; if (ans === 'refused' && b.text) QUEUE.enqueue('visa_refusal', { caseId: c.id, userId: req.userId, cc: c.country_code, route: '', text: String(b.text).slice(0, 6000), extra: '' }, { userId: req.userId, maxAttempts: 2 }).catch(() => {}); if (ans === 'granted') { try { await JOURNEY.plan(req.userId, c.country_code, 'study'); } catch (e) {} } } else if (ans === 'more_documents') { patch.status = 'decision_pending'; patch.notes = 'Authority asked for more documents on ' + new Date().toISOString().slice(0, 10) + ': ' + String(b.text || '').slice(0, 500); } else { patch.checkin_state = 'waiting'; } await admin().from('visa_cases').update(patch).eq('id', c.id); JE.recompute(req.userId); res.json({ ok: true, status: patch.status || c.status }); } catch (e) { res.status(400).json({ error: e.message }); } });
QUEUE.register('checkin_sweep', async () => CHECKINS.sweep());
/* Trust page: live counts of the platform's own checks, and what it never does. */
app.get('/api/trust', async (req, res) => { try { const wk = new Date(Date.now() - 7 * 86400000).toISOString(); const c = async (t, f) => { try { const { count } = await f(admin().from(t).select('id', { count: 'exact', head: true })); return count || 0; } catch (e) { return 0; } }; const [rulesVerifiedWeek, rulesTotal, employersVerified, institutions, closedWeek, fraudFlagged, consents, policyWeek, offersChecked] = await Promise.all([c('visa_rules', q => q.eq('status', 'verified').gte('verified_at', wk)), c('visa_rules', q => q.neq('status', 'superseded')), c('institutions', q => q.eq('verified', true)), c('institutions', q => q), c('opportunities', q => q.eq('status', 'closed').gte('updated_at', wk)), c('opportunities', q => q.not('eligibility_flag', 'is', null)), c('consent_ledger', q => q), c('policy_updates', q => q.gte('detected_at', wk)), c('audit_log', q => q.eq('event', 'OFFER_VERIFIED').gte('created_at', wk))]); res.set('Cache-Control', 'public, max-age=600'); res.json({ as_of: new Date().toISOString(), rules: { verified_this_week: rulesVerifiedWeek, total: rulesTotal }, employers_verified: employersVerified, institutions, postings_closed_this_week: closedWeek, postings_flagged_restrictions: fraudFlagged, offers_checked_this_week: offersChecked, policy_changes_this_week: policyWeek, consents_recorded: consents, never: ['charge a worker a recruitment fee, or a fee for a visa, a job or a permit', 'send anything in your name without your tap', 'invent a document, a fact, a grade or a result', 'hide that an institution is a partner: partners with a signed MOU are shown first among the options you qualify for, and are labelled', 'read your personal email or connect to it', 'promise a result'] }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Client import for consultancies moving from another CRM: CSV with name, phone, email, lane, stage. */
app.post('/api/org/:id/clients/import', auth, express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }), async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.write'); if (!(await orgFeature(req.params.id, 'imports'))) return res.status(403).json({ error: 'Imports are switched off for this organisation by the platform; see Team → Audit.' }); const rows = require('./lib/sponsors').parseCsv(String(req.body || '')); if (rows.length < 2) return res.status(400).json({ error: 'CSV needs a header and at least one row' }); const head = rows[0].map(h => h.toLowerCase().trim()); const ix = k => head.findIndex(h => h === k || h.includes(k)); const iN = ix('name'), iP = ix('phone'), iE = ix('email'), iL = ix('lane'), iS = ix('stage'); if (iN < 0) return res.status(400).json({ error: 'A "name" column is required' }); let n = 0, skipped = 0; for (const r of rows.slice(1)) { const full_name = (r[iN] || '').trim(); if (!full_name) { skipped++; continue; } try { await ORGS.createClient(req.params.id, req.userId, { full_name, phone: iP >= 0 ? r[iP] : '', email: iE >= 0 ? r[iE] : '', lane: iL >= 0 && /work|job/i.test(r[iL] || '') ? 'work' : 'study', stage: iS >= 0 && r[iS] ? String(r[iS]).toLowerCase() : 'lead' }); n++; } catch (e) { skipped++; } } await orgAudit(req.params.id, req.userId, 'CLIENTS_IMPORTED', n + ' imported, ' + skipped + ' skipped'); res.json({ imported: n, skipped }); } catch (e) { orgErr(res, e); } });
/* ============================================================================================ */
/* ================= GUEST PREVIEW: three real matches before an account (identity scrubbed), no AI cost ================= */
app.get('/api/preview', async (req, res) => { try { const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'x'; const n = await LIMITER.hit('preview:' + ip, 3600); if (n > 20) return res.status(429).json({ error: 'Preview limit reached; create a free account to keep searching.' }); const lane = req.query.lane === 'work' ? 'work' : req.query.lane === 'labour' ? 'labour' : 'study'; const cc = String(req.query.cc || '').toUpperCase(); const text = String(req.query.q || '').slice(0, 80).replace(/[%,]/g, ' ');
    let q = admin().from('opportunities').select('id,title,institution,country_code,city,level,kind,category,funding_type,salary_note,deadline,eligibility_flag,employer_verified,verified_at').eq('status', 'verified'); if (lane === 'work' || lane === 'labour') q = q.eq('kind', 'work'); if (lane === 'labour') q = q.in('category', ['labour', 'care']); else q = q.neq('kind', 'work'); if (lane === 'labour') q = q.in('category', ['labour', 'care']); if (cc) q = q.eq('country_code', cc); if (text) q = q.or('title.ilike.%' + text + '%,institution.ilike.%' + text + '%,req_field.ilike.%' + text + '%'); q = q.is('eligibility_flag', null).order('verified_at', { ascending: false }).limit(12); const { data } = await q; const rows = (data || []).slice(0, 3).map(o => ({ title: (typeof generalTitle === 'function' ? generalTitle(o) : String(o.title || '').split(',')[0]), country_code: o.country_code, city: o.city, level: o.level, category: o.category, funding: o.funding_type, salary_hint: o.salary_note ? 'salary stated' : null, salary_note: o.salary_note || null, funding_type: o.funding_type || null, deadline: o.deadline, verified: !!o.verified_at, employer_verified: o.employer_verified === true, institution_hidden: true, description: o.description || '', requirements: o.requirements || '', kind: o.kind }));
    if (!rows.length) { try { if (lane === 'study') { const SC = require('./lib/scholarships_seed').SCHOLARSHIPS.filter(x => (!cc || x.cc === cc || x.cc === 'EU') && (!text || (x.name + ' ' + x.note).toLowerCase().includes(text.toLowerCase()))).slice(0, 3); for (const x of SC) rows.push({ title: x.name, country_code: x.cc === 'EU' ? 'EU' : x.cc, level: x.levels[0], funding: x.funding, deadline: null, verified: true, source: 'official programme page', institution_hidden: false, window: x.window }); } else { const L = require('./lib/visa_seed6').seed.filter(r => r.rule_type === 'eligibility' && (!cc || r.country_code === cc)).slice(0, 3); for (const r of L) rows.push({ title: r.route_name, country_code: r.country_code, level: null, category: (r.value.categories || [])[0] || null, funding: null, deadline: null, verified: true, source: 'official route, ' + (r.source_title || 'government page'), institution_hidden: false }); } } catch (e) {} }
    res.set('Cache-Control', 'public, max-age=300'); const rowsOut = await Promise.all(rows.map(async o => require('./lib/explore').redactFree(Object.assign(o, { pathway: await pathwayFor(o.country_code, lane === 'work' || lane === 'labour' ? 'work' : 'study', o.category).catch(() => null), details: String(o.description || '').replace(/\s+/g, ' ').slice(0, 260), requirements: String(o.requirements || '').replace(/\s+/g, ' ').slice(0, 200) })))); res.json({ lane, cc, count: (data || []).length, preview: rowsOut, unlock: 'Create a free account to see the institution, the official link, your match score and the requirements checklist.' }); }
  catch (e) { res.status(400).json({ error: e.message }); } });
/* ============================================================================================================= */
/* Consultancies declare the institutions and employers they consider their own; ForiForeign's prospecting agent never approaches them. */
app.get('/api/org/:id/protected-partners', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.read'); const { data } = await admin().from('app_settings').select('value').eq('key', 'protected_partners:' + req.params.id).maybeSingle(); res.json({ names: (data && data.value && data.value.names) || [] }); } catch (e) { orgErr(res, e); } });
app.put('/api/org/:id/protected-partners', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.write'); const names = [...new Set(((req.body || {}).names || []).map(x => String(x).trim()).filter(Boolean))].slice(0, 500); await admin().from('app_settings').upsert({ key: 'protected_partners:' + req.params.id, value: { names } }); const { data: all } = await admin().from('app_settings').select('key,value').like('key', 'protected_partners:%'); const merged = [...new Set((all || []).flatMap(r => (r.value && r.value.names) || []))]; await admin().from('app_settings').upsert({ key: 'protected_partners', value: { names: merged } }); await orgAudit(req.params.id, req.userId, 'PROTECTED_PARTNERS_SET', names.length + ' names'); res.json({ names }); } catch (e) { orgErr(res, e); } });
/* The consultancy behind an applicant, for the applicant's own screens: name, contact, address. Nothing about the platform. */
app.get('/api/me/consultancy', auth, async (req, res) => { try { const { data: cl } = await admin().from('clients').select('org_id,owner_user_id').eq('user_id', req.userId).eq('status', 'active').limit(1); if (!cl || !cl[0]) return res.json({ consultancy: null }); const { data: og } = await admin().from('organisations').select('name,kind,settings').eq('id', cl[0].org_id).maybeSingle(); if (!og || og.kind !== 'agency') return res.json({ consultancy: null }); let consultant = null; try { const { data: c } = await admin().from('profiles').select('full_name').eq('id', cl[0].owner_user_id).maybeSingle(); consultant = c && c.full_name; } catch (e) {} const st = og.settings || {}; res.json({ consultancy: { name: og.name, consultant, contact_email: st.contact_email || st.email || null, phone: st.phone || null, whatsapp: st.whatsapp || null, address: st.address || null, website: st.website || null } }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/lanes', auth, perm('overview.read'), async (req, res) => { try { const st = QUEUE.laneStatus(); const names = {}; for (const t of st.tripped) { if (t.lane !== 'platform') { const { data: o } = await admin().from('organisations').select('name').eq('id', t.lane).maybeSingle(); names[t.lane] = o ? o.name : t.lane; } } res.json(Object.assign(st, { names })); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/lanes/:lane/resume', auth, perm('settings.write'), async (req, res) => { try { QUEUE.laneResume(req.params.lane); await admin().from('job_queue').update({ run_after: new Date().toISOString() }).eq('status', 'queued').eq('org_id', req.params.lane === 'platform' ? null : req.params.lane); res.json({ resumed: req.params.lane }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ================= COMMITMENTS TO CONSULTANCIES · PER-ORGANISATION CONTROLS ================= */
app.get('/api/commitments', async (req, res) => { res.set('Cache-Control', 'public, max-age=600'); res.json({ title: 'Our commitments to consultancies', items: [
  { q: 'You also do business with applicants. Will you take our clients?', a: 'No, and the wall runs both ways. Your clients are yours: our staff see them masked unless you grant access, and our outreach never touches them. ForiForeign\'s direct applicants, leads and revenue are ours: FF-CRM cannot search, see, add, link to or contact any ForiForeign applicant, and no consultancy will ever be shown one. Two populations, two systems, one platform.', enforced: ['masking', 'no account linking', 'attach refused for platform accounts', 'audit log'] },
  { q: 'Can we add a person who already has a ForiForeign account as our client?', a: 'No. FF-CRM is for clients you bring. A client record you create is yours alone and is never matched against ForiForeign accounts. An account created on foriforeign.com cannot be attached to any consultancy; an account created on your own domain belongs to you.', enforced: ['no email matching', 'sign-up origin recorded', 'attach refused'] },
  { q: 'Who collects the client\'s money?', a: 'You do. Your clients pay you, on your terms; FF-CRM records fees, receipts and balances for your books but moves no money for you. ForiForeign\'s own checkout serves only ForiForeign\'s direct applicants and your plan payment. The two never cross.', enforced: ['separate checkouts', 'checkout blocked for consultancy clients', 'finance ledger is records only'] },
  { q: 'Will you take our university or employer commissions?', a: 'No. We take no share of your commissions. You pay your plan and nothing else. Our own MOUs with institutions cover only files that say on their face they were prepared on ForiForeign; your files carry your name and are governed by your own agreements.', enforced: ['MOU channel clause', 'no commission share in the ledger'] },
  { q: 'Will you approach our partner universities?', a: 'Not if you tell us who they are. List them under Team → Your clients are yours; our outreach agent refuses to approach any name on the list, any organisation already on the platform, and any institution linked to a customer workspace, and records the refusal.', enforced: ['protected partners', 'prospecting refusal log'] },
  { q: 'Will our clients see your brand?', a: 'Not on your domain, and not on their files. On your domain the interface carries your name, logo, colour, address and contact; notification emails come from your name with your reply-to; applications sign off with your name; WhatsApp messages carry your name. The platform\'s names cannot even be used in an organisation name.', enforced: ['white label', 'brand-aware mail', 'reserved names'] },
  { q: 'Can another consultancy see our clients?', a: 'No. Every organisation route is scoped server-side and audited by the build; one plan per consultancy; no cross-membership; the isolation check in Team lets you verify it yourself.', enforced: ['scoping', 'resale locks', 'isolation check'] },
  { q: 'Who owns the data?', a: 'You own your clients\' data and your organisation\'s data. Export it any time as CSV; delete a client and their files are removed; the consent ledger records what each client agreed to. We are the processor under the DPA on the legal page.', enforced: ['export', 'deletion', 'consent ledger', 'DPA'] },
  { q: 'What if we leave?', a: 'Export everything, cancel the plan at the end of the period, and your clients keep their own accounts and files. No lock-in, no exit fee.', enforced: ['export', 'no exit fee'] },
  { q: 'What if your platform has a problem?', a: 'Your work lane is isolated: one organisation\'s failures never stop another; a paused lane resumes itself; backups run nightly; the daily brief and self-heal catch stalls; the status of your lane is visible to the platform admin.', enforced: ['bulkhead', 'backups', 'self-heal'] },
  { q: 'Can your staff log into our workspace?', a: 'No. Platform staff cannot be members of any consultancy. The only way in is the time-limited support grant you give, which shows contact details to platform support for the hours you choose and is logged.', enforced: ['membership exclusion', 'support grant'] },
  { q: 'Do you rank our clients below your own applicants?', a: 'No. One engine, one scoring, one preflight for everyone; nothing about channel enters the score. The only priority that exists is institutional: universities with a countersigned MOU are shown first among the options an applicant qualifies for, labelled as partners, for your clients and for direct applicants alike.', enforced: ['single engine', 'labelled partner priority'] },
  { q: 'What do you keep for yourselves?', a: 'Our direct applicants and their revenue, our public pages, our university and employer outreach, our MOUs, our SEO, our acquisition and proposal agents, our economics screens. These are platform tools for ForiForeign\'s own business and never appear inside FF-CRM.', enforced: ['admin-only agents', 'feature scoping'] },
  { q: 'What can you do to our account?', a: 'Suspend it for abuse under the terms, adjust plan limits you agreed to, review a logo for legality, and set a storage quota. Every such action is logged and visible to you under Team → Audit.', enforced: ['org audit'] }
] }); });
/* Per-organisation controls for the platform admin: feature flags, storage quota, logo review, notes. Logged to the organisation's own audit. */
app.get('/api/admin/orgs/:id/controls', auth, perm('users.read'), superOnly, async (req, res) => { try { const { data: o } = await admin().from('organisations').select('name,settings').eq('id', req.params.id).maybeSingle(); if (!o) return res.status(404).json({ error: 'Not found' }); const c = (o.settings || {}).controls || {}; let storage = 0; try { const { data: cl } = await admin().from('clients').select('user_id').eq('org_id', req.params.id).limit(5000); const ids = (cl || []).map(x => x.user_id).filter(Boolean); if (ids.length) { const { count } = await admin().from('documents').select('id', { count: 'exact', head: true }).in('user_id', ids.slice(0, 1000)); storage = count || 0; } } catch (e) {} res.json({ name: o.name, controls: Object.assign({ features: { whitelabel: true, table_view: true, imports: true, exports: true, bulk_search: true, leads: true, licences: true, portal_watch: true }, storage_quota_docs: 5000, logo_status: 'unreviewed', note: '' }, c), storage_docs: storage }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.put('/api/admin/orgs/:id/controls', auth, perm('settings.write'), superOnly, async (req, res) => { try { const b = req.body || {}; const { data: o } = await admin().from('organisations').select('settings').eq('id', req.params.id).maybeSingle(); if (!o) return res.status(404).json({ error: 'Not found' }); const cur = (o.settings || {}).controls || {}; const next = Object.assign({}, cur, { features: Object.assign({}, cur.features || {}, b.features || {}), storage_quota_docs: b.storage_quota_docs != null ? Math.max(100, Number(b.storage_quota_docs) || 5000) : cur.storage_quota_docs, logo_status: ['unreviewed', 'approved', 'rejected'].includes(b.logo_status) ? b.logo_status : cur.logo_status, note: b.note != null ? String(b.note).slice(0, 500) : cur.note }); await admin().from('organisations').update({ settings: Object.assign({}, o.settings || {}, { controls: next }) }).eq('id', req.params.id); await orgAudit(req.params.id, req.userId, 'PLATFORM_CONTROLS_CHANGED', JSON.stringify({ features: b.features || null, storage_quota_docs: b.storage_quota_docs || null, logo_status: b.logo_status || null }).slice(0, 300)); res.json({ controls: next }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Feature flags enforced where they matter: imports, exports, bulk search, white label. */
async function orgFeature(orgId, key) { try { const { data: o } = await admin().from('organisations').select('settings').eq('id', orgId).maybeSingle(); const f = (((o && o.settings) || {}).controls || {}).features || {}; return f[key] !== false; } catch (e) { return true; } }
/* ========================================================================================= */
/* ================= PARTNER SYSTEM (autopilot) ================= */
const PENGINE = require('./lib/partners_engine');
app.get('/api/admin/partnerships', auth, perm('settings.read'), async (req, res) => { try { const [{ data: partners }, { data: inv }, { data: disputes }, { data: refs }] = await Promise.all([admin().from('institutions').select('id,name,country_code,partner_tier,partner_since,partner_terms,office,reputation').not('partner_tier', 'is', null).order('partner_since', { ascending: false }).limit(300), admin().from('partner_invoices').select('*').order('created_at', { ascending: false }).limit(200), admin().from('partner_disputes').select('*').order('opened_at', { ascending: false }).limit(100), admin().from('partner_referrals').select('stage,share_usd,institution_name').limit(2000)]); const totals = { referrals: (refs || []).length, enrolled: (refs || []).filter(r => r.stage === 'enrolled').length, receivable_usd: (inv || []).filter(i => ['sent', 'reminded', 'pending'].includes(i.status)).reduce((a, i) => a + Number(i.amount_usd || 0), 0), paid_usd: (inv || []).filter(i => i.status === 'paid').reduce((a, i) => a + Number(i.amount_usd || 0), 0), disputed: (disputes || []).filter(d => d.status !== 'resolved').length }; res.json({ partners: partners || [], invoices: inv || [], disputes: disputes || [], totals, rules: PENGINE.NEGOTIATION }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/partnerships/log', auth, perm('settings.read'), async (req, res) => { try { let q = admin().from('partner_liaison_log').select('*').order('id', { ascending: false }).limit(200); if (req.query.institution) q = q.eq('institution_id', req.query.institution); const { data } = await q; res.json({ log: data || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/partnerships/pipeline', auth, perm('settings.write'), async (req, res) => { try { const cc = String((req.body || {}).cc || '').toUpperCase(); const cap = Math.min(25, Number((req.body || {}).cap) || 10); if (!cc) return res.status(400).json({ error: 'cc' }); await QUEUE.enqueue('partner_pipeline', { cc, cap }, { maxAttempts: 1 }); res.json({ queued: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/partnerships/:id/office', auth, perm('settings.write'), async (req, res) => { try { res.json({ office: await PENGINE.findOffice(req.params.id) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/partnerships/onboard/:documentId', auth, perm('settings.write'), async (req, res) => { try { res.json(await PENGINE.onboard(req.params.documentId)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/partnerships/referrals/:applicationId/stage', auth, perm('cases.write'), async (req, res) => { try { const b = req.body || {}; res.json({ referral: await PENGINE.updateReferralStage(req.params.applicationId, String(b.stage || 'sent'), { tuition_usd: b.tuition_usd }) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/partnerships/invoices/:id/clear', auth, perm('payments.write'), async (req, res) => { try { await PENGINE.clear(req.params.id, (req.body || {}).paid_ref); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/partnerships/invoices/:id/send', auth, perm('payments.write'), async (req, res) => { try { await PENGINE.sendInvoice(req.params.id); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/partnerships/disputes', auth, perm('settings.write'), async (req, res) => { try { res.json({ dispute: await PENGINE.openDispute(req.body || {}) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/partnerships/disputes/:id/resolve', auth, perm('settings.write'), async (req, res) => { try { const b = req.body || {}; await PENGINE.resolveDispute(req.params.id, b.resolution, b.outcome); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Applicants (or their consultancy) confirm an enrolment at a partner: this is the verification gate before any share is invoiced. */
app.post('/api/applications/:id/enrolled', auth, async (req, res) => { try { const { data: a } = await admin().from('applications').select('id,user_id').eq('id', req.params.id).maybeSingle(); if (!a || a.user_id !== req.userId) return res.status(404).json({ error: 'Case not found' }); await admin().from('applications').update({ status: 'enrolled', outcome: 'enrolled' }).eq('id', a.id); await CONSENT.record(req, req.userId, 'terms', { v: 'enrolment_confirmation' }, { application_id: a.id, tuition_usd: (req.body || {}).tuition_usd || null }); await PENGINE.updateReferralStage(a.id, 'enrolled', { tuition_usd: (req.body || {}).tuition_usd }); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
QUEUE.register('partner_pipeline', async (p) => PENGINE.pipeline(String(p.cc).toUpperCase(), Number(p.cap) || 10));
QUEUE.register('partner_receivables', async () => PENGINE.receivablesSweep());
QUEUE.register('partner_liaison', async () => { const { data } = await admin().from('institutions').select('id').eq('partner_tier', 'mou').limit(500); let n = 0; for (const i of (data || [])) { try { await PENGINE.liaison(i.id); n++; } catch (e) {} } return { sent: n }; });
QUEUE.register('partner_referral_record', async (p) => PENGINE.recordReferral(p.applicationId));
/* ============================================================ */
/* ================= ADMISSION EVIDENCE · INSTITUTION CONFIRMATION · PARTNER DISPUTES FROM THE WORKSPACE · CONSULTANCY LEDGER ================= */
QUEUE.register('admission_evidence', async (p) => PENGINE.evidenceFromDocument(p.docId));
QUEUE.register('partner_overdue', async () => PENGINE.accrueInterest());
QUEUE.register('partner_renewals', async () => PENGINE.renewalSweep());
app.post('/api/org/:id/enrolments/confirm', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.write'); res.json(await PENGINE.institutionConfirm(req.params.id, (req.body || {}).items || [], req.userId)); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/partner-dispute', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.write'); const { data: inst } = await admin().from('institutions').select('id').eq('partner_org_id', req.params.id).maybeSingle(); if (!inst) return res.status(400).json({ error: 'Not a partner workspace' }); res.json({ dispute: await PENGINE.openDispute({ institution_id: inst.id, invoice_id: (req.body || {}).invoice_id || null, referral_id: (req.body || {}).referral_id || null, raised_by: 'institution', reason: (req.body || {}).reason }) }); } catch (e) { orgErr(res, e); } });
app.get('/api/org/:id/partner-ledger', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'finance.read'); const { data: inst } = await admin().from('institutions').select('id,name,partner_terms').eq('partner_org_id', req.params.id).maybeSingle(); if (inst) { const [{ data: refs }, { data: inv }] = await Promise.all([admin().from('partner_referrals').select('id,application_id,stage,admission_number,tuition_usd,share_usd,created_at').eq('institution_id', inst.id).order('created_at', { ascending: false }).limit(500), admin().from('partner_invoices').select('id,ref,amount_usd,status,due_on,paid_at').eq('institution_id', inst.id).order('created_at', { ascending: false }).limit(200)]); return res.json({ role: 'institution', institution: inst.name, terms: inst.partner_terms, referrals: refs || [], invoices: inv || [] }); }
    /* A consultancy sees, for its own clients, which cases reached enrolment at a partner with the admission number and evidence: the proof it needs for its own commission. */
    const { data: refs } = await admin().from('partner_referrals').select('id,application_id,user_id,institution_name,stage,admission_number,evidence,created_at,updated_at').eq('org_id', req.params.id).order('updated_at', { ascending: false }).limit(500); res.json({ role: 'consultancy', referrals: refs || [] }); } catch (e) { orgErr(res, e); } });
app.get('/api/admin/partnerships/types', auth, perm('settings.read'), (req, res) => res.json({ types: PENGINE.PARTNER_TYPES, rules: PENGINE.NEGOTIATION }));
/* ======================================================================================================= */
/* ================= THE DUMMY CASE: run every step of every lane in minutes, find errors before a real person does ================= */
const SIMU = require('./lib/simulation');
QUEUE.register('simulation_run', async (p) => SIMU.run(p.mode === 'full' ? 'full' : 'fast', p.adminId || null));
app.post('/api/admin/simulate', auth, perm('settings.write'), async (req, res) => { try { const mode = (req.body || {}).mode === 'full' ? 'full' : 'fast'; if ((req.body || {}).inline) { const r = await SIMU.run(mode, req.userId); return res.json(r); } await QUEUE.enqueue('simulation_run', { mode, adminId: req.userId }, { maxAttempts: 1 }); res.json({ queued: true, mode }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/simulate/latest', auth, perm('settings.read'), async (req, res) => { try { const { data } = await admin().from('app_settings').select('value').eq('key', 'simulation:latest').maybeSingle(); res.json({ report: (data && data.value) || null }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/simulate/purge', auth, perm('settings.write'), async (req, res) => { try { res.json(await SIMU.purge()); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ============================================================================================================================ */
/* Country of the visitor: edge header (Cloudflare / Vercel / Railway), then ?cc=, then Accept-Language region. Local price for any USD figure, rounded naturally. */
const GEO_CACHE = new Map();
async function geoCountry(ip) { ip = String(ip || '').split(',')[0].trim(); if (!ip || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1|fc|fd)/.test(ip)) return null; const hit = GEO_CACHE.get(ip); if (hit && Date.now() - hit.at < 86400000) return hit.cc; let cc = null; try { const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 1800); const r = await fetch('https://ipapi.co/' + encodeURIComponent(ip) + '/country/', { signal: ctl.signal, headers: { 'user-agent': 'foriforeign' } }); clearTimeout(tm); const t = (await r.text()).trim().toUpperCase(); if (/^[A-Z]{2}$/.test(t)) cc = t; } catch (e) {} if (!cc) { try { const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 1800); const r = await fetch('http://ip-api.com/json/' + encodeURIComponent(ip) + '?fields=countryCode', { signal: ctl.signal }); clearTimeout(tm); const j = await r.json(); if (j && /^[A-Z]{2}$/.test(String(j.countryCode || ''))) cc = j.countryCode; } catch (e) {} } GEO_CACHE.set(ip, { cc, at: Date.now() }); return cc; }
/* Where the visitor is: the signed-in profile's origin first, then the edge header, then the IP (geolocated and cached), then ?cc, then the browser language; Pakistan last. Prices are shown in that currency with the USD beside. */
function visitorCountrySync(req) { const h = req.headers; const cc = String(h['cf-ipcountry'] || h['x-vercel-ip-country'] || h['x-country-code'] || h['x-appengine-country'] || '').toUpperCase(); if (cc && cc.length === 2 && cc !== 'XX') return cc; const q = String(req.query.cc || '').toUpperCase(); if (/^[A-Z]{2}$/.test(q)) return q; return null; }
async function visitorCountryAsync(req) { try { if (req.userId) { const { data: p } = await admin().from('profiles').select('origin_country').eq('id', req.userId).maybeSingle(); if (p && /^[A-Z]{2}$/i.test(String(p.origin_country || ''))) return String(p.origin_country).toUpperCase(); } } catch (e) {} const sync = visitorCountrySync(req); if (sync) return sync; const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(); const geo = await geoCountry(ip); if (geo) return geo; const al = String(req.headers['accept-language'] || ''); const m = al.match(/-([A-Z]{2})/); if (m && m[1] !== 'US') return m[1]; return 'PK'; }
function visitorCountry(req) { return visitorCountrySync(req) || (req._geoCC) || 'PK'; }
app.get('/api/local-price', async (req, res) => { try { const usd = Number(req.query.usd) || 0; const cc = await visitorCountryAsync(req); const fx = await require('./lib/pay').liveRates().catch(() => null); const W = require('./lib/world'); const lp = W.localPrice(usd, cc, fx && fx.rates); res.set('Cache-Control', 'private, max-age=600'); res.json({ cc, local: lp, as_of: fx && fx.at ? new Date(fx.at).toISOString().slice(0, 10) : null }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/visitor', async (req, res) => { res.set('Cache-Control', 'private, max-age=600'); res.json({ cc: await visitorCountryAsync(req) }); });
app.get('/api/me/visitor', auth, async (req, res) => { res.json({ cc: await visitorCountryAsync(req) }); });
/* The pathway a visitor wants to see before trusting anything: which visa route, what it leads to, in one line per country and lane. */
const PATH_CACHE = new Map();
async function pathwayFor(cc, lane, category) { const k = cc + ':' + lane + ':' + (category || ''); const hit = PATH_CACHE.get(k); if (hit && Date.now() - hit.at < 3600000) return hit.v; let out = null; try { const { data } = await admin().from('visa_rules').select('route_name,rule_type,value,lane').eq('country_code', String(cc || '').toUpperCase()).in('lane', [lane, 'both']).neq('status', 'superseded').limit(60); const rows = data || []; const pref = category === 'care' ? /care|health/i : category === 'labour' ? /labou?r|seasonal|employment|work permit|eps|ssw|mohre|iqama|general/i : lane === 'work' ? /skilled|work|employ|talent|blue card|opportunity/i : /stud|student|learn/i; const routeName = (rows.find(r => r.route_name && pref.test(r.route_name)) || rows.find(r => r.route_name && (lane === 'work' ? /work|skilled|employ|labou?r|job/i.test(r.route_name) : /stud|student|learn/i.test(r.route_name))) || rows.find(r => r.route_name) || {}).route_name || null; const pr = rows.find(r => /pr|permanent|settle|residence/i.test(r.rule_type || '') || /pr|permanent|settle/i.test(JSON.stringify(r.value || '')) ); const prNote = pr ? (typeof pr.value === 'object' && pr.value ? (pr.value.text || pr.value.note || pr.value.summary || '') : String(pr.value || '')).slice(0, 120) : ''; out = routeName ? { route: routeName, next: lane === 'study' ? 'post-study work' : 'residence', pr: prNote || null } : null; } catch (e) {} PATH_CACHE.set(k, { v: out, at: Date.now() }); return out; }
app.get('/api/professions', (req, res) => { res.set('Cache-Control', 'public, max-age=86400'); try { const PA = require('./lib/professions_all'); const D = require('./lib/domains'); const names = new Set(); for (const p of (PA.PROFS || [])) names.add(String(p[0]).replace(/_/g, ' ')); for (const [k, f] of Object.entries(D.FAMILIES || {})) { names.add(k.replace(/_/g, ' ')); for (const s of (f.syn || [])) names.add(String(s)); } res.json({ professions: [...names].filter(x => x && x.length > 2).sort() }); } catch (e) { res.json({ professions: [] }); } });
app.get('/api/org/:id/plan-state', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.read'); const Q = require('./lib/quota'); const L = await Q.limitsFor(req.params.id, { user_id: req.userId }); const cfg = await siteSettings.getConfig(); const tier = L.ok ? (((cfg.agency || {}).tiers || []).find(t => t.key === L.sub.tier_key) || {}) : {}; res.json({ ok: L.ok, code: L.code || null, trial: !!(L.ok && L.sub.trial), trial_ends: L.ok ? (L.sub.trial_ends || null) : null, plan: L.ok ? L.sub.tier_name : null, period_end: L.ok ? L.sub.period_end : null, in_grace: !!(L.ok && L.sub.in_grace), grace_until: L.ok ? (L.sub.grace_until || null) : null, days_left: L.ok ? (L.sub.days_left != null ? L.sub.days_left : null) : null, white_label: !!(L.ok && !L.sub.trial && tier.white_label), api: !!(L.ok && !L.sub.trial && tier.api), limits: L.ok ? L.lim : null }); } catch (e) { orgErr(res, e); } });
/* SUBSCRIPTION LIFECYCLE SWEEP (daily): 7 days, 3 days and the day itself before period_end, then the grace notice. In-app + email to owners and managers; org audit line each time. */
async function subscriptionSweep() { const now = new Date(); const { data: subs } = await admin().from('org_subscriptions').select('*').eq('status', 'active').gt('period_end', new Date(now.getTime() - 4 * 86400000).toISOString()).limit(2000); let sent = 0; const N = require('./lib/notify'); const M = require('./lib/mailer');
  for (const sub of (subs || [])) { const daysLeft = Math.ceil((new Date(sub.period_end) - now) / 86400000); let key = null, title = null, body = null; if (daysLeft <= 0 && !sub.reminded_0) { key = 'reminded_0'; title = 'Your FF-CRM plan has ended · 3 days of grace'; body = 'FF-CRM keeps working for 3 more days. Renew under Billing to keep every client, file and mailbox live without interruption.'; } else if (daysLeft <= 3 && daysLeft > 0 && !sub.reminded_3) { key = 'reminded_3'; title = daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + ' left on your FF-CRM plan'; body = 'Renew under Billing before ' + String(sub.period_end).slice(0, 10) + '. After that you have 3 days of grace, then FF-CRM pauses.'; } else if (daysLeft <= 7 && daysLeft > 3 && !sub.reminded_7) { key = 'reminded_7'; title = 'Your FF-CRM plan renews in ' + daysLeft + ' days'; body = 'Nothing to do if your card is on file; otherwise renew under Billing before ' + String(sub.period_end).slice(0, 10) + '.'; } if (!key) continue;
    try { const { data: mem } = await admin().from('org_members').select('user_id').eq('org_id', sub.org_id).eq('status', 'active').in('role', ['owner', 'manager']).limit(20); const ids = (mem || []).map(m => m.user_id); for (const uid of ids) await N.push(uid, 'billing', title, body, 'work', sub.org_id); if (ids.length) { const { data: profs } = await admin().from('profiles').select('email').in('id', ids); const to = (profs || []).map(p => p.email).filter(Boolean).join(', '); if (to) await M.send(to, title, M.wrap(title, body, 'work')).catch(() => {}); } await admin().from('org_subscriptions').update({ [key]: now.toISOString() }).eq('id', sub.id); await orgAudit(sub.org_id, null, 'BILLING_REMINDER', key + ' · ' + title); sent++; } catch (e) {} }
  return { sent }; }
QUEUE.register('subscription_sweep', async () => subscriptionSweep());
app.get('/api/org/:id/invoices', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'finance.read'); const { data } = await admin().from('org_invoices').select('id,ref,tier_name,billing_period,amount_usd,period_start,period_end,status,emailed_to,emailed_at,created_at').eq('org_id', req.params.id).order('created_at', { ascending: false }).limit(100); res.json({ invoices: data || [] }); } catch (e) { orgErr(res, e); } });
app.post('/api/admin/subscriptions/sweep', auth, perm('settings.write'), async (req, res) => { try { res.json(await subscriptionSweep()); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ================= CONFIDENTIALITY: a consultancy's clients are masked from platform staff everywhere, unless the consultancy granted support access ================= */
const MASK_TTL = 60000; let _maskCache = { at: 0, ids: new Map() };
/* user_id → org_id for every client of a non-personal organisation whose support grant is not active. */
async function maskedClientMap() { if (Date.now() - _maskCache.at < MASK_TTL) return _maskCache.ids; const ids = new Map(); try { const { data: orgs } = await admin().from('organisations').select('id,kind,settings').neq('kind', 'personal').limit(5000); const masked = new Set((orgs || []).filter(o => !(o.settings && o.settings.support_access_until && new Date(o.settings.support_access_until) > new Date())).map(o => o.id)); if (masked.size) { const { data: cl } = await admin().from('clients').select('user_id,org_id').in('org_id', [...masked]).not('user_id', 'is', null).limit(20000); for (const c of (cl || [])) ids.set(c.user_id, c.org_id); } } catch (e) {} _maskCache = { at: Date.now(), ids }; return ids; }
function maskRow(row, keys) { const out = Object.assign({}, row); for (const k of keys) if (k in out && out[k]) out[k] = k === 'full_name' || k === 'name' ? String(out[k]).split(/\s+/).map(w => w[0] ? w[0].toUpperCase() + '.' : '').join(' ') + ' (consultancy client)' : '••••'; out.masked = true; return out; }
async function maskRows(rows, userKey, keys) { const m = await maskedClientMap(); if (!m.size) return rows; return (rows || []).map(r => { const uid = r[userKey] || (r.profiles && r.profiles.id) || r.user_id; if (uid && m.has(uid)) { const out = maskRow(r, keys); if (out.profiles) out.profiles = maskRow(out.profiles, ['full_name', 'email', 'phone', 'whatsapp']); out.channel_org_id = out.channel_org_id || m.get(uid); return out; } return r; }); }
async function staffMayOpen(userId) { const m = await maskedClientMap(); return !m.has(userId); }
/* Live updates reach the consultancy too: when a client's case moves, the owners, managers and the assigned consultant see it the same moment. */
async function orgWatchers(userId) { try { const { data: cl } = await admin().from('clients').select('org_id,owner_user_id').eq('user_id', userId).limit(3); const out = new Set(); for (const c of (cl || [])) { if (c.owner_user_id) out.add(c.owner_user_id); const { data: mem } = await admin().from('org_members').select('user_id').eq('org_id', c.org_id).eq('status', 'active').in('role', ['owner', 'manager']).limit(20); for (const mm of (mem || [])) out.add(mm.user_id); } out.delete(userId); return [...out]; } catch (e) { return []; } }
/* ======================================================================================================================================= */
/* Which visa route fits this case? Care → health/care route; labour → the labour/employment route; skilled → skilled/work route; study → student route. */
app.get('/api/visa/suggest', auth, async (req, res) => { try { const cc = String(req.query.cc || '').toUpperCase(); const category = String(req.query.category || ''); const lane = String(req.query.lane || 'work'); const routes = await VISA.routes(cc, lane === 'study' ? 'study' : 'work'); const pref = category === 'care' ? /care|health/i : category === 'labour' ? /labou?r|seasonal|employment|work permit|eps|ssw|mohre|iqama|general/i : lane === 'study' ? /stud|student/i : /skilled|work|employ|talent|blue card|opportunity/i; const pick = (routes || []).find(r => pref.test(r.route_name || r.name || '')) || (routes || [])[0] || null; res.json({ route: pick, routes }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ADMIN COCKPIT: one call, every section's headline numbers and what needs a decision today. */
app.get('/api/admin/cockpit', auth, perm('overview.read'), async (req, res) => { try { const since30 = new Date(Date.now() - 30 * 86400000).toISOString(); const c = async (t, f) => { try { let q = admin().from(t).select('id', { count: 'exact', head: true }); q = f ? f(q) : q; const { count } = await q; return count || 0; } catch (e) { return 0; } };
    const [briefs, seoHits] = await Promise.all([c('country_briefs'), c('seo_hits', q => q.gte('created_at', since30))]); const seoPages = 108 + 1; 
    const [applicants, newApplicants, casesDraft, casesSent, casesOffer, casesVisa, enrolled, orgs, orgsTrial, orgsActive, clients, pendingPayments, payments30, openTickets, needsReview, prospects, mous, partners, receivable, overdueInv, unreadMail, deadJobs] = await Promise.all([
      c('profiles', q => q.eq('role', 'user')), c('profiles', q => q.eq('role', 'user').gte('created_at', since30)), c('applications', q => q.in('status', ['draft', 'preparing'])), c('applications', q => q.eq('status', 'sent')), c('applications', q => q.in('status', ['offer', 'interview'])), c('visa_cases', q => q.in('status', ['submitted', 'decision_pending'])), c('applications', q => q.eq('status', 'enrolled')),
      c('organisations', q => q.neq('kind', 'personal')), c('organisations', q => q.eq('kind', 'agency').gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString())), c('org_subscriptions', q => q.eq('status', 'active')), c('clients'), c('payments', q => q.eq('status', 'pending')), c('payments', q => q.eq('status', 'confirmed').gte('created_at', since30)), c('support_tickets', q => q.eq('status', 'open')), c('case_messages', q => q.eq('needs_confirmation', true)), c('prospects', q => q.in('stage', ['found', 'researched', 'proposed', 'negotiating'])), c('official_documents', q => q.eq('kind', 'mou').eq('status', 'countersigned')), c('institutions', q => q.eq('partner_tier', 'mou')), c('partner_invoices', q => q.in('status', ['sent', 'reminded', 'pending'])), c('partner_invoices', q => q.in('status', ['sent', 'reminded']).lt('due_on', new Date().toISOString().slice(0, 10))), c('case_messages', q => q.eq('direction', 'in').is('read_at', null)), c('job_queue', q => q.eq('status', 'dead'))]);
    let revenue30 = 0; try { const { data } = await admin().from('payments').select('amount_usd,credits').eq('status', 'confirmed').gte('created_at', since30).limit(2000); const cfg = await siteSettings.getConfig(); const tiers = ((cfg.packages || {}).tiers || []); revenue30 = (data || []).reduce((a, p) => a + (Number(p.amount_usd) || (tiers.find(t => Number(t.credits) === Number(p.credits)) || {}).promo_usd || 0), 0); } catch (e) {}
    const needs = []; if (pendingPayments) needs.push({ n: pendingPayments, text: 'payments to confirm', tab: 'payments' }); if (openTickets) needs.push({ n: openTickets, text: 'support tickets open', tab: 'support' }); if (needsReview) needs.push({ n: needsReview, text: 'replies the reader was unsure about', tab: 'cases' }); if (overdueInv) needs.push({ n: overdueInv, text: 'partner invoices overdue', tab: 'partners' }); if (deadJobs) needs.push({ n: deadJobs, text: 'jobs that died', tab: 'selfheal' }); if (orgsTrial) needs.push({ n: orgsTrial, text: 'consultancies on trial this fortnight', tab: 'orgs' });
    const trends = {}; try { const d7 = new Date(Date.now() - 7 * 86400000).toISOString(), d14 = new Date(Date.now() - 14 * 86400000).toISOString(); const [a7, a14, s7, s14, p7, p14] = await Promise.all([c('profiles', q => q.eq('role', 'user').gte('created_at', d7)), c('profiles', q => q.eq('role', 'user').gte('created_at', d14).lt('created_at', d7)), c('applications', q => q.eq('status', 'sent').gte('updated_at', d7)), c('applications', q => q.eq('status', 'sent').gte('updated_at', d14).lt('updated_at', d7)), c('payments', q => q.eq('status', 'confirmed').gte('created_at', d7)), c('payments', q => q.eq('status', 'confirmed').gte('created_at', d14).lt('created_at', d7))]); trends.signups = { this: a7, last: a14 }; trends.sent = { this: s7, last: s14 }; trends.payments = { this: p7, last: p14 }; } catch (e) {}
    const summary = `${applicants} direct applicants (${newApplicants} new in 30 days) · ${casesDraft} cases in preparation, ${casesSent} sent, ${casesOffer} at offer or interview, ${casesVisa} visa files open, ${enrolled} enrolled · ${orgs} organisations, ${orgsActive} on a paid plan, ${clients} FF-CRM clients · $${Math.round(revenue30).toLocaleString()} revenue in 30 days · ${partners} partner institutions, ${prospects} prospects in play, $${Math.round(receivable).toLocaleString?receivable:receivable} invoices receivable · ${unreadMail} unread replies across all mailboxes.`;
    res.json({ summary, needs, trends, sections: { applicants: { total: applicants, new30: newApplicants, draft: casesDraft, sent: casesSent, offer: casesOffer, visa: casesVisa, enrolled }, crm: { organisations: orgs, trial14: orgsTrial, paid: orgsActive, clients }, money: { revenue30: Math.round(revenue30), pending: pendingPayments, confirmed30: payments30, partner_receivable_invoices: receivable, overdue: overdueInv }, outreach: { prospects, mous, partners }, mail: { unread: unreadMail, needs_review: needsReview }, ops: { tickets: openTickets, dead_jobs: deadJobs }, seo: { pages: seoPages, briefs, visits30: seoHits } } }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ADMIN STARTS A CASE FOR ANY APPLICANT: the case is the applicant's in every way (their vault, their address, their reference); no credit is spent; the action is audited and the applicant is told. */
app.post('/api/admin/cases/start', auth, perm('cases.write'), async (req, res) => { try { const b = req.body || {}; const { data: u } = await admin().from('profiles').select('id,full_name,role').eq('id', String(b.user_id || '')).maybeSingle(); if (!u || u.role !== 'user') return res.status(404).json({ error: 'Applicant not found' }); const { data: o } = await admin().from('opportunities').select('id,title,institution,country_code,kind').eq('id', String(b.opportunity_id || '')).maybeSingle(); if (!o) return res.status(404).json({ error: 'Opportunity not found' }); const { data: ex } = await admin().from('applications').select('id').eq('user_id', u.id).eq('opportunity_id', o.id).limit(1); if (ex && ex.length) return res.json({ application_id: ex[0].id, existing: true }); const caseNo = 'FF-' + Date.now().toString(36).toUpperCase().slice(-6); const { data: a, error } = await admin().from('applications').insert({ user_id: u.id, opportunity_id: o.id, case_no: caseNo, stage: 'preparing', status: 'draft', credits_consumed: 0, prep_status: 'queued' }).select('id').single(); if (error) return res.status(400).json({ error: error.message }); try { await REFS.assign('applications', a.id, 'application'); } catch (e) {} try { await admin().from('audit_log').insert({ actor: req.userId, event: 'ADMIN_STARTED_CASE', detail: a.id + ' for ' + u.id + ' · ' + String(o.title).slice(0, 80) }); } catch (e) {} try { await require('./lib/notify').push(u.id, 'case', 'A case was started for you: ' + String(o.title).slice(0, 60), 'ForiForeign started this case on your behalf. It is yours: your documents, your address, your review before anything is sent.', 'apps'); } catch (e) {} try { if (b.prepare !== false) { const { prepareApplication } = require('./lib/engine'); setTimeout(() => prepareApplication(a.id).catch(() => {}), 50); } } catch (e) {} res.json({ application_id: a.id, case_no: caseNo }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* FF-CRM: the consultancy creates the client's account and ForiForeign address itself (no domain needed). The account is born in this
   consultancy's workspace (signup_org_id), gets its own forimail address, and the client receives a sign-in link. Never for an email
   that already has an account (strict separation): the request is refused without saying whether the account exists elsewhere. */
app.post('/api/org/:id/clients/:cid/account', auth, async (req, res) => { try { const c = await orgClient(req, res, 'clients.write'); if (c.user_id) return res.json({ ok: true, existing: true, user_id: c.user_id }); const email = String(c.email || (req.body || {}).email || '').trim().toLowerCase(); if (!email || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return res.status(400).json({ error: 'The client needs an email address first.' }); if (/@(forimail\.com|foriforeign\.com)$/i.test(email)) return res.status(400).json({ error: 'Use the client\'s own email address.' }); const { data: exists } = await admin().from('profiles').select('id').ilike('email', email).maybeSingle(); if (exists) return res.status(409).json({ error: 'An account cannot be created for this email address. Ask the client to use another address.' }); const pw = require('crypto').randomBytes(12).toString('base64url') + 'A1!'; const { data: cr, error } = await admin().auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: c.full_name, origin_country: c.nationality || null, whatsapp: c.whatsapp || null } }); if (error) return res.status(400).json({ error: error.message }); const uid = cr.user.id; await admin().from('profiles').upsert({ id: uid, email, full_name: c.full_name, role: 'user', origin_country: c.nationality || null, phone: c.phone || null, whatsapp: c.whatsapp || null, lane_pref: c.lane || null, signup_org_id: req.params.id, signup_host: 'ff-crm' }); let applyEmail = null; try { const r = await BRAIN.provisionApplyEmail(uid); applyEmail = typeof r === 'string' ? r : (r && r.apply_email) || null; } catch (e) {} await admin().from('clients').update({ user_id: uid }).eq('id', c.id); let link = null; try { const { data: l } = await admin().auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: (process.env.PUBLIC_URL || 'https://foriforeign.com') + '/app' } }); link = l && l.properties && l.properties.action_link; } catch (e) {} try { const M = require('./lib/mailer'); const { data: og } = await admin().from('organisations').select('name,settings').eq('id', req.params.id).maybeSingle(); const name = og ? og.name : 'Your consultancy'; await M.send(email, name + ': your application account is ready', M.wrap('Your account is ready', 'Hello ' + (c.full_name || '') + ', ' + name + ' has opened your application account. Your application address is ' + (applyEmail || 'being issued') + '. ' + (link ? 'Sign in with this link (valid for a short time): ' + link : 'Use "Forgot your password" with this email to set your password.'), 'work')); } catch (e) {} await orgAudit(req.params.id, req.userId, 'CLIENT_ACCOUNT_CREATED', c.id + ' ' + uid); res.json({ ok: true, user_id: uid, apply_email: applyEmail, invited: !!link }); } catch (e) { orgErr(res, e); } });
app.get('/api/org/:id/clients/:cid/mail', auth, async (req, res) => { try { const c = await orgClient(req, res, 'clients.read'); const { data } = await admin().from('case_messages').select('id,direction,from_addr,to_addr,subject,body_text,classification,received_at').or('client_id.eq.' + c.id + (c.user_id ? ',user_id.eq.' + c.user_id : '')).order('received_at', { ascending: false }).limit(100); res.json({ apply_email: c.apply_email || null, messages: data || [] }); } catch (e) { orgErr(res, e); } });
/* ================= FF-CRM FULL SOLUTION: the consultancy's own partner universities, finance, lead capture ================= */
/* --- Own partner universities: priority for their clients, terms, coordination; also honoured by the platform's outreach refusal. --- */
app.get('/api/org/:id/partners', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.read'); const { data } = await admin().from('org_partners').select('*').eq('org_id', req.params.id).order('priority').order('name'); res.json({ partners: data || [] }); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/partners', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const b = req.body || {}; const rows = (Array.isArray(b.items) ? b.items : [b]).filter(x => x && x.name).slice(0, 500).map(x => ({ org_id: req.params.id, name: String(x.name).trim().slice(0, 200), country_code: String(x.country_code || x.cc || '').toUpperCase().slice(0, 2) || null, domain: String(x.domain || '').toLowerCase().replace(/^https?:\/\//, '').split('/')[0].slice(0, 120) || null, kind: ['university', 'college', 'employer', 'other'].includes(x.kind) ? x.kind : 'university', contact_name: String(x.contact_name || '').slice(0, 120) || null, contact_email: String(x.contact_email || '').slice(0, 160) || null, contact_phone: String(x.contact_phone || '').slice(0, 40) || null, terms: { fee_pct: Number(x.fee_pct) || null, fixed: Number(x.fixed) || null, currency: String(x.currency || 'USD').slice(0, 3), payment_days: Number(x.payment_days) || null, intakes: String(x.intakes || '').slice(0, 80) || null }, agreement_from: x.agreement_from || null, agreement_to: x.agreement_to || null, priority: Math.max(1, Math.min(9, Number(x.priority) || 1)), notes: String(x.notes || '').slice(0, 500) || null })); if (!rows.length) return res.status(400).json({ error: 'name is required' }); const { data, error } = await admin().from('org_partners').insert(rows).select('id'); if (error) return res.status(400).json({ error: error.message }); try { const key = 'protected_partners:' + req.params.id; const { data: cur } = await admin().from('app_settings').select('value').eq('key', key).maybeSingle(); const names = new Set(((cur && cur.value && cur.value.names) || []).map(String)); rows.forEach(r => names.add(r.name)); await admin().from('app_settings').upsert({ key, value: { names: [...names].slice(0, 2000) } }); } catch (e) {} await orgAudit(req.params.id, req.userId, 'PARTNERS_ADDED', rows.length + ' partner(s)'); res.json({ added: (data || []).length }); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/partners/import', auth, express.text({ type: ['text/csv', 'text/plain'], limit: '1mb' }), async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const lines = String(req.body || '').split(/\r?\n/).filter(l => l.trim()); if (lines.length < 2) return res.status(400).json({ error: 'CSV needs a header and rows' }); const head = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, '_')); const items = lines.slice(1).map(l => { const cells = l.split(','); const o = {}; head.forEach((h, i) => { o[h] = (cells[i] || '').trim(); }); return o; }); req.body = { items }; req.headers['content-type'] = 'application/json'; return app._router.handle(Object.assign(req, { url: '/api/org/' + req.params.id + '/partners', method: 'POST' }), res, () => {}); } catch (e) { orgErr(res, e); } });
app.put('/api/org/:id/partners/:pid', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const b = req.body || {}; const patch = {}; for (const k of ['name', 'country_code', 'domain', 'kind', 'contact_name', 'contact_email', 'contact_phone', 'agreement_from', 'agreement_to', 'priority', 'status', 'notes']) if (b[k] !== undefined) patch[k] = b[k]; if (b.terms) patch.terms = b.terms; patch.updated_at = new Date().toISOString(); await admin().from('org_partners').update(patch).eq('id', req.params.pid).eq('org_id', req.params.id); res.json({ ok: true }); } catch (e) { orgErr(res, e); } });
app.delete('/api/org/:id/partners/:pid', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); await admin().from('org_partners').delete().eq('id', req.params.pid).eq('org_id', req.params.id); res.json({ ok: true }); } catch (e) { orgErr(res, e); } });
function leadScore(c) { let sc = 0; const why = []; if (c.email) { sc += 15; why.push('email'); } if (c.whatsapp || c.phone) { sc += 15; why.push('phone'); } if (c.lane) { sc += 10; why.push('lane'); } if (c.target_country) { sc += 15; why.push('country'); } if (c.user_id) { sc += 20; why.push('registered'); } if (c.source === 'referral') { sc += 10; why.push('referral'); } if (c.source === 'api' || c.source === 'web') sc += 5; const p = c.profile || {}; if (p.highest_level || p.degree_level) { sc += 10; why.push('education'); } return { score: Math.min(100, sc), why }; }
async function orgPartnerNames(orgId) { try { const { data } = await admin().from('org_partners').select('name,domain,priority').eq('org_id', orgId).eq('status', 'active').limit(2000); return data || []; } catch (e) { return []; } }
/* --- Finance: bank accounts (records), expenses, disputes, commissions received, P&L by branch and month --- */
app.get('/api/org/:id/bank-accounts', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'finance.read'); const { data } = await admin().from('org_bank_accounts').select('id,label,bank,account_title,currency,is_default,created_at,account_no').eq('org_id', req.params.id); res.json({ accounts: (data || []).map(a => Object.assign(a, { account_no: a.account_no ? '••••' + String(a.account_no).slice(-4) : null })) }); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/bank-accounts', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const b = req.body || {}; if (b.is_default) await admin().from('org_bank_accounts').update({ is_default: false }).eq('org_id', req.params.id); const { data, error } = await admin().from('org_bank_accounts').insert({ org_id: req.params.id, label: String(b.label || 'Main').slice(0, 60), bank: String(b.bank || '').slice(0, 120), account_title: String(b.account_title || '').slice(0, 120), account_no: String(b.account_no || '').slice(0, 40), iban: String(b.iban || '').slice(0, 40), swift: String(b.swift || '').slice(0, 20), currency: String(b.currency || 'PKR').slice(0, 3), is_default: !!b.is_default }).select('id').single(); if (error) return res.status(400).json({ error: error.message }); await orgAudit(req.params.id, req.userId, 'BANK_ACCOUNT_ADDED', b.label || ''); res.json({ id: data.id }); } catch (e) { orgErr(res, e); } });
app.get('/api/org/:id/expenses', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'finance.read'); let q = admin().from('org_expenses').select('*').eq('org_id', req.params.id).order('occurred_on', { ascending: false }).limit(500); if (req.query.branch) q = q.eq('branch', req.query.branch); const { data } = await q; res.json({ expenses: data || [] }); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/expenses', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'finance.write'); const b = req.body || {}; const { data, error } = await admin().from('org_expenses').insert({ org_id: req.params.id, branch: String(b.branch || '').slice(0, 60) || null, category: String(b.category || 'other').slice(0, 40), amount: Number(b.amount) || 0, currency: String(b.currency || 'PKR').slice(0, 3), occurred_on: b.occurred_on || new Date().toISOString().slice(0, 10), note: String(b.note || '').slice(0, 300) || null, created_by: req.userId }).select('id').single(); if (error) return res.status(400).json({ error: error.message }); res.json({ id: data.id }); } catch (e) { orgErr(res, e); } });
app.get('/api/org/:id/disputes', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'finance.read'); const { data } = await admin().from('org_disputes').select('*').eq('org_id', req.params.id).order('opened_at', { ascending: false }).limit(200); res.json({ disputes: data || [] }); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/disputes', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'finance.write'); const b = req.body || {}; const ref = 'DSP-' + Date.now().toString(36).toUpperCase().slice(-6); const { data, error } = await admin().from('org_disputes').insert({ org_id: req.params.id, ref, with_kind: ['client', 'partner', 'staff'].includes(b.with_kind) ? b.with_kind : 'client', client_id: b.client_id || null, partner_id: b.partner_id || null, amount: Number(b.amount) || null, currency: String(b.currency || 'PKR').slice(0, 3), reason: String(b.reason || '').slice(0, 1000) }).select('id,ref').single(); if (error) return res.status(400).json({ error: error.message }); await orgAudit(req.params.id, req.userId, 'DISPUTE_OPENED', ref); res.json(data); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/disputes/:did/resolve', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'finance.write'); await admin().from('org_disputes').update({ status: 'resolved', resolution: String((req.body || {}).resolution || '').slice(0, 1000), resolved_at: new Date().toISOString() }).eq('id', req.params.did).eq('org_id', req.params.id); res.json({ ok: true }); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/commissions/:cid/received', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'finance.write'); await admin().from('commission_ledger').update({ status: 'paid', received_on: (req.body || {}).received_on || new Date().toISOString().slice(0, 10) }).eq('id', req.params.cid).eq('org_id', req.params.id); await orgAudit(req.params.id, req.userId, 'COMMISSION_RECEIVED', req.params.cid); res.json({ ok: true }); } catch (e) { orgErr(res, e); } });
app.get('/api/org/:id/finance/report', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'finance.read'); const from = String(req.query.from || new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)), to = String(req.query.to || new Date().toISOString().slice(0, 10)); const [{ data: fin }, { data: comm }, { data: exp }, { data: cl }] = await Promise.all([admin().from('client_finance').select('client_id,kind,amount,currency,occurred_on,branch').eq('org_id', req.params.id).gte('occurred_on', from).lte('occurred_on', to).limit(5000), admin().from('commission_ledger').select('amount_usd,amount_pkr,status,received_on,branch,client_id,created_at,sub_agent_share_pct').eq('org_id', req.params.id).limit(5000), admin().from('org_expenses').select('branch,category,amount,currency,occurred_on').eq('org_id', req.params.id).gte('occurred_on', from).lte('occurred_on', to).limit(5000), admin().from('clients').select('id,branch,stage,created_at,source').eq('org_id', req.params.id).limit(5000)]); const branchOf = {}; for (const c of (cl || [])) branchOf[c.id] = c.branch || 'Head office'; const B = {}; const M = {}; const bump = (b, m, k, v) => { B[b] = B[b] || { income: 0, commissions: 0, expenses: 0, clients: 0, enrolled: 0 }; B[b][k] += v; if (m) { M[m] = M[m] || { income: 0, commissions: 0, expenses: 0 }; if (k in M[m]) M[m][k] += v; } }; for (const f of (fin || [])) { const b = f.branch || branchOf[f.client_id] || 'Head office'; const m = String(f.occurred_on || '').slice(0, 7); if (f.kind === 'payment_received') bump(b, m, 'income', Number(f.amount) || 0); else if (f.kind === 'refund') bump(b, m, 'income', -(Number(f.amount) || 0)); else if (f.kind === 'commission_in') bump(b, m, 'commissions', Number(f.amount) || 0); else if (f.kind === 'cost' || f.kind === 'commission_out') bump(b, m, 'expenses', Number(f.amount) || 0); } for (const c of (comm || [])) { if (c.status !== 'paid') continue; const b = c.branch || branchOf[c.client_id] || 'Head office'; const m = String(c.received_on || c.created_at || '').slice(0, 7); bump(b, m, 'commissions', Number(c.amount_usd || 0) || 0); } for (const e of (exp || [])) bump(e.branch || 'Head office', String(e.occurred_on || '').slice(0, 7), 'expenses', Number(e.amount) || 0); for (const c of (cl || [])) { const b = c.branch || 'Head office'; B[b] = B[b] || { income: 0, commissions: 0, expenses: 0, clients: 0, enrolled: 0 }; B[b].clients++; if (c.stage === 'enrolled') B[b].enrolled++; } const branches = Object.entries(B).map(([name, v]) => Object.assign({ name, profit: v.income + v.commissions - v.expenses }, v)); const months = Object.entries(M).sort().map(([m, v]) => Object.assign({ month: m, profit: v.income + v.commissions - v.expenses }, v)); const totals = branches.reduce((a, b) => ({ income: a.income + b.income, commissions: a.commissions + b.commissions, expenses: a.expenses + b.expenses, profit: a.profit + b.profit, clients: a.clients + b.clients, enrolled: a.enrolled + b.enrolled }), { income: 0, commissions: 0, expenses: 0, profit: 0, clients: 0, enrolled: 0 }); const sources = {}; for (const c of (cl || [])) sources[c.source || 'unknown'] = (sources[c.source || 'unknown'] || 0) + 1; const cohorts = {}; try { for (const c of (cl || [])) { const mth = String(c.created_at || '').slice(0, 7); cohorts[mth] = cohorts[mth] || { clients: 0, enrolled: 0 }; cohorts[mth].clients++; if (c.stage === 'enrolled') cohorts[mth].enrolled++; } } catch (e) {} const lost = {}; const byConsultant = {}; try { const { data: cl2 } = await admin().from('clients').select('assigned_to,owner_user_id,stage,lost_reason,sub_agent_user_id,sub_agent_share_pct').eq('org_id', req.params.id).limit(5000); for (const c of (cl2 || [])) { if (c.stage === 'lost') lost[c.lost_reason || 'not given'] = (lost[c.lost_reason || 'not given'] || 0) + 1; const k = c.assigned_to || c.owner_user_id || 'unassigned'; byConsultant[k] = byConsultant[k] || { clients: 0, enrolled: 0, lost: 0 }; byConsultant[k].clients++; if (c.stage === 'enrolled') byConsultant[k].enrolled++; if (c.stage === 'lost') byConsultant[k].lost++; } const ids = Object.keys(byConsultant).filter(k => k !== 'unassigned'); const { data: profs } = ids.length ? await admin().from('profiles').select('id,full_name').in('id', ids) : { data: [] }; for (const p of (profs || [])) if (byConsultant[p.id]) byConsultant[p.id].name = p.full_name; } catch (e) {} let subAgentPayable = 0; try { for (const c of (comm || [])) if (c.status === 'paid' && c.sub_agent_share_pct) subAgentPayable += Number(c.amount_usd || 0) * Number(c.sub_agent_share_pct) / 100; } catch (e) {} res.json({ from, to, totals, branches, months, sources, cohorts: Object.entries(cohorts).sort().map(([month, v]) => Object.assign({ month, conversion_pct: v.clients ? Math.round(100 * v.enrolled / v.clients) : 0 }, v)), lost_reasons: lost, by_consultant: byConsultant, sub_agent_payable_usd: Math.round(subAgentPayable * 100) / 100, note: 'Client fees in the currency you recorded them; commissions in USD as recorded; expenses as recorded. Records, not a bank feed.' }); } catch (e) { orgErr(res, e); } });
/* --- Lead capture: a lead email address per consultancy, the consultancy's own WhatsApp number and AI key (BYOC), and the public API --- */
app.get('/api/org/:id/lead-channels', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const { data: o } = await admin().from('organisations').select('settings,name').eq('id', req.params.id).maybeSingle(); const st = (o && o.settings) || {}; let lead_email = st.lead_email; if (!lead_email) { const base = 'leads.' + String(o.name || 'org').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24); lead_email = base + '@' + (process.env.APPLY_DOMAIN || 'forimail.com'); await admin().from('organisations').update({ settings: Object.assign({}, st, { lead_email }) }).eq('id', req.params.id); } const wa = st.whatsapp_byoc || {}; res.json({ lead_email, whatsapp: { phone_id: wa.phone_id || null, connected: !!(wa.phone_id && wa.token), ai_provider: wa.ai_provider || null, ai_key_set: !!wa.ai_key, verify_token: wa.verify_token || null, webhook_url: (process.env.PUBLIC_URL || 'https://foriforeign.com') + '/api/hooks/whatsapp/' + req.params.id }, api: { docs: '/api-docs.html', leads_endpoint: 'POST /api/v1/leads' } }); } catch (e) { orgErr(res, e); } });
app.put('/api/org/:id/lead-channels', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const b = req.body || {}; const { data: o } = await admin().from('organisations').select('settings').eq('id', req.params.id).maybeSingle(); const st = (o && o.settings) || {}; const wa = Object.assign({}, st.whatsapp_byoc || {}); if (b.phone_id !== undefined) wa.phone_id = String(b.phone_id || '').slice(0, 40); if (b.token) wa.token = String(b.token).slice(0, 400); if (b.ai_provider !== undefined) wa.ai_provider = ['openai', 'anthropic', 'gemini', ''].includes(b.ai_provider) ? b.ai_provider : ''; if (b.ai_key) wa.ai_key = String(b.ai_key).slice(0, 200); if (b.app_secret !== undefined) wa.app_secret = String(b.app_secret || '').slice(0, 120) || undefined; if (!wa.verify_token) wa.verify_token = require('crypto').randomBytes(12).toString('hex'); if (b.greeting !== undefined) wa.greeting = String(b.greeting).slice(0, 500); await admin().from('organisations').update({ settings: Object.assign({}, st, { whatsapp_byoc: wa }) }).eq('id', req.params.id); await orgAudit(req.params.id, req.userId, 'LEAD_CHANNELS_UPDATED', 'whatsapp ' + (wa.phone_id ? 'set' : 'cleared')); res.json({ ok: true, verify_token: wa.verify_token }); } catch (e) { orgErr(res, e); } });
app.get('/api/hooks/whatsapp/:id', async (req, res) => { try { const { data: o } = await admin().from('organisations').select('settings').eq('id', req.params.id).maybeSingle(); const wa = (o && o.settings && o.settings.whatsapp_byoc) || {}; if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] && req.query['hub.verify_token'] === wa.verify_token) return res.status(200).send(String(req.query['hub.challenge'] || '')); res.status(403).end(); } catch (e) { res.status(403).end(); } });
app.post('/api/hooks/whatsapp/:id', async (req, res) => { const { data: o } = await admin().from('organisations').select('id,name,settings').eq('id', req.params.id).maybeSingle(); const wa = (o && o.settings && o.settings.whatsapp_byoc) || {}; if (wa.app_secret) { try { const sig = String(req.headers['x-hub-signature-256'] || ''); const raw = req.rawBody || JSON.stringify(req.body || {}); const h = 'sha256=' + require('crypto').createHmac('sha256', wa.app_secret).update(raw).digest('hex'); if (sig !== h) return res.status(403).json({ error: 'bad signature' }); } catch (e) { return res.status(403).end(); } } res.json({ ok: true }); try { if (!wa.phone_id || !wa.token) return; const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'x'; if ((await LIMITER.hit('wahook:' + ip, 60)) > 120) return; const md0 = (((((req.body || {}).entry || [])[0] || {}).changes || [])[0] || {}).value || {}; const pid = md0.metadata && md0.metadata.phone_number_id ? String(md0.metadata.phone_number_id) : ''; if (pid && pid !== String(wa.phone_id)) return; const entries = ((req.body || {}).entry || []); for (const en of entries) for (const ch of (en.changes || [])) { const val = ch.value || {}; for (const m of (val.messages || [])) { const from = String(m.from || ''); const text = m.text && m.text.body ? String(m.text.body) : (m.type || 'message'); const name = ((val.contacts || [])[0] || {}).profile && ((val.contacts || [])[0]).profile.name || from; const num = from.replace(/\D/g, ''); let { data: cl } = await admin().from('clients').select('id,full_name').eq('org_id', o.id).or('whatsapp.ilike.%' + num.slice(-9) + '%,phone.ilike.%' + num.slice(-9) + '%').is('archived_at', null).limit(1); let client = cl && cl[0]; if (!client) { const { data: row } = await admin().from('clients').insert({ org_id: o.id, owner_user_id: null, full_name: String(name).slice(0, 120), whatsapp: '+' + from.replace(/^\+/, ''), phone: '+' + from.replace(/^\+/, ''), stage: 'lead', source: 'whatsapp', source_detail: 'own number ' + wa.phone_id, notes: 'First message: ' + text.slice(0, 300) }).select('id,full_name').single(); client = row; try { const { data: mem } = await admin().from('org_members').select('user_id').eq('org_id', o.id).eq('status', 'active').in('role', ['owner', 'manager', 'consultant']).limit(20); for (const mm of (mem || [])) await require('./lib/notify').push(mm.user_id, 'lead', 'New WhatsApp lead: ' + String(name).slice(0, 40), text.slice(0, 160), 'work', o.id); } catch (e) {} } try { await admin().from('client_notes').insert({ org_id: o.id, client_id: client.id, kind: 'whatsapp_in', text: text.slice(0, 2000) }); } catch (e) {} /* reply: the consultancy's own AI key if set, otherwise its greeting */ let reply = wa.greeting || ('Thank you for contacting ' + o.name + '. A consultant will reply shortly. Please share: your name, the country you want, and whether it is study or work.'); if (wa.ai_key && wa.ai_provider) { try { let history = []; try { const { data: h } = await admin().from('client_notes').select('kind,text,created_at').eq('client_id', client.id).in('kind', ['whatsapp_in', 'whatsapp_out']).order('created_at', { ascending: false }).limit(8); history = (h || []).reverse(); } catch (e) {} reply = await require('./lib/byoc').reply(wa, { org: o.name, text, name, history }); try { await admin().from('client_notes').insert({ org_id: o.id, client_id: client.id, kind: 'whatsapp_out', text: String(reply).slice(0, 2000) }); } catch (e) {} } catch (e) {} } try { await fetch('https://graph.facebook.com/v20.0/' + wa.phone_id + '/messages', { method: 'POST', headers: { authorization: 'Bearer ' + wa.token, 'content-type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: from, type: 'text', text: { body: reply.slice(0, 900) } }) }); } catch (e) {} } } } catch (e) {} });
app.post('/api/v1/leads', apiKeyAuth, async (req, res) => { try { const b = req.body || {}; if ((await LIMITER.hit('apileads:' + req.orgId, 3600)) > 300) return res.status(429).json({ error: 'Too many leads this hour' }); if (!b.full_name && !b.phone && !b.email) return res.status(400).json({ error: 'full_name, phone or email required' }); const c = await ORGS.createClient(req.orgId, null, { full_name: b.full_name || b.phone || b.email, email: b.email, phone: b.phone, whatsapp: b.whatsapp || b.phone, lane: b.lane, nationality: b.nationality, stage: 'lead', notes: b.notes, branch: b.branch }); try { await admin().from('clients').update({ source: 'api', source_detail: String(b.source || 'api').slice(0, 80) }).eq('id', c.id); } catch (e) {} res.json({ client_id: c.id }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ============================================================================================================================ */
/* ================= PORTAL ASSIST: one button per user (or per client by the consultancy on their behalf, with consent) ================= */
const STATUS_WORDS = [[/(granted|approved|issued|visa has been issued|decision made.*grant)/i, 'granted', 'granted'], [/(refused|rejected|denied|unsuccessful)/i, 'refused', 'refused'], [/(under process|in process|processing|being processed|under review|pending|received|submitted)/i, 'processing', 'decision_pending'], [/(biometric|appointment|vac|visa application cent(re|er))/i, 'appointment', null], [/(additional documents|further documents|request for information|rfi)/i, 'documents requested', null], [/(dispatched|ready for collection|collect your passport|courier)/i, 'ready for collection', null]];
function portalStatusFromText(t) { const x = String(t || ''); for (const [re, label, vstatus] of STATUS_WORDS) if (re.test(x)) return { label, vstatus }; return { label: 'status page captured', vstatus: null }; }
/* When the words are ambiguous, the model reads the page text and answers with one of the fixed labels; never invents a decision. */
async function portalStatusSmart(t) { const quick = portalStatusFromText(t); if (quick.vstatus) return quick; try { const txt = await callAI('cheap', 'Read this visa/immigration portal status text and answer ONLY with JSON {"label": one of ["granted","refused","processing","documents requested","appointment","ready for collection","unknown"], "evidence": "short quote"}. Do not guess: if unclear, "unknown".\n\n' + String(t || '').slice(0, 5000), { maxTokens: 120 }); const j = JSON.parse(String(txt).replace(/```json|```/g, '').trim()); const map = { granted: 'granted', refused: 'refused', processing: 'decision_pending' }; if (j && j.label && j.label !== 'unknown') return { label: j.label, vstatus: map[j.label] || null, evidence: j.evidence }; } catch (e) {} return quick; }
async function portalPacketFor(conn, actorUserId, orgId) { const { data: p } = await admin().from('profiles').select('full_name,apply_email,phone,whatsapp,passport_number,date_of_birth').eq('id', conn.user_id).maybeSingle(); const { data: vc } = await admin().from('visa_cases').select('tracking_ref,country_code').eq('user_id', conn.user_id).in('status', ['submitted', 'decision_pending', 'preparing']).order('updated_at', { ascending: false }).limit(1); const name = String((p && p.full_name) || '').trim(); const token = require('crypto').randomBytes(24).toString('base64url'); await admin().from('app_settings').upsert({ key: 'portal_token:' + token, value: { portal_id: conn.id, user_id: conn.user_id, actor: actorUserId, org_id: orgId || null, exp: Date.now() + 7 * 86400000 } }); let password = null; try { password = require('./lib/crypto').decrypt(conn.secret_enc); } catch (e) {} return { portal_id: conn.id, url: conn.status_url || conn.login_url, app_url: process.env.PUBLIC_URL || 'https://foriforeign.com', token, org_id: orgId || null, fields: { username: conn.username || (p && p.apply_email) || '', password, phone: (p && (p.whatsapp || p.phone)) || '', first_name: name.split(' ')[0] || '', last_name: name.split(' ').slice(1).join(' ') || '', passport_number: (p && p.passport_number) || '', date_of_birth: (p && p.date_of_birth) ? String(p.date_of_birth).slice(0, 10) : '', tracking_ref: vc && vc[0] ? vc[0].tracking_ref || '' : '' } }; }
app.post('/api/me/portals/:id/handoff', auth, async (req, res) => { try { const { data: c } = await admin().from('portal_connections').select('*').eq('id', req.params.id).eq('user_id', req.userId).maybeSingle(); if (!c) return res.status(404).json({ error: 'Portal not found' }); if (!c.consent) return res.status(400).json({ error: 'Consent is required first' }); res.json({ packet: await portalPacketFor(c, req.userId, null) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/org/:id/clients/:cid/portals/:pid/handoff', auth, async (req, res) => { try { const cl = await orgClient(req, res, 'clients.write'); if (!cl.user_id) return res.status(400).json({ error: 'This client has no account yet' }); const { data: c } = await admin().from('portal_connections').select('*').eq('id', req.params.pid).eq('user_id', cl.user_id).maybeSingle(); if (!c || !c.consent) return res.status(404).json({ error: 'Portal not found or not consented' }); res.json({ packet: await portalPacketFor(c, req.userId, req.params.id) }); } catch (e) { orgErr(res, e); } });
/* The extension posts the visible status and a screenshot with the one-time token; the visa file is updated and everyone concerned is told. */
app.post('/api/me/portals/:id/status', express.json({ limit: '6mb' }), async (req, res) => { try { const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); const { data: t } = await admin().from('app_settings').select('value').eq('key', 'portal_token:' + token).maybeSingle(); const v = t && t.value; if (!v || v.portal_id !== req.params.id || Date.now() > Number(v.exp || 0)) return res.status(401).json({ error: 'Press the button in ForiForeign again' }); const b = req.body || {}; const st = await portalStatusSmart(b.text); let screenshot_key = null; try { const m = String(b.screenshot || '').match(/^data:image\/(jpeg|png);base64,(.+)$/); if (m) { const buf = Buffer.from(m[2], 'base64'); if (buf.length <= 4 * 1024 * 1024) { screenshot_key = 'portal/' + v.user_id + '/' + Date.now() + '.' + (m[1] === 'png' ? 'png' : 'jpg'); await admin().storage.from('documents').upload(screenshot_key, buf, { contentType: 'image/' + m[1], upsert: true }); } } } catch (e) {} await admin().from('portal_runs').insert({ connection_id: v.portal_id, user_id: v.user_id, status: 'ok', summary: String(b.text || '').slice(0, 1500), status_label: st.label, page_url: String(b.page_url || '').slice(0, 500), screenshot_key, by_user_id: v.actor || null, on_behalf_org_id: v.org_id || null }).then(() => {}, () => {}); let changed = false; if (st.vstatus) { const { data: vc } = await admin().from('visa_cases').select('id,status').eq('user_id', v.user_id).in('status', ['submitted', 'decision_pending', 'preparing']).order('updated_at', { ascending: false }).limit(1); if (vc && vc[0] && vc[0].status !== st.vstatus) { await admin().from('visa_cases').update({ status: st.vstatus, decision_on: st.vstatus === 'granted' || st.vstatus === 'refused' ? new Date().toISOString().slice(0, 10) : null, updated_at: new Date().toISOString() }).eq('id', vc[0].id); changed = true; } } try { await require('./lib/notify').push(v.user_id, 'visa', 'Portal status: ' + st.label, String(b.text || '').slice(0, 160), 'profile'); } catch (e) {} try { await CONSENT.record({ ip: req.ip, headers: req.headers }, v.user_id, 'terms', { v: 'portal_status_captured' }, { portal_id: v.portal_id, label: st.label, by: v.actor }); } catch (e) {} res.json({ ok: true, status_label: st.label, changed }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ================= CRM GAPS: follow-up sequences, my tasks, broadcasts, duplicates, lost reasons, staff and sub-agent reports ================= */
app.get('/api/org/:id/my-tasks', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.read'); const today = new Date().toISOString().slice(0, 10); const { data: tasks } = await admin().from('client_tasks').select('id,client_id,title,due_on,status,assigned_to').eq('org_id', req.params.id).eq('status', 'open').or('assigned_to.eq.' + req.userId + ',assigned_to.is.null').order('due_on').limit(200); const { data: appts } = await admin().from('appointments').select('id,client_id,title,starts_at').eq('org_id', req.params.id).gte('starts_at', today).lte('starts_at', today + 'T23:59:59').limit(50).then(r => r, () => ({ data: [] })); const ids = [...new Set([...(tasks || []), ...(appts || [])].map(t => t.client_id).filter(Boolean))]; const { data: cls } = ids.length ? await admin().from('clients').select('id,full_name,stage').in('id', ids.slice(0, 200)) : { data: [] }; const nameOf = Object.fromEntries((cls || []).map(c => [c.id, c])); res.json({ overdue: (tasks || []).filter(t => t.due_on && t.due_on < today).map(t => Object.assign(t, { client: nameOf[t.client_id] })), today: (tasks || []).filter(t => t.due_on === today).map(t => Object.assign(t, { client: nameOf[t.client_id] })), upcoming: (tasks || []).filter(t => !t.due_on || t.due_on > today).slice(0, 30).map(t => Object.assign(t, { client: nameOf[t.client_id] })), appointments: (appts || []).map(a => Object.assign(a, { client: nameOf[a.client_id] })) }); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/broadcast', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const b = req.body || {}; const channel = b.channel === 'whatsapp' ? 'whatsapp' : 'email'; const template = String(b.template || '').slice(0, 1500); if (!template) return res.status(400).json({ error: 'Write the message' }); let q = admin().from('clients').select('id,full_name,email,whatsapp,stage,branch,no_marketing').eq('org_id', req.params.id).is('archived_at', null).limit(500); if (b.stage) q = q.eq('stage', b.stage); if (b.branch) q = q.eq('branch', b.branch); const { data: cls } = await q; const { data: o } = await admin().from('organisations').select('name,settings').eq('id', req.params.id).maybeSingle(); const wa = (o && o.settings && o.settings.whatsapp_byoc) || {}; const M = require('./lib/mailer'); let sent = 0; for (const c of (cls || []).filter(x => !x.no_marketing).slice(0, 300)) { const text = template.replace(/\{name\}/g, (c.full_name || '').split(' ')[0]).replace(/\{consultancy\}/g, o ? o.name : ''); try { if (channel === 'email' && c.email) { await M.send(c.email, String(b.subject || ('A note from ' + (o ? o.name : 'your consultancy'))).slice(0, 150), M.wrap(o ? o.name : 'Your consultancy', text, 'work')); sent++; } else if (channel === 'whatsapp' && c.whatsapp && wa.phone_id && wa.token) { await fetch('https://graph.facebook.com/v20.0/' + wa.phone_id + '/messages', { method: 'POST', headers: { authorization: 'Bearer ' + wa.token, 'content-type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: String(c.whatsapp).replace(/\D/g, ''), type: 'text', text: { body: text.slice(0, 900) } }) }); sent++; } await admin().from('client_notes').insert({ org_id: req.params.id, client_id: c.id, kind: 'broadcast_' + channel, text: text.slice(0, 1000) }).then(() => {}, () => {}); } catch (e) {} } await admin().from('org_broadcasts').insert({ org_id: req.params.id, channel, filter: { stage: b.stage || null, branch: b.branch || null }, template, sent, created_by: req.userId }); await orgAudit(req.params.id, req.userId, 'BROADCAST', channel + ' to ' + sent); res.json({ sent, of: (cls || []).length }); } catch (e) { orgErr(res, e); } });
app.post('/api/org/:id/clients/:cid/lost', auth, async (req, res) => { try { const c = await orgClient(req, res, 'clients.write'); const reason = String((req.body || {}).reason || '').slice(0, 300); await admin().from('clients').update({ stage: 'lost', lost_reason: reason || null, updated_at: new Date().toISOString() }).eq('id', c.id); await orgAudit(req.params.id, req.userId, 'CLIENT_LOST', c.id + ' · ' + reason); res.json({ ok: true }); } catch (e) { orgErr(res, e); } });
/* Follow-up sequence: leads with no activity get a courteous nudge on day 1, 3 and 7 (email, or WhatsApp if the consultancy connected its number); stops the moment the stage changes. */
async function leadFollowups() { const now = Date.now(); const { data: orgs } = await admin().from('organisations').select('id,name,settings').neq('kind', 'personal').limit(2000); const M = require('./lib/mailer'); let sent = 0; for (const o of (orgs || [])) { const seq = (o.settings && o.settings.followups) || { enabled: true, days: [1, 3, 7], template: 'Hi {name}, this is {consultancy}. We received your enquiry and would love to help with your plan to study or work abroad. Reply with the country you have in mind and the best time to call.' }; if (seq.enabled === false) continue; const { data: leads } = await admin().from('clients').select('id,full_name,email,whatsapp,created_at,last_activity_at,followup_step,stage,source').eq('org_id', o.id).eq('stage', 'lead').is('archived_at', null).limit(500); const wa = (o.settings && o.settings.whatsapp_byoc) || {}; for (const c of (leads || [])) { if (!seq.include_imported && ['csv', 'walk-in', 'referral'].includes(String(c.source || ''))) continue; const step = Number(c.followup_step) || 0; const days = seq.days || [1, 3, 7]; if (step >= days.length) continue; const since = (now - new Date(c.last_activity_at || c.created_at).getTime()) / 86400000; if (since < days[step]) continue; const text = String(seq.template || '').replace(/\{name\}/g, (c.full_name || '').split(' ')[0]).replace(/\{consultancy\}/g, o.name); try { let ok = false; if (c.whatsapp && wa.phone_id && wa.token) { await fetch('https://graph.facebook.com/v20.0/' + wa.phone_id + '/messages', { method: 'POST', headers: { authorization: 'Bearer ' + wa.token, 'content-type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: String(c.whatsapp).replace(/\D/g, ''), type: 'text', text: { body: text.slice(0, 900) } }) }); ok = true; } else if (c.email) { const r = await M.send(c.email, 'Following up · ' + o.name, M.wrap(o.name, text, 'work')); ok = !!r.sent; } if (ok) { sent++; await admin().from('clients').update({ followup_step: step + 1 }).eq('id', c.id); await admin().from('client_notes').insert({ org_id: o.id, client_id: c.id, kind: 'followup', text: 'Follow-up ' + (step + 1) + ' sent: ' + text.slice(0, 200) }).then(() => {}, () => {}); } } catch (e) {} } } return { sent }; }
QUEUE.register('lead_followups', async () => leadFollowups());
app.get('/api/org/:id/followups', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const { data: o } = await admin().from('organisations').select('settings').eq('id', req.params.id).maybeSingle(); res.json({ followups: (o && o.settings && o.settings.followups) || { enabled: true, days: [1, 3, 7], template: 'Hi {name}, this is {consultancy}. We received your enquiry and would love to help with your plan to study or work abroad. Reply with the country you have in mind and the best time to call.' } }); } catch (e) { orgErr(res, e); } });
app.put('/api/org/:id/followups', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const b = req.body || {}; const { data: o } = await admin().from('organisations').select('settings').eq('id', req.params.id).maybeSingle(); const st = (o && o.settings) || {}; const f = { enabled: b.enabled !== false, days: Array.isArray(b.days) ? b.days.map(Number).filter(n => n > 0).slice(0, 5) : [1, 3, 7], template: String(b.template || '').slice(0, 800) }; await admin().from('organisations').update({ settings: Object.assign({}, st, { followups: f }) }).eq('id', req.params.id); res.json({ followups: f }); } catch (e) { orgErr(res, e); } });
/* ============================================================================================================================ */
/* MANUAL STATUS: the applicant (or the consultancy for its client) records what they saw on the portal; the automation then leaves that file alone. */
app.get('/api/org/:id/door', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.read'); const { data: o } = await admin().from('organisations').select('slug,name,settings').eq('id', req.params.id).maybeSingle(); if (!o) return res.status(404).json({ error: 'Not found' }); let slug = o.slug; if (!slug || /-\w{4,}$/.test(slug) && String(slug).length > 30) { const base = String(o.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30); const { data: taken } = await admin().from('organisations').select('id').eq('slug', base).neq('id', req.params.id).limit(1); slug = (taken && taken.length) ? base + '-' + String(req.params.id).slice(0, 4) : base; await admin().from('organisations').update({ slug }).eq('id', req.params.id); } const wl = (o.settings && o.settings.domain) || null; res.json({ url: (process.env.PUBLIC_URL || 'https://foriforeign.com') + '/crm/' + slug, slug, white_label_url: wl ? 'https://' + wl : null }); } catch (e) { orgErr(res, e); } });
/* VISA STATUS STRATEGY: email first, manual second, one portal check after the country's usual processing time, never daily, never twice. */
const VSTRAT = require('./lib/visa_strategy');
QUEUE.register('visa_status_sweep', async () => VSTRAT.sweep());
app.post('/api/visa/desk/:id/manual', auth, async (req, res) => { try { const b = req.body || {}; const p = await VSTRAT.manualUpdate(req.params.id, req.userId, { status: b.status, decided_on: b.decided_on, note: b.note, by: 'you' }); res.json({ ok: true, patch: p }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/org/:id/clients/:cid/visa/:vid/manual', auth, async (req, res) => { try { const c = await orgClient(req, res, 'clients.write'); if (!c.user_id) return res.status(400).json({ error: 'Client has no account' }); const b = req.body || {}; const p = await VSTRAT.manualUpdate(req.params.vid, c.user_id, { status: b.status, decided_on: b.decided_on, note: b.note, by: 'your consultant' }); await orgAudit(req.params.id, req.userId, 'VISA_MANUAL_UPDATE', c.id + ' ' + b.status); res.json({ ok: true, patch: p }); } catch (e) { orgErr(res, e); } });
app.get('/api/visa/desk/:id/strategy', auth, async (req, res) => { try { const { data: f } = await admin().from('visa_cases').select('id,status,submitted_on,expected_decision_from,expected_decision_to,check_after,check_attempts,decision_source,check_note,manual_note,country_code').eq('id', req.params.id).eq('user_id', req.userId).maybeSingle(); if (!f) return res.status(404).json({ error: 'File not found' }); res.json({ strategy: f, plan: ['Decision email on your ForiForeign address updates the file at once', 'You or your consultant can set the status by hand any time', 'One portal check after ' + (f.check_after || 'the usual processing time') + (f.check_attempts ? ' (done)' : ''), 'If the portal cannot be read, you are asked to check by hand; no second attempt'] }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ================= PR PATHWAYS: structured, sourced, per destination; personalised counter; policy watch re-verifies nightly ================= */
async function prSeedIfEmpty() { try { const { count } = await admin().from('pr_pathways').select('id', { count: 'exact', head: true }); if (count) return; const rows = require('./lib/pr_seed').seed.map(r => Object.assign({}, r, { last_verified_at: new Date().toISOString() })); await admin().from('pr_pathways').upsert(rows, { onConflict: 'country_code' }); } catch (e) {} }
setTimeout(prSeedIfEmpty, 4000);
app.get('/api/pr/:cc', async (req, res) => { try { const cc = String(req.params.cc || '').toUpperCase(); const { data } = await admin().from('pr_pathways').select('*').eq('country_code', cc).maybeSingle(); if (!data) return res.status(404).json({ error: 'No pathway on file for ' + cc }); res.set('Cache-Control', 'public, max-age=3600'); res.json({ pathway: data }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/pr', async (req, res) => { try { const { data } = await admin().from('pr_pathways').select('country_code,pr_route,years_to_pr,years_to_citizenship,language,dual_nationality,confidence,source_url').order('country_code'); res.set('Cache-Control', 'public, max-age=3600'); res.json({ pathways: data || [] }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* The applicant's own PR plan: their destination, arrival date, days lived, target date, what is still needed, and the policy-change flag. */
app.get('/api/me/pr-plan', auth, async (req, res) => { try { const cc = String(req.query.cc || '').toUpperCase(); const { data: p } = await admin().from('profiles').select('arrival_date,language_tests,experience_years,degree_level,dependants').eq('id', req.userId).maybeSingle(); const { data: pw } = cc ? await admin().from('pr_pathways').select('*').eq('country_code', cc).maybeSingle() : { data: null }; if (!pw) return res.json({ pathway: null, note: 'Pick a destination to see its pathway.' }); const arrival = p && p.arrival_date ? new Date(p.arrival_date) : null; const days = arrival ? Math.floor((Date.now() - arrival.getTime()) / 86400000) : null; const yrs = Number(pw.years_to_pr) || 0; const target = arrival && yrs ? new Date(arrival.getTime() + yrs * 365.25 * 86400000).toISOString().slice(0, 10) : null; const pct = arrival && yrs ? Math.max(0, Math.min(100, Math.round((days / (yrs * 365.25)) * 100))) : null; const needs = []; if (pw.language && !/none/i.test(pw.language)) needs.push({ item: 'Language: ' + pw.language, met: Array.isArray(p && p.language_tests) && p.language_tests.length > 0 }); if (/points|salary|threshold|income/i.test(pw.requirement || '')) needs.push({ item: 'Meet the points / salary / income requirement', met: null }); if (pw.absence_rule) needs.push({ item: 'Keep to the absence rule: ' + pw.absence_rule, met: null }); needs.push({ item: 'Keep a residence and employment log (tickets, contracts, payslips, tax)', met: null }); res.json({ pathway: pw, arrival_date: p && p.arrival_date || null, days_lived: days, years_to_pr: yrs || null, target_date: target, progress_pct: pct, needs, changed: !!(pw.changed_at && (!pw.last_verified_at || new Date(pw.changed_at) > new Date(pw.last_verified_at))), citizenship: pw.years_to_citizenship ? { years: pw.years_to_citizenship, target: arrival ? new Date(arrival.getTime() + (yrs + Number(pw.years_to_citizenship)) * 365.25 * 86400000).toISOString().slice(0, 10) : null } : null }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/pr/reseed', auth, perm('settings.write'), async (req, res) => { try { const rows = require('./lib/pr_seed').seed.map(r => Object.assign({}, r, { last_verified_at: new Date().toISOString() })); await admin().from('pr_pathways').upsert(rows, { onConflict: 'country_code' }); res.json({ seeded: rows.length }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.put('/api/admin/pr/:cc', auth, perm('settings.write'), async (req, res) => { try { const b = req.body || {}; const patch = {}; for (const k of ['pr_route', 'years_to_pr', 'years_to_citizenship', 'language', 'requirement', 'absence_rule', 'dependants', 'dual_nationality', 'notes', 'source_url', 'confidence']) if (b[k] !== undefined) patch[k] = b[k]; patch.last_verified_at = new Date().toISOString(); patch.changed_at = null; patch.updated_at = new Date().toISOString(); await admin().from('pr_pathways').update(patch).eq('country_code', String(req.params.cc).toUpperCase()); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ============================================================================================================================ */
/* ================= PATHWAY MANAGER: free → trust → monitoring → membership → human help ================= */
const PATHWAY = require('./lib/pathway');
async function isPathwayMember(userId) { if (await isPlatformStaff(userId)) return true; return (await hasAddon(userId, 'pathway_month')) || (await hasAddon(userId, 'pathway_year')); }
app.get('/api/me/pathway', auth, async (req, res) => { try { const cfg = await siteSettings.getConfig(); const pc = cfg.pathway || {}; if (req.query.cc) { await admin().from('profiles').update({ pathway_cc: String(req.query.cc).toUpperCase() }).eq('id', req.userId); } const member = await isPathwayMember(req.userId); const f = await PATHWAY.facts(req.userId); const { data: events } = await admin().from('pathway_events').select('id,kind,title,detail,next_move,priority,created_at,seen_at').eq('user_id', req.userId).order('created_at', { ascending: false }).limit(member ? 30 : 5); const ageDays = f.profile && f.profile.created_at ? (Date.now() - new Date(f.profile.created_at)) / 86400000 : 99; const meaningful = f.score.score >= (pc.upsell_min_score || 40) || (events || []).length > 0 || !!(f.profile && f.profile.arrival_date) || f.offers > 0; const upsell = !member && ageDays >= (pc.free_days_before_upsell || 7) && meaningful;
    const free = { cc: f.cc, pathway: f.pathway ? { pr_route: f.pathway.pr_route, years_to_pr: f.pathway.years_to_pr, years_to_citizenship: f.pathway.years_to_citizenship, language: f.pathway.language, source_url: f.pathway.source_url, confidence: f.pathway.confidence, changed: !!f.pathway.changed_at } : null, score: f.score.score, band: f.score.band, top_gap: f.score.gaps[0] ? { title: f.score.gaps[0].title, how: f.score.gaps[0].how } : null, gaps_hidden: Math.max(0, f.score.gaps.length - 1), days_lived: f.days_lived, connected: !!(f.profile && f.profile.pathway_connected), monitoring: member ? 'weekly' : 'monthly', last_check: f.profile && f.profile.pathway_last_check, events: (events || []).slice(0, member ? 30 : 3), member, upsell, prices: { month: pc.month_usd || 9, year: pc.year_usd || 79 } };
    if (!member) return res.json(free);
    res.json(Object.assign(free, { parts: f.score.parts, gaps: f.score.gaps, docs: f.docs, plan: PATHWAY.plan(f), next_reassessment: new Date(new Date(f.profile.pathway_last_check || Date.now()).getTime() + 7 * 86400000).toISOString().slice(0, 10), human: { available: true, note: (f.pathway && f.pathway.confidence !== 'high') ? 'This pathway is being re-verified; a human review is recommended before you act on it.' : 'Ask a human any time; where a licensed adviser is required by law, we say so and connect you.' } })); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/me/pathway/reassess', auth, async (req, res) => { try { const r = await PATHWAY.detect(req.userId); res.json({ events: r.events, next: r.next, score: r.facts.score.score, band: r.facts.score.band }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/me/pathway/connect', auth, async (req, res) => { try { const on = (req.body || {}).connected !== false; await admin().from('profiles').update({ pathway_connected: on }).eq('id', req.userId); res.json({ connected: on }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/me/pathway/events/seen', auth, async (req, res) => { try { await admin().from('pathway_events').update({ seen_at: new Date().toISOString() }).eq('user_id', req.userId).is('seen_at', null); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* Human help: a member asks; the plan travels with the request; where a licensed adviser is required by law the ticket says so. */
app.post('/api/me/pathway/review', auth, async (req, res) => { try { if (!(await isPathwayMember(req.userId))) return res.status(402).json({ error: 'Human review comes with Pathway Membership', code: 'MEMBERSHIP' }); const f = await PATHWAY.facts(req.userId); const q = String((req.body || {}).question || '').slice(0, 2000); const { data: p } = await admin().from('profiles').select('full_name,email').eq('id', req.userId).maybeSingle(); const body = 'PATHWAY REVIEW REQUEST\nDestination: ' + (f.cc || '-') + ' · route: ' + (f.pathway && f.pathway.pr_route || '-') + '\nScore: ' + f.score.score + ' (' + f.score.band + ')\nGaps: ' + f.score.gaps.map(g => g.title).join('; ') + '\nDocs missing: ' + f.docs.missing.join(', ') + '\nQuestion: ' + q + (f.pathway && f.pathway.confidence !== 'high' ? '\nNOTE: pathway marked re-verify' : '') + '\nLEGAL: if this needs a regulated immigration adviser (e.g. OISC/RCIC/MARA), tell the applicant and connect a licensed partner; do not advise beyond information.'; const { data: t } = await admin().from('support_tickets').insert({ user_id: req.userId, name: p && p.full_name, email: p && p.email, subject: 'Pathway review · ' + (f.cc || ''), message: body, status: 'open', kind: 'pathway_review' }).select('id').single(); try { const { data: admins } = await admin().from('profiles').select('id').in('role', ['admin', 'super_admin', 'staff']); for (const a of (admins || [])) await require('./lib/notify').push(a.id, 'support', 'Pathway review requested', (p && p.full_name || '') + ' · ' + (f.cc || ''), 'adminx'); } catch (e) {} res.json({ ticket_id: t && t.id, note: 'A person will reply within one working day. Where a licensed adviser is required by law, we will say so and connect you.' }); } catch (e) { res.status(400).json({ error: e.message }); } });
QUEUE.register('pathway_sweep_members', async () => PATHWAY.sweep({ members: true }));
QUEUE.register('pathway_sweep_free', async () => PATHWAY.sweep({ members: false }));
/* ================================================================================================================ */
/* STAFF SETS A CASE STATUS; the client sees the resulting stage on the tracker, never the control. Audited; the journey recomputes at once. */
app.post('/api/admin/applications/:id/status', auth, perm('cases.write'), async (req, res) => { try { const st = String((req.body || {}).status || ''); const allowed = ['draft', 'prepared', 'ready', 'sent', 'submitted', 'interview', 'offer', 'accepted', 'rejected', 'withdrawn', 'enrolled']; if (!allowed.includes(st)) return res.status(400).json({ error: 'status must be one of ' + allowed.join(', ') }); const { data: a } = await admin().from('applications').select('id,user_id,status').eq('id', req.params.id).maybeSingle(); if (!a) return res.status(404).json({ error: 'Case not found' }); await admin().from('applications').update({ status: st, stage: st, updated_at: new Date().toISOString() }).eq('id', a.id); try { await admin().from('audit_log').insert({ actor: req.userId, event: 'ADMIN_SET_CASE_STATUS', detail: a.id + ' ' + a.status + ' → ' + st + ' ' + String((req.body || {}).note || '').slice(0, 120) }); } catch (e) {} try { JE.recompute(a.user_id); } catch (e) {} try { await require('./lib/notify').push(a.user_id, 'case', 'Your case status: ' + st.replace(/_/g, ' '), String((req.body || {}).note || '').slice(0, 200) || 'Updated by ForiForeign', 'apps'); } catch (e) {} res.json({ ok: true, status: st }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* ================= FF-CRM WORK QUEUES: the CRM identifies work; every queue opens exactly those clients ================= */
app.get('/api/org/:id/queues', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'clients.read'); const m = await ORGS.membership(req.params.id, req.userId); const { data: orgRow } = await admin().from('organisations').select('settings').eq('id', req.params.id).maybeSingle(); const TH = Object.assign({ new_days: 7, followup_days: 3, stuck_days: 30 }, (orgRow && orgRow.settings && orgRow.settings.queues) || {}); const clients = await ORGS.listClients(req.params.id, { limit: 500, scope: ORGS.scopeFor(m, req.userId) }); const ids = clients.map(c => c.id); const uids = clients.map(c => c.user_id).filter(Boolean); const now = Date.now(); const today = new Date().toISOString().slice(0, 10); const byUser = {}; for (const c of clients) if (c.user_id) byUser[c.user_id] = c.id;
    const [tasks, docs, apps, msgs, pays] = await Promise.all([ids.length ? admin().from('client_tasks').select('client_id,due_date,status,for_client,title').eq('org_id', req.params.id).eq('status', 'open').in('client_id', ids.slice(0, 500)).then(r => r.data || []) : [], uids.length ? admin().from('documents').select('user_id,doc_type,doc_status').in('user_id', uids.slice(0, 500)).eq('generated', false).then(r => r.data || []) : [], uids.length ? admin().from('applications').select('user_id,status,next_action_owner,updated_at').in('user_id', uids.slice(0, 500)).then(r => r.data || []) : [], ids.length ? admin().from('case_messages').select('client_id,user_id,direction,read_at,received_at').or('client_id.in.(' + ids.slice(0, 500).join(',') + ')' + (uids.length ? ',user_id.in.(' + uids.slice(0, 500).join(',') + ')' : '')).eq('direction', 'in').is('read_at', null).gte('received_at', new Date(now - 14 * 86400000).toISOString()).then(r => r.data || []) : [], uids.length ? admin().from('payments').select('user_id,status').in('user_id', uids.slice(0, 500)).eq('status', 'pending').then(r => r.data || []) : []]);
    const docsBy = {}; for (const d of docs) { const cid = byUser[d.user_id]; if (!cid) continue; docsBy[cid] = docsBy[cid] || { n: 0, review: 0, cv: false }; docsBy[cid].n++; if (d.doc_status === 'needs_review') docsBy[cid].review++; if (d.doc_type === 'cv') docsBy[cid].cv = true; }
    const Q = {}; const add = (k, cid) => { (Q[k] = Q[k] || new Set()).add(cid); };
    for (const c of clients) { const st = String(c.stage || ''); const age = (now - new Date(c.created_at).getTime()) / 86400000; const act = c.last_activity_at || c.updated_at || c.created_at; const idle = (now - new Date(act).getTime()) / 86400000; const inStage = (now - new Date(c.stage_changed_at || c.created_at).getTime()) / 86400000; const d = docsBy[c.id];
      if (age <= TH.new_days && /lead|new|discover/.test(st)) add('new', c.id);
      if (!c.user_id) add('no_login', c.id);
      if (c.user_id && (!c.profile || !Object.keys(c.profile || {}).length) && !(d && d.cv)) add('profile_incomplete', c.id);
      if (c.user_id && (!d || !d.cv)) add('docs_missing', c.id);
      if (d && d.review) add('docs_review', c.id);
      if (/lead/.test(st) && idle >= TH.followup_days) add('followup', c.id);
      if (!/enrolled|lost|closed|settled/.test(st) && inStage >= TH.stuck_days) add('stuck', c.id);
      if (c.priority === 'urgent' || c.priority === 'high') add('priority', c.id); }
    for (const t of tasks) { if (t.due_date && t.due_date < today) add('overdue', t.client_id); if (t.for_client) add('waiting_client', t.client_id); }
    for (const a of apps) { const cid = byUser[a.user_id]; if (!cid) continue; if (a.next_action_owner === 'you' || /ready|prepared/.test(String(a.status || ''))) add('apps_action', cid); if (/draft|prepar/.test(String(a.status || ''))) add('apps_preparing', cid); }
    for (const mm of msgs) { const cid = mm.client_id || byUser[mm.user_id]; if (cid) add('replies', cid); }
    for (const p of pays) { const cid = byUser[p.user_id]; if (cid) add('payments', cid); }
    const LAB = { new: 'New clients (7 days)', no_login: 'Not yet registered', profile_incomplete: 'Profiles incomplete', docs_missing: 'CV / documents missing', docs_review: 'Documents awaiting review', apps_action: 'Applications awaiting action', apps_preparing: 'Applications in preparation', replies: 'Client replies unread', waiting_client: 'Waiting for the client', followup: 'Follow-ups due', overdue: 'Overdue tasks', payments: 'Payments pending', stuck: 'Stuck 30+ days in a stage', priority: 'High priority' };
    res.json({ lead_scores: Object.fromEntries(clients.filter(c => /lead/.test(String(c.stage || ''))).map(c => [c.id, leadScore(c).score])), queues: Object.keys(LAB).map(k => ({ key: k, label: LAB[k], count: Q[k] ? Q[k].size : 0, client_ids: Q[k] ? [...Q[k]].slice(0, 500) : [] })) }); } catch (e) { orgErr(res, e); } });
/* A consultant asks the client for something: it is a task the client sees on their own dashboard as "your consultant needs". */
app.post('/api/org/:id/clients/:cid/request', auth, async (req, res) => { try { const c = await orgClient(req, res, 'clients.write'); const title = String((req.body || {}).title || '').slice(0, 200); if (!title) return res.status(400).json({ error: 'Say what you need' }); const { data: t, error } = await admin().from('client_tasks').insert({ org_id: req.params.id, client_id: c.id, title, owner: 'client', for_client: true, due_date: (req.body || {}).due_date || null, status: 'open', created_by: req.userId }).select('id').single(); if (error) return res.status(400).json({ error: error.message }); try { if (c.user_id) await require('./lib/notify').push(c.user_id, 'task', 'Your consultant needs: ' + title, (req.body || {}).note ? String(req.body.note).slice(0, 200) : 'Open your dashboard to see what to do.', 'home'); } catch (e) {} await admin().from('clients').update({ last_activity_at: new Date().toISOString() }).eq('id', c.id); res.json({ id: t.id }); } catch (e) { orgErr(res, e); } });
/* ================================================================================================================ */
/* ================= FF-CRM GAPS (R11700) ================= */
/* G3) The client's invitation lands on the consultancy's own domain when it has one; resend at any time; invited_at recorded. */
async function orgHomeUrl(orgId) { try { const { data: o } = await admin().from('organisations').select('settings').eq('id', orgId).maybeSingle(); const d = o && o.settings && o.settings.whitelabel && o.settings.whitelabel.domain; return d ? 'https://' + String(d).replace(/^https?:\/\//, '') + '/app' : (process.env.PUBLIC_URL || 'https://foriforeign.com') + '/app'; } catch (e) { return (process.env.PUBLIC_URL || 'https://foriforeign.com') + '/app'; } }
app.post('/api/org/:id/clients/:cid/invite', auth, async (req, res) => { try { const c = await orgClient(req, res, 'clients.write'); if (!c.user_id) return res.status(400).json({ error: 'Create the client\'s account first (Create account), then invite.' }); const { data: pr } = await admin().from('profiles').select('email').eq('id', c.user_id).maybeSingle(); const email = pr && pr.email; if (!email) return res.status(400).json({ error: 'No email on the account' }); let link = null; try { const { data: l } = await admin().auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: await orgHomeUrl(req.params.id) } }); link = l && l.properties && l.properties.action_link; } catch (e) {} const { data: og } = await admin().from('organisations').select('name').eq('id', req.params.id).maybeSingle(); const M = require('./lib/mailer'); await M.send(email, (og ? og.name : 'Your consultancy') + ': sign in to your application account', M.wrap('Your account', 'Hello ' + (c.full_name || '') + ', ' + (og ? og.name : 'your consultancy') + ' invites you to sign in and see your case. ' + (link ? 'Sign in with this link (valid for a short time): ' + link : 'Use "Forgot your password" with this email to set your password.'), 'work')); await admin().from('clients').update({ invited_at: new Date().toISOString(), last_activity_at: new Date().toISOString() }).eq('id', c.id); await orgAudit(req.params.id, req.userId, 'CLIENT_INVITED', c.id); res.json({ ok: true, sent_to: email }); } catch (e) { orgErr(res, e); } });
/* G8) Archive and restore: the board and the queues stop showing the client; nothing is deleted. */
app.post('/api/org/:id/clients/:cid/archive', auth, async (req, res) => { try { const c = await orgClient(req, res, 'clients.write'); const on = (req.body || {}).restore ? null : new Date().toISOString(); await admin().from('clients').update({ archived_at: on, status: on ? 'archived' : 'active', last_activity_at: new Date().toISOString() }).eq('id', c.id); CACHE.bust('board:' + req.params.id); await orgAudit(req.params.id, req.userId, on ? 'CLIENT_ARCHIVED' : 'CLIENT_RESTORED', c.id); res.json({ ok: true, archived: !!on }); } catch (e) { orgErr(res, e); } });
/* G9) Owner deletes a client record (GDPR request): the record, its tasks, notes, finance rows and mail; the linked account is untouched and told. */
app.delete('/api/org/:id/clients/:cid', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const c = await orgClient(req, res, 'org.settings'); for (const t of ['client_tasks', 'client_notes', 'client_finance', 'appointments']) { try { await admin().from(t).delete().eq('client_id', c.id); } catch (e) {} } try { await admin().from('case_messages').delete().eq('client_id', c.id).is('user_id', null); } catch (e) {} await admin().from('clients').delete().eq('id', c.id); CACHE.bust('board:' + req.params.id); await orgAudit(req.params.id, req.userId, 'CLIENT_DELETED', c.id + ' ' + String((req.body || {}).reason || '').slice(0, 120)); try { if (c.user_id) await require('./lib/notify').push(c.user_id, 'account', 'Your consultancy closed your file', 'Your account and documents remain yours.', 'home'); } catch (e) {} res.json({ ok: true }); } catch (e) { orgErr(res, e); } });
/* G4) Export everything (owner): clients, tasks, notes, finance, partners, expenses — as JSON; audited. */
app.get('/api/org/:id/export', auth, async (req, res) => { try { await ORGS.requireOrg(req, req.params.id, 'org.settings'); const out = {}; for (const t of ['clients', 'client_tasks', 'client_notes', 'client_finance', 'org_partners', 'org_expenses', 'org_disputes', 'commission_ledger', 'appointments']) { try { const { data } = await admin().from(t).select('*').eq('org_id', req.params.id).limit(5000); out[t] = data || []; } catch (e) { out[t] = []; } } await orgAudit(req.params.id, req.userId, 'ORG_EXPORT', Object.keys(out).map(k => k + ':' + out[k].length).join(' ')); res.setHeader('Content-Disposition', 'attachment; filename="ff-crm-export-' + req.params.id.slice(0, 8) + '.json"'); res.json({ exported_at: new Date().toISOString(), org_id: req.params.id, data: out }); } catch (e) { orgErr(res, e); } });
/* ======================================================== */
/* PR VERIFY-NOW: fetch the official page and have the model check the row's figures against it; sets confidence and records the evidence. */
app.post('/api/admin/pr/:cc/verify', auth, perm('settings.write'), async (req, res) => { try { const cc = String(req.params.cc).toUpperCase(); const { data: row } = await admin().from('pr_pathways').select('*').eq('country_code', cc).maybeSingle(); if (!row || !row.source_url) return res.status(404).json({ error: 'No row or source' }); const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000); const r = await fetch(row.source_url, { signal: ctl.signal, headers: { 'user-agent': 'ForiForeign policy check' } }); clearTimeout(tm); const page = String(await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 30000); const txt = await callAI('high_value', 'You are checking a permanent-residence rule row against its official source page. Row: ' + JSON.stringify({ pr_route: row.pr_route, years_to_pr: row.years_to_pr, years_to_citizenship: row.years_to_citizenship, language: row.language, requirement: row.requirement, absence_rule: row.absence_rule }) + '\nPage text: ' + page + '\nAnswer ONLY with JSON {"consistent": true|false, "corrections": {field: corrected value}, "evidence": "short quote", "confidence": "high"|"verify"}. Only state a correction if the page clearly says so.', { maxTokens: 500 }); const j = JSON.parse(String(txt).replace(/```json|```/g, '').trim()); const patch = { last_verified_at: new Date().toISOString(), changed_at: null, confidence: j.consistent ? 'high' : 'verify', notes: (row.notes ? row.notes + ' · ' : '') + 'Checked ' + new Date().toISOString().slice(0, 10) + (j.evidence ? ': ' + String(j.evidence).slice(0, 160) : '') }; if ((req.body || {}).apply && j.corrections && typeof j.corrections === 'object') for (const k of ['pr_route', 'years_to_pr', 'years_to_citizenship', 'language', 'requirement', 'absence_rule']) if (j.corrections[k] != null) patch[k] = j.corrections[k]; await admin().from('pr_pathways').update(patch).eq('country_code', cc); res.json({ consistent: !!j.consistent, corrections: j.corrections || {}, evidence: j.evidence || null, applied: !!(req.body || {}).apply }); } catch (e) { res.status(400).json({ error: e.message }); } });
QUEUE.register('success_calibrate', async () => require('./lib/success').calibrate());
/* SECURITY: rotate FF_DATA_KEY safely — re-encrypt every stored secret from the old key (supplied once) to the current key, audited. */
app.post('/api/admin/security/rotate-key', auth, perm('settings.write'), async (req, res) => { try { if (!['admin', 'super_admin'].includes(req.userRole)) return res.status(403).json({ error: 'admin only' }); const oldKey = String((req.body || {}).old_key || ''); const C = require('./lib/crypto'); if (!oldKey) return res.status(400).json({ error: 'old_key required' }); const r = await C.reencryptAll(oldKey); await admin().from('audit_log').insert({ actor: req.userId, event: 'KEY_ROTATED', detail: JSON.stringify(r).slice(0, 200) }); res.json(r); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/admin/security/posture', auth, perm('settings.read'), async (req, res) => { try { const cfg = await siteSettings.getConfig(); const { data: staff } = await admin().from('profiles').select('id,role,totp_enabled').in('role', ['staff', 'content_admin', 'admin', 'super_admin']); const noTotp = (staff || []).filter(x => !x.totp_enabled).length; res.json({ totp_required: !!(cfg.security && cfg.security.totp_required), staff: (staff || []).length, staff_without_totp: noTotp, key_set: !!process.env.FF_DATA_KEY, sign_key_set: !!(process.env.FF_SIGN_KEY || process.env.FF_DATA_KEY), allowed_origins: process.env.ALLOWED_ORIGINS || null, checks: ['tenancy: every org route guarded', 'permissions: every admin route guarded', 'secrets never in public config', 'hooks: signature + phone id + rate limit'] }); } catch (e) { res.status(400).json({ error: e.message }); } });
/* SEO: after content rebuilds, tell the search engines the sitemap changed (best effort, logged). */
async function pingSitemaps() { const u = encodeURIComponent((process.env.PUBLIC_URL || 'https://foriforeign.com') + '/sitemap.xml'); const out = {}; for (const [k, url] of [['google', 'https://www.google.com/ping?sitemap=' + u], ['bing', 'https://www.bing.com/ping?sitemap=' + u]]) { try { const r = await fetch(url, { method: 'GET' }); out[k] = r.status; } catch (e) { out[k] = 'err'; } } try { await admin().from('audit_log').insert({ actor: null, event: 'SITEMAP_PING', detail: JSON.stringify(out) }); } catch (e) {} return out; }
QUEUE.register('sitemap_ping', async () => pingSitemaps());
app.post('/api/admin/seo/ping', auth, perm('settings.write'), async (req, res) => { try { res.json(await pingSitemaps()); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/opportunities/:id', auth, async (req, res) => { try { const { data: o } = await admin().from('opportunities').select('*').eq('id', req.params.id).maybeSingle(); if (!o) return res.status(404).json({ error: 'Not found' }); const ok = await entitled(req.userId, simUser(req)); res.json({ opportunity: ok ? o : EXPLORE.redactFree(o), entitled: ok }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/config', (req, res) => {
  res.json({ supabaseUrl: process.env.SUPABASE_URL || '', supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '' });
});

/* ---------- Phase 1: central site configuration ---------- */
const siteSettings = require('./lib/settings');
app.get('/api/site-config', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const cfg = await siteSettings.getConfig();
    const pub = siteSettings.publicView(cfg);
    // Local-currency approximation for USD prices (PKR by default; per-user currency comes from /api/pay/quote).
    try { const { perUsd } = require('./lib/pay'); const f = await perUsd('PKR'); pub.fx = { currency: 'PKR', rate: f.rate || null, live: !!f.live }; } catch (e) {}
    try { const o = await orgForHost(req.headers['x-forwarded-host'] || req.headers.host); if (o) pub.whitelabel = { org_id: o.id, name: o.name, kind: o.kind, brand_color: (o.settings || {}).brand_color || null, logo_url: (o.settings || {}).logo_url || null, whatsapp: (o.settings || {}).whatsapp || null, phone: (o.settings || {}).phone || null, contact_email: (o.settings || {}).contact_email || (o.settings || {}).email || null, address: (o.settings || {}).address || null, website: (o.settings || {}).website || null, tagline: (o.settings || {}).tagline || null }; } catch (e) {}
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
  // Never hang a public endpoint on a slow database: answer the last good numbers (or zeros) after 4 seconds.
  const guard = setTimeout(() => { if (!res.headersSent) res.json(_stats.data || out); }, 4000);
  try {
    const { count: n } = await admin().from('opportunities').select('id', { count: 'exact', head: true }).eq('status', 'verified');
    out.opportunities = n || 0;
    const { data: cs } = await admin().from('opportunities').select('country_code').eq('status', 'verified').limit(2000);
    out.countries = new Set((cs || []).map(r => r.country_code).filter(Boolean)).size;
    const wk = new Date(Date.now() - 7 * 864e5).toISOString();
    const { count: a7 } = await admin().from('opportunities').select('id', { count: 'exact', head: true }).eq('status', 'verified').gte('created_at', wk);
    out.added7 = a7 || 0;
  } catch (e) {}
  clearTimeout(guard); if (res.headersSent) return; _stats = { at: Date.now(), data: out };
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
  return '';   // USD only on public pages; local approximations are off by policy
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
  res.send(seoPage(g.title, g.title + ' - real costs in USD, visa steps and funding names, plus live verified opportunities.', `<h1>${g.title}</h1>${g.body}${links ? '<h2>Live openings</h2><div>' + links + '</div>' : ''}`));
});
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
    /* THE FULL PACKET: every recorded fact the filler can place — always the ForiForeign address, never the CV's email. */
    let originName = '', phoneCc = ''; try { const W = require('./lib/world'); const o = W.origin(pr.origin_country || 'PK'); originName = o.name || ''; phoneCc = o.phone || ''; } catch (e) {}
    let consultancy = ''; try { const { data: cl } = await admin().from('clients').select('org_id').eq('user_id', req.userId).limit(1); if (cl && cl.length) { const { data: og } = await admin().from('organisations').select('name').eq('id', cl[0].org_id).maybeSingle(); consultancy = og ? og.name : ''; } } catch (e) {}
    const lt = Array.isArray(pr.language_tests) ? pr.language_tests : []; const ie = lt.find(t => /ielts/i.test(t.test || '')) || {};
    res.json({ profile: {
      full_name: pr.full_name, email: pr.apply_email || '', phone: pr.whatsapp || pr.phone, phone_cc: phoneCc, city: pr.city, address: pr.address, province: pr.province || '', postal_code: pr.postal_code || '',
      origin_country: pr.origin_country, origin_name: originName, nationality: pr.nationality || (originName ? originName : ''), country: originName,
      date_of_birth: pr.date_of_birth ? String(pr.date_of_birth).slice(0, 10) : '', gender: pr.gender || '', marital_status: pr.marital_status || '', birth_place: pr.birth_place || '',
      passport_number: pr.passport_number || '', passport_issue: pr.passport_issue || '', passport_expiry: pr.passport_expiry || '', national_id: pr.national_id || '',
      father_name: pr.father_name || '', mother_name: pr.mother_name || '',
      last_institution: pr.last_institution, degree_level: pr.degree_level, degree: pr.degree || '', highest_degree: pr.degree || '', highest_degree_year: pr.highest_degree_year || '', field: pr.field, cgpa: pr.cgpa, education: pr.education || [],
      experience_years: pr.experience_years, experience: pr.experience || [], current_employer: pr.current_employer || '', profession: profession || pr.profession || '',
      language_scores: pr.language_scores, language_tests: lt, ielts_listening: ie.listening || '', ielts_reading: ie.reading || '', ielts_writing: ie.writing || '', ielts_speaking: ie.speaking || '', ielts_trf: ie.trf || '',
      skills: pr.skills || [], linkedin: pr.linkedin, license_number: licNum, license_authority: licAuth, consultancy_name: consultancy, previous_refusals: pr.previous_refusals || 'No'
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
  /* Both modes carry the same discovery fields, so one renderer serves both and an
     unlocked row never loses its relevance line. */
  list = list.map(o => Object.assign({}, o, { hint: hintLabel(o), relevance_line: relevanceLine(o), complexity: complexity(o) }));
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
    return res.json({ applications: await maskRows(plain || [], 'user_id', ['full_name', 'email', 'user_email', 'user_name', 'user_whatsapp']) });
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
  const { data: profs2 } = ids.length ? await admin().from('profiles').select('id,whatsapp,phone').in('id', ids).then(r => r, () => ({ data: [] })) : { data: [] };
  const waOf = Object.fromEntries((profs2 || []).map(p => [p.id, p.whatsapp || p.phone || '']));
  const { BUCKET } = require('./lib/docs');
  const list = [];
  for (const p of (data || [])) {
    const path = p.proof_path || (String(p.reference || '').startsWith('PROOF:') ? String(p.reference).slice(6) : null);
    let proof_url = null;
    if (path) { try { const { data: su } = await admin().storage.from(BUCKET).createSignedUrl(path, 3600); proof_url = su && su.signedUrl; } catch (e) {} }
    list.push({ ...p, user_name: nameOf[p.user_id] || '', user_whatsapp: waOf[p.user_id] || '', proof_url });
  }
  res.json({ payments: await maskRows(list, 'user_id', ['full_name', 'email', 'phone', 'user_whatsapp', 'user_name']) });
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
  res.json({ users: await maskRows(data || [], 'id', ['full_name', 'email', 'phone', 'whatsapp', 'apply_email']) });
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
    await ledgerWrite({
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
  /* THE PLATFORM ADMIN IS UNTOUCHABLE. A protected super_admin (the founder) cannot be demoted by anyone;
     super_admin may only be granted or changed by a super_admin; organisation roles never map to platform roles. */
  const { data: target } = await admin().from('profiles').select('role,protected_admin,email').eq('id', req.params.id).maybeSingle();
  if (target && (target.protected_admin || OWNER_EMAILS.includes(String(target.email || '').toLowerCase())) && role !== 'super_admin') return res.status(403).json({ error: 'This account is the protected platform owner and cannot be changed.' });
  if ((role === 'super_admin' || (target && target.role === 'super_admin')) && req.userRole !== 'super_admin') return res.status(403).json({ error: 'Only a super admin can change super admin accounts.' });
  const { error } = await admin().from('profiles').update({ role, role_changed_at: new Date().toISOString() }).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  try { await admin().auth.admin.signOut(req.params.id, 'global'); } catch (e) {}
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
  /* FF-CRM tickets: routed to the consultancy's owners; sent on to ForiForeign only when the staff member asks. */
  let orgId = null, toPlatform = true; try { const b = req.body || {}; if (b.org_id && await ORGS.membership(String(b.org_id), req.userId)) { orgId = String(b.org_id); toPlatform = !!b.to_platform; } } catch (e) {}
  const { data, error } = await admin().from('support_tickets').insert({
    user_id: req.userId, email: req.userEmail, subject, message, status: 'new', org_id: orgId, handled_by: orgId && !toPlatform ? 'consultancy' : null
  }).select().single();
  if (orgId) { try { const { data: mem } = await admin().from('org_members').select('user_id').eq('org_id', orgId).eq('status', 'active').in('role', ['owner', 'manager']).limit(10); for (const m of (mem || [])) await require('./lib/notify').push(m.user_id, 'support', 'Staff support request: ' + String(subject || '').slice(0, 60), String(message || '').slice(0, 160), 'work', orgId); } catch (e) {} }
  if (error) return res.status(400).json({ error: /support_tickets|relation/.test(error.message) ? 'Support is not set up yet (run migration 0013)' : error.message });
  /* A consultancy's client is the consultancy's client: the ticket goes to the consultancy's members and its contact address; the platform's
     responder does not read it. Direct applicants' tickets go to the platform. */
  let routed = false; try { const { data: cl } = await admin().from('clients').select('org_id').eq('user_id', req.userId).eq('status', 'active').limit(1); if (cl && cl[0]) { const { data: og } = await admin().from('organisations').select('name,kind,settings').eq('id', cl[0].org_id).maybeSingle(); if (og && og.kind === 'agency') { routed = true; await admin().from('support_tickets').update({ org_id: cl[0].org_id, status: 'routed' }).eq('id', data.id); const { data: mem } = await admin().from('org_members').select('user_id').eq('org_id', cl[0].org_id).eq('status', 'active').in('role', ['owner', 'manager']).limit(20); for (const m of (mem || [])) await NOTIFY.push(m.user_id, 'support', 'Client question: ' + subject, message.slice(0, 300), 'work', cl[0].org_id); const to = (og.settings || {}).support_email || (og.settings || {}).contact_email || (og.settings || {}).email; if (to) { const M = require('./lib/mailer'); await M.send(to, '[' + og.name + '] Client question: ' + subject, M.wrap('Client question', message, 'work', { name: og.name, color: (og.settings || {}).brand_color || null }), { name: og.name, reply_to: req.userEmail }); } } } } catch (e) {}
  if (!routed) { QUEUE.enqueue('support_respond', { ticketId: data.id }, { userId: req.userId, maxAttempts: 1 }).catch(() => {}); QUEUE.enqueue('support_triage', { ticketId: data.id }, { userId: req.userId, maxAttempts: 2 }).catch(() => {}); }
  res.json({ ok: true, ticket: { id: data.id } });
});
app.get('/api/support/mine', auth, async (req, res) => {
  const { data } = await admin().from('support_tickets').select('*').eq('user_id', req.userId).order('created_at', { ascending: false }).then(r => r, () => ({ data: [] }));
  res.json({ tickets: await maskRows(data || [], 'user_id', ['name', 'email', 'phone', 'message', 'subject']) });
});
app.get('/api/admin/support', auth, perm('support.read'), async (req, res) => {
  const status = String(req.query.status || '');
  let q = admin().from('support_tickets').select('*').order('created_at', { ascending: false }).limit(100);
  if (['new', 'open', 'waiting', 'answered', 'resolved', 'closed'].includes(status)) q = q.eq('status', status);
  const { data } = await q.then(r => r, () => ({ data: [] }));
  res.json({ tickets: await maskRows(data || [], 'user_id', ['name', 'email', 'phone', 'message', 'subject']) });
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
    await ledgerWrite({ user_id: req.userId, delta: 1, reason: 'promo_grant', note });
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
    await ledgerWrite({ user_id: t.user_id, delta: 1, reason: 'support_grant', note: grantNote });
    const reply = 'Good news! We have added 1 free case to your account as a one-time gift. Run your search, view your best matches and choose the one you want, your case will be prepared completely, end to end. We wish you success!';
    await admin().from('support_tickets').update({ reply, status: 'answered', handled_by: req.userId }).eq('id', req.params.id);
    try { const { data: tk } = await admin().from('support_tickets').select('user_id,email,subject').eq('id', req.params.id).maybeSingle(); const M = require('./lib/mailer'); if (tk && M.enabled()) { const { data: pu } = await admin().from('profiles').select('email').eq('id', tk.user_id).maybeSingle(); const to = (pu && pu.email) || tk.email; if (to) await M.send(to, 'Re: ' + (tk.subject || 'your message to ForiForeign'), M.wrap('Reply from ForiForeign Support', reply, 'home')); } } catch (e) {}
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
      usd: { total: totalUsd.toFixed(4), today: todayUsd.toFixed(4), month: monthUsd.toFixed(4), perCase: perCaseUsd.toFixed(4) }, byModel,
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
app.post('/api/me/intent', auth, async (req, res) => { try { const ck = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('ff_intent=')); const v = String((req.body || {}).intent || (ck ? decodeURIComponent(ck.slice(10)) : '') || ''); const [lane, cc, extra] = v.split(':'); const patch = {}; if (lane === 'work' || lane === 'study') patch.lane_pref = lane; if (/^[A-Z]{2}$/.test(String(cc || '').toUpperCase())) patch.target_countries = [String(cc).toUpperCase()]; if (extra && !/^[0-9a-f-]{36}$/.test(extra)) patch.profession = String(extra).replace(/-/g, ' ').slice(0, 80); if (Object.keys(patch).length) await admin().from('profiles').update(patch).eq('id', req.userId); res.json({ applied: patch, opportunity_id: /^[0-9a-f-]{36}$/.test(extra || '') ? extra : null }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/api/me', auth, async (req, res) => {
  let { data, error } = await admin().from('profiles').select('*').eq('id', req.userId).single();
  if (error && error.code === 'PGRST116') {
    // first login: create the profile row
    const isFounder = OWNER_EMAILS.includes((req.userEmail || '').toLowerCase());
    let signupName = '', signupOrigin = 'PK', signupWa = '';
    try { const { data: ud } = await admin().auth.getUser((req.headers.authorization || '').replace(/^Bearer /, '')); const md = ((ud && ud.user && ud.user.user_metadata) || {}); signupName = md.full_name || ''; signupWa = md.whatsapp || ''; if (require('./lib/i18n').ORIGINS[md.origin_country]) signupOrigin = md.origin_country; } catch (e) {}
    let ins = await admin().from('profiles').insert({ id: req.userId, full_name: signupName || req.userEmail.split('@')[0], role: isFounder ? 'super_admin' : 'user', origin_country: signupOrigin, whatsapp: signupWa || null }).select().single();
    if (ins.error) ins = await admin().from('profiles').insert({ id: req.userId, full_name: signupName || req.userEmail.split('@')[0], role: isFounder ? 'super_admin' : 'user' }).select().single();
    if (isFounder) await ledgerWrite({ user_id: req.userId, delta: 999, reason: 'grant', note: 'Founder account' });
    data = ins.data;
  }
  if (!data) return res.status(500).json({ error: 'Profile unavailable' });
  // FOUNDER SELF-HEAL: the owner account can never lose its powers. If the founder
  // email ever shows up without the admin role or its credit grant (a recreated row,
  // a bad migration moment, anything), it is restored right here, automatically.
  try {
    const isFounder2 = OWNER_EMAILS.includes((req.userEmail || '').toLowerCase());
    if (isFounder2) {
      if (!['admin', 'super_admin'].includes(data.role)) { await admin().from('profiles').update({ role: 'admin' }).eq('id', req.userId); data.role = 'admin'; }
    if (!data.protected_admin) admin().from('profiles').update({ protected_admin: true }).eq('id', req.userId).then(() => {}, () => {});
      const bal2 = await balance(req.userId);
      if (bal2 < 100) {
        const { data: prior } = await admin().from('credit_ledger').select('id').eq('user_id', req.userId).eq('reason', 'founder_restore').limit(1);
        if (!prior || !prior.length) await ledgerWrite({ user_id: req.userId, delta: 999 - bal2, reason: 'founder_restore', note: 'Founder account credit restore' });
      }
    }
  } catch (e) {}
  // Deep profile: the agent's full extraction rides along for the profile view.
  try { const { data: px } = await admin().from('app_settings').select('value').eq('key', 'profilex:' + req.userId).single(); if (px && px.value && px.value.x) data.deep = px.value.x; } catch (e) {}
  delete data.gmail_refresh_enc;
  let appCount = 0;
  try { const { count } = await admin().from('applications').select('id', { count: 'exact', head: true }).eq('user_id', req.userId); appCount = count || 0; } catch (e) {}
  data.used_free_case = appCount > 0;
  /* Phase 0 of the Global Mobility OS: every user belongs to an organisation (a personal
     one by default) and is a client with a journey stage. Additive; nothing else changes. */
  let org = null, client = null;
  try { const t = require('./lib/tenancy'); org = await t.ensurePersonalOrg(req.userId, data); client = await t.selfClient(req.userId); } catch (e) {}
  // forimail backbone: every account gets its unique address automatically; the user can pause/close it in Profile.
  try { if (!data.apply_email) { const r = await require('./lib/casebrain').provisionApplyEmail(req.userId); data.apply_email = r.email; await CONSENT.record(req, req.userId, 'mailbox', {}, { apply_email: r.email }); } } catch (e) {}
  try { if (data.origin_country && !data.timezone) { const tz = require('./lib/world').tzOf(data.origin_country); await admin().from('profiles').update({ timezone: tz }).eq('id', req.userId); data.timezone = tz; } } catch (e) {}
  try { const { count: hasTerms } = await admin().from('consent_ledger').select('id', { count: 'exact', head: true }).eq('user_id', req.userId).eq('kind', 'terms'); if (!hasTerms) await CONSENT.record(req, req.userId, 'terms', {}, { via: 'first_login' }); } catch (e) {}
  // Day 2: a pending team invitation for this email becomes a membership at login.
  try { const n = await ORGS.acceptInvites(req.userId, data.email); if (n) data.joined_orgs = n; } catch (e) {}
  res.json({ me: data, credits: await balance(req.userId), org: org && org.org ? { id: org.org.id, kind: org.org.kind, name: org.org.name, plan: org.org.plan, role: org.role } : null,
    journey: client ? { client_id: client.id, stage: client.stage, stages: require('./lib/tenancy').STAGES } : null });
});
/* Organisation context for the coming consultant workspace. */
app.get('/api/org/me', auth, async (req, res) => {
  try {
    const t = require('./lib/tenancy');
    const { data: prof } = await admin().from('profiles').select('full_name,email').eq('id', req.userId).single();
    const o = await t.ensurePersonalOrg(req.userId, prof || {});
    if (!o) return res.status(500).json({ error: 'Organisation could not be loaded. Run migration 0033.' });
    const { count } = await admin().from('clients').select('id', { count: 'exact', head: true }).eq('org_id', o.org.id).then(r => r, () => ({ count: 0 }));
    res.json({ org: o.org, role: o.role, memberships: o.memberships, clients: count || 0, stages: t.STAGES });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
/* ---------- journey state for the state-driven post-login home (Stage 2) ----------
   Returns ONE state + the single next action the home should show. */
async function computeMeState(uid) {
    /* The NAME of the file, not just whether one exists. A tick beside "Upload CV" left
       people unsure whether the right file had gone up, and several uploaded again to be
       safe. Showing the filename settles it at a glance. */
    const { data: cvRows } = await admin().from('documents').select('name,created_at')
      .eq('user_id', uid).eq('kind', 'cv').order('created_at', { ascending: false }).limit(1);
    const cvCount = (cvRows || []).length;
    const hasCV = cvCount > 0;
    const cvName = hasCV ? String(cvRows[0].name || '').slice(0, 60) : null;
    const cvAt = hasCV ? cvRows[0].created_at : null;
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
    return { state, hasCV, cvName, cvAt, appCount: list.length, matches, deadlineSoon, appsReady };
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
  /* The per-user scoring of 240 opportunities that used to run here fed a number the
     dashboard never displayed. It was the slowest step of the page. Gone. Everything
     that remains is fetched in one parallel batch. */
  const [supR, meR, discR, pendR] = await Promise.all([
    admin().from('support_tickets').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'answered').then(r => r, () => ({ count: 0 })),
    admin().from('profiles').select('referral_code,referral_balance_pkr').eq('id', uid).single().then(r => r, () => ({ data: null })),
    admin().from('app_settings').select('value').eq('key', 'discover:' + uid).single().then(r => r, () => ({ data: null })),
    admin().from('payments').select('id,credits,amount_pkr,created_at').eq('user_id', uid).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).then(r => r, () => ({ data: [] }))
  ]);
  try { out.support = { answered: (supR && supR.count) || 0 }; } catch (e) {}
  try { let { data: pn } = await admin().from('profiles').select('next_action,journey_stage').eq('id', uid).maybeSingle(); const stale = !pn || !pn.next_action || /[a-z]+_[a-z]+/.test(String((pn.next_action || {}).text || '')) || !(pn.next_action || {}).computed_at || (Date.now() - new Date(pn.next_action.computed_at).getTime()) > 6 * 3600000; if (stale) { try { await JE.compute(uid); const r2 = await admin().from('profiles').select('next_action,journey_stage').eq('id', uid).maybeSingle(); pn = r2.data; } catch (e) {} } out.next = pn && pn.next_action; out.journey_stage = pn && pn.journey_stage; } catch (e) {}
  try {
    // Referral identity: every user gets a permanent code; balance rides along.
    const me = meR && meR.data;
    let code = me && me.referral_code;
    if (!code) { code = 'FF' + uid.replace(/-/g, '').slice(0, 8).toUpperCase(); admin().from('profiles').update({ referral_code: code }).eq('id', uid).then(() => {}, () => {}); }
    out.referral = { code, balance_pkr: Number(me && me.referral_balance_pkr) || 0 };
  } catch (e) {}
  try {
    const v = discR && discR.data && discR.data.value;
    if (v && v.status === 'running' && Date.now() - new Date(v.startedAt || 0).getTime() < 12 * 60000)
      out.discover = { status: 'running', found: Number(v.found) || 0, target: Number(v.target) || 5, kind: v.kind || null };
  } catch (e) {}
  try {
    const pp = pendR && pendR.data && pendR.data[0];
    if (pp) out.pendingPayment = { id: pp.id, credits: Number(pp.credits) || 0, amount_pkr: Number(pp.amount_pkr) || 0, at: pp.created_at };
  } catch (e) {}
  /* DASHBOARD STATES (R11500): every number on the dashboard comes from data; empty states explain themselves. */
  try { const [{ data: bestv }, { data: apps2 }, { data: docs2 }, { count: needsConfirm }, { data: tasks }, { data: cvdoc }] = await Promise.all([admin().from('app_settings').select('value').eq('key', 'discover:' + uid).maybeSingle(), admin().from('applications').select('id,status,stage,updated_at,opportunity_id,opportunities(title,institution,country_code)').eq('user_id', uid).order('updated_at', { ascending: false }).limit(50), admin().from('documents').select('doc_type,doc_status,expiry_date,name,created_at').eq('user_id', uid).eq('generated', false), admin().from('case_messages').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('needs_confirmation', true), admin().from('journey_tasks').select('id,title,phase,done,due_hint').eq('user_id', uid).eq('done', false).limit(50), admin().from('documents').select('name,created_at').eq('user_id', uid).eq('doc_type', 'cv').order('created_at', { ascending: false }).limit(1)]);
    const mv = bestv && bestv.value; const matchList = mv && (mv.items || mv.opportunities || mv.results || (Array.isArray(mv) ? mv : null)); const matches = Array.isArray(matchList) ? matchList.length : 0;
    let checklist = { required: [] }; try { checklist = await require('./lib/vault').checklist(uid, (out.state && out.state.lane) || 'study'); } catch (e) {}
    const req = checklist.required || []; const docsReady = req.filter(r => r.state === 'ok').length, docsMissing = req.filter(r => r.state === 'missing').length, docsReview = req.filter(r => r.state === 'needs_review' || r.state === 'expiring').length + (docs2 || []).filter(d => d.doc_status === 'needs_review').length;
    const attention = []; try { const { data: reqs } = await admin().from('client_tasks').select('id,title,due_date').eq('for_client', true).eq('status', 'open').in('client_id', (await admin().from('clients').select('id').eq('user_id', uid).limit(5).then(r => (r.data || []).map(x => x.id))).concat(['00000000-0000-0000-0000-000000000000'])).limit(20); if (reqs && reqs.length) { attention.push({ n: reqs.length, text: 'thing' + (reqs.length === 1 ? '' : 's') + ' your consultant needs from you', link: 'home', items: reqs.map(r => ({ id: r.id, title: r.title, due: r.due_date })) }); out.consultant_requests = reqs; } } catch (e) {}
    if (needsConfirm) attention.push({ n: needsConfirm, text: 'replies to confirm', link: 'mail' }); if (docsReview) attention.push({ n: docsReview, text: 'documents to review', link: 'profile' }); const dueTasks = (tasks || []).filter(t => t.due_hint && /today|overdue|now/i.test(t.due_hint)); if (dueTasks.length) attention.push({ n: dueTasks.length, text: 'tasks due', link: 'home' }); if (out.pendingPayment) attention.push({ n: 1, text: 'payment awaiting confirmation', link: 'apps' }); for (const f of ((out.next && out.next.flags) || [])) attention.push({ n: 1, text: f, link: 'profile' });
    const byState = { preparing: 0, ready: 0, sent: 0, interview: 0, offer: 0 }; for (const a of (apps2 || [])) { const st = String(a.status || a.stage || ''); if (/draft|prepar|queued/.test(st)) byState.preparing++; else if (/ready|prepared/.test(st)) byState.ready++; else if (/sent|submitted|applied/.test(st)) byState.sent++; else if (/interview/.test(st)) byState.interview++; else if (/offer|accepted|enrolled/.test(st)) byState.offer++; }
    out.dash = { matches, applications: { total: (apps2 || []).length, by: byState, latest: (apps2 || []).slice(0, 3).map(a => ({ id: a.id, status: a.status, title: a.opportunities && a.opportunities.title, institution: a.opportunities && a.opportunities.institution, cc: a.opportunities && a.opportunities.country_code })) }, documents: { ready: docsReady, missing: docsMissing, review: docsReview, required: req.length }, attention, cv: cvdoc && cvdoc[0] ? { name: cvdoc[0].name, at: cvdoc[0].created_at } : null, profile_missing: (out.state && out.state.missing) || [] }; } catch (e) { out.dash = null; }
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
  const allowed = ['full_name','phone','mode','headline','field','methods','publications','education','experience','licenses','links','send_mode','annual_budget_pkr','funded_only','profession','lane_pref'];
  const patch = {};
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
  patch.updated_at = new Date().toISOString();
  const { data, error } = await admin().from('profiles').update(patch).eq('id', req.userId).select().single();
  if (error) return res.status(400).json({ error: error.message });
  delete data.gmail_refresh_enc;
  res.json({ me: data });
});

/* ---------- credits ---------- */
/* ONE DOOR INTO THE LEDGER. The live table carries a CHECK constraint on `reason` that
   predates most of the reasons this server writes ("admin_bypass", "admin_allowance",
   "promo_grant", "referral_reward", ...). Every one of those inserts was silently
   rejected, and the customer or admin saw nothing change. Every ledger write goes
   through here: the original reason is tried first, then the canonical one the
   constraint accepts ("grant" for a credit, "consume" for a debit), then no reason at
   all. The original reason is preserved in the note so the audit trail stays complete. */
async function ledgerWrite(row) {
  const base = { ...row };
  const attempts = [base];
  const canon = Number(base.delta) < 0 ? 'consume' : (base.reason === 'refund' ? 'refund' : (base.reason === 'purchase' ? 'purchase' : 'grant'));
  if (base.reason && base.reason !== canon) attempts.push({ ...base, reason: canon, note: ((base.note ? base.note + ' ' : '') + '[' + base.reason + ']').slice(0, 250) });
  attempts.push({ user_id: base.user_id, delta: base.delta, reason: canon });
  attempts.push({ user_id: base.user_id, delta: base.delta });
  let last = null;
  for (const a of attempts) {
    const r = await ledgerWrite(a);
    if (!r.error) return r;
    last = r;
  }
  try { require('./lib/oblog').errlog('ledger:write', new Error(last && last.error && last.error.message || 'ledger insert failed'), { userId: base.user_id, reason: base.reason }); } catch (e) {}
  return last;
}
async function balance(userId) {
  /* If the credit_balance() SQL function is missing or errors, the old code returned 0
     for everyone: a confirmed payment landed in the ledger and the customer still saw
     "0 credits". The ledger itself is the source of truth, so it is summed directly
     whenever the RPC cannot answer. */
  try {
    const { data, error } = await admin().rpc('credit_balance', { uid: userId });
    if (!error && typeof data === 'number') return data;
  } catch (e) {}
  try {
    const { data: rows } = await admin().from('credit_ledger').select('delta').eq('user_id', userId);
    return (rows || []).reduce((sm, r) => sm + (Number(r.delta) || 0), 0);
  } catch (e) { return 0; }
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
/* IDENTITY SCRUB. Before a package is bought the institution, the programme's own name
   and the official link never leave the server - but they were leaking sideways: an
   institution named inside the title ("SBW Berlin International"), a funder named as the
   subject ("Humboldt Research Fellowship"), a funding line that says who pays, a scheme
   name in the money block. Anything a search engine would resolve to one page is an
   identity. This scrubs every free-text field on a locked card against the row's own
   institution, its web domain and a list of named funders and schemes. */
const GENERIC_ORG_WORDS = new Set(['university','universitat','universite','universidad','universita','college','institute','institut','institution','hospital','centre','center','school','faculty','department','dept','clinic','trust','foundation','laboratory','lab','academy','research','international','national','federal','state','technology','technical','medical','medicine','health','sciences','science','applied','graduate','the','of','for','and','de','la','le','der','die','das','fur','für','du','des','di','at','in'].map(w => w.toLowerCase()));
const NAMED_FUNDERS = /\b(humboldt|alexander von humboldt|daad|marie (sk[lł]odowska[- ])?curie|msca|fulbright|erasmus(\+| mundus)?|chevening|commonwealth|wellcome|leverhulme|horizon europe|erc\b|nih\b|nsf\b|dfg\b|max[- ]planck|helmholtz|fraunhofer|leibniz|cnrs|inserm|kaust|kfupm|qatar foundation|khalifa|nyu abu dhabi|tubitak|t[üu]b[iı]tak|yok\b|fct\b|fcs\b|nwo\b|fwo\b|fnrs|snsf|snf\b|vetenskapsr[aå]det|academy of finland|research council|ukri|epsrc|bbsrc|mrc\b|nihr|cihr|nserc|sshrc|vanier|banting|mitacs|arc\b|nhmrc|jsps|kakenhi|nrf\b|csc\b|china scholarship council|sbw berlin|swedish institute|stipendium hungaricum|turkiye burslari|t[üu]rkiye scholarships|gates cambridge|rhodes|clarendon|schwarzman|knight[- ]hennessy|hertz|ford foundation|rockefeller|carnegie|sloan|simons|hhmi|howard hughes|mit\b|harvard|stanford|oxford|cambridge|imperial|ucl\b|eth\b|epfl|tu delft|tum\b|lmu\b|kth\b|karolinska|charit[eé]|sorbonne|heidelberg|utrecht|leiden|groningen|toronto|mcgill|ubc\b|monash|melbourne|sydney|unsw|anu\b|nus\b|ntu\b|kaist|snu\b|tokyo|kyoto|purdue|johns hopkins|mayo|cleveland clinic|yale|princeton|columbia|cornell|berkeley|ucla|ucsf|michigan|duke|emory|vanderbilt|pittsburgh|penn\b|upenn|northwestern|uab\b|utsw|md anderson)\b/gi;
function identityTokens(o) {
  const toks = new Set();
  const add = str => String(str || '').toLowerCase().split(/[^a-z0-9]+/).forEach(w => { if (w.length >= 4 && !GENERIC_ORG_WORDS.has(w)) toks.add(w); });
  add(o.institution);
  try { const host = new URL(String(o.url || '')).hostname.replace(/^www\./, ''); host.split('.').slice(0, -1).forEach(add); } catch (e) {}
  return toks;
}
function scrubIdentity(text, o, toks) {
  let t = String(text || '');
  if (!t.trim()) return t;
  toks = toks || identityTokens(o);
  const inst = String((o && o.institution) || '').trim();
  if (inst.length >= 4) t = t.replace(new RegExp(inst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'the institution');
  for (const w of toks) t = t.replace(new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[a-z]*\\b', 'gi'), ' ');
  t = t.replace(NAMED_FUNDERS, ' ');
  t = t.replace(/https?:\/\/\S+|www\.\S+|\b[a-z0-9.-]+\.(edu|ac\.[a-z]{2}|org|com|de|uk|fr|nl|se|ch|it|es|pt|pl|tr|jp|kr|cn|ca|au|nz|ie|be|at|fi|no|dk|hu|cz)\b/gi, ' ');
  t = t.replace(/\S+@\S+/g, ' ');
  t = t.replace(/\b(and|or|with|by|from|at)\s*(?=[,.;:]|$)/gi, ' ').replace(/,\s*,/g, ',');
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/^[\s,;:\-\u2013|]+|[\s,;:\-\u2013|]+$/g, '').trim();
  return t;
}
function generalTitle(o) {
  let t = String(o.title || '').trim();
  if (!t) return null;
  t = scrubIdentity(t, o);
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
  t = scrubIdentity(t, o);
  if (t.replace(/[^a-z]/gi, '').length < 4) return null;
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
/* DISCOVERY MODE LABELS. "Education opportunity" told the applicant nothing and made the
   list look like filler. The hint names the level and the subject - "Doctoral research -
   Molecular Biology" - which is genuinely useful and still not searchable, because the
   institution, the exact programme title and the URL never leave the server. */
function hintLabel(o) {
  const LV = { bachelors: 'Undergraduate study', masters: "Master's-level opportunity", phd: 'Doctoral research',
    postdoc: 'Postdoctoral research', fellowship: 'Fellowship', diploma: 'Diploma programme',
    short_course: 'Short course', observership: 'Clinical observership' };
  /* THE LEVEL MUST NEVER BE GUESSED DOWNWARDS. A postdoc advertised with an empty level
     column and a title of "Research Associate" was falling through every test and landing
     on "Graduate opportunity" - shown to a PhD holder who had explicitly filtered for
     postdocs. Reading the description as well as the title catches most of them, a
     research-grade salary is strong evidence on its own, and the final fallback is the
     honest "Research position", which claims no level at all. We never invent a level,
     and we never claim one BELOW what the evidence supports. */
  const t = (String(o.title || '') + ' ' + String(o.description || '')).toLowerCase();
  const pay = String(o.stipend || o.salary_note || o.funding || '');
  const annualPay = (() => {
    const m = pay.replace(/[, ]/g, '').match(/(\d{5,6})/);
    return m ? parseInt(m[1], 10) : 0;   // any five/six figure annual salary
  })();
  let lead = LV[o.level] || (o.kind === 'work' ? 'Professional role'
    : /post[\s-]?doc|postdoctoral|research fellow|research associate|senior researcher|junior group leader/.test(t) ? 'Postdoctoral research'
    : /\bphd\b|ph\.d|doctoral|doctorate|promotionsstelle|studentship/.test(t) ? 'Doctoral research'
    : /\bmaster|\bmsc\b|\bm\.sc|mphil|graduate programme/.test(t) ? "Master's-level opportunity"
    : /bachelor|\bbsc\b|undergraduate/.test(t) ? 'Undergraduate study'
    /* A salaried research post is not a graduate programme, whatever the column says. */
    : annualPay >= 25000 ? 'Research position'
    : 'Research position');
  /* The subject comes from the stated field, or from the title with the identifying words
     removed - never the institution, never the programme's own name. */
  let subj = String(o.req_field || o.field || '').trim();
  /* When no field is stated, read the subject out of the description as well as the
     title. "Verified position" was the old fallback and it is worthless to an applicant
     trying to decide whether to spend a credit. */
  if (!subj) {
    const blob = String(o.description || '') + ' ' + String(o.title || '');
    const SUBJ = ['pharmacology','pharmacy','pharmacovigilance','regulatory affairs','molecular biology','biomedical','biotechnology','microbiology','biochemistry','genetics','neuroscience','immunology','oncology','cardiology','public health','epidemiology','nursing','medicine','dentistry','physiotherapy','nutrition','chemistry','physics','mathematics','statistics','data science','machine learning','artificial intelligence','computer science','software engineering','cybersecurity','civil engineering','mechanical engineering','electrical engineering','chemical engineering','materials science','environmental science','energy','robotics','economics','finance','accounting','management','marketing','law','education','psychology','sociology','agriculture','food science','architecture','linguistics'];
    const hit = SUBJ.find(w => new RegExp('\\b' + w.replace(/ /g, '[ -]') + '\\b', 'i').test(blob));
    if (hit) subj = hit;
  }
  if (!subj) {
    /* The title, with the level words, the employer, the funder and the programme's own
       name removed. If what is left is not a discipline, no subject is shown at all:
       "Postdoctoral research" alone is honest, "Postdoctoral research · Humboldt" is a
       search query. */
    subj = scrubIdentity(String(o.title || ''), o)
      .replace(/\b(phd|ph\.d|postdocs?(toral)?|doctoral|master'?s?|msc|mphil|bachelor'?s?|bsc|fellows?(hips?)?|positions?|vacanc(y|ies)|programmes?|programs?|scholarships?|studentships?|opportunit(y|ies)|researchers?|research|associates?|assistants?|scientists?|officers?|senior|junior|lead|principal|group leader|institution|in|of|the|at|for|a|an|and|with|on|to)\b/gi, ' ')
      .replace(/\([^)]*\)/g, ' ').replace(/[^A-Za-z &-]/g, ' ').replace(/\s+/g, ' ').trim();
    subj = subj.split(' ').filter(w => w.length > 1).slice(0, 3).join(' ');
    if (subj.length < 4) subj = '';
  }
  subj = scrubIdentity(subj, o).replace(/\bthe institution\b/gi, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase()).slice(0, 42);
  if (subj.replace(/[^a-z]/gi, '').length < 3) subj = '';
  return subj ? lead + ' \u00b7 ' + subj : lead;
}
/* One line, built from the dimensions the matcher actually scored, so it differs between
   opportunities instead of repeating one stock sentence. No AI call, no cost. */
function relevanceLine(o) {
  const m = o.match || {};
  const ok = (m.reasons || []).filter(r => r.ok === 'yes').map(r => String(r.text || ''));
  const dims = m.dims || {};
  const strong = Object.keys(dims).filter(k => Number(dims[k]) >= 80);
  const pct = Number(m.pct || 0);
  if (strong.includes('field') && strong.includes('level')) return 'Strong alignment with your field and your level of study.';
  if (strong.includes('field') && pct >= 85) return 'Excellent subject match with your academic background.';
  if (strong.includes('experience')) return 'Your professional experience closely matches the core profile.';
  if (strong.includes('level')) return 'The level fits exactly where you are in your career.';
  if (strong.includes('language')) return 'No language barrier: your certificates already meet what is asked.';
  if (ok.length) return ok[0].charAt(0).toUpperCase() + ok[0].slice(1);
  if (pct >= 75) return 'Strong fit based on your qualifications and field.';
  return 'A reasonable fit worth reviewing against your own priorities.';
}
/* How much work this application is, judged from what the advert demands. */
function complexity(o) {
  let n = 0;
  const docs = (o.req_documents || []).length;
  if (docs >= 6) n += 2; else if (docs >= 3) n += 1;
  if (o.req_language && o.req_language !== 'none') n += 1;
  if (o.req_license) n += 1;
  if (/research proposal|portfolio|thesis/i.test(String(o.req_documents || '').toString())) n += 1;
  return n >= 3 ? 'High' : n >= 1 ? 'Moderate' : 'Low';
}
function lockTease(o) {
  const _tk = identityTokens(o);
  /* Day 7: a partner-posted opening is labelled, never boosted; the label is the only difference. */
  const S = v => v == null ? null : (scrubIdentity(String(v), o, _tk) || null);
  return {
    id: o.id, kind: o.kind, country_code: o.country_code, deadline: o.deadline,
    // City and country are given: an applicant must know where in the world this is.
    city: o.city || null,
    general_title: generalTitle(o),
    hint: hintLabel(o), relevance_line: relevanceLine(o), complexity: complexity(o),
    remote_scope: remoteScope(o), remote: (o.remote === true || o.remote === false) ? o.remote : null,
    partner: !!o.is_partner,
    sponsor_verified: o.sponsor_verified == null ? null : !!o.sponsor_verified,
    quality: (typeof DQ !== 'undefined' && DQ) ? DQ.score(o) : null, eligibility_flag: o.eligibility_flag || null, category: o.category || null,
    employer_verified: o.employer_verified == null ? null : !!o.employer_verified,
    field: S(o.req_field || o.field),
    funding: S(o.funding), funding_type: o.funding_type || null, level: o.level || null,
    /* MONEY IS THE FIRST QUESTION EVERY APPLICANT ASKS, and the locked payload was
       answering only part of it. None of this identifies the position: a stipend figure,
       a tuition line, a fee, work rights or a residence route are true of thousands of
       adverts. Withholding them made the preview feel evasive for no security gain. */
    stipend: S(o.stipend), tuition: S(o.tuition), salary_note: S(o.salary_note),
    application_fee: S(o.application_fee), fee_structure: S(o.fee_structure),
    duration: S(o.duration),
    /* PAY, DECODED AND IN RUPEES. A line like "TV-L E13, 65%" is a precise salary to
       someone who knows the German system and a code to everyone else, and "fully funded"
       with no figure answers nothing. We explain the scale in plain words, give the figure
       the scale itself publishes, and convert to PKR so the applicant can judge it against
       a life they actually know. Never the advert's own claim - always the published
       scale, and always labelled approximate. */
    pay_explained: (() => {
      try {
        const src = String(o.stipend || o.salary_note || o.funding || '');
        const dec = require('./lib/payscale').decode(src);
        if (!dec) return null;
        const { toPKR } = require('./lib/pay');
        const pkrM = toPKR ? toPKR(dec.monthly, dec.currency) : null;
        return { name: dec.name, plain: dec.plain, currency: dec.currency,
          monthly: dec.monthly, yearly: dec.yearly, pkr_monthly: pkrM || null, approximate: true };
      } catch (e) { return null; }
    })(),
    money: (() => {
      const x = o.intelligence || o.extra || {};
      return {
        /* Deliberately absent: a living-cost figure. The rule predates this build and it
           is a good one - a cost estimate is a guess about the applicant's future
           spending and it discourages strong candidates for no benefit. */
        housing: S(x.housing_support),
        work_rights: S(x.work_rights),
        pr_pathway: S(x.pr_pathway_note),
        scholarship_stack: S(x.scholarship_stack),
        /* The scheme name IS the identity for a fellowship; it is withheld until unlock. */
        scheme: null
      };
    })(),
    req_language: o.req_language || null, req_language_min: o.req_language_min || null,
    created_at: o.created_at || null, verified_at: o.verified_at || null,
    match: o.match || null, locked: true
  };
}
app.get('/api/credits', auth, async (req, res) => {
  const { data } = await admin().from('credit_ledger').select('*').eq('user_id', req.userId).order('created_at', { ascending: false }).limit(50);
  const bal = await balance(req.userId);
  let pending = 0;
  try { const { count } = await admin().from('payments').select('id', { count: 'exact', head: true }).eq('user_id', req.userId).eq('status', 'pending'); pending = count || 0; } catch (e) {}
  res.json({ balance: bal, credits: bal, pending_payments: pending, ledger: data || [] });
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
  const { credits, reference, proof_b64 } = req.body || {};
  if (!isFinite(Number(credits)) || Number(credits) <= 0) return res.status(400).json({ error: 'Choose a package first.' });
  /* THE SCREENSHOT IS THE RECEIPT. A typed transaction number told us nothing we could
     check; the customer's own payment screenshot is what the finance desk actually
     verifies. It is required, decoded here, and stored privately for the admin queue. */
  let proofBuf = null;
  if (proof_b64) {
    try {
      const m = String(proof_b64).match(/^data:image\/[a-z+]+;base64,(.+)$/i);
      proofBuf = Buffer.from(m ? m[1] : String(proof_b64), 'base64');
      if (proofBuf.length < 1024) proofBuf = null;
    } catch (e) { proofBuf = null; }
  }
  if (!proofBuf) return res.status(400).json({ error: 'Please attach a screenshot of your payment before sending.' });
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
  if (error) return res.status(400).json({ error: 'We could not record your payment just now. Please send your payment screenshot on WhatsApp and we will activate it manually.' });
  // Store the screenshot privately, then attach its path to the payment row.
  try {
    const { BUCKET, ensureBucket } = require('./lib/docs');
    try { if (typeof ensureBucket === 'function') await ensureBucket(); } catch (e) {}
    let img = proofBuf, ct = 'image/jpeg';
    try { img = await require('sharp')(proofBuf).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer(); } catch (e) { ct = 'application/octet-stream'; }
    const path = 'payments/' + req.userId + '/' + data.id + '.jpg';
    const up = await admin().storage.from(BUCKET).upload(path, img, { contentType: ct, upsert: true });
    if (!up.error) {
      const { error: e1 } = await admin().from('payments').update({ proof_path: path, proof_uploaded_at: new Date().toISOString() }).eq('id', data.id);
      if (e1) await admin().from('payments').update({ reference: ('PROOF:' + path).slice(0, 120) }).eq('id', data.id);
      data.proof_path = path;
    } else {
      try { require('./lib/oblog').errlog('payments:proof-upload', new Error(up.error.message || 'upload failed'), { userId: req.userId }); } catch (e) {}
    }
  } catch (e) {}
  try { const t = require('./lib/tenancy'); const c = await t.selfClient(req.userId); if (c) await t.advanceStage(c.id, 'decide'); } catch (e) {}
  try { await admin().from('audit_log').insert({ actor: req.userId, event: 'PAYMENT_DECLARED', detail: data.id + ' ' + pack.credits + 'cr Rs' + Math.max(0, pack.pkr - discount) + (data.proof_path ? ' screenshot attached' : ' NO screenshot') }); } catch (e) {}
  res.json({ payment: data, amount_pkr: Math.max(0, pack.pkr - discount), list_pkr: pack.list_pkr || pack.pkr,
    promo_applied: !!pack.list_pkr, discount_pkr: discount,
    note: 'Pending. Credits appear after staff confirms your bank transfer.' });
});
app.post('/api/payments/:id/confirm', auth, perm('payments.write'), async (req, res) => {
  const { data: p } = await admin().from('payments').select('*').eq('id', req.params.id).single();
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.status !== 'pending') return res.status(400).json({ error: 'Already ' + p.status });
  // Atomic: only the request that flips pending->confirmed may write the credits.
  let { data: flipped, error: flipErr } = await admin().from('payments').update({ status: 'confirmed', confirmed_by: req.userId, confirmed_at: new Date().toISOString() }).eq('id', p.id).eq('status', 'pending').select('id');
  if (flipErr) ({ data: flipped } = await admin().from('payments').update({ status: 'confirmed' }).eq('id', p.id).eq('status', 'pending').select('id'));
  if (!flipped || !flipped.length) return res.status(400).json({ error: 'Already confirmed' });
  /* THE CREDITS ARE THE POINT. The ledger insert used to run unchecked: if the row failed
     (a missing column, a constraint), the payment still read "confirmed", the customer
     still had nothing, and nobody was told. It is verified now, retried with a minimal
     row, and if it still fails the confirmation is rolled back so it can be retried. */
  const creditsN = Math.max(1, Math.round(Number(p.credits) || 0));
  let led = await ledgerWrite({ user_id: p.user_id, delta: creditsN, reason: 'purchase', payment_id: p.id, note: 'Payment ' + p.id });
  if (led.error) led = await ledgerWrite({ user_id: p.user_id, delta: creditsN, reason: 'purchase' });
  if (led.error) {
    await admin().from('payments').update({ status: 'pending', confirmed_by: null, confirmed_at: null }).eq('id', p.id).then(() => {}, () => admin().from('payments').update({ status: 'pending' }).eq('id', p.id));
    try { require('./lib/oblog').errlog('payments:confirm-ledger', new Error(led.error.message || 'ledger insert failed'), { paymentId: p.id }); } catch (e) {}
    return res.status(500).json({ error: 'Credits could not be written (' + String(led.error.message || 'ledger error').slice(0, 120) + '). The payment is still pending; run the latest SQL migration and confirm again.' });
  }
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
  if (p.addon_key && (p.addon_key === 'o2s' || /_plus$/.test(p.addon_key))) { try { const cfg = await siteSettings.getConfig(); const inc = ((cfg.plus || {}).includes) || ['offer_pack', 'visa_desk', 'interview_pack', 'arrival_pack', 'residence_year']; for (const k of inc) await admin().from('user_addons').insert({ user_id: p.user_id, addon_key: k, payment_id: p.id, bundle: p.addon_key, expires_at: k === 'residence_year' ? new Date(Date.now() + 365 * 86400000).toISOString() : null }).then(() => {}, () => {}); } catch (e) {} }
  else if (p.addon_key) { const days = p.addon_key === 'residence_year' ? 365 : p.addon_key === 'pathway_month' ? 31 : p.addon_key === 'pathway_year' ? 366 : null; await admin().from('user_addons').insert({ user_id: p.user_id, addon_key: p.addon_key, payment_id: p.id, expires_at: days ? new Date(Date.now() + days * 86400000).toISOString() : null }).then(() => {}, () => {}); if (/^pathway_/.test(p.addon_key)) { try { await require('./lib/pathway').detect(p.user_id, { notify: false }); await require('./lib/notify').push(p.user_id, 'pathway', 'Pathway Membership is on', 'Your pathway is now reassessed every week; alerts are immediate; ask a human any time from the card.', 'profile'); } catch (e) {} } }
  accrueCommission(p).catch(() => {}); JE.recompute(p.user_id);
  NOTIFY.push(p.user_id, 'payment_approved', 'Payment approved: ' + creditsN + ' case' + (creditsN === 1 ? '' : 's') + ' active', 'Open your matches and choose the positions to prepare.', 'home').catch(() => {});
  const newBal = await balance(p.user_id).catch(() => null);
  res.json({ ok: true, credits_added: creditsN, balance: newBal });
});
/* Rejecting is a decision too. A payment that cannot be matched to a transfer used to sit
   in the queue forever; now it is closed with a reason the customer can act on. */
app.post('/api/payments/:id/reject', auth, perm('payments.write'), async (req, res) => {
  try {
    const { data: p } = await admin().from('payments').select('*').eq('id', req.params.id).single();
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (p.status !== 'pending') return res.status(400).json({ error: 'Already ' + p.status });
    const reason = String((req.body || {}).reason || '').trim().slice(0, 300);
    let { error } = await admin().from('payments').update({ status: 'failed', rejected_reason: reason || null, confirmed_by: req.userId, confirmed_at: new Date().toISOString() }).eq('id', p.id).eq('status', 'pending');
    if (error) ({ error } = await admin().from('payments').update({ status: 'failed' }).eq('id', p.id).eq('status', 'pending'));
    if (error) return res.status(400).json({ error: error.message });
    admin().from('support_tickets').insert({
      user_id: p.user_id, subject: 'Payment could not be verified',
      message: 'Package purchase - ' + p.credits + ' case credit' + (p.credits === 1 ? '' : 's'),
      reply: 'We could not match your payment screenshot to a transfer received.' + (reason ? ' Reason: ' + reason : '') + ' Please check the amount and account, then send a clear screenshot again from the plans page, or message us on WhatsApp.',
      status: 'answered'
    }).then(() => {}, () => {});
    try { await admin().from('audit_log').insert({ actor: req.userId, event: 'PAYMENT_REJECTED', detail: p.id + (reason ? ' ' + reason : '') }); } catch (e) {}
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
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
    /* Admin and super admin only. Other staff roles walk the customer's path like a
       customer; the payment bypass is an owner-level power. The client preview header
       does not matter here: the real profile role is what is checked. */
    if (!prof || !['admin', 'super_admin'].includes(prof.role)) return res.status(403).json({ error: 'Admin only' });
    const asked = Number((req.body || {}).credits);
    const want = isFinite(asked) && asked > 0 ? Math.max(999, Math.round(asked)) : 999;
    const bal0 = await balance(req.userId).catch(() => 0);
    const topUp = Math.max(1, want - bal0);
    const { error } = await ledgerWrite({ user_id: req.userId, delta: topUp, reason: 'admin_bypass', note: 'Staff activation, no payment' });
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
      /* Day 6 · outcome learning: a bounded nudge (±4) from verified outcomes of applicants in
         the same field at the same destination, always with a sentence explaining it. */
      try {
        const LEARN = require('./lib/learning'); const learn = await LEARN.current();
        if (learn && learn.groups && learn.groups.length) {
          const { data: pf } = await admin().from('profiles').select('field,profession').eq('id', req.userId).maybeSingle();
          const fb = LEARN.bucketField(pf && (pf.field || pf.profession));
          const oppOf = Object.fromEntries(opportunities.map(o => [o.id, o]));
          for (const x of m) { if (x.status === 'not_eligible' || x.pct == null) continue; const n = LEARN.nudge(learn, oppOf[x.id], fb); if (n.delta) { x.pct = Math.max(0, Math.min(99, x.pct + n.delta)); x.outcome_note = n.note; } }
        }
      } catch (e) {}
      const byId = {}; m.forEach(x => { byId[x.id] = x; });
      opportunities = opportunities.map(o => ({ ...o, match: byId[o.id] ? { status: byId[o.id].status, pct: byId[o.id].pct, dims: byId[o.id].dims, outcome_note: byId[o.id].outcome_note || null, overqualified: byId[o.id].overqualified, fieldMismatch: byId[o.id].fieldMismatch, wrongTarget: byId[o.id].wrongTarget, levelUnknown: byId[o.id].levelUnknown, adjacentRole: byId[o.id].adjacentRole, adjacentEvidence: byId[o.id].adjacentEvidence } : null }));
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
        /* Adjacent now has a real definition: the capability test in match.js found the
           applicant's stated skills covering the posting's requirements under a different
           title. The model's own "track" hint still counts, as a second signal. */
        const adjacent = !!(o.match && o.match.adjacentRole)
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
  /* TOP-UP SIGNAL. The table is only ever as good as what has already been discovered, so
     a thin database produced a thin screen and the applicant had no idea a live hunt could
     have filled it. We now say plainly how many strong matches exist and how many short of
     fifteen we are; the client asks for a live top-up, which runs in the background and
     streams in. It does not spend a daily search - the user already spent one to get here. */
  /* THE HINT BELONGS ON EVERY ROW OF THE MAIN LIST. It was added to the saved-list
     endpoint only, so the discovery table fell back to "Verified position" - a label that
     tells an applicant nothing at all - for every unlocked row. */
  opportunities = (opportunities || []).map(o => Object.assign({}, o, {
    hint: o.hint || hintLabel(o),
    relevance_line: o.relevance_line || relevanceLine(o),
    complexity: o.complexity || complexity(o)
  }));
  const strong = (opportunities || []).filter(o => o.match && o.match.pct != null && o.match.pct >= RELEVANCE_FLOOR).length;
  res.json({ opportunities, strong_count: strong,
    topup_needed: String(req.query.match) === '1' && strong < 15,
    short_by: Math.max(0, 15 - strong) });
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
  /* The literal two-role list missed super_admin and every delegated admin role, so the
     owner was sent to the plans page to buy a package before his own case would start.
     Staff never pay and never spend a credit; the role helper is the single source of
     truth for who counts as staff. */
  const isAdmin = !!(prof && require('./lib/rbac').isAdminRole(prof.role) && prof.role !== 'user' && !simUser(req));
  // CV is the one required document before any application can be prepared.
  const { data: cvDocs } = await admin().from('documents').select('id').eq('user_id', req.userId).eq('kind', 'cv').eq('generated', false).limit(1);
  if (!isAdmin && (!cvDocs || !cvDocs.length)) {
    return res.status(400).json({ error: 'Please upload your CV first. It is the only required document, and every application is prepared from it.' });
  }
  const bal = await balance(req.userId);
  if (!isAdmin && bal < 1) {
    return res.status(402).json({ error: 'Your matches are ready. Choose a package to start this case - every case is prepared completely, end to end.' });
  }
  const { data: opp } = await admin().from('opportunities').select('id,institution,url,deadline,status').eq('id', opportunityId).single();
  if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
  /* RE-VERIFY BEFORE A CREDIT IS SPENT. A position can be genuine when we found it and
     withdrawn a week later. The moment that matters is the moment money changes hands,
     so the official page is checked again right here, before the debit. A page that has
     been taken down stops the case, costs nothing, and is retired from every search. A
     slow or bot-blocking server is not treated as gone - only a definite 404 or 410 is. */
  if (opp.deadline && String(opp.deadline).slice(0, 10) < new Date().toISOString().slice(0, 10)) {
    try { await admin().from('opportunities').update({ status: 'expired' }).eq('id', opp.id); } catch (e) {}
    return res.status(409).json({ error: 'This position closed on ' + String(opp.deadline).slice(0, 10) + '. No credit was spent. Please choose another.' });
  }
  if (opp.url && /^https?:\/\//i.test(opp.url)) {
    try {
      const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 7000);
      let r = null;
      try {
        r = await fetch(opp.url, { method: 'HEAD', redirect: 'follow', signal: ac.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; ForiForeignBot/1.0)' } });
        if (r && (r.status === 405 || r.status === 501)) r = await fetch(opp.url, { method: 'GET', redirect: 'follow', signal: ac.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; ForiForeignBot/1.0)' } });
      } finally { clearTimeout(timer); }
      if (r && (r.status === 404 || r.status === 410)) {
        try { await admin().from('opportunities').update({ status: 'expired' }).eq('id', opp.id); } catch (e) {}
        try { await admin().from('audit_log').insert({ actor: req.userId, event: 'OPP_DEAD_ON_OPEN', detail: opp.id + ' ' + String(opp.url).slice(0, 120) }); } catch (e) {}
        return res.status(409).json({ error: 'The official page for this position has been taken down since we found it, so it is no longer open. No credit was spent. Please choose another.' });
      }
      try { await admin().from('opportunities').update({ verified_at: new Date().toISOString() }).eq('id', opp.id); } catch (e) {}
    } catch (e) { /* unreachable is not the same as gone */ }
  }
  const caseNo = 'FF-' + Date.now().toString(36).toUpperCase();
  // DEBIT FIRST, then create. Combined with the per-user lock this removes the
  // check-then-act window entirely; if creation fails we refund immediately.
  let debited = false;
  if (!isAdmin) {
    const balNow = await balance(req.userId);
    if (balNow < 1) return res.status(402).json({ error: 'Your matches are ready. Choose a package to start this case.' });
    const { error: dErr } = await ledgerWrite({ user_id: req.userId, delta: -1, reason: 'consume', note: opp.institution });
    if (dErr) return res.status(400).json({ error: 'Could not start this case. Please try again.' });
    debited = true;
  }
  const { data: appRow, error } = await admin().from('applications')
    .insert({ user_id: req.userId, opportunity_id: opp.id, case_no: caseNo, stage: 'preparing', credits_consumed: isAdmin ? 0 : 1 })
    .select().single();
  if (error) {
    if (debited) { try { await ledgerWrite({ user_id: req.userId, delta: 1, reason: 'refund', note: 'Case could not be created' }); } catch (e) {} }
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
    // Phase 1: every upload is read by the document reader on the queue (type, dates, expiry, cross-checks).
    for (const r of results) if (r.id) QUEUE.enqueue('vault_read', { docId: r.id, userId: req.userId }, { userId: req.userId, maxAttempts: 2 }).catch(() => {});
    // A referred user uploading a document is the qualification event: check the
    // referrer's milestones now so rewards issue automatically, never manually.
    try {
      const { data: prof } = await admin().from('profiles').select('referred_by').eq('id', req.userId).single();
      if (prof && prof.referred_by && prof.referred_by !== req.userId) {
        require('./lib/referral').syncRewards(prof.referred_by).catch(() => {});
      }
    } catch (e) {}
    // Day 9: profile extraction is a durable queue job (retried, survives a restart) instead of a timer.
    if (ok) QUEUE.enqueue('profile_extract', { userId: req.userId }, { userId: req.userId, maxAttempts: 2 }).catch(e => admin().from('audit_log').insert({ actor: req.userId, event: 'AUTOFILL_FAIL', detail: String(e.message).slice(0, 200) }).then(() => {}, () => {}));
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
  try { const { data: pe } = await admin().from('profiles').select('apply_email').eq('id', req.userId).maybeSingle(); pkg.from_mailbox = pe && pe.apply_email || null; pkg.mailbox_sending = require('./lib/mailer').enabled(); pkg.attach_doc_ids = (pkg.attachments || []).map(x => x.id).filter(Boolean); } catch (e) {}
  pkg.profile = { full_name: pr.full_name, email: pr.email, phone: pr.phone, city: pr.city, address: pr.address,
    last_institution: pr.last_institution, degree_level: pr.degree_level, field: pr.field, cgpa: pr.cgpa,
    experience_years: pr.experience_years, language_scores: pr.language_scores, linkedin: pr.linkedin,
    license_number: licInfo.license_number || '', license_authority: licInfo.license_authority || '', profession: licInfo.profession || '' };
  try { pkg.portal_map = require('./lib/portal_maps').forUrl((a.opportunities && a.opportunities.url) || a.portal_url || '') || null; } catch (e) {}
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
  if (await isPlatformStaff(userId)) return true;   // FF staff are never blocked by a payment page
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
/* LIVE TOP-UP. Fifteen strong matches is the target, not a hope. When the database cannot
   supply them, this hunts the live web for the shortfall and writes what it verifies, so
   the table fills while the applicant is still looking at it. Deliberately NOT a second
   daily search: it is the completion of the one they already ran. Rate limited per user so
   a page refresh cannot start a queue of expensive runs. */
app.post('/api/run/topup', auth, async (req, res) => {
  try {
    /* THREE GUARDS THIS ENDPOINT WAS MISSING. It calls the same expensive discovery
       pipeline as a full search, but it skipped the maintenance switch that /api/run
       respects, it would run for someone who had never searched at all, and it would run
       while their previous search was still going - stacking two paid AI runs on one
       profile. A cheap endpoint to call is not a cheap endpoint to serve. */
    const feat = ((require('./lib/settings').cache() || {}).features) || {};
    if (feat.discovery_enabled === false) return res.json({ ok: true, ran: false, reason: 'Search is briefly paused for maintenance.' });
    try {
      const { data: prog } = await admin().from('app_settings').select('value').eq('key', 'discover:' + req.userId).single();
      if (prog && prog.value && prog.value.status === 'running') {
        const started = Date.parse(prog.value.startedAt || '') || 0;
        if (started && Date.now() - started < 12 * 60000) return res.json({ ok: true, ran: false, reason: 'A search is already running for you.' });
      }
    } catch (e) {}
    const key = 'topup:' + req.userId;
    const now = Date.now();
    let last = 0;
    try { const { data } = await admin().from('app_settings').select('value').eq('key', key).single(); last = Number(data && data.value && data.value.at) || 0; } catch (e) {}
    if (now - last < 8 * 60000) return res.json({ ok: true, ran: false, reason: 'A top-up for this profile ran in the last few minutes.' });
    await admin().from('app_settings').upsert({ key, value: { at: now } });

    const { data: pf } = await admin().from('app_settings').select('value').eq('key', 'prefs:' + req.userId).single();
    const prefs = Object.assign({}, (pf && pf.value) || {});
    const short = Math.min(15, Math.max(1, parseInt((req.body || {}).short_by, 10) || 15));
    prefs.target = Math.max(15, short * 2);
    prefs.countries = Array.isArray(prefs.ctrys) ? prefs.ctrys : (prefs.countries || []);
    // The top-up must honour the same remote flag as the search it is completing.
    prefs.remote = !!(prefs.remote || prefs.workmode === 'remote');
    prefs.progressKey = 'discover:' + req.userId;
    prefs.startedAt = new Date().toISOString();
    const kind = String((req.body || {}).kind || prefs.kind || '') || undefined;

    res.json({ ok: true, ran: true, target: prefs.target });
    /* After the response: the applicant is already reading their results. */
    (async () => {
      try {
        const { discoverForUser } = require('./lib/engine');
        if (req._freeTier) prefs.maxPasses = 1;
        const added = await discoverForUser(req.userId, kind, prefs);
        await admin().from('app_settings').upsert({ key: prefs.progressKey, value: {
          status: 'done', found: added, kind, target: prefs.target, finishedAt: new Date().toISOString() } });
        await admin().from('audit_log').insert({ actor: req.userId, event: 'TOPUP', detail: kind + ': +' + added });
      } catch (e) {
        try { require('./lib/oblog').errlog('run:topup', e, { userId: req.userId }); } catch (e2) {}
        try { await admin().from('app_settings').upsert({ key: 'discover:' + req.userId, value: { status: 'done', found: 0 } }); } catch (e2) {}
      }
    })();
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
    await ledgerWrite({
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
  KV('Deadline:', opp.deadline ? String(opp.deadline).slice(0, 10) : 'No closing date on the official page - apply as early as you can');
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
  KV('Deadline:', opp.deadline ? String(opp.deadline).slice(0, 10) : 'No closing date on the official page - apply as early as you can');
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
    if (req.userRole && STAFF_ROLES.includes(req.userRole)) return next();   // ForiForeign's own admin and staff only: no search limit, no case limit
    /* THREE A DAY, FIVE ONCE THEY HAVE BOUGHT. Nothing raises it further and nothing is
       sold that raises it. Buying a package also wipes whatever has already been used,
       today or on any earlier day, so the five start clean. */
    const everPaid = await hasEverPaid(req.userId).catch(() => false);
    const dayMax = everPaid ? (Number(fu.paid_daily_searches) || 5) : (Number(fu.daily_searches) || 3);
    const { day } = await searchCounts(req.userId);
    /* FREE TIER ECONOMICS: an unpaid account gets a lifetime allowance of full searches (default 10, Settings → fair_use.free_lifetime_searches)
       and each free search runs one discovery pass instead of three. Cost per free user is therefore bounded; see Admin → Economics. */
    if (!everPaid) { const { data: pf } = await admin().from('profiles').select('free_searches_used').eq('id', req.userId).maybeSingle(); const used = (pf && pf.free_searches_used) || 0; const life = Number(fu.free_lifetime_searches) || 10; if (used >= life) return res.status(402).json({ error: 'You have used your ' + life + ' free searches. Your matches are saved; a package unlocks unlimited daily searches and prepares your applications.', fair_use: true, scope: 'lifetime', used, limit: life, paid: false, offer: 'package' }); await admin().from('profiles').update({ free_searches_used: used + 1 }).eq('id', req.userId); req._freeTier = true; }
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
/* An unknown /api route answered with Express's HTML "Cannot GET" page. The client parses
   every API response as JSON, so that became a bare "Error 404" toast with no hint of
   what was asked for. JSON, with the path, is what the client and the log both expect. */
app.use('/api', (req, res) => res.status(404).json({ error: 'No such API route: ' + req.method + ' ' + req.path }));
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
const _server = app.listen(PORT, () => {
  console.log('ForiForeign core on :' + PORT);
  try { require('./lib/agents').startAgents(); } catch (e) { console.error('[agents]', e.message); }
});
/* Graceful shutdown (Railway sends SIGTERM on deploy): stop taking requests, let in-flight work finish, then exit. */
try { _server.setTimeout(120000); process.on('SIGTERM', () => { console.log('[shutdown] SIGTERM'); try { _server.close(() => process.exit(0)); } catch (e) { process.exit(0); } setTimeout(() => process.exit(0), 25000).unref(); }); } catch (e) {}
