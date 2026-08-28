// ForiForeign server core v0.1 — auth (Supabase), credits, payments, pricing, opportunities
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
app.use(express.json({ limit: '2mb' }));
// Long-cache heavy static assets (video/icons); HTML always fresh.
app.use(express.static('public', { maxAge: '7d', setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
app.get('/health', (req, res) => res.json({ ok: true, up: process.uptime() | 0 }));

/* Per-user limiter for AI-triggering actions: protects cost and stability under load.
   In-memory sliding window: 30 AI actions per user per hour (admin exempt). */
const _aiHits = new Map();
function aiLimit(req, res, next) {
  const id = req.userId || req.ip; const now = Date.now();
  const arr = (_aiHits.get(id) || []).filter(t => now - t < 3600e3);
  if (arr.length >= 30) return res.status(429).json({ error: 'You have reached this hour\'s search limit. Please try again shortly.' });
  arr.push(now); _aiHits.set(id, arr); next();
}
if (_aiHits.size > 5000) _aiHits.clear();

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
<title>${escH(title)} — ForiForeign</title>
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
    // Real, admin-entered stories only — never fabricated defaults.
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
const seoPage = (title, desc, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | ForiForeign</title><meta name="description" content="${desc}"><link rel="canonical" href=""><style>body{margin:0;background:#050d1f;color:#eef4ff;font:15px/1.6 system-ui,Segoe UI,Arial}a{color:#00D4FF}.wrap{max-width:760px;margin:0 auto;padding:28px 16px}h1{font-size:26px;margin:6px 0}h2{font-size:18px;margin:18px 0 6px;color:#fff}.sub{color:#9db8e8;font-size:13px}.card{background:rgba(8,18,40,.92);border:1px solid rgba(140,178,255,.3);border-radius:14px;padding:14px;margin:10px 0}.chip{display:inline-block;border:1px solid rgba(140,178,255,.4);border-radius:999px;padding:2px 10px;font-size:12px;margin:2px 4px 2px 0;color:#cfe1ff}.g{color:#2dd4bf;font-weight:700}.cta{display:inline-block;background:linear-gradient(90deg,#1683FF,#00D4FF);color:#04101f;font-weight:800;padding:12px 22px;border-radius:12px;text-decoration:none;margin-top:14px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}</style></head><body><div class="wrap"><div class="top"><a href="/" style="font-weight:800;text-decoration:none;color:#fff">ForiForeign</a><a href="/" class="sub">Open the app →</a></div>${body}<a class="cta" href="/">Find my opportunities — first case free</a><div class="sub" style="margin-top:16px">Every opportunity verified on the official page before you see it. You review, you press Send. Built in Pakistan.</div></div></body></html>`;
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
    const cards = rows.map(o => { const pk = pkrText(o.stipend || o.tuition, rate); return `<div class="card"><span class="chip">${o.country_code || ''}</span>${o.level ? `<span class="chip">${o.level}</span>` : ''}${o.funding_type === 'fully' ? '<span class="chip" style="border-color:#2dd4bf;color:#2dd4bf">Fully funded</span>' : ''}${o.deadline ? `<span class="chip">Deadline ${o.deadline}</span>` : ''}${o.stipend ? `<div class="g" style="margin-top:6px">Stipend: ${String(o.stipend).slice(0, 60)} ${pk ? '<span class="sub">' + pk + '</span>' : ''}</div>` : ''}<div class="sub" style="margin-top:6px">Verified on the official page. Institution and full details open inside ForiForeign — your first case is free.</div></div>`; }).join('');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(seoPage(h, h + ' for Pakistani students and professionals — verified on official pages, matched to your CV, applications prepared for you.', `<h1>${h}</h1><div class="sub">${rows.length ? rows.length + ' verified openings live right now.' : 'The agent searches official sources daily — open the app and it searches for you.'} Matched to your CV. Applications prepared for you.</div>${cards}`));
  } catch (e) { res.redirect('/'); }
});
const SEO_GUIDES = {
  germany: { cc: 'DE', title: 'Study in Germany from Pakistan', body: '<h2>Why Germany</h2><div>Public universities charge no tuition — you pay only a semester fee of roughly €150–350 (≈ Rs 50,000–1.2 lakh per year). World-class engineering, pharmacy and research, with DAAD scholarships built for international students.</div><h2>Money reality</h2><div>Blocked account requirement ≈ €11,904 (≈ Rs 36 lakh) shown once for the visa. Monthly living ≈ €950.</div><h2>Visa for Pakistanis</h2><div>National (D) visa via the German Embassy Islamabad; APS certificate is now required before application. Plan 3–4 months.</div><h2>Funding names to know</h2><div>DAAD, Deutschlandstipendium, Erasmus Mundus.</div>' },
  finland: { cc: 'FI', title: 'Study in Finland from Pakistan', body: '<h2>Why Finland</h2><div>One of the world&#39;s best education systems, 400+ English programmes, and generous early-bird tuition waivers — many admits pay 50–100% less.</div><h2>Money reality</h2><div>Tuition €8,000–18,000 before waivers; living ≈ €800/month. Proof of funds ≈ €6,720/year (≈ Rs 21 lakh).</div><h2>Visa for Pakistanis</h2><div>Residence permit online via EnterFinland, biometrics at VFS Islamabad/Karachi.</div><h2>Funding names to know</h2><div>University scholarships (automatic with admission), EDUFI for doctoral research.</div>' },
  italy: { cc: 'IT', title: 'Study in Italy from Pakistan', body: '<h2>Why Italy</h2><div>Regional grants (DSU) can make study effectively free — many Pakistani students pay near-zero tuition AND receive a yearly grant with free meals and housing support.</div><h2>Money reality</h2><div>Tuition is income-based, often €150–1,000 with ISEE paperwork; DSU grants ≈ €5,000–7,000/year (≈ Rs 15–21 lakh).</div><h2>Visa for Pakistanis</h2><div>Pre-enrolment on Universitaly, then D-visa at the Embassy in Islamabad. Start documents early — attestation takes time.</div><h2>Funding names to know</h2><div>DSU regional scholarships, Invest Your Talent in Italy.</div>' },
  'saudi-arabia': { cc: 'SA', title: 'Work in Saudi Arabia from Pakistan', body: '<h2>Why Saudi Arabia</h2><div>Tax-free salaries, large Pakistani community, and constant demand for pharmacists, nurses, doctors and engineers under Vision 2030.</div><h2>Licensing reality</h2><div>Healthcare professionals need SCFHS classification via Prometric + DataFlow verification — start DataFlow early, it is the slow step.</div><h2>Money reality</h2><div>Pharmacist salaries commonly SAR 5,000–12,000/month (≈ Rs 3.7–9 lakh) plus housing/transport in many contracts.</div><h2>Funding names to know</h2><div>For study instead: KAUST and Saudi government scholarships are fully funded with stipends.</div>' },
  'united-kingdom': { cc: 'GB', title: 'Study in the UK from Pakistan', body: '<h2>Why the UK</h2><div>One-year Master&#39;s degrees cut total cost dramatically, and the Graduate Route gives 2 years of post-study work.</div><h2>Money reality</h2><div>Tuition £14,000–28,000; maintenance funds ≈ £1,023/month outside London shown for 9 months (≈ Rs 32 lakh).</div><h2>Visa for Pakistanis</h2><div>Student visa with CAS; IHS surcharge applies. TB test required at approved Pakistani clinics.</div><h2>Funding names to know</h2><div>Chevening (fully funded), Commonwealth Shared Scholarships, GREAT Scholarships.</div>' },
  australia: { cc: 'AU', title: 'Study in Australia from Pakistan', body: '<h2>Why Australia</h2><div>Strong universities, paid part-time work rights, and 2–4 years of post-study work through the Temporary Graduate visa.</div><h2>Money reality</h2><div>Tuition AUD 30,000–45,000; proof of funds ≈ AUD 29,710/year (≈ Rs 55 lakh). Research degrees are often fully funded with stipends ≈ AUD 32,000.</div><h2>Visa for Pakistanis</h2><div>Subclass 500 with GS statement; strong, honest documentation matters more than agents claim.</div><h2>Funding names to know</h2><div>Australia Awards, RTP (research), Destination Australia.</div>' }
};
app.get('/guide/:c', async (req, res) => {
  const g = SEO_GUIDES[String(req.params.c || '').toLowerCase()];
  if (!g) return res.redirect('/');
  res.set('Cache-Control', 'public, max-age=3600');
  const links = SEO_SLUGS.filter(sl => { for (const [n, c] of Object.entries(SEO_COUNTRIES)) if (sl.endsWith(n) && c === g.cc) return true; return false; }).map(sl => `<a href="/s/${sl}">${sl.replace(/-/g, ' ')}</a>`).join(' · ');
  res.send(seoPage(g.title, g.title + ' — real costs in PKR, visa steps, licensing and funding names, plus live verified opportunities.', `<h1>${g.title}</h1>${g.body}${links ? '<h2>Live openings</h2><div>' + links + '</div>' : ''}`));
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
  if (!(await entitled(req.userId))) {
    let m = null; try { const { matchOpportunity } = require('./lib/match'); m = await matchOpportunity(req.userId, o.id); } catch (e) {}
    return res.status(402).json({
      locked: true,
      error: 'This opportunity is reserved for package members. Choose a package to open the institution, official page and verified contact — one case or several, your choice.',
      teaser: { ...lockTease(o), match: m ? { status: m.status, pct: m.pct } : null }
    });
  }
  // record 'viewed' (spec 41) — best effort
  admin().from('user_opportunity_history').insert({ user_id: req.userId, opportunity_id: o.id, event: 'viewed' }).then(() => {}, () => {});
  // match + eligibility gaps (spec 13/15)
  let match = null;
  try { const { matchOpportunity } = require('./lib/match'); match = await matchOpportunity(req.userId, o.id); } catch (e) {}
  // financial summary (spec 12): stated figures only + clearly-labeled living estimate
  const { livingEstimate } = require('./lib/costs');
  const cfg = await siteSettings.getConfig().catch(() => siteSettings.DEFAULTS);
  const rate = Number(cfg.ai && cfg.ai.usd_to_pkr) || 278;
  const living = livingEstimate(o.country_code);
  const financial = {
    tuition_stated: o.tuition || null,
    application_fee_stated: o.application_fee || null,
    stipend_stated: o.stipend || null,
    funding_stated: o.funding || null,
    living_estimate: living ? {
      usd_per_month: living.usd_low + '–' + living.usd_high,
      pkr_per_month_approx: Math.round(living.usd_low * rate).toLocaleString() + '–' + Math.round(living.usd_high * rate).toLocaleString(),
      rate_used: '1 USD ≈ PKR ' + rate + ' (admin-set rate)',
      basis: living.basis
    } : null,
    note: 'Stated figures come from the official source. Living cost is an approximate public average, not an official figure.'
  };
  const now = Date.now(), day = 86400000;
  const freshness = (o.deadline && new Date(o.deadline).getTime() < now - day) ? 'deadline_passed'
    : (o.verified_at && now - new Date(o.verified_at).getTime() < day) ? 'verified_today'
    : (o.verified_at && now - new Date(o.verified_at).getTime() < 14 * day) ? 'verified_recently' : 'needs_reverification';
  res.json({
    opportunity: o, match, financial, freshness,
    provenance: { source_url: o.url, source_type: 'official_page', retrieved_at: o.created_at, last_verified: o.verified_at, verification: o.status }
  });
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
  if (!(await entitled(req.userId))) list = list.map(o => lockTease(o));
  res.json({ opportunities: list });
});
/* ---------- Spec 2: configurable university database (admin) ---------- */
app.get('/api/admin/universities', auth, perm('countries.read'), async (req, res) => {
  let q = admin().from('universities').select('*').order('country_code').order('priority');
  if (req.query.country) q = q.eq('country_code', String(req.query.country).toUpperCase());
  const { data } = await q.then(r => r, () => ({ data: [] }));
  res.json({ universities: data || [] });
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
app.get('/api/admin/users', auth, perm('users.read'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  let query = admin().from('profiles').select('id,full_name,role,created_at').order('created_at', { ascending: false }).limit(100);
  if (q) query = query.ilike('full_name', '%' + q + '%');
  const { data } = await query;
  res.json({ users: data || [] });
});
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
  await admin().from('audit_log').insert({ actor: req.userId, event: 'ROLE_CHANGED', detail: req.params.id + ' -> ' + role }).then(() => {}, () => {});
  res.json({ ok: true });
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
  if (['new', 'open', 'waiting', 'resolved', 'closed'].includes(status)) q = q.eq('status', status);
  const { data } = await q.then(r => r, () => ({ data: [] }));
  res.json({ tickets: data || [] });
});
app.post('/api/admin/support/:id', auth, perm('support.write'), async (req, res) => {
  const patch = {};
  if (req.body && typeof req.body.reply === 'string') patch.reply = req.body.reply.slice(0, 4000);
  if (req.body && ['new', 'open', 'waiting', 'resolved', 'closed'].includes(req.body.status)) patch.status = req.body.status;
  if (req.body && typeof req.body.internal_note === 'string') patch.internal_note = req.body.internal_note.slice(0, 2000);
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  patch.updated_at = new Date().toISOString();
  const { error } = await admin().from('support_tickets').update(patch).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  await admin().from('audit_log').insert({ actor: req.userId, event: 'SUPPORT_UPDATE', detail: req.params.id + ' ' + JSON.stringify(patch).slice(0, 200) }).then(() => {}, () => {});
  res.json({ ok: true });
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
      featured: !!p.featured, visible: p.visible !== false,
      promo_pkr: (isFinite(parseInt(p.promo_pkr)) && parseInt(p.promo_pkr) >= 0) ? parseInt(p.promo_pkr) : null
    });
  }
  if (!clean.length) return res.status(400).json({ error: 'No valid packages' });
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
    let signupName = '';
    try { const { data: ud } = await admin().auth.getUser((req.headers.authorization || '').replace(/^Bearer /, '')); signupName = ((ud && ud.user && ud.user.user_metadata) || {}).full_name || ''; } catch (e) {}
    const ins = await admin().from('profiles').insert({ id: req.userId, full_name: signupName || req.userEmail.split('@')[0], role: isFounder ? 'admin' : 'user' }).select().single();
    if (isFounder) await admin().from('credit_ledger').insert({ user_id: req.userId, delta: 999, reason: 'grant', note: 'Founder account' });
    data = ins.data;
  }
  if (!data) return res.status(500).json({ error: 'Profile unavailable' });
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
app.get('/api/home', auth, async (req, res) => {
  const uid = req.userId;
  const out = { state: null, credits: null, myMatches: null, discover: null };
  try { out.state = await computeMeState(uid); } catch (e) {}
  try {
    const bal = await balance(uid);
    const { data: led } = await admin().from('credit_ledger').select('delta').eq('user_id', uid);
    const { data: pr } = await admin().from('profiles').select('free_case_used').eq('id', uid).single();
    const purchased = (led || []).filter(l => Number(l.delta) > 0).reduce((sm, l) => sm + Number(l.delta), 0);
    const { count: casesUsed } = await admin().from('applications').select('id', { count: 'exact', head: true }).eq('user_id', uid);
    out.credits = {
      balance: bal,
      creditsRemaining: bal + ((pr && pr.free_case_used === false) ? 1 : 0),
      casesUsed: casesUsed || 0,
      casesTotal: purchased + 1 // + the free first case
    };
  } catch (e) {}
  try {
    // Personalized: how many CURRENT verified opportunities score >=70% for THIS user.
    const { matchMany } = require('./lib/match');
    const { data: opps } = await admin().from('opportunities').select('*').eq('status', 'verified').order('created_at', { ascending: false }).limit(60);
    if (opps && opps.length) {
      const m = await matchMany(uid, opps);
      const pcts = (m || []).map(x => x.pct).filter(p => p != null);
      out.myMatches = { count70: pcts.filter(p => p >= 70).length, best: pcts.length ? Math.max(...pcts) : null, scored: pcts.length, live: opps.length };
    } else out.myMatches = { count70: 0, best: null, scored: 0, live: 0 };
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
    // Stale guard: a 'running' older than 12 minutes finished or died — report done with what exists.
    if (status === 'running' && Date.now() - new Date(v.startedAt || 0).getTime() > 12 * 60000) status = 'done';
    res.json({ status, found, target: Number(v.target) || 5, kind: v.kind || null, startedAt: v.startedAt || null });
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
/* Paywall: a user is entitled to full opportunity identity if they are staff,
   still hold their free first case, or have at least 1 credit. */
async function entitled(userId) {
  try {
    const { data: prof } = await admin().from('profiles').select('role,free_case_used').eq('id', userId).single();
    if (prof && ['admin', 'staff'].includes(prof.role)) return true;
    if (prof && prof.free_case_used === false) return true;
    return (await balance(userId)) >= 1;
  } catch (e) { return true; } // never lock everyone out on an internal error
}
/* Teaser row: everything that sells (match %, funding, stipend figures, country,
   deadline) — nothing that identifies (no institution, title, url, city, contacts). */
function lockTease(o) {
  return {
    id: o.id, kind: o.kind, country_code: o.country_code, deadline: o.deadline,
    funding: o.funding || null, funding_type: o.funding_type || null, level: o.level || null,
    stipend: o.stipend || null, tuition: o.tuition || null, salary_note: o.salary_note || null,
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
  res.json({ pricing: data });
});
app.post('/api/payments', auth, async (req, res) => {
  try { const cfg = await siteSettings.getConfig(); if (cfg.features && cfg.features.payments === false) return res.status(503).json({ error: 'Payments are temporarily unavailable. Please try again shortly.' }); } catch (e) {}
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
app.post('/api/payments/:id/confirm', auth, perm('payments.write'), async (req, res) => {
  const { data: p } = await admin().from('payments').select('*').eq('id', req.params.id).single();
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.status !== 'pending') return res.status(400).json({ error: 'Already ' + p.status });
  // Atomic: only the request that flips pending->confirmed may write the credits.
  const { data: flipped } = await admin().from('payments').update({ status: 'confirmed', confirmed_by: req.userId, confirmed_at: new Date().toISOString() }).eq('id', p.id).eq('status', 'pending').select('id');
  if (!flipped || !flipped.length) return res.status(400).json({ error: 'Already confirmed' });
  await admin().from('credit_ledger').insert({ user_id: p.user_id, delta: p.credits, reason: 'purchase', payment_id: p.id });
  await admin().from('audit_log').insert({ actor: req.userId, event: 'PAYMENT_CONFIRMED', detail: p.id + ' +' + p.credits + 'cr' });
  res.json({ ok: true });
});

/* ---------- Phase 5: payment gateways (SKELETON — inert until credentials set) ---------- */
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
  const kind = String(req.query.kind || 'study');
  const q = String(req.query.q || '').trim();
  const studyKinds = ['study', 'scholarship', 'postdoc'];
  const multi = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
  let query = admin().from('opportunities').select('*').eq('status', 'verified').limit(80);
  query = (String(req.query.sort) === 'recent') ? query.order('verified_at', { ascending: false }) : query.order('deadline', { ascending: true });
  if (kind === 'study') query = query.in('kind', studyKinds);
  else if (kind === 'scholarship') query = query.eq('kind', 'scholarship');
  else query = query.eq('kind', kind);
  // Multi-select filters (spec 16), each backed by a real column:
  const cc = multi(req.query.country).map(s => s.toUpperCase());
  if (cc.length) query = query.in('country_code', cc);
  const lvls = multi(req.query.level).filter(l => ['bachelors', 'masters', 'phd', 'postdoc'].includes(l));
  if (lvls.length) query = query.in('level', lvls);
  const fts = multi(req.query.funding_type).filter(f => ['fully', 'partial', 'self'].includes(f));
  if (fts.length) query = query.in('funding_type', fts);
  if (String(req.query.no_language_test) === '1') query = query.or('req_language.is.null,req_language.eq.none');
  if (String(req.query.has_stipend) === '1') query = query.neq('stipend', '');
  if (String(req.query.has_deadline) === '1') query = query.not('deadline', 'is', null);
  if (String(req.query.remote) === '1') query = query.eq('remote', true);
  if (String(req.query.visa) === '1') query = query.eq('visa_sponsorship', true);
  const jts = multi(req.query.job_type).filter(j => ['full_time','part_time','contract','internship'].includes(j));
  if (jts.length) query = query.in('job_type', jts);
  const exps = multi(req.query.exp).filter(x => ['entry','mid','senior'].includes(x));
  if (exps.length) query = query.in('experience_level', exps);
  if (q) query = query.textSearch('search_blob', q.split(/\s+/).join(' & '));
  let { data, error } = await query;
  if (error && /funding_type|level|req_language|column/.test(error.message || '')) {
    let q2 = admin().from('opportunities').select('*').eq('status', 'verified').order('deadline', { ascending: true }).limit(80);
    if (kind === 'study') q2 = q2.in('kind', studyKinds); else q2 = q2.eq('kind', kind);
    ({ data } = await q2);
  }
  let rows = data || [];
  // USER PROTECTION (spec 18/41): never re-show an opportunity this user already applied to.
  try {
    const { data: apps } = await admin().from('applications').select('opportunity_id').eq('user_id', req.userId);
    const applied = new Set((apps || []).map(a => a.opportunity_id));
    rows = rows.filter(o => !applied.has(o.id));
  } catch (e) {}
  // Freshness (spec 38), computed from real timestamps only.
  const now = Date.now(), day = 86400000;
  rows.forEach(o => {
    if (o.deadline && new Date(o.deadline).getTime() < now - day) o.freshness = 'deadline_passed';
    else if (o.verified_at && now - new Date(o.verified_at).getTime() < day) o.freshness = 'verified_today';
    else if (o.verified_at && now - new Date(o.verified_at).getTime() < 14 * day) o.freshness = 'verified_recently';
    else o.freshness = 'needs_reverification';
  });
  rows = rows.filter(o => o.freshness !== 'deadline_passed').slice(0, 60);
  let opportunities = rows;
  // Phase 4: annotate with match status when requested (?match=1)
  if (String(req.query.match || '') === '1' && opportunities.length) {
    try {
      const { matchMany } = require('./lib/match');
      const m = await matchMany(req.userId, opportunities);
      const byId = {}; m.forEach(x => { byId[x.id] = x; });
      opportunities = opportunities.map(o => ({ ...o, match: byId[o.id] ? { status: byId[o.id].status, pct: byId[o.id].pct } : null }));
    } catch (e) { /* matching is best-effort; never blocks the list */ }
  }
  // Mark opportunities this user has already started — one case, one cost, ever.
  try {
    const { data: mine } = await admin().from('applications').select('opportunity_id').eq('user_id', req.userId);
    const mset = new Set((mine || []).map(x => x.opportunity_id));
    if (mset.size) opportunities = opportunities.map(o => mset.has(o.id) ? { ...o, started: true } : o);
  } catch (e) {}
  // Free-preview model: after the free case is used and credits are exhausted, the list
  // still shows match strength / funding / deadline, but identity is locked until purchase.
  try {
    const { data: prof } = await admin().from('profiles').select('role,free_case_used').eq('id', req.userId).single();
    const isStaff = prof && ['admin', 'staff'].includes(prof.role);
    if (!isStaff && prof && prof.free_case_used === true) {
      const bal = await balance(req.userId);
      if (bal < 1) {
        opportunities = opportunities.map(o => lockTease(o));
      }
    }
  } catch (e) { /* on any error, fall through unlocked rather than break browsing */ }
  res.json({ opportunities });
});

/* ---------- applications: 1 credit = 1 application (consume on create) ---------- */
app.post('/api/applications', auth, async (req, res) => {
  const { opportunityId } = req.body || {};
  const { data: prof } = await admin().from('profiles').select('role,free_case_used').eq('id', req.userId).single();
  const isAdmin = prof && ['admin', 'staff'].includes(prof.role);
  // CV is the one required document before any application can be prepared.
  const { data: cvDocs } = await admin().from('documents').select('id').eq('user_id', req.userId).eq('kind', 'cv').eq('generated', false).limit(1);
  if (!isAdmin && (!cvDocs || !cvDocs.length)) {
    return res.status(400).json({ error: 'Please upload your CV first. It is the only required document, and every application is prepared from it.' });
  }
  const bal = await balance(req.userId);
  const freeAvailable = prof && prof.free_case_used === false;
  const freeUsed = prof && prof.free_case_used === true;
  if (!isAdmin && bal < 1 && !freeAvailable) {
    return res.status(402).json({
      error: freeUsed
        ? 'You have already used your one free opportunity with this account. To continue, please choose a credit package. Every case is prepared completely, end to end.'
        : 'No credits. Buy a pack to start this application.'
    });
  }
  const { data: opp } = await admin().from('opportunities').select('id,institution').eq('id', opportunityId).single();
  if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
  const usingFree = !isAdmin && bal < 1 && freeAvailable;
  const caseNo = 'FF-' + Date.now().toString(36).toUpperCase();
  const { data: appRow, error } = await admin().from('applications')
    .insert({ user_id: req.userId, opportunity_id: opp.id, case_no: caseNo, stage: 'preparing', credits_consumed: (isAdmin || usingFree) ? 0 : 1 })
    .select().single();
  if (error) return res.status(400).json({ error: error.message.includes('duplicate') ? 'You already have an application for this opportunity' : error.message });
  if (usingFree) {
    // Atomic claim: only ONE request can flip free_case_used false->true. A racing
    // duplicate gets zero rows back, and we roll its application away.
    const { data: claimed } = await admin().from('profiles').update({ free_case_used: true, free_case_used_at: new Date().toISOString() }).eq('id', req.userId).eq('free_case_used', false).select('id');
    if (!claimed || !claimed.length) {
      try { await admin().from('applications').delete().eq('id', appRow.id); } catch (e) {}
      return res.status(402).json({ error: 'Your free case was already used. Choose a credit package to continue.' });
    }
    await admin().from('credit_ledger').insert({ user_id: req.userId, delta: 0, reason: 'free_case', application_id: appRow.id, note: opp.institution + ' (free first case)' });
  } else if (!isAdmin) {
    await admin().from('credit_ledger').insert({ user_id: req.userId, delta: -1, reason: 'consume', application_id: appRow.id, note: opp.institution });
  }
  res.json({ application: appRow, freeCase: usingFree });
});
app.get('/api/applications', auth, async (req, res) => {
  const { data } = await admin().from('applications').select('*, opportunities(title,institution,country_code,deadline,url)').eq('user_id', req.userId).order('updated_at', { ascending: false });
  res.json({ applications: data || [] });
});



/* ---------- documents: upload, read, view, delete + auto profile fill ---------- */
const multer = require('multer');
const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 12 } });
const { saveUpload, signedUrl, extractProfile } = require('./lib/docs');
app.post('/api/documents', auth, up.array('files', 12), async (req, res) => {
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
    if (ok) setTimeout(() => extractProfile(req.userId).catch(e => admin().from('audit_log').insert({ actor: req.userId, event: 'AUTOFILL_FAIL', detail: String(e.message).slice(0, 200) })), 1200);
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
// Canonical document checklist — what strengthens a client's study/work case.
// Maps uploaded documents (by their classified `kind`) onto a fixed list so the
// Profile page can show a clear "have / still needed" checklist.
const DOC_CHECKLIST = [
  { key: 'cv',            label: 'CV / Resume',                 required: true,  match: ['cv'] },
  { key: 'transcript',   label: 'Academic transcripts',        required: true,  match: ['transcript'] },
  { key: 'degree',       label: 'Degree certificates',         required: true,  match: ['degree'] },
  { key: 'english_test', label: 'English test (IELTS/TOEFL/PTE)', required: true, match: ['english_test'] },
  { key: 'passport',     label: 'Passport (photo page) — optional, not needed to start', required: false, match: ['passport'] },
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
// Profile readiness — computed from real profile fields + document checklist.
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
    // opportunity is portal-only — tell the client to use the official portal instead.
    const o0 = a.opportunities || {};
    return res.status(409).json({ error: 'portal_only', portal_url: o0.url || a.portal_url || '', message: 'This opportunity applies through its official portal. Your documents are ready to attach there.' });
  }
  const { data: docs } = await admin().from('application_documents').select('id,kind,title').eq('application_id', a.id);
  const o = a.opportunities || {};
  const pkg = applyLib.buildPackage({
    applicationId: a.id, opportunityId: o.id || '',
    recipient: recipientEmail, recipientName: o.contact_name || '',
    organization: o.institution || '', subject: msg.subject || '', body: msg.body || '',
    attachments: (docs || []).map(d => ({ id: d.id, filename: applyLib.niceName(d), url: '/api/apply/doc/' + d.id + '?' + applyLib.docQuery(d.id, req.userId) }))
  });
  await admin().from('audit_log').insert({ actor: req.userId, event: 'APPLY_PACKAGE', detail: a.id });
  // Safe profile subset for the extension form-filler (Phase 2) — never documents, never credentials.
  let pr = {}; try { const { data: prof } = await admin().from('profiles').select('full_name,email,phone,city,address,last_institution,degree_level,field,cgpa,experience_years,language_scores,linkedin').eq('id', req.userId).single(); pr = prof || {}; } catch (e) {}
  pkg.profile = { full_name: pr.full_name, email: pr.email, phone: pr.phone, city: pr.city, address: pr.address,
    last_institution: pr.last_institution, degree_level: pr.degree_level, field: pr.field, cgpa: pr.cgpa,
    experience_years: pr.experience_years, language_scores: pr.language_scores, linkedin: pr.linkedin };
  res.json(pkg);
});
// Short-lived signed PDF fetch for one prepared document (used by the assistant to attach files).
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

/* ---------- saved search preferences: one search remembers the next ---------- */
app.get('/api/prefs', auth, async (req, res) => {
  try { const { data } = await admin().from('app_settings').select('value').eq('key', 'prefs:' + req.userId).single(); res.json({ prefs: (data && data.value) || null }); }
  catch (e) { res.json({ prefs: null }); }
});
app.put('/api/prefs', auth, async (req, res) => {
  const v = (req.body && req.body.prefs) || {};
  const clean = {
    kind: ['study', 'work', 'both'].includes(v.kind) ? v.kind : 'study',
    funded: !!v.funded, remote: !!v.remote, visa: !!v.visa,
    ctrys: Array.isArray(v.ctrys) ? v.ctrys.filter(c => /^[A-Za-z]{2}$/.test(String(c))).map(c => String(c).toUpperCase()).slice(0, 15) : []
  };
  try { await admin().from('app_settings').upsert({ key: 'prefs:' + req.userId, value: clean }); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
/* ---------- pipeline endpoints ---------- */
const { discoverForUser, prepareApplication } = require('./lib/engine');
app.post('/api/run', auth, (req,res,next)=>{const f=(require('./lib/settings').cache()||{}).features||{};if(f.discovery_enabled===false)return res.status(503).json({error:'Search is briefly paused for maintenance. Please try again soon.'});next();}, async (req, res) => {
  const { data: st } = await admin().from('app_settings').select('value').eq('key', 'lastRun:' + req.userId).single();
  const last = st ? new Date(st.value.at || 0) : new Date(0);
  const mins = (Date.now() - last.getTime()) / 60000;
  if (mins < 30) return res.json({ ok: true, ran: false, message: 'Searched ' + Math.round(mins) + ' min ago. Next run possible in ' + Math.ceil(30 - mins) + ' min.' });
  await admin().from('app_settings').upsert({ key: 'lastRun:' + req.userId, value: { at: new Date().toISOString() } });
  // Search preferences + package fulfillment: paid credits define how many verified
  // opportunities the agent must deliver (min 5, max 20). Priority countries are
  // searched first; comparable nearby destinations complete the set only if needed.
  const b = req.body || {};
  const prefs = {
    countries: Array.isArray(b.countries) ? b.countries.filter(c => /^[A-Za-z]{2}$/.test(String(c))).map(c => String(c).toUpperCase()).slice(0, 15) : [],
    fundedOnly: !!b.funded_only, remote: !!b.remote, target: 5
  };
  try {
    const bal = await balance(req.userId);
    const { data: pr } = await admin().from('profiles').select('free_case_used').eq('id', req.userId).single();
    prefs.target = Math.min(20, Math.max(5, (bal || 0) + ((pr && pr.free_case_used === false) ? 1 : 0)));
  } catch (e) {}
  // Server-side, resumable progress: the run continues even if the phone dies.
  const progressKey = 'discover:' + req.userId;
  prefs.progressKey = progressKey;
  prefs.startedAt = new Date().toISOString();
  try { await admin().from('app_settings').upsert({ key: progressKey, value: { status: 'running', startedAt: prefs.startedAt, kind: b.kind || null, target: prefs.target, found: 0 } }); } catch (e) {}
  res.json({ ok: true, ran: true, message: 'Searching official sources now. Verified opportunities appear within 2 to 3 minutes.' });
  require('./lib/jobs').runJob('discover', 'discover:' + req.userId + ':' + Math.floor(Date.now()/1800e3), req.userId, () =>
    discoverForUser(req.userId, b.kind, prefs)
      .then(async n => { try { await admin().from('app_settings').upsert({ key: progressKey, value: { status: 'done', startedAt: prefs.startedAt, kind: b.kind || null, target: prefs.target, found: n } }); } catch (e) {} return n; })
      .catch(async e => { try { await admin().from('app_settings').upsert({ key: progressKey, value: { status: 'error', startedAt: prefs.startedAt, kind: b.kind || null, target: prefs.target, message: String(e.message).slice(0, 160) } }); } catch (e2) {} throw e; }),
    { retries: 1, timeoutMs: 600000 });
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
/* Admin corridor seeding — weakness #1: fill real inventory before launch. */
app.post('/api/admin/seed', auth, perm('countries.write'), aiLimit, async (req, res) => {
  const { kind, query } = req.body || {};
  if (!query || String(query).length < 8) return res.status(400).json({ error: 'Give a corridor query, e.g. "fully funded masters Germany"' });
  res.json({ ok: true, message: 'Seeding started. Verified results appear within 2-3 minutes.' });
  const { seedDiscovery } = require('./lib/engine');
  seedDiscovery(String(kind || ''), String(query).slice(0, 200), req.userId).then(n => console.log('[seed]', n, 'added')).catch(e => console.error('[seed]', e.message));
});
/* Real job status — weakness #3: the UI polls this until preparation truly finishes. */
app.get('/api/applications/:id/status', auth, async (req, res) => {
  const { data: a } = await admin().from('applications').select('id,user_id,stage,next_action,updated_at,prep_progress,prep_started_at').eq('id', req.params.id).single();
  if (!a || a.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  const steps = a.prep_progress || [];
  let failed = steps.some(st => st.error);
  let eta = 'Usually takes a few minutes.';
  // Stall guard: preparing for over 9 minutes with no error recorded means the run hung or
  // timed out. Surface Retry — finished documents are kept, so a retry costs almost nothing.
  if (!failed && a.stage === 'preparing' && a.prep_started_at && Date.now() - new Date(a.prep_started_at).getTime() > 9 * 60000) {
    failed = true;
    eta = 'This took longer than usual. Press Retry — completed documents are kept, nothing is generated twice.';
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
  // Idempotent: a fully prepared case is NEVER re-run — zero extra AI cost, instant answer.
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
  let { data: docs } = await admin().from('application_documents').select('id,kind,title,content,status').eq('application_id', a.id).then(r => r, async () => await admin().from('application_documents').select('id,kind,title,content').eq('application_id', a.id));
  const { data: msgs } = await admin().from('messages').select('*').eq('application_id', a.id).order('created_at', { ascending: false });
  res.json({ application: a, documents: docs || [], messages: msgs || [] });
});
/* ---------- Spec 27: case editor — edit/rename/approve documents, case notes ---------- */
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
  res.json({ ok: true, note: 'Authorized. Press APPLY to open it in your own email — you review and press Send.' });
});

const PORT = process.env.PORT || 3000;
app.use((err, req, res, next) => {
  errlog('http', err, { requestId: req.reqId, userId: req.userId });
  if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on our side. Our team has been notified — please try again.', ref: req.reqId });
});
process.on('unhandledRejection', e => console.error('[rejection]', e && e.message));
try { const { expireAgent } = require('./lib/agents'); setInterval(() => expireAgent().catch(e=>console.error('[expire]',e.message)), 12*3600e3); setTimeout(()=>expireAgent().catch(()=>{}), 60e3); } catch (e) {}
// Boot sweeper: a restart mid-job leaves rows stuck 'running' forever. Sweep them
// to 'failed' so retries work and the failed-jobs metric stays truthful.
(async () => { try { await admin().from('jobs').update({ status: 'failed', last_error: 'server restarted mid-job', updated_at: new Date().toISOString() }).eq('status', 'running'); } catch (e) {} })();
app.listen(PORT, () => {
  console.log('ForiForeign core on :' + PORT);
  try { require('./lib/agents').startAgents(); } catch (e) { console.error('[agents]', e.message); }
});
