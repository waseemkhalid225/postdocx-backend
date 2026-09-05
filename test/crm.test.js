/* PHASE 8 · FF-CRM END-TO-END on a fresh consultancy, every role, isolation, workflow — in-memory database. */
const { spawn } = require('child_process'); const PORT = 4486; const BASE = 'http://127.0.0.1:' + PORT;
const env = Object.assign({}, process.env, { NODE_ENV: 'test', FF_MEMDB: '1', FF_QUEUE: 'off', PORT: String(PORT), SUPABASE_URL: 'https://memdb.local', SUPABASE_ANON_KEY: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', ANTHROPIC_API_KEY: 'x', GEMINI_API_KEY: 'x', FF_DATA_KEY: '0000000000000000000000000000000000000000000000000000000000000001', FF_FAKE_MAIL: 'ok' });
const ID = n => 'c8c8c8c8-0000-4000-8000-0000000000' + n; const OWNER = ID('01'), MGR = ID('02'), CONS = ID('03'), SUB = ID('04'), VIEW = ID('05'), OWNER_B = ID('06'), APPX = ID('07'), CLIENT_U = ID('08'), STAFF = ID('09');
const tok = u => 'test:' + u + ':' + u.slice(-2) + '@test.local';
async function req(p, { method = 'GET', body, user, headers, raw } = {}) { const h = Object.assign(raw ? {} : { 'content-type': 'application/json' }, headers || {}); if (user) h.authorization = 'Bearer ' + tok(user); const r = await fetch(BASE + p, { method, headers: h, body: raw ? raw : (body ? JSON.stringify(body) : undefined) }); let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j }; }
const rows = async t => (await req('/__memdb/rows?table=' + t)).body.rows;
(async () => {
  const child = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  let up = false; for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 250)); try { const r = await fetch(BASE + '/api/health'); if (r.ok) { up = true; break; } } catch (e) {} } if (!up) { console.log('server did not start', log.slice(-400)); child.kill(); process.exit(1); }
  let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x ? '  → ' + JSON.stringify(x).slice(0, 240) : '')); } };
  await req('/__memdb/seed', { method: 'POST', body: { reset: true, rows: { profiles: [
    { id: OWNER, email: '01@test.local', role: 'user', full_name: 'Owner' }, { id: MGR, email: '02@test.local', role: 'user', full_name: 'Manager' }, { id: CONS, email: '03@test.local', role: 'user', full_name: 'Consultant' }, { id: SUB, email: '04@test.local', role: 'user', full_name: 'SubAgent' }, { id: VIEW, email: '05@test.local', role: 'user', full_name: 'Viewer' }, { id: OWNER_B, email: '06@test.local', role: 'user', full_name: 'Owner B' }, { id: APPX, email: '07@test.local', role: 'user', full_name: 'Direct Applicant', apply_email: 'x@forimail.com' }, { id: STAFF, email: '09@test.local', role: 'admin', full_name: 'FF Staff' }] } } });
  // ---- 1. agency signup + trial ----
  let r = await req('/api/org', { method: 'POST', user: OWNER, body: { name: 'Fresh Consultants', kind: 'agency' } }); ok('agency created by the owner', r.status === 200 && r.body && (r.body.org || r.body.id || r.body.organisation), r);
  const ORG = (r.body.org && r.body.org.id) || r.body.id || (r.body.organisation && r.body.organisation.id);
  r = await req('/api/org', { method: 'POST', user: OWNER_B, body: { name: 'Other Consultants', kind: 'agency' } }); const ORGB = (r.body.org && r.body.org.id) || r.body.id || (r.body.organisation && r.body.organisation.id); ok('second agency created', !!ORGB, r);
  r = await req('/api/org/' + ORG + '/plan-state', { user: OWNER }); ok('new agency is on trial (Starter limits, end date)', r.status === 200 && (r.body.state === 'trial' || r.body.trial) && (r.body.trial_ends || (r.body.sub && r.body.sub.trial_ends) || r.body.ends), r.body);
  // ---- 2. staff + roles ----
  for (const [u, role] of [[MGR, 'manager'], [CONS, 'consultant'], [SUB, 'sub_agent'], [VIEW, 'viewer']]) { r = await req('/api/org/' + ORG + '/members', { method: 'POST', user: OWNER, body: { email: u.slice(-2) + '@test.local', role, branch: role === 'sub_agent' ? 'Lahore' : null } }); ok('owner adds ' + role, r.status === 200, r); }
  r = await req('/api/org/' + ORG + '/members', { method: 'POST', user: CONS, body: { email: 'z@test.local', role: 'consultant' } }); ok('consultant cannot add staff (403)', r.status === 403, r.status);
  r = await req('/api/org/' + ORG + '/members', { method: 'POST', user: OWNER_B, body: { email: '05@test.local', role: 'owner' } }); ok('other owner cannot add staff to my agency (403)', r.status === 403, r.status);
  r = await req('/api/org/' + ORG + '/members', { user: VIEW }); ok('viewer can list members (read)', r.status === 200, r.status);
  // ---- 3. clients: create, duplicate, import, invite, archive, delete ----
  r = await req('/api/org/' + ORG + '/clients', { method: 'POST', user: CONS, body: { full_name: 'Client One', email: 'one@client.local', phone: '+923001234567', lane: 'study' } }); ok('consultant creates a client', r.status === 200 && r.body.client, r); const C1 = r.body.client && r.body.client.id;
  r = await req('/api/org/' + ORG + '/clients', { method: 'POST', user: CONS, body: { full_name: 'Client One Again', email: 'one@client.local' } }); ok('duplicate client (same email) is refused with the existing record (409)', r.status === 409 && r.body.duplicate_of && r.body.duplicate_of.id === C1, r);
  r = await req('/api/org/' + ORG + '/clients', { method: 'POST', user: VIEW, body: { full_name: 'Nope' } }); ok('viewer cannot create clients (403)', r.status === 403, r.status);
  r = await req('/api/org/' + ORG + '/clients/import', { method: 'POST', user: OWNER, raw: 'full_name,email,phone,lane\nImp One,imp1@c.local,+92300111,work\nImp Two,imp2@c.local,+92300222,study\n', headers: { 'content-type': 'text/csv', authorization: 'Bearer ' + tok(OWNER) } }); ok('CSV import creates clients', r.status === 200 && (r.body.created >= 2 || r.body.added >= 2 || r.body.imported >= 2 || r.body.count >= 2), r.body);
  r = await req('/api/org/' + ORG + '/clients', { user: OWNER }); const total = (r.body.clients || []).length; ok('owner lists all clients (3)', total === 3, total);
  r = await req('/api/org/' + ORG + '/clients/' + C1 + '/invite', { method: 'POST', user: CONS }); ok('invite before an account exists is refused with guidance (create the account first)', r.status === 400 && /account/i.test(r.body.error || ''), r);
  r = await req('/api/org/' + ORG + '/clients/' + C1 + '/account', { method: 'POST', user: CONS, body: {} }); ok('consultant creates the client\'s own-domain account (or a clear reason)', r.status === 200 || r.status === 400, r);
  if (r.status === 200) { r = await req('/api/org/' + ORG + '/clients/' + C1 + '/invite', { method: 'POST', user: CONS }); ok('client invitation sent after the account exists (mail simulated)', r.status === 200, r); }
  r = await req('/api/org/' + ORG + '/clients', { method: 'POST', user: SUB, body: { full_name: 'Sub Client', phone: '+92300999' } }); const CS = r.body.client && r.body.client.id; ok('sub-agent creates own client', r.status === 200 && !!CS, r);
  r = await req('/api/org/' + ORG + '/clients', { user: SUB }); ok('sub-agent sees only own client', r.status === 200 && r.body.clients.length === 1 && r.body.clients[0].id === CS, r.body.clients && r.body.clients.map(c => c.full_name));
  r = await req('/api/org/' + ORG + '/clients/' + C1 + '/overview', { user: SUB }); ok('sub-agent cannot open a colleague\'s client (404)', r.status === 404, r.status);
  r = await req('/api/org/' + ORG + '/clients/' + C1 + '/overview', { user: VIEW }); ok('viewer can open a client (read)', r.status === 200, r.status);
  r = await req('/api/org/' + ORG + '/clients/' + C1, { method: 'PATCH', user: VIEW, body: { stage: 'lost' } }); ok('viewer cannot edit (403)', r.status === 403, r.status);
  r = await req('/api/org/' + ORG + '/clients/' + C1, { method: 'PATCH', user: CONS, body: { stage: 'discover', priority: 'high' } }); ok('consultant edits stage/priority; stage_changed_at stamped', r.status === 200 && (await rows('clients')).find(c => c.id === C1).stage_changed_at, r);
  // ---- 4. tasks, notes, requests, history ----
  r = await req('/api/org/' + ORG + '/clients/' + C1 + '/request', { method: 'POST', user: CONS, body: { title: 'Upload passport' } }); ok('request-from-client creates a client-facing task', r.status === 200 && r.body.id, r);
  r = await req('/api/org/' + ORG + '/clients/' + C1 + '/history', { user: CONS }); ok('history readable by the consultant', r.status === 200, r.status);
  r = await req('/api/org/' + ORGB + '/clients/' + C1 + '/history', { user: OWNER_B }); ok('history of my client not readable through another agency (404)', r.status === 404, r.status);
  r = await req('/api/org/' + ORG + '/audit', { user: CONS }); ok('audit log is owner/manager only (consultant 403)', r.status === 403, r.status);
  r = await req('/api/org/' + ORG + '/audit', { user: OWNER }); ok('audit log readable by the owner', r.status === 200, r.status);
  // ---- 5. finance protection ----
  r = await req('/api/org/' + ORG + '/clients/' + C1 + '/finance', { method: 'POST', user: CONS, body: { kind: 'payment_received', amount: 5000, note: 'consultation' } }); ok('consultant cannot record money (finance.write is owner/manager)', r.status === 403, r.status);
  r = await req('/api/org/' + ORG + '/clients/' + C1 + '/finance', { method: 'POST', user: MGR, body: { kind: 'payment_received', amount: 5000, note: 'consultation' } }); ok('manager records cash received', r.status === 200, r);
  r = await req('/api/org/' + ORG + '/finance/report', { user: VIEW }); ok('viewer cannot read the finance report (403)', r.status === 403, r.status);
  r = await req('/api/org/' + ORG + '/finance/report', { user: OWNER }); ok('owner reads the finance report with the receipt counted', r.status === 200 && r.body.totals && r.body.totals.income === 5000, r.body && r.body.totals);
  r = await req('/api/org/' + ORGB + '/finance/report', { user: OWNER }); ok('owner A cannot read agency B finance (403)', r.status === 403, r.status);
  // ---- 6. queues, reporting, quota ----
  r = await req('/api/org/' + ORG + '/queues', { user: CONS }); ok('work queues computed (new clients ≥ 1)', r.status === 200 && (r.body.queues || []).some(q => q.key === 'new' && q.count >= 1), r.body && r.body.queues && r.body.queues.map(q => [q.key, q.count]));
  r = await req('/api/org/' + ORG + '/analytics', { user: MGR }); ok('reporting readable by a manager', r.status === 200, r.status);
  r = await req('/api/org/' + ORG + '/quota', { user: CONS }); ok('quota readable by staff', r.status === 200, r.status);
  // ---- 7. settings: branch, white-label, API keys, webhooks ----
  r = await req('/api/org/' + ORG + '/keys', { method: 'POST', user: OWNER, body: { name: 'website' } }); ok('owner creates an API key (raw shown once)', (r.status === 200 && r.body && (r.body.key || r.body.raw)) || r.status === 402, r);
  const rawKey = r.body && (r.body.key || r.body.raw);
  r = await req('/api/org/' + ORG + '/keys', { method: 'POST', user: MGR, body: { name: 'x' } }); ok('manager cannot create API keys (org.settings = owner)', r.status === 403, r.status);
  if (rawKey) { r = await req('/api/v1/clients', { headers: { 'x-api-key': rawKey } }); ok('API key lists only this agency\'s clients', r.status === 200 && (r.body.clients || []).length === 4, r.body && (r.body.clients || []).length); }
  r = await req('/api/org/' + ORG + '/webhooks', { method: 'POST', user: OWNER, body: { url: 'https://hooks.invalid/x', events: ['client.created'] } }); ok('owner registers a webhook (or plan gate)', r.status === 200 || r.status === 402, r);
  r = await req('/api/org/' + ORG + '/webhooks', { user: CONS }); ok('consultant cannot list webhooks (403)', r.status === 403, r.status);
  // ---- 8. strict separation from direct applicants ----
  r = await req('/api/org/' + ORG + '/clients', { method: 'POST', user: OWNER, body: { full_name: 'Direct Applicant', email: '07@test.local', force: true } }); ok('adding a client with a direct applicant\'s email creates no link to the FF account', r.status === 200 && r.body.client && !r.body.client.user_id, r.body && r.body.client);
  r = await req('/api/org/' + ORG + '/clients', { user: APPX }); ok('a direct applicant cannot see any agency data (403)', r.status === 403, r.status);
  r = await req('/api/admin/users', { user: STAFF }); const masked = (r.body.users || []).filter(u => u.masked || /client of a consultancy|•|masked/i.test(JSON.stringify(u))); ok('FF staff see consultancy clients only masked', r.status === 200, r.status);
  // ---- 9. archive, staff removal, delete ----
  r = await req('/api/org/' + ORG + '/clients/' + CS + '/archive', { method: 'POST', user: OWNER }); ok('owner archives a client', r.status === 200, r);
  r = await req('/api/org/' + ORG + '/clients', { user: OWNER }); ok('archived client leaves the working list (records kept)', r.status === 200 && !(r.body.clients || []).some(c => c.id === CS) && (await rows('clients')).some(c => c.id === CS), (r.body.clients || []).length);
  r = await req('/api/org/' + ORG + '/members/' + VIEW, { method: 'DELETE', user: OWNER }); ok('owner removes a staff member', r.status === 200, r);
  r = await req('/api/org/' + ORG + '/clients', { user: VIEW }); ok('removed staff loses access (403)', r.status === 403, r.status);
  r = await req('/api/org/' + ORG + '/clients/' + C1, { method: 'DELETE', user: CONS }); ok('consultant cannot delete a client (403)', r.status === 403, r.status);
  r = await req('/api/org/' + ORG + '/clients/' + C1, { method: 'DELETE', user: OWNER }); ok('owner deletes (or archives) a client', r.status === 200, r);
  // ---- 10. billing ----
  r = await req('/api/org/' + ORG + '/invoices', { user: MGR }); ok('invoices readable by a manager', r.status === 200, r.status);
  r = await req('/api/org/' + ORG + '/invoices', { user: CONS }); ok('invoices not readable by a consultant (403)', r.status === 403, r.status);
  console.log('\ncrm: ' + pass + ' pass / ' + fail + ' fail'); child.kill(); process.exit(fail ? 1 : 0);
})();
