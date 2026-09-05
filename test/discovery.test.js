/* PHASE 4 · DISCOVERY, DEDUPLICATION, VERIFICATION AND MATCHING — executed on the in-memory database (ingest path) plus pure unit checks.
   Proves: URL variants, tracking parameters, title punctuation, source and repeated imports collapse to one row; expired and invalid
   postings are rejected; an unreachable official page is stored as PENDING (never 'verified'); Explore hides pending and legacy duplicates;
   matching: exact, partial, mismatch, missing profile, work-vs-study level rule, partner priority; no score inflation. */
const { spawn } = require('child_process'); const PORT = 4495; const BASE = 'http://127.0.0.1:' + PORT;
const env = Object.assign({}, process.env, { NODE_ENV: 'test', FF_MEMDB: '1', FF_QUEUE: 'off', PORT: String(PORT), SUPABASE_URL: 'https://memdb.local', SUPABASE_ANON_KEY: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', ANTHROPIC_API_KEY: 'x', GEMINI_API_KEY: 'x', FF_DATA_KEY: '0000000000000000000000000000000000000000000000000000000000000001' });
const U = 'a4a4a4a4-0000-4000-8000-000000000d01'; const tok = 'test:' + U + ':d@test.local';
async function req(p, { method = 'GET', body } = {}) { const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j }; }
(async () => {
  let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x ? '  → ' + JSON.stringify(x).slice(0, 240) : '')); } };
  // ---- unit: identity ----
  const K = require('../lib/oppkey.js');
  ok('URL variants share one key (scheme, www, trailing slash, index.html, utm/fbclid/ref, fragment)', new Set(['http://www.Example.org/jobs/123/?utm_source=x&ref=li#apply', 'https://example.org/jobs/123', 'https://example.org/jobs/123/index.html?fbclid=abc', 'HTTPS://EXAMPLE.ORG:443/jobs//123/'].map(K.canonicalUrl)).size === 1);
  ok('meaningful query strings are kept', K.canonicalUrl('https://x.org/job?id=5') !== K.canonicalUrl('https://x.org/job?id=6'));
  const fp = o => K.fingerprintOf(o); ok('title punctuation, reference codes and org suffixes do not change the fingerprint; deadline and source never do', fp({ institution: 'Alpha NHS Trust', title: 'Registered Nurse (Band 5) - Ref: 1234', country_code: 'gb', kind: 'work', source: 'adzuna', deadline: '2026-10-01' }) === fp({ institution: 'The Alpha NHS Trust Ltd', title: 'Registered Nurse Band 5', country_code: 'GB', kind: 'work', source: 'agent', deadline: '2026-12-01' }));
  ok('a different role is a different posting', fp({ institution: 'Alpha', title: 'Senior Nurse', country_code: 'GB', kind: 'work' }) !== fp({ institution: 'Alpha', title: 'Registered Nurse', country_code: 'GB', kind: 'work' }));
  ok('study: the level is part of the identity', fp({ institution: 'Beta University', title: 'Pharmacy', country_code: 'DE', kind: 'study', level: 'masters' }) !== fp({ institution: 'Beta University', title: 'Pharmacy', country_code: 'DE', kind: 'study', level: 'phd' }));
  // ---- unit: matching ----
  const M = require('../lib/match.js'); const P = { degree_level: 'masters', field: 'pharmacy', experience_years: 4, total_experience_years: 4, language_tests: [{ test: 'IELTS', score: '7' }], headline: 'Pharmacist, MPhil' }; const facts = { _profile: P, _docKinds: new Set(['cv']), highest_degree: { value: 'MPhil Pharmacology' }, field: { value: 'pharmacy' } };
  const exact = { id: '1', title: 'Pharmacist', institution: 'X', country_code: 'GB', kind: 'work', req_degree_level: 'bachelors', req_field: 'pharmacy', requirements: '2 years experience; IELTS 6.5' };
  const partial = { id: '2', title: 'Senior Pharmacist', institution: 'X', country_code: 'GB', kind: 'work', req_degree_level: 'masters', req_field: 'pharmacy', requirements: '8 years of experience required; IELTS 7.5 required' };
  const mismatch = { id: '3', title: 'Civil Engineer', institution: 'X', country_code: 'GB', kind: 'work', req_degree_level: 'bachelors', req_field: 'civil engineering' };
  const e = M.evaluate(exact, facts), pmatch = M.evaluate(partial, facts), mm = M.evaluate(mismatch, facts), empty = M.evaluate(exact, { _profile: {}, _docKinds: new Set() });
  ok('exact match → eligible, high pct', e.status === 'eligible' && e.pct >= 85, e);
  ok('BUG-008: a work posting asking a lower degree is never "below your level"', e.status !== 'below_your_level');
  ok('partial match → not eligible with the two shortfalls named (experience 4<8, IELTS 7<7.5)', pmatch.status === 'not_eligible' && pmatch.reasons.some(r => /8\+ years/.test(r.text) && r.ok === 'no') && pmatch.reasons.some(r => /IELTS 7\.5/.test(r.text) && r.ok === 'no'), pmatch.reasons);
  ok('clear mismatch → field_mismatch, no percentage', mm.status === 'field_mismatch' && mm.pct == null, mm);
  ok('missing profile → needs_profile, no invented percentage', empty.status === 'needs_profile' && empty.pct == null, empty);
  const partner = M.evaluate(Object.assign({}, exact, { is_partner: true }), facts); ok('partner priority: +6 within the cap and the reason is stated', partner.pct === Math.min(100, e.pct + 6) && /Partner/.test(partner.reasons[0]), partner.pct);
  ok('study rule intact: a master\'s holder is "below your level" for a master\'s programme', M.evaluate({ id: '4', title: 'MSc Pharmacy', kind: 'study', level: 'masters', country_code: 'DE' }, facts).status === 'below_your_level');
  // ---- runtime: ingest on memdb ----
  const child = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 250)); try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch (e) {} }
  await req('/__memdb/seed', { method: 'POST', body: { reset: true, rows: { profiles: [{ id: U, email: 'd@test.local', role: 'user', full_name: 'D' }] } } });
  const items = [
    { title: 'Registered Nurse (Band 5) - Ref: 1234', institution: 'Alpha NHS Trust', country_code: 'GB', url: 'http://www.example.invalid/jobs/1?utm_source=a', deadline: '2099-01-01', funding: '' },
    { title: 'Registered Nurse Band 5', institution: 'The Alpha NHS Trust Ltd', country_code: 'GB', url: 'https://example.invalid/jobs/1/', deadline: '2099-06-01', funding: '' },
    { title: 'Registered Nurse Band 5', institution: 'Alpha NHS Trust', country_code: 'GB', url: 'https://example.invalid/jobs/1?fbclid=zz', deadline: '2099-06-01', funding: '' },
    { title: 'Senior Nurse', institution: 'Alpha NHS Trust', country_code: 'GB', url: 'https://example.invalid/jobs/2', deadline: '2020-01-01', funding: '' },
    { title: 'Nurse', institution: 'Beta Hospital', country_code: 'GB', url: 'not a url', deadline: '2099-01-01', funding: '' }];
  const r = await req('/__memdb/ingest', { method: 'POST', body: { kind: 'work', items } });
  ok('ingest ran', r.status === 200 && r.body && r.body.ok, r);
  const rows = (await req('/__memdb/rows?table=opportunities')).body.rows || [];
  ok('three variants of the same posting → ONE row (URL variants + title/org variants)', rows.filter(o => /nurse band 5|registered nurse/i.test(o.title || '')).length === 1, rows.map(o => [o.title, o.url_key]));
  ok('expired posting rejected', !rows.some(o => o.title === 'Senior Nurse'));
  ok('invalid URL rejected', !rows.some(o => o.institution === 'Beta Hospital'));
  const one = rows.find(o => /registered nurse/i.test(o.title || '')) || {}; ok('unreachable official page → status PENDING with a note, never "verified"', one.status === 'pending' && !one.verified_at && /not reachable/.test(one.verify_note || ''), [one.status, one.verified_at, one.verify_note]);
  ok('url_key and fingerprint stored', !!one.url_key && !!one.fingerprint, one);
  const ex = await req('/api/explore?kind=work&cc=GB'); ok('Explore does not show a pending (unverified) posting', ex.status === 200 && !(ex.body.rows || []).some(x => x.id === one.id), (ex.body.rows || []).map(x => x.id));
  // legacy duplicates already in the table collapse in Explore
  await req('/__memdb/seed', { method: 'POST', body: { rows: { opportunities: [{ id: 'f9f9f9f9-0000-4000-8000-000000000001', title: 'Pharmacist', institution: 'Gamma', country_code: 'AE', kind: 'work', status: 'verified', verified_at: '2026-09-01', url: 'https://gamma.invalid/p/1' }, { id: 'f9f9f9f9-0000-4000-8000-000000000002', title: 'Pharmacist', institution: 'Gamma', country_code: 'AE', kind: 'work', status: 'verified', verified_at: '2026-09-02', url: 'https://www.gamma.invalid/p/1/?utm_campaign=x' }] } } });
  const ex2 = await req('/api/explore?kind=work&cc=AE'); ok('legacy duplicate rows collapse to one card in Explore', ex2.status === 200 && (ex2.body.rows || []).filter(x => x.institution === 'Gamma' || /Gamma/.test(JSON.stringify(x))).length <= 1 && (ex2.body.rows || []).length === 1, (ex2.body.rows || []).length);
  // provider failure: a discovery source that throws must not take the run down (ingest of an empty/invalid batch is a no-op)
  const r2 = await req('/__memdb/ingest', { method: 'POST', body: { kind: 'work', items: null } }); ok('a failed/empty source batch is a no-op, not a crash', r2.status === 200, r2);
  console.log('\ndiscovery: ' + pass + ' pass / ' + fail + ' fail'); child.kill(); process.exit(fail ? 1 : 0);
})();
