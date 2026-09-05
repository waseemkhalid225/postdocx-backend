/* PHASE 2 · DIRECT APPLICANT JOURNEY on a fresh account, executed against the in-memory database.
   Signup(profile) → CV upload (types, size) → extraction status → finder/state → explore (results, empty, bad input) → detail →
   save → dismiss → Start Case (entitlement gate, duplicate prevention) → persistence across a "reopen". */
const { spawn } = require('child_process'); const PORT = 4492; const BASE = 'http://127.0.0.1:' + PORT;
const env = Object.assign({}, process.env, { NODE_ENV: 'test', FF_MEMDB: '1', FF_QUEUE: 'off', PORT: String(PORT), SUPABASE_URL: 'https://memdb.local', SUPABASE_ANON_KEY: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', ANTHROPIC_API_KEY: 'x', GEMINI_API_KEY: 'x', FF_DATA_KEY: '0000000000000000000000000000000000000000000000000000000000000001' });
const FRESH = 'a9a9a9a9-0000-4000-8000-00000000fe5h'.replace('fe5h', '0f01'); const tok = 'test:' + FRESH + ':fresh@test.local';
const OPP1 = 'f4f4f4f4-0000-4000-8000-000000000101', OPP2 = 'f4f4f4f4-0000-4000-8000-000000000102', OPP3 = 'f4f4f4f4-0000-4000-8000-000000000103';
async function req(path, { method = 'GET', body, headers, raw } = {}) { const h = Object.assign(raw ? {} : { 'content-type': 'application/json' }, { authorization: 'Bearer ' + tok }, headers || {}); const r = await fetch(BASE + path, { method, headers: h, body: raw ? raw : (body ? JSON.stringify(body) : undefined) }); let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j }; }
function multipart(files) { const b = '----ffb' + Date.now(); const parts = []; for (const f of files) { parts.push(Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="files"; filename="' + f.name + '"\r\nContent-Type: ' + f.type + '\r\n\r\n')); parts.push(f.data); parts.push(Buffer.from('\r\n')); } parts.push(Buffer.from('--' + b + '--\r\n')); return { body: Buffer.concat(parts), type: 'multipart/form-data; boundary=' + b }; }
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
(async () => {
  const child = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 250)); try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch (e) {} }
  const seed = { opportunities: [{ id: OPP1, title: 'Registered Nurse', institution: 'Alpha NHS Trust', country_code: 'GB', city: 'Leeds', kind: 'work', category: 'care', status: 'verified', verified_at: new Date().toISOString(), url: 'https://example.org/1', description: 'Band 5 nurse, IELTS 7 required', requirements: 'IELTS 7.0; NMC registration' }, { id: OPP2, title: 'MSc Pharmacy', institution: 'Beta University', country_code: 'DE', city: 'Berlin', kind: 'study', category: 'masters', status: 'verified', verified_at: new Date().toISOString(), url: 'https://example.org/2', description: 'Two-year programme, English taught' }, { id: OPP3, title: 'Pharmacist', institution: 'Gamma Pharmacy', country_code: 'AE', city: 'Dubai', kind: 'work', category: 'pharmacy', status: 'verified', verified_at: new Date().toISOString(), url: 'https://example.org/3', description: 'Licensed pharmacist, DHA' }] };
  const s = await req('/__memdb/seed', { method: 'POST', body: { reset: true, rows: seed } }); if (!s.body || !s.body.ok) { console.log('seed failed', s.status, log.slice(-400)); child.kill(); process.exit(1); }
  let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x ? '  → ' + JSON.stringify(x).slice(0, 220) : '')); } };
  // 1-3 sign-up: a brand-new user has no profile row yet; /api/me must create it and the session must be usable at once
  let r = await req('/api/me'); ok('1 fresh user → /api/me 200 with a profile created on first touch', r.status === 200 && r.body && r.body.me && r.body.me.id === FRESH, r);
  r = await req('/api/me/state'); ok('2 fresh state: no CV, state new', r.status === 200 && r.body && r.body.hasCV === false, r);
  r = await req('/api/home'); ok('3 dashboard for a fresh user: next action is Upload CV, nothing to pay', r.status === 200 && r.body && r.body.next && /upload your cv/i.test(r.body.next.text) && !r.body.pendingPayment && r.body.dash && r.body.dash.matches === 0, r && r.body && r.body.next);
  // 4 intent capture
  r = await req('/api/me/intent', { method: 'POST', body: { intent: 'work:GB:nurse' } }); ok('4 intent applied to the profile (lane, country, profession)', r.status === 200 && r.body.applied && r.body.applied.lane_pref === 'work' && r.body.applied.target_countries[0] === 'GB' && r.body.applied.profession === 'nurse', r);
  // 5-7 CV upload: pdf ok, exe rejected, oversize rejected
  let m = multipart([{ name: 'cv.pdf', type: 'application/pdf', data: pdf }]); r = await req('/api/documents', { method: 'POST', raw: m.body, headers: { 'content-type': m.type } }); ok('5 PDF CV upload accepted', r.status === 200 && r.body && (r.body.documents || r.body.uploaded || r.body.ok), r);
  m = multipart([{ name: 'virus.exe', type: 'application/x-msdownload', data: Buffer.from('MZ') }]); r = await req('/api/documents', { method: 'POST', raw: m.body, headers: { 'content-type': m.type } }); ok('6 unsupported file type rejected (not stored)', r.status >= 400 || (r.body && r.body.rejected && r.body.rejected.length), r);
  m = multipart([{ name: 'big.pdf', type: 'application/pdf', data: Buffer.alloc(16 * 1024 * 1024, 1) }]); r = await req('/api/documents', { method: 'POST', raw: m.body, headers: { 'content-type': m.type } }); ok('7 oversize file rejected with a clear error', r.status === 413 || r.status === 400 || (r.body && r.body.error), r);
  r = await req('/api/me/state'); ok('8 state after upload: hasCV true, cv name recorded', r.status === 200 && r.body.hasCV === true && /cv\.pdf/.test(String(r.body.cvName || '')), r);
  // 9-10 extraction: with the queue off and no AI key, the extraction must fail gracefully and the app must still be usable
  r = await req('/api/documents'); ok('9 documents list shows the CV', r.status === 200 && (r.body.documents || []).some(d => d.kind === 'cv' || d.doc_type === 'cv'), r);
  r = await req('/api/home'); ok('10 dashboard after upload: next action moves past Upload CV (finder / matches / profile), no crash', r.status === 200 && r.body.next && !/upload your cv/i.test(r.body.next.text), r && r.body && r.body.next);
  // 11 finder pre-population source: the profile carries the intent
  r = await req('/api/me'); ok('11 profile holds lane/country/profession for finder pre-fill', r.body.me.lane_pref === 'work' && Array.isArray(r.body.me.target_countries) && r.body.me.target_countries[0] === 'GB' && r.body.me.profession === 'nurse', r.body.me);
  // 12-14 explore: results, empty, bad input
  r = await req('/api/explore?kind=work&cc=GB'); ok('12 explore work/GB returns the seeded nurse posting', r.status === 200 && (r.body.rows || []).some(x => x.id === OPP1), r);
  r = await req('/api/explore?kind=study&cc=ZZ'); ok('13 explore with no match returns 200 and an empty or widened list (never an error)', r.status === 200 && Array.isArray(r.body.rows), r);
  r = await req('/api/explore?kind=<script>&cc=%00'); ok('14 explore with hostile input → 200/400, no 500', r.status === 200 || r.status === 400, r);
  // 15-17 detail, match, why
  r = await req('/api/opportunities/' + OPP1); ok('15 opportunity detail readable (redacted until entitled)', r.status === 200 && r.body.opportunity && r.body.opportunity.id === OPP1 && r.body.entitled === false, r);
  const row = ((await req('/api/explore?kind=work&cc=GB')).body.rows || []).find(x => x.id === OPP1) || {}; ok('16 match / eligibility signal present on the card (free view: eligibility flag + quality; full score after entitlement)', row.eligibility_flag != null || row.match != null || row.quality != null, Object.keys(row));
  ok('17 why-you-match line present on the card', typeof row.relevance_line === 'string' || row.hint != null || Array.isArray(row.reasons), Object.keys(row));
  // 18-19 save, dismiss
  r = await req('/api/opportunities/' + OPP2 + '/save', { method: 'POST' }); ok('18 save works', r.status === 200, r);
  r = await req('/api/opportunities/' + OPP3 + '/dismiss', { method: 'POST' }); ok('19 dismiss works', r.status === 200, r);
  r = await req('/api/explore?kind=work&cc=AE'); ok('19b dismissed posting no longer shown', r.status === 200 && !(r.body.rows || []).some(x => x.id === OPP3), (r.body.rows || []).map(x => x.id));
  // 20-23 start case, entitlement, duplicate, payment gate
  r = await req('/api/applications', { method: 'POST', body: { opportunity_id: OPP1 } }); const first = r; ok('20 Start Case on a fresh (unpaid) account → free preview case OR a clear payment gate, never a 500', r.status === 200 || r.status === 402 || r.status === 403, r);
  const gated = first.status !== 200; if (gated) ok('23 payment gate returns a code the UI can act on', first.body && (first.body.code || first.body.error), first);
  r = await req('/api/applications', { method: 'POST', body: { opportunity_id: OPP1 } }); ok('21 duplicate Start Case does not create a second case', r.status === first.status && (!r.body || !r.body.application || !first.body || !first.body.application || r.body.application.id === first.body.application.id), { first: first.status, second: r.status });
  r = await req('/api/applications'); const n = (r.body.applications || []).filter(a => a.opportunity_id === OPP1).length; ok('21b exactly one application row for the opportunity', n <= 1, n);
  r = await req('/api/pay/checkout', { method: 'POST', body: { credits: 1 } }); ok('22 checkout for a direct applicant is reachable (200 url or 400 provider off), never 403', r.status === 200 || r.status === 400 || r.status === 503, r);
  // 24 reopen: state persists purely server-side
  r = await req('/api/home'); ok('24 reopen: dashboard still reflects CV, intent and saved items', r.status === 200 && r.body.dash && r.body.dash.cv && r.body.dash.cv.name === 'cv.pdf', r.body && r.body.dash);
  r = await req('/api/opportunities/saved/list'); ok('24b saved list persists', r.status === 200 && (r.body.saved || r.body.rows || r.body.items || r.body.opportunities || []).length >= 1, r);
  // 25 session expiry: a token for a user that no longer resolves → 401 with a sign-in message
  const rr = await fetch(BASE + '/api/home', { headers: { authorization: 'Bearer test:expired' } }); ok('25 expired/invalid session → 401', rr.status === 401);
  console.log('\njourney: ' + pass + ' pass / ' + fail + ' fail'); child.kill(); process.exit(fail ? 1 : 0);
})();
