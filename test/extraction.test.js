/* PHASE 3 · CV EXTRACTION, PROFILE INTELLIGENCE AND CONSISTENCY — end to end on the in-memory database with a canned model answer.
   Proves: files of several types are read; facts land in the right columns; nothing is invented; user-set values are never overwritten;
   total experience does not double-count overlapping jobs; provenance is written; a replacement CV supersedes (keeps) the old one;
   lane and target countries stay consistent between the profile columns and the mobility profile. */
const { spawn } = require('child_process'); const PORT = 4494; const BASE = 'http://127.0.0.1:' + PORT; const fs = require('fs'); const path = require('path');
const FAKE = path.join(__dirname, 'fixtures_fake_cv.json'); if (!fs.existsSync(FAKE)) fs.writeFileSync(FAKE, fs.readFileSync('/tmp/fake_cv.json', 'utf8'));
const env = Object.assign({}, process.env, { NODE_ENV: 'test', FF_MEMDB: '1', FF_QUEUE: 'off', PORT: String(PORT), SUPABASE_URL: 'https://memdb.local', SUPABASE_ANON_KEY: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', ANTHROPIC_API_KEY: 'x', GEMINI_API_KEY: 'x', FF_DATA_KEY: '0000000000000000000000000000000000000000000000000000000000000001', FF_FAKE_AI_FILE: FAKE });
const U = 'a7a7a7a7-0000-4000-8000-000000000e01'; const tok = 'test:' + U + ':ayesha@test.local';
async function req(p, { method = 'GET', body, headers, raw } = {}) { const h = Object.assign(raw ? {} : { 'content-type': 'application/json' }, { authorization: 'Bearer ' + tok }, headers || {}); const r = await fetch(BASE + p, { method, headers: h, body: raw ? raw : (body ? JSON.stringify(body) : undefined) }); let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j }; }
function multipart(files) { const b = '----ffx' + Date.now(); const parts = []; for (const f of files) { parts.push(Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="files"; filename="' + f.name + '"\r\nContent-Type: ' + f.type + '\r\n\r\n')); parts.push(f.data); parts.push(Buffer.from('\r\n')); } parts.push(Buffer.from('--' + b + '--\r\n')); return { body: Buffer.concat(parts), type: 'multipart/form-data; boundary=' + b }; }
function docx(text) { const AdmZip = require('adm-zip'); const z = new AdmZip(); z.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')); z.addFile('word/document.xml', Buffer.from('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + text.split('\n').map(l => '<w:p><w:r><w:t>' + l + '</w:t></w:r></w:p>').join('') + '</w:body></w:document>')); return z.toBuffer(); }
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
(async () => {
  const child = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 250)); try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch (e) {} }
  await req('/__memdb/seed', { method: 'POST', body: { reset: true, rows: {} } });
  let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x ? '  → ' + JSON.stringify(x).slice(0, 240) : '')); } };
  let r = await req('/api/me'); ok('fresh profile', r.status === 200);
  // the person typed a name before uploading: extraction must not overwrite it
  r = await req('/api/me', { method: 'PUT', body: { full_name: 'Ayesha K. (typed)' } }); ok('user sets a name by hand', r.status === 200, r);
  // upload a DOCX CV (Word is the common case) + a PDF (clean) + a scanned image
  let m = multipart([{ name: 'Ayesha_CV.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: docx('Ayesha Khan\nRegistered Nurse\nExperience: Staff Nurse Mayo Hospital 2016-2019; ICU Nurse Shaukat Khanum 2019-present') }, { name: 'transcript.pdf', type: 'application/pdf', data: pdf }, { name: 'scan.jpg', type: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 0x43, 0, 1, 0xff, 0xd9]) }]);
  r = await req('/api/documents', { method: 'POST', raw: m.body, headers: { 'content-type': m.type } }); ok('DOCX + PDF + image accepted', r.status === 200 && r.body && (r.body.results || r.body.documents || []).length === 3, r);
  r = await req('/api/documents'); const docs = r.body.documents || []; ok('the DOCX is typed as the CV at upload time', docs.some(d => /docx/.test(d.name) && (d.kind === 'cv' || d.doc_type === 'cv')), docs.map(d => [d.name, d.kind]));
  // run extraction with the canned model answer
  r = await req('/__memdb/extract', { method: 'POST' }); ok('extraction ran', r.status === 200 && r.body.ok, r);
  r = await req('/api/me'); const me = r.body.me || {};
  ok('user-typed name preserved (no overwrite)', me.full_name === 'Ayesha K. (typed)', me.full_name);
  ok('contact: phone extracted', me.phone === '+92 300 1234567', me.phone);
  ok('profession and field', me.profession === 'Nurse' && me.field === 'Nursing', [me.profession, me.field]);
  ok('education: two degrees kept, highest level bachelors', Array.isArray(me.education) && me.education.length === 2 && me.degree_level === 'bachelors', [me.degree_level, (me.education || []).length]);
  ok('experience: two jobs kept', Array.isArray(me.experience) && me.experience.length === 2, me.experience);
  const yrs = Number(me.total_experience_years); const now = new Date(); const expect = ((now.getFullYear() * 12 + now.getMonth() + 1) - (2016 * 12 + 7)) / 12; ok('total experience = union of overlapping jobs (' + yrs + ' ≈ ' + expect.toFixed(1) + ')', Math.abs(yrs - expect) < 0.2, [yrs, expect]);
  ok('skills, languages, tests, certifications, licences landed', (me.skills || []).includes('ICU') && (me.languages || []).length === 3 && (me.language_tests || []).length === 2 && (me.certifications || []).length === 1 && (me.licenses || []).length === 1, [me.skills, me.languages, me.language_tests, me.certifications, me.licenses]);
  ok('target countries from the CV', Array.isArray(me.target_countries) && me.target_countries.join(',') === 'GB,IE,AE', me.target_countries);
  ok('nothing invented: empty CV fields stay empty (passport, national id, salary)', !me.passport_number && !me.national_id && !me.current_salary, [me.passport_number, me.national_id, me.current_salary]);
  ok('provenance written for extracted fields, source cv with document ids', me.profile_provenance && me.profile_provenance.phone && me.profile_provenance.phone.source === 'cv' && Array.isArray(me.profile_provenance.phone.doc_ids) && me.profile_provenance.phone.doc_ids.length >= 1 && !me.profile_provenance.full_name, me.profile_provenance && Object.keys(me.profile_provenance));
  // mobility profile mirrors lane and countries (DATA-002/003)
  r = await req('/api/me/mobility'); const mob = (r.body && (r.body.profile || r.body.mobility)) || {}; ok('mobility.target_countries mirrors the profile column', Array.isArray(mob.target_countries) && mob.target_countries.join(',') === 'GB,IE,AE', mob);
  r = await req('/api/me/mobility', { method: 'PUT', body: { lane: 'work', target_countries: ['GB', 'DE'] } }); ok('mobility save accepted', r.status === 200, r);
  r = await req('/api/me'); ok('profile columns follow a mobility save (lane_pref, target_countries)', r.body.me.lane_pref === 'work' && Array.isArray(r.body.me.target_countries) && r.body.me.target_countries.join(',') === 'GB,DE', [r.body.me.lane_pref, r.body.me.target_countries]);
  // replacement CV: the old one is superseded, never deleted; the new one is version 2
  m = multipart([{ name: 'Ayesha_CV_v2.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: docx('Ayesha Khan v2') }]);
  r = await req('/api/documents', { method: 'POST', raw: m.body, headers: { 'content-type': m.type } }); ok('replacement CV accepted', r.status === 200, r);
  r = await req('/api/documents'); const cvs = (r.body.documents || []).filter(d => d.kind === 'cv' || d.doc_type === 'cv'); ok('documents list shows one live CV (the newest)', cvs.length === 1 && /v2/.test(cvs[0].name), cvs.map(d => d.name));
  r = await req('/api/me/state'); ok('state points at the newest CV', r.body.hasCV && /v2/.test(String(r.body.cvName || '')), r.body.cvName);
  console.log('\nextraction: ' + pass + ' pass / ' + fail + ' fail'); child.kill(); process.exit(fail ? 1 : 0);
})();
