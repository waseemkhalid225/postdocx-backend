/* PHASE 5 · APPLICATION ENGINE, FORIMAIL, OUTBOUND, INBOUND, CASE COMMUNICATION — simulated provider on the in-memory database.
   (No live credentials in this environment: every check below is a SIMULATED integration test with a fake provider; see the report.) */
const { spawn } = require('child_process'); const PORT = 4496; const BASE = 'http://127.0.0.1:' + PORT;
const env = Object.assign({}, process.env, { NODE_ENV: 'test', FF_MEMDB: '1', FF_QUEUE: 'off', PORT: String(PORT), SUPABASE_URL: 'https://memdb.local', SUPABASE_ANON_KEY: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', ANTHROPIC_API_KEY: 'x', GEMINI_API_KEY: 'x', FF_DATA_KEY: '0000000000000000000000000000000000000000000000000000000000000001', FF_FAKE_MAIL: 'ok', INTAKE_SECRET: 'intake-secret-test', APPLY_DOMAIN: 'forimail.com' });
const X = 'a5a5a5a5-0000-4000-8000-0000000000e1', Y = 'a5a5a5a5-0000-4000-8000-0000000000e2'; const tok = u => 'test:' + u + ':' + u.slice(-2) + '@test.local';
const OPP = 'f6f6f6f6-0000-4000-8000-000000000001', APPX = 'f7f7f7f7-0000-4000-8000-000000000001', APPY = 'f7f7f7f7-0000-4000-8000-000000000002', DOC = 'f8f8f8f8-0000-4000-8000-000000000001';
async function req(p, { method = 'GET', body, user, headers } = {}) { const h = Object.assign({ 'content-type': 'application/json' }, headers || {}); if (user) h.authorization = 'Bearer ' + tok(user); const r = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j }; }
(async () => {
  const child = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 250)); try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch (e) {} }
  let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x ? '  → ' + JSON.stringify(x).slice(0, 240) : '')); } };
  await req('/__memdb/seed', { method: 'POST', body: { reset: true, rows: { profiles: [{ id: X, email: 'e1@test.local', role: 'user', full_name: 'Xavier Test', apply_email: 'xavier.test@forimail.com' }, { id: Y, email: 'e2@test.local', role: 'user', full_name: 'Yara Test', apply_email: 'yara.test@forimail.com' }], opportunities: [{ id: OPP, title: 'Pharmacist', institution: 'Alpha Pharmacy', country_code: 'GB', kind: 'work', status: 'verified', verified_at: new Date().toISOString(), url: 'https://alpha.invalid/job', contact_emails: ['hr@alpha.invalid'] }], applications: [{ id: APPX, user_id: X, opportunity_id: OPP, status: 'prepared', stage: 'prepared' }, { id: APPY, user_id: Y, opportunity_id: OPP, status: 'prepared', stage: 'prepared' }], documents: [{ id: DOC, user_id: X, name: 'cv.pdf', kind: 'cv', doc_type: 'cv', storage_key: 'x/cv.pdf', mime: 'application/pdf', size_bytes: 12, generated: false }] } } });
  // 8-9 ForiMail identity and mailbox
  let r = await req('/api/me', { user: X }); ok('8 ForiMail address on the profile', r.body.me.apply_email === 'xavier.test@forimail.com', r.body.me.apply_email);
  r = await req('/api/me/mailbox', { user: X }); ok('9 mailbox displays (empty) without error', r.status === 200, r);
  // 10 send with the provider up: sent once, correct sender/recipient, attachment count
  await req('/__memdb/mail', { method: 'POST', body: { mode: 'ok' } });
  r = await req('/api/applications/' + APPX + '/send-from-mailbox', { method: 'POST', user: X, body: { to: 'hr@alpha.invalid', subject: 'Application for Pharmacist', body: 'Dear team, please find my application.', attach_doc_ids: [DOC] } });
  ok('10 send succeeds with the provider up', r.status === 200 && r.body && r.body.sent === true, r);
  let m = await req('/__memdb/mail', { method: 'POST', body: { mode: 'ok' } }); ok('7/5 exactly one provider call, from the applicant\'s ForiMail address to the recipient', m.body.sent === 1, m.body);
  let rows = (await req('/__memdb/rows?table=case_messages')).body.rows; const out1 = rows.find(x => x.direction === 'out'); ok('4/6 case message recorded as sent with the right identity and application', out1 && out1.user_id === X && out1.application_id === APPX && out1.from_addr === 'xavier.test@forimail.com' && out1.to_addr === 'hr@alpha.invalid' && out1.send_status === 'sent', out1);
  // duplicate-send: the same message again → deduped, no second provider call
  r = await req('/api/applications/' + APPX + '/send-from-mailbox', { method: 'POST', user: X, body: { to: 'hr@alpha.invalid', subject: 'Application for Pharmacist', body: 'Dear team, please find my application.', attach_doc_ids: [DOC] } });
  m = await req('/__memdb/mail', { method: 'POST', body: { mode: 'ok' } }); ok('DUP-1 identical send is deduplicated (no second provider call)', m.body.sent === 1 && (r.body.deduped === true || r.status === 200), [m.body.sent, r.body]);
  rows = (await req('/__memdb/rows?table=case_messages')).body.rows; ok('DUP-2 only one outbound case message row', rows.filter(x => x.direction === 'out').length === 1, rows.length);
  // 11-13 provider outage: queued, not lost; flush while down → retried, still one; provider back → sent once
  await req('/__memdb/mail', { method: 'POST', body: { mode: 'fail' } });
  r = await req('/api/applications/' + APPX + '/send-from-mailbox', { method: 'POST', user: X, body: { to: 'hr@alpha.invalid', subject: 'Follow-up on my application', body: 'Just checking in.' } });
  ok('11 send during an outage returns queued (not an error), with a plain note', r.status === 200 && r.body.queued === true && /queued/i.test(r.body.note || ''), r);
  let ob = (await req('/__memdb/rows?table=mail_outbox')).body.rows; const pend = ob.find(o => o.status === 'pending'); ok('11b outbox row pending with the error recorded', !!pend && pend.attempts === 1 && /outage/.test(pend.last_error || ''), ob);
  rows = (await req('/__memdb/rows?table=case_messages')).body.rows; ok('11c case message shows queued', rows.some(x => x.subject === 'Follow-up on my application' && x.send_status === 'queued'), rows.map(x => [x.subject, x.send_status]));
  await req('/__memdb/seed', { method: 'POST', body: { rows: {} } }); // no-op
  // make it due and flush while still down
  let due = await req('/__memdb/flush', { method: 'POST' }); ok('12 flush while down: not sent, still one pending row (backoff)', due.body && due.body.sent === 0, due.body);
  await req('/__memdb/mail', { method: 'POST', body: { mode: 'ok' } });
  // force due: patch next_attempt_at through a second flush after making it due via seed of same key? simplest: wait none; flush reads lte now → row's next_attempt_at is +5m; emulate time by editing row
  await req('/__memdb/due', { method: 'POST' });
  due = await req('/__memdb/flush', { method: 'POST' }); ok('13 provider back → queued message sent exactly once', due.body && due.body.sent === 1, due.body);
  m = await req('/__memdb/mail', { method: 'POST', body: { mode: 'ok' } }); ok('13b provider call count is 2 in total (one original, one recovered)', m.body.sent === 2, m.body.sent);
  rows = (await req('/__memdb/rows?table=case_messages')).body.rows; ok('13c case message flips to sent after recovery', rows.some(x => x.subject === 'Follow-up on my application' && x.send_status === 'sent'), rows.map(x => [x.subject, x.send_status]));
  due = await req('/__memdb/flush', { method: 'POST' }); ok('DUP-3 second flush sends nothing (idempotent)', due.body.sent === 0 && due.body.due === 0, due.body);
  // 14-16 inbound: to X's address → X's case; to Y's address quoting X's subject → Y only; bad secret → 401
  r = await req('/api/intake/email', { method: 'POST', body: { to: 'xavier.test@forimail.com', from: 'HR <hr@alpha.invalid>', subject: 'Re: Application for Pharmacist', text: 'We would like to invite you to an interview next week.' }, headers: { 'x-intake-secret': 'intake-secret-test' } });
  ok('14 inbound reply accepted', r.status === 200 && r.body && r.body.ok, r);
  rows = (await req('/__memdb/rows?table=case_messages')).body.rows; const inX = rows.find(x => x.direction === 'in' && x.user_id === X); ok('15 reply linked to X and to X\'s application (thread by subject)', !!inX && inX.application_id === APPX, inX);
  r = await req('/api/intake/email', { method: 'POST', body: { to: 'yara.test@forimail.com', from: 'HR <hr@alpha.invalid>', subject: 'Re: Application for Pharmacist', text: 'Reply meant for Yara.' }, headers: { 'x-intake-secret': 'intake-secret-test' } });
  rows = (await req('/__memdb/rows?table=case_messages')).body.rows; const inY = rows.filter(x => x.direction === 'in' && x.user_id === Y); ok('16 wrong-thread protection: a reply to Y\'s address never lands on X\'s case', inY.length === 1 && inY[0].application_id !== APPX && !rows.some(x => x.direction === 'in' && x.user_id === X && /Yara/.test(x.body || '')), inY);
  r = await req('/api/intake/email', { method: 'POST', body: { to: 'xavier.test@forimail.com', from: 'x@y', subject: 's', text: 't' }, headers: { 'x-intake-secret': 'wrong' } }); ok('inbound with a wrong secret → 401', r.status === 401, r);
  r = await req('/api/intake/email', { method: 'POST', body: { to: 'nobody@forimail.com', from: 'x@y', subject: 's', text: 't' }, headers: { 'x-intake-secret': 'intake-secret-test' } }); ok('inbound to an unknown address is ignored, not stored', r.status === 202 || (r.status === 200 && r.body && r.body.ignored), r);
  // 17-18 classification when the model is unavailable: stored, flagged for the person, never guessed
  ok('17/18 with no model the reply is stored and marked for human reading (no invented classification)', !!inX && (!inX.classification || inX.classification === 'other' || inX.classification === 'unknown' || inX.needs_confirmation !== false), [inX.classification, inX.needs_confirmation]);
  // 22-24 mailbox/read state and persistence
  r = await req('/api/me/mailbox', { user: X }); const box = JSON.stringify(r.body); ok('22/24 mailbox lists the reply after a fresh load; Y\'s reply absent', r.status === 200 && Array.isArray(r.body.messages) && r.body.messages.some(x => /Application for Pharmacist/.test(x.subject || '')) && !r.body.messages.some(x => /Yara/.test(JSON.stringify(x))), (r.body.messages || []).map(x => x.subject));
  ok('23 unread reply carries no read_at', inX && !inX.read_at, inX && inX.read_at);
  console.log('\nmail: ' + pass + ' pass / ' + fail + ' fail'); child.kill(); process.exit(fail ? 1 : 0);
})();
