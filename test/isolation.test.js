/* PHASE 1 · TENANT ISOLATION, AUTHORISATION AND AUTHENTICATION — proven against a seeded in-memory database.
   Boots server.js with FF_MEMDB=1; seeds two consultancies, their staff and clients, two direct applicants and one staff member;
   then asserts positive access, denied access, cross-tenant access, unauthenticated access and wrong-role access per surface. */
const { spawn } = require('child_process'); const PORT = 4491; const BASE = 'http://127.0.0.1:' + PORT;
const env = Object.assign({}, process.env, { NODE_ENV: 'test', FF_MEMDB: '1', FF_QUEUE: 'off', PORT: String(PORT), SUPABASE_URL: 'https://memdb.local', SUPABASE_ANON_KEY: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', ANTHROPIC_API_KEY: 'x', GEMINI_API_KEY: 'x', FF_DATA_KEY: '0000000000000000000000000000000000000000000000000000000000000001' });
const U = { ownerA: 'a1a1a1a1-0000-4000-8000-000000000001', consA: 'a1a1a1a1-0000-4000-8000-000000000002', subA: 'a1a1a1a1-0000-4000-8000-000000000003', clientA: 'a1a1a1a1-0000-4000-8000-000000000004', ownerB: 'b1b1b1b1-0000-4000-8000-000000000001', clientB: 'b1b1b1b1-0000-4000-8000-000000000004', appX: 'c1c1c1c1-0000-4000-8000-000000000001', appY: 'c1c1c1c1-0000-4000-8000-000000000002', staff: 'd1d1d1d1-0000-4000-8000-000000000001' };
const ORG = { A: 'e1e1e1e1-0000-4000-8000-00000000000a', B: 'e1e1e1e1-0000-4000-8000-00000000000b' };
const IDS = { clA1: 'f1f1f1f1-0000-4000-8000-000000000001', clA2: 'f1f1f1f1-0000-4000-8000-000000000002', clB1: 'f1f1f1f1-0000-4000-8000-000000000011', docX: 'f2f2f2f2-0000-4000-8000-000000000001', docY: 'f2f2f2f2-0000-4000-8000-000000000002', appXcase: 'f3f3f3f3-0000-4000-8000-000000000001', appYcase: 'f3f3f3f3-0000-4000-8000-000000000002', opp: 'f4f4f4f4-0000-4000-8000-000000000001', keyA: 'f5f5f5f5-0000-4000-8000-000000000001' };
const tok = id => 'test:' + id + ':' + id.slice(0, 8) + '@test.local';
async function req(path, { method = 'GET', body, user, headers } = {}) { const h = Object.assign({ 'content-type': 'application/json' }, headers || {}); if (user) h.authorization = 'Bearer ' + tok(user); const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j }; }
const crypto = require('crypto'); const rawKeyA = 'ffk_TESTKEYA000000000000000000000'; const keyHashA = crypto.createHash('sha256').update(rawKeyA).digest('hex');
const seed = { profiles: [
  { id: U.ownerA, email: 'ownera@test.local', role: 'user', full_name: 'Owner A' }, { id: U.consA, email: 'consa@test.local', role: 'user', full_name: 'Consultant A' }, { id: U.subA, email: 'suba@test.local', role: 'user', full_name: 'SubAgent A' }, { id: U.clientA, email: 'clienta@test.local', role: 'user', full_name: 'Client A One', signup_org_id: ORG.A, apply_email: 'client.a@forimail.com' },
  { id: U.ownerB, email: 'ownerb@test.local', role: 'user', full_name: 'Owner B' }, { id: U.clientB, email: 'clientb@test.local', role: 'user', full_name: 'Client B One', signup_org_id: ORG.B, apply_email: 'client.b@forimail.com' },
  { id: U.appX, email: 'x@test.local', role: 'user', full_name: 'Applicant X', apply_email: 'x@forimail.com' }, { id: U.appY, email: 'y@test.local', role: 'user', full_name: 'Applicant Y', apply_email: 'y@forimail.com' }, { id: U.staff, email: 'staff@test.local', role: 'admin', full_name: 'Staff S' }],
  organisations: [{ id: ORG.A, name: 'Alpha Consultants', kind: 'agency', owner_user_id: U.ownerA, settings: {} }, { id: ORG.B, name: 'Beta Consultants', kind: 'agency', owner_user_id: U.ownerB, settings: {} }],
  org_members: [{ org_id: ORG.A, user_id: U.ownerA, role: 'owner', status: 'active' }, { org_id: ORG.A, user_id: U.consA, role: 'consultant', status: 'active', branch: 'Lahore' }, { org_id: ORG.A, user_id: U.subA, role: 'sub_agent', status: 'active' }, { org_id: ORG.B, user_id: U.ownerB, role: 'owner', status: 'active' }],
  clients: [{ id: IDS.clA1, org_id: ORG.A, full_name: 'Client A One', user_id: U.clientA, owner_user_id: U.consA, stage: 'lead', lane: 'study', apply_email: 'client.a@forimail.com' }, { id: IDS.clA2, org_id: ORG.A, full_name: 'Client A Two', owner_user_id: U.subA, stage: 'lead', lane: 'work' }, { id: IDS.clB1, org_id: ORG.B, full_name: 'Client B One', user_id: U.clientB, owner_user_id: U.ownerB, stage: 'lead', lane: 'study' }],
  opportunities: [{ id: IDS.opp, title: 'Nurse', institution: 'Trust', country_code: 'GB', kind: 'work', category: 'care', verified_at: new Date().toISOString(), url: 'https://example.org/job' }],
  applications: [{ id: IDS.appXcase, user_id: U.appX, opportunity_id: IDS.opp, status: 'sent', stage: 'sent' }, { id: IDS.appYcase, user_id: U.appY, opportunity_id: IDS.opp, status: 'draft', stage: 'draft' }],
  documents: [{ id: IDS.docX, user_id: U.appX, name: 'x.pdf', doc_type: 'cv', storage_key: 'x/x.pdf', mime: 'application/pdf', size_bytes: 10, generated: false }, { id: IDS.docY, user_id: U.appY, name: 'y.pdf', doc_type: 'cv', storage_key: 'y/y.pdf', mime: 'application/pdf', size_bytes: 10, generated: false }],
  org_api_keys: [{ id: IDS.keyA, org_id: ORG.A, name: 'k', key_hash: keyHashA, prefix: rawKeyA.slice(0, 10) }],
  case_messages: [{ user_id: U.appX, direction: 'in', subject: 'Offer for X', body_text: 'x', received_at: new Date().toISOString() }, { client_id: IDS.clA1, org_id: ORG.A, user_id: U.clientA, direction: 'in', subject: 'Reply for client A', body_text: 'a', received_at: new Date().toISOString() }] };
(async () => {
  const child = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 250)); try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch (e) {} }
  const s = await req('/__memdb/seed', { method: 'POST', body: { reset: true, rows: seed } }); if (!s.body || !s.body.ok) { console.log('seed failed', s.status, log.slice(-500)); child.kill(); process.exit(1); }
  let pass = 0, fail = 0; const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  → ' + JSON.stringify(extra).slice(0, 200) : '')); } };
  // ---- AUTHENTICATION ----
  let r = await req('/api/me'); ok('unauthenticated /api/me → 401', r.status === 401, r);
  r = await req('/api/org/' + ORG.A + '/clients'); ok('unauthenticated org route → 401', r.status === 401, r);
  r = await req('/api/admin/users'); ok('unauthenticated admin route → 401', r.status === 401, r);
  r = await req('/api/me', { headers: { authorization: 'Bearer forged.jwt.value' } }); ok('malformed token → 401', r.status === 401, r);
  r = await req('/api/me', { headers: { authorization: 'Bearer test:not-a-user' } }); ok('token without a user → 401', r.status === 401, r);
  r = await req('/api/me', { user: U.appX }); ok('valid token → 200 own profile', r.status === 200 && r.body && r.body.me && r.body.me.id === U.appX, r);
  // ---- ORG TENANCY ----
  r = await req('/api/org/' + ORG.A + '/clients', { user: U.ownerA }); ok('owner A lists own clients (2)', r.status === 200 && r.body && r.body.clients && r.body.clients.length === 2 && r.body.clients.every(c => c.org_id === ORG.A || !c.org_id), r);
  r = await req('/api/org/' + ORG.B + '/clients', { user: U.ownerA }); ok('owner A → org B clients denied (403)', r.status === 403, r);
  r = await req('/api/org/' + ORG.A + '/clients/' + IDS.clB1 + '/overview', { user: U.ownerA }); ok('owner A → client of org B by id denied (404)', r.status === 404, r);
  r = await req('/api/org/' + ORG.A + '/clients/' + IDS.clA1 + '/overview', { user: U.ownerA }); ok('owner A → own client overview 200', r.status === 200, r);
  r = await req('/api/org/' + ORG.A + '/clients', { user: U.subA }); ok('sub-agent sees only own clients (1)', r.status === 200 && r.body.clients.length === 1 && r.body.clients[0].id === IDS.clA2, r);
  r = await req('/api/org/' + ORG.A + '/clients/' + IDS.clA1 + '/overview', { user: U.subA }); ok('sub-agent → colleague client denied (404)', r.status === 404, r);
  r = await req('/api/org/' + ORG.A + '/clients', { user: U.appX }); ok('direct applicant → org route denied (403)', r.status === 403, r);
  r = await req('/api/org/' + ORG.A + '/finance/report', { user: U.consA }); ok('consultant → finance report denied (403, finance.read is owner/manager)', r.status === 403, r);
  r = await req('/api/org/' + ORG.A + '/finance/report', { user: U.ownerA }); ok('owner → finance report 200', r.status === 200, r);
  r = await req('/api/org/' + ORG.A + '/clients/' + IDS.clA1 + '/mail', { user: U.ownerA }); ok('owner A → own client mail 200 (1 message)', r.status === 200 && r.body.messages && r.body.messages.length === 1, r);
  r = await req('/api/org/' + ORG.B + '/clients/' + IDS.clA1 + '/mail', { user: U.ownerB }); ok('owner B → org A client mail via own org denied (404)', r.status === 404, r);
  r = await req('/api/org/' + ORG.A + '/queues', { user: U.ownerB }); ok('owner B → org A queues denied (403)', r.status === 403, r);
  r = await req('/api/org/' + ORG.A + '/clients', { method: 'POST', user: U.ownerB, body: { full_name: 'Intruder' } }); ok('owner B cannot create a client in org A (403)', r.status === 403, r);
  // ---- APPLICANT ISOLATION ----
  r = await req('/api/cases/' + IDS.appYcase + '/view', { user: U.appX }); ok('applicant X → applicant Y case denied (no data)', (r.status === 403 || r.status === 404 || r.status === 400) && !(r.body && r.body.application), r);
  r = await req('/api/documents/' + IDS.docY + '/url', { user: U.appX }); ok('applicant X → applicant Y document URL denied (403/404)', r.status === 403 || r.status === 404, r);
  r = await req('/api/documents', { user: U.appX }); ok('applicant X lists only own documents', r.status === 200 && Array.isArray(r.body.documents) && r.body.documents.every(d => d.user_id === U.appX || d.id === IDS.docX) && r.body.documents.length === 1, r);
  r = await req('/api/applications', { user: U.appY }); ok('applicant Y lists only own applications', r.status === 200 && (r.body.applications || []).every(a => a.user_id === U.appY) , r);
  r = await req('/api/me/mailbox', { user: U.appY }); ok('applicant Y mailbox holds no message of X', r.status === 200 && JSON.stringify(r.body).indexOf('Offer for X') < 0, r);
  // ---- STRICT SEPARATION: consultancies never see direct applicants ----
  r = await req('/api/org/' + ORG.A + '/clients', { method: 'POST', user: U.ownerA, body: { full_name: 'Applicant X', email: 'x@test.local', force: true } }); ok('consultancy adds a client with a direct applicant\'s email → record without any link', r.status === 200 && r.body && r.body.client && !r.body.client.user_id, r);
  r = await req('/api/pay/checkout', { method: 'POST', user: U.clientA, body: { credits: 1 } }); ok('consultancy client blocked from ForiForeign checkout (403)', r.status === 403 && r.body && r.body.code === 'CONSULTANCY_CLIENT', r);
  // ---- STAFF / ADMIN ----
  r = await req('/api/admin/users', { user: U.ownerA }); ok('org owner → admin route denied (403)', r.status === 403, r);
  r = await req('/api/admin/users', { user: U.staff }); ok('staff → admin users 200', r.status === 200, r);
  const masked = r.body && (r.body.users || []).find(u => u.id === U.clientA); ok('staff sees the consultancy client masked', !!masked && !/Client A One/.test(String(masked.full_name || '')), masked);
  r = await req('/api/cases/' + IDS.appXcase + '/view?staff=1', { user: U.staff }); ok('staff opens a direct applicant case (200)', r.status === 200, r);
  r = await req('/api/admin/users/' + U.appX + '/role', { method: 'POST', user: U.consA, body: { role: 'admin' } }); ok('consultant cannot change roles (403)', r.status === 403, r);
  // ---- API KEYS ----
  r = await req('/api/v1/clients', { headers: { 'x-api-key': rawKeyA } }); ok('org API key lists org A clients only', r.status === 200 && (r.body.clients || []).every(c => !c.org_id || c.org_id === ORG.A) && (r.body.clients || []).length >= 2 && !(r.body.clients || []).some(c => c.id === IDS.clB1), r);
  r = await req('/api/v1/clients', { headers: { 'x-api-key': 'ffk_WRONG' } }); ok('wrong API key → 401', r.status === 401, r);
  // ---- WEBHOOK / PUBLIC ----
  const before = (await req('/api/org/' + ORG.A + '/clients', { user: U.ownerA })).body.clients.length;
  r = await req('/api/hooks/whatsapp/' + ORG.A, { method: 'POST', body: { entry: [{ changes: [{ value: { metadata: { phone_number_id: '999' }, messages: [{ from: '923001234567', text: { body: 'hi' } }] } }] }] } });
  const after = (await req('/api/org/' + ORG.A + '/clients', { user: U.ownerA })).body.clients.length; ok('WhatsApp hook without the org\'s own number creates nothing', r.status === 200 && after === before, { before, after });
  r = await req('/api/offering'); ok('public offering carries no secrets', r.status === 200 && !/service_role|api_key|secret/i.test(JSON.stringify(r.body)), r);
  r = await req('/api/pr/GB'); ok('public PR pathway route is readable', r.status === 200 || r.status === 404, r);
  console.log('\nisolation: ' + pass + ' pass / ' + fail + ' fail'); child.kill(); process.exit(fail ? 1 : 0);
})();
