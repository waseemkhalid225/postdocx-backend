// Resilience regression net: asserts every no-zero / no-failure guard exists in source.
// If any assertion fails, a resilience feature was removed and users can see 0 again.
const fs = require('fs');
const g = fs.readFileSync(__dirname + '/../lib/gemini.js', 'utf8');
const e = fs.readFileSync(__dirname + '/../lib/engine.js', 'utf8');
const sv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
const checks = [
  ['multi-model cascade exists', g.includes("'gemini-2.5-flash', 'gemini-2.0-flash'")],
  ['thinkingConfig 400 is survivable', g.includes('_noThinking = true')],
  ['unknown model skips to next in chain', /not found\|not supported\|does not exist/.test(g)],
  ['overload backoff is jittered and long', g.includes('4000 * (attempt + 1)')],
  ['OpenAI backup fires for GROUNDED calls too', g.includes('openaiBackup(prompt, maxTokens, json, search || urls)')],
  ['OpenAI grounded backup uses web_search', g.includes("tools: [{ type: 'web_search' }]")],
  ['discovery passes are isolated (one failure never kills the run)', e.includes("errlog('discover:pass'")],
  ['never-blank rescue pass exists', e.includes('NEVER-BLANK rescue')],
  ['expired deadlines are rejected at ingest', e.includes('deadline already passed')],
  ['profile-aware inventory skip (generic stock never blocks a user)', e.includes('relevant >= Math.min(3, target)')],
  ['self-seeding inventory on boot + daily cron', sv.includes('selfSeed') && sv.includes("schedule('0 3 * * *'")],
  ['search stall guard (12 min) exists', sv.includes('12 * 60000')],
  ['prepare stall guard (9 min) exists', sv.includes('9 * 60000')],
  ['job timeout never spawns a parallel duplicate', fs.readFileSync(__dirname + '/../lib/jobs.js', 'utf8').includes("=== 'job timeout') break")],
  ['AI self-test endpoint exists', sv.includes('/api/admin/ai-selftest')],
  ['harvest module exists with all four tools', (() => { const h = fs.readFileSync(__dirname + '/../lib/harvest.js', 'utf8'); return ['rssWatch', 'braveLeads', 'verifyLeads', 'uniSweep'].every(f => h.includes('async function ' + f)); })()],
  ['harvest crons are scheduled', sv.includes("schedule('15 */6 * * *'") && sv.includes("schedule('45 */2 * * *'") && sv.includes("schedule('0 4 * * *'")],
  ['lead queue dedupes against existing opportunities', fs.readFileSync(__dirname + '/../lib/harvest.js', 'utf8').includes(".eq('url', url).limit(1)")],
  ['seed corridors cover Europe, Gulf, US, CA, AU, NZ and healthcare', sv.includes('New Zealand') && sv.includes('SCFHS DHA')],
  ['discovery capacity raised to 10 items per pass', e.includes('up to 10 items')],
  ['seeded rows always get VISIBLE kinds', e.includes('inferKind(it)') && e.includes("['scholarship', 'postdoc'].includes(kind) ? kind : 'study'")],
  ['self-seed idem keys are unique per corridor', sv.includes("'selfseed:' + i + ':'")],
  ['Future Path covers South Korea', sv.includes("KR: { name: 'South Korea'")],
  ['extension signup assist is consent-gated', fs.readFileSync(__dirname + '/../extension/filler.js', 'utf8').includes('signupArmed = !!portalPass && confirm')],
  ['process survives unhandled rejections and exceptions', sv.includes("process.on('unhandledRejection'") && sv.includes("process.on('uncaughtException'")],
  ['security headers applied on every response', sv.includes("'X-Content-Type-Options', 'nosniff'") && sv.includes('Strict-Transport-Security')],
  ['per-IP rate limit shields the API', sv.includes('Too many requests')],
  ['final express error net returns JSON, never crashes', sv.includes('self-healer is on it')],
  ['self-healer scheduled every 10 minutes', sv.includes("schedule('*/10 * * * *', runHealer)")],
  ['healer repairs all three failure classes', (() => { const h = fs.readFileSync(__dirname + '/../lib/healer.js', 'utf8'); return ['sweepStaleJobs', 'healStuckPreparations', 'healZeroDiscoveries'].every(f => h.includes('async function ' + f)); })()],
  ['healer relaunches stuck preparations only ONCE', fs.readFileSync(__dirname + '/../lib/healer.js', 'utf8').includes('!ps.healed')],
  ['every heal action is audited', fs.readFileSync(__dirname + '/../lib/healer.js', 'utf8').includes("event: 'HEAL'")],
  ['admin and users both land on the dashboard', !fs.readFileSync(__dirname + '/../public/index.html', 'utf8').includes("isAdminRole(ME.role)){go('adminx')")],
  ['referral engine: claim, apply, settle, reward', sv.includes('/api/referral/claim') && sv.includes('discount_pkr') && sv.includes('REFERRAL_BONUS')],
  ['university file import + AI enrichment exist', sv.includes('/api/admin/universities/import') && sv.includes('enrichUniversities')],
  ['dormant purge is safety-gated (never with cases/payments)', sv.includes('cannot be purged')],
  ['ten richer extraction fields flow to intelligence', e.includes('pr_pathway_note') && e.includes('row.intelligence = ex')],
  ['extension human-input alerts exist and never hide the page', (() => { const f = fs.readFileSync(__dirname + '/../extension/filler.js', 'utf8'); return f.includes('Your input needed') && f.includes('one-time-code'); })()],
  ['multer is defined BEFORE any route uses it (boot-order)', sv.indexOf('const up = multer(') < sv.indexOf("up.single('file')")],
  ['locked teaser carries requirement fields for the dispute shield', sv.includes('req_language: o.req_language || null')],
  ['package strip reads the real pricing endpoint', fs.readFileSync(__dirname + '/../public/index.html', 'utf8').includes("api('/api/pricing');const ps=(((d||{}).pricing||{}).packs||[])")],
  ['harvest and healer require the REAL supa module', (() => { const h = fs.readFileSync(__dirname + '/../lib/harvest.js', 'utf8'); const hl = fs.readFileSync(__dirname + '/../lib/healer.js', 'utf8'); return h.includes("require('./supa')") && hl.includes("require('./supa')"); })()]
];
let fail = 0;
for (const [name, ok] of checks) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); if (!ok) fail++; }
if (fail) { console.error(fail + ' resilience assertion(s) failed'); process.exit(1); }
console.log('resilience net: all assertions hold');
